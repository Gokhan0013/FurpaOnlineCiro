using System.Collections.Concurrent;
using Microsoft.Extensions.Options;

namespace FurpaOnline.Services;

/// <summary>
/// Geçmiş tarih / tarih aralığı görünümü. Canlı durumdan bağımsız, geçici bir LiveState ile
/// aynı JSON şeklini üretir (ekran tüm sayfalarda aynı kodla çizer). Sadece SELECT atar.
/// Aynı anda en fazla 2 ağır sorgu çalışır; sonuçlar bellekte önbelleğe alınır.
/// </summary>
public sealed class HistoryService(
    ShopigoRepository shop, FurpaRepository furpa, RegionCatalog regions,
    IOptionsMonitor<FurpaOptions> options, ILogger<HistoryService> log)
{
    private readonly SemaphoreSlim _gate = new(2, 2);
    private readonly SemaphoreSlim _metaGate = new(1, 1);
    private readonly ConcurrentDictionary<string, (DateTime At, string Json)> _cache = new();

    private (DateTime At, List<BranchRow> Branches, List<PayMeta> Pay)? _catalog;
    private (DateTime At, List<RegisterMeta> List)? _registers;

    public async Task<string> GetAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        var today = DateTime.Now.Date;
        string key = $"{from:yyyyMMdd}-{to:yyyyMMdd}";
        // Bugünü içeren aralıklar kısa, tamamen geçmiş aralıklar uzun süre önbellekte kalır
        var ttl = to >= today ? TimeSpan.FromSeconds(45) : TimeSpan.FromMinutes(30);
        if (_cache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.At < ttl) return hit.Json;

        await _gate.WaitAsync(ct);
        try
        {
            if (_cache.TryGetValue(key, out hit) && DateTime.UtcNow - hit.At < ttl) return hit.Json;

            var (branches, pay) = await GetCatalogAsync(ct);
            var metas = await GetRegisterMetaAsync(ct);

            var sw = System.Diagnostics.Stopwatch.StartNew();
            var agg = await shop.GetRangeAggregateAsync(from, to.AddDays(1), ct);

            var state = new LiveState(regions, options);
            state.SetCatalog(branches, pay);
            state.SetRegisterMeta(metas);
            state.ReplaceDay(from, agg);
            state.MarkOk();
            var json = state.Build(DateTime.Now);

            log.LogInformation("Geçmiş {From:yyyy-MM-dd} → {To:yyyy-MM-dd} {Ms} ms sürdü", from, to, sw.ElapsedMilliseconds);

            _cache[key] = (DateTime.UtcNow, json);
            if (_cache.Count > 48)
                foreach (var old in _cache.OrderBy(kv => kv.Value.At).Take(_cache.Count - 32).Select(kv => kv.Key).ToList())
                    _cache.TryRemove(old, out _);
            return json;
        }
        finally { _gate.Release(); }
    }

    private async Task<(List<BranchRow>, List<PayMeta>)> GetCatalogAsync(CancellationToken ct)
    {
        await _metaGate.WaitAsync(ct);
        try
        {
            if (_catalog is { } c && DateTime.UtcNow - c.At < TimeSpan.FromMinutes(10)) return (c.Branches, c.Pay);
            var b = await shop.GetBranchesAsync(ct);
            var p = await shop.GetPaymentMethodsAsync(ct);
            _catalog = (DateTime.UtcNow, b, p);
            return (b, p);
        }
        finally { _metaGate.Release(); }
    }

    private async Task<List<RegisterMeta>> GetRegisterMetaAsync(CancellationToken ct)
    {
        await _metaGate.WaitAsync(ct);
        try
        {
            if (_registers is { } r && DateTime.UtcNow - r.At < TimeSpan.FromMinutes(5)) return r.List;
            try
            {
                var list = await furpa.GetRegistersAsync(ct);
                _registers = (DateTime.UtcNow, list);
                return list;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Geçmiş görünümü için kasa tanımları okunamadı");
                return _registers?.List ?? new List<RegisterMeta>();
            }
        }
        finally { _metaGate.Release(); }
    }
}

