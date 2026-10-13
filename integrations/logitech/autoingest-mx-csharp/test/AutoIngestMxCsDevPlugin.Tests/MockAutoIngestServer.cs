namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Net;
    using System.Net.WebSockets;
    using System.Text;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>
    /// A tiny, real WebSocket server standing in for AutoIngest's own
    /// mxControlService.js for unit/integration testing AutoIngestClient
    /// WITHOUT launching real Electron — real sockets, real JSON frames,
    /// the exact same message shapes the real service sends (hello/ready/
    /// state/executeCommand/commandResult/error), so AutoIngestClient is
    /// exercised through its real network code path, not a stubbed-out
    /// interface. Built on HttpListener (BCL only — no third-party
    /// WebSocket/JSON package, per the migration brief's own preference).
    /// </summary>
    public sealed class MockAutoIngestServer : IAsyncDisposable
    {
        private readonly HttpListener _listener = new();
        private readonly CancellationTokenSource _cts = new();
        private Task? _acceptLoop;
        private WebSocket? _activeSocket;
        private readonly object _sync = new();

        public int Port { get; }
        public string Token { get; } = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N"); // 64 hex chars, matches the real token shape
        public int ProtocolVersion { get; set; } = 1;
        public object InitialState { get; set; } = DefaultState();
        public bool RejectNextHello { get; set; }
        public string RejectCode { get; set; } = "invalid-token";

        /// <summary>Every executeCommand received, in order — for correlation/assertion.</summary>
        public List<(string RequestId, string CommandId, JsonElement Payload)> ReceivedCommands { get; } = new();

        /// <summary>Set to override the automatic commandResult reply (null = auto-reply ok:true,executed:true).</summary>
        public Func<string, object>? ReplyBuilder { get; set; }

        /// <summary>Command ids in this set receive NO commandResult reply at all — for exercising the client's own timeout path.</summary>
        public HashSet<string> SuppressReplyFor { get; } = new();

        public MockAutoIngestServer()
        {
            this.Port = GetFreePort();
            this._listener.Prefixes.Add($"http://127.0.0.1:{this.Port}/");
        }

        private static int GetFreePort()
        {
            using var s = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
            s.Start();
            var port = ((IPEndPoint)s.LocalEndpoint).Port;
            s.Stop();
            return port;
        }

        private static object DefaultState() => new
        {
            context = "browse",
            activeFile = (string)null,
            selectedCount = 0,
            hasSelection = false,
            previewOpen = false,
            availableCommands = new[] { "navigation.nextFile", "navigation.previousFile", "selection.toggleCurrent" },
        };

        public void Start()
        {
            this._listener.Start();
            this._acceptLoop = Task.Run(() => this.AcceptLoopAsync(this._cts.Token));
        }

        private async Task AcceptLoopAsync(CancellationToken ct)
        {
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    var ctx = await this._listener.GetContextAsync().ConfigureAwait(false);
                    if (!ctx.Request.IsWebSocketRequest) { ctx.Response.StatusCode = 400; ctx.Response.Close(); continue; }
                    var wsCtx = await ctx.AcceptWebSocketAsync(subProtocol: null).ConfigureAwait(false);
                    lock (this._sync) this._activeSocket = wsCtx.WebSocket;
                    _ = this.HandleClientAsync(wsCtx.WebSocket, ct);
                }
            }
            catch (Exception) when (ct.IsCancellationRequested) { /* shutting down */ }
            catch (ObjectDisposedException) { /* listener stopped */ }
            catch (HttpListenerException) { /* listener stopped */ }
        }

        private async Task HandleClientAsync(WebSocket ws, CancellationToken ct)
        {
            var buffer = new byte[16 * 1024];
            try
            {
                while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
                {
                    using var ms = new MemoryStream();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await ws.ReceiveAsync(buffer, ct).ConfigureAwait(false);
                        if (result.MessageType == WebSocketMessageType.Close) return;
                        ms.Write(buffer, 0, result.Count);
                    } while (!result.EndOfMessage);

                    await this.HandleFrameAsync(ws, ms.ToArray(), ct).ConfigureAwait(false);
                }
            }
            catch (Exception) when (ct.IsCancellationRequested || ws.State != WebSocketState.Open) { /* normal teardown */ }
        }

        private async Task HandleFrameAsync(WebSocket ws, byte[] raw, CancellationToken ct)
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString();

            switch (type)
            {
                case "hello":
                {
                    var token = root.TryGetProperty("token", out var t) ? t.GetString() : null;
                    var protocolVersion = root.TryGetProperty("protocolVersion", out var p) ? p.GetInt32() : -1;
                    if (this.RejectNextHello || token != this.Token)
                    {
                        await SendAsync(ws, new { type = "error", code = this.RejectNextHello ? this.RejectCode : "invalid-token" }, ct).ConfigureAwait(false);
                        return;
                    }
                    await SendAsync(ws, new { type = "ready", protocolVersion = this.ProtocolVersion }, ct).ConfigureAwait(false);
                    if (protocolVersion == this.ProtocolVersion)
                    {
                        await SendAsync(ws, new { type = "state", state = this.InitialState }, ct).ConfigureAwait(false);
                    }
                    break;
                }
                case "executeCommand":
                {
                    var requestId = root.GetProperty("requestId").GetString();
                    var commandId = root.GetProperty("commandId").GetString();
                    // .Clone() is required: `p` is a view into `doc`, which this
                    // method's `using` disposes on return. Previously-passing
                    // tests never inspected a stored Payload's contents after
                    // the fact (only CommandId/RequestId), so this went
                    // unnoticed until a test needed to read payload fields
                    // post-hoc (Phase 4B's tagRefinement.setTagState payload
                    // assertions) — found live via that test's own
                    // ObjectDisposedException, not assumed.
                    var payload = root.TryGetProperty("payload", out var p) ? p.Clone() : default;
                    lock (this._sync) this.ReceivedCommands.Add((requestId, commandId, payload));
                    if (this.SuppressReplyFor.Contains(commandId)) return; // deliberately silent — exercises the client's own timeout path
                    var reply = this.ReplyBuilder?.Invoke(commandId) ?? new { ok = true, commandId, executed = true };
                    await SendAsync(ws, new { type = "commandResult", requestId, result = reply }, ct).ConfigureAwait(false);
                    break;
                }
            }
        }

        /// <summary>Sends an arbitrary raw text frame — for exercising the
        /// client's handling of a malformed/non-JSON server message.</summary>
        public Task SendRawAsync(string rawText)
        {
            WebSocket ws;
            lock (this._sync) ws = this._activeSocket;
            if (ws == null || ws.State != WebSocketState.Open) return Task.CompletedTask;
            var bytes = Encoding.UTF8.GetBytes(rawText);
            return ws.SendAsync(bytes, WebSocketMessageType.Text, true, this._cts.Token);
        }

        public Task PushStateAsync(object state)
        {
            WebSocket ws;
            lock (this._sync) ws = this._activeSocket;
            if (ws == null || ws.State != WebSocketState.Open) return Task.CompletedTask;
            return SendAsync(ws, new { type = "state", state }, this._cts.Token);
        }

        public async Task CloseActiveConnectionAsync()
        {
            WebSocket ws;
            lock (this._sync) ws = this._activeSocket;
            if (ws == null) return;
            try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "test", CancellationToken.None).ConfigureAwait(false); }
            catch { /* already closing */ }
        }

        private static Task SendAsync(WebSocket ws, object message, CancellationToken ct)
        {
            var json = JsonSerializer.Serialize(message, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            var bytes = Encoding.UTF8.GetBytes(json);
            return ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
        }

        private bool _disposed;

        public async ValueTask DisposeAsync()
        {
            // Idempotent: tests may call this explicitly (to simulate a real
            // AutoIngest restart) and then again via `await using` at scope
            // exit — a double-dispose must never throw.
            if (this._disposed) return;
            this._disposed = true;
            this._cts.Cancel();
            try { this._listener.Stop(); } catch { /* ignore */ }
            try { if (this._acceptLoop != null) await this._acceptLoop.WaitAsync(TimeSpan.FromSeconds(2)).ConfigureAwait(false); } catch { /* ignore */ }
            this._listener.Close();
            this._cts.Dispose();
        }
    }
}
