const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });
const crypto = require('crypto');

// Initialize admin SDK (when deployed on Firebase this uses default creds)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Generic payment webhook handler.
 * Expecting POST JSON payload from payment gateway:
 * { orderId, amount, provider, status, ... }
 * For production you MUST verify provider signature / secret.
 */
exports.paymentWebhook = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const payload = req.body || {};
    const { orderId, amount, provider, status } = payload;

    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    // Optional HMAC-SHA256 signature verification using WEBHOOK_SECRET env var
    if (process.env.WEBHOOK_SECRET) {
      const sig = req.headers['x-webhook-signature'];
      if (!sig) return res.status(401).json({ error: 'Missing signature' });
      const computed = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET).update(JSON.stringify(payload)).digest('hex');
      if (sig !== computed) return res.status(401).json({ error: 'Invalid signature' });
    }

    try {
      const docRef = db.doc('appState/web-joki');
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'App state not found' });
      }

      const state = snap.data() || {};
      const orders = Array.isArray(state.orders) ? state.orders : [];
      const idx = orders.findIndex((o) => o.id === orderId);
      if (idx === -1) return res.status(404).json({ error: 'Order not found' });

      // Basic success mapping: adapt to your provider's status values
      const success = status === 'SUCCESS' || status === 'PAID' || payload.paid === true;

      if (success) {
        orders[idx].paymentStatus = 'Dibayar';
        orders[idx].paymentMethod = provider || 'QRIS';
        orders[idx].paidAt = new Date().toISOString();
        orders[idx].paymentInfo = { amount, provider, raw: payload };
      } else {
        orders[idx].paymentStatus = 'Belum Dibayar';
      }

      await docRef.set({ ...state, orders });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Webhook handler error:', err);
      return res.status(500).json({ error: 'internal' });
    }
  });
});
