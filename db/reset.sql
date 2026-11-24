-- PERINGATAN: menghapus SEMUA tabel dan SEMUA datanya (termasuk riwayat penjualan).
-- Dipakai oleh "npm run db:reset", lalu schema.sql dan seed.sql dijalankan lagi.
DROP TABLE IF EXISTS login_attempts CASCADE;
DROP TABLE IF EXISTS food_sale_items CASCADE;
DROP TABLE IF EXISTS food_sales CASCADE;
DROP TABLE IF EXISTS seat_locks CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS package_items CASCADE;
DROP TABLE IF EXISTS packages CASCADE;
DROP TABLE IF EXISTS menu_items CASCADE;
DROP TABLE IF EXISTS promos CASCADE;
DROP TABLE IF EXISTS ppn_tiers CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS shows CASCADE;
DROP TABLE IF EXISTS films CASCADE
