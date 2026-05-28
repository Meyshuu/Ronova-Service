Web Joki local QRIS server

Features
- Generate a simple QRIS payload and return a QR code image
- Webhook endpoint to mark orders as paid in Firestore
- Simulation endpoint to test marking payments

Setup

1. Copy your Firebase service account JSON to `server/serviceAccount.json` (already added if you provided it).
2. Create `.env` based on `.env.example` if you want to override defaults.

Install & run

```bash
cd server
npm install
node index.js
```

Endpoints
- `POST /create-qris` { orderId, amount, description } -> { qrcode, payload, payUrl }
- `POST /webhook` { orderId, status, ... } -> marks order paid when status is `PAID|SUCCESS` or payload.paid = true
- Signature: if you set `WEBHOOK_SECRET` in `.env`, include header `x-webhook-signature` with HMAC-SHA256 of the JSON body using the secret.

Example webhook test (with secret):

```bash
SECRET=your-secret
BODY='{"orderId":"ORD-001","status":"PAID","paid":true}'
SIG=$(printf "%s" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
curl -X POST http://localhost:3000/webhook -H "Content-Type: application/json" -H "x-webhook-signature: $SIG" -d "$BODY"
```
- `POST /simulate-pay` { orderId } -> directly marks order as paid (test only)
- `GET /qrcode/:orderId` -> HTML page showing QR image

Security
- In production verify incoming webhook signatures and restrict access.+- Use `WEBHOOK_SECRET` to protect the `/webhook` endpoint from unauthorized requests.