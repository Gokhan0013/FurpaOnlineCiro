using FurpaOnline.Services;
using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

builder.Services.Configure<FurpaOptions>(builder.Configuration.GetSection("FurpaOnline"));
builder.Services.AddSingleton<RegionCatalog>();
builder.Services.AddSingleton<ShopigoRepository>();
builder.Services.AddSingleton<FurpaRepository>();
builder.Services.AddSingleton<LiveState>();
builder.Services.AddSingleton<SseHub>();
builder.Services.AddSingleton<HistoryService>();
builder.Services.AddSingleton<WeatherService>();
builder.Services.AddSingleton<ReportService>();
builder.Services.AddSingleton<MarketService>();
builder.Services.AddSingleton<BulkSalesService>();
builder.Services.AddHostedService<LivePoller>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        ctx.Context.Response.Headers.Pragma = "no-cache";
        ctx.Context.Response.Headers.Expires = "0";
    }
});

// Anlık görüntü (ilk yükleme / canlı yedek yoklama)
app.MapGet("/api/snapshot", (HttpContext ctx, LiveState state) =>
{
    ctx.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
    ctx.Response.Headers.Pragma = "no-cache";
    return Results.Content(state.CurrentJson, "application/json; charset=utf-8");
});

// Canlı yayın (Server-Sent Events)
app.MapGet("/api/stream", async (HttpContext ctx, SseHub hub, LiveState state) =>
{
    var ct = ctx.RequestAborted;
    ctx.Response.Headers.ContentType = "text/event-stream; charset=utf-8";
    ctx.Response.Headers.CacheControl = "no-store, no-cache, no-transform";
    ctx.Response.Headers["X-Accel-Buffering"] = "no";
    ctx.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();

    var (id, reader) = hub.Subscribe();
    try
    {
        await ctx.Response.WriteAsync(": furpa-live-stream\nretry: 2500\n\n", ct);
        await ctx.Response.WriteAsync($"event: snapshot\ndata: {state.CurrentJson}\n\n", ct);
        await ctx.Response.Body.FlushAsync(ct);

        while (!ct.IsCancellationRequested)
        {
            using var beat = CancellationTokenSource.CreateLinkedTokenSource(ct);
            beat.CancelAfter(TimeSpan.FromSeconds(10));
            try
            {
                if (!await reader.WaitToReadAsync(beat.Token)) break;
                while (reader.TryRead(out var msg)) await ctx.Response.WriteAsync(msg, ct);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                await ctx.Response.WriteAsync(": ping\n\n", ct);
            }
            await ctx.Response.Body.FlushAsync(ct);
        }
    }
    catch (OperationCanceledException) { }
    finally { hub.Unsubscribe(id); }
});

