// Elle çizilen grafikler (SVG / Canvas). Dış kütüphane yok, internet gerekmez.
import { axisShort, esc, money, moneyShort, niceMax, num, slotLabel } from './fmt.js?v=7';

const NS = 'http://www.w3.org/2000/svg';

// ------------------------------------------------------------------ tooltip
const tip = document.getElementById('tooltip');
export function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.classList.add('on');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + 16, top = y + 16;
  if (left + w > innerWidth - 8) left = x - w - 16;
  if (top + h > innerHeight - 8) top = y - h - 16;
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top = Math.max(8, top) + 'px';
}
export const hideTip = () => tip.classList.remove('on');

// ------------------------------------------------------------------ KPI süslemeleri
/** 1) Bugünkü Ciro — Banknot destesi + 24K Altın ₺ sikke ikonu */
export function artCandles(svg) {
  svg.innerHTML = `
    <defs>
      <linearGradient id="billBack" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1fa39c" stop-opacity=".42"/>
        <stop offset="1" stop-color="#145c58" stop-opacity=".18"/>
      </linearGradient>
      <linearGradient id="billFront" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4ef5a3" stop-opacity=".34"/>
        <stop offset=".55" stop-color="#22b573" stop-opacity=".24"/>
        <stop offset="1" stop-color="#155e4b" stop-opacity=".32"/>
      </linearGradient>
      <linearGradient id="billStroke" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#9effcf"/>
        <stop offset="1" stop-color="#29b87d" stop-opacity=".55"/>
      </linearGradient>
      <radialGradient id="coinGold" cx="35%" cy="30%" r="70%">
        <stop offset="0" stop-color="#fff9d2"/>
        <stop offset=".45" stop-color="#ffd54a"/>
        <stop offset="1" stop-color="#c97a00"/>
      </radialGradient>
      <radialGradient id="moneyGlow" cx="55%" cy="52%" r="50%">
        <stop offset="0" stop-color="#3fd18b" stop-opacity=".28"/>
        <stop offset="1" stop-color="#3fd18b" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="74" cy="46" r="42" fill="url(#moneyGlow)" stroke="none"/>
    <g transform="rotate(-10 62 40)">
      <rect x="22" y="18" width="76" height="44" rx="7" fill="url(#billBack)" stroke="#3fd18b" stroke-opacity=".45" stroke-width="1.3"/>
      <rect x="27" y="23" width="66" height="34" rx="4" fill="none" stroke="#6ff7b4" stroke-opacity=".22" stroke-width="1" stroke-dasharray="3 3"/>
    </g>
    <g transform="rotate(-2 64 46)">
      <rect x="24" y="24" width="78" height="45" rx="7" fill="#132623" stroke="none"/>
      <rect x="24" y="24" width="78" height="45" rx="7" fill="url(#billFront)" stroke="url(#billStroke)" stroke-width="1.5"/>
      <rect x="29.5" y="29.5" width="67" height="34" rx="4" fill="none" stroke="#9effcf" stroke-opacity=".34" stroke-width="1"/>
      <circle cx="63" cy="46.5" r="11" fill="rgba(111,247,180,.12)" stroke="#9effcf" stroke-opacity=".5" stroke-width="1.2"/>
      <text x="63" y="51.5" text-anchor="middle" fill="#dcffec" stroke="none" font-size="14" font-weight="700" font-family="Segoe UI, sans-serif">₺</text>
      <line x1="35" y1="36" x2="46" y2="36" stroke="#9effcf" stroke-opacity=".45" stroke-width="1.4"/>
      <line x1="35" y1="40.5" x2="42" y2="40.5" stroke="#9effcf" stroke-opacity=".3" stroke-width="1.2"/>
    </g>
    <circle cx="104" cy="54" r="14.5" fill="url(#coinGold)" opacity=".65" stroke="#ffe58f" stroke-width="1"/>
    <circle cx="95" cy="60" r="17.5" fill="url(#coinGold)" stroke="#fff3b0" stroke-width="1.4"/>
    <circle cx="95" cy="60" r="13.5" fill="none" stroke="#8c5000" stroke-opacity=".45" stroke-width="1" stroke-dasharray="2.2 2.2"/>
    <text x="95" y="66" text-anchor="middle" fill="#4a2800" stroke="none" font-size="17.5" font-weight="800" font-family="Segoe UI, sans-serif">₺</text>
    <path d="M28 14 L29.5 18 L33.5 19.5 L29.5 21 L28 25 L26.5 21 L22.5 19.5 L26.5 18 Z" fill="#ffe57f" stroke="none">
      <animate attributeName="opacity" values=".95;.25;.95" dur="2.2s" repeatCount="indefinite"/>
    </path>
    <path d="M114 18 L115.2 21 L118.2 22.2 L115.2 23.4 L114 26.4 L112.8 23.4 L109.8 22.2 L112.8 21 Z" fill="#6ff7b4" stroke="none">
      <animate attributeName="opacity" values=".3;1;.3" dur="1.9s" repeatCount="indefinite"/>
    </path>`;
}

