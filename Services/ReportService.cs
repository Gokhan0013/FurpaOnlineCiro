using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace FurpaOnline.Services;

/// <summary>
/// Rapor sayfası verisi: tarih aralığında gün × şube cirosu/fişi + hava durumu.
/// Bölge/şube toplamları ekranda geçmiş görünümden (api/history) gelir; burada günlük kırılım üretilir.
/// Sadece SELECT atar, sonuçlar önbelleğe alınır, aynı anda tek ağır sorgu çalışır.
/// </summary>
public sealed class ReportService(
    ShopigoRepository shop, WeatherService weather, RegionCatalog regions, IOptionsMonitor<FurpaOptions> options, ILogger<ReportService> log)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConcurrentDictionary<string, (DateTime At, string Json)> _cache = new();

    public async Task<string> GetAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        var today = DateTime.Now.Date;
        string key = $"{from:yyyyMMdd}-{to:yyyyMMdd}";
        var ttl = to >= today ? TimeSpan.FromSeconds(45) : TimeSpan.FromMinutes(30);
        if (_cache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.At < ttl) return hit.Json;

        await _gate.WaitAsync(ct);
        try
        {
            if (_cache.TryGetValue(key, out hit) && DateTime.UtcNow - hit.At < ttl) return hit.Json;

            var sw = System.Diagnostics.Stopwatch.StartNew();
            var weatherTask = weather.GetAsync(from, to, ct);
            var rows = await shop.GetDailyAsync(from, to.AddDays(1), ct);
            var (wDays, wError) = await weatherTask;

            var excluded = regions.GetExcludedMarkets();
            int n = (int)(to - from).TotalDays + 1;
            var dates = Enumerable.Range(0, n).Select(i => from.AddDays(i).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).ToArray();
            var totalCiro = new double[n];
            var totalFis = new int[n];
            var stores = new Dictionary<string, (double[] Ciro, int[] Fis)>();

            foreach (var r in rows)
            {
                if (excluded.Contains(r.Market)) continue;
                int i = (int)(r.Day - from).TotalDays;
                if (i < 0 || i >= n) continue;
                if (!stores.TryGetValue(r.Market, out var s)) stores[r.Market] = s = (new double[n], new int[n]);
                s.Ciro[i] += r.Amount; s.Fis[i] += r.Count;
                totalCiro[i] += r.Amount; totalFis[i] += r.Count;
            }

            double R(double v) => Math.Round(v, 2);
            var o = options.CurrentValue;
            var payload = new
            {
                from = dates[0],
                to = dates[^1],
                dates,
                total = new { ciro = totalCiro.Select(R).ToArray(), fis = totalFis },
                stores = stores.ToDictionary(kv => kv.Key, kv => new { ciro = kv.Value.Ciro.Select(R).ToArray(), fis = kv.Value.Fis }),
                weather = new
                {
                    city = o.WeatherCity,
                    error = wError,
                    days = wDays.Select(w => new { date = w.Date, code = w.Code, tmax = w.TMax, tmin = w.TMin, rain = w.Rain, wind = w.Wind })
                }
            };
            var json = JsonSerializer.Serialize(payload, LiveState.Json);
            log.LogInformation("Rapor {From:yyyy-MM-dd} → {To:yyyy-MM-dd} {Ms} ms sürdü", from, to, sw.ElapsedMilliseconds);

            _cache[key] = (DateTime.UtcNow, json);
            if (_cache.Count > 24)
                foreach (var old in _cache.OrderBy(kv => kv.Value.At).Take(_cache.Count - 16).Select(kv => kv.Key).ToList())
                    _cache.TryRemove(old, out _);
            return json;
        }
        finally { _gate.Release(); }
    }
}

