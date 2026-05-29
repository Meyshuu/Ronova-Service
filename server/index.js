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

// Midtrans Snap create payment (returns snapToken)
// Note: This implementation focuses on updating order status via webhook.
// You still need to configure Midtrans server URL/webhook URL in Midtrans console.
app.post('/midtrans/create-snap', async (req, res) => {
  const { orderId, amount, description } = req.body || {};
  if (!orderId || !amount) return res.status(400).json({ error: 'orderId and amount required' });

  try {
    // Midtrans SDK is not included in this repo; implement minimal token request via REST.
    // You can later replace this with official midtrans-node client.
    const fetch = global.fetch || (await import('node-fetch')).default;

    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
    if (!serverKey) {
      // Fallback token for local demo
      return res.json({ snapToken: `DEMO_${orderId}`, redirectUrl: null });
    }

    // Basic snap request
    const payload = {
      transaction_details: {
        order_id: orderId,
        gross_amount: amount
      },
      credit_card: { secure: true },
      customer_details: {
        // optional; you can enrich from order payload
        first_name: 'Customer',
        email: 'customer@example.com'
      },
      // webhook callback will be configured in Midtrans console
      // for now, snapToken will be enough
      // item_details: [ ... ]
    };

    const auth = Buffer.from(`${serverKey}:`).toString('base64');
    const snapRes = await fetch('https://app.midtrans.com/snap/v1/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: JSON.stringify(payload)
    });

    const data = await snapRes.json();
    if (!data || !data.token) {
      return res.status(500).json({ error: 'Failed to create midtrans snap' });
    }

    return res.json({ snapToken: data.token });
  } catch (err) {
    console.error('midtrans create-snap error', err);
    return res.status(500).json({ error: 'midtrans create-snap failed' });
  }
});

// legacy QRIS endpoint kept for backward compatibility
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
// Midtrans webhook endpoint
// Expecting payload that includes:
// - order_id (preferred)
// - transaction_status or transaction_status-like field
// This endpoint will map to order.paymentStatus.
app.post('/midtrans/webhook', async (req, res) => {
  const payload = req.body || {};

  const orderId = payload.order_id || payload.orderId;
  const txStatus = payload.transaction_status || payload.status_code || payload.transactionStatus;
  if (!orderId) return res.status(400).json({ error: 'Missing order_id' });

  try {
    const success = ['capture', 'settlement', 'paid', 'success'].includes(String(txStatus || '').toLowerCase());

    await updateOrderInState(orderId, (o) => {
      if (success) {
        return {
          ...o,
          paymentStatus: 'Dibayar',
          paidAt: new Date().toISOString(),
          paymentMethod: 'MIDTRANS',
          paymentInfo: payload
        };
      }
      return { ...o, paymentStatus: 'Belum Dibayar' };
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('midtrans webhook error', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// legacy webhook endpoint for QRIS
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
