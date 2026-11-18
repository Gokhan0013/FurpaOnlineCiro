// FURPA Online — canlı ciro ekranı
import * as F from './fmt.js?v=7';
import { CashFx, Network, Orb, PAY_COLORS, Rose, StackedBars, artCandles, artDots, artLines, artWave, confetti, hideTip, neonRegionColor, playCashChime, showTip, sparkline } from './charts.js?v=35';
import { renderReportView } from './report.js?v=8';
import { renderBulkView } from './bulk.js?v=6';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let S = null;               // ekranda gösterilen snapshot (canlı veya geçmiş)
let liveSnap = null;        // en son canlı snapshot (geçmiş görünümdeyken de güncel tutulur)
let skew = 0;               // sunucu saati - istemci saati (ms)
let prevCiro = null;        // kutlamalar için
let lastSnapAt = 0;         // son snapshot alım zamanı (istemci ms)
let lastLiveDataAt = null;  // ekrana düşen en son fiş zamanı (sıfırlama için)
let shownCiro = 0;          // ekranda kademeli akan ciro (veritabanı değerine kilitlenir)
let shownFis = 0;           // ekranda kademeli akan fiş adedi
const dripTimers = [];
let pendingSaleAmounts = [];
let soundOn = localStorage.getItem('furpa_sound') === '1';
const recentFeed = [];      // canlı fiş akışı (en yeni başta)
const seenFeedIds = new Set();
const recentPulsedAt = new Map();
const regionMap = new Map();
const regionColor = id => regionMap.get(id)?.color || '#8a8a96';
const regionName = id => regionMap.get(id)?.name || 'Diğer';
const now = () => new Date(Date.now() + skew);

const bars = new StackedBars($('#barChart'));
const rose = new Rose($('#rose'));
const orb = new Orb($('#orb'));
const net = new Network($('#network'));
const cashFx = new CashFx($('#fxCanvas'));

const ui = { range: null, openStores: new Set(), page: 'home', leaders: 'day', race: 'day', board: 'day', storeRegion: 'all', storeSort: { k: 'rank', dir: 1 }, regFilter: 'all', search: '' };
const PAGES = { home: 'Ana Sayfa', race: 'Bölge Yarışı', stores: 'Mağazalar', heat: 'Isı Haritası', flow: 'Canlı Fiş Akışı', report: 'Rapor', bulk: 'Toplu Satışlar', registers: 'Kasa Sağlığı' };
const HERO = { home: 'Anlık Ciro', race: 'Bölgeler yarışıyor.', stores: 'Her mağaza, her an.', heat: 'Hangi saatte kim yanıyor?', flow: 'Kasalardan düşen her fiş.', report: 'Tarih aralığı raporu.', bulk: '10.000 TL ve üzeri büyük satışlar.', registers: 'Kasaların nabzı.' };

// =====================================================================
// Bağlantı (SSE + kesintisiz otomatik yoklama yedeği)
// =====================================================================
function connect() {
  let fetching = false;
  const fetchSnap = () => {
    if (fetching) return;
    fetching = true;
    fetch('api/snapshot?t=' + Date.now(), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(s => {
        if (s && !s.loading) onSnapshot(s);
        else setTimeout(fetchSnap, 1500);
      })
      .catch(() => { if (!S) setTimeout(fetchSnap, 2500); })
      .finally(() => { fetching = false; });
  };
  fetchSnap();

  let es = null;
  const openStream = () => {
    if (es) { try { es.close(); } catch { } }
    es = new EventSource('api/stream');
    es.addEventListener('snapshot', e => onSnapshot(JSON.parse(e.data)));
    es.addEventListener('sales', e => onSales(JSON.parse(e.data)));
    es.onerror = () => {
      if (!S) setLive('err', 'Sunucuya yeniden bağlanıyor…');
      if (es.readyState === EventSource.CLOSED) setTimeout(openStream, 3000);
    };
  };
  openStream();

  // SSE takılırsa, tamponlanırsa veya sekme arka plandan dönerse sayfa yenilemeden kendi kendini günceller
  setInterval(() => {
    if (!document.hidden && (!S || Date.now() - lastSnapAt > 5500)) fetchSnap();
    if (es && es.readyState === EventSource.CLOSED) openStream();
  }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchSnap(); });
  window.addEventListener('online', fetchSnap);
}

const SPLASH_MIN_MS = 3000;   // şifre girişinden sonra karşılama logosu en az 3 sn ekranda kalır
let splashStartedAt = 0;
let splashHiding = false;
function showSplash() {
  const ld = $('#loading');
  if (!ld) return;
  splashStartedAt = performance.now();
  splashHiding = false;
  ld.hidden = false;
  ld.classList.remove('done');
}
function hideSplash() {
  const ld = $('#loading');
  if (!ld || ld.hidden || splashHiding) return 0;
  splashHiding = true;
  const elapsed = splashStartedAt ? (performance.now() - splashStartedAt) : 0;
  const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
  setTimeout(() => {
    ld.classList.add('done');
    setTimeout(() => { ld.hidden = true; }, 650);
  }, wait);
  return wait;
}

function onSnapshot(s) {
  if (!s || s.loading) return;
  lastSnapAt = Date.now();
  const splashWait = hideSplash();
  liveSnap = s;
  if (ui.range) {
    if (ui.range.to >= s.day && (ui.page === 'report' || ui.page === 'bulk')) renderPage();
    return;   // geçmiş tarih seçiliyken canlı akış ekrana yansımaz (arka planda hazır tutulur)
  }

  const prev = S;
  if (prev && prev.day === s.day && prev.lastPollAt === s.lastPollAt && prev.kpi.ciro === s.kpi.ciro && prev.kpi.fis === s.kpi.fis) {
    skew = F.parse(s.serverTime) - Date.now();
    renderChrome();
    if (ui.page === 'registers' || ui.page === 'stores' || ui.page === 'bulk' || ui.page === 'report') renderPage();
    return;
  }

  S = s;
  skew = F.parse(s.serverTime) - Date.now();
  const srvLast = F.parse(s.lastDataAt);
  if (!prev) lastLiveDataAt = srvLast || now();
  else if (srvLast && (!lastLiveDataAt || srvLast > lastLiveDataAt)) lastLiveDataAt = srvLast;

  regionMap.clear();
  s.regions.forEach(r => regionMap.set(r.id, r));

  if (!prev || prev.day !== s.day) {
    dripTimers.forEach(clearTimeout);
    dripTimers.length = 0;
    shownCiro = s.kpi.ciro;
    shownFis = s.kpi.fis;
    seenFeedIds.clear();
    const sorted = [...s.recent].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
    sorted.forEach(x => seenFeedIds.add(x.id));
    recentFeed.splice(0, recentFeed.length, ...sorted);
    setTimeout(() => {
      if (ui.page === 'home') {
        if (splashWait > 0) bars.replayShow();
        bumpKpi('#cardCiro');
        cashFx.burst($('#kCiro'), 6000, 1.15);
        cashFx.burst($('#orbVal'), 4000, 0.85);
        orb.kick(0.9);
      }
    }, splashWait + 520);
  } else {
    if (s.kpi.ciro <= shownCiro) {
      dripTimers.forEach(clearTimeout);
      dripTimers.length = 0;
      shownCiro = s.kpi.ciro;
      shownFis = s.kpi.fis;
    }
    if (s.recent?.length) {
      const byId = new Map(s.recent.map(x => [x.id, x]));
      recentFeed.forEach(item => {
        const cur = byId.get(item.id);
        if (cur && (cur.method !== item.method || cur.methodName !== item.methodName)) {
          item.method = cur.method;
          item.methodName = cur.methodName;
        }
      });
      const missed = s.recent.filter(x => !seenFeedIds.has(x.id));
      if (missed.length) onSales(missed);
    }
  }

  celebrate(s);
  renderChrome();
  renderPage();
  if (prev && prev.day === s.day) applyLiveDiff(prev, s);
}

function onSales(list) {
  if (!S || ui.range || !list?.length) return;
  const fresh = list.filter(x => !seenFeedIds.has(x.id));
  if (!fresh.length) return;
  fresh.forEach(x => {
    seenFeedIds.add(x.id);
    if (x.amount > 0) pendingSaleAmounts.push(x.amount);
  });
  if (pendingSaleAmounts.length > 40) pendingSaleAmounts = pendingSaleAmounts.slice(-40);
  fresh.sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const gap = Math.min(420, 4400 / Math.max(fresh.length, 1));
  fresh.forEach((sale, i) => {
    setTimeout(() => {
      recentPulsedAt.set(sale.market, Date.now());
      net.pulse(sale.market, regionColor(sale.region));
      orb.kick(0.28);
      recentFeed.unshift(sale);
      if (recentFeed.length > 80) recentFeed.length = 80;
      lastLiveDataAt = now();
      tick();
      if (S.payments && sale.amount > 0 && sale.method) {
        let grp = S.payments.find(g => g.key === sale.method);
        if (!grp) {
          grp = { key: sale.method, name: sale.methodName || sale.method, amount: 0, count: 0, items: [] };
          S.payments.push(grp);
        }
        grp.amount += sale.amount;
        grp.count += 1;
        if (sale.methodName) {
          let it = grp.items.find(x => x.name === sale.methodName);
          if (!it) { it = { name: sale.methodName, amount: 0, count: 0 }; grp.items.push(it); }
          it.amount += sale.amount;
          it.count += 1;
        }
      }
      if (S.stores && sale.amount > 0) {
        const st = S.stores.find(x => x.id === sale.market);
        if (st) {
          st.ciro += sale.amount;
          st.fis += 1;
          st.lastHourCiro += sale.amount;
          st.lastHourFis += 1;
          if (sale.at && (!st.lastSaleAt || sale.at > st.lastSaleAt)) st.lastSaleAt = sale.at;
        }
        const rg = S.regions?.find(x => x.id === sale.region);
        if (rg) {
          rg.ciro += sale.amount;
          rg.fis += 1;
          rg.lastHourCiro += sale.amount;
        }
        if (S.kpi) {
          S.kpi.lastHourFis += 1;
          const totalFis = Math.max(1, shownFis + 1);
          S.kpi.sepet = (shownCiro + sale.amount) / totalFis;
        }
      }
      if (ui.page === 'home') {
        $('#kFisSub').textContent = `Son 1 saat: ${F.num(S.kpi.lastHourFis)} fiş`;
        F.countTo($('#kSepet'), S.kpi.sepet, F.money2, 450);
        renderLeaders();
        renderBoard();
        rose.set(S.payments);
        const ptotal = S.payments.reduce((a, g) => a + g.amount, 0) || 1;
        $('#roseLegend').innerHTML = S.payments.map(g => `<span data-key="${F.esc(g.key)}" title="${F.money(g.amount)}"><i style="background:${PAY_COLORS[g.key] || '#888'}"></i>${F.esc(g.name)} %${Math.round((g.amount / ptotal) * 100)}</span>`).join('');
        if (sale.method) flashEl($(`#roseLegend span[data-key="${CSS.escape(sale.method)}"]`), 'flash');
        const tNow = now();
        net.set(S.stores.map(s => ({ ...s, offline: isStoreOffline(s, tNow) })), regionColor);
      } else if (ui.page === 'flow') {
        prependFeed(sale);
        renderFlowPayments();
      }
      flashEl($(`#leaders li[data-key="${CSS.escape(sale.market)}"]`), 'flash');
      if (sale.amount >= bulkUi.minAmount && ui.page === 'bulk' && bulkUi.key && !bulkUi.loading) fetchBulk(bulkUi.key, true);
      if (sale.amount >= 10000) toast(`<b>🪙 ${F.money(sale.amount)} tutarında dev fiş!</b>${F.esc(sale.store)} · Kasa ${F.esc(sale.kasa ?? '-')}`, true, 6500);
    }, i * gap);
  });
}

