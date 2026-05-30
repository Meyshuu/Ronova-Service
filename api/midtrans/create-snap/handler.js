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

function jsonError(res, status, payload) {
  try {
    res.status(status).setHeader('Content-Type', 'application/json');
  } catch {
    // ignore
  }
  return res.status(status).json(payload);
}

async function createSnapHandler(req, res) {
  // Always respond JSON (important for client parsing)
  try {
    res.setHeader('Content-Type', 'application/json');
  } catch {
    // ignore
  }

  try {
    if (req.method !== 'POST') {
      return jsonError(res, 405, { error: 'Method Not Allowed' });
    }

    const body = req.body || {};
    const { orderId, amount } = body;

    if (!orderId || !amount) {
      return jsonError(res, 400, {
        error: 'orderId and amount required',
        received: body
      });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return jsonError(res, 400, {
        error: 'amount must be a positive number',
        amount
      });
    }

    // Midtrans sandbox mode (default)
    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';

    const useSandbox = String(process.env.MIDTRANS_USE_SANDBOX || 'true').toLowerCase() === 'true';
    const midtransBaseUrl = useSandbox
      ? 'https://app.sandbox.midtrans.com'
      : 'https://app.midtrans.com';

    // Demo fallback if MIDTRANS_SERVER_KEY is missing
    if (!serverKey) {
      return res.json({ snapToken: `DEMO_${orderId}` });
    }


    const payload = {
      transaction_details: {
        order_id: String(orderId),
        gross_amount: numericAmount
      },
      credit_card: { secure: true },
      customer_details: {
        first_name: 'Customer',
        email: 'customer@example.com'
      }
    };

    const auth = Buffer.from(`${serverKey}:`).toString('base64');

    let snapRes;
    try {
      snapRes = await fetch(`${midtransBaseUrl}/snap/v1/transactions`, {

        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`
        },
        body: JSON.stringify(payload)
      });
    } catch (fetchErr) {
      return jsonError(res, 502, {
        error: 'midtrans request failed',
        details: fetchErr?.message || String(fetchErr)
      });
    }

    const rawText = await snapRes.text();

    let data = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      // Return JSON even if Midtrans body isn't JSON.
      return jsonError(res, 500, {
        error: 'Failed to create midtrans snap (non-JSON response)',
        status: snapRes.status,
        raw: rawText.slice(0, 1000)
      });
    }

    // Midtrans sometimes returns JSON but without token on error.
    if (!data || !data.token) {
      return jsonError(res, 500, {
        error: 'Failed to create midtrans snap (missing token)',
        status: snapRes.status,
        raw: rawText.slice(0, 1000),
        midtrans: data
      });
    }

    return res.json({ snapToken: data.token, status: snapRes.status });
  } catch (err) {
    // Last resort: ensure JSON
    console.error('midtrans create-snap error (unhandled)', err);
    return jsonError(res, 500, {
      error: 'midtrans create-snap failed (unhandled)',
      details: err?.message || String(err)
    });
  }
}

module.exports = { createSnapHandler };



