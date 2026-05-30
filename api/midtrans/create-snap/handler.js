const admin = require('firebase-admin');

// NOTE: For Vercel runtime, we use Fetch API and environment vars.
// Ensure you set MIDTRANS_SERVER_KEY and (optionally) Firebase service credentials.

function initFirebase() {
  if (!admin.apps.length) {
    try {
      admin.initializeApp();
    } catch {
      admin.initializeApp();
    }
  }
  return admin.firestore();
}

async function createSnapHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { orderId, amount } = req.body || {};
  if (!orderId || !amount) return res.status(400).json({ error: 'orderId and amount required' });

  // Demo fallback if MIDTRANS_SERVER_KEY is missing
  const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
  if (!serverKey) {
    return res.json({ snapToken: `DEMO_${orderId}` });
  }

  const payload = {
    transaction_details: {
      order_id: orderId,
      gross_amount: amount
    },
    credit_card: { secure: true },
    customer_details: {
      first_name: 'Customer',
      email: 'customer@example.com'
    }
  };

  const auth = Buffer.from(`${serverKey}:`).toString('base64');

  try {
    const snapRes = await fetch('https://app.midtrans.com/snap/v1/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`
      },
      body: JSON.stringify(payload)
    });

    const rawText = await snapRes.text();
    let data = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      // Return JSON even if Midtrans body isn't JSON.
      return res.status(500).json({
        error: 'Failed to create midtrans snap (non-JSON response)',
        status: snapRes.status,
        raw: rawText.slice(0, 1000)
      });
    }

    // Midtrans sometimes returns JSON but without token on error.
    if (!data || !data.token) {
      return res.status(500).json({
        error: 'Failed to create midtrans snap (missing token)',
        status: snapRes.status,
        raw: rawText.slice(0, 1000),
        midtrans: data
      });
    }

    return res.json({ snapToken: data.token, status: snapRes.status });
  } catch (err) {
    console.error('midtrans create-snap error', err);
    return res.status(500).json({ error: 'midtrans create-snap failed' });
  }
}

module.exports = { createSnapHandler };


