using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace FurpaOnline.Services;

public sealed record MarketItemDto(string Key, string Name, string Symbol, double Buying, double Selling, double Change);
public sealed record MarketQuoteDto(bool Ok, string? UpdatedAt, string Source, List<MarketItemDto> Items);

/// <summary>
/// Döviz (USD, EUR) ve Altın (Gram, Çeyrek) canlı piyasa kurları.
/// Birincil kaynak: Serbest piyasa (Truncgil JSON — sonu kesilse bile hedef blokları çıkarır).
/// Yedek kaynaklar: TCMB resmi kur XML + spot ons altın (GoldPrice / Gold-API) ve son geçerli önbellek.
/// </summary>
public sealed partial class MarketService(ILogger<MarketService> log)
{
    private static readonly HttpClient Http = CreateClient();
    private static readonly string[] OrderedKeys = ["usd", "eur", "gram", "ceyrek"];
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, MarketItemDto> _lastItems = new(StringComparer.OrdinalIgnoreCase);
    private DateTime _fetchedAt = DateTime.MinValue;
    private string _cachedJson = JsonSerializer.Serialize(new MarketQuoteDto(false, null, "", []), LiveState.Json);
    private bool _hasGoodCache;

    [GeneratedRegex(@"""Update_Date""\s*:\s*""([^""]+)""", RegexOptions.CultureInvariant)]
    private static partial Regex UpdateDateRegex();

