using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;

namespace FurpaOnline.Services;

public sealed class RegionDef
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#888888";
    public List<string> Stores { get; set; } = new();
}

/// <summary>
/// Bölgeleri Mikro (DEPOLAR) ve Furpa (Bolge_Yoneticileri) tablolarından canlı okur.
/// Yedek olarak regions.json dosyasını da senkronize tutar.
/// </summary>
public sealed class RegionCatalog
{
    public const string OtherId = "bolge_diger";
    public static readonly RegionDef Other = new() { Id = OtherId, Name = "Merkez / Diğer", Color = "#8a8a96" };

    private static readonly Dictionary<string, string> RegionColors = new(StringComparer.OrdinalIgnoreCase)
    {
        ["1"] = "#1fa39c",
        ["2"] = "#c9a467",
        ["3"] = "#3f84d6",
        ["4"] = "#7c5cf2",
        ["5"] = "#e05638",
        ["6"] = "#28b463",
        ["0"] = "#8a8a96",
        ["bolge_1"] = "#1fa39c",
        ["bolge_2"] = "#c9a467",
        ["bolge_3"] = "#3f84d6",
        ["bolge_4"] = "#7c5cf2",
        ["bolge_5"] = "#e05638",
        ["bolge_6"] = "#28b463",
        ["bolge_diger"] = "#8a8a96"
    };

    private readonly string _path;
    private readonly IOptionsMonitor<FurpaOptions> _options;
    private readonly ILogger<RegionCatalog> _log;
    private DateTime _stamp;
    private Dictionary<string, string> _map = new();
    private HashSet<string> _nullRegionStores = new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyList<RegionDef> Regions { get; private set; } = Array.Empty<RegionDef>();

    public HashSet<string> GetExcludedMarkets()
    {
        var set = new HashSet<string>(_options.CurrentValue.ExcludedMarkets, StringComparer.OrdinalIgnoreCase);
        foreach (var id in _nullRegionStores) set.Add(id);
        return set;
    }

    public RegionCatalog(IWebHostEnvironment env, IOptionsMonitor<FurpaOptions> options, ILogger<RegionCatalog> log)
    {
        _path = Path.Combine(env.ContentRootPath, "regions.json");
        _options = options;
        _log = log;
        ReloadIfChanged();
    }

    public void ReloadIfChanged()
    {
        try
        {
            var fi = new FileInfo(_path);
            if (!fi.Exists || fi.LastWriteTimeUtc == _stamp) return;

            var file = JsonSerializer.Deserialize<RegionFile>(File.ReadAllText(_path),
                new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new RegionFile();

            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var reg in file.Regions)
                foreach (var s in reg.Stores)
                    map[s.Trim()] = reg.Id;

            Regions = file.Regions;
            _map = map;
            _stamp = fi.LastWriteTimeUtc;
            _log.LogInformation("regions.json yüklendi: {Count} bölge, {Stores} mağaza", file.Regions.Count, map.Count);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "regions.json okunamadı");
        }
    }

    /// <summary>
    /// Mikro DEPOLAR ve Furpa Bolge_Yoneticileri üzerinden canlı bölge ve mağaza dağılımını günceller.
    /// </summary>
    public async Task ReloadFromDatabaseAsync(CancellationToken ct)
    {
        var cs = _options.CurrentValue.MikroConnection;
        if (string.IsNullOrWhiteSpace(cs) || cs.Contains("SUNUCU"))
            cs = _options.CurrentValue.FurpaConnection;

        if (string.IsNullOrWhiteSpace(cs) || cs.Contains("SUNUCU"))
        {
            ReloadIfChanged();
            return;
        }

        try
        {
            const string sql = @"
SELECT d.dep_no, d.dep_adi,
       ISNULL(NULLIF(LTRIM(RTRIM(d.dep_bolge_kodu)), ''), '0') AS bolge_kodu,
       ISNULL(byon.bolge_muduru, '') AS bolge_muduru
FROM [MikroDesktop_FURPA_2024].[dbo].[DEPOLAR] d WITH (NOLOCK)
LEFT JOIN [Furpa].[dbo].[Bolge_Yoneticileri] byon WITH (NOLOCK)
       ON CAST(byon.bolge_kodu AS varchar(50)) = CAST(d.dep_bolge_kodu AS varchar(50))
WHERE d.dep_no >= 100
ORDER BY TRY_CAST(d.dep_bolge_kodu AS int), d.dep_no;";

            await using var conn = new SqlConnection(cs);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            await using var r = await cmd.ExecuteReaderAsync(ct);

            var regionGroups = new Dictionary<string, (string Name, string Color, List<string> Stores)>();
            var nullStores = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            while (await r.ReadAsync(ct))
            {
                int depNo = r.GetInt32(0);
                string depAdi = r.GetString(1).Trim();
                string bolgeKodu = r.GetString(2).Trim();
                string mudur = r.GetString(3).Trim();

                if (bolgeKodu is "0" or "")
                {
                    nullStores.Add(depNo.ToString());
                    continue;
                }

                string regId = $"bolge_{bolgeKodu}";
                string regName = !string.IsNullOrEmpty(mudur)
                    ? $"{bolgeKodu}. Bölge ({mudur})"
                    : $"{bolgeKodu}. Bölge";

                string color = RegionColors.TryGetValue(regId, out var c) ? c : (RegionColors.TryGetValue(bolgeKodu, out var c2) ? c2 : "#888888");

                if (!regionGroups.TryGetValue(regId, out var group))
                {
                    group = (regName, color, new List<string>());
                    regionGroups[regId] = group;
                }

                group.Stores.Add(depNo.ToString());
            }

            _nullRegionStores = nullStores;

            if (regionGroups.Count > 0)
            {
                var list = regionGroups
                    .OrderBy(kv => kv.Key == OtherId ? 99 : (int.TryParse(kv.Key.Replace("bolge_", ""), out var n) ? n : 50))
                    .Select(kv => new RegionDef
                    {
                        Id = kv.Key,
                        Name = kv.Value.Name,
                        Color = kv.Value.Color,
                        Stores = kv.Value.Stores
                    }).ToList();

                var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var reg in list)
                    foreach (var s in reg.Stores)
                        map[s.Trim()] = reg.Id;

                Regions = list;
                _map = map;

                _log.LogInformation("Mikro DEPOLAR'dan bölgeler başarıyla güncellendi: {Count} bölge, {Stores} mağaza", list.Count, map.Count);

                // regions.json dosyasını da güncelle
                try
                {
                    var file = new RegionFile { Regions = list };
                    var json = JsonSerializer.Serialize(file, new JsonSerializerOptions { WriteIndented = true });
                    await File.WriteAllTextAsync(_path, json, ct);
                    _stamp = File.GetLastWriteTimeUtc(_path);
                }
                catch { }
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Mikro DEPOLAR üzerinden bölgeler okunamadı, regions.json fallback kullanılıyor.");
            ReloadIfChanged();
        }
    }

    public string RegionOf(string marketId) => _map.TryGetValue(marketId, out var r) ? r : OtherId;

    private sealed class RegionFile
    {
        public List<RegionDef> Regions { get; set; } = new();
    }
}