/** 2) Fiş Sayısı — Parlayan kapsül çubuklar + yumuşak akış eğrisi + termal kasa fişi ikonu */
export function artWave(svg, values) {
  let raw = values && values.length ? [...values] : [0, 0, 0, 0];
  // Devam eden son 15 dk dilimi henüz çok düşükse sağ uçta sahte çöküş göstermemek için yumuşat
  if (raw.length > 2 && raw[raw.length - 1] < raw[raw.length - 2] * 0.45) {
    raw[raw.length - 1] = Math.round(raw[raw.length - 2] * 0.78 + raw[raw.length - 1] * 0.22);
  }
  const N = 8;
  const buckets = [];
  for (let i = 0; i < N; i++) {
    const a = Math.floor((i * raw.length) / N);
    const b = Math.max(a + 1, Math.floor(((i + 1) * raw.length) / N));
    const slice = raw.slice(a, b);
    buckets.push(slice.reduce((x, y) => x + y, 0) / slice.length);
  }
  const max = Math.max(...buckets, 1);
  const x0 = 10, x1 = 80, baseY = 74, maxH = 46;
  const step = (x1 - x0) / (N - 1);
  const pts = buckets.map((v, i) => [x0 + i * step, baseY - Math.max(5, (v / max) * maxH)]);

  let bars = '';
  pts.forEach(([x, y], i) => {
    const isLast = i === N - 1;
    bars += `<rect x="${(x - 2.6).toFixed(1)}" y="${y.toFixed(1)}" width="5.2" height="${(baseY - y).toFixed(1)}" rx="2.6"
      fill="${isLast ? 'url(#fisLiveBar)' : 'url(#fisBar)'}" stroke="none" opacity="${(0.42 + (i / N) * 0.52).toFixed(2)}"/>`;
  });

  let curve = `M${pts[0][0].toFixed(1)},${(pts[0][1] - 4).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i];
    const mx = ((px + cx) / 2).toFixed(1);
    curve += ` C${mx},${(py - 4).toFixed(1)} ${mx},${(cy - 4).toFixed(1)} ${cx.toFixed(1)},${(cy - 4).toFixed(1)}`;
  }
  const [lx, ly] = pts[pts.length - 1];

  svg.innerHTML = `
    <defs>
      <linearGradient id="fisBar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#7ec4ff"/>
        <stop offset="1" stop-color="#8a6cff" stop-opacity=".18"/>
      </linearGradient>
      <linearGradient id="fisLiveBar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6ff7b4"/>
        <stop offset="1" stop-color="#3fa3ff" stop-opacity=".35"/>
      </linearGradient>
      <linearGradient id="fisCurve" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#8a6cff"/>
        <stop offset=".6" stop-color="#5cc2ff"/>
        <stop offset="1" stop-color="#6ff7b4"/>
      </linearGradient>
      <linearGradient id="rcpFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#2c3352" stop-opacity=".9"/>
        <stop offset="1" stop-color="#191c2b" stop-opacity=".9"/>
      </linearGradient>
    </defs>
    ${bars}
    <path d="${curve}" fill="none" stroke="url(#fisCurve)" stroke-width="2.1"/>
    <circle cx="${lx.toFixed(1)}" cy="${(ly - 4).toFixed(1)}" r="3.2" fill="#6ff7b4" stroke="none">
      <animate attributeName="r" values="2.6;4.8;2.6" dur="1.6s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="1;.45;1" dur="1.6s" repeatCount="indefinite"/>
    </circle>
    <g transform="translate(90,15)">
      <path d="M2,3 L6,0 L10,3 L14,0 L18,3 L22,0 L26,3 L30,0 L32,3 L32,55 L28,58 L24,55 L20,58 L16,55 L12,58 L8,55 L4,58 L2,55 Z"
        fill="url(#rcpFill)" stroke="#9ec5ff" stroke-opacity=".55" stroke-width="1.3"/>
      <line x1="8" y1="13" x2="26" y2="13" stroke="#cfe3ff" stroke-opacity=".85" stroke-width="1.6"/>
      <line x1="8" y1="21" x2="22" y2="21" stroke="#9ec5ff" stroke-opacity=".55" stroke-width="1.4"/>
      <line x1="8" y1="28" x2="25" y2="28" stroke="#9ec5ff" stroke-opacity=".55" stroke-width="1.4"/>
      <line x1="8" y1="35" x2="19" y2="35" stroke="#9ec5ff" stroke-opacity=".45" stroke-width="1.4"/>
      <line x1="7" y1="42" x2="27" y2="42" stroke="#9ec5ff" stroke-opacity=".3" stroke-width="1" stroke-dasharray="2 2"/>
      <circle cx="23" cy="48.5" r="5" fill="rgba(63,209,139,.22)" stroke="#5ef5ad" stroke-width="1.2"/>
      <path d="M20.8,48.5 L22.4,50.1 L25.5,46.9" fill="none" stroke="#6ff7b4" stroke-width="1.4"/>
    </g>`;
}

/** 3) Sepet Ortalaması — Dolu Market Arabası ikonu */
export function artLines(svg) {
  svg.innerHTML = `
    <defs>
      <linearGradient id="cartBody" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#9ec5ff" stop-opacity=".28"/>
        <stop offset="1" stop-color="#8a6cff" stop-opacity=".10"/>
      </linearGradient>
      <linearGradient id="cartStroke" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#e8f1ff"/>
        <stop offset=".6" stop-color="#9ec5ff"/>
        <stop offset="1" stop-color="#8a6cff"/>
      </linearGradient>
      <radialGradient id="cartGlow" cx="60%" cy="52%" r="48%">
        <stop offset="0" stop-color="#8a6cff" stop-opacity=".26"/>
        <stop offset="1" stop-color="#8a6cff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="76" cy="46" r="40" fill="url(#cartGlow)" stroke="none"/>
    <!-- hız çizgileri -->
    <line x1="12" y1="36" x2="26" y2="36" stroke="#9ec5ff" stroke-opacity=".35" stroke-width="1.5"/>
    <line x1="17" y1="45" x2="29" y2="45" stroke="#9ec5ff" stroke-opacity=".22" stroke-width="1.4"/>
    <!-- sepetteki ürünler -->
    <rect x="50" y="17" width="14" height="16" rx="3.5" transform="rotate(-8 57 25)" fill="#3fd18b" fill-opacity=".38" stroke="#6ff7b4" stroke-width="1.3"/>
    <rect x="67" y="14" width="16" height="19" rx="3.5" transform="rotate(5 75 23)" fill="#ffd54a" fill-opacity=".36" stroke="#ffe57f" stroke-width="1.3"/>
    <rect x="86" y="18" width="13" height="15" rx="3.5" transform="rotate(10 92 25)" fill="#3fa3ff" fill-opacity=".38" stroke="#8fd0ff" stroke-width="1.3"/>
    <!-- sepet gövdesi -->
    <path d="M38,29 L112,29 L102,55 L46,55 Z" fill="url(#cartBody)" stroke="url(#cartStroke)" stroke-width="2"/>
    <line x1="41" y1="38" x2="108.5" y2="38" stroke="#cfe3ff" stroke-opacity=".38" stroke-width="1.2"/>
    <line x1="43.5" y1="46.5" x2="105.2" y2="46.5" stroke="#cfe3ff" stroke-opacity=".38" stroke-width="1.2"/>
    <line x1="56" y1="29" x2="58.5" y2="55" stroke="#cfe3ff" stroke-opacity=".34" stroke-width="1.2"/>
    <line x1="74" y1="29" x2="74" y2="55" stroke="#cfe3ff" stroke-opacity=".34" stroke-width="1.2"/>
    <line x1="92" y1="29" x2="89.5" y2="55" stroke="#cfe3ff" stroke-opacity=".34" stroke-width="1.2"/>
    <!-- tutamak ve alt şasi -->
    <path d="M22,20 L34,20 L46,55 L43,63 L101,63" fill="none" stroke="url(#cartStroke)" stroke-width="2.4"/>
    <circle cx="22" cy="20" r="2.6" fill="#fff" stroke="none"/>
    <!-- tekerlekler -->
    <circle cx="52" cy="72" r="6.5" fill="#171926" stroke="#cfe3ff" stroke-width="2"/>
    <circle cx="52" cy="72" r="2.4" fill="#6ff7b4" stroke="none"/>
    <circle cx="93" cy="72" r="6.5" fill="#171926" stroke="#cfe3ff" stroke-width="2"/>
    <circle cx="93" cy="72" r="2.4" fill="#ffe57f" stroke="none"/>`;
}

/** 4) Gün Sonu Tahmini — Hız / Performans Kadranlı Gösterge (Gauge) */
export function artDots(svg, progress) {
  const p = Math.max(0, Math.min(1, progress || 0));
  const cx = 74, cy = 58, R = 37;
  const a0 = 155, sweep = 230;
  const aCur = a0 + sweep * p;
  const pt = (r, deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
  };
  const arcPath = (r, fromDeg, toDeg) => {
    if (toDeg - fromDeg <= 0.3) return '';
    const [x1, y1] = pt(r, fromDeg);
    const [x2, y2] = pt(r, toDeg);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
  };

  let ticks = '';
  const T = 12;
  for (let i = 0; i <= T; i++) {
    const deg = a0 + (sweep * i) / T;
    const major = i % 3 === 0;
    const lit = i / T <= p + 0.001;
    const [x1, y1] = pt(R + 5, deg);
    const [x2, y2] = pt(R + (major ? 10.5 : 8), deg);
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
      stroke="${lit ? '#ffe57f' : 'rgba(255,255,255,.2)'}" stroke-width="${major ? 1.8 : 1.1}"/>`;
  }

  const [nx, ny] = pt(R - 5, aCur);
  const [bx1, by1] = pt(3.2, aCur - 90);
  const [bx2, by2] = pt(3.2, aCur + 90);
  const [tx, ty] = pt(-7, aCur);
  const [tipX, tipY] = pt(R, aCur);
  const activeArc = arcPath(R, a0, Math.max(a0 + 2, aCur));

  svg.innerHTML = `
    <defs>
      <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#8a6cff"/>
        <stop offset=".5" stop-color="#3fa3ff"/>
        <stop offset=".82" stop-color="#3fd18b"/>
        <stop offset="1" stop-color="#ffd54a"/>
      </linearGradient>
      <radialGradient id="gaugeGlow" cx="56%" cy="62%" r="48%">
        <stop offset="0" stop-color="#3fa3ff" stop-opacity=".22"/>
        <stop offset="1" stop-color="#3fa3ff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="${cx}" cy="${cy - 4}" r="42" fill="url(#gaugeGlow)" stroke="none"/>
    ${ticks}
    <path d="${arcPath(R, a0, a0 + sweep)}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="6.5" stroke-linecap="round"/>
    ${activeArc ? `<path d="${activeArc}" fill="none" stroke="url(#gaugeGrad)" stroke-width="6.5" stroke-linecap="round"/>` : ''}
    <circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="3.4" fill="#fffbe6" stroke="none">
      <animate attributeName="r" values="2.8;4.6;2.8" dur="1.5s" repeatCount="indefinite"/>
    </circle>
    <polygon points="${bx1.toFixed(1)},${by1.toFixed(1)} ${nx.toFixed(1)},${ny.toFixed(1)} ${bx2.toFixed(1)},${by2.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}"
      fill="#ffffff" stroke="none" opacity=".95"/>
    <circle cx="${cx}" cy="${cy}" r="6.2" fill="#1b1d2b" stroke="#cfe3ff" stroke-width="1.8"/>
    <circle cx="${cx}" cy="${cy}" r="2.5" fill="#ffd54a" stroke="none"/>
    <text x="${cx}" y="${cy + 20}" text-anchor="middle" fill="#dce4f5" stroke="none" font-size="11" font-weight="700" font-family="Segoe UI, sans-serif">%${Math.round(p * 100)}</text>`;
}

export function sparkline(values, color = '#8a6cff', w = 120, h = 22) {
  const max = Math.max(...values, 1);
  const n = values.length;
  const pts = values.map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" stroke="${color}" stroke-width="1.4" fill="none"/></svg>`;
}