function flashEl(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function bumpKpi(cardSel, deltaText = '') {
  const card = $(cardSel);
  if (!card) return;
  flashEl(card, 'kpi-bump');
  clearTimeout(card._bumpT);
  card._bumpT = setTimeout(() => card.classList.remove('kpi-bump'), 1600);
  if (deltaText) {
    card.querySelectorAll('.kpi-delta').forEach(d => d.remove());
    const b = document.createElement('span');
    b.className = 'kpi-delta';
    b.textContent = deltaText;
    card.appendChild(b);
    setTimeout(() => b.remove(), 4300);
  }
}

function spawnCashPop(cardSel, text, big = false) {
  const card = $(cardSel);
  if (!card) return;
  const old = card.querySelectorAll('.cash-pop');
  if (old.length > 2) old[0].remove();
  const p = document.createElement('span');
  p.className = 'cash-pop' + (big ? ' big' : '');
  p.style.left = (18 + Math.round((Math.random() - 0.3) * 32)) + 'px';
  p.textContent = text;
  card.appendChild(p);
  setTimeout(() => p.remove(), 1600);
}

function dripRevenue(targetCiro, targetFis) {
  dripTimers.forEach(clearTimeout);
  dripTimers.length = 0;
  const dc = targetCiro - shownCiro;
  const df = Math.max(0, targetFis - shownFis);
  if (dc <= 0) {
    shownCiro = targetCiro;
    shownFis = targetFis;
    F.countTo($('#kCiro'), shownCiro, F.money, 600);
    F.countTo($('#orbVal'), shownCiro, F.money, 600);
    F.countTo($('#kFis'), shownFis, F.num, 600);
    return;
  }

  const samples = pendingSaleAmounts.splice(0, 8);
  const steps = Math.min(8, Math.max(3, samples.length || df || 4));
  let weights = samples.length === steps
    ? samples
    : Array.from({ length: steps }, (_, i) => samples[i % Math.max(1, samples.length)] || (0.6 + Math.random() * 0.9));
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  weights = weights.map(w => w / wSum);

  const spanMs = Math.min(4100, steps * 560);
  const stepMs = spanMs / steps;
  let accCiro = shownCiro;
  let accFis = shownFis;

  bumpKpi('#cardCiro', '🪙 ▲ +' + F.money(dc));
  if (df > 0) bumpKpi('#cardFis', '▲ +' + F.num(df) + ' fiş');

  for (let i = 0; i < steps; i++) {
    const t = setTimeout(() => {
      const isLast = i === steps - 1;
      if (isLast) dripTimers.length = 0;
      const chunk = isLast ? (targetCiro - accCiro) : dc * weights[i];
      accCiro = isLast ? targetCiro : accCiro + chunk;
      accFis = isLast ? targetFis : shownFis + Math.round((df * (i + 1)) / steps);
      shownCiro = accCiro;
      shownFis = accFis;

      if (ui.page === 'home') {
        const animMs = Math.max(380, stepMs * 0.9);
        F.countTo($('#kCiro'), shownCiro, F.money, animMs);
        F.countTo($('#orbVal'), shownCiro, F.money, animMs);
        F.countTo($('#kFis'), shownFis, F.num, animMs);

        if (chunk >= 1) {
          spawnCashPop('#cardCiro', '+' + F.money(chunk), chunk >= 2500);
          cashFx.burst($('#kCiro'), chunk, isLast ? 1.15 : 0.85);
          if (i % 2 === 0 || isLast) cashFx.burst($('#orbVal'), chunk, 0.65);
          flashEl($('#cardCiro'), 'kpi-bump');
          const ov = $('#orbVal');
          if (ov) { ov.classList.add('bump'); setTimeout(() => ov.classList.remove('bump'), 700); }
          orb.kick(Math.min(1.2, 0.22 + chunk / 15000));
          if (soundOn) playCashChime(chunk);
        }
      }
    }, Math.round(i * stepMs));
    dripTimers.push(t);
  }
}

function applyLiveDiff(prev, next) {
  const pill = $('#livePill');
  if (pill) { pill.classList.add('sync'); setTimeout(() => pill.classList.remove('sync'), 750); }

  const dc = next.kpi.ciro - shownCiro;
  const ds = next.kpi.sepet - prev.kpi.sepet;
  const dfor = next.kpi.forecast - prev.kpi.forecast;

  if (dc !== 0 || next.kpi.fis !== shownFis) dripRevenue(next.kpi.ciro, next.kpi.fis);
  if (ui.page !== 'home') return;

  if (Math.abs(ds) >= 0.05) {
    bumpKpi('#cardSepet', (ds > 0 ? '▲ +' : '▼ ') + F.money2(Math.abs(ds)));
    if (ds > 0) cashFx.burst($('#kSepet'), 600, 0.55);
  }
  if (Math.abs(dfor) >= 250) {
    bumpKpi('#cardForecast', (dfor > 0 ? '▲ +' : '▼ ') + F.moneyShort(Math.abs(dfor)));
    if (dfor > 0) cashFx.burst($('#kForecast'), Math.abs(dfor), 0.75);
  }

  const oldStores = new Map(prev.stores.map(x => [x.id, x]));
  const nowMs = Date.now();
  let pulseIdx = 0;
  next.stores.forEach(st => {
    const old = oldStores.get(st.id);
    if (!old || st.ciro <= old.ciro) return;
    flashEl($(`#leaders li[data-key="${CSS.escape(st.id)}"]`), 'flash');
    if (nowMs - (recentPulsedAt.get(st.id) || 0) > 3500 && pulseIdx < 18) {
      const delay = pulseIdx++ * 180;
      setTimeout(() => net.pulse(st.id, regionColor(st.region)), delay);
    }
  });

  const oldRegs = new Map(prev.regions.map(x => [x.id, x]));
  next.regions.forEach(r => {
    const old = oldRegs.get(r.id);
    if (old && r.ciro > old.ciro) flashEl($(`#boardRegions li[data-reg="${CSS.escape(r.id)}"]`), 'tl-flash');
  });
}

// Aktif mağazalardan merkeze çift kanatlı sürekli canlı telemetri akışı (ortam nabzı)
setInterval(() => {
  if (!S || document.hidden || ui.page !== 'home' || ui.range) return;
  const active = S.stores.filter(s => s.lastHourCiro > 0).slice(0, 56);
  if (!active.length) return;
  const half = Math.ceil(active.length / 2);
  const pickL = active[(Math.random() * half) | 0];
  if (pickL) net.pulse(pickL.id, regionColor(pickL.region), true);
  if (active.length > half) {
    const pickR = active[half + ((Math.random() * (active.length - half)) | 0)];
    if (pickR) setTimeout(() => net.pulse(pickR.id, regionColor(pickR.region), true), 650);
  }
  orb.kick(0.05);
}, 2400);

// =====================================================================
// Ortak alanlar (durum, kenar çubuğu, promo)
// =====================================================================
function setLive(cls, text) {
  const p = $('#livePill');
  p.classList.remove('ok', 'err');
  if (cls) p.classList.add(cls);
  $('#liveText').textContent = text;
}

function renderChrome() {
  const k = S.kpi, t = now();
  const last = lastLiveDataAt || F.parse(S.lastDataAt);

  const alert = $('#alert');
  if (ui.range) alert.hidden = true;
  else if (!S.dbOk && S.error) { alert.className = 'alert'; alert.textContent = 'Veritabanına ulaşılamıyor: ' + S.error + ' (ekrandaki değerler son başarılı okumaya aittir)'; alert.hidden = false; }
  else if (S.warning) { alert.className = 'alert warn'; alert.textContent = S.warning; alert.hidden = false; }
  else if (last && t - last > 20 * 60000 && t.getHours() >= 9 && t.getHours() < 22) { alert.className = 'alert warn'; alert.textContent = `Merkeze ${F.ago(last, t)} beri yeni fiş düşmedi. Sync Panel aktarımını kontrol edin.`; alert.hidden = false; }
  else alert.hidden = true;

  // Bölge alt menüsü (varsa)
  const sub = $('#navRegions');
  if (sub) {
    const sig = S.regions.map(r => r.id + r.name).join();
    if (sub.dataset.sig !== sig) {
      sub.innerHTML = S.regions.map(r => `<a data-region="${F.esc(r.id)}"><i style="background:${r.color}"></i>${F.esc(r.name)}</a>`).join('');
      sub.dataset.sig = sig;
    }
  }

  // Promo / tahmin kartı (yorum satırına alınmış veya kaldırılmışsa hata vermez)
  const promo = $('#promo');
  if (promo) {
    const promoSmall = $('#promo small');
    const promoTxt = $('#promoText');
    if (ui.range) {
      promo.classList.remove('win');
      if (promoSmall) promoSmall.textContent = 'Seçili dönem';
      if (promoTxt) promoTxt.textContent = `${rangeLabel()}: ${F.moneyShort(k.ciro)}`;
    } else if (k.yesterdayTotal > 0 && k.ciro >= k.yesterdayTotal) {
      if (promoSmall) promoSmall.textContent = 'Gün sonu tahmini';
      promo.classList.add('win');
      if (promoTxt) promoTxt.textContent = `Dünü geçtik! +${F.moneyShort(k.ciro - k.yesterdayTotal)}`;
    } else {
      if (promoSmall) promoSmall.textContent = 'Gün sonu tahmini';
      promo.classList.remove('win');
      if (promoTxt) promoTxt.textContent = `Gün sonu beklentisi: ${F.moneyShort(k.forecast)}`;
    }
  }

  const regs = registerStates();
  const bad = !ui.range && t.getHours() >= 9 && t.getHours() < 22 ? regs.filter(r => r.state === 'bad').length : 0;
  $('#badgeRegisters').hidden = bad === 0;
  $('#badgeRegisters').textContent = bad;

  $('#footInfo').textContent = ui.range
    ? `${rangeLabel()} · ${k.totalStores} mağaza · ${k.totalRegisters} kasa · geçmiş veri`
    : `${S.day} · ${k.totalStores} mağaza · ${k.totalRegisters} kasa · son okuma ${F.hhmmss(F.parse(S.lastPollAt))}`;
  tick();
}

function tick() {
  const t = now();
  $('#clock').textContent = F.hhmmss(t);
  if (!S) return;
  if (ui.range) { setLive('', 'Geçmiş veri · ' + rangeLabel()); return; }
  const last = lastLiveDataAt || F.parse(S.lastDataAt);
  if (!S.dbOk) setLive('err', 'Veri bağlantısı yok');
  else setLive('ok', 'Canlı · son fiş ' + F.ago(last, t));
}
setInterval(tick, 1000);

// =====================================================================
// Kutlamalar
// =====================================================================
function celebrate(s) {
  const c = s.kpi.ciro;
  if (prevCiro !== null && c > prevCiro) {
    const y = s.kpi.yesterdayTotal;
    if (y > 0 && prevCiro < y && c >= y) {
      confetti(6000);
      toast(`<b>Dünün cirosu geçildi!</b>Dün toplam ${F.money(y)} · bugün şimdiden ${F.money(c)}`, true, 9000);
    } else if (Math.floor(prevCiro / 1e6) < Math.floor(c / 1e6)) {
      confetti();
      toast(`<b>${Math.floor(c / 1e6)} milyon ₺ aşıldı</b>Saat ${F.hhmm(now())} itibarıyla bugünün cirosu ${F.money(c)}`, true, 7000);
    }
  }
  prevCiro = c;
}

function toast(html, gold = false, ms = 5000) {
  const el = document.createElement('div');
  el.className = 'toast' + (gold ? ' gold' : '');
  el.innerHTML = html;
  $('#toasts').prepend(el);
  while ($('#toasts').children.length > 4) $('#toasts').lastChild.remove();
  setTimeout(() => { el.style.transition = 'opacity .5s'; el.style.opacity = 0; setTimeout(() => el.remove(), 500); }, ms);
}

// =====================================================================
// Sayfa yönlendirme
// =====================================================================
function go(page) {
  if (!PAGES[page]) page = 'home';
  ui.page = page;
  $$('.nav-item[data-page]').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === page));
  $('#pageTitle').textContent = PAGES[page];
  setHero();
  $('#app').classList.remove('menu-open');
  hideTip();
  if (location.hash.slice(1) !== page) history.replaceState(null, '', '#' + page);
  renderPage();
}

