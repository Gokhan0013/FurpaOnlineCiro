using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;

namespace FurpaOnline.Services;

/// <summary>
/// Merkez SHOPIGO MSSQL okuyucusu. Sadece SELECT atar.
/// Tablo/kolon kuralları Furpa Kasa Sync Panel'in MssqlOutboundWriter'ı ile birebir aynıdır:
///  - received_sales.status: 1 devam eden, 2 beklemede, 3 iptal, 4 başarılı (ciro = 4)
///  - payments.payment_method = payment_methods.pavo_mediator
/// Performans: bugünün satırları received_at indeksiyle bulunan MIN(id)'den itibaren
/// clustered (id) aralığı olarak taranır; böylece key lookup yapılmaz.
/// </summary>
public sealed class ShopigoRepository(IOptionsMonitor<FurpaOptions> options)
{
    private const string SaleFilter =
        "r.received_at >= @day AND r.received_at < @next AND r.deleted_at IS NULL AND ISNULL(r.is_refund, 0) = 0";

    private const string SlotExpr =
        "CASE WHEN r.created_at < @day THEN 0 ELSE DATEDIFF(minute, @day, r.created_at) / 15 END";

    private async Task<SqlConnection> OpenAsync(CancellationToken ct)
    {
        var cs = options.CurrentValue.ShopigoConnection;
        if (string.IsNullOrWhiteSpace(cs) || cs.Contains("SUNUCU"))
            throw new InvalidOperationException("SHOPIGO bağlantı bilgisi tanımlı değil (appsettings.Local.json).");
        var c = new SqlConnection(cs);
        await c.OpenAsync(ct);
        return c;
    }

    private static SqlCommand Cmd(SqlConnection c, string sql, int timeout = 60)
        => new(sql, c) { CommandTimeout = timeout };

    private static void AddDay(SqlCommand cmd, DateTime day)
    {
        cmd.Parameters.Add("@day", SqlDbType.DateTime2).Value = day.Date;
        cmd.Parameters.Add("@next", SqlDbType.DateTime2).Value = day.Date.AddDays(1);
    }

    public async Task<List<BranchRow>> GetBranchesAsync(CancellationToken ct)
    {
        await using var c = await OpenAsync(ct);
        await using var cmd = Cmd(c, "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SELECT market_id, ISNULL(name,''), ISNULL(city,'') FROM branches WITH (NOLOCK) WHERE deleted_at IS NULL");
        await using var r = await cmd.ExecuteReaderAsync(ct);
        var list = new List<BranchRow>();
        while (await r.ReadAsync(ct))
            list.Add(new BranchRow(r.GetString(0).Trim(), r.GetString(1).Trim(), r.GetString(2).Trim()));
        return list;
    }

    public async Task<List<PayMeta>> GetPaymentMethodsAsync(CancellationToken ct)
    {
        await using var c = await OpenAsync(ct);
        await using var cmd = Cmd(c, "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SELECT pavo_mediator, pavo_type, name, [group] FROM payment_methods WITH (NOLOCK) ORDER BY sirano");
        await using var r = await cmd.ExecuteReaderAsync(ct);
        var list = new List<PayMeta>();
        while (await r.ReadAsync(ct))
            list.Add(new PayMeta(r.GetInt32(0), r.GetInt32(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3)));
        return list;
    }

