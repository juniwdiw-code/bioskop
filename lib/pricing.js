// Perhitungan harga. Rumusnya sama dengan yang dipakai di tampilan (public/index.html),
// tetapi server yang menentukan angka akhirnya agar harga tidak bisa dimanipulasi dari browser.

export const dayOfWeek = (tgl) => new Date(`${tgl}T00:00:00Z`).getUTCDay();

export function ticketPrice(film, jam, tgl, cfg) {
  const d = dayOfWeek(tgl);
  const pct = (d === 0 || d === 6 ? cfg.wk : 0) + (jam >= cfg.jm ? cfg.ml : 0);
  return Math.round((film.price * (1 + pct / 100)) / 500) * 500;
}

export function ppnRate(perSeat, tiers) {
  let r = 0;
  [...tiers].sort((a, b) => a.m - b.m).forEach((t) => {
    if (perSeat >= t.m) r = t.r;
  });
  return r / 100;
}

export function promoValid(p, tgl) {
  return !!p && p.on && (p.h < 0 || dayOfWeek(tgl) === p.h);
}

export function priceOrder({ film, jam, tgl, addOn, seats, promo, cfg, tiers }) {
  const tix = ticketPrice(film, jam, tgl, cfg);
  const perSeat = tix + addOn;
  const sub = perSeat * seats;
  const ds = promo ? Math.min(sub, promo.t === 'p' ? Math.round((sub * promo.v) / 100) : promo.v) : 0;
  const rate = ppnRate(perSeat, tiers);
  const px = Math.round((sub - ds) * rate);
  const tk = Math.max(0, tix * seats - ds);
  return { tix, sub, ds, rate, px, total: sub - ds + px, tk, fd: sub - ds - tk };
}
