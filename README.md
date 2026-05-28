# Ronova-Service

Demo Website Joki Neverness to Everness.

Fitur utama:
- homepage berisi card layanan
- detail layanan dengan form pesanan, chat customer, dan simulasi pembayaran
- login user/admin/owner
- dashboard pengguna (saldo, status order)
- admin panel untuk monitoring order dan permintaan penyelesaian
- owner panel untuk manajemen dan trash order
- penyimpanan lokal dan Firestore realtime sync
- backend QRIS lokal dan webhook pembayaran

## Cara menjalankan lokal

1. Jalankan server statis untuk frontend:

```bash
cd d:/test2
python -m http.server 8000
```

2. Jalankan server QRIS lokal:

```bash
cd d:/test2/server
npm install
node index.js
```

3. Buka frontend di browser:

```bash
http://localhost:8000
```

## Deploy fungsi Firebase

Repo ini sudah memiliki GitHub Actions di `.github/workflows/firebase-deploy.yml`.
Untuk auto deploy setiap kali push ke `main`, tambahkan secret GitHub berikut di repo settings:

- `FIREBASE_TOKEN`: token Firebase CLI yang dihasilkan lewat `firebase login:ci`

Jika ingin deploy manual:

```bash
cd d:/test2/functions
npm install
npx firebase-tools deploy --only functions --project web-joki-216fc
```

## Pengaturan webhook

Webhook server dapat memverifikasi payload dengan `WEBHOOK_SECRET`.
Atur `WEBHOOK_SECRET` di `.env` pada server lokal atau sebagai secret runtime pada fungsi jika dideploy.

## Catatan keamanan

- Jangan commit `server/serviceAccount.json` ke repo.
- File `server/serviceAccount.json` diabaikan oleh `.gitignore`.
- Jika Anda ingin menambahkan Firebase Auth, sesuaikan rules Firestore.
