require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const qrcode = require('qrcode');
const admin = require('firebase-admin');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const SERVICE_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(__dirname, 'serviceAccount.json');
let serviceAccount = null;
if (fs.existsSync(SERVICE_PATH)) {
  serviceAccount = require(SERVICE_PATH);
}

if (!admin.apps.length) {
  if (serviceAccount) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('Initialized firebase-admin with service account');
  } else {
    admin.initializeApp();
    console.log('Initialized firebase-admin with default credentials');
  }
}

const db = admin.firestore();

async function updateOrderInState(orderId, updater) {
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

// Create a simple QRIS payload and return a QR code image (data URL)
app.post('/create-qris', async (req, res) => {
  const { orderId, amount, description } = req.body || {};
  if (!orderId || !amount) return res.status(400).json({ error: 'orderId and amount required' });

  const merchant = process.env.QRIS_MERCHANT_NAME || 'WebJoki';
  const account = process.env.QRIS_MERCHANT_ACCOUNT || '0000000000';
  const payload = `QRIS|${merchant}|${account}|${orderId}|${amount}`;

  try {
    const qrDataUrl = await qrcode.toDataURL(payload);
    // update order with payment request info
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
});

// Webhook endpoint for payment provider to notify of completed payments
app.post('/webhook', async (req, res) => {
  const payload = req.body || {};
  const { orderId, status } = payload;
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

  // Optional simple secret verification
  if (process.env.WEBHOOK_SECRET) {
    const sig = req.headers['x-webhook-signature'];
    if (!sig) return res.status(401).json({ error: 'Missing signature' });
    const secret = process.env.WEBHOOK_SECRET;
    const computed = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    if (sig !== computed) return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const success = status === 'PAID' || status === 'SUCCESS' || payload.paid === true;
    await updateOrderInState(orderId, (o) => {
      if (success) {
        return {
          ...o,
          paymentStatus: 'Dibayar',
          paidAt: new Date().toISOString(),
          paymentMethod: payload.provider || 'QRIS',
          paymentInfo: payload
        };
      }
      return { ...o, paymentStatus: 'Belum Dibayar' };
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('webhook error', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// Simulate payment (for local testing) — directly mark an order as paid
app.post('/simulate-pay', async (req, res) => {
  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
  try {
    const updated = await updateOrderInState(orderId, (o) => ({
      ...o,
      paymentStatus: 'Dibayar',
      paidAt: new Date().toISOString(),
      paymentMethod: 'SIMULATED'
    }));
    return res.json({ ok: true, order: updated });
  } catch (err) {
    console.error('simulate-pay error', err);
    return res.status(500).json({ error: err.message });
  }
});

// Simple view to display stored QR code for an order
app.get('/qrcode/:orderId', async (req, res) => {
  const orderId = req.params.orderId;
  try {
    const doc = await db.doc('appState/web-joki').get();
    if (!doc.exists) return res.status(404).send('App state not found');
    const state = doc.data() || {};
    const order = (state.orders || []).find((o) => o.id === orderId);
    if (!order || !order.paymentRequest) return res.status(404).send('QR not found');
    const qr = await qrcode.toDataURL(order.paymentRequest.payload);
    return res.send(`<html><body><img src="${qr}" alt="QRIS"/><p>Pay ${order.paymentRequest.amount}</p></body></html>`);
  } catch (err) {
    console.error('qrcode view error', err);
    return res.status(500).send('internal');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web Joki QRIS server running on port ${PORT}`));