// ------------------------------------------------------------------ dijital neon çok bölgeli saatlik ciro grafiği
export const NEON_MAP = {
  bolge_1: '#00f5d4', // Elektrik Siyan-Mint
  bolge_2: '#ffbe0b', // Dijital Güneş Altını
  bolge_3: '#38b6ff', // Lazer Azur Mavisi
  bolge_4: '#b565ff', // Neon Ultraviyole
  bolge_5: '#ff3d81', // Siber Mercan-Macenta
  bolge_6: '#39ff88', // Matris Neon Zümrüt
  other: '#7df9ff'
};
const NEON_FALLBACK = ['#00f5d4', '#ffbe0b', '#38b6ff', '#b565ff', '#ff3d81', '#39ff88', '#7df9ff', '#ff85a1'];

export function neonRegionColor(id, idx = 0) {
  return NEON_MAP[id] || NEON_FALLBACK[idx % NEON_FALLBACK.length];
}

/** Tam yuvarlak ciro eksen ölçeği (ör. 250.000 · 500.000 · 750.000 · 1.000.000) */
function niceAxisScale(v) {
  if (v <= 0) return { max: 10000, steps: 4 };
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const opts = [
    [1, 4], [1.2, 4], [1.5, 5], [2, 4], [2.5, 5],
    [3, 5], [4, 4], [5, 5], [6, 4], [8, 4], [10, 4]
  ];
  for (const [m, steps] of opts) {
    if (n <= m) return { max: Math.round(m * p), steps };
  }
  return { max: Math.round(10 * p), steps: 4 };
}

