using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace FurpaOnline.Services;

/// <summary>
/// Tek veritabanı okuyucusu. Ekranı kaç kişi izlerse izlesin MSSQL'e sadece bu servis gider.
///  - Her LivePollSeconds: id > son_id ile yeni satışlar (clustered indeks, çok ucuz)
///  - Her ReconcileSeconds: günün tam özeti (güncellenen/geç gelen kayıtlar düzelir)
///  - Günde bir: son N haftanın aynı günü → gün sonu tahmin eğrisi
/// </summary>
public sealed class LivePoller(
    ShopigoRepository shop, FurpaRepository furpa, LiveState state, SseHub hub,
    RegionCatalog regions, IOptionsMonitor<FurpaOptions> options, ILogger<LivePoller> log) : BackgroundService
{
    private DateTime _catalogAt = DateTime.MinValue, _registersAt = DateTime.MinValue, _reconcileAt = DateTime.MinValue;
    private DateTime _forecastDay = DateTime.MinValue;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var o = options.CurrentValue;
            var now = DateTime.Now;
            var today = now.Date;
            List<RecentDto>? fresh = null;
            bool shopOk = true;

            regions.ReloadIfChanged();

            if (now - _catalogAt > TimeSpan.FromMinutes(o.CatalogMinutes))
                shopOk &= await Step("Katalog", async () =>
                {
                    await regions.ReloadFromDatabaseAsync(ct);
                    state.SetCatalog(await shop.GetBranchesAsync(ct), await shop.GetPaymentMethodsAsync(ct));
                    _catalogAt = now;
                });

            if (now - _registersAt > TimeSpan.FromMinutes(o.RegisterMinutes))
            {
                bool ok = await Step("Kasa tanımları", async () =>
                {
                    state.SetRegisterMeta(await furpa.GetRegistersAsync(ct));
                    _registersAt = now;
                });
                state.SetWarning(ok ? null : "Furpa sunucusundan kasa tanımları okunamadı.");
                if (!ok) _registersAt = now.AddMinutes(-o.RegisterMinutes + 1); // 1 dk sonra tekrar dene
            }

            if (_forecastDay != today)
                shopOk &= await Step("Tahmin", async () =>
                {
                    var past = new List<double[]>();
                    for (int k = 1; k <= Math.Max(1, o.ForecastWeeks); k++)
                        past.Add(await shop.GetDaySlotTotalsAsync(today.AddDays(-7 * k), ct));
                    var yesterday = await shop.GetDaySlotTotalsAsync(today.AddDays(-1), ct);
                    state.SetForecast(past, yesterday);
                    _forecastDay = today;
                });

            if (state.Day != today || now - _reconcileAt > TimeSpan.FromSeconds(o.ReconcileSeconds))
                shopOk &= await Step("Mutabakat", async () =>
                {
                    fresh = state.ReplaceDay(today, await shop.GetDayAggregateAsync(today, ct));
                    _reconcileAt = now;
                });
            else
                shopOk &= await Step("Canlı", async () => fresh = await PollNewAsync(today, ct));

            if (shopOk) state.MarkOk();

            var json = state.Build(DateTime.Now);
            if (fresh is { Count: > 0 }) hub.Broadcast("sales", JsonSerializer.Serialize(fresh, LiveState.Json));
            hub.Broadcast("snapshot", json);

            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(3, o.LivePollSeconds)), ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task<List<RecentDto>> PollNewAsync(DateTime today, CancellationToken ct)
    {
        const int take = 2000;
        var fresh = new List<RecentDto>();
        for (int guard = 0; guard < 10; guard++)
        {
            var rows = await shop.GetNewSalesAsync(state.LastId, take, ct);
            if (rows.Count == 0) break;

            var uuids = rows.Where(r => r.Status == "4" && r.ReceivedAt >= today && !r.Deleted && !r.Refund)
                            .Select(r => r.Uuid).Distinct().ToList();
            var pays = new Dictionary<string, List<(int, double)>>(StringComparer.OrdinalIgnoreCase);
            foreach (var chunk in uuids.Chunk(400))
                foreach (var kv in await shop.GetPaymentsAsync(chunk, ct)) pays[kv.Key] = kv.Value;

            // Sync Panel received_sales satırını payments'tan birkaç ms önce yazmışsa kısa bekleyip tekrar dene
            var missing = uuids.Where(u => !pays.ContainsKey(u)).ToList();
            if (missing.Count > 0)
            {
                await Task.Delay(400, ct);
                foreach (var chunk in missing.Chunk(400))
                    foreach (var kv in await shop.GetPaymentsAsync(chunk, ct)) pays[kv.Key] = kv.Value;
            }

            fresh.AddRange(state.ApplyNewSales(today, rows, pays));
            if (rows.Count < take) break;
        }
        return fresh;
    }

    private async Task<bool> Step(string name, Func<Task> action)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            await action();
            if (sw.ElapsedMilliseconds > 3000) log.LogInformation("{Step} {Ms} ms sürdü", name, sw.ElapsedMilliseconds);
            return true;
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogWarning(ex, "{Step} adımı başarısız", name);
            if (name != "Kasa tanımları") state.MarkError($"{name}: {ex.Message}");
            return false;
        }
    }
}

