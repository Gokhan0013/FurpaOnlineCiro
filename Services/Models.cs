namespace FurpaOnline.Services;

public sealed class FurpaOptions
{
    public string ShopigoConnection { get; set; } = "";
    public string FurpaConnection { get; set; } = "";
    public string MikroConnection { get; set; } = "";
    public int LivePollSeconds { get; set; } = 5;
    public int ReconcileSeconds { get; set; } = 30;
    public int CatalogMinutes { get; set; } = 10;
    public int RegisterMinutes { get; set; } = 5;
    public int ForecastWeeks { get; set; } = 4;
    public int ActiveRegisterMinutes { get; set; } = 30;
    public string[] ExcludedMarkets { get; set; } = ["50"];

    // Rapor sayfasındaki hava durumu için konum (tüm mağazalar Bursa'da). Veri: Open-Meteo (anahtarsız, ücretsiz).
    public string WeatherCity { get; set; } = "Bursa";
    public double WeatherLat { get; set; } = 40.1826;
    public double WeatherLon { get; set; } = 29.0669;
}

public sealed record DailyRow(DateTime Day, string Market, int Count, double Amount);

// ---- Veritabanından okunan ham satırlar ----

public sealed record BranchRow(string MarketId, string Name, string City);

/// <summary>
/// payment_methods satırı. Sync Panel merkeze payments.payment_method olarak
/// payment_methods.pavo_mediator değerini yazar (RemoteSqliteOutboundReader: COALESCE(pm.pavo_mediator, p.payment_method)).
/// </summary>
public sealed record PayMeta(int Mediator, int PavoType, string Name, string? Group);

public sealed record SaleRow(
    long Id, string Uuid, string MarketId, string? Kasa, string? Status,
    double Total, DateTime CreatedAt, DateTime ReceivedAt, string? Receipt, bool Deleted, bool Refund);

public sealed record RecentRow(long Id, string MarketId, string? Kasa, double Amount, DateTime At, string? Receipt, int? Method);

public sealed record RegisterMeta(int SubeNo, int KasaNo, string? SubeAdi, string? Version, string? DbSize, DateTime? UpdateDate);

public sealed record AggCell(string Market, string Status, int Slot, int Count, double Amount, DateTime LastAt);
public sealed record AggRegister(string Market, string Kasa, int Count, double Amount, DateTime LastAt);
public sealed record AggPayment(int Code, int Count, double Amount);

public sealed class DayAggregate
{
    public long MaxId { get; set; }
    public List<AggCell> Cells { get; } = new();
    public List<AggRegister> Registers { get; } = new();
    public List<AggPayment> Payments { get; } = new();
    public List<RecentRow> Recent { get; } = new();
}

// ---- Ekrana giden JSON ----

public sealed record SnapshotDto(
    bool Loading, string ServerTime, string Day, bool DbOk, string? Error, string? Warning,
    string? LastDataAt, string? LastPollAt,
    KpiDto Kpi, List<RegionDto> Regions, List<StoreDto> Stores, SlotsDto Slots,
    List<PaymentGroupDto> Payments, List<RecentDto> Recent, List<RegisterDto> Registers);

public sealed record KpiDto(
    double Ciro, int Fis, double Sepet,
    double Forecast, double ForecastShare, double AvgDayTotal, int ForecastDays,
    double YesterdayTotal, double YesterdaySameTime,
    int ActiveSales, int CancelCount, double CancelAmount,
    int ActiveRegisters, int TotalRegisters, int ActiveStores, int TotalStores,
    double LastHourCiro, int LastHourFis);

public sealed record RegionDto(string Id, string Name, string Color, double Ciro, int Fis, int Stores, int ActiveStores, double LastHourCiro);

public sealed record StoreDto(string Id, string Name, string Region, double Ciro, int Fis, double LastHourCiro, int LastHourFis, string? LastSaleAt, int Rank, int PrevRank, double[] Hourly);

public sealed record SlotsDto(int Minutes, int NowSlot, List<string> RegionIds, double[][] Amount, int[] Count, double[] YesterdayCum, double[] ShareCurve);

public sealed record PaymentGroupDto(string Key, string Name, double Amount, int Count, List<PaymentItemDto> Items);
public sealed record PaymentItemDto(string Name, double Amount, int Count);

public sealed record RecentDto(long Id, string Market, string Store, string Region, string? Kasa, double Amount, string At, string Method, string MethodName);

public sealed record RegisterDto(string Market, string Store, string Kasa, string? Version, string? DbSize, string? LastSaleAt, int Count, double Amount);
