// Türkiye resmi tatilleri, Diyanet dini bayramlar / kandiller / mübarek günler ve perakende için önemli günler.
// 2022–2028 yılları Diyanet İşleri Başkanlığı resmi takvimine birebir sabittir; diğer tüm yıllar Hicri takvim motoruyla otomatik hesaplanır.
// type: 'resmi' (ulusal/resmi tatil), 'dini' (dini bayram, arife, kandil, mübarek gün), 'ozel' (önemli gün)
// off: 'tam' | 'yarim' | null · bayram: true (Ramazan / Kurban Bayramı ve arifeleri)

const pad = n => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const addDays = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return key(t.getFullYear(), t.getMonth() + 1, t.getDate());
};
const diffDays = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);

/** Her yıl Miladi takvimde sabit olan ulusal tatiller ve önemli günler */
const FIXED = {
  '01-01': [{ name: 'Yılbaşı', type: 'resmi', off: 'tam' }],
  '02-14': [{ name: 'Sevgililer Günü', type: 'ozel' }],
  '03-08': [{ name: 'Dünya Kadınlar Günü', type: 'ozel' }],
  '04-23': [{ name: '23 Nisan Ulusal Egemenlik ve Çocuk Bayramı', type: 'resmi', off: 'tam' }],
  '05-01': [{ name: '1 Mayıs Emek ve Dayanışma Günü', type: 'resmi', off: 'tam' }],
  '05-19': [{ name: "19 Mayıs Atatürk'ü Anma, Gençlik ve Spor Bayramı", type: 'resmi', off: 'tam' }],
  '07-15': [{ name: '15 Temmuz Demokrasi ve Milli Birlik Günü', type: 'resmi', off: 'tam' }],
  '08-30': [{ name: '30 Ağustos Zafer Bayramı', type: 'resmi', off: 'tam' }],
  '10-28': [{ name: 'Cumhuriyet Bayramı Arifesi', type: 'resmi', off: 'yarim' }],
  '10-29': [{ name: '29 Ekim Cumhuriyet Bayramı', type: 'resmi', off: 'tam' }],
  '11-10': [{ name: "10 Kasım Atatürk'ü Anma Günü", type: 'ozel' }],
  '11-24': [{ name: '24 Kasım Öğretmenler Günü', type: 'ozel' }],
  '12-31': [{ name: 'Yılbaşı Gecesi', type: 'ozel' }]
};

/** Diyanet dini bayramlar tablosu (arife günü referans alınır: Ramazan 3 gün, Kurban 4 gün) */
const BAYRAM = {
  2022: { ramazan: '2022-05-01', kurban: '2022-07-08' },
  2023: { ramazan: '2023-04-20', kurban: '2023-06-27' },
  2024: { ramazan: '2024-04-09', kurban: '2024-06-15' },
  2025: { ramazan: '2025-03-29', kurban: '2025-06-05' },
  2026: { ramazan: '2026-03-19', kurban: '2026-05-26' },
  2027: { ramazan: '2027-03-08', kurban: '2027-05-15' },
  2028: { ramazan: '2028-02-25', kurban: '2028-05-04' }
};

