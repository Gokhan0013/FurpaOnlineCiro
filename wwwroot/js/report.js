// FURPA Online — Rapor sayfası (tarih aralığı · günlük seyir · hava durumu · dini bayramlar / kandiller / resmi & özel günler · bölge ve şube kırılımı)
import * as F from './fmt.js?v=7';
import { hijriLabel, holidaysOf, nearbyReligiousDays, ramazanDayOf, religiousPresets, weatherInfo } from './holidays.js?v=3';

const WD_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const WD_LONG = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const dm = date => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const dmy = date => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
const sum = a => a.reduce((x, y) => x + y, 0);
const pctTxt = v => '%' + (v * 100).toFixed(1).replace('.', ',');
const signPct = v => (v >= 0 ? '+' : '−') + '%' + Math.abs(v * 100).toFixed(1).replace('.', ',');
const deg = v => (v == null ? '—' : Math.round(v) + '°');

// ---------------------------------------------------------------- veri modeli
function buildModel({ S, data, today, regionColor, regionName }) {
  const dates = data.dates, n = dates.length;
  const wMap = new Map((data.weather?.days || []).map(w => [w.date, w]));

  const day = dates.map((date, i) => {
    const dt = new Date(date + 'T00:00:00');
    const hol = holidaysOf(date);
    const ramDay = ramazanDayOf(date);
    const ram = ramDay > 0;
    const hasDini = hol.some(h => h.type === 'dini') || ram;
    const hasResmiOzel = hol.some(h => h.type === 'resmi' || h.type === 'ozel');
    return {
      i, date, wd: dt.getDay(), hijri: hijriLabel(date),
      ciro: data.total.ciro[i], fis: data.total.fis[i], w: wMap.get(date) || null,
      hol, ram, ramDay, hasDini, hasResmiOzel,
      diniBayram: hol.some(h => h.bayram),
      partial: date === today, weekend: dt.getDay() === 0 || dt.getDay() === 6,
      off: hol.some(h => h.off === 'tam')
    };
  });
  const complete = day.filter(d => !d.partial && d.ciro > 0);
  const total = sum(day.map(d => d.ciro)), fis = sum(day.map(d => d.fis));

  const zero = () => new Array(n).fill(0);
  const stores = S.stores.map(s => {
    const d = data.stores[s.id];
    const ciro = d?.ciro || zero(), cnt = d?.fis || zero();
    const t = sum(ciro), c = sum(cnt);
    let best = -1;
    ciro.forEach((v, i) => { if (v > 0 && (best < 0 || v > ciro[best])) best = i; });
    const active = ciro.filter(v => v > 0).length;
    return { id: s.id, name: s.name, region: s.region, ciro, cnt, total: t, fis: c, sepet: c ? t / c : 0, active, avg: active ? t / active : 0, best };
  });

  const regions = S.regions.map(r => {
    const list = stores.filter(s => s.region === r.id).sort((a, b) => b.total - a.total);
    const ciro = zero(), cnt = zero();
    list.forEach(s => s.ciro.forEach((v, i) => { ciro[i] += v; cnt[i] += s.cnt[i]; }));
    const t = sum(ciro), c = sum(cnt);
    let best = -1;
    ciro.forEach((v, i) => { if (v > 0 && (best < 0 || v > ciro[best])) best = i; });
    const active = ciro.filter(v => v > 0).length;
    return {
      id: r.id, name: r.name, color: r.color, stores: list, ciro, cnt, total: t, fis: c, sepet: c ? t / c : 0,
      avg: active ? t / active : 0, best, activeStores: list.filter(s => s.total > 0).length
    };
  }).filter(r => r.stores.length).sort((a, b) => b.total - a.total);

  let rank = 0;
  [...stores].sort((a, b) => b.total - a.total).forEach(s => (s.rank = ++rank));

  const pool = complete.length ? complete : day.filter(d => d.ciro > 0);
  const avgDay = pool.length ? sum(pool.map(d => d.ciro)) / pool.length : (n ? total / n : 0);
  const maxDay = pool.reduce((b, d) => (!b || d.ciro > b.ciro ? d : b), null);
  const minDay = pool.reduce((b, d) => (!b || d.ciro < b.ciro ? d : b), null);

  const wDays = day.filter(d => d.w);
  const rainy = wDays.filter(d => (d.w.rain ?? 0) >= 1);

  return {
    S, data, today, dates, n, day, complete, total, fis, sepet: fis ? total / fis : 0, avgDay, maxDay, minDay,
    stores, regions, wDays, rainy, rainTotal: sum(wDays.map(d => d.w.rain ?? 0)),
    tmaxAvg: wDays.length ? sum(wDays.map(d => d.w.tmax ?? 0)) / wDays.length : null,
    weatherCity: data.weather?.city || '', weatherError: data.weather?.error || null,
    regionColor, regionName
  };
}