function renderPage() {
  if (!S) return;
  ({ home: renderHome, race: renderRace, stores: renderStores, heat: renderHeat, flow: renderFlow, report: renderReport, bulk: renderBulk, registers: renderRegisters })[ui.page]?.();
}

// =====================================================================
// TOPLU SATIŞLAR (10.000 TL+ fişler · bölge/şube özeti · fiş & ödeme detayı)
// =====================================================================
const bulkUi = {
  minAmount: 10000,
  regionFilter: 'all',
  storeFilter: null,
  sortBy: 'amount',
  query: '',
  openUuids: new Set(),
  key: null,
  data: null,
  loading: false,
  error: null,
  lastFetchedAt: 0
};

function renderBulk(forceRedraw = false) {
  const box = $('#bulkBody');
  if (!box || !S) return;
  const today = ymd(now());
  const from = ui.range ? ui.range.from : (S.day || today);
  const to = ui.range ? ui.range.to : (S.day || today);
  const key = `${from}|${to}|${bulkUi.minAmount}`;

  // Canlı modda veya bugünü kapsayan aralıkta açıkken 10 sn'de bir sessizce yenile
  const curDay = liveSnap?.day || today;
  const liveExpired = to >= curDay && bulkUi.data && Date.now() - bulkUi.lastFetchedAt > 10000;
  if (bulkUi.key !== key) {
    bulkUi.key = key;
    bulkUi.data = null;
    bulkUi.loading = true;
    bulkUi.error = null;
    bulkUi.openUuids.clear();
    box.dataset.sig = '';
    fetchBulk(key, false);
  } else if (liveExpired && !bulkUi.loading) {
    fetchBulk(key, true);
  }

  if (bulkUi.loading && !bulkUi.data) {
    box.innerHTML = `<div class="card panel rp-empty"><span class="range-spin" style="display:inline-block"></span>
      <h2>Toplu satışlar okunuyor…</h2>
      <p>${from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`} aralığında ${F.money2(bulkUi.minAmount)} ve üzeri fişler hazırlanıyor.</p></div>`;
    return;
  }
  if (bulkUi.error && !bulkUi.data) {
    box.innerHTML = `<div class="card panel rp-empty"><h2>Toplu satışlar alınamadı</h2><p>${F.esc(bulkUi.error)}</p></div>`;
    return;
  }
  if (!bulkUi.data) return;

  const sig = `${key}|${bulkUi.data.totalCount}|${bulkUi.data.totalAmount}|${bulkUi.regionFilter}|${bulkUi.storeFilter || ''}|${bulkUi.sortBy}|${bulkUi.query}|${[...bulkUi.openUuids].join(',')}`;
  if (!forceRedraw && box.dataset.sig === sig) return;
  box.dataset.sig = sig;

  renderBulkView(box, bulkUi, {
    onMinChange: m => { bulkUi.minAmount = m; renderBulk(true); },
    onRegionFilter: r => { bulkUi.regionFilter = r; bulkUi.storeFilter = null; renderBulk(true); },
    onStoreFilter: s => { bulkUi.storeFilter = s; renderBulk(true); },
    onSortChange: s => { bulkUi.sortBy = s; renderBulk(true); },
    onQueryChange: (q, caret) => {
      bulkUi.query = q;
      renderBulk(true);
      const inp = $('#bkSearch');
      if (inp) { inp.focus(); try { inp.setSelectionRange(caret, caret); } catch { } }
    },
    onRefreshDetail: () => renderBulk(true)
  });
}

async function fetchBulk(key, silent = false) {
  const [from, to, min] = key.split('|');
  if (!silent) bulkUi.loading = true;
  try {
    const r = await fetch(`api/bulk?from=${from}&to=${to}&min=${min}&t=${Date.now()}`, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Toplu satış verisi alınamadı');
    if (bulkUi.key !== key) return;
    bulkUi.data = j;
    bulkUi.loading = false;
    bulkUi.error = null;
    bulkUi.lastFetchedAt = Date.now();
  } catch (e) {
    if (bulkUi.key !== key) return;
    bulkUi.loading = false;
    if (!silent) bulkUi.error = e.message || String(e);
  }
  if (ui.page === 'bulk') renderBulk(true);
}

// =====================================================================
// RAPOR (tarih aralığı: günlük seyir + hava durumu + özel günler + bölge/şube)
// =====================================================================
let rep = { key: null, data: null, loading: false, error: null, lastFetchedAt: 0 };

function renderReport(forceRedraw = false) {
  const box = $('#reportBody');
  if (!box || !S) return;
  const today = ymd(now());
  const curDay = liveSnap?.day || today;
  const from = ui.range ? ui.range.from : curDay;
  const to = ui.range ? ui.range.to : curDay;
  const key = `${from}|${to}`;
  const liveExpired = to >= curDay && rep.data && Date.now() - rep.lastFetchedAt > 10000;

  if (rep.key !== key) {
    rep = { key, data: null, loading: true, error: null, lastFetchedAt: 0 };
    box.dataset.rendered = '';
    fetchReport(key, false);
  } else if (liveExpired && !rep.loading) {
    fetchReport(key, true);
  }

  if (rep.loading && !rep.data) {
    box.innerHTML = `<div class="card panel rp-empty"><span class="range-spin" style="display:inline-block"></span><h2>Rapor hazırlanıyor…</h2>
      <p>${from === to ? fmtDay(from) : rangeLabel()} için günlük kırılım ve hava durumu okunuyor.</p></div>`;
    return;
  }
  if (rep.error && !rep.data) {
    box.dataset.rendered = '';
    box.innerHTML = `<div class="card panel rp-empty"><h2>Rapor hazırlanamadı</h2><p>${F.esc(rep.error)}</p></div>`;
    return;
  }
  if (!rep.data) return;

  const sig = `${key}|${rep.lastFetchedAt}`;
  if (!forceRedraw && box.dataset.rendered === sig) return;   // aynı rapor zaten çizili
  box.dataset.rendered = sig;
  renderReportView(box, {
    S, data: rep.data, today: curDay, regionColor, regionName, showTip, hideTip,
    onSelectRange: (f, t) => applyRange(f, t, 'custom')
  });
}

async function fetchReport(key, silent = false) {
  const [from, to] = key.split('|');
  if (!silent) rep.loading = true;
  try {
    const r = await fetch(`api/report?from=${from}&to=${to}&t=${Date.now()}`, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Rapor verisi alınamadı');
    if (rep.key !== key) return;
    rep = { key, data: j, loading: false, error: null, lastFetchedAt: Date.now() };
  } catch (e) {
    if (rep.key !== key) return;
    rep.loading = false;
    if (!silent) { rep.data = null; rep.error = e.message || String(e); }
  }
  if (ui.page === 'report') renderReport(true);
}

$('#reportBody').addEventListener('click', e => {
  const b = e.target.closest('[data-rp]');
  if (!b) return;
  const [f, t] = presetRange(b.dataset.rp);
  applyRange(f, t, b.dataset.rp);
});

// =====================================================================
// ANA SAYFA
// =====================================================================
function renderHome() {
  const k = S.kpi, sl = S.slots;
  const totals = sl.amount.map(a => a.reduce((x, y) => x + y, 0));
  const firstSlot = Math.max(0, totals.findIndex(v => v > 0));
  const active = totals.slice(firstSlot, sl.nowSlot + 1);
  const counts = sl.count.slice(firstSlot, sl.nowSlot + 1);

  // KPI (kademeli canlı kasa sayacı ile tam veritabanı değerine akar)
  if (!dripTimers.length) {
    F.countTo($('#kCiro'), shownCiro || k.ciro, F.money, 1250);
    F.countTo($('#kFis'), shownFis || k.fis, F.num, 1250);
  }
  const dy = k.yesterdaySameTime > 0 ? k.ciro / k.yesterdaySameTime - 1 : 0;
  const days = ui.range ? ui.range.days : 1;
  $('#kCiroSub').innerHTML = ui.range
    ? `${k.activeStores} mağaza · ${days} günlük dönem`
    : k.yesterdaySameTime > 0
      ? `Dün bu saatte ${F.moneyShort(k.yesterdaySameTime)} <span class="${dy >= 0 ? 'up' : 'down'}">${dy >= 0 ? '▲' : '▼'} ${F.pct(Math.abs(dy))}</span>`
      : `${k.activeStores} mağazada satış var`;
  $('#kFisSub').textContent = ui.range
    ? `Günlük ortalama: ${F.num(k.fis / days)} fiş`
    : `Son 1 saat: ${F.num(k.lastHourFis)} fiş`;
  F.countTo($('#kSepet'), k.sepet, F.money2, 1100);
  $('#kSepetSub').textContent = `İptal: ${F.num(k.cancelCount)} fiş · ${F.moneyShort(k.cancelAmount)}`;
  $('#kForecastTitle').textContent = ui.range ? 'Günlük Ortalama Ciro' : 'Gün Sonu Tahmini';
  F.countTo($('#kForecast'), ui.range ? k.ciro / days : k.forecast, F.money, 1250);
  $('#kForecastSub').textContent = ui.range
    ? `${days} gün toplamı ${F.moneyShort(k.ciro)}`
    : k.forecastDays > 0
      ? `Gün %${Math.round(k.forecastShare * 100)} tamamlandı · ${k.forecastDays} hafta baz`
      : 'Geçmiş veri bekleniyor';

  const hourly = [];
  for (let h = 0; h <= Math.floor(sl.nowSlot / 4); h++) hourly.push(totals.slice(h * 4, h * 4 + 4).reduce((a, b) => a + b, 0));
  artCandles($('#artCandles'), hourly.filter((v, i) => v > 0 || i >= Math.floor(firstSlot / 4)));
  artWave($('#artWave'), counts.length > 1 ? counts : [0, 0]);
  artLines($('#artLines'), active.map((v, i) => (counts[i] ? v / counts[i] : 0)));
  artDots($('#artDots'), ui.range ? 1 : k.forecast > 0 ? k.ciro / k.forecast : 0);

  // Saatlik Ciro — dijital ışık saçan çok bölgeli neon çizgi grafiği
  bars.colors = sl.regionIds.map((id, idx) => neonRegionColor(id, idx));
  bars.names = sl.regionIds.map(regionName);
  syncBarLegend(sl);
  bars.set(ui.range ? { ...sl, nowSlot: -1 } : sl, ui.range ? `${ui.range.from}_${ui.range.to}` : S.day);
  $('#barTitle').textContent = ui.range && days > 1 ? 'Saatlik Ciro (dönem toplamı)' : 'Saatlik Ciro';

  renderLeaders();

  // Ödeme dağılımı
  rose.set(S.payments);
  const ptotal = S.payments.reduce((a, g) => a + g.amount, 0) || 1;
  $('#roseLegend').innerHTML = S.payments.map(g => `<span title="${F.money(g.amount)}"><i style="background:${PAY_COLORS[g.key] || '#888'}"></i>${F.esc(g.name)} %${Math.round((g.amount / ptotal) * 100)}</span>`).join('');

  // Akış ağı (merkez küre + sağ/sol mağaza kanatları + dışarıda tam ciro rakamı)
  const tNow = now();
  net.set(S.stores.map(s => ({
    ...s,
    lastHourCiro: ui.range ? 0 : s.lastHourCiro,
    offline: isStoreOffline(s, tNow)
  })), regionColor);
  if (!dripTimers.length) F.countTo($('#orbVal'), shownCiro || k.ciro, F.money, 1250);
  $('#hubCount').textContent = k.activeStores;
  $('#orbLabel').textContent = ui.range ? `Toplam Ciro (${rangeLabel()})` : 'Toplam Ciro (Bugün)';
  $('#orbSub').textContent = ui.range ? 'satış yapan mağaza' : `aktif mağaza · ${k.activeRegisters} kasa canlı`;

  renderMarkets();
  renderBoard();
}

// =====================================================================
// PİYASA ŞERİDİ (USD · EUR · GRAM ALTIN · ÇEYREK ALTIN)
// =====================================================================
let markets = null;
const MK_META = {
  usd: ['ABD Doları · USD', ciro => '$' + F.num(ciro)],
  eur: ['Euro · EUR', ciro => '€' + F.num(ciro)],
  gram: ['Gram Altın · 24K', ciro => F.num(ciro) + ' Gr'],
  ceyrek: ['Çeyrek Altın', ciro => F.num(ciro) + ' Adet']
};
const MK_SHORT = { usd: 'USD', eur: 'EUR', gram: 'GRAM ALTIN', ceyrek: 'ÇEYREK ALTIN' };

function fetchMarkets() {
  fetch('api/markets?t=' + Date.now(), { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(m => {
      if (!m || !m.ok || !m.items?.length) return;
      const prev = markets;
      markets = m;
      renderMarkets(prev);
    })
    .catch(() => { });
}
fetchMarkets();
setInterval(() => { if (!document.hidden) fetchMarkets(); }, 90000);

function renderMarkets(prev = null) {
  const box = $('#marketStrip');
  if (!box) return;
  if (!markets?.ok || !markets.items?.length) { box.hidden = true; return; }
  box.hidden = false;

  const ciro = S ? (ui.range ? S.kpi.ciro : (shownCiro || S.kpi.ciro)) : 0;
  const sig = markets.items.map(x => x.key).join(',');
  if (box.dataset.sig !== sig) {
    const cardsHtml = markets.items.map(it => {
      const [label] = MK_META[it.key] || [it.name];
      return `<div class="card mk-card mk-${F.esc(it.key)}" data-mk="${F.esc(it.key)}">
        <div class="mk-ico">${F.esc(it.symbol)}</div>
        <div class="mk-body">
          <div class="mk-top"><span class="mk-name">${F.esc(label)}</span><span class="mk-chg"></span></div>
          <div class="mk-mid"><strong class="mk-sell"></strong><small class="mk-buy"></small></div>
        </div>
      </div>`;
    }).join('');
    box.innerHTML = `<div class="mk-grid">${cardsHtml}</div>
      <div class="card mk-ticker">
        <div class="mk-tk-viewport">
          <div class="mk-tk-track" id="mkTickerTrack"></div>
        </div>
      </div>`;
    box.dataset.sig = sig;
  }

  const prevMap = new Map((prev?.items || []).map(x => [x.key, x.selling]));
  const tkParts = [];
  markets.items.forEach(it => {
    const card = box.querySelector(`[data-mk="${CSS.escape(it.key)}"]`);
    const fmt = it.key === 'ceyrek' ? F.money : F.money2;
    const c = it.change || 0;
    const cTxt = Math.abs(c).toFixed(2).replace('.', ',');
    const chgCls = c > 0.001 ? 'up' : c < -0.001 ? 'down' : 'flat';
    const chgTxt = (c > 0.001 ? '▲ %' : c < -0.001 ? '▼ %' : '%') + cTxt;

    if (card) {
      F.countTo(card.querySelector('.mk-sell'), it.selling, fmt, 700);
      card.querySelector('.mk-buy').innerHTML = `<span class="mk-lbl">Alış </span>${fmt(it.buying)}`;

      const chgEl = card.querySelector('.mk-chg');
      chgEl.hidden = chgCls === 'flat';
      chgEl.className = 'mk-chg ' + chgCls;
      chgEl.textContent = chgTxt;

      const oldSell = prevMap.get(it.key);
      if (oldSell != null && oldSell !== it.selling) flashEl(card, 'mk-flash');
    }

    const shortName = MK_SHORT[it.key] || it.name;
    const chgHtml = chgCls !== 'flat' ? `<span class="mk-chg ${chgCls}">${chgTxt}</span>` : '';
    tkParts.push(`<span class="mk-tk-item mk-${F.esc(it.key)}"><i class="mk-tk-sym">${F.esc(it.symbol)}</i><b class="mk-tk-nm">${F.esc(shortName)}</b><strong class="mk-tk-val">${fmt(it.selling)}</strong><small class="mk-tk-buy">Alış ${fmt(it.buying)}</small>${chgHtml}</span>`);
  });

  const track = $('#mkTickerTrack');
  if (track && tkParts.length) {
    const tickerHtml = tkParts.join('');
    if (track.dataset.html !== tickerHtml) {
      track.innerHTML = tickerHtml + tickerHtml;
      track.dataset.html = tickerHtml;
    }
  }
}

function renderLeaders() {
  const key = ui.leaders === 'hour' && !ui.range ? 'lastHourCiro' : 'ciro';
  const list = [...S.stores].sort((a, b) => b[key] - a[key]).slice(0, 7);
  keyed($('#leaders'), list, s => s.id,
    () => { const li = document.createElement('li'); li.innerHTML = '<span class="rank"></span><span class="av"></span><div class="lname"><b></b><small><i></i><span></span></small></div><div class="lval"><b></b><span class="chip"></span></div>'; return li; },
    (li, s, i) => {
      const moved = ui.leaders === 'day' && !ui.range ? s.prevRank - s.rank : 0;
      li.querySelector('.rank').innerHTML = `#${i + 1}${moved > 0 ? ' <span class="up">▲</span>' : moved < 0 ? ' <span class="down">▼</span>' : ''}`;
      const av = li.querySelector('.av');
      av.textContent = F.initials(s.name);
      av.style.background = `radial-gradient(circle at 35% 30%, #fff8, transparent 60%), ${regionColor(s.region)}`;
      li.querySelector('.lname b').textContent = s.name;
      li.querySelector('.lname small i').style.background = regionColor(s.region);
      li.querySelector('.lname small span').textContent = `${regionName(s.region)} · ${F.num(s.fis)} fiş`;
      li.querySelector('.lval b').textContent = F.money(s[key]);
      const chip = li.querySelector('.chip');
      if (ui.range) { chip.className = 'chip flat'; chip.textContent = `sepet ${F.money2(s.fis ? s.ciro / s.fis : 0)}`; }
      else if (ui.leaders === 'hour') { chip.className = 'chip flat'; chip.textContent = `${F.num(s.lastHourFis)} fiş /1s`; }
      else if (s.lastHourCiro > 0) { chip.className = 'chip'; chip.textContent = `+${F.moneyShort(s.lastHourCiro)} /1s`; }
      else { chip.className = 'chip down'; chip.textContent = 'son 1 saat satış yok'; }
    });
}

