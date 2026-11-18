using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace FurpaOnline.Services;

/// <summary>
/// Günün canlı özeti (bellek içi). Arka plan servisi besler, ekranlara JSON olarak gider.
/// Ciro = received_sales.status '4' (başarılı satış), brüt (KDV dahil total_price).
/// </summary>
public sealed class LiveState(RegionCatalog regions, IOptionsMonitor<FurpaOptions> options)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const int Slots = 96;
    private const int MaxRecent = 60;

    private readonly object _gate = new();

    private DateTime _day = DateTime.MinValue;
    private long _lastId;
    private readonly HashSet<long> _seenSaleIds = new();

    private Dictionary<string, BranchRow> _branches = new();
    private Dictionary<int, PayMeta> _pay = new();
    private List<RegisterMeta> _registerMeta = new();

    private readonly Dictionary<string, double[]> _amt = new();
    private readonly Dictionary<string, int[]> _cnt = new();
    private readonly Dictionary<string, DateTime> _lastSale = new();
    private readonly Dictionary<string, (int Count, double Amount, DateTime LastAt)> _registers = new();
    private readonly Dictionary<int, (int Count, double Amount)> _payments = new();
    private readonly LinkedList<RecentDto> _recent = new();
    private int _active, _cancelCount;
    private double _cancelAmount;

    private double[] _shareCurve = new double[Slots];
    private double[] _yesterdayCum = new double[Slots];
    private double _avgTotal, _yesterdayTotal;
    private int _forecastDays;

    private DateTime? _lastDataAt, _lastPollAt;
    private string? _error, _warning;
    private bool _dbOk;

    public string CurrentJson { get; private set; } = "{\"loading\":true}";

    public DateTime Day { get { lock (_gate) return _day; } }
    public long LastId { get { lock (_gate) return _lastId; } }

    // ------------------------------------------------------------------ besleme

    public void SetCatalog(List<BranchRow> branches, List<PayMeta> pay)
    {
        lock (_gate)
        {
            _branches = branches.GroupBy(b => b.MarketId).ToDictionary(g => g.Key, g => g.First());
            _pay = pay.GroupBy(p => p.Mediator).ToDictionary(g => g.Key, g => g.First());
        }
    }

    public void SetRegisterMeta(List<RegisterMeta> list)
    {
        lock (_gate) _registerMeta = list;
    }

    public void SetForecast(List<double[]> pastDays, double[] yesterday)
    {
        lock (_gate)
        {
            var curve = new double[Slots];
            int n = 0; double totalSum = 0;
            foreach (var d in pastDays)
            {
                double total = d.Sum();
                if (total <= 0) continue;
                double cum = 0;
                for (int s = 0; s < Slots; s++) { cum += d[s]; curve[s] += cum / total; }
                totalSum += total; n++;
            }
            if (n > 0) for (int s = 0; s < Slots; s++) curve[s] /= n;
            _shareCurve = curve;
            _avgTotal = n > 0 ? totalSum / n : 0;
            _forecastDays = n;

            _yesterdayTotal = yesterday.Sum();
            var ycum = new double[Slots]; double c = 0;
            for (int s = 0; s < Slots; s++) { c += yesterday[s]; ycum[s] = c; }
            _yesterdayCum = ycum;
        }
    }

    public void MarkOk() { lock (_gate) { _dbOk = true; _error = null; _lastPollAt = DateTime.Now; } }
    public void MarkError(string msg) { lock (_gate) { _dbOk = false; _error = msg; } }
    public void SetWarning(string? msg) { lock (_gate) _warning = msg; }

    /// <summary>Mutabakat: günün tüm özetini veritabanından gelenle değiştirir; yeni tamamlanan fişleri döner.</summary>
    public List<RecentDto> ReplaceDay(DateTime day, DayAggregate a)
    {
        var fresh = new List<RecentDto>();
        lock (_gate)
        {
            bool sameDay = _day == day.Date && _seenSaleIds.Count > 0;
            if (_day != day.Date) _seenSaleIds.Clear();

            _day = day.Date;
            _amt.Clear(); _cnt.Clear(); _lastSale.Clear(); _registers.Clear(); _payments.Clear();
            _active = 0; _cancelCount = 0; _cancelAmount = 0;
            DateTime? last = null;

            foreach (var c in a.Cells)
            {
                switch (c.Status)
                {
                    case "4":
                        int s = Math.Clamp(c.Slot, 0, Slots - 1);
                        Amt(c.Market)[s] += c.Amount;
                        Cnt(c.Market)[s] += c.Count;
                        if (!_lastSale.TryGetValue(c.Market, out var ls) || c.LastAt > ls) _lastSale[c.Market] = c.LastAt;
                        if (last is null || c.LastAt > last) last = c.LastAt;
                        break;
                    case "1": case "2": _active += c.Count; break;
                    case "3": _cancelCount += c.Count; _cancelAmount += c.Amount; break;
                }
            }
            foreach (var r in a.Registers) _registers[RegKey(r.Market, r.Kasa)] = (r.Count, r.Amount, r.LastAt);
            foreach (var p in a.Payments)
            {
                _payments.TryGetValue(p.Code, out var cur);
                _payments[p.Code] = (cur.Count + p.Count, cur.Amount + p.Amount);
            }

            var excluded = regions.GetExcludedMarkets();
            _recent.Clear();
            foreach (var r in a.Recent)
            {
                if (excluded.Contains(r.MarketId)) continue;
                var dto = ToRecent(r.Id, r.MarketId, r.Kasa, r.Amount, r.At, r.Method);
                _recent.AddLast(dto);
                if (_seenSaleIds.Add(r.Id) && sameDay) fresh.Add(dto);
            }

            _lastId = Math.Max(_lastId, a.MaxId);
            if (a.MaxId > 0) _lastId = a.MaxId;
            if (last is not null) _lastDataAt = last;
        }
        fresh.Reverse();
        return fresh;
    }

    /// <summary>Canlı artımlı okuma: yeni gelen satışları özete ekler, yayın için yeni başarılı fişleri döner.</summary>
    public List<RecentDto> ApplyNewSales(DateTime day, List<SaleRow> rows, Dictionary<string, List<(int Code, double Amount)>> pays)
    {
        var fresh = new List<RecentDto>();
        lock (_gate)
        {
            var excluded = regions.GetExcludedMarkets();
            foreach (var row in rows)
            {
                if (row.Id > _lastId) _lastId = row.Id;
                if (row.ReceivedAt < day || row.ReceivedAt >= day.AddDays(1) || row.Deleted || row.Refund) continue;
                if (excluded.Contains(row.MarketId)) continue;

                switch (row.Status)
                {
                    case "4":
                        if (!_seenSaleIds.Add(row.Id)) continue;
                        int s = row.CreatedAt < day ? 0 : Math.Clamp((int)(row.CreatedAt - day).TotalMinutes / 15, 0, Slots - 1);
                        Amt(row.MarketId)[s] += row.Total;
                        Cnt(row.MarketId)[s] += 1;
                        if (!_lastSale.TryGetValue(row.MarketId, out var ls) || row.CreatedAt > ls) _lastSale[row.MarketId] = row.CreatedAt;
                        if (_lastDataAt is null || row.CreatedAt > _lastDataAt) _lastDataAt = row.CreatedAt;

                        var key = RegKey(row.MarketId, row.Kasa ?? "");
                        _registers.TryGetValue(key, out var reg);
                        _registers[key] = (reg.Count + 1, reg.Amount + row.Total, row.CreatedAt > reg.LastAt ? row.CreatedAt : reg.LastAt);

                        int? mainCode = null; double mainAmt = double.MinValue;
                        if (pays.TryGetValue(row.Uuid, out var plist))
                        {
                            foreach (var (code, amount) in plist)
                            {
                                _payments.TryGetValue(code, out var cur);
                                _payments[code] = (cur.Count + 1, cur.Amount + amount);
                                if (amount > mainAmt) { mainAmt = amount; mainCode = code; }
                            }
                        }

                        var dto = ToRecent(row.Id, row.MarketId, row.Kasa, row.Total, row.CreatedAt, mainCode);
                        _recent.AddFirst(dto);
                        while (_recent.Count > MaxRecent) _recent.RemoveLast();
                        fresh.Add(dto);
                        break;
                    case "1": case "2": _active++; break;
                    case "3": _cancelCount++; _cancelAmount += row.Total; break;
                }
            }
        }
        return fresh;
    }

    // ------------------------------------------------------------------ çıktı

    public string Build(DateTime now)
    {
        lock (_gate)
        {
            var o = options.CurrentValue;
            var excluded = regions.GetExcludedMarkets();
            var day = _day == DateTime.MinValue ? now.Date : _day;
            bool isToday = day == now.Date;
            int nowSlot = isToday ? Math.Clamp((int)(now - day).TotalMinutes / 15, 0, Slots - 1) : Slots - 1;
            double frac = isToday ? ((now - day).TotalMinutes % 15) / 15.0 : 1.0;
            int hourFrom = Math.Max(0, nowSlot - 3);
            int hourFromPrev = Math.Max(0, nowSlot - 4);

            // Bölgeler
            var regionDefs = regions.Regions.DistinctBy(r => r.Id).ToList();
            var storeIds = new HashSet<string>(_branches.Keys.Where(k => !excluded.Contains(k)));
            foreach (var k in _amt.Keys) if (!excluded.Contains(k)) storeIds.Add(k);
            if (storeIds.Any(id => regions.RegionOf(id) == RegionCatalog.OtherId) && !regionDefs.Any(r => r.Id == RegionCatalog.OtherId))
                regionDefs.Add(RegionCatalog.Other);
            var regionIndex = regionDefs.Select((r, i) => (r.Id, i)).ToDictionary(x => x.Id, x => x.i);

            // Mağazalar
            var stores = new List<StoreDto>();
            var regionSlots = new double[Slots][];
            for (int s = 0; s < Slots; s++) regionSlots[s] = new double[regionDefs.Count];
            var countSlots = new int[Slots];
            var cumHourAgo = new Dictionary<string, double>();

            double ciro = 0, lastHourCiro = 0; int fis = 0, lastHourFis = 0, activeStores = 0;
            foreach (var id in storeIds)
            {
                var a = _amt.TryGetValue(id, out var aa) ? aa : new double[Slots];
                var c = _cnt.TryGetValue(id, out var cc) ? cc : new int[Slots];
                string reg = regions.RegionOf(id);
                int ri = regionIndex[reg];

                double sCiro = 0, sHour = 0, sPrev = 0; int sFis = 0, sHourFis = 0;
                var hourly = new double[24];
                for (int s = 0; s < Slots; s++)
                {
                    sCiro += a[s]; sFis += c[s];
                    hourly[s / 4] += a[s];
                    regionSlots[s][ri] += a[s];
                    countSlots[s] += c[s];
                    if (s >= hourFrom && s <= nowSlot) { sHour += a[s]; sHourFis += c[s]; }
                    if (s < hourFromPrev) sPrev += a[s];
                }
                cumHourAgo[id] = sPrev;
                ciro += sCiro; fis += sFis; lastHourCiro += sHour; lastHourFis += sHourFis;
                if (sFis > 0) activeStores++;

                stores.Add(new StoreDto(id, StoreName(id), reg, R(sCiro), sFis, R(sHour), sHourFis,
                    _lastSale.TryGetValue(id, out var ls) ? Iso(ls) : null, 0, 0, hourly.Select(R).ToArray()));
            }

            // Sıralama: şimdi ve 1 saat önce
            var rankNow = stores.OrderByDescending(s => s.Ciro).Select((s, i) => (s.Id, i + 1)).ToDictionary(x => x.Id, x => x.Item2);
            var rankPrev = cumHourAgo.OrderByDescending(kv => kv.Value).Select((kv, i) => (kv.Key, i + 1)).ToDictionary(x => x.Key, x => x.Item2);
            stores = stores.Select(s => s with { Rank = rankNow[s.Id], PrevRank = rankPrev.TryGetValue(s.Id, out var p) ? p : rankNow[s.Id] })
                           .OrderBy(s => s.Rank).ToList();

            var regionDtos = regionDefs.Select(r =>
            {
                var rs = stores.Where(s => s.Region == r.Id).ToList();
                return new RegionDto(r.Id, r.Name, r.Color, R(rs.Sum(s => s.Ciro)), rs.Sum(s => s.Fis), rs.Count,
                    rs.Count(s => s.Fis > 0), R(rs.Sum(s => s.LastHourCiro)));
            }).ToList();

            // Gün sonu tahmini
            double share = ShareAt(_shareCurve, nowSlot, frac);
            double forecast;
            if (!isToday) forecast = ciro;
            else if (share <= 0.0001) forecast = _avgTotal;
            else
            {
                double raw = ciro / share;
                forecast = share < 0.10 ? (share / 0.10) * raw + (1 - share / 0.10) * _avgTotal : raw;
            }
            forecast = Math.Max(forecast, ciro);
            double ySame = ShareAt(_yesterdayCum, nowSlot, frac);

            // Kasalar
            var activeLimit = now.AddMinutes(-o.ActiveRegisterMinutes);
            var registerDtos = BuildRegisters(excluded);
            int activeRegisters = _registers.Count(kv => !excluded.Contains(kv.Key.Split('|')[0]) && kv.Value.LastAt >= activeLimit);
            int totalRegisters = Math.Max(registerDtos.Count, 1);

            var kpi = new KpiDto(
                R(ciro), fis, fis > 0 ? R(ciro / fis) : 0,
                R(forecast), Math.Round(share, 4), R(_avgTotal), _forecastDays,
                R(_yesterdayTotal), R(ySame),
                _active, _cancelCount, R(_cancelAmount),
                activeRegisters, totalRegisters, activeStores, storeIds.Count,
                R(lastHourCiro), lastHourFis);

            var slots = new SlotsDto(15, nowSlot, regionDefs.Select(r => r.Id).ToList(),
                regionSlots.Select(arr => arr.Select(R).ToArray()).ToArray(), countSlots,
                _yesterdayCum.Select(R).ToArray(), _shareCurve.Select(v => Math.Round(v, 4)).ToArray());

            var snap = new SnapshotDto(false, Iso(now), day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                _dbOk, _error, _warning, _lastDataAt is null ? null : Iso(_lastDataAt.Value), _lastPollAt is null ? null : Iso(_lastPollAt.Value),
                kpi, regionDtos, stores, slots, BuildPayments(), _recent.ToList(), registerDtos);

            CurrentJson = JsonSerializer.Serialize(snap, Json);
            return CurrentJson;
        }
    }

    // ------------------------------------------------------------------ yardımcılar

    private List<PaymentGroupDto> BuildPayments()
    {
        var groups = new Dictionary<string, (string Name, double Amount, int Count, Dictionary<string, (double, int)> Items)>();
        foreach (var (code, v) in _payments)
        {
            var (key, gname) = GroupOf(code);
            string itemName = ItemName(code);
            if (!groups.TryGetValue(key, out var g)) g = (gname, 0, 0, new());
            g.Items.TryGetValue(itemName, out var it);
            g.Items[itemName] = (it.Item1 + v.Amount, it.Item2 + v.Count);
            groups[key] = (g.Name, g.Amount + v.Amount, g.Count + v.Count, g.Items);
        }
        string[] order = ["kart", "nakit", "yemek", "furpa", "online", "diger"];
        return groups
            .OrderBy(kv => Array.IndexOf(order, kv.Key))
            .Select(kv => new PaymentGroupDto(kv.Key, kv.Value.Name, R(kv.Value.Amount), kv.Value.Count,
                kv.Value.Items.OrderByDescending(i => i.Value.Item1)
                    .Select(i => new PaymentItemDto(i.Key, R(i.Value.Item1), i.Value.Item2)).ToList()))
            .ToList();
    }

    private (string Key, string Name) GroupOf(int code)
    {
        if (code == 0) return ("furpa", "Furpa Kart");
        if (!_pay.TryGetValue(code, out var m)) return ("diger", "Diğer");
        return m.PavoType switch
        {
            1 => ("nakit", "Nakit"),
            2 => ("kart", "Kredi Kartı"),
            3 or 13 => ("yemek", "Yemek Kartı"),
            22 => ("online", "Online"),
            0 => ("furpa", "Furpa Kart"),
            _ => ("diger", "Diğer")
        };
    }

    private string ItemName(int code)
    {
        if (code == 0) return "Furpa Kart";
        if (code == 14) return "Online Sipariş";
        return _pay.TryGetValue(code, out var m) ? m.Name : $"Kod {code}";
    }

    private List<RegisterDto> BuildRegisters(HashSet<string> excluded)
    {
        var list = new Dictionary<string, RegisterDto>();
        foreach (var m in _registerMeta)
        {
            string market = m.SubeNo.ToString(CultureInfo.InvariantCulture);
            if (excluded.Contains(market)) continue;
            string kasa = m.KasaNo.ToString(CultureInfo.InvariantCulture);
            _registers.TryGetValue(RegKey(market, kasa), out var r);
            list[RegKey(market, kasa)] = new RegisterDto(market, StoreName(market, m.SubeAdi), kasa, m.Version, m.DbSize,
                r.Count > 0 ? Iso(r.LastAt) : null, r.Count, R(r.Amount));
        }
        foreach (var (key, r) in _registers)
        {
            if (list.ContainsKey(key)) continue;
            var parts = key.Split('|');
            if (excluded.Contains(parts[0])) continue;
            list[key] = new RegisterDto(parts[0], StoreName(parts[0]), parts[1], null, null, Iso(r.LastAt), r.Count, R(r.Amount));
        }
        return list.Values.OrderBy(r => int.TryParse(r.Market, out var v) ? v : 9999).ThenBy(r => r.Kasa).ToList();
    }

    private RecentDto ToRecent(long id, string market, string? kasa, double amount, DateTime at, int? method)
    {
        var (key, name) = method is null ? ("diger", "Bekleniyor") : GroupOf(method.Value);
        return new RecentDto(id, market, StoreName(market), regions.RegionOf(market), kasa, R(amount), Iso(at), key,
            method is null ? name : ItemName(method.Value));
    }

    private static double ShareAt(double[] cum, int slot, double frac)
    {
        if (cum.Length == 0) return 0;
        double prev = slot > 0 ? cum[slot - 1] : 0;
        return prev + (cum[slot] - prev) * frac;
    }

    private string StoreName(string id, string? fallback = null)
        => _branches.TryGetValue(id, out var b) && !string.IsNullOrWhiteSpace(b.Name) ? b.Name : (fallback?.Trim() ?? $"Mağaza {id}");

    private double[] Amt(string m) => _amt.TryGetValue(m, out var a) ? a : _amt[m] = new double[Slots];
    private int[] Cnt(string m) => _cnt.TryGetValue(m, out var a) ? a : _cnt[m] = new int[Slots];
    private static string RegKey(string market, string kasa) => $"{market}|{kasa.Trim()}";
    private static double R(double v) => Math.Round(v, 2);
    private static string Iso(DateTime d) => d.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);
}