// ---------------------------------------------------------------- parçalar
function holChips(d, short = false) {
  const items = d.hol.map(h => {
    const ico = h.type === 'resmi' ? '🏛️' : h.type === 'dini' ? '🌙' : '🎁';
    const cls = `hchip ${h.type}${h.bayram ? ' bayram' : ''}`;
    const tip = `${F.esc(h.name)}${h.off === 'tam' ? ' · tam gün tatil' : h.off === 'yarim' ? ' · arife (yarım gün)' : ''}`;
    return `<span class="${cls}" title="${tip}">${ico} ${F.esc(short ? shorten(h.name) : h.name)}</span>`;
  });
  if (d.ramDay > 0 && !d.hol.some(h => h.bayram)) {
    const hasStart = d.hol.some(h => h.name === 'Ramazan Başlangıcı');
    if (!hasStart) items.push(`<span class="hchip dini soft" title="Mübarek Ramazan Ayı (${d.ramDay}. gün)">🌙 Ramazan ${d.ramDay}. Gün</span>`);
  }
  return items.join('');
}
const shorten = s => (s.length > 28 ? s.slice(0, 27) + '…' : s);

function weatherCell(d) {
  if (!d.w) return '<span class="mut">—</span>';
  const [ico, txt] = weatherInfo(d.w.code);
  const rain = (d.w.rain ?? 0) >= 0.1 ? `<small>💧 ${(d.w.rain).toFixed(1).replace('.', ',')} mm</small>` : '';
  return `<span class="wx" title="${F.esc(txt)}"><span class="wi-big">${ico}</span><span class="wt"><b>${deg(d.w.tmin)} / ${deg(d.w.tmax)}</b><small>${F.esc(txt)}</small>${rain}</span></span>`;
}

function spark(values, color, w = 110, h = 22) {
  const max = Math.max(...values, 1), n = values.length;
  if (n < 2) return '';
  const pts = values.map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" stroke="${color}" stroke-width="1.4" fill="none"/></svg>`;
}

function bestCell(ciro, dates) {
  let b = -1;
  ciro.forEach((v, i) => { if (v > 0 && (b < 0 || v > ciro[b])) b = i; });
  return b < 0 ? '—' : `${dm(dates[b])} <small>${F.moneyShort(ciro[b])}</small>`;
}