function renderBoard() {
  const box = $('#boardRace');
  if (!box || !S) return;
  const key = ui.board === 'hour' && !ui.range ? 'lastHourCiro' : 'ciro';
  const list = [...S.regions].sort((a, b) => b[key] - a[key]);
  const max = Math.max(...list.map(r => r[key]), 1);
  const total = list.reduce((a, r) => a + r[key], 0) || 1;
  box.style.height = '';
  keyed(box, list, r => r.id,
    r => {
      const row = document.createElement('div');
      row.className = 'race-row';
      row.innerHTML = `<div class="race-name"><span class="pos"></span><i class="r-dot" style="background:${r.color}"></i><span class="nm"></span></div>
        <div class="race-track"><div class="race-bar" style="--c:${r.color};background:linear-gradient(90deg, ${r.color}55, ${r.color})"><span></span></div></div>
        <div class="race-val"><b></b><small></small></div>`;
      return row;
    },
    (row, r, i) => {
      row.querySelector('.pos').textContent = i + 1;
      row.querySelector('.r-dot').style.background = r.color;
      row.querySelector('.nm').textContent = r.name;
      const bar = row.querySelector('.race-bar');
      bar.style.setProperty('--c', r.color);
      bar.style.background = `linear-gradient(90deg, ${r.color}55, ${r.color})`;
      bar.style.width = (r[key] > 0 ? Math.max(4, (r[key] / max) * 100) : 0) + '%';
      bar.querySelector('span').textContent = r[key] > 0 ? '%' + ((r[key] / total) * 100).toFixed(1).replace('.', ',') : '';
      row.querySelector('.race-val b').textContent = F.money(r[key]);
      row.querySelector('.race-val small').textContent = `${F.num(r.fis)} fiş · ${r.activeStores}/${r.stores} mağaza`;
    });
  const sub = $('#boardSub');
  if (sub) sub.textContent = ui.range ? `${rangeLabel()} dönem cirosu` : ui.board === 'hour' ? 'son 1 saatin cirosu' : 'günün toplam cirosu';
}