    /// <summary>Günün tam özeti (mutabakat). Canlı artımlı okumanın kaçırdığı güncellemeleri de düzeltir.</summary>
    public async Task<DayAggregate> GetDayAggregateAsync(DateTime day, CancellationToken ct)
    {
        string sql = $@"
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
DECLARE @max int = (SELECT MAX(id) FROM received_sales WITH (NOLOCK));
DECLARE @start int = (SELECT MIN(id) FROM received_sales WITH (NOLOCK) WHERE received_at >= @day AND received_at < @next);
IF @start IS NULL SET @start = ISNULL(@max, 0) + 1;

SELECT ISNULL(@max, 0);

SELECT r.market_id, ISNULL(r.status, ''), {SlotExpr} AS slot, COUNT(*), SUM(r.total_price), MAX(r.created_at)
FROM received_sales r WITH (NOLOCK)
WHERE r.id BETWEEN @start AND @max AND {SaleFilter}
GROUP BY r.market_id, ISNULL(r.status, ''), {SlotExpr};

SELECT r.market_id, ISNULL(r.kasano, ''), COUNT(*), SUM(r.total_price), MAX(r.created_at)
FROM received_sales r WITH (NOLOCK)
WHERE r.id BETWEEN @start AND @max AND {SaleFilter} AND r.status = '4'
GROUP BY r.market_id, ISNULL(r.kasano, '');

SELECT p.payment_method, COUNT(*), SUM(p.amount)
FROM received_sales r WITH (NOLOCK)
JOIN payments p WITH (NOLOCK) ON p.sale_uuid = r.uuid
WHERE r.id BETWEEN @start AND @max AND {SaleFilter} AND r.status = '4'
GROUP BY p.payment_method;

SELECT TOP 60 r.id, r.market_id, r.kasano, r.total_price, r.created_at, r.receipt_number,
       (SELECT TOP 1 p.payment_method FROM payments p WITH (NOLOCK) WHERE p.sale_uuid = r.uuid AND p.deleted_at IS NULL AND p.payment_method IS NOT NULL ORDER BY p.amount DESC)
FROM received_sales r WITH (NOLOCK)
WHERE r.id BETWEEN @start AND @max AND {SaleFilter} AND r.status = '4'
ORDER BY r.id DESC;";

        await using var c = await OpenAsync(ct);
        await using var cmd = Cmd(c, sql, 120);
        AddDay(cmd, day);
        await using var r = await cmd.ExecuteReaderAsync(ct);

        var agg = new DayAggregate();
        if (await r.ReadAsync(ct)) agg.MaxId = Convert.ToInt64(r.GetValue(0));

        await r.NextResultAsync(ct);
        while (await r.ReadAsync(ct))
            agg.Cells.Add(new AggCell(r.GetString(0).Trim(), r.GetString(1).Trim(), Convert.ToInt32(r.GetValue(2)),
                r.GetInt32(3), r.IsDBNull(4) ? 0 : r.GetDouble(4), r.GetDateTime(5)));

        await r.NextResultAsync(ct);
        while (await r.ReadAsync(ct))
            agg.Registers.Add(new AggRegister(r.GetString(0).Trim(), r.GetString(1).Trim(), r.GetInt32(2),
                r.IsDBNull(3) ? 0 : r.GetDouble(3), r.GetDateTime(4)));

        await r.NextResultAsync(ct);
        while (await r.ReadAsync(ct))
            agg.Payments.Add(new AggPayment(ParseCode(r.IsDBNull(0) ? null : r.GetString(0)), r.GetInt32(1), r.IsDBNull(2) ? 0 : r.GetDouble(2)));

        await r.NextResultAsync(ct);
        while (await r.ReadAsync(ct))
            agg.Recent.Add(new RecentRow(Convert.ToInt64(r.GetValue(0)), r.GetString(1).Trim(), r.IsDBNull(2) ? null : r.GetString(2),
                r.GetDouble(3), r.GetDateTime(4), r.IsDBNull(5) ? null : r.GetString(5),
                r.IsDBNull(6) ? null : ParseCode(r.GetString(6))));

        return agg;
    }

