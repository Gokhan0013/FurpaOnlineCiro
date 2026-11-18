// Türkçe sayı / para / zaman biçimleri
const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = v => nf0.format(Math.round(v || 0));
export const money = v => '₺' + nf0.format(Math.round(v || 0));
export const money2 = v => '₺' + nf2.format(v || 0);
export const pct = v => '%' + nf1.format((v || 0) * 100);

export function moneyShort(v) {
  return money(v);
}

export function axisShort(v) {
  return num(v);
}

/** Sunucunun yerel saat damgası ("yyyy-MM-ddTHH:mm:ss") → Date (yerel). */
export const parse = s => (s ? new Date(s) : null);

export const hhmm = d => (d ? d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '--:--');
export const hhmmss = d => (d ? d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--');

export function ago(d, now) {
  if (!d) return '—';
  const s = Math.max(0, Math.round((now - d) / 1000));
  if (s < 60) return s + ' sn önce';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' dk önce';
  const h = Math.floor(m / 60);
  return h + ' sa ' + (m % 60) + ' dk önce';
}

export const slotLabel = (slot, minutes = 15) => {
  const t = slot * minutes;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};

export function initials(name) {
  const parts = (name || '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('tr-TR');
  return (parts[0][0] + parts[1][0]).toLocaleUpperCase('tr-TR');
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Sayıyı eski değerden yeni değere akıtarak yazar; artışlarda altın-zümrüt vurgu ekler. */
const tweens = new WeakMap();
export function countTo(el, value, format, ms = 950) {
  if (!el) return;
  const prev = tweens.get(el);
  const from = prev?.cur ?? prev?.value ?? 0;
  if (prev?.raf) cancelAnimationFrame(prev.raf);
  if (prev?.endTimer) clearTimeout(prev.endTimer);
  const state = { value, cur: from, raf: 0, endTimer: 0 };
  tweens.set(el, state);
  if (from === value || document.hidden || document.body.classList.contains('shot')) {
    state.cur = value;
    el.textContent = format(value);
    el.classList.remove('rolling');
    return;
  }
  if (value > from && from > 0) el.classList.add('rolling');
  const t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    const cur = from + (value - from) * e;
    state.cur = cur;
    el.textContent = format(cur);
    if (k < 1) state.raf = requestAnimationFrame(step);
    else {
      state.cur = value;
      state.endTimer = setTimeout(() => el.classList.remove('rolling'), 260);
    }
  };
  state.raf = requestAnimationFrame(step);
}

export function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * p;
}