/** Diyanet kandiller ve önemli dini günler/geceler listesi [tarih, ad] (aynı günde birden fazla dini gün olabilir) */
const DINI_LIST = [
  // 2022
  ['2022-02-02', 'Üç Ayların Başlangıcı'],
  ['2022-02-03', 'Regaip Kandili'],
  ['2022-02-27', 'Miraç Kandili'],
  ['2022-03-17', 'Berat Kandili'],
  ['2022-04-02', 'Ramazan Başlangıcı'],
  ['2022-04-27', 'Kadir Gecesi'],
  ['2022-07-07', 'Terviye Günü'],
  ['2022-07-30', 'Hicri Yılbaşı'],
  ['2022-08-08', 'Aşure Günü'],
  ['2022-10-07', 'Mevlid Kandili'],

  // 2023
  ['2023-01-23', 'Üç Ayların Başlangıcı'],
  ['2023-01-26', 'Regaip Kandili'],
  ['2023-02-17', 'Miraç Kandili'],
  ['2023-03-06', 'Berat Kandili'],
  ['2023-03-23', 'Ramazan Başlangıcı'],
  ['2023-04-17', 'Kadir Gecesi'],
  ['2023-06-26', 'Terviye Günü'],
  ['2023-07-19', 'Hicri Yılbaşı'],
  ['2023-07-28', 'Aşure Günü'],
  ['2023-09-26', 'Mevlid Kandili'],

  // 2024
  ['2024-01-11', 'Regaip Kandili'],
  ['2024-01-12', 'Üç Ayların Başlangıcı'],
  ['2024-02-06', 'Miraç Kandili'],
  ['2024-02-24', 'Berat Kandili'],
  ['2024-03-11', 'Ramazan Başlangıcı'],
  ['2024-04-05', 'Kadir Gecesi'],
  ['2024-06-14', 'Terviye Günü'],
  ['2024-07-07', 'Hicri Yılbaşı'],
  ['2024-07-16', 'Aşure Günü'],
  ['2024-09-14', 'Mevlid Kandili'],

  // 2025
  ['2025-01-01', 'Üç Ayların Başlangıcı'],
  ['2025-01-02', 'Regaip Kandili'],
  ['2025-01-26', 'Miraç Kandili'],
  ['2025-02-13', 'Berat Kandili'],
  ['2025-03-01', 'Ramazan Başlangıcı'],
  ['2025-03-26', 'Kadir Gecesi'],
  ['2025-06-04', 'Terviye Günü'],
  ['2025-06-26', 'Hicri Yılbaşı'],
  ['2025-07-05', 'Aşure Günü'],
  ['2025-09-03', 'Mevlid Kandili'],
  ['2025-12-21', 'Üç Ayların Başlangıcı'],
  ['2025-12-25', 'Regaip Kandili'],

  // 2026
  ['2026-01-15', 'Miraç Kandili'],
  ['2026-02-02', 'Berat Kandili'],
  ['2026-02-19', 'Ramazan Başlangıcı'],
  ['2026-03-16', 'Kadir Gecesi'],
  ['2026-05-25', 'Terviye Günü'],
  ['2026-06-16', 'Hicri Yılbaşı'],
  ['2026-06-25', 'Aşure Günü'],
  ['2026-08-24', 'Mevlid Kandili'],
  ['2026-12-10', 'Üç Ayların Başlangıcı'],
  ['2026-12-10', 'Regaip Kandili'],

  // 2027
  ['2027-01-04', 'Miraç Kandili'],
  ['2027-01-22', 'Berat Kandili'],
  ['2027-02-08', 'Ramazan Başlangıcı'],
  ['2027-03-05', 'Kadir Gecesi'],
  ['2027-05-14', 'Terviye Günü'],
  ['2027-06-06', 'Hicri Yılbaşı'],
  ['2027-06-15', 'Aşure Günü'],
  ['2027-08-13', 'Mevlid Kandili'],
  ['2027-11-29', 'Üç Ayların Başlangıcı'],
  ['2027-12-02', 'Regaip Kandili'],
  ['2027-12-24', 'Miraç Kandili'],

  // 2028
  ['2028-01-11', 'Berat Kandili'],
  ['2028-01-28', 'Ramazan Başlangıcı'],
  ['2028-02-22', 'Kadir Gecesi'],
  ['2028-05-03', 'Terviye Günü'],
  ['2028-05-25', 'Hicri Yılbaşı'],
  ['2028-06-03', 'Aşure Günü'],
  ['2028-08-02', 'Mevlid Kandili'],
  ['2028-11-18', 'Üç Ayların Başlangıcı'],
  ['2028-11-23', 'Regaip Kandili'],
  ['2028-12-13', 'Miraç Kandili'],
  ['2028-12-30', 'Berat Kandili']
];

/** Ramazan ayı aralıkları [başlangıç, arife] */
const RAMAZAN = [
  ['2022-04-02', '2022-05-01'],
  ['2023-03-23', '2023-04-20'],
  ['2024-03-11', '2024-04-09'],
  ['2025-03-01', '2025-03-29'],
  ['2026-02-19', '2026-03-19'],
  ['2027-02-08', '2027-03-08'],
  ['2028-01-28', '2028-02-25']
];

// Hicri takvim biçimlendiricileri (tablo dışı yıllar ve Hicri gün gösterimi için)
let hijriPartsFmt = null;
let hijriTrFmt = null;
try {
  hijriPartsFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric' });
  hijriTrFmt = new Intl.DateTimeFormat('tr-TR-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' });
} catch { }

function hijriParts(dt) {
  if (!hijriPartsFmt) return null;
  let d = 0, m = 0, y = 0;
  for (const p of hijriPartsFmt.formatToParts(dt)) {
    if (p.type === 'day') d = +p.value;
    else if (p.type === 'month') m = +p.value;
    else if (p.type === 'year') y = +p.value;
  }
  return d && m ? { d, m, y } : null;
}

