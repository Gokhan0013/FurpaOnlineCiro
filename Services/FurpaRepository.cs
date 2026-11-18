using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;

namespace FurpaOnline.Services;

/// <summary>Furpa (10.0.0.207) okuyucusu: kasa tanımları. Sync Panel'in güncellediği Sube_Kasa_Tanimlari tablosu.</summary>
public sealed class FurpaRepository(IOptionsMonitor<FurpaOptions> options)
{
    public async Task<List<RegisterMeta>> GetRegistersAsync(CancellationToken ct)
    {
        var cs = options.CurrentValue.FurpaConnection;
        if (string.IsNullOrWhiteSpace(cs) || cs.Contains("SUNUCU"))
            throw new InvalidOperationException("Furpa bağlantı bilgisi tanımlı değil (appsettings.Local.json).");

        await using var c = new SqlConnection(cs);
        await c.OpenAsync(ct);
        await using var cmd = new SqlCommand(@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT Sube_No, Kasa_No, Sube_Adi, yazilim_version, db_boyut, UpdateDate
FROM dbo.Sube_Kasa_Tanimlari WITH (NOLOCK)", c) { CommandTimeout = 30 };
        await using var r = await cmd.ExecuteReaderAsync(ct);
        var list = new List<RegisterMeta>();
        while (await r.ReadAsync(ct))
        {
            if (r.IsDBNull(0) || r.IsDBNull(1)) continue;
            list.Add(new RegisterMeta(
                r.GetInt32(0), r.GetInt32(1),
                r.IsDBNull(2) ? null : r.GetString(2),
                r.IsDBNull(3) ? null : r.GetString(3),
                r.IsDBNull(4) ? null : r.GetString(4),
                r.IsDBNull(5) ? null : r.GetDateTime(5)));
        }
        return list;
    }
}
