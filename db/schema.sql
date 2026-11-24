-- Sistem Tiket Bioskop: skema database (PostgreSQL / Neon)
-- Aman dijalankan berulang kali (IF NOT EXISTS).

-- ===== DATA MASTER =====
CREATE TABLE IF NOT EXISTS films (
  id serial PRIMARY KEY,
  title text NOT NULL,
  genre text NOT NULL,
  duration integer NOT NULL CHECK (duration > 0),
  audi smallint NOT NULL CHECK (audi BETWEEN 1 AND 5),
  price integer NOT NULL CHECK (price > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS films_title_uq ON films (lower(title));

CREATE TABLE IF NOT EXISTS shows (
  id serial PRIMARY KEY,
  film_id integer NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  show_time text NOT NULL CHECK (show_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  UNIQUE (film_id, show_time)
);

CREATE TABLE IF NOT EXISTS menu_items (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price integer NOT NULL CHECK (price >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS menu_items_name_uq ON menu_items (lower(name));

CREATE TABLE IF NOT EXISTS packages (
  id serial PRIMARY KEY,
  name text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS packages_name_uq ON packages (lower(name));

CREATE TABLE IF NOT EXISTS package_items (
  package_id integer NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  menu_item_id integer NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  PRIMARY KEY (package_id, menu_item_id)
);

CREATE TABLE IF NOT EXISTS promos (
  code text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('p', 'n')),
  value double precision NOT NULL CHECK (value > 0),
  weekday smallint NOT NULL DEFAULT -1 CHECK (weekday BETWEEN -1 AND 6),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS ppn_tiers (
  min_price integer PRIMARY KEY CHECK (min_price >= 0),
  rate double precision NOT NULL CHECK (rate BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  weekend_pct double precision NOT NULL DEFAULT 20 CHECK (weekend_pct BETWEEN 0 AND 200),
  night_pct double precision NOT NULL DEFAULT 10 CHECK (night_pct BETWEEN 0 AND 200),
  night_start text NOT NULL DEFAULT '18:00' CHECK (night_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  rev integer NOT NULL DEFAULT 0
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ===== TRANSAKSI =====
CREATE TABLE IF NOT EXISTS orders (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'lunas', 'batal', 'refund')),
  customer_name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('Kasir', 'Aplikasi')),
  show_id integer REFERENCES shows(id) ON DELETE SET NULL,
  show_date date NOT NULL,
  film_title text NOT NULL,
  audi smallint NOT NULL,
  show_time text NOT NULL,
  seat_count integer NOT NULL CHECK (seat_count BETWEEN 1 AND 10),
  seats text[] NOT NULL,
  package_name text NOT NULL,
  items text[] NOT NULL DEFAULT '{}',
  subtotal integer NOT NULL,
  discount integer NOT NULL DEFAULT 0,
  promo_code text NOT NULL DEFAULT '',
  ticket_amount integer NOT NULL,
  food_amount integer NOT NULL,
  ppn integer NOT NULL,
  ppn_rate double precision NOT NULL,
  total integer NOT NULL,
  method text NOT NULL,
  paid_amount integer,
  change_amount integer,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  queue_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz
);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at);
CREATE INDEX IF NOT EXISTS orders_paid_idx ON orders (paid_at) WHERE paid_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS seat_locks (
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  show_id integer NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  show_date date NOT NULL,
  seat_no text NOT NULL CHECK (seat_no ~ '^[A-H]([1-9]|1[0-2])$'),
  PRIMARY KEY (show_id, show_date, seat_no)
);
CREATE INDEX IF NOT EXISTS seat_locks_order_idx ON seat_locks (order_id);

CREATE TABLE IF NOT EXISTS food_sales (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  customer_name text NOT NULL DEFAULT 'Konter',
  item_count integer NOT NULL,
  subtotal integer NOT NULL,
  ppn integer NOT NULL,
  ppn_rate double precision NOT NULL,
  total integer NOT NULL,
  method text NOT NULL,
  paid_amount integer NOT NULL,
  change_amount integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS food_sale_items (
  id serial PRIMARY KEY,
  food_sale_id integer NOT NULL REFERENCES food_sales(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price integer NOT NULL
);

-- ===== KEAMANAN LOGIN =====
CREATE TABLE IF NOT EXISTS login_attempts (
  id serial PRIMARY KEY,
  ip text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts (ip, at)
