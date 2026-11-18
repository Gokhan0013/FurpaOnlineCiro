using System.Collections.Concurrent;
using System.Threading.Channels;

namespace FurpaOnline.Services;

/// <summary>Server-Sent Events yayıncısı. Her ekran bir abone; veritabanına sadece arka plan servisi gider.</summary>
public sealed class SseHub
{
    private readonly ConcurrentDictionary<Guid, Channel<string>> _clients = new();

    public int Count => _clients.Count;

    public (Guid Id, ChannelReader<string> Reader) Subscribe()
    {
        var ch = Channel.CreateBounded<string>(new BoundedChannelOptions(16)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true
        });
        var id = Guid.NewGuid();
        _clients[id] = ch;
        return (id, ch.Reader);
    }

    public void Unsubscribe(Guid id)
    {
        if (_clients.TryRemove(id, out var ch)) ch.Writer.TryComplete();
    }

    public void Broadcast(string evt, string json)
    {
        var msg = $"event: {evt}\ndata: {json}\n\n";
        foreach (var ch in _clients.Values) ch.Writer.TryWrite(msg);
    }
}
