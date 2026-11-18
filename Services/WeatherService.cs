using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace FurpaOnline.Services;

public sealed record WeatherDay(string Date, int Code, double? TMax, double? TMin, double? Rain, double? Wind);

/// <summary>
/// Seçili günlerin hava durumu (Open-Meteo: eski günler arşiv, son günler tahmin/analiz uç noktası).
/// Günler bellekte önbelleğe alınır; internet yoksa rapor hava durumu olmadan açılır.
/// </summary>
public sealed class WeatherService(IOptionsMonitor<FurpaOptions> options, ILogger<WeatherService> log)
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly ConcurrentDictionary<string, (DateTime At, WeatherDay Day)> _days = new();

    private const string Daily = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max";

    public async Task<(List<WeatherDay> Days, string? Error)> GetAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        var o = options.CurrentValue;
        var today = DateTime.Now.Date;
        if (to > today) to = today;
        var result = new List<WeatherDay>();
        string? error = null;

        var missing = new List<DateTime>();
        for (var d = from.Date; d <= to; d = d.AddDays(1))
        {
            if (_days.TryGetValue(Key(d), out var c) && Fresh(d, c.At, today)) result.Add(c.Day);
            else missing.Add(d);
        }

        if (missing.Count > 0)
        {
            var recentFrom = today.AddDays(-10);
            try
            {
                var old = missing.Where(d => d < recentFrom).ToList();
                var recent = missing.Where(d => d >= recentFrom).ToList();
                if (old.Count > 0) await FetchAsync("https://archive-api.open-meteo.com/v1/archive", old.Min(), old.Max(), o, ct);
                if (recent.Count > 0) await FetchAsync("https://api.open-meteo.com/v1/forecast", recent.Min(), recent.Max(), o, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Hava durumu alınamadı");
                error = "Hava durumu servisine ulaşılamadı (internet bağlantısını kontrol edin).";
            }

            result.Clear();
            for (var d = from.Date; d <= to; d = d.AddDays(1))
                if (_days.TryGetValue(Key(d), out var c)) result.Add(c.Day);
        }
        return (result, result.Count == 0 ? error : null);
    }

    private static string Key(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    // Tamamlanmış eski günler kalıcı, son günler 3 saat önbellekte kalır
    private static bool Fresh(DateTime day, DateTime fetchedAt, DateTime today)
        => day < today.AddDays(-10) || DateTime.UtcNow - fetchedAt < TimeSpan.FromHours(3);

    private async Task FetchAsync(string baseUrl, DateTime from, DateTime to, FurpaOptions o, CancellationToken ct)
    {
        var ci = CultureInfo.InvariantCulture;
        string url = $"{baseUrl}?latitude={o.WeatherLat.ToString(ci)}&longitude={o.WeatherLon.ToString(ci)}" +
                     $"&start_date={Key(from)}&end_date={Key(to)}&daily={Daily}&timezone=Europe%2FIstanbul";
        using var resp = await Http.GetAsync(url, ct);
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var daily = doc.RootElement.GetProperty("daily");
        var times = daily.GetProperty("time");
        double? Num(string name, int i)
        {
            if (!daily.TryGetProperty(name, out var arr) || i >= arr.GetArrayLength()) return null;
            var v = arr[i];
            return v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
        }
        for (int i = 0; i < times.GetArrayLength(); i++)
        {
            string date = times[i].GetString()!;
            var code = Num("weather_code", i);
            var tmax = Num("temperature_2m_max", i);
            if (code is null && tmax is null) continue;   // henüz verisi olmayan gün
            var day = new WeatherDay(date, (int)(code ?? -1), tmax, Num("temperature_2m_min", i), Num("precipitation_sum", i), Num("wind_speed_10m_max", i));
            _days[date] = (DateTime.UtcNow, day);
        }
    }
}

