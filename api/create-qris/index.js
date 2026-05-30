import admin from 'firebase-admin';
import QRCode from 'qrcode';

function initFirebase() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

async function updateOrderInState(orderId, updater) {
  const db = initFirebase();
  const docRef = db.doc('appState/web-joki');
  const snap = await docRef.get();
  if (!snap.exists) throw new Error('App state not found');
  const state = snap.data() || {};
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) throw new Error('Order not found');
  const updated = updater(orders[idx]) || orders[idx];
  orders[idx] = updated;
  await docRef.set({ ...state, orders });
  return updated;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { orderId, amount, description } = req.body || {};
  if (!orderId || !amount) return res.status(400).json({ error: 'orderId and amount required' });

  const merchant = process.env.QRIS_MERCHANT_NAME || 'WebJoki';
  const account = process.env.QRIS_MERCHANT_ACCOUNT || '0000000000';
  const payload = `QRIS|${merchant}|${account}|${orderId}|${amount}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(payload);

    try {
      await updateOrderInState(orderId, (o) => ({
        ...o,
        paymentStatus: 'Menunggu Pembayaran',
        paymentRequest: { payload, amount, description, createdAt: new Date().toISOString() }
      }));
    } catch (e) {
      console.warn('Could not update order in state:', e.message);
    }

    return res.json({ qrcode: qrDataUrl, payload, payUrl: `/qrcode/${orderId}` });
  } catch (err) {
    console.error('create-qris error', err);
    return res.status(500).json({ error: 'failed to generate qrcode' });
  }
}