    private static HttpClient CreateClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("FurpaOnline/1.0");
        return c;
    }

    public async Task<string> GetJsonAsync(CancellationToken ct)
    {
        if (_hasGoodCache && DateTime.UtcNow - _fetchedAt < TimeSpan.FromMinutes(2))
            return _cachedJson;

        await _gate.WaitAsync(ct);
        try
        {
            if (_hasGoodCache && DateTime.UtcNow - _fetchedAt < TimeSpan.FromMinutes(2))
                return _cachedJson;

            var byKey = new Dictionary<string, MarketItemDto>(StringComparer.OrdinalIgnoreCase);
            var sources = new List<string>();
            string? updated = null;

            // 1) Birincil kaynak: Truncgil (kesilmiş JSON gövdelerine karşı dayanıklı blok ayrıştırıcı)
            var trunc = await TryTruncgilAsync(ct);
            if (trunc is not null)
            {
                updated ??= trunc.UpdatedAt;
                foreach (var it in trunc.Items) byKey[it.Key] = it;
                if (trunc.Items.Count > 0) sources.Add("Serbest Piyasa");
            }

            // 2) Eksik döviz varsa TCMB resmi kur XML
            if (!byKey.ContainsKey("usd") || !byKey.ContainsKey("eur"))
            {
                var tcmb = await TryTcmbAsync(ct);
                if (tcmb is not null)
                {
                    updated ??= tcmb.UpdatedAt;
                    foreach (var it in tcmb.Items)
                        byKey.TryAdd(it.Key, it);
                    if (tcmb.Items.Count > 0) sources.Add("TCMB");
                }
            }

            // Dövizleri son geçerli değerlere işle / eksikse hafızadan tamamla
            foreach (var k in new[] { "usd", "eur" })
            {
                if (byKey.TryGetValue(k, out var liveFx)) _lastItems[k] = liveFx;
                else if (_lastItems.TryGetValue(k, out var memFx)) byKey[k] = memFx;
            }

            // 3) Gram / Çeyrek Altın eksikse spot ons altın (GoldPrice / Gold-API) üzerinden hesapla
            double usdSell = byKey.TryGetValue("usd", out var uDto) ? uDto.Selling : 0;
            if ((!byKey.ContainsKey("gram") || !byKey.ContainsKey("ceyrek")) && usdSell > 0)
            {
                var spot = await TryGoldPriceOrgAsync(usdSell, ct);
                if (spot is { Count: > 0 })
                {
                    foreach (var g in spot) byKey.TryAdd(g.Key, g);
                    if (!sources.Contains("Spot Altın")) sources.Add("Spot Altın");
                }
            }

            // 4) Canlı altın verilerini kaydet; hâlâ eksikse son başarılı değeri veya USD bazlı yedeği kullan
            foreach (var k in new[] { "gram", "ceyrek" })
            {
                if (byKey.TryGetValue(k, out var liveGold)) _lastItems[k] = liveGold;
                else if (_lastItems.TryGetValue(k, out var memGold)) byKey[k] = memGold;
            }

            if ((!byKey.ContainsKey("gram") || !byKey.ContainsKey("ceyrek")) && usdSell > 0)
            {
                double estGramSell = Math.Round(usdSell * 124.5, 2);
                double estGramBuy = Math.Round(estGramSell * 0.996, 2);
                double estCeyrekSell = Math.Round(estGramSell * 1.65, 2);
                double estCeyrekBuy = Math.Round(estGramSell * 1.63, 2);
                byKey.TryAdd("gram", new MarketItemDto("gram", "Gram Altın", "Au", estGramBuy, estGramSell, 0));
                byKey.TryAdd("ceyrek", new MarketItemDto("ceyrek", "Çeyrek Altın", "¼", estCeyrekBuy, estCeyrekSell, 0));
            }

            var finalItems = new List<MarketItemDto>(4);
            foreach (var k in OrderedKeys)
            {
                if (byKey.TryGetValue(k, out var it) && it.Selling > 0)
                {
                    _lastItems[k] = it;
                    finalItems.Add(it);
                }
            }

            if (finalItems.Count > 0)
            {
                var srcText = sources.Count > 0 ? string.Join(" + ", sources) : "Önbellek";
                var dto = new MarketQuoteDto(true, updated ?? DateTime.Now.ToString("HH:mm", CultureInfo.InvariantCulture), srcText, finalItems);
                _cachedJson = JsonSerializer.Serialize(dto, LiveState.Json);
                _fetchedAt = DateTime.UtcNow;
                _hasGoodCache = true;
            }

            return _cachedJson;
        }
        finally { _gate.Release(); }
    }

    private async Task<MarketQuoteDto?> TryTruncgilAsync(CancellationToken ct)
    {
        try
        {
            using var resp = await Http.GetAsync("https://finans.truncgil.com/v4/today.json", HttpCompletionOption.ResponseHeadersRead, ct);
            resp.EnsureSuccessStatusCode();
            string raw;
            try
            {
                raw = await resp.Content.ReadAsStringAsync(ct);
            }
            catch (Exception readEx) when (readEx is not OperationCanceledException)
            {
                log.LogWarning(readEx, "Truncgil yanıtı akışı kesildi, kısmi okuma yapılamadı.");
                return null;
            }

            if (string.IsNullOrWhiteSpace(raw)) return null;

            string? updated = null;
            var um = UpdateDateRegex().Match(raw);
            if (um.Success) updated = um.Groups[1].Value;

            var items = new List<MarketItemDto>();
            void Collect(string key, string name, string sym, params string[] jsonKeys)
            {
                foreach (var jk in jsonKeys)
                {
                    var item = TryExtractItem(raw, jk, key, name, sym);
                    if (item is not null) { items.Add(item); return; }
                }
            }

            Collect("usd", "ABD Doları", "$", "USD", "usd");
            Collect("eur", "Euro", "€", "EUR", "eur");
            Collect("gram", "Gram Altın", "Au", "GRA", "gram-altin", "gram_altin");
            Collect("ceyrek", "Çeyrek Altın", "¼", "CEYREKALTIN", "ceyrek-altin", "ceyrek_altin");

            if (items.Count == 0)
            {
                log.LogWarning("Truncgil JSON içinde beklenen kur blokları bulunamadı (uzunluk: {Len}).", raw.Length);
                return null;
            }

            if (items.Count < 4)
                log.LogInformation("Truncgil'den {Count}/4 kalem çıkarıldı; eksikler ikincil kaynaktan tamamlanacak.", items.Count);

            return new MarketQuoteDto(true, updated ?? DateTime.Now.ToString("HH:mm", CultureInfo.InvariantCulture), "Serbest Piyasa", items);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Serbest piyasa kurları okunamadı, ikincil kaynaklar denenecek.");
            return null;
        }
    }

    private static MarketItemDto? TryExtractItem(string rawJson, string jsonKey, string key, string name, string sym)
    {
        var pat = $@"""{Regex.Escape(jsonKey)}""\s*:\s*(\{{[^{{}}]*\}})";
        var m = Regex.Match(rawJson, pat, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (!m.Success) return null;

        try
        {
            using var doc = JsonDocument.Parse(m.Groups[1].Value);
            var el = doc.RootElement;
            if (el.ValueKind != JsonValueKind.Object) return null;

            double buy = ReadNum(el, "Buying", "Alış", "alis");
            double sell = ReadNum(el, "Selling", "Satış", "satis");
            double chg = ReadNum(el, "Change", "Değişim", "degisim");
            if (sell <= 0 && buy <= 0) return null;
            if (sell <= 0) sell = buy;
            if (buy <= 0) buy = sell;

            return new MarketItemDto(key, name, sym, Math.Round(buy, 2), Math.Round(sell, 2), Math.Round(chg, 2));
        }
        catch
        {
            return null;
        }
    }

    private async Task<List<MarketItemDto>?> TryGoldPriceOrgAsync(double usdSell, CancellationToken ct)
    {
        double xauUsd = 0;
        double chgPct = 0;

        try
        {
            using var resp = await Http.GetAsync("https://data-asg.goldprice.org/dbXRates/USD", ct);
            resp.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            if (doc.RootElement.TryGetProperty("items", out var arr) && arr.ValueKind == JsonValueKind.Array && arr.GetArrayLength() > 0)
            {
                var first = arr[0];
                xauUsd = ReadNum(first, "xauPrice");
                chgPct = ReadNum(first, "pcXau");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "GoldPrice.org ons altın alınamadı, Gold-API denenecek.");
        }

        if (xauUsd <= 0)
        {
            try
            {
                using var resp = await Http.GetAsync("https://api.gold-api.com/price/XAU", ct);
                resp.EnsureSuccessStatusCode();
                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
                xauUsd = ReadNum(doc.RootElement, "price");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Gold-API ons altın da okunamadı.");
            }
        }

        if (xauUsd <= 0 || usdSell <= 0) return null;

        double gramSell = Math.Round((xauUsd * usdSell) / 31.1034768, 2);
        double gramBuy = Math.Round(gramSell * 0.996, 2);
        double ceyrekSell = Math.Round(gramSell * 1.65, 2);
        double ceyrekBuy = Math.Round(gramSell * 1.63, 2);

        return
        [
            new MarketItemDto("gram", "Gram Altın", "Au", gramBuy, gramSell, Math.Round(chgPct, 2)),
            new MarketItemDto("ceyrek", "Çeyrek Altın", "¼", ceyrekBuy, ceyrekSell, Math.Round(chgPct, 2))
        ];
    }

    private async Task<MarketQuoteDto?> TryTcmbAsync(CancellationToken ct)
    {
        try
        {
            using var resp = await Http.GetAsync("https://www.tcmb.gov.tr/kurlar/today.xml", ct);
            resp.EnsureSuccessStatusCode();
            var xml = XDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            var items = new List<MarketItemDto>();

            void AddFx(string code, string key, string name, string sym)
            {
                var el = xml.Descendants("Currency").FirstOrDefault(x => (string?)x.Attribute("CurrencyCode") == code);
                if (el is null) return;
                if (!double.TryParse(el.Element("ForexBuying")?.Value, NumberStyles.Any, CultureInfo.InvariantCulture, out var buy)) return;
                if (!double.TryParse(el.Element("ForexSelling")?.Value, NumberStyles.Any, CultureInfo.InvariantCulture, out var sell)) sell = buy;
                items.Add(new MarketItemDto(key, name, sym, Math.Round(buy, 2), Math.Round(sell, 2), 0));
            }

            AddFx("USD", "usd", "ABD Doları", "$");
            AddFx("EUR", "eur", "Euro", "€");

            if (items.Count == 0) return null;
            return new MarketQuoteDto(true, xml.Root?.Attribute("Tarih")?.Value, "TCMB", items);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "TCMB kurları okunamadı.");
            return null;
        }
    }

    private static double ReadNum(JsonElement obj, params string[] props)
    {
        foreach (var prop in props)
        {
            if (!obj.TryGetProperty(prop, out var v)) continue;
            if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
            if (v.ValueKind == JsonValueKind.String)
            {
                var s = (v.GetString() ?? "").Replace("%", "").Replace("₺", "").Replace("$", "").Replace("€", "").Trim();
                if (s.Contains(',') && s.Contains('.')) s = s.Replace(".", "").Replace(",", ".");
                else if (s.Contains(',')) s = s.Replace(",", ".");
                if (double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var d)) return d;
            }
        }
        return 0;
    }
}