/** Aşma (overshoot) yapmayan monoton kübik Bezier eğrisi (Dribbble akıcı spline) */
function monotoneSpline(pts) {
  const n = pts.length;
  if (!n) return '';
  if (n === 1) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  if (n === 2) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)},${pts[1][1].toFixed(1)}`;

  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6;
    dy[i] = pts[i + 1][1] - pts[i][1];
    m[i] = dy[i] / dx[i];
  }
  const tg = new Array(n);
  tg[0] = m[0];
  tg[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) tg[i] = 0;
    else tg[i] = (m[i - 1] + m[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(m[i]) < 1e-9) {
      tg[i] = 0;
      tg[i + 1] = 0;
    } else {
      const a = tg[i] / m[i], b = tg[i + 1] / m[i];
      const h = Math.hypot(a, b);
      if (h > 3) {
        const s = 3 / h;
        tg[i] = s * a * m[i];
        tg[i + 1] = s * b * m[i];
      }
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const seg = dx[i] / 3;
    const c1x = pts[i][0] + seg, c1y = pts[i][1] + tg[i] * seg;
    const c2x = pts[i + 1][0] - seg, c2y = pts[i + 1][1] - tg[i + 1] * seg;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

export class StackedBars {
  constructor(el) {
    this.el = el;
    this.interval = 60;
    this.data = null;
    this.focusReg = -1;     // tıklanan sabit bölge filtresi (-1 = hepsi)
    this.previewReg = -1;   // üzerine gelinen bölge (-1 = yok)
    this._animSig = '';
    this._lastShowAt = 0;
    this._animUntil = 0;
    this._deferTimer = 0;
    this._lastW = 0;
    this._lastH = 0;
    new ResizeObserver(() => {
      const w = this.el.clientWidth, h = this.el.clientHeight;
      if (!w || !h || (w === this._lastW && h === this._lastH)) return;
      this.draw(false);
    }).observe(el);
    el.addEventListener('mousemove', e => this.onMove(e));
    el.addEventListener('mouseleave', () => { hideTip(); this.hover(-1); });
    setInterval(() => {
      if (!document.hidden && this.data && Date.now() - this._lastShowAt >= 5 * 60 * 1000) {
        this.replayShow();
      }
    }, 10000);
  }

  replayShow() {
    if (this._deferTimer) {
      clearTimeout(this._deferTimer);
      this._deferTimer = 0;
    }
    this._animUntil = 0;
    this.draw(true);
  }

  set(data, animTag = '') {
    this.data = data;
    const tagChanged = animTag && animTag !== this._reqTag;
    if (animTag) this._reqTag = animTag;
    if (!tagChanged && Date.now() < this._animUntil) {
      if (!this._deferTimer) {
        this._deferTimer = setTimeout(() => {
          this._deferTimer = 0;
          this.draw(false);
        }, Math.max(200, this._animUntil - Date.now() + 80));
      }
      return;
    }
    if (Date.now() - this._lastShowAt >= 5 * 60 * 1000) this.draw(true);
    else this.draw(false);
  }

  toggleRegion(r) {
    this.focusReg = this.focusReg === r ? -1 : r;
    this.draw(true);
    return this.focusReg;
  }

  highlightRegion(r) {
    this.previewReg = r;
    this.syncSeriesFocus();
  }

  activeRegions(d) {
    const out = [];
    d.regionIds.forEach((id, r) => {
      const sumR = d.amount.reduce((acc, slotArr) => acc + (slotArr[r] || 0), 0);
      const low = String(id).toLowerCase();
      if ((low === 'other' || low.includes('diger') || low.includes('merkez')) && sumR <= 0) return;
      out.push(r);
    });
    return out.length ? out : d.regionIds.map((_, r) => r);
  }

  syncSeriesFocus() {
    const activeR = this.previewReg >= 0 ? this.previewReg : this.focusReg;
    this.el.querySelectorAll('.neon-series').forEach(g => {
      const r = +g.dataset.r;
      const isFocus = activeR >= 0 && r === activeR;
      const isDim = activeR >= 0 && r !== activeR;
      g.classList.toggle('is-focus', isFocus);
      g.classList.toggle('is-dim', isDim);
    });
  }

  draw(forceAnim = false) {
    const d = this.data;
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (!d || !W || !H) return;

    const isLive = d.nowSlot >= 0;
    const k = this.interval / d.minutes;
    const slots = d.amount.length;

    let first = slots, last = 0;
    d.amount.forEach((arr, s) => {
      if (arr.some(v => v > 0)) { first = Math.min(first, s); last = Math.max(last, s); }
    });
    if (first >= slots) first = 32;
    let s0 = Math.min(first, 32);
    let s1 = Math.max(last, isLive ? d.nowSlot : 0, 88);
    s0 = Math.floor(s0 / k) * k;
    const nb = Math.max(2, Math.ceil((s1 + 1 - s0) / k));

    const yDiff = d.yesterdayCum.map((v, i) => v - (i > 0 ? d.yesterdayCum[i - 1] : 0));
    const buckets = [];
    for (let b = 0; b < nb; b++) {
      const vals = new Array(d.regionIds.length).fill(0);
      let y = 0, cnt = 0;
      for (let s = s0 + b * k; s < s0 + (b + 1) * k && s < slots; s++) {
        d.amount[s].forEach((v, r) => (vals[r] += v));
        y += yDiff[s] || 0;
        cnt += d.count[s] || 0;
      }
      const startSlot = s0 + b * k;
      const future = isLive && startSlot > d.nowSlot;
      const now = isLive && d.nowSlot >= startSlot && d.nowSlot < startSlot + k;
      buckets.push({ vals, total: vals.reduce((a, c) => a + c, 0), y, cnt, startSlot, future, now });
    }

    const regIndices = this.activeRegions(d);
    if (this.focusReg >= 0 && !regIndices.includes(this.focusReg)) this.focusReg = -1;

    // Çizilecek dilimler (canlı modda gelecekteki saatlerde sıfıra düşmemesi için mevcut dilimde biter)
    let lastPlotIdx = buckets.length - 1;
    if (isLive) {
      lastPlotIdx = -1;
      buckets.forEach((b, idx) => { if (!b.future) lastPlotIdx = idx; });
      if (lastPlotIdx > 0 && buckets[lastPlotIdx]?.now) lastPlotIdx--;
      if (lastPlotIdx < 0) lastPlotIdx = 0;
    }

    let rawPeak = 0;
    for (let i = 0; i <= lastPlotIdx; i++) {
      for (const r of regIndices) {
        if (this.focusReg >= 0 && r !== this.focusReg) continue;
        if (buckets[i].vals[r] > rawPeak) rawPeak = buckets[i].vals[r];
      }
    }
    const { max, steps } = niceAxisScale(rawPeak * 1.08);
    const maxTxt = num(max);
    const padL = Math.max(66, Math.round(maxTxt.length * 7.4 + 16));
    const padR = 16, padT = 14, padB = 26;
    const iw = Math.max(40, W - padL - padR);
    const ih = Math.max(40, H - padT - padB);

    const X = i => padL + (nb > 1 ? (i / (nb - 1)) * iw : iw / 2);
    const Y = v => padT + ih - (Math.max(0, v) / max) * ih;
    const baseY = Y(0);

    const animSig = `${this.interval}|${isLive ? 'L' : 'H'}|${this._reqTag || ''}|${this.focusReg}`;
    const shouldAnim = forceAnim || (this._animSig !== animSig && !document.body.classList.contains('shot'));
    this._animSig = animSig;

    const stepDelay = 1.45;
    const lineDur = 1.75;
    if (shouldAnim) {
      this._lastShowAt = Date.now();
      this._animUntil = Date.now() + Math.round(((regIndices.length - 1) * stepDelay + lineDur + 0.35) * 1000);
    }

    // SVG filtreleri ve gradyanlar (dijital ışık saçan neon parlama)
    let defs = `<defs>
      <filter id="neonAura" x="-25%" y="-35%" width="150%" height="170%">
        <feGaussianBlur stdDeviation="4.8" result="b"/>
      </filter>
      <filter id="neonCore" x="-20%" y="-30%" width="140%" height="160%">
        <feGaussianBlur stdDeviation="1.9" result="g"/>
        <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <radialGradient id="chartAmbience" cx="52%" cy="38%" r="60%">
        <stop offset="0" stop-color="#38b6ff" stop-opacity=".08"/>
        <stop offset=".6" stop-color="#b565ff" stop-opacity=".03"/>
        <stop offset="1" stop-color="#000" stop-opacity="0"/>
      </radialGradient>`;

    regIndices.forEach(r => {
      const col = this.colors?.[r] || neonRegionColor(d.regionIds[r], r);
      defs += `<linearGradient id="ngArea${r}" x1="0" y1="${padT}" x2="0" y2="${baseY}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${col}" stop-opacity=".16"/>
        <stop offset=".75" stop-color="${col}" stop-opacity=".03"/>
        <stop offset="1" stop-color="${col}" stop-opacity="0"/>
      </linearGradient>`;
    });
    defs += `</defs>`;

    // Y ekseni: tam basamaklı rakamlar (ör. 1.000.000 — kısaltmasız!) + dijital ızgara
    let grid = `<rect x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="url(#chartAmbience)" stroke="none"/>`;
    grid += `<g class="grid neon-grid">`;
    let axis = `<g class="axis neon-axis">`;
    for (let i = 0; i <= steps; i++) {
      const v = (max / steps) * i;
      const y = Y(v);
      grid += `<line x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="${i === 0 ? 'zero' : ''}"/>`;
      axis += `<text x="${padL - 10}" y="${(y + 3.8).toFixed(1)}" text-anchor="end" class="y-lbl">${i === 0 ? '0' : num(v)}</text>`;
    }

    const every = Math.max(1, Math.ceil(nb / Math.max(4, Math.floor(iw / 58))));
    buckets.forEach((b, i) => {
      const x = X(i);
      if (i % every === 0) {
        grid += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${padT}" y2="${baseY.toFixed(1)}" class="v-guide"/>`;
        axis += `<text x="${x.toFixed(1)}" y="${H - 5}" text-anchor="middle" class="x-lbl">${slotLabel(b.startSlot, d.minutes)}</text>`;
      }
    });
    grid += `</g>`;
    axis += `</g>`;

    // Bölge eğrileri (her bölge kendi ışık saçan neon çizgisi + yumuşak alt ışık + nokta düğümleri)
    let seriesHtml = '';
    const showDots = lastPlotIdx <= 28;
    regIndices.forEach((r, orderIdx) => {
      const col = this.colors?.[r] || neonRegionColor(d.regionIds[r], r);
      const pts = [];
      for (let i = 0; i <= lastPlotIdx; i++) pts.push([X(i), Y(buckets[i].vals[r])]);
      if (pts.length === 1) pts.unshift([Math.max(padL, pts[0][0] - 18), pts[0][1]]);

      const linePath = monotoneSpline(pts);
      const areaPath = `${linePath} L${pts[pts.length - 1][0].toFixed(1)},${baseY.toFixed(1)} L${pts[0][0].toFixed(1)},${baseY.toFixed(1)} Z`;
      const delay = (orderIdx * stepDelay).toFixed(2);

      let dots = '';
      if (showDots) {
        for (let i = 0; i <= lastPlotIdx; i++) {
          if (buckets[i].vals[r] <= 0 && i !== lastPlotIdx) continue;
          const cx = X(i).toFixed(1), cy = Y(buckets[i].vals[r]).toFixed(1);
          const dotDelay = (orderIdx * stepDelay + (i / Math.max(1, lastPlotIdx)) * (lineDur * 0.88)).toFixed(2);
          dots += `<circle class="ns-node" cx="${cx}" cy="${cy}" r="2.3" fill="#0d0f18" stroke="${col}" stroke-width="1.6" style="--dd:${dotDelay}s"/>`;
        }
      }

      const tipPt = pts[pts.length - 1];
      const liveTip = isLive && tipPt ? `
        <circle cx="${tipPt[0].toFixed(1)}" cy="${tipPt[1].toFixed(1)}" r="4" fill="none" stroke="${col}" stroke-width="1.4" opacity=".7">
          <animate attributeName="r" values="3;9.5;3" dur="2.1s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values=".75;0;.75" dur="2.1s" repeatCount="indefinite"/>
        </circle>
        <circle cx="${tipPt[0].toFixed(1)}" cy="${tipPt[1].toFixed(1)}" r="3.1" fill="#ffffff" stroke="${col}" stroke-width="2"/>`
        : (tipPt ? `<circle cx="${tipPt[0].toFixed(1)}" cy="${tipPt[1].toFixed(1)}" r="2.8" fill="${col}" stroke="#0d0f18" stroke-width="1.4"/>` : '');
      const tipWrap = liveTip ? `<g class="ns-tip" style="--td:${(orderIdx * stepDelay + lineDur * 0.92).toFixed(2)}s">${liveTip}</g>` : '';

      seriesHtml += `<g class="neon-series ${shouldAnim ? 'anim' : ''}" data-r="${r}" style="--nc:${col};--nd:${delay}s;--dur:${lineDur}s">
        <path class="ns-area" d="${areaPath}" fill="url(#ngArea${r})" stroke="none"/>
        <path class="ns-aura" d="${linePath}" fill="none" stroke="${col}" stroke-width="6.5" stroke-opacity=".22" stroke-linecap="round" stroke-linejoin="round" filter="url(#neonAura)" pathLength="1"/>
        <path class="ns-line" d="${linePath}" fill="none" stroke="${col}" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round" filter="url(#neonCore)" pathLength="1"/>
        ${dots}
        ${tipWrap}
      </g>`;
    });

    // Canlı saat dikey lazer çizgisi
    const nowX = X(lastPlotIdx);
    const nowLine = isLive ? `<line class="nowline neon-now" x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="${padT}" y2="${baseY.toFixed(1)}"/>` : '';

    // Etkileşimli hover katmanı (dikey lazer kılavuz + her bölgenin üzerinde parlayan odak halkası)
    let hoverDots = '';
    regIndices.forEach(r => {
      const col = this.colors?.[r] || neonRegionColor(d.regionIds[r], r);
      hoverDots += `<circle class="ns-hdot" data-hr="${r}" r="4.6" fill="${col}" stroke="#ffffff" stroke-width="2" filter="url(#neonCore)"/>`;
    });
    const hoverLayer = `<g class="ns-hover" id="nsHover" style="opacity:0;pointer-events:none">
      <line class="ns-vline" y1="${padT}" y2="${baseY.toFixed(1)}"/>
      ${hoverDots}
    </g>`;

    this.el.innerHTML = `<svg class="neon-chart-svg" viewBox="0 0 ${W} ${H}">${defs}${grid}${seriesHtml}${nowLine}${hoverLayer}${axis}</svg>`;
    this.buckets = buckets;
    this.regIndices = regIndices;
    this.geom = { padL, padR, padT, baseY, iw, nb, lastPlotIdx, X, Y };
    this._lastW = W;
    this._lastH = H;
    this.syncSeriesFocus();
  }

  onMove(e) {
    const g = this.geom, d = this.data;
    if (!g || !d || !this.buckets?.length) return;
    const rect = this.el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (mx < g.padL - 8 || mx > g.padL + g.iw + 8) { hideTip(); this.hover(-1); return; }
    const ratio = Math.max(0, Math.min(1, (mx - g.padL) / Math.max(1, g.iw)));
    let idx = Math.round(ratio * (g.nb - 1));
    if (d.nowSlot >= 0 && idx > g.lastPlotIdx) idx = g.lastPlotIdx;
    this.hover(idx);
    this.tipFor(idx, e);
  }

  hover(i) {
    const hv = this.el.querySelector('#nsHover');
    const g = this.geom;
    if (!hv || !g) return;
    if (i < 0 || !this.buckets?.[i]) {
      hv.style.opacity = '0';
      return;
    }
    const x = g.X(i);
    const vline = hv.querySelector('.ns-vline');
    if (vline) { vline.setAttribute('x1', x.toFixed(1)); vline.setAttribute('x2', x.toFixed(1)); }
    const b = this.buckets[i];
    hv.querySelectorAll('.ns-hdot').forEach(c => {
      const r = +c.dataset.hr;
      const show = this.focusReg < 0 || this.focusReg === r;
      c.style.display = show ? '' : 'none';
      c.setAttribute('cx', x.toFixed(1));
      c.setAttribute('cy', g.Y(b.vals[r]).toFixed(1));
    });
    hv.style.opacity = '1';
  }

  tipFor(i, e) {
    const b = this.buckets[i], d = this.data;
    if (!b || !d) return;
    const k = this.interval / d.minutes;
    const ranked = (this.regIndices || d.regionIds.map((_, r) => r))
      .map(r => ({ r, v: b.vals[r], col: this.colors?.[r] || neonRegionColor(d.regionIds[r], r), name: this.names?.[r] || d.regionIds[r] }))
      .sort((a, z) => z.v - a.v);

    const rows = ranked.map(it =>
      `<div class="tr ${this.focusReg === it.r ? 'sel' : ''}"><span><i style="background:${it.col};box-shadow:0 0 8px ${it.col}"></i>${esc(it.name)}</span><b>${money(it.v)}</b></div>`
    ).join('');

    showTip(`<h4>${slotLabel(b.startSlot, d.minutes)} – ${slotLabel(b.startSlot + k, d.minutes)}${b.now ? ' <small style="color:#00f5d4">· CANLI</small>' : ''}</h4>${rows}
      <div class="tr" style="border-top:1px solid rgba(255,255,255,.12);margin-top:5px;padding-top:6px"><span>Toplam · ${num(b.cnt)} fiş</span><b>${money(b.total)}</b></div>
      ${b.y > 0 ? `<div class="tr"><span style="color:#8d8d9c">Dün aynı aralık</span><b style="color:#8d8d9c">${money(b.y)}</b></div>` : ''}`, e.clientX, e.clientY);
  }
}

