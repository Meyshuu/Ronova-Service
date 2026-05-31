const admin = require('firebase-admin');

function initFirebase() {
  if (!admin.apps.length) {
    // In Vercel functions we may not have GOOGLE_APPLICATION_CREDENTIALS configured.
    // Use default credential initialization.
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

function normalizeStatus(payload) {
  const candidates = [
    payload?.transaction_status,
    payload?.transactionStatus,
    payload?.status_code,
    payload?.status,
    payload?.payment_status,
    payload?.fraud_status,
    payload?.transaction_status,
  ];

  const combined = candidates
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v).toLowerCase())
    .join(' ');

  const paid = /capture|settlement|paid|success/.test(combined);
  return { paid, combined };
}

async function applyTopupPaid(db, appState, { orderId, payload, amount }) {
  const state = appState || {};
  const topUps = Array.isArray(state.topUps) ? state.topUps : [];

  const idx = topUps.findIndex((t) => String(t.id) === String(orderId));
  if (idx === -1) {
    // Keep minimal debug to confirm this endpoint runs.
    try {
      await db.doc('appState/web-joki').set(
        {
          __midtransDebug: {
            action: 'topup_not_found',
            orderId: String(orderId),
            topUpsCount: topUps.length,
            sampleTopUpIds: topUps.slice(0, 5).map((t) => t?.id),
            transaction_status: payload?.transaction_status,
          },
        },
        { merge: true }
      );
    } catch {}

    return { applied: false, reason: 'topup not found' };
  }

  const topUp = topUps[idx];
  const alreadyApplied = topUp.status === 'paid' && topUp.applied === true;

  topUps[idx] = {
    ...topUp,
    status: 'paid',
    provider: 'MIDTRANS',
    raw: payload,
    applied: true,
    paidAt: new Date().toISOString(),
  };

  if (!alreadyApplied) {
    const users = Array.isArray(state.users) ? state.users : [];
    const uIdx = users.findIndex((u) => String(u.id) === String(topUp.userId));

    if (uIdx !== -1) {
      const add = Number(amount ?? topUp.amount ?? 0);
      users[uIdx] = { ...users[uIdx], balance: Number(users[uIdx].balance || 0) + add };
      await db.doc('appState/web-joki').set({ ...state, users, topUps });
    } else {
      // Do not add saldo if user can't be mapped.
      await db.doc('appState/web-joki').set({ ...state, topUps });
    }
  } else {
    await db.doc('appState/web-joki').set({ ...state, topUps });
  }

  return { applied: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });

  let db;
  try {
    db = initFirebase();
  } catch (e) {
    return json(res, 500, { error: 'Firebase init failed', details: e?.message || String(e) });
  }

  try {
    const payload = req.body || {};

    const orderId =
      payload.order_id ||
      payload.orderId ||
      payload.transaction_id ||
      payload.transactionId ||
      payload.transaction_details?.order_id ||
      payload.transaction_details?.orderId;

    // Always ping Firestore so we know this endpoint is being hit
    try {
      await db.doc('appState/midtransPingLast').set(
        {
          at: new Date().toISOString(),
          orderId: orderId ? String(orderId) : null,
          transaction_status: payload?.transaction_status ?? payload?.transactionStatus ?? null,
          payment_status: payload?.payment_status ?? null,
          status_code: payload?.status_code ?? null,
        },
        { merge: true }
      );
    } catch {}


    if (!orderId) {
      return json(res, 400, { error: 'Missing order_id/transaction/orderId' });
    }

    const { paid } = normalizeStatus(payload);

    const snap = await db.doc('appState/web-joki').get();
    if (!snap.exists) return json(res, 404, { error: 'App state not found' });

    const state = snap.data() || {};

    if (!paid) {
      return json(res, 200, { ok: true, paid: false });
    }

    const amount =
      payload.gross_amount ??
      payload.grossAmount ??
      payload.amount ??
      payload.transaction_details?.gross_amount ??
      payload.transaction_details?.grossAmount;

    const result = await applyTopupPaid(db, state, { orderId, payload, amount });
    return json(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error('midtrans notification api error', err);
    return json(res, 500, { error: 'internal', details: err?.message || String(err) });
  }
};