    /// <summary>
    /// Geçmiş tarih aralığı özeti (from dahil, toExclusive hariç). received_at gününe göre; dilim = fişin gün içi saati
    /// (çok günlü aralıkta tüm günlerin aynı saat dilimleri toplanır). Sadece SELECT.
    /// </summary>
    public async Task<DayAggregate> GetRangeAggregateAsync(DateTime from, DateTime toExclusive, CancellationToken ct)
    {
        const string slot = "DATEDIFF(minute, CAST(r.created_at AS date), r.created_at) / 15";
        string sql = $@"
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
DECLARE @start int, @end int;
SELECT @start = MIN(id), @end = MAX(id) FROM received_sales WITH (NOLOCK) WHERE received_at >= @day AND received_at < @next;

SELECT ISNULL(@end, 0);

SELECT r.market_id, ISNULL(r.status, ''), {slot} AS slot, COUNT(*), SUM(r.total_price), MAX(r.created_at)
FROM received_sales r WITH (NOLOCK)
WHERE r.id BETWEEN @start AND @end AND {SaleFilter}
GROUP BY r.market_id, ISNULL(r.status, ''), {slot};

SELECT r.market_id, ISNULL(r.kasano, ''), COUNT(*), SUM(r.total_price), MAX(r.created_at)
FROM received_sales r WITH (NOLOCK)
WHERE r.id BETWEEN @start AND @end AND {SaleFilter} AND r.status = '4'
GROUP BY r.market_id, ISNULL(r.kasano, '');

SELECT p.payment_method, COUNT(*), SUM(p.amount)
FROM received_sales r WITH (NOLOCK)
JOIN payments p WITH (NOLOCK) ON p.sale_uuid = r.uuid
WHERE r.id BETWEEN @start AND @end AND {SaleFilter} AND r.status = '4'
GROUP BY p.payment_method;

SELECT TOP 60 r.id, r.market_id, r.kasano, r.total_price, r.created_at, r.receipt_number,
       (SELECT TOP 1 p.payment_method FROM payments p WITH (NOLOCK) WHERE p.sale_uuid = r.uuid AND p.deleted_at IS NULL AND p.payment_method IS NOT NULL ORDER BY p.amount DESC)
FROM received_sales r WITH (NOLOCK)
WHERE r.id BETWEEN @start AND @end AND {SaleFilter} AND r.status = '4'
ORDER BY r.id DESC;";

        await using var c = await OpenAsync(ct);
        await using var cmd = Cmd(c, sql, 240);
        cmd.Parameters.Add("@day", SqlDbType.DateTime2).Value = from.Date;
        cmd.Parameters.Add("@next", SqlDbType.DateTime2).Value = toExclusive.Date;
        await using var r = await cmd.ExecuteReaderAsync(ct);

        var agg = new DayAggregate();
        if (await r.ReadAsync(ct)) agg.MaxId = Convert.ToInt64(r.GetValue(0));

        await r.NextResultAsync(ct);
        while (await r.ReadAsync(ct))
            agg.Cells.Add(new AggCell(r.GetString(0).Trim(), r.GetString(1).Trim(), Convert.ToInt32(r.GetValue(2)),
                r.GetInt32(3), r.IsDBNull(4) ? 0 : r.GetDouble(4), r.GetDateTime(5)));

        await r.NextResultAsync(ct);
        while (await r.ReadAsync(ct))
            agg.Registers.Add(new AggRegister(r.GetString(0).Trim(), r.GetString(1).Trim(), r.GetInt32(2),
                r.IsDBNull(3) ? 0 : r.GetDouble(3), r.GetDateTime(4)));

        await r.NextResultAsync(ct);
        while (await r.ReadAsync(ct))
            agg.Payments.Add(new AggPayment(ParseCode(r.IsDBNull(0) ? null : r.GetString(0)), r.GetInt32(1), r.IsDBNull(2) ? 0 : r.GetDouble(2)));

        await r.NextResultAsync(ct);
        while (await r.ReadAsync(ct))
            agg.Recent.Add(new RecentRow(Convert.ToInt64(r.GetValue(0)), r.GetString(1).Trim(), r.IsDBNull(2) ? null : r.GetString(2),
                r.GetDouble(3), r.GetDateTime(4), r.IsDBNull(5) ? null : r.GetString(5),
                r.IsDBNull(6) ? null : ParseCode(r.GetString(6))));

        return agg;
    }

    /// <summary>Tarih aralığında gün × şube kırılımı (received_at gününe göre, sadece başarılı satışlar). Rapor sayfası için.</summary>
    public async Task<List<DailyRow>> GetDailyAsync(DateTime from, DateTime toExclusive, CancellationToken ct)
    {
        string sql = $@"
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
DECLARE @start int, @end int;
SELECT @start = MIN(id), @end = MAX(id) FROM received_sales WITH (NOLOCK) WHERE received_at >= @day AND received_at < @next;

SELECT CAST(r.received_at AS date), r.market_id, COUNT(*), SUM(r.total_price)
FROM received_sales r WITH (NOLOCK)
WHERE r.id BETWEEN @start AND @end AND {SaleFilter} AND r.status = '4'
GROUP BY CAST(r.received_at AS date), r.market_id;";
        await using var c = await OpenAsync(ct);
        await using var cmd = Cmd(c, sql, 240);
        cmd.Parameters.Add("@day", SqlDbType.DateTime2).Value = from.Date;
        cmd.Parameters.Add("@next", SqlDbType.DateTime2).Value = toExclusive.Date;
        await using var r = await cmd.ExecuteReaderAsync(ct);
        var list = new List<DailyRow>();
        while (await r.ReadAsync(ct))
            list.Add(new DailyRow(r.GetDateTime(0).Date, r.GetString(1).Trim(), r.GetInt32(2), r.IsDBNull(3) ? 0 : r.GetDouble(3)));
        return list;
    }

