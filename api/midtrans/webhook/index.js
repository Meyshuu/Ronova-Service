const admin = require('firebase-admin');

function initFirebase() {
  if (!admin.apps.length) {
    // Uses default credentials in Vercel/Firebase env.
    // If you use a service account, set FIREBASE_SERVICE_ACCOUNT_PATH env and adjust here.
    admin.initializeApp();
  }
  return admin.firestore();
}

function json(res, status, payload) {
  try {
    res.status(status).setHeader('Content-Type', 'application/json');
  } catch {
    // ignore
  }
  return res.status(status).json(payload);
}

function normalizeStatus(status) {
  const s = String(status || '').toLowerCase();
  // Midtrans typical fields: transaction_status or transactionStatus
  // paid/settlement/capture/success usually means money received.
  const paid = ['capture', 'settlement', 'paid', 'success'].includes(s);
  return { paid };
}

async function applyTopupPaid(db, appState, { orderId, payload, amount }) {
  const state = appState || {};
  const topUps = Array.isArray(state.topUps) ? state.topUps : [];
  const idx = topUps.findIndex((t) => String(t.id) === String(orderId));
  if (idx === -1) return { applied: false, reason: 'topup not found' };

  const topUp = topUps[idx];
  const alreadyApplied = topUp.status === 'paid' && topUp.applied === true;

  topUps[idx] = {
    ...topUp,
    status: 'paid',
    provider: 'MIDTRANS',
    raw: payload,
    applied: true,
    paidAt: new Date().toISOString()
  };

  if (!alreadyApplied) {
    const users = Array.isArray(state.users) ? state.users : [];
    const uIdx = users.findIndex((u) => String(u.id) === String(topUp.userId));
    if (uIdx !== -1) {
      const add = Number(amount ?? topUp.amount ?? 0);
      users[uIdx] = { ...users[uIdx], balance: Number(users[uIdx].balance || 0) + add };
      await db.doc('appState/web-joki').set({ ...state, users, topUps });
    } else {
      await db.doc('appState/web-joki').set({ ...state, topUps });
    }
  } else {
    await db.doc('appState/web-joki').set({ ...state, topUps });
  }

  return { applied: true };
}

module.exports = async function handler(req, res) {
  // Midtrans webhook can be POST JSON.
  if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });

  let db;
  try {
    db = initFirebase();
  } catch (e) {
    return json(res, 500, { error: 'Firebase init failed', details: e?.message || String(e) });
  }

  try {
    const payload = req.body || {};

    // order_id usually exists; fallback to orderId
    const orderId = payload.order_id || payload.orderId || payload.transaction_id || payload.transactionId;
    if (!orderId) {
      return json(res, 400, { error: 'Missing order_id/transaction/orderId' });
    }

    const { paid } = normalizeStatus(payload.transaction_status || payload.status_code || payload.transactionStatus || payload.status);
    const amount =
      payload.gross_amount ??
      payload.grossAmount ??
      payload.amount ??
      (payload.transaction_details && (payload.transaction_details.gross_amount || payload.transaction_details.grossAmount));

    const snap = await db.doc('appState/web-joki').get();
    if (!snap.exists) return json(res, 404, { error: 'App state not found' });

    const state = snap.data() || {};

    if (!paid) {
      // For non-paid transactions, we do nothing (or you can mark failed if you want).
      return json(res, 200, { ok: true, paid: false });
    }

    const result = await applyTopupPaid(db, state, { orderId, payload, amount });

    return json(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error('midtrans webhook api error', err);
    return json(res, 500, { error: 'internal', details: err?.message || String(err) });
  }
};
