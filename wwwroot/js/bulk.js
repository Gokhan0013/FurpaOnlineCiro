// FURPA Online — Toplu Satışlar sayfası (10.000,00 TL ve üzeri fişler · bölge/şube özeti · tıklanabilir fiş & ödeme detayı)
import * as F from './fmt.js?v=7';
import { PAY_COLORS } from './charts.js?v=26';

const dmy = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const dmyTime = iso => `${dmy(iso)} ${iso.slice(11, 19)}`;
const pctTxt = v => '%' + (v * 100).toFixed(1).replace('.', ',');
const qtyFmt = (q, u) => {
  const isInt = Math.abs(q - Math.round(q)) < 0.0005;
  const n = isInt ? F.num(q) : q.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  return `${n} ${u || 'ADET'}`;
};

const detailCache = new Map();
const detailLoading = new Set();

export function renderBulkView(box, state, handlers) {
  const { data, minAmount, regionFilter, storeFilter, sortBy, query, openUuids } = state;
  const { onMinChange, onRegionFilter, onStoreFilter, onSortChange, onQueryChange, onRefreshDetail } = handlers;

  const datesLabel = data.from === data.to ? dmy(data.from) : `${dmy(data.from)} – ${dmy(data.to)}`;
  const shareAll = data.overallCiro > 0 ? data.totalAmount / data.overallCiro : 0;
  const avgBulk = data.totalCount > 0 ? data.totalAmount / data.totalCount : 0;
  const topSale = data.sales.reduce((b, s) => (!b || s.amount > b.amount ? s : b), null);
  const topPay = data.payments?.[0] || null;
  const activeStoresCount = data.stores.length;
  const activeRegionsCount = data.regions.filter(r => r.count > 0).length;

  // 1) Üst araç çubuğu + alt limit seçici
  const mins = [10000, 25000, 50000, 100000];
  const toolbar = `
    <div class="rp-toolbar">
      <div class="bk-title-wrap">
        <b>Toplu Satışlar</b>
        <span>${datesLabel} · ${F.money2(minAmount)} ve üzeri fişler</span>
      </div>
      <div class="seg" id="bkMinSeg" title="Minimum fiş tutarı">
        ${mins.map(m => `<button data-min="${m}" class="${minAmount === m ? 'on' : ''}">${F.money(m)}+</button>`).join('')}
      </div>
      <div class="rp-actions">
        <button class="btn-sound" id="bkPrint">🖨 Yazdır / PDF</button>
        <button class="btn-sound" id="bkCsv">⬇ Excel (CSV)</button>
      </div>
    </div>`;

  // 2) Özet KPI kartları
  const kpis = [
    ['Toplu Satış Cirosu', F.money2(data.totalAmount), data.overallCiro > 0 ? `Genel cironun ${pctTxt(shareAll)} payı (${F.moneyShort(data.overallCiro)} içinde)` : `${F.num(data.totalCount)} toplu fiş`, 'blue'],
    ['Toplu Fiş Sayısı', F.num(data.totalCount), `${activeStoresCount} şubede · ${activeRegionsCount} bölgede gerçekleşti`, ''],
    ['Ortalama Toplu Fiş', data.totalCount ? F.money2(avgBulk) : '—', `Alt sınır: ${F.money2(minAmount)}`, ''],
    ['En Yüksek Tek Fiş', topSale ? F.money2(topSale.amount) : '—', topSale ? `${F.esc(topSale.store)} · ${dmyTime(topSale.at).slice(0, 16)}` : 'Seçili dönemde yok', 'up'],
    ['Baskın Ödeme Tipi', topPay ? topPay.name : '—', topPay && data.totalAmount > 0 ? `${F.money(topPay.amount)} · ${pctTxt(topPay.amount / data.totalAmount)} pay` : 'Ödeme kaydı yok', 'gold']
  ];
  const kpiHtml = `<div class="rp-kpis">${kpis.map(([t, v, s, c]) => `<div class="card rp-kpi ${c}"><small>${t}</small><b>${v}</b><span>${s}</span></div>`).join('')}</div>`;

  if (data.totalCount === 0) {
    box.innerHTML = `${toolbar}${kpiHtml}
      <div class="card panel rp-empty">
        <h2>Seçili kriterde toplu satış fişi bulunamadı</h2>
        <p>${datesLabel} aralığında ${F.money2(minAmount)} ve üzerinde tamamlanmış satış yok. Üstteki tarih çubuğundan “Dün”, “Son 7 Gün” veya “Bu Ay” seçebilirsiniz.</p>
      </div>`;
    bindToolbar(box, data, onMinChange);
    return;
  }

  // 3) Bölge bazlı çubuk grafik + tablo
  const tAmt = data.totalAmount || 1;
  const maxR = Math.max(...data.regions.map(r => r.amount), 1);
  const regBars = data.regions.map(r => `<div class="rp-hbar bk-reg-pick ${regionFilter === r.id ? 'sel' : ''}" data-reg="${F.esc(r.id)}" title="Bu bölgeye göre filtrelemek için tıklayın">
    <span class="nm"><i style="background:${r.color}"></i>${F.esc(r.name)}</span>
    <span class="track"><i style="width:${r.amount > 0 ? Math.max(1.5, (r.amount / maxR) * 100) : 0}%;background:linear-gradient(90deg, ${r.color}66, ${r.color});box-shadow:0 0 18px -4px ${r.color}"></i></span>
    <span class="val"><b>${F.money(r.amount)}</b><small>${pctTxt(r.amount / tAmt)}</small></span></div>`).join('');

  const regRows = data.regions.map(r => `<tr class="bk-reg-pick ${regionFilter === r.id ? 'sel' : ''}" data-reg="${F.esc(r.id)}">
    <td><span class="rg"><i style="background:${r.color}"></i>${F.esc(r.name)}</span></td>
    <td class="num">${r.activeStores}/${r.totalStores}</td>
    <td class="num">${F.num(r.count)}</td>
    <td class="num"><b>${F.money2(r.amount)}</b></td>
    <td class="num">${pctTxt(r.amount / tAmt)}</td>
    <td class="num">${r.count ? F.money2(r.amount / r.count) : '—'}</td>
    <td class="num">${r.maxAmount > 0 ? F.money2(r.maxAmount) : '—'}</td></tr>`).join('');

  const regionHtml = `<div class="card panel rp-sec">
    <div class="panel-head">
      <h2>Bölge Bazlı Toplu Satışlar <small>${data.regions.length} bölge · filtrelemek için bölgeye tıklayın</small></h2>
      ${regionFilter !== 'all' ? `<button class="btn-clear-flt" id="bkClearReg">✕ Bölge filtresini kaldır</button>` : ''}
    </div>
    <div class="rp-hbars">${regBars}</div>
    <div class="table-wrap"><table class="tbl rp-tbl"><thead><tr>
      <th>Bölge</th><th class="num">Şube</th><th class="num">Toplu Fiş</th><th class="num">Toplu Ciro</th>
      <th class="num">Pay</th><th class="num">Ortalama Fiş</th><th class="num">En Yüksek Fiş</th>
    </tr></thead><tbody>${regRows}
      <tr class="tot"><td>TOPLAM</td><td class="num">${activeStoresCount}/${data.regions.reduce((a, r) => a + r.totalStores, 0)}</td>
        <td class="num">${F.num(data.totalCount)}</td><td class="num"><b>${F.money2(data.totalAmount)}</b></td>
        <td class="num">%100,0</td><td class="num">${F.money2(avgBulk)}</td><td class="num">${topSale ? F.money2(topSale.amount) : '—'}</td></tr>
    </tbody></table></div></div>`;

  // 4) Şube detaylı toplu satışlar (bölgelere göre gruplu)
  const regMap = new Map(data.regions.map(r => [r.id, r]));
  const storeGroups = data.regions
    .filter(r => r.count > 0 && (regionFilter === 'all' || r.id === regionFilter))
    .map(r => {
      const rStores = data.stores.filter(s => s.region === r.id);
      const head = `<tr class="grp" style="--c:${r.color}"><td colspan="2"><span class="rg"><i style="background:${r.color}"></i><b>${F.esc(r.name)}</b></span></td>
        <td class="num">${F.num(r.count)}</td><td class="num">—</td>
        <td class="num"><b>${F.money2(r.amount)}</b></td><td class="num">%100,0</td><td class="num">${pctTxt(r.amount / tAmt)}</td>
        <td class="num">${r.count ? F.money2(r.amount / r.count) : '—'}</td><td class="num">${F.money2(r.maxAmount)}</td></tr>`;
      const rows = rStores.map((s, idx) => `<tr class="bk-store-pick ${storeFilter === s.id ? 'sel' : ''}" data-store="${F.esc(s.id)}" title="Bu şubenin fişlerini filtrelemek için tıklayın">
        <td class="num">${idx + 1}</td>
        <td><b>${F.esc(s.name)}</b> <small>${F.esc(s.id)}</small></td>
        <td class="num">${F.num(s.count)}</td>
        <td class="num">${F.num(s.itemCount)}</td>
        <td class="num"><b>${F.money2(s.amount)}</b></td>
        <td class="num">${r.amount ? pctTxt(s.amount / r.amount) : '—'}</td>
        <td class="num">${pctTxt(s.amount / tAmt)}</td>
        <td class="num">${F.money2(s.amount / s.count)}</td>
        <td class="num">${F.money2(s.maxAmount)}</td></tr>`).join('');
      return head + rows;
    }).join('');

  const storeHtml = `<div class="card panel rp-sec">
    <div class="panel-head">
      <h2>Şube Detaylı Toplu Satışlar <small>bölgelere göre gruplu · şubeye tıklayıp fişlerini süzebilirsiniz</small></h2>
      ${storeFilter ? `<button class="btn-clear-flt" id="bkClearStore">✕ Şube filtresini kaldır</button>` : ''}
    </div>
    <div class="table-wrap rp-stores"><table class="tbl rp-tbl"><thead><tr>
      <th class="num">#</th><th>Şube</th><th class="num">Toplu Fiş</th><th class="num">Kalem</th><th class="num">Toplu Ciro</th>
      <th class="num">Bölge Payı</th><th class="num">Genel Pay</th><th class="num">Ortalama Fiş</th><th class="num">En Yüksek Fiş</th>
    </tr></thead><tbody>${storeGroups}</tbody></table></div></div>`;

  // 5) Fiş listesi + tıklayınca açılan Fiş & Ödeme Detayı
  const q = (query || '').trim().toLocaleLowerCase('tr-TR');
  let filtered = data.sales
    .filter(s => regionFilter === 'all' || s.region === regionFilter)
    .filter(s => !storeFilter || s.market === storeFilter)
    .filter(s => !q ||
      s.store.toLocaleLowerCase('tr-TR').includes(q) ||
      (s.receiptNo || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (s.invoiceNo || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (s.customer || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (s.cashier || '').toLocaleLowerCase('tr-TR').includes(q));

  filtered = [...filtered].sort((a, b) => sortBy === 'time'
    ? (b.at.localeCompare(a.at) || b.id - a.id)
    : (b.amount - a.amount || b.id - a.id));

  const salesRows = filtered.map(s => {
    const r = regMap.get(s.region) || { color: '#8a8a96', name: 'Diğer' };
    const open = openUuids.has(s.uuid);
    const pCol = PAY_COLORS[s.methodKey] || '#888';
    const docBadge = s.invoiceNo
      ? `<span class="bk-inv" title="Fatura / E-Belge No">${F.esc(s.invoiceNo)}</span>`
      : '';
    return `<tr class="store-row bulk-row ${open ? 'open' : ''}" data-uuid="${F.esc(s.uuid)}" title="Fiş kalemlerini ve ödeme detayını görmek için tıklayın">
      <td class="bk-col-time"><span class="chev">▸</span>${dmyTime(s.at)}</td>
      <td class="bk-col-store"><b>${F.esc(s.store)}</b> <small>Kasa ${F.esc(s.kasa || '—')}</small></td>
      <td class="bk-col-region"><span class="rg"><i style="background:${r.color}"></i>${F.esc(r.name)}</span></td>
      <td class="bk-col-doc"><span class="bk-rcp">${F.esc(s.receiptNo || '#' + s.id)}</span>${docBadge}</td>
      <td class="bk-col-who bk-who">${s.customer ? `<b>${F.esc(s.customer)}</b>` : '<span class="mut">—</span>'}${s.cashier ? `<small>Kasiyer: ${F.esc(s.cashier)}</small>` : ''}</td>
      <td class="bk-col-items num">${F.num(s.itemCount)} kalem</td>
      <td class="bk-col-pay"><span class="fm" style="box-shadow:inset 3px 0 0 ${pCol}">${F.esc(s.methodName)}</span></td>
      <td class="bk-col-amt num bk-amt"><b>${F.money2(s.amount)}</b></td>
    </tr>${open ? renderDetailRow(s.uuid, r.color) : ''}`;
  }).join('');

  const activeStoreObj = storeFilter ? data.stores.find(x => x.id === storeFilter) : null;
  const salesHtml = `<div class="card panel rp-sec" id="bkReceiptsCard">
    <div class="panel-head bk-flt-head">
      <h2>Toplu Satış Fişleri <small>${filtered.length} fiş · ${F.money2(filtered.reduce((a, x) => a + x.amount, 0))} · detay için fişin üzerine tıklayın</small></h2>
      <div class="bk-controls">
        ${activeStoreObj ? `<button class="btn-clear-flt" id="bkClearStore2">Şube: ${F.esc(activeStoreObj.name)} ✕</button>` : ''}
        <input class="bk-search" id="bkSearch" placeholder="Şube, fiş no, fatura, müşteri ara…" value="${F.esc(query || '')}" autocomplete="off" />
        <div class="seg" id="bkSortSeg">
          <button data-s="amount" class="${sortBy === 'amount' ? 'on' : ''}">Tutara Göre</button>
          <button data-s="time" class="${sortBy === 'time' ? 'on' : ''}">Saate Göre</button>
        </div>
      </div>
    </div>
    <div class="seg bk-reg-seg" id="bkRegSeg">
      <button data-r="all" class="${regionFilter === 'all' ? 'on' : ''}">Tüm Bölgeler (${data.totalCount})</button>
      ${data.regions.filter(r => r.count > 0).map(r => `<button data-r="${F.esc(r.id)}" class="${regionFilter === r.id ? 'on' : ''}"><i style="background:${r.color}"></i>${F.esc(r.name)} (${r.count})</button>`).join('')}
    </div>
    <div class="table-wrap bk-sales-wrap">
      <table class="tbl rp-tbl" id="bkSalesTable">
        <thead><tr>
          <th>Tarih / Saat</th><th>Şube · Kasa</th><th>Bölge</th><th>Fiş / Fatura No</th>
          <th>Müşteri / Kasiyer</th><th class="num">Kalem</th><th>Ödeme</th><th class="num">Fiş Tutarı</th>
        </tr></thead>
        <tbody>${salesRows || '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--mut)">Filtreye uygun fiş bulunamadı.</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;

  box.innerHTML = `${toolbar}${kpiHtml}${regionHtml}${storeHtml}${salesHtml}`;

  bindToolbar(box, data, onMinChange);
  box.querySelector('#bkClearReg')?.addEventListener('click', () => onRegionFilter('all'));
  box.querySelector('#bkClearStore')?.addEventListener('click', () => onStoreFilter(null));
  box.querySelector('#bkClearStore2')?.addEventListener('click', () => onStoreFilter(null));

  box.querySelectorAll('.bk-reg-pick').forEach(el => {
    el.addEventListener('click', () => onRegionFilter(regionFilter === el.dataset.reg ? 'all' : el.dataset.reg));
  });
  box.querySelector('#bkRegSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-r]');
    if (b) onRegionFilter(b.dataset.r);
  });
  box.querySelectorAll('.bk-store-pick').forEach(el => {
    el.addEventListener('click', () => {
      const next = storeFilter === el.dataset.store ? null : el.dataset.store;
      onStoreFilter(next);
      if (next) setTimeout(() => box.querySelector('#bkReceiptsCard')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
    });
  });
  box.querySelector('#bkSortSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-s]');
    if (b) onSortChange(b.dataset.s);
  });

  const sInp = box.querySelector('#bkSearch');
  if (sInp) {
    sInp.addEventListener('input', () => {
      const pos = sInp.selectionStart;
      onQueryChange(sInp.value, pos);
    });
  }

  box.querySelector('#bkSalesTable tbody')?.addEventListener('click', e => {
    const row = e.target.closest('tr.bulk-row');
    if (!row) return;
    const uuid = row.dataset.uuid;
    if (openUuids.has(uuid)) {
      openUuids.delete(uuid);
      onRefreshDetail();
    } else {
      openUuids.add(uuid);
      onRefreshDetail();
      ensureDetail(uuid, onRefreshDetail);
    }
  });
}

function renderDetailRow(uuid, accentColor) {
  const d = detailCache.get(uuid);
  if (!d) {
    return `<tr class="store-detail"><td colspan="8">
      <div class="sd-wrap bk-detail" style="--c:${accentColor}">
        <div class="bk-loading"><span class="range-spin" style="display:inline-block"></span> Fiş kalemleri ve ödeme detayları okunuyor…</div>
      </div></td></tr>`;
  }
  if (d._error) {
    return `<tr class="store-detail"><td colspan="8">
      <div class="sd-wrap bk-detail" style="--c:var(--down)">
        <small style="color:var(--down)">Fiş detayı alınamadı: ${F.esc(d._error)}</small>
      </div></td></tr>`;
  }

  const totalDisc = (d.discount || 0) + (d.itemDiscount || 0);
  const metaRows = [
    ['Şube / Kasa', `${F.esc(d.store)} (${F.esc(d.market)}) · Kasa ${F.esc(d.kasa || '—')}`],
    ['Bölge', F.esc(d.regionName || '—')],
    ['Fiş Numarası', F.esc(d.receiptNo || '#' + d.id)],
    d.invoiceNo ? ['Fatura / E-Belge', `<b>${F.esc(d.invoiceNo)}</b>${d.docType ? ` (${F.esc(d.docType)})` : ''}`] : null,
    ['Satış Zamanı', dmyTime(d.at)],
    ['Kasiyer', F.esc(d.cashier || '—')],
    d.customer ? ['Müşteri / VKN', `<b>${F.esc(d.customer)}</b>`] : null,
    totalDisc > 0.01 ? ['Brüt / İndirim', `${F.money2(d.originalAmount)} · <span class="down">−${F.money2(totalDisc)} indirim</span>`] : null
  ].filter(Boolean);

  const payCards = (d.payments || []).map(p => {
    const col = PAY_COLORS[p.groupKey] || '#888';
    const extras = [
      p.acquirer ? `POS/Banka: <b>${F.esc(p.acquirer)}</b>` : '',
      p.cardNo ? `Kart: <b>${F.esc(p.cardNo)}</b>` : '',
      p.authCode ? `Onay: <b>${F.esc(p.authCode)}</b>` : '',
      p.batchNo ? `Yığın: ${F.esc(p.batchNo)}` : '',
      p.checkNo ? `Çek/Ref: <b>${F.esc(p.checkNo)}</b>` : ''
    ].filter(Boolean).join(' · ');
    return `<div class="bk-pay-card" style="border-left:3px solid ${col}">
      <div class="bk-pay-top">
        <span><i style="background:${col}"></i><b>${F.esc(p.methodName)}</b> <small>(${F.esc(p.groupName)})</small></span>
        <strong>${F.money2(p.amount)}</strong>
      </div>
      ${extras ? `<div class="bk-pay-sub">${extras}</div>` : ''}
    </div>`;
  }).join('') || '<small class="mut">Bu fişe ait ödeme satırı bulunamadı.</small>';

  const itemRows = (d.items || []).map((it, i) => `<tr>
    <td class="num">${i + 1}</td>
    <td><span class="bk-code">${F.esc(it.code || '—')}</span>${it.barcode ? `<small class="bk-bar">${F.esc(it.barcode)}</small>` : ''}</td>
    <td><b>${F.esc(it.name)}</b></td>
    <td class="num">${qtyFmt(it.qty, it.unit)}</td>
    <td class="num">${F.money2(it.unitPrice)}</td>
    <td class="num">${it.discount > 0.005 ? `<span class="down">−${F.money2(it.discount)}</span>` : '—'}</td>
    <td class="num">%${it.vat}</td>
    <td class="num"><b>${F.money2(it.total)}</b></td>
  </tr>`).join('');

  return `<tr class="store-detail"><td colspan="8">
    <div class="sd-wrap bk-detail" style="--c:${accentColor}">
      <div class="bk-detail-grid">
        <div class="bk-side">
          <div class="bk-sec-title">🧾 Fiş & Belge Bilgileri</div>
          <dl class="bk-meta">${metaRows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
          <div class="bk-sec-title" style="margin-top:14px">💳 Ödeme Detayı <span>${(d.payments || []).length} işlem</span></div>
          <div class="bk-pays">${payCards}</div>
          <div class="bk-net"><span>Fiş Genel Toplamı</span><strong>${F.money2(d.amount)}</strong></div>
        </div>
        <div class="bk-items">
          <div class="bk-sec-title">🛒 Fiş Kalemleri (Ürün Detayı) <span>${(d.items || []).length} kalem</span></div>
          ${(d.items || []).length ? `<div class="bk-items-scroll"><table class="sd-tbl">
            <thead><tr>
              <th class="num">#</th><th>Stok / Barkod</th><th>Ürün Adı</th><th class="num">Miktar</th>
              <th class="num">Birim Fiyat</th><th class="num">İndirim</th><th class="num">KDV</th><th class="num">Tutar</th>
            </tr></thead>
            <tbody>${itemRows}</tbody>
          </table></div>` : '<small class="mut">Kalem detayı bulunamadı.</small>'}
        </div>
      </div>
    </div></td></tr>`;
}

async function ensureDetail(uuid, cb) {
  if (detailCache.has(uuid) || detailLoading.has(uuid)) return;
  detailLoading.add(uuid);
  try {
    const r = await fetch(`api/bulk/detail?uuid=${encodeURIComponent(uuid)}`, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Detay okunamadı');
    detailCache.set(uuid, j);
  } catch (e) {
    detailCache.set(uuid, { _error: e.message || String(e) });
  } finally {
    detailLoading.delete(uuid);
    cb();
  }
}

function bindToolbar(box, data, onMinChange) {
  box.querySelector('#bkMinSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-min]');
    if (b) onMinChange(+b.dataset.min);
  });
  box.querySelector('#bkPrint')?.addEventListener('click', () => window.print());
  box.querySelector('#bkCsv')?.addEventListener('click', () => downloadCsv(data));
}

function downloadCsv(data) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const nm = v => (typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v);
  const row = a => a.map(v => (typeof v === 'number' ? nm(v) : q(v))).join(';');
  const regMap = new Map(data.regions.map(r => [r.id, r.name]));
  const L = [];
  L.push(row(['FURPA Online — Toplu Satışlar Raporu', `${dmy(data.from)} - ${dmy(data.to)}`, `Alt Limit: ${data.minAmount} TL`]));
  L.push(row(['Toplu Ciro', data.totalAmount, 'Toplu Fiş Sayısı', data.totalCount, 'Genel Ciro', data.overallCiro]));
  L.push('');
  L.push(row(['BÖLGE ÖZETİ']));
  L.push(row(['Bölge', 'Aktif Şube', 'Toplu Fiş', 'Toplu Ciro', 'Ortalama Fiş', 'En Yüksek Fiş']));
  data.regions.forEach(r => L.push(row([r.name, `${r.activeStores}/${r.totalStores}`, r.count, r.amount, r.count ? r.amount / r.count : 0, r.maxAmount])));
  L.push('');
  L.push(row(['ŞUBE ÖZETİ']));
  L.push(row(['Bölge', 'Şube', 'Şube No', 'Toplu Fiş', 'Kalem', 'Toplu Ciro', 'Ortalama Fiş', 'En Yüksek Fiş']));
  data.stores.forEach(s => L.push(row([regMap.get(s.region) || 'Diğer', s.name, s.id, s.count, s.itemCount, s.amount, s.count ? s.amount / s.count : 0, s.maxAmount])));
  L.push('');
  L.push(row(['TOPLU SATIŞ FİŞLERİ']));
  L.push(row(['Tarih Saat', 'Bölge', 'Şube', 'Kasa', 'Fiş No', 'Fatura No', 'Müşteri/VKN', 'Kasiyer', 'Kalem Sayısı', 'Ödeme Tipi', 'Tutar']));
  data.sales.forEach(s => L.push(row([dmyTime(s.at), regMap.get(s.region) || 'Diğer', s.store, s.kasa || '', s.receiptNo || '', s.invoiceNo || '', s.customer || '', s.cashier || '', s.itemCount, s.methodName, s.amount])));

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `FURPA_Toplu_Satislar_${data.from}_${data.to}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