    /// <summary>Son okunan id'den sonra merkeze düşen yeni satışlar (canlı akış).</summary>
    public async Task<List<SaleRow>> GetNewSalesAsync(long afterId, int take, CancellationToken ct)
    {
        const string sql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT TOP (@take) r.id, r.uuid, r.market_id, r.kasano, r.status, r.total_price, r.created_at, r.received_at,
       r.receipt_number, CASE WHEN r.deleted_at IS NULL THEN 0 ELSE 1 END, ISNULL(CAST(r.is_refund AS int), 0)
FROM received_sales r WITH (NOLOCK)
WHERE r.id > @after
ORDER BY r.id;";
        await using var c = await OpenAsync(ct);
        await using var cmd = Cmd(c, sql, 30);
        cmd.Parameters.Add("@take", SqlDbType.Int).Value = take;
        cmd.Parameters.Add("@after", SqlDbType.Int).Value = (int)Math.Min(afterId, int.MaxValue);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        var list = new List<SaleRow>();
        while (await r.ReadAsync(ct))
        {
            list.Add(new SaleRow(
                Convert.ToInt64(r.GetValue(0)), r.GetString(1), r.GetString(2).Trim(),
                r.IsDBNull(3) ? null : r.GetString(3), r.IsDBNull(4) ? null : r.GetString(4).Trim(),
                r.GetDouble(5), r.GetDateTime(6), r.GetDateTime(7),
                r.IsDBNull(8) ? null : r.GetString(8), r.GetInt32(9) == 1, r.GetInt32(10) == 1));
        }
        return list;
    }

    public async Task<Dictionary<string, List<(int Code, double Amount)>>> GetPaymentsAsync(IReadOnlyCollection<string> uuids, CancellationToken ct)
    {
        var result = new Dictionary<string, List<(int, double)>>(StringComparer.OrdinalIgnoreCase);
        if (uuids.Count == 0) return result;
        const string sql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT p.sale_uuid, p.payment_method, p.amount
FROM payments p WITH (NOLOCK)
WHERE p.sale_uuid IN (SELECT CAST(value AS varchar(64)) FROM STRING_SPLIT(@uuids, ',')) AND p.deleted_at IS NULL;";
        await using var c = await OpenAsync(ct);
        await using var cmd = Cmd(c, sql, 30);
        cmd.Parameters.Add("@uuids", SqlDbType.VarChar, -1).Value = string.Join(',', uuids);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            var key = r.GetString(0);
            if (!result.TryGetValue(key, out var list)) result[key] = list = new();
            list.Add((ParseCode(r.IsDBNull(1) ? null : r.GetString(1)), r.GetDouble(2)));
        }
        return result;
    }

    /// <summary>Geçmiş bir günün 15 dakikalık (96 dilim) başarılı satış cirosu. Gün sonu tahmini için.</summary>
    public async Task<double[]> GetDaySlotTotalsAsync(DateTime day, CancellationToken ct)
    {
        string sql = $@"
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
DECLARE @start int, @end int;
SELECT @start = MIN(id), @end = MAX(id) FROM received_sales WITH (NOLOCK) WHERE received_at >= @day AND received_at < @next;
SELECT {SlotExpr} AS slot, SUM(r.total_price)
FROM received_sales r WITH (NOLOCK)
WHERE r.id BETWEEN @start AND @end AND {SaleFilter} AND r.status = '4'
GROUP BY {SlotExpr};";
        var slots = new double[96];
        await using var c = await OpenAsync(ct);
        await using var cmd = Cmd(c, sql, 120);
        AddDay(cmd, day);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            int s = Math.Clamp(Convert.ToInt32(r.GetValue(0)), 0, 95);
            slots[s] += r.IsDBNull(1) ? 0 : r.GetDouble(1);
        }
        return slots;
    }

    private static int ParseCode(string? s) => int.TryParse(s?.Trim(), out var v) ? v : -1;
}
