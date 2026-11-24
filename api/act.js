import { verifyToken } from '../lib/auth.js';
import { housekeep, bump, buildState } from '../lib/state.js';
import { ACTIONS } from '../lib/actions.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method tidak diizinkan.' });
  try {
    const role = verifyToken(req.headers.authorization);
    const b = req.body || {};
    const def = Object.hasOwn(ACTIONS, b.action) ? ACTIONS[b.action] : null;
    if (!def) return res.status(400).json({ ok: false, error: 'Aksi tidak dikenal.' });

    if (def.auth === 'staff' && !role) return res.status(401).json({ ok: false, error: 'Sesi berakhir. Masuk lagi.' });
    if (def.auth === 'admin' && role !== 'admin') {
      return res.status(role ? 403 : 401).json({ ok: false, error: role ? 'Hanya admin yang boleh melakukan ini.' : 'Sesi berakhir. Masuk lagi.' });
    }

    await housekeep();
    const out = (await def.fn(b, role)) || {};
    if (def.write !== false) await bump();
    if (def.noState) return res.status(200).json({ ok: true, ...out });

    const state = await buildState(role, { k: out.k || b.k });
    return res.status(200).json({ ok: true, ...out, state });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ ok: false, error: e.message, ...(e.extra || {}) });
    console.error(e);
    return res.status(500).json({ ok: false, error: 'Terjadi kesalahan server.' });
  }
}
