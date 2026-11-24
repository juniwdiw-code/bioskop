-- SEED DATA (data awal sesuai bawaan SistemBioskop.html)
-- Jalankan SETELAH schema.sql. Aman dijalankan berulang: data yang sudah ada tidak ditimpa.
--
-- CARA MENAMBAH : tambahkan baris baru pada VALUES di bawah, lalu jalankan ulang file ini.
-- CARA MENGHAPUS: hapus barisnya dari file ini, lalu hapus datanya di database lewat
--                 panel admin, atau lewat Neon SQL Editor, contoh:
--                 DELETE FROM films WHERE title = 'Joker';
-- MULAI DARI NOL: jalankan "npm run db:reset" (menghapus SEMUA data, termasuk penjualan).

-- Film: judul, genre, durasi (menit), audi (1-5), harga tiket (Rp)
INSERT INTO films (title, genre, duration, audi, price) VALUES
  ('Avengers', 'Action', 180, 4, 50000),
  ('The Conjuring', 'Horror', 112, 2, 50000),
  ('Toy Story', 'Animation', 100, 5, 50000),
  ('Inception', 'Sci-Fi', 148, 3, 50000),
  ('The Lion King', 'Animation', 88, 2, 50000),
  ('Joker', 'Crime', 122, 5, 50000)
ON CONFLICT (lower(title)) DO NOTHING;

-- Jadwal tayang: judul film, jam (audi mengikuti film)
INSERT INTO shows (film_id, show_time)
SELECT f.id, v.jam
FROM (VALUES
  ('Avengers', '13:00'),
  ('Avengers', '19:00'),
  ('The Conjuring', '16:00'),
  ('Toy Story', '13:00'),
  ('Inception', '19:00'),
  ('The Lion King', '13:00'),
  ('Joker', '19:00')
) AS v(judul, jam)
JOIN films f ON lower(f.title) = lower(v.judul)
ON CONFLICT (film_id, show_time) DO NOTHING;

-- Menu makanan & minuman: nama, harga (urutan baris = urutan tampil)
INSERT INTO menu_items (name, price) VALUES
  ('Popcorn', 20000),
  ('Minuman', 15000),
  ('Hotdog', 25000)
ON CONFLICT (lower(name)) DO NOTHING;

-- Paket bundling (pilihan "Tiket Saja" selalu tersedia otomatis)
INSERT INTO packages (name) VALUES
  ('Paket Popcorn'),
  ('Paket Minuman'),
  ('Paket Combo'),
  ('Paket Lengkap')
ON CONFLICT (lower(name)) DO NOTHING;

-- Isi paket: nama paket, nama menu
INSERT INTO package_items (package_id, menu_item_id)
SELECT p.id, m.id
FROM (VALUES
  ('Paket Popcorn', 'Popcorn'),
  ('Paket Minuman', 'Minuman'),
  ('Paket Combo', 'Popcorn'),
  ('Paket Combo', 'Minuman'),
  ('Paket Lengkap', 'Popcorn'),
  ('Paket Lengkap', 'Hotdog'),
  ('Paket Lengkap', 'Minuman')
) AS v(paket, menu)
JOIN packages p ON lower(p.name) = lower(v.paket)
JOIN menu_items m ON lower(m.name) = lower(v.menu)
ON CONFLICT DO NOTHING;

-- Kode promo: kode, jenis (p = persen, n = potongan rupiah), nilai, hari (-1 = setiap hari, 0 = Minggu ... 6 = Sabtu), aktif
INSERT INTO promos (code, kind, value, weekday, active) VALUES
  ('PELAJAR', 'p', 10, -1, true),
  ('SELASA', 'p', 15, 2, true)
ON CONFLICT (code) DO NOTHING;

-- PPN bertingkat: berlaku mulai harga per kursi (Rp), tarif (%)
INSERT INTO ppn_tiers (min_price, rate) VALUES
  (0, 2),
  (50000, 3),
  (75000, 4),
  (100000, 5)
ON CONFLICT (min_price) DO NOTHING;

-- Pengaturan harga: tambahan akhir pekan (%), tambahan jam malam (%), jam malam mulai
-- (bagian ini menimpa nilai yang tersimpan setiap kali seed dijalankan)
UPDATE settings SET weekend_pct = 20, night_pct = 10, night_start = '18:00' WHERE id = 1
