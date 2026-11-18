using System.Collections.Concurrent;
using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;

namespace FurpaOnline.Services;

/// <summary>
/// Toplu Satışlar (varsayılan 10.000 TL ve üzeri başarılı fişler):
///  - Tarih aralığında bölge, şube ve fiş bazlı özet
///  - Fişe tıklandığında kalem (sale_items) ve ödeme/POS (payments + kredikart_datas) detayı
/// Sadece READ UNCOMMITTED / WITH (NOLOCK) SELECT sorguları çalıştırır.
/// </summary>
public sealed class BulkSalesService(
    ShopigoRepository shop, RegionCatalog regions,
    IOptionsMonitor<FurpaOptions> options, ILogger<BulkSalesService> log)
{
    private readonly SemaphoreSlim _gate = new(2, 2);
    private readonly SemaphoreSlim _metaGate = new(1, 1);
    private readonly ConcurrentDictionary<string, (DateTime At, string Json)> _listCache = new();
    private readonly ConcurrentDictionary<string, (DateTime At, string Json)> _detailCache = new();

    private (DateTime At, Dictionary<string, string> Branches, Dictionary<int, PayMeta> Pay, Dictionary<string, string> Employees)? _meta;

    private async Task<SqlConnection> OpenAsync(CancellationToken ct)
    {
        var cs = options.CurrentValue.ShopigoConnection;
        var c = new SqlConnection(cs);
        await c.OpenAsync(ct);
        return c;
    }

    public async Task<string> GetListJsonAsync(DateTime from, DateTime to, double minAmount, CancellationToken ct)
    {
        var today = DateTime.Now.Date;
        string key = $"{from:yyyyMMdd}-{to:yyyyMMdd}-{Math.Round(minAmount)}";
        var ttl = to >= today ? TimeSpan.FromSeconds(15) : TimeSpan.FromMinutes(20);
        if (_listCache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.At < ttl) return hit.Json;

        await _gate.WaitAsync(ct);
        try
        {
            if (_listCache.TryGetValue(key, out hit) && DateTime.UtcNow - hit.At < ttl) return hit.Json;

            var meta = await GetMetaAsync(ct);
            var excluded = regions.GetExcludedMarkets();

            const string sql = @"
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
DECLARE @start int, @end int;
SELECT @start = MIN(id), @end = MAX(id) FROM received_sales WITH (NOLOCK) WHERE received_at >= @day AND received_at < @next;

SELECT ISNULL(SUM(r.total_price), 0), COUNT(*)
FROM received_sales r WITH (NOLOCK)
WHERE r.id BETWEEN @start AND @end
  AND r.received_at >= @day AND r.received_at < @next
  AND r.deleted_at IS NULL AND ISNULL(r.is_refund, 0) = 0 AND r.status = '4';

SELECT TOP 2000
    r.id, r.uuid, r.market_id, r.kasano, r.receipt_number, r.InvoiceNo, r.resmi_belge,
    r.initiated_by, r.customer, r.carikod,
    ISNULL(r.original_price, r.total_price), ISNULL(r.discount, 0) + ISNULL(r.item_discounts_total, 0),
    r.total_price, r.created_at
FROM received_sales r WITH (NOLOCK)
WHERE r.id BETWEEN @start AND @end
  AND r.received_at >= @day AND r.received_at < @next
  AND r.deleted_at IS NULL AND ISNULL(r.is_refund, 0) = 0 AND r.status = '4'
  AND r.total_price >= @min
ORDER BY r.total_price DESC, r.id DESC;";

            double overallCiro = 0;
            int overallFis = 0;
            var rawSales = new List<(long Id, string Uuid, string Market, string? Kasa, string? ReceiptNo, string? InvoiceNo, string? DocType, string? By, string? Customer, string? CariKod, double Orig, double Disc, double Total, DateTime At)>();

            await using (var c = await OpenAsync(ct))
            {
                await using (var cmd = new SqlCommand(sql, c) { CommandTimeout = 180 })
                {
                    cmd.Parameters.Add("@day", SqlDbType.DateTime2).Value = from.Date;
                    cmd.Parameters.Add("@next", SqlDbType.DateTime2).Value = to.Date.AddDays(1);
                    cmd.Parameters.Add("@min", SqlDbType.Float).Value = minAmount;

                    await using var r = await cmd.ExecuteReaderAsync(ct);
                    if (await r.ReadAsync(ct))
                    {
                        overallCiro = r.IsDBNull(0) ? 0 : r.GetDouble(0);
                        overallFis = r.IsDBNull(1) ? 0 : r.GetInt32(1);
                    }
                    await r.NextResultAsync(ct);
                    while (await r.ReadAsync(ct))
                    {
                        var market = r.GetString(2).Trim();
                        if (excluded.Contains(market)) continue;
                        rawSales.Add((
                            Convert.ToInt64(r.GetValue(0)),
                            r.GetString(1),
                            market,
                            r.IsDBNull(3) ? null : r.GetString(3).Trim(),
                            r.IsDBNull(4) ? null : r.GetString(4).Trim(),
                            r.IsDBNull(5) ? null : r.GetString(5).Trim(),
                            r.IsDBNull(6) ? null : r.GetString(6).Trim(),
                            r.IsDBNull(7) ? null : r.GetString(7).Trim(),
                            r.IsDBNull(8) ? null : r.GetString(8).Trim(),
                            r.IsDBNull(9) ? null : r.GetString(9).Trim(),
                            r.IsDBNull(10) ? 0 : r.GetDouble(10),
                            r.IsDBNull(11) ? 0 : r.GetDouble(11),
                            r.GetDouble(12),
                            r.GetDateTime(13)
                        ));
                    }
                }

                // Kalem sayıları ve ana ödeme tipleri (400'erli paketlerle indeksli okuma)
                var itemCounts = new Dictionary<string, (int Lines, double Qty)>(StringComparer.OrdinalIgnoreCase);
                var payMap = new Dictionary<string, List<(int Code, double Amt)>>(StringComparer.OrdinalIgnoreCase);

                foreach (var chunk in rawSales.Select(s => s.Uuid).Distinct().Chunk(350))
                {
                    string joined = string.Join(',', chunk);
                    const string subSql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT sale_uuid, COUNT(*), SUM(CAST(ISNULL(quantity, 0) AS float))
FROM sale_items WITH (NOLOCK)
WHERE sale_uuid IN (SELECT value FROM STRING_SPLIT(@u, ',')) AND deleted_at IS NULL
GROUP BY sale_uuid;

SELECT sale_uuid, payment_method, amount
FROM payments WITH (NOLOCK)
WHERE sale_uuid IN (SELECT value FROM STRING_SPLIT(@u, ',')) AND deleted_at IS NULL;";

                    await using var sub = new SqlCommand(subSql, c) { CommandTimeout = 60 };
                    sub.Parameters.Add("@u", SqlDbType.NVarChar, -1).Value = joined;
                    await using var sr = await sub.ExecuteReaderAsync(ct);
                    while (await sr.ReadAsync(ct))
                        itemCounts[sr.GetString(0)] = (sr.GetInt32(1), sr.IsDBNull(2) ? 0 : sr.GetDouble(2));
                    await sr.NextResultAsync(ct);
                    while (await sr.ReadAsync(ct))
                    {
                        var u = sr.GetString(0);
                        if (!payMap.TryGetValue(u, out var pl)) payMap[u] = pl = [];
                        pl.Add((ParseCode(sr.IsDBNull(1) ? null : sr.GetString(1)), sr.IsDBNull(2) ? 0 : sr.GetDouble(2)));
                    }
                }

                // Müşteri / Cari ünvanları (varsa VKN veya cari_kod üzerinden)
                var custCodes = rawSales.SelectMany(s => new[] { s.Customer, s.CariKod })
                    .Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!).Distinct().ToList();
                var custNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                if (custCodes.Count > 0)
                {
                    foreach (var chunk in custCodes.Chunk(300))
                    {
                        const string cSql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT tax_no, name FROM customers WITH (NOLOCK) WHERE tax_no IN (SELECT value FROM STRING_SPLIT(@c, ',')) AND deleted_at IS NULL;
SELECT cari_kod, unvan, vergi_tc_no FROM cari WITH (NOLOCK) WHERE cari_kod IN (SELECT value FROM STRING_SPLIT(@c, ',')) OR vergi_tc_no IN (SELECT value FROM STRING_SPLIT(@c, ','));";
                        await using var cc = new SqlCommand(cSql, c) { CommandTimeout = 30 };
                        cc.Parameters.Add("@c", SqlDbType.NVarChar, -1).Value = string.Join(',', chunk);
                        await using var cr = await cc.ExecuteReaderAsync(ct);
                        while (await cr.ReadAsync(ct))
                            if (!cr.IsDBNull(0) && !cr.IsDBNull(1)) custNames[cr.GetString(0).Trim()] = cr.GetString(1).Trim();
                        await cr.NextResultAsync(ct);
                        while (await cr.ReadAsync(ct))
                        {
                            var unvan = cr.IsDBNull(1) ? "" : cr.GetString(1).Trim();
                            if (string.IsNullOrEmpty(unvan)) continue;
                            if (!cr.IsDBNull(0)) custNames[cr.GetString(0).Trim()] = unvan;
                            if (!cr.IsDBNull(2)) custNames[cr.GetString(2).Trim()] = unvan;
                        }
                    }
                }

                // Bölgeler ve mağazalar
                var regionDefs = regions.Regions.DistinctBy(x => x.Id).ToList();
                var allStoreIds = new HashSet<string>(meta.Branches.Keys.Where(k => !excluded.Contains(k)));
                foreach (var s in rawSales) allStoreIds.Add(s.Market);
                if (allStoreIds.Any(id => regions.RegionOf(id) == RegionCatalog.OtherId) && !regionDefs.Any(r => r.Id == RegionCatalog.OtherId))
                    regionDefs.Add(RegionCatalog.Other);

                var payGroupTotals = new Dictionary<string, (string Name, double Amount, int Count)>();

                var saleDtos = rawSales.Select(s =>
                {
                    var reg = regions.RegionOf(s.Market);
                    var storeName = StoreName(meta.Branches, s.Market);
                    itemCounts.TryGetValue(s.Uuid, out var ic);

                    string mKey = "diger", mName = "Diğer";
                    if (payMap.TryGetValue(s.Uuid, out var plist) && plist.Count > 0)
                    {
                        var top = plist.OrderByDescending(x => x.Amt).First();
                        var grp = GroupOf(meta.Pay, top.Code);
                        mKey = grp.Key;
                        mName = plist.Count > 1 ? $"{ItemName(meta.Pay, top.Code)} (+{plist.Count - 1})" : ItemName(meta.Pay, top.Code);
                        foreach (var (code, amt) in plist)
                        {
                            var g = GroupOf(meta.Pay, code);
                            payGroupTotals.TryGetValue(g.Key, out var cur);
                            payGroupTotals[g.Key] = (g.Name, cur.Amount + amt, cur.Count + 1);
                        }
                    }

                    string? cashier = null;
                    if (!string.IsNullOrWhiteSpace(s.By))
                        cashier = meta.Employees.TryGetValue(s.By, out var empName) ? $"{empName} ({s.By})" : s.By;

                    string? custLabel = null;
                    var rawCust = !string.IsNullOrWhiteSpace(s.Customer) ? s.Customer : s.CariKod;
                    if (!string.IsNullOrWhiteSpace(rawCust))
                        custLabel = custNames.TryGetValue(rawCust, out var cn) && !string.IsNullOrWhiteSpace(cn) ? $"{cn} ({rawCust})" : rawCust;

                    return new
                    {
                        id = s.Id,
                        uuid = s.Uuid,
                        at = Iso(s.At),
                        market = s.Market,
                        store = storeName,
                        region = reg,
                        kasa = s.Kasa,
                        receiptNo = s.ReceiptNo,
                        invoiceNo = s.InvoiceNo,
                        cashier,
                        customer = custLabel,
                        itemCount = ic.Lines,
                        totalQty = R(ic.Qty),
                        originalAmount = R(s.Orig),
                        discount = R(s.Disc),
                        amount = R(s.Total),
                        methodKey = mKey,
                        methodName = mName
                    };
                }).ToList();

                var storeDtos = allStoreIds.Select(id =>
                {
                    var list = saleDtos.Where(x => x.market == id).ToList();
                    return new
                    {
                        id,
                        name = StoreName(meta.Branches, id),
                        region = regions.RegionOf(id),
                        count = list.Count,
                        amount = R(list.Sum(x => x.amount)),
                        maxAmount = list.Count > 0 ? R(list.Max(x => x.amount)) : 0,
                        itemCount = list.Sum(x => x.itemCount)
                    };
                }).Where(s => s.count > 0).OrderByDescending(s => s.amount).ToList();

                var regionDtos = regionDefs.Select(r =>
                {
                    var rStoresTotal = allStoreIds.Count(id => regions.RegionOf(id) == r.Id);
                    var list = saleDtos.Where(x => x.region == r.Id).ToList();
                    var activeSt = list.Select(x => x.market).Distinct().Count();
                    return new
                    {
                        id = r.Id,
                        name = r.Name,
                        color = r.Color,
                        totalStores = rStoresTotal,
                        activeStores = activeSt,
                        count = list.Count,
                        amount = R(list.Sum(x => x.amount)),
                        maxAmount = list.Count > 0 ? R(list.Max(x => x.amount)) : 0
                    };
                }).Where(r => r.totalStores > 0 || r.count > 0).OrderByDescending(r => r.amount).ToList();

                var payDtos = payGroupTotals
                    .OrderByDescending(kv => kv.Value.Amount)
                    .Select(kv => new { key = kv.Key, name = kv.Value.Name, amount = R(kv.Value.Amount), count = kv.Value.Count })
                    .ToList();

                var payload = new
                {
                    from = from.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    to = to.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    minAmount,
                    overallCiro = R(overallCiro),
                    overallFis,
                    totalAmount = R(saleDtos.Sum(x => x.amount)),
                    totalCount = saleDtos.Count,
                    payments = payDtos,
                    regions = regionDtos,
                    stores = storeDtos,
                    sales = saleDtos
                };

                var json = JsonSerializer.Serialize(payload, LiveState.Json);
                _listCache[key] = (DateTime.UtcNow, json);
                if (_listCache.Count > 32)
                    foreach (var old in _listCache.OrderBy(kv => kv.Value.At).Take(_listCache.Count - 20).Select(kv => kv.Key).ToList())
                        _listCache.TryRemove(old, out _);
                return json;
            }
        }
        finally { _gate.Release(); }
    }

    public async Task<string?> GetDetailJsonAsync(string uuid, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(uuid)) return null;
        uuid = uuid.Trim();
        if (_detailCache.TryGetValue(uuid, out var hit) && DateTime.UtcNow - hit.At < TimeSpan.FromMinutes(15))
            return hit.Json;

        var meta = await GetMetaAsync(ct);

        const string sql = @"
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

