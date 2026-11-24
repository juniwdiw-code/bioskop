import crypto from 'node:crypto';

const TOKEN_TTL = 12 * 3600; // detik (sesi login 12 jam)

const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET belum diatur (minimal 16 karakter).');
  return s;
};
const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');
const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();

export const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

export function makeToken(role) {
  const payload = `${role}.${Math.floor(Date.now() / 1000) + TOKEN_TTL}`;
  return `${payload}.${sign(payload)}`;
}

// Mengembalikan 'admin' | 'kasir' | null
export function verifyToken(header) {
  const token = String(header || '').replace(/^Bearer\s+/i, '');
  const [role, exp, sig] = token.split('.');
  if (!sig || !['admin', 'kasir'].includes(role)) return null;
  if (!safeEqual(sig, sign(`${role}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return role;
}
