# Tiket Bioskop (Vercel + Neon)

Tampilan satu halaman (`public/index.html`) dengan API serverless di Vercel (`api/`) dan database
PostgreSQL di Neon. Semua data (film, jadwal, kursi terisi, pesanan, penjualan, promo, PPN, menu, paket)
tersimpan di database, sehingga bisa dipakai bersama oleh banyak perangkat (pelanggan, kasir, admin).

## Struktur

```
api/
  login.js      POST  login PIN admin / kasir -> token sesi
  state.js      GET   data terbaru (dipolling tampilan tiap 3 detik)
  act.js        POST  semua aksi: pesan, bayar, refund, kelola film/jadwal/menu/promo/pengaturan
lib/
  db.js         koneksi Neon
  auth.js       token sesi (HMAC) dan pengecekan PIN
  pricing.js    perhitungan harga, diskon, PPN (dihitung di server)
  state.js      menyusun data untuk tampilan, pembatalan otomatis pesanan > 15 menit
  actions.js    daftar aksi dan aturan akses
db/
  schema.sql    struktur tabel
  seed.sql      data awal (bisa diedit)
  reset.sql     hapus semua tabel (untuk mulai dari nol)
scripts/run-sql.js   menjalankan file .sql dari terminal
public/index.html    tampilan
```

## 1. Siapkan database Neon

1. Buat project di <https://neon.tech>. Pilih region **Singapore** (terdekat dengan Indonesia).
2. Salin *connection string* (tombol **Connect**) untuk `DATABASE_URL`.
3. Buat tabel dan isi data awal, pilih salah satu:
   - **Lewat Neon SQL Editor:** buka `db/schema.sql`, salin isinya, Run. Lalu lakukan hal yang sama untuk `db/seed.sql`.
   - **Lewat terminal:** `npm install`, salin `.env.example` ke `.env`, isi `DATABASE_URL`, lalu `npm run db:setup`.

## 2. Unggah ke GitHub

```bash
git init
git add .
git commit -m "Tiket bioskop"
git branch -M main
git remote add origin https://github.com/USERNAME/tiket-bioskop.git
git push -u origin main
```

File `.env` sudah masuk `.gitignore`, jadi PIN dan password database tidak ikut terunggah.

## 3. Deploy ke Vercel

1. Vercel > **Add New Project** > pilih repository tadi. Framework preset: **Other** (tanpa build command).
2. Isi **Environment Variables** (lihat `.env.example`): `DATABASE_URL`, `ADMIN_PIN`, `KASIR_PIN`, `AUTH_SECRET`, `APP_TIMEZONE`.
3. **Deploy**. Mengubah env var di kemudian hari butuh **Redeploy** agar berlaku.

Alamat akses:

| Siapa | Alamat |
|---|---|
| Pelanggan | `https://domain-anda.vercel.app/` |
| Kasir | `https://domain-anda.vercel.app/#kasir` (atau tombol "Tiket" di bawah halaman awal) |
| Admin | `https://domain-anda.vercel.app/#admin` (atau tombol "Bioskop" di bawah halaman awal) |

## Mengubah / menambah / menghapus data awal

- **Dari aplikasi:** film, jadwal, harga, menu, paket, promo, PPN, dan pengaturan bisa diubah di panel admin.
- **Dari seed:** edit `db/seed.sql`, lalu jalankan ulang (`npm run db:seed` atau salin ke Neon SQL Editor).
  Seed hanya menambah data yang belum ada; data yang sudah ada tidak ditimpa.
- **Menghapus data tertentu:** pakai panel admin, atau SQL, misalnya `DELETE FROM films WHERE title = 'Joker';`
- **Mulai dari nol:** `npm run db:reset` (menghapus semua tabel dan seluruh riwayat penjualan, lalu mengisi ulang dari seed).

## Catatan keamanan

- PIN hanya ada di environment variable server; tidak lagi tertulis di kode tampilan.
- Percobaan PIN salah dibatasi 5 kali per 10 menit per alamat IP. Gunakan PIN 6 digit atau lebih.
- Harga, diskon, dan PPN dihitung ulang di server saat pesanan dibuat, bukan dipercaya dari browser.
- Kursi dikunci di database (satu kursi tidak bisa dipesan dua orang, walaupun dibayar bersamaan).

## Pemecahan masalah

- Daftar film kosong / error: buka `https://domain-anda.vercel.app/api/state` dan lihat pesan di log
  Vercel (**Deployments > Functions / Logs**). Penyebab umum: `DATABASE_URL` salah atau `schema.sql` belum dijalankan.
- "PIN belum diatur": env var `ADMIN_PIN` / `KASIR_PIN` belum diisi, atau belum Redeploy.
- Pengembangan lokal: `npm install -g vercel`, lalu `npm run dev`.