// ------------------------------------------------------------------ gül (rose) pasta
export const PAY_COLORS = { kart: '#28a8ff', nakit: '#5cd61c', yemek: '#ffb800', furpa: '#ff3642', online: '#f02482', diger: '#9c62ff' };
const PAY_GRAD = {
  kart: ['#47d1ff', '#1b5be0'],
  nakit: ['#84ed2b', '#278f14'],
  yemek: ['#ffe629', '#ff6600'],
  furpa: ['#ff525c', '#b50e1a'],
  online: ['#ff429e', '#a30d58'],
  diger: ['#bd8cff', '#5c29b8']
};

export class Rose {
  constructor(el) {
    this.el = el;
    this.cur = new Map();
    this.raf = 0;
    this.hitKey = null;
    this.hitUntil = 0;
    new ResizeObserver(() => this.draw(true)).observe(el);
    el.addEventListener('mouseleave', hideTip);
  }

  set(groups) {
    const prev = this.groups;
    this.groups = groups;
    let changed = false;
    let hotKey = null, hotDiff = 0;
    if (prev && groups) {
      const pm = new Map(prev.map(x => [x.key, x.amount]));
      for (const x of groups) {
        const d = x.amount - (pm.get(x.key) ?? 0);
        if (Math.abs(d) > 0.01) changed = true;
        if (d > hotDiff) { hotDiff = d; hotKey = x.key; }
      }
    } else if (groups) {
      changed = true;
    }
    if (hotKey) {
      this.hitKey = hotKey;
      this.hitUntil = performance.now() + 750;
    }
    if (!changed && this.el.firstChild) return;
    this.animateToTarget();
  }

