import { sql } from './db.js';

// Membatalkan pesanan yang tidak dibayar dalam 15 menit dan melepas kursinya.
// Sekaligus mengembalikan nomor revisi data (naik setiap ada perubahan).
export async function housekeep() {
  const r = await sql`
    WITH e AS (
      UPDATE orders SET status = 'batal', cancel_reason = 'kedaluwarsa'
      WHERE status = 'menunggu' AND created_at < now() - interval '15 minutes'
      RETURNING id
    ), d AS (
      DELETE FROM seat_locks WHERE order_id IN (SELECT id FROM e)
    ), s AS (
      UPDATE settings SET rev = rev + 1 WHERE id = 1 AND EXISTS (SELECT 1 FROM e) RETURNING rev
    )
    SELECT COALESCE((SELECT rev FROM s), (SELECT rev FROM settings WHERE id = 1)) AS rev`;
  if (!r[0] || r[0].rev === null) throw new Error('Tabel belum dibuat. Jalankan db/schema.sql dan db/seed.sql dahulu.');
  return r[0].rev;
}

export const bump = () => sql`UPDATE settings SET rev = rev + 1 WHERE id = 1`;

const ms = (d) => (d ? new Date(d).getTime() : 0);

const base = (r) => ({
  k: r.code, n: r.customer_name, ks: r.seats.join(', '), f: r.film_title, a: r.audi - 1, j: r.show_time,
  q: r.seat_count, amt: r.total, sb: r.subtotal, ds: r.discount, pk: r.promo_code, tk: r.ticket_amount,
  fd: r.food_amount, sid: r.show_id || 0, td: r.td, it: r.items, px: r.ppn, pr: r.ppn_rate,
  tp: r.package_name, ch: r.channel, m: r.method,
});

export const orderOut = (r) => ({
  ...base(r),
  st: r.status === 'refund' ? 'lunas' : r.status,
  t: ms(r.created_at),
  qs: ms(r.queue_at) || undefined,
  pt: ms(r.paid_at) || undefined,
  why: r.cancel_reason || undefined,
});

export const saleOut = (r) => ({
  ...base(r),
  by: r.paid_amount ?? r.total,
  kb: r.change_amount ?? 0,
  t: ms(r.paid_at),
  rf: r.status === 'refund' || undefined,
  rt: ms(r.refunded_at) || undefined,
});

export async function buildState(role, { k, rev } = {}) {
  const staff = role === 'kasir' || role === 'admin';
  const revision = rev ?? (await housekeep());

  const [films, shows, locks, menu, paket, tiers, set] = await Promise.all([
    sql`SELECT title AS j, genre AS g, duration AS d, audi, price AS h FROM films ORDER BY id`,
    sql`SELECT s.id, f.title AS f, f.audi, s.show_time AS j FROM shows s JOIN films f ON f.id = s.film_id ORDER BY s.id`,
    sql`SELECT show_id, to_char(show_date, 'YYYY-MM-DD') AS td, seat_no FROM seat_locks WHERE show_date >= current_date - 1`,
    sql`SELECT name AS n, price AS h FROM menu_items ORDER BY id`,
    sql`SELECT p.name AS n, COALESCE(array_agg(m.name ORDER BY m.id) FILTER (WHERE m.id IS NOT NULL), '{}'::text[]) AS i
        FROM packages p
        LEFT JOIN package_items pi ON pi.package_id = p.id
        LEFT JOIN menu_items m ON m.id = pi.menu_item_id
        GROUP BY p.id ORDER BY p.id`,
    sql`SELECT min_price AS m, rate AS r FROM ppn_tiers ORDER BY min_price`,
    sql`SELECT weekend_pct AS wk, night_pct AS ml, night_start AS jm FROM settings WHERE id = 1`,
  ]);

  const taken = {};
  for (const l of locks) (taken[`${l.show_id}|${l.td}`] ||= []).push(l.seat_no);

  const out = {
    rev: revision,
    films: films.map(({ audi, ...f }) => ({ ...f, a: audi - 1 })),
    shows: shows.map((s) => ({ id: s.id, f: s.f, a: s.audi - 1, j: s.j })),
    taken,
    menu,
    paket,
    cfg: { ppn: tiers, wk: set[0].wk, ml: set[0].ml, jm: set[0].jm },
    promo: [],
    orders: [],
    sales: [],
    fsales: [],
  };

  if (staff) {
    const [promos, rows, fs, fi] = await Promise.all([
      sql`SELECT code AS c, kind AS t, value AS v, weekday AS h, active AS "on" FROM promos ORDER BY code`,
      sql`SELECT o.*, to_char(o.show_date, 'YYYY-MM-DD') AS td FROM orders o
          WHERE o.status IN ('lunas', 'refund', 'menunggu') OR o.created_at > now() - interval '24 hours'
          ORDER BY COALESCE(o.paid_at, o.created_at)`,
      sql`SELECT * FROM food_sales ORDER BY created_at, id`,
      sql`SELECT food_sale_id, item_name, qty, unit_price FROM food_sale_items ORDER BY id`,
    ]);
    out.promo = promos;
    out.orders = rows
      .filter((r) => r.status === 'menunggu' || ms(r.paid_at || r.created_at) > Date.now() - 864e5)
      .map(orderOut);
    out.sales = rows.filter((r) => r.status === 'lunas' || r.status === 'refund').map(saleOut);
    const byFs = {};
    for (const i of fi) (byFs[i.food_sale_id] ||= []).push({ n: i.item_name, q: i.qty, h: i.unit_price });
    out.fsales = fs.map((r) => ({
      n: r.customer_name, t: ms(r.created_at), it: byFs[r.id] || [], q: r.item_count, sb: r.subtotal,
      px: r.ppn, pr: r.ppn_rate, amt: r.total, m: r.method, by: r.paid_amount, kb: r.change_amount, k: r.code,
    }));
  } else if (k) {
    const rows = await sql`SELECT o.*, to_char(o.show_date, 'YYYY-MM-DD') AS td FROM orders o WHERE o.code = ${String(k).slice(0, 20)}`;
    out.orders = rows.map(orderOut);
    out.sales = rows.filter((r) => r.status === 'lunas' || r.status === 'refund').map(saleOut);
  }
  return out;
}