function kpiCards(m) {
  const dayInfo = d => d ? `${dm(d.date)} ${WD_SHORT[d.wd]}` : '—';
  const dayTags = d => d ? `${d.w ? `<span class="kw">${weatherInfo(d.w.code)[0]}</span> ` : ''}${d.hol.length ? d.hol.map(h => F.esc(shorten(h.name))).join(', ') : ''}` : '';
  const diniExact = m.day.filter(d => d.hol.some(h => h.type === 'dini'));
  const specAll = m.day.filter(d => d.hol.length > 0);
  const ramCount = m.day.filter(d => d.ram).length;
  const partialNote = m.day.some(d => d.partial);

  let specSub = 'seçili aralıkta yok';
  if (specAll.length) {
    specSub = `${diniExact.length} dini · ${specAll.length - diniExact.length} resmi/özel` + (ramCount ? ` · ${ramCount} Ramazan günü` : '');
  } else if (ramCount) {
    specSub = `${ramCount} Ramazan günü`;
  } else {
    const near = nearbyReligiousDays(m.dates[0], m.dates[m.n - 1]);
    if (near.next) specSub = `Sıradaki dini gün: ${dm(near.next.date)} ${F.esc(shorten(near.next.names))}`;
  }

  const cards = [
    ['Toplam Ciro', F.money(m.total), `${m.n} gün · ${F.num(m.fis)} fiş`, 'blue'],
    ['Günlük Ortalama', F.money(m.avgDay), partialNote ? (m.complete.length ? `${m.complete.length} tamamlanmış gün (bugün hariç)` : 'bugün · devam ediyor') : `${m.complete.length} gün üzerinden`, ''],
    ['Sepet Ortalaması', F.money2(m.sepet), `${F.num(m.fis)} fiş`, ''],
    ['En Yüksek Gün', m.maxDay ? F.money(m.maxDay.ciro) : '—', `${dayInfo(m.maxDay)} ${dayTags(m.maxDay)}`, 'up'],
    ['En Düşük Gün', m.minDay ? F.money(m.minDay.ciro) : '—', `${dayInfo(m.minDay)} ${dayTags(m.minDay)}`, 'down'],
    ['Hava Durumu', m.tmaxAvg == null ? '—' : `${Math.round(m.tmaxAvg)}° ort. en yüksek`,
      m.tmaxAvg == null ? 'Hava verisi alınamadı' : `${m.rainy.length} yağışlı gün · ${m.rainTotal.toFixed(0)} mm · ${F.esc(m.weatherCity)}`, ''],
    ['Dini / Resmi / Özel Günler', `${specAll.length} gün`, specSub, 'gold']
  ];
  return `<div class="rp-kpis">${cards.map(([t, v, s, c]) => `<div class="card rp-kpi ${c}"><small>${t}</small><b>${v}</b><span>${s}</span></div>`).join('')}</div>`;
}

function insights(m) {
  const items = [];
  const avg = a => sum(a.map(d => d.ciro)) / a.length;
  const cmp = (icon, title, A, B, nameA, nameB, minCount = 2) => {
    if (A.length < minCount || B.length < 2) return;
    const a = avg(A), b = avg(B), diff = b ? a / b - 1 : 0;
    items.push(`<div class="rp-ins"><span class="ico">${icon}</span><div><b>${title}</b>
      <span>${nameA} (${A.length} gün) günlük ort. <em>${F.money(a)}</em> · ${nameB} (${B.length} gün) <em>${F.money(b)}</em>
      <strong class="${diff >= 0 ? 'up' : 'down'}">${signPct(diff)}</strong></span></div></div>`);
  };
  const cd = m.complete;
  cmp('🌧️', 'Yağmurun etkisi', cd.filter(d => d.w && (d.w.rain ?? 0) >= 1), cd.filter(d => d.w && (d.w.rain ?? 0) < 1), 'Yağışlı günler', 'Kuru günler');
  cmp('🌙', 'Dini bayram & kandil etkisi', cd.filter(d => d.hol.some(h => h.type === 'dini')), cd.filter(d => !d.hol.length && !d.weekend), 'Dini gün/bayramlar', 'Normal hafta içi', 1);
  cmp('🏛️', 'Resmi tatil / bayram etkisi', cd.filter(d => d.off), cd.filter(d => !d.off && !d.weekend), 'Tatil günleri', 'Normal hafta içi', 1);
  cmp('📅', 'Hafta sonu etkisi', cd.filter(d => d.weekend && !d.off), cd.filter(d => !d.weekend && !d.off), 'Hafta sonu', 'Hafta içi');
  cmp('🌙', 'Ramazan ayı etkisi', cd.filter(d => d.ram), cd.filter(d => !d.ram), 'Ramazan günleri', 'Diğer günler');
  if (!items.length) return '';
  return `<div class="rp-insights"><div class="rp-ins-head">İçgörüler <small>karşılaştırma tamamlanmış günler üzerinden; hafta içi/sonu dağılımı sonucu etkileyebilir</small></div>${items.join('')}</div>`;
}

