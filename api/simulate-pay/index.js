const admin = require('firebase-admin');

function initFirebase() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

function safeJson(res, status, payload) {
  try {
    res.status(status).setHeader('Content-Type', 'application/json');
  } catch {
    // ignore
  }
  return res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return safeJson(res, 405, { error: 'Method Not Allowed' });
  const { orderId } = req.body || {};
  if (!orderId) return safeJson(res, 400, { error: 'Missing orderId' });

  // In Vercel runtime, missing Google/Firebase project id will throw.
  // For demo purposes, we fallback to a no-op success response.
  let db;
  try {
    db = initFirebase();
  } catch (err) {
    return safeJson(res, 200, { ok: true, simulated: true, note: 'Firebase not configured; skipping state update' });
  }

  try {
    const docRef = db.doc('appState/web-joki');
    const snap = await docRef.get();
    if (!snap.exists) return safeJson(res, 404, { error: 'App state not found' });

    const state = snap.data() || {};
    const orders = Array.isArray(state.orders) ? state.orders : [];
    const idxOrder = orders.findIndex((o) => o.id === orderId);

    // 1) try update order
    if (idxOrder !== -1) {
      orders[idxOrder] = {
        ...orders[idxOrder],
        paymentStatus: 'Dibayar',
        paidAt: new Date().toISOString(),
      paymentMethod: 'MIDTRANS'
    };

      await docRef.set({ ...state, orders });
      return res.json({ ok: true, order: orders[idxOrder] });
    }

    // 2) try topUps
    const topUps = Array.isArray(state.topUps) ? state.topUps : [];
    const tIdx = topUps.findIndex((t) => t.id === orderId);
    if (tIdx === -1) {
      return res.json({ ok: true, skipped: true, reason: 'Not found in orders/topUps' });
    }

    const topUp = topUps[tIdx];
    const alreadyApplied = topUp.status === 'paid' && topUp.applied === true;

    topUps[tIdx] = {
      ...topUp,
      status: 'paid',
      provider: 'MIDTRANS_SIM',
      raw: { simulated: true },
      applied: true,
      paidAt: new Date().toISOString()
    };

    const users = Array.isArray(state.users) ? state.users : [];
    const uIdx = users.findIndex((u) => u.id === topUp.userId);
    if (uIdx !== -1 && !alreadyApplied) {
      const add = Number(topUp.amount || 0);
      users[uIdx] = { ...users[uIdx], balance: Number(users[uIdx].balance || 0) + add };
    }

    await docRef.set({ ...state, users, topUps });
    return res.json({ ok: true, topUp: topUps[tIdx], applied: true });
  } catch (err) {
    return safeJson(res, 200, { ok: true, simulated: true, note: 'Firebase state update failed; skipping', error: err?.message || String(err) });
  }
}



