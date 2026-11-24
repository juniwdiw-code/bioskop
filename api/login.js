import { sql } from '../lib/db.js';
import { makeToken, safeEqual } from '../lib/auth.js';

const MAX_FAILS = 5; // percobaan salah per IP dalam 10 menit

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method tidak diizinkan.' });
  try {
    const { role, pin } = req.body || {};
    if (!['admin', 'kasir'].includes(role)) return res.status(400).json({ ok: false, error: 'Peran tidak valid.' });
    const expected = process.env[role === 'admin' ? 'ADMIN_PIN' : 'KASIR_PIN'];
    if (!expected) return res.status(500).json({ ok: false, error: 'PIN belum diatur di environment variable.' });

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    await sql`DELETE FROM login_attempts WHERE at < now() - interval '1 day'`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM login_attempts WHERE ip = ${ip} AND at > now() - interval '10 minutes'`;
    if (n >= MAX_FAILS) return res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.' });

    if (!safeEqual(String(pin ?? ''), expected)) {
      await sql`INSERT INTO login_attempts (ip) VALUES (${ip})`;
      return res.status(401).json({ ok: false, error: 'PIN salah.' });
    }
    return res.status(200).json({ ok: true, token: makeToken(role) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'Terjadi kesalahan server.' });
  }
}