function specialDaysBanner(m) {
  const notable = m.day.filter(d => d.hol.length > 0);
  const diniNotable = m.day.filter(d => d.hol.some(h => h.type === 'dini'));
  const presets = religiousPresets(m.dates[m.n - 1]).map(p =>
    `<button class="rp-qbtn" data-qfrom="${p.from}" data-qto="${p.to}">${F.esc(p.label)}</button>`
  ).join('');

  if (!notable.length && !m.day.some(d => d.ram)) {
    const near = nearbyReligiousDays(m.dates[0], m.dates[m.n - 1]);
    const nearTxt = [
      near.prev ? `Önceki dini gün: <b>${dmy(near.prev.date)} · ${F.esc(near.prev.names)}</b>` : '',
      near.next ? `Sıradaki dini gün: <b>${dmy(near.next.date)} · ${F.esc(near.next.names)}</b>` : ''
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    return `<div class="rp-hol-box empty">
      <div class="rp-hol-info">
        <span class="rp-hol-ico">🌙</span>
        <div>
          <b>Seçili tarih aralığında (${dmy(m.dates[0])} – ${dmy(m.dates[m.n - 1])}) dini bayram, kandil veya resmi tatil günü bulunmuyor.</b>
          <small>${nearTxt || 'Dini ve resmi günleri görmek için tarih aralığını genişletebilirsiniz.'}</small>
        </div>
      </div>
      <div class="rp-hol-presets">${presets}</div>
    </div>`;
  }

  const pills = notable.map(d => {
    const main = d.hol.find(h => h.type === 'dini') || d.hol[0];
    const ico = main.type === 'resmi' ? '🏛️' : main.type === 'dini' ? '🌙' : '🎁';
    const names = d.hol.map(h => h.name).join(' + ');
    return `<button class="rp-hol-pill ${main.type}${main.bayram ? ' bayram' : ''}" data-jump="${d.date}" title="Tabloda ${dmy(d.date)} satırına git">
      <span>${ico} <b>${dm(d.date)}</b> ${F.esc(shorten(names))}</span>
      <em>${F.moneyShort(d.ciro)}</em>
    </button>`;
  }).join('');

  let extraNote = '';
  if (!diniNotable.length && !m.day.some(d => d.ram)) {
    const near = nearbyReligiousDays(m.dates[0], m.dates[m.n - 1]);
    if (near.prev || near.next) {
      extraNote = `<div class="rp-hol-near">🌙 Bu aralıkta dini bayram/kandil yok · ${near.prev ? `Önceki: <b>${dmy(near.prev.date)} ${F.esc(near.prev.names)}</b>` : ''}${near.prev && near.next ? ' · ' : ''}${near.next ? `Sıradaki: <b>${dmy(near.next.date)} ${F.esc(near.next.names)}</b>` : ''} <span class="rp-hol-presets inline">${presets}</span></div>`;
    }
  }

  return `<div class="rp-hol-box">
    <div class="rp-hol-top">
      <b>🌙 Dönemdeki Dini Bayramlar, Kandiller, Resmi ve Önemli Günler <small>(${notable.length} özel gün${m.day.some(d => d.ram) ? ` · ${m.day.filter(d => d.ram).length} gün Ramazan` : ''} · satıra gitmek için tıklayın)</small></b>
    </div>
    <div class="rp-hol-pills">${pills}</div>
    ${extraNote}
  </div>`;
}

function dailySection(m) {
  const diniCount = m.day.filter(d => d.hasDini).length;
  const roCount = m.day.filter(d => d.hasResmiOzel).length;

  const rows = [...m.day].reverse().map(d => {
    const prev = d.i > 0 ? m.day[d.i - 1] : null;
    const chg = prev && prev.ciro > 0 && d.ciro > 0 ? d.ciro / prev.ciro - 1 : null;
    const cls = [
      d.weekend ? 'wk' : '',
      d.off ? 'off' : '',
      d.diniBayram ? 'dini-off' : d.hasDini ? 'dini-day' : '',
      d.partial ? 'partial' : ''
    ].filter(Boolean).join(' ');
    const chips = holChips(d);
    return `<tr class="${cls}" data-date="${d.date}" data-dini="${d.hasDini ? '1' : '0'}" data-ro="${d.hasResmiOzel ? '1' : '0'}">
      <td><b>${dmy(d.date)}</b></td>
      <td><span class="rp-wd">${WD_LONG[d.wd]}</span>${d.hijri ? `<small class="rp-hijri">${F.esc(d.hijri)}</small>` : ''}</td>
      <td>${weatherCell(d)}</td>
      <td class="hol">${chips || '<span class="mut">—</span>'}</td>
      <td class="num"><b>${F.money(d.ciro)}</b>${d.partial ? ' <small>(devam ediyor)</small>' : ''}</td>
      <td class="num">${F.num(d.fis)}</td><td class="num">${d.fis ? F.money2(d.ciro / d.fis) : '—'}</td>
      <td class="num ${chg == null ? '' : chg >= 0 ? 'up' : 'down'}">${chg == null ? '—' : (chg >= 0 ? '▲ ' : '▼ ') + pctTxt(Math.abs(chg))}</td></tr>`;
  }).join('');

  const note = m.weatherError
    ? `<div class="rp-note warn">⚠ ${F.esc(m.weatherError)}</div>`
    : m.wDays.length
      ? `<div class="rp-note">Hava durumu: ${F.esc(m.weatherCity)} · kaynak Open-Meteo · 💧 = günlük yağış · satır renkleri: <span class="lg wk">hafta sonu</span> <span class="lg off">resmi tatil</span> <span class="lg dini">🌙 dini bayram / kandil</span> · 🏛️ resmi tatil · 🌙 dini bayram & mübarek gün · 🎁 önemli gün.</div>`
      : '';

  return `<div class="card panel rp-sec">
    <div class="panel-head rp-daily-head">
      <h2>Günlük Seyir <small>ciro · hava durumu · dini bayramlar, kandiller ve özel günler</small></h2>
      <div class="seg" id="rpDayFilter">
        <button data-flt="all" class="on">Tüm Günler (${m.n})</button>
        <button data-flt="dini">🌙 Dini Bayram & Günler (${diniCount})</button>
        <button data-flt="ro">🏛️ Resmi & Özel (${roCount})</button>
      </div>
    </div>
    ${specialDaysBanner(m)}
    ${note}
    <div class="table-wrap rp-daily" id="rpDailyWrap"><table class="tbl rp-tbl" id="rpDailyTbl"><thead><tr>
      <th>Tarih</th><th>Gün / Hicri Takvim</th><th>Hava</th><th>Dini / Resmi / Özel Gün</th><th class="num">Ciro</th><th class="num">Fiş</th><th class="num">Sepet</th><th class="num">Önceki güne göre</th>
    </tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function regionSection(m) {
  const t = m.total || 1;
  const maxR = Math.max(...m.regions.map(r => r.total), 1);
  const bar = m.regions.map(r => `<div class="rp-hbar">
    <span class="nm"><i style="background:${r.color}"></i>${F.esc(r.name)}</span>
    <span class="track"><i style="width:${r.total > 0 ? Math.max(1.5, (r.total / maxR) * 100) : 0}%;background:linear-gradient(90deg, ${r.color}66, ${r.color});box-shadow:0 0 18px -4px ${r.color}"></i></span>
    <span class="val"><b>${F.money(r.total)}</b><small>${pctTxt(r.total / t)}</small></span></div>`).join('');
  const rows = m.regions.map(r => `<tr>
    <td><span class="rg"><i style="background:${r.color}"></i>${F.esc(r.name)}</span></td>
    <td class="num">${r.activeStores}/${r.stores.length}</td>
    <td class="num"><b>${F.money(r.total)}</b></td><td class="num">${pctTxt(r.total / t)}</td>
    <td class="num">${F.num(r.fis)}</td><td class="num">${r.fis ? F.money2(r.sepet) : '—'}</td>
    <td class="num">${F.money(r.avg)}</td><td class="num">${bestCell(r.ciro, m.dates)}</td>
    <td>${spark(r.ciro, r.color)}</td></tr>`).join('');
  return `<div class="card panel rp-sec">
    <div class="panel-head"><h2>Bölge Bazlı Rapor <small>${m.regions.length} bölge</small></h2></div>
    <div class="rp-hbars">${bar}</div>
    <div class="table-wrap"><table class="tbl rp-tbl"><thead><tr>
      <th>Bölge</th><th class="num">Mağaza</th><th class="num">Ciro</th><th class="num">Pay</th><th class="num">Fiş</th>
      <th class="num">Sepet</th><th class="num">Günlük ort.</th><th class="num">En iyi gün</th><th>Seyir</th>
    </tr></thead><tbody>${rows}
    <tr class="tot"><td>TOPLAM</td><td class="num">${m.stores.filter(s => s.total > 0).length}/${m.stores.length}</td><td class="num"><b>${F.money(m.total)}</b></td><td class="num">%100,0</td>
      <td class="num">${F.num(rTotalFis(m))}</td><td class="num">${F.money2(m.sepet)}</td><td class="num">${F.money(m.avgDay)}</td>
      <td class="num">${bestCell(m.day.map(d => d.ciro), m.dates)}</td><td>${spark(m.day.map(d => d.ciro), '#fff')}</td></tr>
    </tbody></table></div></div>`;
}
const rTotalFis = m => m.fis;

function storeSection(m) {
  const t = m.total || 1;
  const body = m.regions.map(r => {
    const head = `<tr class="grp" style="--c:${r.color}"><td colspan="2"><span class="rg"><i style="background:${r.color}"></i><b>${F.esc(r.name)}</b></span></td>
      <td class="num"><b>${F.money(r.total)}</b></td><td class="num">100%</td><td class="num">${pctTxt(r.total / t)}</td>
      <td class="num">${F.num(r.fis)}</td><td class="num">${r.fis ? F.money2(r.sepet) : '—'}</td><td class="num">—</td>
      <td class="num">${F.money(r.avg)}</td><td class="num">${bestCell(r.ciro, m.dates)}</td><td>${spark(r.ciro, r.color)}</td></tr>`;
    const rows = r.stores.map(s => `<tr class="${s.total > 0 ? '' : 'dim'}">
      <td class="num">${s.rank}</td><td>${F.esc(s.name)} <small>${F.esc(s.id)}</small></td>
      <td class="num"><b>${F.money(s.total)}</b></td><td class="num">${r.total ? pctTxt(s.total / r.total) : '—'}</td><td class="num">${pctTxt(s.total / t)}</td>
      <td class="num">${F.num(s.fis)}</td><td class="num">${s.fis ? F.money2(s.sepet) : '—'}</td><td class="num">${s.active}/${m.n}</td>
      <td class="num">${F.money(s.avg)}</td><td class="num">${bestCell(s.ciro, m.dates)}</td><td>${spark(s.ciro, r.color)}</td></tr>`).join('');
    return head + rows;
  }).join('');
  return `<div class="card panel rp-sec">
    <div class="panel-head"><h2>Şube Detaylı Rapor <small>bölgelere göre gruplu · ${m.stores.length} mağaza</small></h2></div>
    <div class="table-wrap rp-stores"><table class="tbl rp-tbl"><thead><tr>
      <th class="num">#</th><th>Şube</th><th class="num">Ciro</th><th class="num">Bölge payı</th><th class="num">Genel pay</th><th class="num">Fiş</th>
      <th class="num">Sepet</th><th class="num">Aktif gün</th><th class="num">Günlük ort.</th><th class="num">En iyi gün</th><th>Seyir</th>
    </tr></thead><tbody>${body}</tbody></table></div></div>`;
}

// ---------------------------------------------------------------- CSV
function csvText(m) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const nm = v => (typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v);
  const row = a => a.map(v => (typeof v === 'number' ? nm(v) : q(v))).join(';');
  const L = [];
  L.push(row(['FURPA Online Raporu', `${dmy(m.dates[0])} - ${dmy(m.dates[m.n - 1])}`]));
  L.push(row(['Toplam ciro', m.total, 'Fiş', m.fis, 'Sepet', m.sepet, 'Günlük ort.', m.avgDay]));
  L.push('');
  L.push(row(['GÜNLÜK']));
  L.push(row(['Tarih', 'Gün', 'Hicri Tarih', 'Hava', 'Min °C', 'Max °C', 'Yağış mm', 'Dini / Resmi / Özel Gün', 'Ciro', 'Fiş', 'Sepet']));
  m.day.forEach(d => L.push(row([dmy(d.date), WD_LONG[d.wd], d.hijri || '', d.w ? weatherInfo(d.w.code)[1] : '', d.w?.tmin ?? '', d.w?.tmax ?? '', d.w?.rain ?? '',
    d.hol.map(h => h.name).concat(d.ramDay > 0 && !d.hol.some(h => h.bayram) ? [`Ramazan ${d.ramDay}. Gün`] : []).join(' + '), d.ciro, d.fis, d.fis ? d.ciro / d.fis : 0])));
  L.push('');
  L.push(row(['BÖLGE']));
  L.push(row(['Bölge', 'Mağaza (aktif)', 'Ciro', 'Pay %', 'Fiş', 'Sepet', 'Günlük ort.', 'En iyi gün']));
  m.regions.forEach(r => L.push(row([r.name, `${r.activeStores}/${r.stores.length}`, r.total, m.total ? (r.total / m.total) * 100 : 0, r.fis, r.sepet, r.avg, r.best >= 0 ? dmy(m.dates[r.best]) : ''])));
  L.push('');
  L.push(row(['ŞUBE']));
  L.push(row(['Bölge', 'Şube', 'Şube No', 'Ciro', 'Genel pay %', 'Fiş', 'Sepet', 'Aktif gün', 'Günlük ort.', 'En iyi gün', 'En iyi gün cirosu']));
  m.regions.forEach(r => r.stores.forEach(s => L.push(row([r.name, s.name, s.id, s.total, m.total ? (s.total / m.total) * 100 : 0, s.fis, s.sepet, s.active, s.avg,
    s.best >= 0 ? dmy(m.dates[s.best]) : '', s.best >= 0 ? s.ciro[s.best] : 0]))));
  return '\uFEFF' + L.join('\r\n');
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------------------------------------------------------------- dışarıya
export function renderReportView(box, ctx) {
  const m = buildModel(ctx);
  const label = m.n === 1 ? dmy(m.dates[0]) : `${dmy(m.dates[0])} – ${dmy(m.dates[m.n - 1])}`;
  box.innerHTML = `
    <div class="rp-toolbar"><div><b>Rapor</b> <span>${label} · ${m.n} gün</span></div>
      <div class="rp-actions"><button class="btn-sound" id="rpPrint">🖨 Yazdır / PDF</button><button class="btn-sound" id="rpCsv">⬇ Excel (CSV)</button></div></div>
    ${kpiCards(m)}${insights(m)}${dailySection(m)}${regionSection(m)}${storeSection(m)}`;

  box.querySelector('#rpPrint').onclick = () => window.print();
  box.querySelector('#rpCsv').onclick = () => download(`FURPA_Rapor_${m.dates[0]}_${m.dates[m.n - 1]}.csv`, csvText(m));

  // Günlük Seyir satır filtresi (Tümü / Dini Bayram & Günler / Resmi & Özel)
  const fltSeg = box.querySelector('#rpDayFilter');
  const tbody = box.querySelector('#rpDailyTbl tbody');
  fltSeg?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-flt]');
    if (!btn || !tbody) return;
    const f = btn.dataset.flt;
    fltSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    let shown = 0;
    tbody.querySelectorAll('tr[data-date]').forEach(tr => {
      const ok = f === 'all' || (f === 'dini' ? tr.dataset.dini === '1' : tr.dataset.ro === '1');
      tr.hidden = !ok;
      if (ok) shown++;
    });
    tbody.querySelector('.rp-no-flt')?.remove();
    if (!shown) {
      const emptyTr = document.createElement('tr');
      emptyTr.className = 'rp-no-flt';
      emptyTr.innerHTML = `<td colspan="8" style="text-align:center;padding:20px;color:var(--mut)">Seçili dönem içinde bu kategoride özel/dini gün bulunmuyor. Üstteki hızlı dönem düğmelerinden dini bayram dönemlerini açabilirsiniz.</td>`;
      tbody.appendChild(emptyTr);
    }
  });

  // Özel gün rozetine tıklayınca ilgili satıra kaydır ve vurgula
  box.querySelectorAll('[data-jump]').forEach(pill => {
    pill.addEventListener('click', () => {
      const dt = pill.dataset.jump;
      if (fltSeg) {
        fltSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.flt === 'all'));
        tbody?.querySelectorAll('tr[data-date]').forEach(tr => (tr.hidden = false));
        tbody?.querySelector('.rp-no-flt')?.remove();
      }
      const tr = tbody?.querySelector(`tr[data-date="${dt}"]`);
      if (tr) {
        tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        tr.classList.remove('rp-row-flash');
        void tr.offsetWidth;
        tr.classList.add('rp-row-flash');
      }
    });
  });

  // Hızlı dini dönem butonları
  box.querySelectorAll('[data-qfrom]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (ctx.onSelectRange) ctx.onSelectRange(btn.dataset.qfrom, btn.dataset.qto);
    });
  });
}
