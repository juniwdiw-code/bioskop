import { verifyToken } from '../lib/auth.js';
import { housekeep, buildState } from '../lib/state.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const role = verifyToken(req.headers.authorization);
    if (req.headers.authorization && !role) return res.status(401).json({ ok: false, error: 'Sesi berakhir. Masuk lagi.' });

    const rev = await housekeep();
    if (req.query.rev !== undefined && Number(req.query.rev) === rev) {
      return res.status(200).json({ ok: true, unchanged: true, rev });
    }
    const state = await buildState(role, { k: req.query.k, rev });
    return res.status(200).json({ ok: true, ...state });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'Terjadi kesalahan server.' });
  }
}