// =====================================================================
// BÖLGE YARIŞI
// =====================================================================
function renderRace() {
  const key = ui.race === 'hour' && !ui.range ? 'lastHourCiro' : 'ciro';
  const list = [...S.regions].sort((a, b) => b[key] - a[key]);
  const max = Math.max(...list.map(r => r[key]), 1);
  const total = list.reduce((a, r) => a + r[key], 0) || 1;
  const box = $('#race');
  box.style.height = '';
  keyed(box, list, r => r.id,
    r => {
      const row = document.createElement('div');
      row.className = 'race-row';
      row.innerHTML = `<div class="race-name"><span class="pos"></span><i class="r-dot" style="background:${r.color}"></i><span class="nm"></span></div>
        <div class="race-track"><div class="race-bar" style="--c:${r.color};background:linear-gradient(90deg, ${r.color}55, ${r.color})"><span></span></div></div>
        <div class="race-val"><b></b><small></small></div>`;
      return row;
    },
    (row, r, i) => {
      row.querySelector('.pos').textContent = i + 1;
      row.querySelector('.r-dot').style.background = r.color;
      row.querySelector('.nm').textContent = r.name;
      const bar = row.querySelector('.race-bar');
      bar.style.setProperty('--c', r.color);
      bar.style.background = `linear-gradient(90deg, ${r.color}55, ${r.color})`;
      bar.style.width = (r[key] > 0 ? Math.max(4, (r[key] / max) * 100) : 0) + '%';
      bar.querySelector('span').textContent = r[key] > 0 ? '%' + ((r[key] / total) * 100).toFixed(1).replace('.', ',') : '';
      row.querySelector('.race-val b').textContent = F.money(r[key]);
      row.querySelector('.race-val small').textContent = `${F.num(r.fis)} fiş · ${r.activeStores}/${r.stores} mağaza`;
    });
  $('#raceSub').textContent = ui.range ? `${rangeLabel()} dönem cirosu` : ui.race === 'hour' ? 'son 1 saatin cirosu' : 'günün toplam cirosu';

  $('#regionCols').innerHTML = [...S.regions].sort((a, b) => b.ciro - a.ciro).map(r => {
    const stores = S.stores.filter(s => s.region === r.id).sort((a, b) => b.ciro - a.ciro);
    const tNow = now();
    return `<div class="region-col" style="border-top:2px solid ${r.color}"><h3><span>${F.esc(r.name)}</span><span>${F.moneyShort(r.ciro)}</span></h3><ol>
      ${stores.map((s, i) => {
      const off = isStoreOffline(s, tNow);
      return `<li class="${off ? 'offline' : ''}" title="${off ? 'Bağlantı yok · veri alınamıyor' : ''}"><span class="rc-name">${off ? NO_CONN_SVG : ''}<span class="rc-txt">${i + 1}. ${F.esc(s.name)}</span></span><span class="rc-val">${off && s.ciro <= 0 ? 'Veri yok' : F.moneyShort(s.ciro)}</span></li>`;
    }).join('')}</ol></div>`;
  }).join('');
}

const NO_CONN_SVG = '<svg class="no-conn-ico" viewBox="0 0 24 24"><path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.17-2.66M19 13a10 10 0 0 0-2.17-1.66M12 20h.01"/></svg>';

function isStoreOffline(s, t = now()) {
  if (!s || s.fis === 0 || s.ciro <= 0) return true;
  if (ui.range) return false;
  const last = F.parse(s.lastSaleAt);
  if (!last) return true;
  const h = t.getHours();
  return h >= 9 && h < 23 && (t - last) > 45 * 60000;
}

// =====================================================================
// MAĞAZALAR
// =====================================================================
function renderStores() {
  const seg = $('#segStoreRegion');
  const sig = S.regions.map(r => r.id).join();
  if (seg.dataset.sig !== sig) {
    seg.innerHTML = `<button data-v="all">Hepsi</button>` + S.regions.map(r => `<button data-v="${F.esc(r.id)}">${F.esc(r.name)}</button>`).join('');
    seg.dataset.sig = sig;
  }
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.storeRegion));

  const t = now(), q = ui.search.trim().toLocaleLowerCase('tr-TR');
  let rows = S.stores.map(s => ({ ...s, sepet: s.fis ? s.ciro / s.fis : 0 }))
    .filter(s => ui.storeRegion === 'all' || s.region === ui.storeRegion)
    .filter(s => !q || s.name.toLocaleLowerCase('tr-TR').includes(q) || s.id.includes(q));
  const { k, dir } = ui.storeSort;
  rows.sort((a, b) => {
    const x = a[k] ?? '', y = b[k] ?? '';
    return (typeof x === 'string' ? x.localeCompare(y, 'tr') : x - y) * dir;
  });
  $$('#storesTable th').forEach(th => th.classList.toggle('sorted', th.dataset.k === k));
  const from = 7, to = 23;
  const regsByStore = new Map();
  registerStates().forEach(r => {
    if (!regsByStore.has(r.market)) regsByStore.set(r.market, []);
    regsByStore.get(r.market).push(r);
  });
  $('#storesTable tbody').innerHTML = rows.map(s => {
    const last = F.parse(s.lastSaleAt);
    const stale = !ui.range && last && t - last > 30 * 60000;
    const open = ui.openStores.has(s.id);
    const regs = regsByStore.get(s.id) || [];
    const online = regs.filter(r => r.state === 'ok' || r.state === 'done').length;
    const offline = isStoreOffline(s, t);
    return `<tr class="store-row ${open ? 'open' : ''} ${offline ? 'offline' : ''}" data-store="${F.esc(s.id)}" title="${offline ? 'Bağlantı yok · veri alınamıyor · kasaları görmek için tıklayın' : 'Kasaları görmek için tıklayın'}"><td>${s.rank}</td>
      <td><span class="chev">▸</span>${F.esc(s.name)} <small>${F.esc(s.id)}</small>
        <span class="kasa-mini ${online === regs.length && regs.length ? 'all' : online ? 'some' : 'none'}">${online}/${regs.length} kasa</span>
        ${offline ? `<span class="offline-pill">${NO_CONN_SVG} Bağlantı yok</span>` : ''}</td>
      <td><span class="rg"><i style="background:${regionColor(s.region)}"></i>${F.esc(regionName(s.region))}</span></td>
      <td class="num">${F.money(s.ciro)}</td><td class="num">${F.num(s.fis)}</td><td class="num">${F.money2(s.sepet)}</td>
      <td class="num">${ui.range ? '—' : F.money(s.lastHourCiro)}</td><td>${sparkline(s.hourly.slice(from, to + 1), regionColor(s.region))}</td>
      <td class="num ${stale ? 'stale' : ''}">${last ? lastText(last) : '—'}</td></tr>${open ? storeDetailRow(s, regs) : ''}`;
  }).join('');
  const sum = rows.reduce((a, s) => a + s.ciro, 0);
  $('#storesSub').textContent = `${rows.length} mağaza · ${F.money(sum)}${ui.range ? ' · ' + rangeLabel() : ''}`;
}

const REG_STATE = {
  ok: ['Online', 'son 15 dk içinde fiş kesti'],
  warn: ['Hareketsiz', '15–45 dk fiş kesmedi'],
  bad: ['Çevrimdışı', '45 dk+ fiş kesmedi'],
  done: ['Satış yaptı', 'seçili dönemde fiş kesti'],
  off: ['Fiş yok', 'seçili günde/dönemde hiç fiş kesmedi']
};