// Geçmiş tarih / tarih aralığı (yyyy-MM-dd)
app.MapGet("/api/history", async (HttpContext ctx, HistoryService history) =>
{
    ctx.Response.Headers.CacheControl = "no-store, no-cache";
    static bool TryDate(string? s, out DateTime d) =>
        DateTime.TryParseExact(s, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out d);

    if (!TryDate(ctx.Request.Query["from"], out var from) || !TryDate(ctx.Request.Query["to"], out var to))
        return Results.Json(new { error = "Tarih biçimi yyyy-MM-dd olmalı." }, statusCode: 400);
    var today = DateTime.Now.Date;
    if (from > today) return Results.Json(new { error = "Başlangıç tarihi gelecekte olamaz." }, statusCode: 400);
    if (to > today) to = today;
    if (to < from) (from, to) = (to, from);
    if ((to - from).TotalDays > 800) return Results.Json(new { error = "En fazla 800 günlük aralık seçilebilir." }, statusCode: 400);

    try { return Results.Content(await history.GetAsync(from, to, ctx.RequestAborted), "application/json; charset=utf-8"); }
    catch (OperationCanceledException) { return Results.StatusCode(499); }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

// Rapor: gün × şube kırılımı + hava durumu
app.MapGet("/api/report", async (HttpContext ctx, ReportService report) =>
{
    ctx.Response.Headers.CacheControl = "no-store, no-cache";
    static bool TryDate(string? s, out DateTime d) =>
        DateTime.TryParseExact(s, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out d);

    if (!TryDate(ctx.Request.Query["from"], out var from) || !TryDate(ctx.Request.Query["to"], out var to))
        return Results.Json(new { error = "Tarih biçimi yyyy-MM-dd olmalı." }, statusCode: 400);
    var today = DateTime.Now.Date;
    if (from > today) return Results.Json(new { error = "Başlangıç tarihi gelecekte olamaz." }, statusCode: 400);
    if (to > today) to = today;
    if (to < from) (from, to) = (to, from);
    if ((to - from).TotalDays > 800) return Results.Json(new { error = "En fazla 800 günlük aralık seçilebilir." }, statusCode: 400);

    try { return Results.Content(await report.GetAsync(from, to, ctx.RequestAborted), "application/json; charset=utf-8"); }
    catch (OperationCanceledException) { return Results.StatusCode(499); }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

// Döviz ve altın kurları (USD, EUR, Gram Altın, Çeyrek Altın)
app.MapGet("/api/markets", async (HttpContext ctx, MarketService markets) =>
{
    ctx.Response.Headers.CacheControl = "no-store, no-cache";
    try { return Results.Content(await markets.GetJsonAsync(ctx.RequestAborted), "application/json; charset=utf-8"); }
    catch (OperationCanceledException) { return Results.StatusCode(499); }
    catch (Exception ex) { return Results.Json(new { ok = false, error = ex.Message }, statusCode: 500); }
});

// Toplu satışlar (varsayılan >= 10.000 TL başarılı fişler + fiş/ödeme detayı)
app.MapGet("/api/bulk", async (HttpContext ctx, BulkSalesService bulk) =>
{
    ctx.Response.Headers.CacheControl = "no-store, no-cache";
    static bool TryDate(string? s, out DateTime d) =>
        DateTime.TryParseExact(s, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out d);

    if (!TryDate(ctx.Request.Query["from"], out var from) || !TryDate(ctx.Request.Query["to"], out var to))
        return Results.Json(new { error = "Tarih biçimi yyyy-MM-dd olmalı." }, statusCode: 400);
    double min = 10000;
    if (double.TryParse(ctx.Request.Query["min"], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var parsedMin) && parsedMin >= 1000)
        min = parsedMin;

    var today = DateTime.Now.Date;
    if (from > today) return Results.Json(new { error = "Başlangıç tarihi gelecekte olamaz." }, statusCode: 400);
    if (to > today) to = today;
    if (to < from) (from, to) = (to, from);
    if ((to - from).TotalDays > 800) return Results.Json(new { error = "En fazla 800 günlük aralık seçilebilir." }, statusCode: 400);

    try { return Results.Content(await bulk.GetListJsonAsync(from, to, min, ctx.RequestAborted), "application/json; charset=utf-8"); }
    catch (OperationCanceledException) { return Results.StatusCode(499); }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapGet("/api/bulk/detail", async (HttpContext ctx, BulkSalesService bulk) =>
{
    ctx.Response.Headers.CacheControl = "no-store, no-cache";
    var uuid = ctx.Request.Query["uuid"].ToString();
    if (string.IsNullOrWhiteSpace(uuid))
        return Results.Json(new { error = "Fiş kimliği (uuid) gerekli." }, statusCode: 400);
    try
    {
        var json = await bulk.GetDetailJsonAsync(uuid, ctx.RequestAborted);
        return json is null
            ? Results.Json(new { error = "Fiş detayı bulunamadı." }, statusCode: 404)
            : Results.Content(json, "application/json; charset=utf-8");
    }
    catch (OperationCanceledException) { return Results.StatusCode(499); }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapGet("/api/health", (HttpContext ctx, SseHub hub, LiveState state) =>
{
    ctx.Response.Headers.CacheControl = "no-store, no-cache";
    return Results.Ok(new { ok = true, viewers = hub.Count, day = state.Day, lastId = state.LastId });
});

var loginHttp = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
app.MapPost("/api/login", async (HttpContext ctx) =>
{
    ctx.Response.Headers.CacheControl = "no-store, no-cache";
    LoginRequest? req;
    try
    {
        req = await ctx.Request.ReadFromJsonAsync<LoginRequest>(ctx.RequestAborted);
    }
    catch
    {
        return Results.Json(new { error = "Geçersiz istek gövdesi." }, statusCode: 400);
    }

    if (req is null || string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
        return Results.Json(new { error = "E-posta ve şifre gerekli." }, statusCode: 400);

    try
    {
        using var resp = await loginHttp.PostAsJsonAsync(
            "https://ciro.furpa.com.tr:5025/api/v3/kullanici/login",
            new { email = req.Email.Trim(), password = req.Password },
            ctx.RequestAborted);

        var body = await resp.Content.ReadAsStringAsync(ctx.RequestAborted);
        if (string.IsNullOrWhiteSpace(body))
        {
            return resp.IsSuccessStatusCode
                ? Results.Ok(new { ok = true })
                : Results.Json(new { error = "E-posta veya şifre hatalı." }, statusCode: (int)resp.StatusCode);
        }

        ctx.Response.StatusCode = (int)resp.StatusCode;
        return Results.Content(body, "application/json; charset=utf-8");
    }
    catch (OperationCanceledException)
    {
        return Results.StatusCode(499);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Giriş servisine bağlanılamadı: {ex.Message}" }, statusCode: 502);
    }
});

app.Run();

record LoginRequest(string Email, string Password);