  animateToTarget() {
    if (this.raf) cancelAnimationFrame(this.raf);
    const g = this.groups;
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (!g || !W || !H) return;
    const total = g.reduce((a, x) => a + x.amount, 0);
    if (total <= 0 || document.hidden || document.body.classList.contains('shot')) {
      this.draw(true);
      return;
    }
    const cnt = Math.max(...g.map(x => x.count), 1);
    const R = Math.min(W, H) / 2 - 14;
    let a0 = -Math.PI / 2;
    const targets = new Map();
    g.forEach(x => {
      const da = (x.amount / total) * Math.PI * 2;
      const r = R * (0.58 + 0.42 * Math.sqrt(x.count / cnt));
      targets.set(x.key, { x, a0, a1: a0 + da, r });
      a0 += da;
    });

    const starts = new Map();
    targets.forEach((t, k) => {
      const prev = this.cur.get(k);
      starts.set(k, prev ? { ...prev } : { a0: t.a0, a1: t.a0, r: R * 0.45 });
    });

    const t0 = performance.now();
    const dur = 480;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      const frameSlices = [];
      targets.forEach((t, k) => {
        const s = starts.get(k);
        const cur = {
          x: t.x,
          a0: s.a0 + (t.a0 - s.a0) * e,
          a1: s.a1 + (t.a1 - s.a1) * e,
          r: s.r + (t.r - s.r) * e
        };
        this.cur.set(k, { a0: cur.a0, a1: cur.a1, r: cur.r });
        frameSlices.push(cur);
      });
      this.renderSlices(frameSlices, total, now < this.hitUntil ? (this.hitUntil - now) / 750 : 0);
      if (p < 1 || now < this.hitUntil) {
        this.raf = requestAnimationFrame(step);
      } else {
        this.raf = 0;
        this.hitKey = null;
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  draw(immediate = false) {
    if (immediate && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    const g = this.groups, W = this.el.clientWidth, H = this.el.clientHeight;
    if (!g || !W || !H) return;
    const total = g.reduce((a, x) => a + x.amount, 0);
    if (total <= 0) {
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 14;
      let out = '';
      [0.35, 0.55, 0.75, 1].forEach(f => (out += `<circle class="guide" cx="${cx}" cy="${cy}" r="${R * f}"/>`));
      this.el.innerHTML = `<svg>${out}<text x="${cx}" y="${cy}" text-anchor="middle">veri bekleniyor</text></svg>`;
      return;
    }
    const cnt = Math.max(...g.map(x => x.count), 1);
    const R = Math.min(W, H) / 2 - 14;
    let a0 = -Math.PI / 2;
    const slices = [];
    g.forEach(x => {
      const da = (x.amount / total) * Math.PI * 2;
      const r = R * (0.58 + 0.42 * Math.sqrt(x.count / cnt));
      this.cur.set(x.key, { a0, a1: a0 + da, r });
      slices.push({ x, a0, a1: a0 + da, r });
      a0 += da;
    });
    this.renderSlices(slices, total, 0);
  }

  renderSlices(slices, total, hitGlow) {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (!W || !H) return;

    const tilt = 0.80;
    const depthH = Math.max(14, Math.min(26, Math.round(Math.min(W, H) * 0.11)));
    const explodeBase = Math.max(8, Math.min(15, Math.round(Math.min(W, H) * 0.052)));
    const rxMax = Math.max(30, Math.min(W * 0.42 - explodeBase * 0.5, (H - depthH - 18) / (2 * tilt) - explodeBase * 0.5));
    const ryMax = rxMax * tilt;
    const cx = W / 2;
    const cy = H / 2 - depthH * 0.46;

    const activeSlices = slices.filter(s => s.x.amount > 0 && s.a1 - s.a0 > 1e-4);
    const maxR = Math.max(...activeSlices.map(s => s.r), 1);

    // Back-to-front painter's order by vertical center of slice
    const ordered = activeSlices.map((s, idx) => {
      const mid = (s.a0 + s.a1) / 2;
      return { s, idx, mid, z: Math.sin(mid) };
    }).sort((a, b) => a.z - b.z);

    let defs = `<defs>
      <filter id="pieShadow" x="-25%" y="-25%" width="150%" height="165%">
        <feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="#000000" flood-opacity="0.65"/>
      </filter>
      <linearGradient id="pieGloss" x1="0" y1="0" x2="0.85" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
        <stop offset="0.38" stop-color="#ffffff" stop-opacity="0.06"/>
        <stop offset="0.72" stop-color="#000000" stop-opacity="0.14"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0.28"/>
      </linearGradient>`;

    ordered.forEach(({ s, idx }) => {
      const col = PAY_COLORS[s.x.key] || '#888';
      const [cHi, cLo] = PAY_GRAD[s.x.key] || [col, col];
      defs += `
        <radialGradient id="pTop${idx}" cx="45%" cy="35%" r="70%">
          <stop offset="0" stop-color="${cHi}"/>
          <stop offset="1" stop-color="${cLo}"/>
        </radialGradient>
        <linearGradient id="pWall${idx}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${cLo}"/>
          <stop offset="1" stop-color="#07070c"/>
        </linearGradient>`;
    });
    defs += '</defs>';

    const pt = (ox, oy, rx, ry, a) => [ox + Math.cos(a) * rx, oy + Math.sin(a) * ry];

    const topPath = (ox, oy, rx, ry, a0, a1) => {
      const [x0, y0] = pt(ox, oy, rx, ry, a0);
      const [x1, y1] = pt(ox, oy, rx, ry, a1);
      if (a1 - a0 >= Math.PI * 2 - 1e-5) {
        return `M${ox - rx},${oy} A${rx},${ry} 0 1,0 ${ox + rx},${oy} A${rx},${ry} 0 1,0 ${ox - rx},${oy} Z`;
      }
      const large = a1 - a0 > Math.PI ? 1 : 0;
      return `M${ox},${oy} L${x0.toFixed(2)},${y0.toFixed(2)} A${rx.toFixed(2)},${ry.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
    };

    const innerRimPath = (ox, oy, rx, ry, a0, a1) => {
      const irx = rx * 0.90, iry = ry * 0.90;
      const [x0, y0] = pt(ox, oy, irx, iry, a0);
      const [x1, y1] = pt(ox, oy, irx, iry, a1);
      if (a1 - a0 >= Math.PI * 2 - 1e-5) {
        return `M${ox - irx},${oy} A${irx},${iry} 0 1,0 ${ox + irx},${oy} A${irx},${iry} 0 1,0 ${ox - irx},${oy}`;
      }
      const large = a1 - a0 > Math.PI ? 1 : 0;
      return `M${x0.toFixed(2)},${y0.toFixed(2)} A${irx.toFixed(2)},${iry.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
    };

    const frontRanges = (a0, a1) => {
      const segs = [];
      for (const [f0, f1] of [[0, Math.PI], [Math.PI * 2, Math.PI * 3]]) {
        const s0 = Math.max(a0, f0), s1 = Math.min(a1, f1);
        if (s1 - s0 > 1e-4) segs.push([s0, s1]);
      }
      return segs;
    };

    const outerWallPath = (ox, oy, rx, ry, a0, a1) => {
      const [x0, y0] = pt(ox, oy, rx, ry, a0);
      const [x1, y1] = pt(ox, oy, rx, ry, a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      return `M${x0.toFixed(2)},${y0.toFixed(2)} A${rx.toFixed(2)},${ry.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${x1.toFixed(2)},${(y1 + depthH).toFixed(2)} A${rx.toFixed(2)},${ry.toFixed(2)} 0 ${large} 0 ${x0.toFixed(2)},${(y0 + depthH).toFixed(2)} Z`;
    };

    const cutWallPath = (ox, oy, rx, ry, a) => {
      const [x, y] = pt(ox, oy, rx, ry, a);
      return `M${ox.toFixed(2)},${oy.toFixed(2)} L${x.toFixed(2)},${y.toFixed(2)} L${x.toFixed(2)},${(y + depthH).toFixed(2)} L${ox.toFixed(2)},${(oy + depthH).toFixed(2)} Z`;
    };

    let shadows = '', bodies = '';
    ordered.forEach(({ s, idx, mid }) => {
      const col = PAY_COLORS[s.x.key] || '#888';
      const isHit = hitGlow > 0 && s.x.key === this.hitKey;
      const scale = 0.86 + 0.14 * (s.r / maxR);
      const rx = rxMax * scale;
      const ry = ryMax * scale;
      const exp = explodeBase + (isHit ? 7 * Math.sin(hitGlow * Math.PI) : 0);
      const ox = cx + Math.cos(mid) * exp;
      const oy = cy + Math.sin(mid) * exp * tilt;

      const tPath = topPath(ox, oy, rx, ry, s.a0, s.a1);
      shadows += `<path d="${topPath(ox, oy + depthH + 2, rx, ry, s.a0, s.a1)}" fill="rgba(0,0,0,0.42)"/>`;

      let walls = '';
      if (s.a1 - s.a0 < Math.PI * 2 - 1e-5) {
        walls += `<path d="${cutWallPath(ox, oy, rx, ry, s.a0)}" fill="${col}" filter="brightness(0.52)" stroke="rgba(0,0,0,0.35)" stroke-width="0.7"/>`;
        walls += `<path d="${cutWallPath(ox, oy, rx, ry, s.a1)}" fill="${col}" filter="brightness(0.42)" stroke="rgba(0,0,0,0.35)" stroke-width="0.7"/>`;
      }
      frontRanges(s.a0, s.a1).forEach(([f0, f1]) => {
        walls += `<path d="${outerWallPath(ox, oy, rx, ry, f0, f1)}" fill="url(#pWall${idx})" stroke="rgba(255,255,255,0.12)" stroke-width="0.6"/>`;
      });

      const glowStyle = isHit
        ? ` style="filter:drop-shadow(0 0 ${(14 * hitGlow).toFixed(1)}px ${col}) brightness(${(1 + 0.28 * hitGlow).toFixed(2)})"`
        : '';

      bodies += `<g class="slice${isHit ? ' hit' : ''}" data-i="${idx}"${glowStyle}>
        ${walls}
        <path d="${tPath}" fill="url(#pTop${idx})"/>
        <path d="${tPath}" fill="url(#pieGloss)" stroke="rgba(255,255,255,0.48)" stroke-width="1.15" stroke-linejoin="round"/>
        <path d="${innerRimPath(ox, oy, rx, ry, s.a0, s.a1)}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
      </g>`;
    });

    this.el.innerHTML = `<svg style="overflow:visible">${defs}<g filter="url(#pieShadow)">${shadows}</g>${bodies}</svg>`;
    const svg = this.el.firstElementChild;
    if (svg) {
      svg.onmousemove = e => {
        const p = e.target.closest('.slice');
        if (!p) { hideTip(); return; }
        const s = activeSlices[+p.dataset.i]?.x;
        if (!s) return;
        const items = s.items.slice(0, 6).map(it => `<div class="tr"><span>${esc(it.name)}</span><b>${money(it.amount)}</b></div>`).join('');
        showTip(`<h4>${esc(s.name)} · %${((s.amount / total) * 100).toFixed(1).replace('.', ',')}</h4>
          <div class="tr"><span>Tutar</span><b>${money(s.amount)}</b></div><div class="tr"><span>Ödeme adedi</span><b>${num(s.count)}</b></div>
          ${items ? '<div style="border-top:1px solid rgba(255,255,255,.1);margin:6px 0 4px"></div>' + items : ''}`, e.clientX, e.clientY);
      };
    }
  }
}

// ------------------------------------------------------------------ parçacık küresi
export class Orb {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.energy = 0;
    this.rot = 0;
    const N = 1500, pts = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
      pts.push([Math.cos(th) * r, y, Math.sin(th) * r, Math.random()]);
    }
    this.pts = pts;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = t => { this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = this.c.clientWidth; this.h = this.c.clientHeight;
    this.c.width = this.w * dpr; this.c.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  kick(v = 1) { this.energy = Math.min(2.5, this.energy + v); }
  frame(t) {
    if (document.hidden || !this.w || !this.c.offsetParent) return;
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2, R0 = Math.min(w, h) / 2;
    this.energy *= 0.965;
    this.rot += 0.0038 + this.energy * 0.0065;
    ctx.clearRect(0, 0, w, h);

    // dış halkalar
    ctx.strokeStyle = 'rgba(255,255,255,.09)';
    ctx.lineWidth = 1;
    [0.98, 0.87].forEach(f => { ctx.beginPath(); ctx.arc(cx, cy, R0 * f, 0, Math.PI * 2); ctx.stroke(); });
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2 + t / 9000;
      const r1 = R0 * .905, r2 = R0 * (i % 6 === 0 ? .96 : .93);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    }

    // iç parıltı (büyütülmüş küreye uygun)
    const R = R0 * (0.96 + this.energy * 0.045);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R0 * 0.94);
    glow.addColorStop(0, `rgba(175,200,255,${0.42 + this.energy * 0.16})`);
    glow.addColorStop(.52, 'rgba(110,105,255,.16)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, R0 * 0.94, 0, Math.PI * 2); ctx.fill();

    // parçacıklar
    const cr = Math.cos(this.rot), sr = Math.sin(this.rot), tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
    for (const [x, y, z, ph] of this.pts) {
      const jitter = 1 + Math.sin(t / 600 + ph * 20) * 0.026 * (1 + this.energy);
      let X = x * cr - z * sr, Z = x * sr + z * cr;
      let Y = y * ct - Z * st; Z = y * st + Z * ct;
      const p = 1.6 / (2.6 - Z);
      const px = cx + X * R * p * jitter, py = cy + Y * R * p * jitter;
      const a = 0.17 + (Z + 1) * 0.43;
      ctx.fillStyle = Z > 0.2 ? `rgba(240,245,255,${a})` : `rgba(142,158,255,${a * 0.84})`;
      const s = Z > 0.6 ? 2.0 : Z > 0 ? 1.5 : 1.15;
      ctx.fillRect(px, py, s, s);
    }
    // çekirdek
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * .38);
    core.addColorStop(0, 'rgba(255,255,255,.97)');
    core.addColorStop(.4, 'rgba(200,215,255,.4)');
    core.addColorStop(1, 'rgba(120,120,255,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, R * .38, 0, Math.PI * 2); ctx.fill();
  }
}

// ------------------------------------------------------------------ canlı akış ağı (çift kanatlı fiber çizgiler)
export class Network {
  constructor(root) {
    this.root = root;
    this.svg = root.querySelector('#fibers');
    this.listL = root.querySelector('#netListLeft');
    this.listR = root.querySelector('#netListRight');
    this.hub = root.querySelector('#hubChip');
    this.orb = root.querySelector('#orbWrap');
    this.paths = new Map();
    this.pulses = [];
    const ro = new ResizeObserver(() => this.layout());
    ro.observe(root);
    if (this.orb) ro.observe(this.orb);
    const loop = t => { this.animate(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  set(stores, regionColor) {
    const perSide = Math.max(12, Math.floor((this.root.clientHeight * 0.93) / 18.5));
    const top = document.body.classList.contains('fs') ? stores : stores.slice(0, perSide * 2);
    const half = Math.ceil(top.length / 2);
    const left = top.slice(0, half);
    const right = top.slice(half);
    const sig = left.map(s => s.id).join(',') + '|' + right.map(s => s.id).join(',');
    if (sig !== this.sig) {
      this.listL.innerHTML = left.map(s => {
        const col = regionColor(s.region);
        return `<li data-id="${esc(s.id)}"><span class="nc"></span><span class="nv">${money(s.ciro)}</span><span class="nn">${esc(s.name)}</span><span class="nd" style="color:${col};background:${col}"></span></li>`;
      }).join('');
      this.listR.innerHTML = right.map(s => {
        const col = regionColor(s.region);
        return `<li data-id="${esc(s.id)}"><span class="nd" style="color:${col};background:${col}"></span><span class="nn">${esc(s.name)}</span><span class="nv">${money(s.ciro)}</span><span class="nc"></span></li>`;
      }).join('');
      this.sig = sig;
      requestAnimationFrame(() => this.layout());
    }
    let needLayout = false;
    top.forEach(s => {
      const li = this.root.querySelector(`.net-list li[data-id="${CSS.escape(s.id)}"]`);
      if (!li) return;
      const off = !!s.offline;
      const wasOff = li.classList.contains('offline');
      li.classList.toggle('offline', off);
      if (off) {
        li.title = 'Bağlantı yok · şubeden veri alınamıyor';
        li.querySelector('.nv').textContent = s.ciro > 0 ? money(s.ciro) : 'Bağlantı yok';
        li.querySelector('.nc').innerHTML = `<svg class="no-conn-ico" viewBox="0 0 24 24"><path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.17-2.66M19 13a10 10 0 0 0-2.17-1.66M12 20h.01"/></svg>`;
      } else {
        li.removeAttribute('title');
        li.querySelector('.nv').textContent = money(s.ciro);
        li.querySelector('.nc').textContent = s.lastHourCiro > 0 ? '▲ ' + money(s.lastHourCiro) : '';
      }
      if (wasOff !== off) needLayout = true;
    });
    if (needLayout) requestAnimationFrame(() => this.layout());
  }

  layout() {
    const box = this.root.getBoundingClientRect();
    if (!box.width || !this.orb) return;
    this.svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const ob = this.orb.getBoundingClientRect();
    if (!ob.width) return;

    const cy = ob.top - box.top + ob.height / 2;
    const lb = this.listL.getBoundingClientRect();
    const rb = this.listR.getBoundingClientRect();

    const lx0 = ob.left - box.left + ob.width * 0.04;
    const lEdge = lb.right - box.left;
    const lx1 = lx0 - Math.max(16, (lx0 - lEdge) * 0.28);

    const rx0 = ob.right - box.left - ob.width * 0.04;
    const rEdge = rb.left - box.left;
    const rx1 = rx0 + Math.max(16, (rEdge - rx0) * 0.28);

    let html = `<defs>
      <linearGradient id="beamGradL" gradientUnits="userSpaceOnUse" x1="${lx0}" y1="${cy}" x2="${lx1}" y2="${cy}"><stop offset="0" stop-color="#6f8bff" stop-opacity=".05"/><stop offset="1" stop-color="#7fb6ff" stop-opacity=".95"/></linearGradient>
      <linearGradient id="beamGradR" gradientUnits="userSpaceOnUse" x1="${rx0}" y1="${cy}" x2="${rx1}" y2="${cy}"><stop offset="0" stop-color="#6f8bff" stop-opacity=".05"/><stop offset="1" stop-color="#7fb6ff" stop-opacity=".95"/></linearGradient>
      <linearGradient id="fadeGradL" gradientUnits="userSpaceOnUse" x1="${lx1}" y1="${cy}" x2="${lEdge}" y2="${cy}"><stop offset="0" stop-color="#ffffff" stop-opacity=".58"/><stop offset="1" stop-color="#ffffff" stop-opacity=".16"/></linearGradient>
      <linearGradient id="fadeGradR" gradientUnits="userSpaceOnUse" x1="${rx1}" y1="${cy}" x2="${rEdge}" y2="${cy}"><stop offset="0" stop-color="#ffffff" stop-opacity=".58"/><stop offset="1" stop-color="#ffffff" stop-opacity=".16"/></linearGradient>
    </defs>`;

    html += `<path class="beam" stroke="url(#beamGradL)" d="M${lx0},${cy} L${lx1},${cy}"/>`;
    html += `<path class="beam" stroke="url(#beamGradR)" d="M${rx0},${cy} L${rx1},${cy}"/>`;
    html += `<path id="p_hub_l" d="M${lx0},${cy} L${lx1},${cy}" stroke="rgba(150,190,255,.65)"/>`;
    html += `<path id="p_hub_r" d="M${rx0},${cy} L${rx1},${cy}" stroke="rgba(150,190,255,.65)"/>`;

    this.paths.clear();
    this.listL.querySelectorAll('li').forEach(li => {
      const d = li.querySelector('.nd').getBoundingClientRect();
      const x = d.right - box.left - d.width / 2, y = d.top - box.top + d.height / 2;
      const c1 = lx1 - (lx1 - x) * .45, c2 = lx1 - (lx1 - x) * .55;
      const id = 'pl_' + li.dataset.id;
      const dead = li.classList.contains('offline');
      html += `<path id="${esc(id)}"${dead ? ' class="dead"' : ''} d="M${lx1},${cy} C${c1},${cy} ${c2},${y} ${x},${y}" stroke="${dead ? 'rgba(255, 84, 104, .35)' : 'url(#fadeGradL)'}"/>`;
    });
    this.listR.querySelectorAll('li').forEach(li => {
      const d = li.querySelector('.nd').getBoundingClientRect();
      const x = d.left - box.left + d.width / 2, y = d.top - box.top + d.height / 2;
      const c1 = rx1 + (x - rx1) * .45, c2 = rx1 + (x - rx1) * .55;
      const id = 'pr_' + li.dataset.id;
      const dead = li.classList.contains('offline');
      html += `<path id="${esc(id)}"${dead ? ' class="dead"' : ''} d="M${rx1},${cy} C${c1},${cy} ${c2},${y} ${x},${y}" stroke="${dead ? 'rgba(255, 84, 104, .35)' : 'url(#fadeGradR)'}"/>`;
    });

    html += `<circle class="node-ring" cx="${lx1}" cy="${cy}" r="3.4"/>`;
    html += `<circle class="node-ring" cx="${rx1}" cy="${cy}" r="3.4"/>`;

    this.svg.innerHTML = html;
    this.hubPathL = this.svg.querySelector('#p_hub_l');
    this.hubPathR = this.svg.querySelector('#p_hub_r');
    this.listL.querySelectorAll('li').forEach(li => {
      const p = this.svg.querySelector('#' + CSS.escape('pl_' + li.dataset.id));
      if (p) this.paths.set(li.dataset.id, { path: p, hub: this.hubPathL, li });
    });
    this.listR.querySelectorAll('li').forEach(li => {
      const p = this.svg.querySelector('#' + CSS.escape('pr_' + li.dataset.id));
      if (p) this.paths.set(li.dataset.id, { path: p, hub: this.hubPathR, li });
    });
  }

  pulse(storeId, color, ambient = false) {
    if ((!this.hubPathL && !this.hubPathR) || this.pulses.length > 90) return;
    const entry = this.paths.get(storeId);
    const hub = entry?.hub || (Math.random() < 0.5 ? this.hubPathL : this.hubPathR);
    if (!hub) return;
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', ambient ? '1.9' : '3.2');
    dot.setAttribute('class', 'pulse');
    dot.setAttribute('fill', color);
    dot.setAttribute('opacity', ambient ? '.68' : '1');
    dot.style.filter = `drop-shadow(0 0 ${ambient ? 3 : 6}px ${color})`;
    this.svg.appendChild(dot);
    this.pulses.push({ dot, t0: performance.now(), hub, target: entry?.path || null, li: entry?.li || null, ambient, hubHit: false });
  }

  animate(t) {
    if (!this.pulses.length) return;
    this.pulses = this.pulses.filter(p => {
      const dt = (t - p.t0) / 1000;
      let path, k;
      if (dt < 0.45) { path = p.hub; k = dt / 0.45; }
      else if (p.target && dt < 1.65) {
        if (!p.hubHit && !p.ambient && this.hub) {
          p.hubHit = true;
          this.hub.classList.add('pulse');
          clearTimeout(this.hubTimer);
          this.hubTimer = setTimeout(() => this.hub.classList.remove('pulse'), 380);
        }
        path = p.target; k = (dt - 0.45) / 1.2;
      }
      else {
        p.dot.remove();
        if (p.li && !p.ambient) {
          p.li.classList.add('blink');
          setTimeout(() => p.li.classList.remove('blink'), 800);
        }
        return false;
      }
      try {
        const L = path.getTotalLength();
        const pt = path.getPointAtLength(L * (1 - Math.pow(1 - k, 2)));
        p.dot.setAttribute('cx', pt.x); p.dot.setAttribute('cy', pt.y);
      } catch { }
      return true;
    });
  }
}

// ------------------------------------------------------------------ para / altın ₺ efekt motoru
export class CashFx {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas?.getContext('2d');
    this.items = [];
    this.rings = [];
    this.running = false;
    if (canvas) {
      const resize = () => {
        const dpr = Math.min(devicePixelRatio || 1, 2);
        this.w = innerWidth; this.h = innerHeight;
        canvas.width = this.w * dpr; canvas.height = this.h * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      addEventListener('resize', resize);
      resize();
    }
  }

  burst(el, amount = 500, scale = 1) {
    if (!this.ctx || !el || document.hidden || document.body.classList.contains('shot')) return;
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) return;

    const power = Math.min(2.4, Math.max(0.75, Math.log10(Math.max(50, amount)) / 2.6)) * scale;
    const nCoins = Math.min(18, Math.round(4 * power));
    const nSyms = Math.min(8, Math.round(2.5 * power));
    const nSparks = Math.min(24, Math.round(9 * power));

    const cx = r.left + Math.min(r.width * 0.52, 130);
    const cy = r.top + r.height * 0.45;
    this.rings.push({ x: cx, y: cy, r: 8, maxR: 58 * power, life: 0, maxLife: 0.65 });

    for (let i = 0; i < nCoins; i++) {
      this.items.push({
        kind: 'coin',
        x: r.left + Math.random() * Math.min(r.width * 0.9, 220),
        y: r.top + r.height * (0.25 + Math.random() * 0.5),
        vx: (Math.random() - 0.42) * 2.4 * power,
        vy: -(1.8 + Math.random() * 2.8) * power,
        g: 0.055,
        rad: 4.2 + Math.random() * 3.2,
        spin: Math.random() * Math.PI * 2,
        vspin: 0.16 + Math.random() * 0.18,
        life: 0,
        maxLife: 0.95 + Math.random() * 0.55
      });
    }

    for (let i = 0; i < nSyms; i++) {
      const gold = Math.random() < 0.62;
      this.items.push({
        kind: 'sym',
        x: r.left + 10 + Math.random() * Math.min(r.width * 0.85, 210),
        y: r.top + r.height * (0.15 + Math.random() * 0.45),
        vx: (Math.random() - 0.5) * 1.1,
        vy: -(1.1 + Math.random() * 1.6),
        g: -0.008,
        size: 12 + Math.random() * 7 * Math.min(1.4, power),
        col: gold ? '#ffe066' : '#5ef5ad',
        sway: Math.random() * 6,
        life: 0,
        maxLife: 1.05 + Math.random() * 0.45
      });
    }

    for (let i = 0; i < nSparks; i++) {
      const a = -Math.PI * (0.12 + Math.random() * 0.76);
      const sp = (1.6 + Math.random() * 3.4) * power;
      this.items.push({
        kind: 'spark',
        x: r.left + Math.random() * Math.min(r.width * 0.9, 220),
        y: r.top + r.height * 0.45,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        g: 0.04,
        size: 1.4 + Math.random() * 2,
        col: Math.random() < 0.65 ? '#ffe57f' : '#6ff7b4',
        life: 0,
        maxLife: 0.65 + Math.random() * 0.45
      });
    }

    if (this.items.length > 260) this.items.splice(0, this.items.length - 260);
    if (!this.running) {
      this.running = true;
      this.lastT = performance.now();
      requestAnimationFrame(t => this.frame(t));
    }
  }

  frame(t) {
    const dt = Math.max(0.001, Math.min(0.05, (t - this.lastT) / 1000 || 0.016));
    this.lastT = t;
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    this.rings = this.rings.filter(rg => {
      rg.life += dt;
      const k = rg.life / rg.maxLife;
      if (k >= 1) return false;
      const rad = Math.max(1, rg.r + (rg.maxR - rg.r) * (1 - Math.pow(1 - k, 3)));
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 2 * (1 - k * 0.6);
      ctx.beginPath();
      ctx.ellipse(rg.x, rg.y, rad * 1.45, rad * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return true;
    });

    this.items = this.items.filter(p => {
      p.life += dt;
      const k = p.life / p.maxLife;
      if (k >= 1) return false;
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      const alpha = k < 0.15 ? k / 0.15 : 1 - Math.pow((k - 0.15) / 0.85, 1.6);

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      if (p.kind === 'coin') {
        p.spin += p.vspin;
        const sx = Math.max(0.18, Math.abs(Math.cos(p.spin)));
        ctx.translate(p.x, p.y);
        ctx.scale(sx, 1);
        const grd = ctx.createRadialGradient(-p.rad * 0.3, -p.rad * 0.3, 0.5, 0, 0, p.rad);
        grd.addColorStop(0, '#fff9d6');
        grd.addColorStop(0.5, '#ffd54a');
        grd.addColorStop(1, '#d98a00');
        ctx.fillStyle = grd;
        ctx.shadowColor = '#ffd54a';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(0, 0, p.rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff5b8';
        ctx.lineWidth = 0.9;
        ctx.stroke();
      } else if (p.kind === 'sym') {
        const dx = Math.sin(p.life * 5 + p.sway) * 4;
        ctx.font = `700 ${p.size.toFixed(1)}px "Segoe UI", sans-serif`;
        ctx.fillStyle = p.col;
        ctx.shadowColor = p.col;
        ctx.shadowBlur = 12;
        ctx.fillText('₺', p.x + dx, p.y);
      } else {
        ctx.fillStyle = p.col;
        ctx.shadowColor = p.col;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - k * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return true;
    });

    if (this.items.length || this.rings.length) requestAnimationFrame(nt => this.frame(nt));
    else this.running = false;
  }
}

// Kristal kasa sesi (Web Audio API — dış ses dosyası gerektirmez)
let audioCtx = null;
let lastChimeAt = 0;
export function playCashChime(amount = 500) {
  const nowMs = performance.now();
  if (nowMs - lastChimeAt < 140) return;
  lastChimeAt = nowMs;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const notes = amount >= 3000 ? [1046.5, 1318.5, 1568.0, 2093.0] : [1174.7, 1568.0];
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0 + i * 0.055);
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.055);
      gain.gain.exponentialRampToValueAtTime(amount >= 3000 ? 0.065 : 0.04, t0 + i * 0.055 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.055 + 0.36);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0 + i * 0.055);
      osc.stop(t0 + i * 0.055 + 0.38);
    });
  } catch { }
}

// ------------------------------------------------------------------ konfeti
export function confetti(ms = 4500) {
  const c = document.getElementById('confetti'), ctx = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight;
  const colors = ['#f5c518', '#3fa3ff', '#8a6cff', '#3fd18b', '#ffffff', '#ff5468'];
  const P = Array.from({ length: 260 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .35,
    vx: (Math.random() - .5) * 18, vy: -Math.random() * 16 - 4,
    s: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - .5) * .3,
    c: colors[(Math.random() * colors.length) | 0]
  }));
  const t0 = performance.now();
  const step = t => {
    const k = (t - t0) / ms;
    ctx.clearRect(0, 0, c.width, c.height);
    if (k >= 1) return;
    for (const p of P) {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.globalAlpha = 1 - Math.max(0, k - .7) / .3;
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