function storeDetailRow(s, regs) {
  const list = [...regs].sort((a, b) => b.amount - a.amount || (+a.kasa - +b.kasa));
  const totAmt = list.reduce((a, r) => a + r.amount, 0);
  const totCnt = list.reduce((a, r) => a + r.count, 0);
  const max = Math.max(...list.map(r => r.amount), 1);
  const t = now();
  const body = list.map(r => {
    const [label, hint] = REG_STATE[r.state];
    const sepet = r.count ? r.amount / r.count : 0;
    const share = totAmt > 0 ? (r.amount / totAmt) * 100 : 0;
    return `<tr>
      <td><b class="kno">Kasa ${F.esc(r.kasa)}</b></td>
      <td><span class="kstate ${r.state}" title="${F.esc(hint)}"><i></i>${label}</span></td>
      <td class="num"><b>${F.money(r.amount)}</b>
        <span class="kbar"><i style="width:${Math.max(r.amount > 0 ? 3 : 0, (r.amount / max) * 100)}%;background:${regionColor(s.region)}"></i></span></td>
      <td class="num">%${share.toFixed(1).replace('.', ',')}</td>
      <td class="num">${F.num(r.count)}</td>
      <td class="num">${r.count ? F.money2(sepet) : '—'}</td>
      <td class="num ${r.state === 'bad' ? 'stale' : ''}">${r.last ? lastText(r.last, t, true) : '—'}</td>
      <td class="num"><small>${F.esc(r.version || '—')}${r.dbSize ? ' · ' + F.esc(r.dbSize) : ''}</small></td>
    </tr>`;
  }).join('');
  const cnt = st => list.filter(r => r.state === st).length;
  return `<tr class="store-detail"><td colspan="9">
    <div class="sd-wrap" style="--c:${regionColor(s.region)}">
      <div class="sd-head">
        <b>${F.esc(s.name)} · Kasalar</b>
        <span class="sd-sum">${ui.range
      ? `<em class="up">${cnt('done')} kasa satış yaptı</em>${cnt('off') ? ` · <em>${cnt('off')} kasada fiş yok</em>` : ''}`
      : `<em class="up">${cnt('ok')} online</em> · <em>${cnt('warn')} hareketsiz</em> · <em class="down">${cnt('bad')} çevrimdışı</em>${cnt('off') ? ` · <em>${cnt('off')} bugün fişsiz</em>` : ''}`}</span>
        <span class="sd-tot">Toplam ${F.money(totAmt)} · ${F.num(totCnt)} müşteri/fiş · sepet ${totCnt ? F.money2(totAmt / totCnt) : '—'}</span>
      </div>
      ${list.length ? `<table class="sd-tbl"><thead><tr><th>Kasa</th><th>Durum</th><th class="num">Ciro</th><th class="num">Pay</th><th class="num">Müşteri (fiş)</th><th class="num">Sepet ort.</th><th class="num">Son fiş</th><th class="num">Sürüm / DB</th></tr></thead><tbody>${body}</tbody></table>`
      : '<small>Bu mağaza için tanımlı kasa bulunamadı.</small>'}
    </div></td></tr>`;
}

// =====================================================================
// ISI HARİTASI
// =====================================================================
const HEAT = [[27, 27, 36], [37, 60, 107], [31, 163, 156], [245, 197, 24], [255, 84, 104]];
function heatColor(f) {
  if (f <= 0) return 'rgba(255,255,255,.025)';
  const x = Math.min(.999, f) * (HEAT.length - 1), i = Math.floor(x), k = x - i;
  const c = HEAT[i].map((v, j) => Math.round(v + (HEAT[i + 1][j] - v) * k));
  return `rgb(${c})`;
}
function renderHeat() {
  const curHour = ui.range ? -1 : Math.floor(S.slots.nowSlot / 4);
  let h0 = 23, h1 = Math.max(curHour, 21);
  S.stores.forEach(s => s.hourly.forEach((v, h) => { if (v > 0) { h0 = Math.min(h0, h); h1 = Math.max(h1, h); } }));
  h0 = Math.min(h0, 8);
  const max = Math.max(...S.stores.flatMap(s => s.hourly), 1);
  const hours = []; for (let h = h0; h <= h1; h++) hours.push(h);
  const rows = [...S.stores].sort((a, b) => b.ciro - a.ciro);
  $('#heat').innerHTML = `<table><thead><tr><th></th>${hours.map(h => `<th>${String(h).padStart(2, '0')}</th>`).join('')}<th>Toplam</th></tr></thead><tbody>
    ${rows.map(s => `<tr><td class="n" title="${F.esc(s.name)}"><i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${regionColor(s.region)};margin-right:6px"></i>${F.esc(s.name)}</td>
      ${hours.map(h => `<td class="c ${h === curHour ? 'now' : ''}" data-s="${F.esc(s.id)}" data-h="${h}" style="background:${heatColor(Math.sqrt(s.hourly[h] / max))}"></td>`).join('')}
      <td class="t">${F.moneyShort(s.ciro)}</td></tr>`).join('')}</tbody></table>`;
}

// =====================================================================
// CANLI FİŞ AKIŞI
// =====================================================================
function feedItem(s) {
  const li = document.createElement('li');
  const at = F.parse(s.at);
  const when = ui.range ? `${dmShort(at)} ${F.hhmm(at)}` : F.hhmmss(at);
  li.innerHTML = `<span class="ft">${when}</span><span class="fd" style="background:${regionColor(s.region)}"></span>
    <span class="fs">${F.esc(s.store)}<small>Kasa ${F.esc(s.kasa ?? '-')}</small></span>
    <span class="fm" style="box-shadow:inset 3px 0 0 ${PAY_COLORS[s.method] || '#888'}">${F.esc(s.methodName)}</span><span class="fa">${F.money2(s.amount)}</span>`;
  return li;
}
function prependFeed(s) {
  const ul = $('#feed');
  ul.prepend(feedItem(s));
  while (ul.children.length > 60) ul.lastChild.remove();
}
function renderFlowPayments() {
  renderFeedStats();
  const groups = (S.payments || []).flatMap(g => g.items.map(it => ({ ...it, key: g.key })));
  groups.sort((a, b) => b.amount - a.amount);
  $('#payItems').innerHTML = groups.map(it => `<li><i style="background:${PAY_COLORS[it.key] || '#888'}"></i><span>${F.esc(it.name)}</span><span>${F.num(it.count)} adet</span><b>${F.money(it.amount)}</b></li>`).join('');
}
function renderFlow() {
  const ul = $('#feed');
  ul.innerHTML = '';
  const feed = ui.range ? [...S.recent].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id) : recentFeed;
  feed.slice(0, 60).forEach(s => { const li = feedItem(s); li.style.animation = 'none'; ul.appendChild(li); });
  $('#flowSub').textContent = ui.range ? 'seçili dönemin son 60 başarılı satışı' : 'merkeze düşen her başarılı satış';
  renderFlowPayments();
}
function renderFeedStats() {
  const list = [...(S.payments || [])].filter(g => g.amount > 0 || g.count > 0).sort((a, b) => b.amount - a.amount);
  const totalAmt = list.reduce((a, g) => a + g.amount, 0);
  const totalCnt = list.reduce((a, g) => a + g.count, 0);
  const max = Math.max(...list.map(g => g.amount), 1);
  const sub = $('#feedStatsSub');
  if (sub) sub.textContent = `${ui.range ? rangeLabel() : S.day} · ${F.money(totalAmt)} (${F.num(totalCnt)} işlem)`;
  $('#feedStats').innerHTML = list.map(g => {
    const col = PAY_COLORS[g.key] || '#888';
    const pct = totalAmt > 0 ? ((g.amount / totalAmt) * 100).toFixed(1).replace('.', ',') : '0,0';
    return `<div class="fbar">
      <div class="fbar-top">
        <span class="fbar-name"><i style="background:${col};box-shadow:0 0 8px ${col}"></i>${F.esc(g.name)} <em>%${pct}</em></span>
        <span class="fbar-val"><b>${F.money(g.amount)}</b><small>${F.num(g.count)} işlem</small></span>
      </div>
      <span class="tr"><i style="width:${Math.max(1.5, (g.amount / max) * 100)}%;background:linear-gradient(90deg,${col}99,${col});box-shadow:0 0 12px ${col}66"></i></span>
    </div>`;
  }).join('') || '<small>Seçili günde henüz ödeme kaydı yok</small>';
}

