import crypto from 'node:crypto';
import { sql } from './db.js';
import { priceOrder, ppnRate, promoValid, dayOfWeek } from './pricing.js';

const METODE = ['Tunai', 'QRIS', 'Transfer Bank', 'E-Wallet'];
const SEAT_RE = /^[A-H]([1-9]|1[0-2])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SEATS = 10;
const TZ = process.env.APP_TIMEZONE || 'Asia/Makassar';

class AppError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const E = (msg, extra) => { throw new AppError(msg, 400, extra); };
const isDup = (e) => e && e.code === '23505';
const rp = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
const cln = (s) => String(s ?? '').replace(/['"\\<>&`$]/g, '').trim();
const mn = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hm = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const clash = (aT, aDur, bT, bDur) => mn(aT) < mn(bT) + bDur + 15 && mn(bT) < mn(aT) + aDur + 15;

function nowLocal() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function newCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let k = '';
  for (let i = 0; i < 8; i++) k += c[crypto.randomInt(c.length)];
  return k;
}

const getCfg = async () => (await sql`SELECT weekend_pct AS wk, night_pct AS ml, night_start AS jm FROM settings WHERE id = 1`)[0];
const getTiers = () => sql`SELECT min_price AS m, rate AS r FROM ppn_tiers ORDER BY min_price`;
const findFilm = async (title) => {
  const [f] = await sql`SELECT * FROM films WHERE lower(title) = lower(${String(title ?? '')})`;
  if (!f) E('Film tidak ditemukan.');
  return f;
};
const findMenu = async (name) => {
  const [m] = await sql`SELECT * FROM menu_items WHERE lower(name) = lower(${String(name ?? '')})`;
  if (!m) E('Item menu tidak ditemukan.');
  return m;
};
const findPaket = async (name) => {
  const [p] = await sql`SELECT * FROM packages WHERE lower(name) = lower(${String(name ?? '')})`;
  if (!p) E('Paket tidak ditemukan.');
  return p;
};

function bentrokMsg(filmTitle, dur, audi, c) {
  const end = mn(c.show_time) + c.duration;
  return `Audi ${audi} bentrok. Audi ini dipakai ${c.title} pukul ${c.show_time} sampai ${hm(end)}, ditambah jeda 15 menit untuk pembersihan (baru bebas pukul ${hm(end + 15)}). Jadwal ${filmTitle} (${dur} menit) tidak bisa masuk di waktu tersebut.`;
}

// auth: 'public' | 'staff' (kasir atau admin) | 'admin'
export const ACTIONS = {
  // ================= PUBLIK (pelanggan) =================
  promo_check: {
    auth: 'public', write: false, noState: true,
    fn: async (b) => {
      const code = cln(b.code).toUpperCase().replace(/\s+/g, '');
      const [p] = await sql`SELECT code AS c, kind AS t, value AS v, weekday AS h, active AS "on" FROM promos WHERE code = ${code}`;
      return { promo: p || null };
    },
  },

  order_create: {
    auth: 'public',
    fn: async (b) => {
      const nama = String(b.nama ?? '').trim().slice(0, 60);
      if (!nama) E('Nama tidak boleh kosong!');
      if (!['Kasir', 'Aplikasi'].includes(b.channel)) E('Kanal pembelian tidak valid.');
      if (!METODE.includes(b.metode)) E('Metode pembayaran tidak valid.');
      if (b.channel === 'Aplikasi' && b.metode === 'Tunai') E('Pembelian lewat aplikasi harus non-tunai.');

      const seats = [...new Set(Array.isArray(b.kursi) ? b.kursi.map(String) : [])];
      if (!seats.length || seats.length > MAX_SEATS || !seats.every((s) => SEAT_RE.test(s))) {
        E(`Kursi tidak valid (maksimal ${MAX_SEATS} kursi per pemesanan).`);
      }
      seats.sort((x, y) => (x[0] === y[0] ? x.slice(1) - y.slice(1) : x < y ? -1 : 1));

      const [show] = await sql`
        SELECT s.id, s.show_time, f.title, f.duration, f.audi, f.price
        FROM shows s JOIN films f ON f.id = s.film_id WHERE s.id = ${Number(b.showId) || 0}`;
      if (!show) E('Jadwal tayang tidak ditemukan.');

      const tgl = String(b.tgl ?? '');
      const now = nowLocal();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl) || tgl < now.date || tgl > addDays(now.date, 30)) E('Tanggal tayang tidak valid.');
      if (tgl === now.date && mn(show.show_time) <= now.min) E('Jadwal ini sudah lewat. Pilih jam lain.');

      let paketName = 'Tiket Saja';
      let items = [];
      if (String(b.tiket) !== 'Tiket Saja') {
        const p = await findPaket(b.tiket);
        paketName = p.name;
        items = await sql`
          SELECT m.name, m.price FROM package_items pi JOIN menu_items m ON m.id = pi.menu_item_id
          WHERE pi.package_id = ${p.id} ORDER BY m.id`;
      }

      const code = cln(b.promo).toUpperCase().replace(/\s+/g, '');
      let promo = null;
      if (code) {
        const [p] = await sql`SELECT code AS c, kind AS t, value AS v, weekday AS h, active AS "on" FROM promos WHERE code = ${code}`;
        if (promoValid(p, tgl)) promo = p;
      }

      const [cfg, tiers] = await Promise.all([getCfg(), getTiers()]);
      const p = priceOrder({
        film: show, jam: show.show_time, tgl, addOn: items.reduce((t, m) => t + m.price, 0),
        seats: seats.length, promo, cfg, tiers,
      });
      const itemNames = items.map((m) => m.name);
      const k = newCode();

      try {
        await sql`
          WITH o AS (
            INSERT INTO orders (code, status, customer_name, channel, show_id, show_date, film_title, audi, show_time,
              seat_count, seats, package_name, items, subtotal, discount, promo_code, ticket_amount, food_amount,
              ppn, ppn_rate, total, method)
            VALUES (${k}, 'menunggu', ${nama}, ${b.channel}, ${show.id}, ${tgl}, ${show.title}, ${show.audi}, ${show.show_time},
              ${seats.length}, ${seats}, ${paketName}, ${itemNames}, ${p.sub}, ${p.ds}, ${promo ? promo.c : ''}, ${p.tk}, ${p.fd},
              ${p.px}, ${p.rate}, ${p.total}, ${b.metode})
            RETURNING id
          )
          INSERT INTO seat_locks (order_id, show_id, show_date, seat_no)
          SELECT o.id, ${show.id}::int, ${tgl}::date, s FROM o, unnest(${seats}::text[]) AS s`;
      } catch (e) {
        if (!isDup(e)) throw e;
        const taken = (await sql`
          SELECT seat_no FROM seat_locks WHERE show_id = ${show.id} AND show_date = ${tgl}::date AND seat_no = ANY(${seats}::text[])`
        ).map((r) => r.seat_no);
        if (!taken.length) E('Gagal membuat kode pesanan. Coba lagi.');
        E(`Kursi ${taken.join(', ')} baru saja dipesan orang lain. Pilih kursi lain.`, { taken });
      }
      return { k };
    },
  },

  // Pelanggan membatalkan pesanannya sendiri (pakai kode), atau kasir/admin membatalkan.
  order_cancel: {
    auth: 'public',
    fn: async (b, role) => {
      const k = String(b.k ?? '');
      const r = await sql`
        WITH c AS (
          UPDATE orders SET status = 'batal', cancel_reason = ${role ? 'staf' : 'pelanggan'}
          WHERE code = ${k} AND status = 'menunggu' RETURNING id
        ), d AS (DELETE FROM seat_locks WHERE order_id IN (SELECT id FROM c))
        SELECT count(*)::int AS n FROM c`;
      if (!r[0].n) E('Pesanan sudah tidak menunggu pembayaran.');
      return { k };
    },
  },

  // ================= KASIR & ADMIN =================
  order_confirm: {
    auth: 'staff',
    fn: async (b) => {
      const k = String(b.k ?? '');
      const gone = `Pesanan ${k} sudah tidak menunggu pembayaran (dibatalkan atau kedaluwarsa).`;
      const [o] = await sql`SELECT total, method, status FROM orders WHERE code = ${k}`;
      if (!o || o.status !== 'menunggu') E(gone);
      const m = METODE.includes(b.metode) ? b.metode : o.method;
      let by = o.total;
      if (m === 'Tunai') {
        by = parseInt(b.uang, 10);
        if (!(by >= o.total)) E(`Uang diterima kurang dari total ${rp(o.total)}.`);
      }
      const r = await sql`
        UPDATE orders SET status = 'lunas', method = ${m}, paid_amount = ${by}, change_amount = ${by - o.total}, paid_at = now()
        WHERE code = ${k} AND status = 'menunggu' RETURNING code`;
      if (!r.length) E(gone);
      return { k, by, kb: by - o.total, m };
    },
  },

  order_defer: {
    auth: 'staff',
    fn: async (b) => {
      await sql`UPDATE orders SET queue_at = now() WHERE code = ${String(b.k ?? '')} AND status = 'menunggu'`;
      return {};
    },
  },

  food_sell: {
    auth: 'staff',
    fn: async (b) => {
      if (!METODE.includes(b.metode)) E('Metode pembayaran tidak valid.');
      const menu = await sql`SELECT name, price FROM menu_items`;
      const lines = [];
      for (const x of Array.isArray(b.items) ? b.items : []) {
        const m = menu.find((z) => z.name === x.n);
        const q = parseInt(x.q, 10);
        if (!m || !(q > 0) || q > 99) E('Item penjualan tidak valid.');
        lines.push({ n: m.name, q, h: m.price });
      }
      if (!lines.length) E('Pilih minimal satu item.');
      const sb = lines.reduce((t, x) => t + x.h * x.q, 0);
      const q = lines.reduce((t, x) => t + x.q, 0);
      const pr = ppnRate(sb / q, await getTiers());
      const px = Math.round(sb * pr);
      const amt = sb + px;
      let by = amt;
      if (b.metode === 'Tunai') {
        by = parseInt(b.uang, 10);
        if (!(by >= amt)) E(`Uang kurang dari total ${rp(amt)}.`);
      }
      const k = newCode();
      const nama = cln(b.nama).slice(0, 60) || 'Konter';
      await sql`
        WITH f AS (
          INSERT INTO food_sales (code, customer_name, item_count, subtotal, ppn, ppn_rate, total, method, paid_amount, change_amount)
          VALUES (${k}, ${nama}, ${q}, ${sb}, ${px}, ${pr}, ${amt}, ${b.metode}, ${by}, ${by - amt}) RETURNING id
        )
        INSERT INTO food_sale_items (food_sale_id, item_name, qty, unit_price)
        SELECT f.id, x.n, x.q, x.h FROM f, jsonb_to_recordset(${JSON.stringify(lines)}::jsonb) AS x(n text, q int, h int)`;
      return { k, amt, kb: by - amt };
    },
  },

  // ================= ADMIN =================
  refund: {
    auth: 'admin',
    fn: async (b) => {
      const k = String(b.k ?? '');
      const r = await sql`
        WITH c AS (
          UPDATE orders SET status = 'refund', refunded_at = now() WHERE code = ${k} AND status = 'lunas' RETURNING id
        ), d AS (DELETE FROM seat_locks WHERE order_id IN (SELECT id FROM c))
        SELECT count(*)::int AS n FROM c`;
      if (!r[0].n) E('Transaksi tidak ditemukan atau sudah di-refund.');
      return {};
    },
  },

  film_add: {
    auth: 'admin',
    fn: async (b) => {
      const j = String(b.j ?? '').trim().slice(0, 100);
      const g = String(b.g ?? '').trim().slice(0, 40);
      const d = parseInt(b.d, 10);
      const h = parseInt(b.h, 10);
      const a = parseInt(b.a, 10);
      if (!j || !g || !(d > 0) || !(h > 0)) E('Lengkapi judul, genre, durasi, dan harga tiket film.');
      if (!(a >= 0 && a <= 4)) E('Audi tidak valid.');
      try {
        await sql`INSERT INTO films (title, genre, duration, audi, price) VALUES (${j}, ${g}, ${d}, ${a + 1}, ${h})`;
      } catch (e) {
        if (isDup(e)) E('Film sudah ada.');
        throw e;
      }
      return {};
    },
  },

  film_del: {
    auth: 'admin',
    fn: async (b) => {
      const f = await findFilm(b.film);
      await sql`DELETE FROM films WHERE id = ${f.id}`;
      return {};
    },
  },

  film_audi: {
    auth: 'admin',
    fn: async (b) => {
      const f = await findFilm(b.film);
      const audi = parseInt(b.audi, 10) + 1;
      if (!(audi >= 1 && audi <= 5)) E('Audi tidak valid.');
      const mine = await sql`SELECT show_time FROM shows WHERE film_id = ${f.id}`;
      const others = await sql`
        SELECT s.show_time, x.title, x.duration FROM shows s JOIN films x ON x.id = s.film_id
        WHERE x.id <> ${f.id} AND x.audi = ${audi}`;
      for (const s of mine) {
        const c = others.find((w) => clash(s.show_time, f.duration, w.show_time, w.duration));
        if (c) E('Film tidak dipindah. ' + bentrokMsg(f.title, f.duration, audi, c));
      }
      await sql`UPDATE films SET audi = ${audi} WHERE id = ${f.id}`;
      return {};
    },
  },

  film_harga: {
    auth: 'admin',
    fn: async (b) => {
      const f = await findFilm(b.film);
      const h = parseInt(b.h, 10);
      if (!(h > 0)) E('Harga tiket harus lebih dari 0.');
      await sql`UPDATE films SET price = ${h} WHERE id = ${f.id}`;
      return {};
    },
  },

  show_add: {
    auth: 'admin',
    fn: async (b) => {
      const f = await findFilm(b.film);
      const jam = String(b.jam ?? '');
      if (!TIME_RE.test(jam)) E('Pilih film dan jam tayang.');
      const same = await sql`
        SELECT s.show_time, x.title, x.duration FROM shows s JOIN films x ON x.id = s.film_id WHERE x.audi = ${f.audi}`;
      const c = same.find((w) => clash(jam, f.duration, w.show_time, w.duration));
      if (c) E(bentrokMsg(f.title, f.duration, f.audi, c));
      await sql`INSERT INTO shows (film_id, show_time) VALUES (${f.id}, ${jam})`;
      return {};
    },
  },

  show_del: {
    auth: 'admin',
    fn: async (b) => {
      await sql`DELETE FROM shows WHERE id = ${Number(b.id) || 0}`;
      return {};
    },
  },

  menu_add: {
    auth: 'admin',
    fn: async (b) => {
      const n = cln(b.n).slice(0, 60);
      const h = parseInt(b.h, 10);
      if (!n || !(h >= 0)) E('Isi nama item dan harga.');
      try {
        await sql`INSERT INTO menu_items (name, price) VALUES (${n}, ${h})`;
      } catch (e) {
        if (isDup(e)) E('Item sudah ada.');
        throw e;
      }
      return {};
    },
  },

  menu_harga: {
    auth: 'admin',
    fn: async (b) => {
      const m = await findMenu(b.n);
      const h = parseInt(b.h, 10);
      if (!(h >= 0)) E('Harga tidak valid.');
      await sql`UPDATE menu_items SET price = ${h} WHERE id = ${m.id}`;
      return {};
    },
  },

  menu_del: {
    auth: 'admin',
    fn: async (b) => {
      const m = await findMenu(b.n);
      await sql`DELETE FROM menu_items WHERE id = ${m.id}`;
      return {};
    },
  },

  paket_add: {
    auth: 'admin',
    fn: async (b) => {
      const n = cln(b.n).slice(0, 60);
      if (!n) E('Isi nama paket.');
      if (n.toLowerCase() === 'tiket saja') E('Nama paket sudah ada.');
      try {
        await sql`INSERT INTO packages (name) VALUES (${n})`;
      } catch (e) {
        if (isDup(e)) E('Nama paket sudah ada.');
        throw e;
      }
      return {};
    },
  },

  paket_del: {
    auth: 'admin',
    fn: async (b) => {
      const p = await findPaket(b.n);
      await sql`DELETE FROM packages WHERE id = ${p.id}`;
      return {};
    },
  },

  paket_toggle: {
    auth: 'admin',
    fn: async (b) => {
      const p = await findPaket(b.paket);
      const m = await findMenu(b.item);
      const del = await sql`DELETE FROM package_items WHERE package_id = ${p.id} AND menu_item_id = ${m.id} RETURNING 1 AS x`;
      if (!del.length) await sql`INSERT INTO package_items (package_id, menu_item_id) VALUES (${p.id}, ${m.id})`;
      return {};
    },
  },

  ppn_save: {
    auth: 'admin',
    fn: async (b) => {
      const t = Array.isArray(b.tiers) ? b.tiers.map((x) => ({ m: Math.round(Number(x.m)), r: Number(x.r) })) : [];
      if (!t.length || t.some((x) => !(x.m >= 0) || !(x.r >= 0 && x.r <= 100))) E('Nilai tidak valid.');
      const mins = t.map((x) => x.m);
      if (new Set(mins).size !== mins.length) E('Batas harga PPN tidak boleh sama.');
      if (!mins.includes(0)) E('Tingkat pertama harus mulai dari Rp0.');
      const rates = t.map((x) => x.r);
      await sql.transaction([
        sql`DELETE FROM ppn_tiers`,
        sql`INSERT INTO ppn_tiers (min_price, rate) SELECT * FROM unnest(${mins}::int[], ${rates}::float8[])`,
      ]);
      return {};
    },
  },

  cfg_set: {
    auth: 'admin',
    fn: async (b) => {
      if (b.f === 'jm') {
        if (!TIME_RE.test(String(b.v))) E('Format jam tidak valid.');
        await sql`UPDATE settings SET night_start = ${String(b.v)} WHERE id = 1`;
        return {};
      }
      const v = parseFloat(b.v);
      if (!(v >= 0 && v <= 200)) E('Persentase harus 0 sampai 200.');
      if (b.f === 'wk') await sql`UPDATE settings SET weekend_pct = ${v} WHERE id = 1`;
      else if (b.f === 'ml') await sql`UPDATE settings SET night_pct = ${v} WHERE id = 1`;
      else E('Pengaturan tidak dikenal.');
      return {};
    },
  },

  promo_add: {
    auth: 'admin',
    fn: async (b) => {
      const c = cln(b.c).toUpperCase().replace(/\s+/g, '').slice(0, 30);
      const v = parseFloat(b.v);
      const h = parseInt(b.h, 10);
      if (!c || !(v > 0) || !['p', 'n'].includes(b.t) || (b.t === 'p' && v > 100) || !(h >= -1 && h <= 6)) {
        E('Isi kode dan nilai diskon yang valid (persen maksimal 100).');
      }
      try {
        await sql`INSERT INTO promos (code, kind, value, weekday, active) VALUES (${c}, ${b.t}, ${v}, ${h}, true)`;
      } catch (e) {
        if (isDup(e)) E('Kode promo sudah ada.');
        throw e;
      }
      return {};
    },
  },

  promo_toggle: {
    auth: 'admin',
    fn: async (b) => {
      await sql`UPDATE promos SET active = NOT active WHERE code = ${String(b.c ?? '')}`;
      return {};
    },
  },

  promo_del: {
    auth: 'admin',
    fn: async (b) => {
      await sql`DELETE FROM promos WHERE code = ${String(b.c ?? '')}`;
      return {};
    },
  },

  reset_sales: {
    auth: 'admin',
    fn: async () => {
      await sql.transaction([sql`DELETE FROM orders`, sql`DELETE FROM food_sales`]);
      return {};
    },
  },
};

export { AppError, dayOfWeek };