SELECT TOP 1 r.id, r.uuid, r.market_id, r.kasano, r.receipt_number, r.InvoiceNo, r.resmi_belge,
       r.initiated_by, r.customer, r.carikod,
       ISNULL(r.original_price, r.total_price), ISNULL(r.discount, 0), ISNULL(r.item_discounts_total, 0),
       r.total_price, r.created_at, r.received_at
FROM received_sales r WITH (NOLOCK)
WHERE r.uuid = @u;

SELECT inventory_code, inventory_name, bar_kodu, CAST(ISNULL(quantity, 0) AS float), ISNULL(weight, 0),
       ISNULL(unit, weight_unit), ISNULL(unit_price, 0), ISNULL(total_price, 0),
       ISNULL(discount, 0) + ISNULL(discount2, 0), ISNULL(perakende_vergi_orani, 0)
FROM sale_items WITH (NOLOCK)
WHERE sale_uuid = @u AND deleted_at IS NULL
ORDER BY id;

SELECT id, payment_method, ISNULL(amount, 0), cek_no, created_at
FROM payments WITH (NOLOCK)
WHERE sale_uuid = @u AND deleted_at IS NULL
ORDER BY id;

SELECT payment_id, ISNULL(payment_amount, 0), card_no, acquirer_name, authorization_code, batch_no, transaction_no
FROM kredikart_datas WITH (NOLOCK)
WHERE sale_uuid = @u
ORDER BY id;";

        await using var c = await OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, c) { CommandTimeout = 45 };
        cmd.Parameters.Add("@u", SqlDbType.NVarChar, 80).Value = uuid;
        await using var r = await cmd.ExecuteReaderAsync(ct);

        if (!await r.ReadAsync(ct)) return null;

        long id = Convert.ToInt64(r.GetValue(0));
        string market = r.GetString(2).Trim();
        string? kasa = r.IsDBNull(3) ? null : r.GetString(3).Trim();
        string? receiptNo = r.IsDBNull(4) ? null : r.GetString(4).Trim();
        string? invoiceNo = r.IsDBNull(5) ? null : r.GetString(5).Trim();
        string? docType = r.IsDBNull(6) ? null : r.GetString(6).Trim();
        string? by = r.IsDBNull(7) ? null : r.GetString(7).Trim();
        string? customer = r.IsDBNull(8) ? null : r.GetString(8).Trim();
        string? cariKod = r.IsDBNull(9) ? null : r.GetString(9).Trim();
        double orig = r.GetDouble(10);
        double disc = r.GetDouble(11);
        double itemDisc = r.GetDouble(12);
        double total = r.GetDouble(13);
        DateTime createdAt = r.GetDateTime(14);
        DateTime receivedAt = r.GetDateTime(15);

        await r.NextResultAsync(ct);
        var items = new List<object>();
        while (await r.ReadAsync(ct))
        {
            double q = r.GetDouble(3);
            double w = r.GetDouble(4);
            string unit = (r.IsDBNull(5) ? "" : r.GetString(5).Trim());
            if (string.IsNullOrEmpty(unit)) unit = w > 0 && q <= 0 ? "KG" : "ADET";
            double up = r.GetDouble(6);
            double tot = r.GetDouble(7);
            double effQty = q > 0 ? q : (w > 0 ? w : 1);
            if (q == 1 && w > 0 && up > 0 && Math.Abs(w * up - tot) + 0.05 < Math.Abs(q * up - tot)) effQty = w;

            items.Add(new
            {
                code = r.IsDBNull(0) ? "" : r.GetString(0).Trim(),
                name = r.IsDBNull(1) ? "Ürün" : r.GetString(1).Trim(),
                barcode = r.IsDBNull(2) ? "" : r.GetString(2).Trim(),
                qty = Math.Round(effQty, 3),
                unit,
                unitPrice = R(up),
                total = R(tot),
                discount = R(r.GetDouble(8)),
                vat = r.GetInt32(9)
            });
        }

        await r.NextResultAsync(ct);
        var rawPays = new List<(int Id, int Code, double Amount, string? CheckNo, DateTime? At)>();
        while (await r.ReadAsync(ct))
        {
            rawPays.Add((
                r.GetInt32(0),
                ParseCode(r.IsDBNull(1) ? null : r.GetString(1)),
                r.GetDouble(2),
                r.IsDBNull(3) ? null : r.GetString(3).Trim(),
                r.IsDBNull(4) ? null : r.GetDateTime(4)
            ));
        }

        await r.NextResultAsync(ct);
        var kkList = new List<(int? PayId, double Amt, string? Card, string? Acq, string? Auth, string? Batch, string? Tx)>();
        while (await r.ReadAsync(ct))
        {
            kkList.Add((
                r.IsDBNull(0) ? null : r.GetInt32(0),
                r.GetDouble(1),
                r.IsDBNull(2) ? null : r.GetString(2).Trim(),
                r.IsDBNull(3) ? null : r.GetString(3).Trim(),
                r.IsDBNull(4) ? null : r.GetString(4).Trim(),
                r.IsDBNull(5) ? null : r.GetString(5).Trim(),
                r.IsDBNull(6) ? null : r.GetString(6).Trim()
            ));
        }
        await r.CloseAsync();

        var usedKk = new HashSet<int>();
        var payments = rawPays.Select(p =>
        {
            var grp = GroupOf(meta.Pay, p.Code);
            int idx = -1;
            for (int i = 0; i < kkList.Count; i++)
            {
                if (usedKk.Contains(i)) continue;
                if ((kkList[i].PayId.HasValue && kkList[i].PayId!.Value == p.Id) || Math.Abs(kkList[i].Amt - p.Amount) < 0.05) { idx = i; break; }
            }
            (int? PayId, double Amt, string? Card, string? Acq, string? Auth, string? Batch, string? Tx) kk = default;
            if (idx >= 0) { usedKk.Add(idx); kk = kkList[idx]; }

            return new
            {
                groupKey = grp.Key,
                groupName = grp.Name,
                methodName = ItemName(meta.Pay, p.Code),
                amount = R(p.Amount),
                checkNo = string.IsNullOrWhiteSpace(p.CheckNo) ? null : p.CheckNo,
                cardNo = string.IsNullOrWhiteSpace(kk.Card) ? null : kk.Card,
                acquirer = string.IsNullOrWhiteSpace(kk.Acq) ? null : kk.Acq,
                authCode = string.IsNullOrWhiteSpace(kk.Auth) ? null : kk.Auth,
                batchNo = string.IsNullOrWhiteSpace(kk.Batch) ? null : kk.Batch
            };
        }).ToList();

        string? cashier = null;
        if (!string.IsNullOrWhiteSpace(by))
            cashier = meta.Employees.TryGetValue(by, out var en) ? $"{en} ({by})" : by;

        string? custTitle = null;
        var lookupCust = !string.IsNullOrWhiteSpace(customer) ? customer : cariKod;
        if (!string.IsNullOrWhiteSpace(lookupCust))
        {
            try
            {
                await using var cc1 = new SqlCommand(
                    "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SELECT TOP 1 name FROM customers WITH (NOLOCK) WHERE tax_no = @k AND deleted_at IS NULL;", c) { CommandTimeout = 10 };
                cc1.Parameters.Add("@k", SqlDbType.NVarChar, 64).Value = lookupCust;
                var nm = await cc1.ExecuteScalarAsync(ct) as string;
                if (string.IsNullOrWhiteSpace(nm))
                {
                    await using var cc2 = new SqlCommand(
                        "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SELECT TOP 1 unvan FROM cari WITH (NOLOCK) WHERE cari_kod = @k OR vergi_tc_no = @k;", c) { CommandTimeout = 10 };
                    cc2.Parameters.Add("@k", SqlDbType.NVarChar, 64).Value = lookupCust;
                    nm = await cc2.ExecuteScalarAsync(ct) as string;
                }
                custTitle = !string.IsNullOrWhiteSpace(nm) ? $"{nm.Trim()} ({lookupCust})" : lookupCust;
            }
            catch
            {
                custTitle = lookupCust;
            }
        }

        var regId = regions.RegionOf(market);
        var regDef = regions.Regions.FirstOrDefault(x => x.Id == regId) ?? RegionCatalog.Other;

        var detail = new
        {
            id,
            uuid,
            at = Iso(createdAt),
            receivedAt = Iso(receivedAt),
            market,
            store = StoreName(meta.Branches, market),
            region = regId,
            regionName = regDef.Name,
            regionColor = regDef.Color,
            kasa,
            receiptNo,
            invoiceNo,
            docType,
            cashier,
            customer = custTitle,
            cariKod,
            originalAmount = R(orig),
            discount = R(disc),
            itemDiscount = R(itemDisc),
            amount = R(total),
            payments,
            items
        };

        var json = JsonSerializer.Serialize(detail, LiveState.Json);
        _detailCache[uuid] = (DateTime.UtcNow, json);
        if (_detailCache.Count > 200)
            foreach (var old in _detailCache.OrderBy(kv => kv.Value.At).Take(60).Select(kv => kv.Key).ToList())
                _detailCache.TryRemove(old, out _);
        return json;
    }

    private async Task<(Dictionary<string, string> Branches, Dictionary<int, PayMeta> Pay, Dictionary<string, string> Employees)> GetMetaAsync(CancellationToken ct)
    {
        await _metaGate.WaitAsync(ct);
        try
        {
            if (_meta is { } m && DateTime.UtcNow - m.At < TimeSpan.FromMinutes(10))
                return (m.Branches, m.Pay, m.Employees);

            var bList = await shop.GetBranchesAsync(ct);
            var pList = await shop.GetPaymentMethodsAsync(ct);
            var branches = bList.GroupBy(b => b.MarketId).ToDictionary(g => g.Key, g => g.First().Name, StringComparer.OrdinalIgnoreCase);
            var pay = pList.GroupBy(p => p.Mediator).ToDictionary(g => g.Key, g => g.First());

            var emps = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                await using var c = await OpenAsync(ct);
                await using var cmd = new SqlCommand("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SELECT code, ISNULL(name,''), ISNULL(surname,'') FROM employees WITH (NOLOCK) WHERE deleted_at IS NULL AND code IS NOT NULL", c) { CommandTimeout = 20 };
                await using var r = await cmd.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct))
                {
                    var code = r.GetString(0).Trim();
                    var full = $"{r.GetString(1).Trim()} {r.GetString(2).Trim()}".Trim();
                    if (!string.IsNullOrEmpty(code) && !string.IsNullOrEmpty(full)) emps[code] = full;
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Kasiyer tanımları okunamadı");
            }

            _meta = (DateTime.UtcNow, branches, pay, emps);
            return (branches, pay, emps);
        }
        finally { _metaGate.Release(); }
    }

    private static (string Key, string Name) GroupOf(Dictionary<int, PayMeta> pay, int code)
    {
        if (code == 0) return ("furpa", "Furpa Kart");
        if (!pay.TryGetValue(code, out var m)) return ("diger", "Diğer");
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

    private static string ItemName(Dictionary<int, PayMeta> pay, int code)
    {
        if (code == 0) return "Furpa Kart";
        if (code == 14) return "Online Sipariş";
        return pay.TryGetValue(code, out var m) ? m.Name : $"Kod {code}";
    }

    private static string StoreName(Dictionary<string, string> branches, string id)
        => branches.TryGetValue(id, out var n) && !string.IsNullOrWhiteSpace(n) ? n : $"Mağaza {id}";

    private static int ParseCode(string? s) => int.TryParse(s?.Trim(), out var v) ? v : -1;
    private static double R(double v) => Math.Round(v, 2);
    private static string Iso(DateTime d) => d.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);
}