// =====================================================================
// KASA SAĞLIĞI
// =====================================================================
function registerStates() {
  const t = now();
  return S.registers.map(r => {
    const last = F.parse(r.lastSaleAt);
    const age = last ? (t - last) / 60000 : Infinity;
    const state = !last ? 'off' : ui.range ? 'done' : age < 15 ? 'ok' : age < 45 ? 'warn' : 'bad';
    return { ...r, last, age, state };
  });
}
function renderRegisters() {
  const t = now();
  const regs = registerStates();
  const c = st => regs.filter(r => r.state === st).length;
  if (ui.range) {
    const tot = regs.reduce((a, r) => a + r.amount, 0), cnt = regs.reduce((a, r) => a + r.count, 0);
    $('#regSummary').innerHTML = [
      ['Tanımlı Kasa', regs.length, ''],
      ['Fiş Kesen Kasa', c('done'), 'up'],
      ['Fiş Kesmeyen Kasa', c('off'), c('off') ? 'down' : ''],
      ['Kasa Başına Ort. Ciro', F.moneyShort(c('done') ? tot / c('done') : 0), ''],
    ].map(([t1, v, cls]) => `<div class="card"><small>${t1}</small><b class="${cls}">${v}</b></div>`).join('') +
      `<div class="card" style="grid-column:1/-1;padding:10px 18px"><small>${rangeLabel()} · ${F.money(tot)} · ${F.num(cnt)} fiş · Canlı kasa durumu için tarih filtresini “Bugün · Canlı” yapın.</small></div>`;
    const order = { off: 0, done: 1 };
    const list = regs.filter(r => ui.regFilter === 'all' || r.state === 'off')
      .sort((a, b) => order[a.state] - order[b.state] || b.amount - a.amount);
    $$('#segReg button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.regFilter));
    $('#regGrid').innerHTML = list.map(r => `
      <div class="reg ${r.state}">
        <b title="${F.esc(r.store)}">${F.esc(r.store)}</b>
        <div class="rr"><span>Şube ${F.esc(r.market)} · Kasa ${F.esc(r.kasa)}</span><span>${r.last ? lastText(r.last, t) : 'fiş yok'}</span></div>
        <div class="rr"><span>Dönem</span><span>${F.num(r.count)} fiş · ${F.moneyShort(r.amount)}</span></div>
        <div class="rr"><span>Sürüm / DB</span><span>${F.esc(r.version || '—')} · ${F.esc(r.dbSize || '—')}</span></div>
      </div>`).join('') || '<small>Kasa bulunamadı.</small>';
    return;
  }
  $('#regSummary').innerHTML = [
    ['Tanımlı Kasa', regs.length, ''],
    ['Son 15 dk Fiş Kesen', c('ok'), 'up'],
    ['15–45 dk Sessiz', c('warn'), ''],
    ['45 dk+ Sessiz', c('bad'), 'down'],
  ].map(([t1, v, cls]) => `<div class="card"><small>${t1}</small><b class="${cls}">${v}</b></div>`).join('') +
    `<div class="card" style="grid-column:1/-1;padding:10px 18px"><small>Bugün hiç fiş kesmeyen kasa: <b style="display:inline;font-size:14px;font-weight:600;color:#fff">${c('off')}</b></small></div>`;
  const order = { bad: 0, warn: 1, ok: 2, off: 3 };
  const list = regs.filter(r => ui.regFilter === 'all' || r.state === 'bad' || r.state === 'warn')
    .sort((a, b) => order[a.state] - order[b.state] || (+a.market - +b.market) || (+a.kasa - +b.kasa));
  $$('#segReg button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.regFilter));
  $('#regGrid').innerHTML = list.map(r => `
    <div class="reg ${r.state}">
      <b title="${F.esc(r.store)}">${F.esc(r.store)}</b>
      <div class="rr"><span>Şube ${F.esc(r.market)} · Kasa ${F.esc(r.kasa)}</span><span>${r.last ? F.ago(r.last, t) : 'bugün fiş yok'}</span></div>
      <div class="rr"><span>Bugün</span><span>${F.num(r.count)} fiş · ${F.moneyShort(r.amount)}</span></div>
      <div class="rr"><span>Sürüm / DB</span><span>${F.esc(r.version || '—')} · ${F.esc(r.dbSize || '—')}</span></div>
    </div>`).join('') || '<small>Sorunlu kasa yok.</small>';
}

// =====================================================================
// Yardımcılar
// =====================================================================
/** Anahtarlı liste güncelleme + FLIP sıralama animasyonu */
function keyed(container, items, key, create, update) {
  const old = new Map([...container.children].map(el => [el.dataset.key, el]));
  const first = new Map([...old].map(([k, el]) => [k, el.getBoundingClientRect().top]));
  const next = items.map((it, i) => {
    const k = key(it);
    let el = old.get(k);
    if (!el) { el = create(it); el.dataset.key = k; }
    update(el, it, i);
    old.delete(k);
    return el;
  });
  old.forEach(el => el.remove());
  next.forEach(el => container.appendChild(el));
  next.forEach(el => {
    const f = first.get(el.dataset.key);
    if (f == null) { el.animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 500 }); return; }
    const dy = f - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 800, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}

function seg(sel, cb) {
  $(sel).addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    $(sel).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    cb(b.dataset.v);
  });
}

// =====================================================================
// Olaylar
// =====================================================================
$('#nav').addEventListener('click', e => {
  const reg = e.target.closest('[data-region]');
  if (reg) { ui.storeRegion = reg.dataset.region; go('stores'); return; }
  const it = e.target.closest('.nav-item[data-page]');
  if (it) go(it.dataset.page);
});
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]');
  if (g) go(g.dataset.goto);
});
$('#btnCollapse').onclick = () => $('#app').classList.toggle('collapsed');
$('#btnMenu').onclick = () => $('#app').classList.toggle('menu-open');

seg('#segInterval', v => { bars.interval = +v; bars.draw(true); });

function syncBarLegend(sl = S?.slots) {
  const leg = $('#barLegend');
  if (!leg || !sl) return;
  const activeRegs = bars.activeRegions(sl);
  leg.innerHTML = activeRegs.map(r => {
    const id = sl.regionIds[r];
    const col = neonRegionColor(id, r);
    const cls = bars.focusReg === r ? 'sel' : bars.focusReg >= 0 ? 'dim' : '';
    return `<span class="lg-reg ${cls}" data-r="${r}" style="--nc:${col}" title="Bölge çizgisini tek başına vurgulamak için tıklayın"><i style="background:${col};box-shadow:0 0 9px ${col}"></i>${F.esc(regionName(id))}</span>`;
  }).join('');
}

$('#barLegend')?.addEventListener('click', e => {
  const sp = e.target.closest('.lg-reg[data-r]');
  if (!sp) return;
  bars.toggleRegion(+sp.dataset.r);
  syncBarLegend();
});
$('#barLegend')?.addEventListener('mouseover', e => {
  const sp = e.target.closest('.lg-reg[data-r]');
  if (sp) bars.highlightRegion(+sp.dataset.r);
});
$('#barLegend')?.addEventListener('mouseleave', () => bars.highlightRegion(-1));
seg('#segLeaders', v => { ui.leaders = v; renderLeaders(); });
seg('#segRace', v => { ui.race = v; renderRace(); });
seg('#segBoard', v => { ui.board = v; renderBoard(); });
seg('#segReg', v => { ui.regFilter = v; renderRegisters(); });
$('#segStoreRegion').addEventListener('click', e => {
  const b = e.target.closest('button[data-v]');
  if (b) { ui.storeRegion = b.dataset.v; renderStores(); }
});
$('#storesTable tbody').addEventListener('click', e => {
  const row = e.target.closest('tr.store-row');
  if (!row) return;
  const id = row.dataset.store;
  if (ui.openStores.has(id)) ui.openStores.delete(id); else ui.openStores.add(id);
  renderStores();
});
$('#storesTable thead').addEventListener('click', e => {
  const th = e.target.closest('th[data-k]');
  if (!th) return;
  const k = th.dataset.k;
  ui.storeSort = { k, dir: ui.storeSort.k === k ? -ui.storeSort.dir : (['name', 'region', 'rank'].includes(k) ? 1 : -1) };
  renderStores();
});

$('#heat').addEventListener('mousemove', e => {
  const td = e.target.closest('td.c');
  if (!td || !S) return hideTip();
  const s = S.stores.find(x => x.id === td.dataset.s);
  const h = +td.dataset.h;
  if (s) showTip(`<h4>${F.esc(s.name)}</h4><div class="tr"><span>${String(h).padStart(2, '0')}:00 – ${String(h + 1).padStart(2, '0')}:00</span><b>${F.money(s.hourly[h])}</b></div>`, e.clientX, e.clientY);
});
$('#heat').addEventListener('mouseleave', hideTip);

// Arama
const search = $('#search'), results = $('#searchResults');
let sel = -1;
function searchList() {
  const q = search.value.trim().toLocaleLowerCase('tr-TR');
  if (!q || !S) return [];
  return S.stores.filter(s => s.name.toLocaleLowerCase('tr-TR').includes(q) || s.id.includes(q)).slice(0, 8);
}
search.addEventListener('input', () => {
  const list = searchList(); sel = -1;
  results.innerHTML = list.map((s, i) => `<div data-i="${i}" data-id="${F.esc(s.id)}"><span>${F.esc(s.name)} <small>${F.esc(regionName(s.region))}</small></span><span>${F.moneyShort(s.ciro)}</span></div>`).join('');
  results.classList.toggle('open', list.length > 0);
});
function pick(name) {
  ui.search = name; ui.storeRegion = 'all';
  results.classList.remove('open'); search.blur();
  go('stores');
}
results.addEventListener('mousedown', e => {
  const d = e.target.closest('div[data-id]');
  if (d) pick(S.stores.find(s => s.id === d.dataset.id)?.name || '');
});
search.addEventListener('keydown', e => {
  const items = [...results.children];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1);
    items.forEach((x, i) => x.classList.toggle('sel', i === sel));
  } else if (e.key === 'Enter') {
    const d = items[sel >= 0 ? sel : 0];
    pick(d ? S.stores.find(s => s.id === d.dataset.id)?.name || '' : search.value);
  } else if (e.key === 'Escape') { search.value = ''; ui.search = ''; results.classList.remove('open'); search.blur(); renderPage(); }
});
search.addEventListener('blur', () => setTimeout(() => results.classList.remove('open'), 150));
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== search) { e.preventDefault(); search.focus(); }
  if (e.key === 'Escape' && document.body.classList.contains('tv')) toggleCommand(false);
});

// Kasa sesi düğmesi ve KPI kartlarına tıklayınca anlık efekt önizlemesi
function syncSoundBtn() {
  const b = $('#btnSound');
  if (!b) return;
  b.classList.toggle('on', soundOn);
  b.textContent = soundOn ? '🔔 Kasa Sesi Açık' : '🔕 Kasa Sesi';
}
syncSoundBtn();
$('#btnSound')?.addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('furpa_sound', soundOn ? '1' : '0');
  syncSoundBtn();
  if (soundOn) {
    playCashChime(5000);
    cashFx.burst($('#kCiro'), 5000, 1.2);
  }
});
$$('.kpi').forEach(card => {
  card.addEventListener('click', () => {
    const valEl = card.querySelector('.kpi-val');
    flashEl(card, 'kpi-bump');
    clearTimeout(card._bumpT);
    card._bumpT = setTimeout(() => card.classList.remove('kpi-bump'), 1500);
    cashFx.burst(valEl || card, 4500, 1.15);
    if (soundOn) playCashChime(3500);
  });
});