/** 'yyyy-MM-dd' → Türkçe Hicri tarih etiketi (Ramazan ve Bayram günlerinde Diyanet takvimine birebir kilitlenir) */
export function hijriLabel(date) {
  if (!hijriTrFmt) return '';
  try {
    const dt = new Date(date + 'T12:00:00');
    const hp = hijriParts(dt);
    const hy = hp?.y || '';
    const rDay = ramazanDayOf(date);
    if (rDay > 0 && hy) return `${rDay} Ramazan ${hy}`;
    const y = +date.slice(0, 4);
    const b = BAYRAM[y];
    if (b && hy) {
      const dr = diffDays(b.ramazan, date);
      if (dr >= 1 && dr <= 3) return `${dr} Şevval ${hy}`;
      const dk = diffDays(b.kurban, date);
      if (dk === -1) return `8 Zilhicce ${hy}`;
      if (dk === 0) return `9 Zilhicce ${hy}`;
      if (dk >= 1 && dk <= 4) return `${9 + dk} Zilhicce ${hy}`;
    }
    return hijriTrFmt
      .format(dt)
      .replace(/^Hicri\s+/i, '')
      .replace(/^0(\d)\s/, '$1 ');
  } catch {
    return '';
  }
}

/** Ayın n. gününü (haftanın günü w: 0=Pazar) bulur */
function nthWeekday(y, m, w, n) {
  const first = new Date(y, m - 1, 1).getDay();
  const d = 1 + ((w - first + 7) % 7) + (n - 1) * 7;
  return key(y, m, d);
}

const cache = new Map();

