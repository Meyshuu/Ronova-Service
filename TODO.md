# TODO - Fitur Admin Konfirmasi Harga & Pembayaran

## Step 1
- Tambah UI di `index.html` pada section `admin-view`:
  - Input nominal harga final untuk order
  - Tombol “Konfirmasi harga & bayar via QRIS”
  - Area status (opsional)

## Step 2
- Update `script.js`:
  - Saat admin memilih order (Chat order / orderSelect), isi harga final input dengan default = `order.budget` atau kosong
  - Buat fungsi `adminConfirmPriceAndPayment(orderId)`:
    - Validasi input angka
    - Set `order.budget` (atau field final price)
    - Set `order.paymentStatus = 'Belum Dibayar'` atau langsung `Dibayar'` (mengikuti existing flow)
    - Jika ingin langsung buka QRIS: panggil `renderQrisPayment(order)` dengan amount = budget

## Step 3
- Update daftar order di `admin-view` (jika perlu):
  - Tampilkan badge `paymentStatus`
  - Hindari chat terkunci bila hanya pembayaran belum lunas

## Step 4
- Test manual:
  - Login admin -> pilih order -> input harga -> konfirmasi -> pastikan QRIS terbuka
  - Setelah owner approve -> status menjadi berhasil

## Step 5
- Commit & push ke GitHub