// =====================================================================
// Tarih filtresi (geçmiş gün / iki tarih arası)
// =====================================================================
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDay = s => { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
const dmShort = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
const rangeLabel = () => !ui.range ? '' : ui.range.from === ui.range.to ? fmtDay(ui.range.from) : `${fmtDay(ui.range.from)} – ${fmtDay(ui.range.to)}`;
const dFrom = $('#dFrom'), dTo = $('#dTo');
let rangeReq = 0;

function setHero() { $('#heroTitle').textContent = ui.range ? `Geçmiş: ${rangeLabel()}` : HERO[ui.page]; }

function lastText(last, t = now(), withAgo = false) {
  if (ui.range) return `${dmShort(last)} ${F.hhmm(last)}`;
  return withAgo ? `${F.hhmmss(last)} <small>${F.ago(last, t)}</small>` : F.hhmm(last);
}

function presetRange(p) {
  const t = now(), today = ymd(t);
  const off = n => { const x = new Date(t); x.setDate(x.getDate() + n); return ymd(x); };
  switch (p) {
    case 'yesterday': return [off(-1), off(-1)];
    case '7': return [off(-6), today];
    case '30': return [off(-29), today];
    case 'month': return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), today];
    case 'lastmonth': return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))];
    default: return [today, today];
  }
}

function syncRangeUi() {
  const today = ymd(now()), r = ui.range;
  dFrom.max = dTo.max = today;
  $$('#segPreset button').forEach(b => b.classList.toggle('on', r ? b.dataset.p === r.preset : b.dataset.p === 'today'));
  dFrom.value = r ? r.from : today;
  dTo.value = r ? r.to : today;
  $('#rangeInfo').textContent = r ? `${rangeLabel()} · ${r.days} gün · geçmiş veri` : 'Canlı veri';
  $('#rangeBar').classList.toggle('hist', !!r);
  document.body.classList.toggle('hist', !!r);
  setHero();
}

async function applyRange(from, to, preset = 'custom') {
  const today = ymd(now());
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  if (from === today && to === today) { goLive(); return; }
  const my = ++rangeReq;
  const bar = $('#rangeBar');
  bar.classList.add('busy');
  $('#rangeInfo').textContent = 'Veriler okunuyor… (uzun aralıklar birkaç saniye sürebilir)';
  try {
    const r = await fetch(`api/history?from=${from}&to=${to}`, { cache: 'no-store' });
    const j = await r.json();
    if (my !== rangeReq) return;
    if (!r.ok || j.error) throw new Error(j.error || 'Veri alınamadı');
    enterHistory(j, from, to, preset);
  } catch (e) {
    if (my !== rangeReq) return;
    toast(`<b>Geçmiş veri alınamadı</b>${F.esc(e.message || String(e))}`);
    syncRangeUi();
  } finally {
    if (my === rangeReq) bar.classList.remove('busy');
  }
}

function enterHistory(snap, from, to, preset) {
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  ui.range = { from, to, days, preset };
  dripTimers.forEach(clearTimeout);
  dripTimers.length = 0;
  S = snap;                       // skew güncellenmez (önbellekteki zaman damgası canlı saati bozmasın)
  shownCiro = snap.kpi.ciro;
  shownFis = snap.kpi.fis;
  regionMap.clear();
  snap.regions.forEach(r => regionMap.set(r.id, r));
  ui.openStores.clear();
  syncRangeUi();
  renderChrome();
  renderPage();
  if (ui.page === 'home') {
    flashEl($('#cardCiro'), 'kpi-bump');
    setTimeout(() => $('#cardCiro')?.classList.remove('kpi-bump'), 1500);
  }
}

function goLive() {
  rangeReq++;
  $('#rangeBar').classList.remove('busy');
  ui.range = null;
  ui.openStores.clear();
  syncRangeUi();
  if (liveSnap) { S = null; prevCiro = null; onSnapshot(liveSnap); }
}

$('#segPreset').addEventListener('click', e => {
  const b = e.target.closest('button[data-p]');
  if (!b) return;
  if (b.dataset.p === 'today') { goLive(); return; }
  const [f, t] = presetRange(b.dataset.p);
  applyRange(f, t, b.dataset.p);
});
$('#btnApply').onclick = () => { if (dFrom.value && dTo.value) applyRange(dFrom.value, dTo.value, 'custom'); };
dFrom.addEventListener('change', () => { if (dTo.value && dTo.value < dFrom.value) dTo.value = dFrom.value; });
dTo.addEventListener('change', () => { if (dFrom.value && dTo.value < dFrom.value) dFrom.value = dTo.value; });
[dFrom, dTo].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnApply').click(); }));
syncRangeUi();

// Tam ekran ve komuta merkezi (TV)
const isFull = () => !!document.fullscreenElement;
const btnFullEl = $('#btnFull');
if (btnFullEl) btnFullEl.onclick = () => (isFull() ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
document.addEventListener('fullscreenchange', () => {
  const full = isFull();
  document.body.classList.toggle('fs', full);
  const bf = $('#btnFull');
  if (bf) bf.textContent = full ? 'Çık' : 'Tam Ekran';
  requestAnimationFrame(() => setTimeout(() => {
    renderPage();
    bars.draw(false);
    net.layout();
    orb.resize();
  }, 60));
});

let rotateTimer = 0;
function toggleCommand(on = !document.body.classList.contains('tv')) {
  document.body.classList.toggle('tv', on);
  clearInterval(rotateTimer);
  if (on) {
    document.documentElement.requestFullscreen?.().catch(() => { });
    const seq = ['home', 'race', 'heat', 'flow'];
    let i = 0;
    go('home');
    rotateTimer = setInterval(() => go(seq[++i % seq.length]), 30000);
    toast('<b>Komuta merkezi modu</b>Sayfalar 30 saniyede bir döner. Çıkmak için Esc.');
  } else if (isFull()) document.exitFullscreen();
}
const btnCmdEl = $('#btnCommand');
if (btnCmdEl) btnCmdEl.onclick = () => toggleCommand();

// Başlat (adres sonuna #tv eklenirse ekran doğrudan komuta merkezi görünümünde açılır)
const AUTH_KEY = 'furpa_auth';
const startTv = location.hash === '#tv';
if (startTv) document.body.classList.add('tv');

let appStarted = false;
function startApp() {
  showSplash();
  go(startTv ? 'home' : location.hash.slice(1) || 'home');
  if (!appStarted) {
    appStarted = true;
    connect();
  } else if (S) {
    hideSplash();
  }
}

function isAuthenticated() {
  const raw = sessionStorage.getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.accessToken) return false;
    if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(AUTH_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function verifyLogin(email, password) {
  if (!email || !password) {
    return { ok: false, error: 'E-posta ve şifre boş bırakılamaz.' };
  }
  const resp = await fetch('api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  let data = null;
  try { data = await resp.json(); } catch { }
  if (!resp.ok || !data?.accessToken) {
    const rawMsg = String(data?.error || data?.message || data?.detail || data?.title || '').trim();
    const isAuthFail = resp.status === 400 || resp.status === 401 || resp.status === 403 || /^failed$/i.test(rawMsg);
    return {
      ok: false,
      error: isAuthFail || !rawMsg ? 'Hatalı kullanıcı adı ya da şifre.' : rawMsg
    };
  }
  return {
    ok: true,
    user: email,
    tokenType: data.tokenType || 'Bearer',
    accessToken: data.accessToken,
    refreshToken: data.refreshToken || '',
    expiresIn: Number(data.expiresIn || 3600)
  };
}

function initLoginGate() {
  const gate = $('#loginGate');
  const form = $('#loginForm');
  const userEl = $('#loginUser');
  const passEl = $('#loginPass');
  const eyeEl = $('#loginEye');
  const remEl = $('#loginRemember');
  const errEl = $('#loginErr');
  const btnEl = $('#loginSubmit');
  const logoutEl = $('#btnLogout');
  const logoutMobEl = $('#btnLogoutMobile');

  if (!gate || !form) {
    startApp();
    return;
  }

  const showError = (msg) => {
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.hidden = !msg;
  };

  if (eyeEl && passEl) {
    eyeEl.onclick = () => {
      const show = passEl.type === 'password';
      passEl.type = show ? 'text' : 'password';
      eyeEl.classList.toggle('show', show);
    };
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    showError('');
    const username = (userEl?.value || '').trim();
    const password = passEl?.value || '';
    if (!username || !password) {
      showError('Lütfen kullanıcı adı ve şifrenizi girin.');
      (!username ? userEl : passEl)?.focus();
      return;
    }

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.classList.add('busy');
    }

    try {
      const res = await verifyLogin(username, password);
      if (!res?.ok) {
        showError(res?.error || 'Giriş başarısız.');
        return;
      }
      const payload = JSON.stringify({
        user: res.user || username,
        tokenType: res.tokenType,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        expiresAt: Date.now() + (res.expiresIn || 3600) * 1000,
        at: Date.now()
      });
      if (remEl?.checked) {
        localStorage.setItem(AUTH_KEY, payload);
        sessionStorage.removeItem(AUTH_KEY);
      } else {
        sessionStorage.setItem(AUTH_KEY, payload);
        localStorage.removeItem(AUTH_KEY);
      }
      if (passEl) passEl.value = '';
      gate.classList.add('done');
      setTimeout(() => { gate.hidden = true; }, 380);
      startApp();
    } catch (err) {
      showError(err?.message || 'Doğrulama sırasında bir hata oluştu.');
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.classList.remove('busy');
      }
    }
  };

  const doLogout = () => {
    sessionStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AUTH_KEY);
    showError('');
    if (passEl) passEl.value = '';
    $('.app')?.classList.remove('menu-open');
    document.body.classList.remove('fs', 'tv');
    if (isFull()) document.exitFullscreen?.().catch(() => { });
    gate.hidden = false;
    requestAnimationFrame(() => {
      gate.classList.remove('done');
      userEl?.focus();
    });
  };
  if (logoutEl) logoutEl.onclick = doLogout;
  if (logoutMobEl) logoutMobEl.onclick = doLogout;

  if (startTv || isAuthenticated()) {
    gate.classList.add('done');
    gate.hidden = true;
    startApp();
  } else {
    gate.hidden = false;
    gate.classList.remove('done');
    setTimeout(() => userEl?.focus(), 60);
  }
}

initLoginGate();

// Açık olan tüm canlı sayfaların (Rapor, Toplu Satışlar, Mağazalar, Kasa Sağlığı) otomatik güncellenmesi
setInterval(() => {
  if (document.hidden || !S) return;
  const curDay = liveSnap?.day || ymd(now());
  if (ui.page === 'report' || ui.page === 'bulk') {
    if (!ui.range || ui.range.to >= curDay) renderPage();
  } else if (!ui.range && (ui.page === 'registers' || ui.page === 'stores')) {
    renderChrome();
    renderPage();
  }
}, 10000);