function addHijriFallbackYear(y, add) {
  if (!hijriPartsFmt) return;
  const daysInYear = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365;
  let recepThuAdded = new Set();
  for (let i = 0; i < daysInYear; i++) {
    const dt = new Date(y, 0, 1 + i, 12, 0, 0);
    const ds = key(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    const hp = hijriParts(dt);
    if (!hp) continue;
    const { d, m, y: hy } = hp;
    const nextHp = hijriParts(new Date(y, 0, 2 + i, 12, 0, 0));

    if (m === 1 && d === 1) add(ds, { name: 'Hicri Yılbaşı', type: 'dini' });
    if (m === 1 && d === 10) add(ds, { name: 'Aşure Günü', type: 'dini' });
    if (m === 3 && d === 11) add(ds, { name: 'Mevlid Kandili', type: 'dini' });
    if (m === 7 && d === 1) add(ds, { name: 'Üç Ayların Başlangıcı', type: 'dini' });
    if (m === 7 && d <= 7 && dt.getDay() === 4 && !recepThuAdded.has(hy)) {
      recepThuAdded.add(hy);
      add(ds, { name: 'Regaip Kandili', type: 'dini' });
    }
    if (m === 7 && d === 26) add(ds, { name: 'Miraç Kandili', type: 'dini' });
    if (m === 8 && d === 14) add(ds, { name: 'Berat Kandili', type: 'dini' });
    if (m === 9 && d === 1) add(ds, { name: 'Ramazan Başlangıcı', type: 'dini' });
    if (m === 9 && d === 26) add(ds, { name: 'Kadir Gecesi', type: 'dini' });
    if (m === 9 && nextHp && nextHp.m === 10 && nextHp.d === 1) add(ds, { name: 'Ramazan Bayramı Arefesi', type: 'dini', off: 'yarim', bayram: true });
    if (m === 10 && d >= 1 && d <= 3) add(ds, { name: `Ramazan Bayramı ${d}. Gün`, type: 'dini', off: 'tam', bayram: true });
    if (m === 12 && d === 8) add(ds, { name: 'Terviye Günü', type: 'dini' });
    if (m === 12 && d === 9) add(ds, { name: 'Kurban Bayramı Arefesi', type: 'dini', off: 'yarim', bayram: true });
    if (m === 12 && d >= 10 && d <= 13) add(ds, { name: `Kurban Bayramı ${d - 9}. Gün`, type: 'dini', off: 'tam', bayram: true });
  }
}

function buildYear(y) {
  const map = new Map();
  const add = (date, item) => {
    if (!map.has(date)) map.set(date, []);
    const arr = map.get(date);
    if (!arr.some(x => x.name === item.name)) arr.push(item);
  };

  for (const [md, items] of Object.entries(FIXED)) items.forEach(it => add(`${y}-${md}`, it));

  add(nthWeekday(y, 5, 0, 2), { name: 'Anneler Günü', type: 'ozel' });
  add(nthWeekday(y, 6, 0, 3), { name: 'Babalar Günü', type: 'ozel' });
  // Efsane Cuma / Black Friday: Kasım'ın 4. Perşembesinden sonraki Cuma
  add(addDays(nthWeekday(y, 11, 4, 4), 1), { name: 'Efsane Cuma (Black Friday)', type: 'ozel' });

  const b = BAYRAM[y];
  if (b) {
    // Dini bayramlar 'dini' tipindedir (🌙 simgesi) ve 'off: tam' ile aynı zamanda resmi tatil niteliğini korur
    add(b.ramazan, { name: 'Ramazan Bayramı Arefesi', type: 'dini', off: 'yarim', bayram: true });
    for (let i = 1; i <= 3; i++) add(addDays(b.ramazan, i), { name: `Ramazan Bayramı ${i}. Gün`, type: 'dini', off: 'tam', bayram: true });
    add(b.kurban, { name: 'Kurban Bayramı Arefesi', type: 'dini', off: 'yarim', bayram: true });
    for (let i = 1; i <= 4; i++) add(addDays(b.kurban, i), { name: `Kurban Bayramı ${i}. Gün`, type: 'dini', off: 'tam', bayram: true });
    for (const [date, name] of DINI_LIST) if (date.startsWith(String(y))) add(date, { name, type: 'dini' });
  } else {
    addHijriFallbackYear(y, add);
  }
  return map;
}

/** 'yyyy-MM-dd' → o günün özel/resmi/dini günleri */
export function holidaysOf(date) {
  const y = +date.slice(0, 4);
  if (!cache.has(y)) cache.set(y, buildYear(y));
  return cache.get(y).get(date) || [];
}

/** Ramazan ayının kaçıncı günü? (Ramazan dışındaysa 0 döner) */
export function ramazanDayOf(date) {
  for (const [a, b] of RAMAZAN) {
    if (date >= a && date <= b) return diffDays(a, date) + 1;
  }
  const y = +date.slice(0, 4);
  if (!BAYRAM[y] && hijriPartsFmt) {
    const hp = hijriParts(new Date(date + 'T12:00:00'));
    if (hp && hp.m === 9) return hp.d;
  }
  return 0;
}

/** Ramazan ayı içinde mi? */
export function inRamazan(date) {
  return ramazanDayOf(date) > 0;
}

/** Seçili aralık dışında kalan en yakın önceki ve sonraki dini günleri bulur */
export function nearbyReligiousDays(fromDate, toDate) {
  const y0 = +fromDate.slice(0, 4) - 1;
  const y1 = +toDate.slice(0, 4) + 1;
  const all = [];
  for (let y = y0; y <= y1; y++) {
    if (!cache.has(y)) cache.set(y, buildYear(y));
    for (const [dt, list] of cache.get(y).entries()) {
      const dini = list.filter(h => h.type === 'dini');
      if (dini.length) all.push({ date: dt, names: dini.map(h => h.name).join(' · ') });
    }
  }
  all.sort((a, b) => a.date.localeCompare(b.date));
  let prev = null, next = null;
  for (const it of all) {
    if (it.date < fromDate) prev = it;
    else if (it.date > toDate && !next) { next = it; break; }
  }
  return { prev, next };
}

/** Yıla ait hızlı dini dönem aralıkları (Rapor sayfasında tek tıkla geçiş için) */
export function religiousPresets(refDate) {
  const y = +(refDate || '2026').slice(0, 4);
  const b = BAYRAM[y] || BAYRAM[2026];
  const yr = BAYRAM[y] ? y : 2026;
  const ramRange = RAMAZAN.find(([a]) => a.startsWith(String(yr)));
  const out = [];
  if (ramRange && b) {
    out.push({ label: `🌙 ${yr} Ramazan & Bayram`, from: ramRange[0], to: addDays(b.ramazan, 3) });
    out.push({ label: `🌙 ${yr} Kurban Bayramı`, from: addDays(b.kurban, -1), to: addDays(b.kurban, 4) });
  }
  out.push({ label: `📅 ${yr} Tüm Yıl (Dini & Resmi Günler)`, from: `${yr}-01-01`, to: `${yr}-12-31` });
  return out;
}

/** Tam tatil günü mü? (resmi tatil + dini bayram) */
export const isOffDay = date => holidaysOf(date).some(h => h.off === 'tam');

/** WMO hava durumu kodu → [emoji, Türkçe açıklama] */
export function weatherInfo(code) {
  if (code === 0) return ['☀️', 'Açık'];
  if (code === 1) return ['🌤️', 'Çoğunlukla açık'];
  if (code === 2) return ['⛅', 'Parçalı bulutlu'];
  if (code === 3) return ['☁️', 'Kapalı'];
  if (code === 45 || code === 48) return ['🌫️', 'Sisli'];
  if (code >= 51 && code <= 57) return ['🌦️', 'Çisenti'];
  if (code >= 61 && code <= 65) return ['🌧️', 'Yağmurlu'];
  if (code === 66 || code === 67) return ['🌧️', 'Dondurucu yağmur'];
  if (code >= 71 && code <= 77) return ['❄️', 'Karlı'];
  if (code >= 80 && code <= 82) return ['🌧️', 'Sağanak yağış'];
  if (code === 85 || code === 86) return ['🌨️', 'Kar sağanağı'];
  if (code >= 95) return ['⛈️', 'Gök gürültülü fırtına'];
  return ['❔', 'Bilinmiyor'];
}
