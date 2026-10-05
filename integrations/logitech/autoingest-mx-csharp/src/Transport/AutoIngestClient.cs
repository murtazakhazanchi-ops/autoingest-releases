namespace Loupedeck.AutoIngestMxCsDevPlugin.Transport
{
    using System;
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.Net.WebSockets;
    using System.Text;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>
    /// Connection manager for AutoIngest's Phase 2 local control transport (see
    /// docs/mxControlTransport.md). Architectural PORT of the proven Node
    /// plugin's src/autoIngestClient.ts — same connection-state machine, same
    /// reconnect/backoff behavior, same message protocol — NOT a line-by-line
    /// translation; this uses idiomatic .NET (ClientWebSocket,
    /// System.Text.Json, Task-based async) throughout.
    ///
    /// Owns discovery, the WebSocket connection, authentication, reconnect/
    /// backoff, latest-state caching, and requestId-correlated command
    /// execution. Logitech actions never touch a socket, the descriptor, or
    /// the wire protocol directly — they only call ExecuteCommandAsync()/
    /// GetLatestState()/Subscribe() on the one shared instance.
    ///
    /// This class duplicates NO AutoIngest business rules. ExecuteCommandAsync
    /// forwards a commandId/payload opaquely and returns exactly what
    /// AutoIngestCommands.execute() decided — that result is the sole source
    /// of truth for whether anything happened.
    ///
    /// Threading: every public method is safe to call from any thread,
    /// including a Logitech SDK action callback thread. The receive loop and
    /// the reconnect loop each run on their own background Task and never
    /// block a caller — see ExecuteCommandAsync's use of Task.WaitAsync
    /// (never .Result/.Wait()) and the actions' own fire-and-forget-with-
    /// try/catch pattern for why RunCommand()/ApplyAdjustment() (synchronous
    /// SDK callbacks) never deadlock waiting on this client.
    /// </summary>
    public sealed class AutoIngestClient : IDisposable
    {
        private const int ProtocolVersion = 1;
        private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(8);
        private static readonly TimeSpan ReconnectBaseDelay = TimeSpan.FromSeconds(1);
        private static readonly TimeSpan ReconnectMaxDelay = TimeSpan.FromSeconds(15);

        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,
        };

        private readonly Action<string, string> _log; // (level, message) — never the token, never a full descriptor, never a continuous state dump
        private readonly string _homeOverride;

        private readonly object _sync = new();
        private readonly List<Action<ClientSnapshot>> _listeners = new();
        private readonly ConcurrentDictionary<string, TaskCompletionSource<CommandResult>> _pending = new();

        private ConnectionState _connectionState = ConnectionState.Disconnected;
        private AutoIngestState _latestState;
        private ClientWebSocket _ws;
        private CancellationTokenSource _runCts; // cancelled by DisconnectAsync/Dispose — stops the reconnect loop and any in-flight receive
        private Task _runLoopTask;
        private int _reconnectAttempt;
        private long _requestCounter;
        private volatile bool _stopped = true;

        /// <param name="log">Sink for connection/lifecycle diagnostics — (level, message).</param>
        /// <param name="homeOverride">Test-only seam threaded to descriptor discovery — never set outside tests.</param>
        public AutoIngestClient(Action<string, string> log = null, string homeOverride = null)
        {
            this._log = log ?? ((_, __) => { });
            this._homeOverride = homeOverride;
        }

        public ConnectionState GetConnectionState()
        {
            lock (this._sync) return this._connectionState;
        }

        public AutoIngestState GetLatestState()
        {
            lock (this._sync) return this._latestState;
        }

        /// <summary>Subscribes to every connection-state transition and state
        /// push. Fires once immediately with the current snapshot (thread-safe,
        /// matches the Node client's subscribe() contract). Returns an
        /// IDisposable whose Dispose() unsubscribes.</summary>
        public IDisposable Subscribe(Action<ClientSnapshot> listener)
        {
            if (listener == null) throw new ArgumentNullException(nameof(listener));
            ClientSnapshot initial;
            lock (this._sync)
            {
                this._listeners.Add(listener);
                initial = new ClientSnapshot(this._connectionState, this._latestState);
            }
            listener(initial);
            return new Unsubscriber(this, listener);
        }

        private sealed class Unsubscriber : IDisposable
        {
            private readonly AutoIngestClient _owner;
            private readonly Action<ClientSnapshot> _listener;
            private bool _disposed;

            public Unsubscriber(AutoIngestClient owner, Action<ClientSnapshot> listener)
            {
                this._owner = owner;
                this._listener = listener;
            }

            public void Dispose()
            {
                if (this._disposed) return;
                this._disposed = true;
                lock (this._owner._sync) this._owner._listeners.Remove(this._listener);
            }
        }

        /// <summary>Starts discovery + connection, with automatic reconnect on
        /// failure/disconnect. Idempotent — calling while already running is a
        /// no-op. Never blocks: the actual connect attempt runs on a background
        /// Task this method kicks off and returns immediately from.</summary>
        public void Connect()
        {
            lock (this._sync)
            {
                if (!this._stopped) return;
                this._stopped = false;
                this._reconnectAttempt = 0;
                this._runCts = new CancellationTokenSource();
            }
            var token = this._runCts.Token;
            this._runLoopTask = Task.Run(() => this.RunLoopAsync(token), token)
                .ContinueWith(t =>
                {
                    if (t.Exception != null) this._log("error", $"run loop ended with an unobserved exception: {t.Exception.Flatten().InnerException?.Message}");
                }, TaskScheduler.Default);
        }

        /// <summary>Stops reconnect attempts and closes any open connection.
        /// Safe to call even if never connected. Awaits the background loop's
        /// own clean shutdown (bounded) so no receive/reconnect work survives
        /// past this call returning.</summary>
        public async Task DisconnectAsync()
        {
            CancellationTokenSource ctsToCancel;
            Task loopTask;
            lock (this._sync)
            {
                if (this._stopped) return;
                this._stopped = true;
                ctsToCancel = this._runCts;
                loopTask = this._runLoopTask;
            }
            ctsToCancel?.Cancel();
            foreach (var kv in this._pending) kv.Value.TrySetResult(new CommandResult(false, Reason: "not-connected"));
            this._pending.Clear();
            try
            {
                if (loopTask != null) await loopTask.WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                this._log("debug", $"disconnect: run loop did not stop cleanly within 5s: {ex.Message}");
            }
            this.SetConnectionStateAndState(ConnectionState.Disconnected, null);
            ctsToCancel?.Dispose();
        }

        public void Dispose() => this.DisconnectAsync().GetAwaiter().GetResult();

        /// <summary>
        /// Forwards commandId/payload to AutoIngest's real command registry.
        /// Never duplicates canExecute()/isValid() logic — the returned result
        /// IS the authoritative outcome. Resolves (never throws) even when not
        /// connected or on timeout, so a caller (an SDK action callback) never
        /// needs its own try/catch for transport failures. Uses
        /// Task.WaitAsync for the timeout — never a manual Timer/ .Wait() pair
        /// that could leak or deadlock.
        /// </summary>
        public async Task<CommandResult> ExecuteCommandAsync(string commandId, object payload = null)
        {
            ClientWebSocket ws;
            lock (this._sync)
            {
                if (this._connectionState != ConnectionState.Connected || this._ws == null)
                {
                    return new CommandResult(false, commandId, Reason: "not-connected");
                }
                ws = this._ws;
            }

            var requestId = $"mx-plugin-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Interlocked.Increment(ref this._requestCounter)}";
            var tcs = new TaskCompletionSource<CommandResult>(TaskCreationOptions.RunContinuationsAsynchronously);
            this._pending[requestId] = tcs;

            try
            {
                var frame = JsonSerializer.Serialize(new Dictionary<string, object>
                {
                    ["type"] = "executeCommand",
                    ["requestId"] = requestId,
                    ["commandId"] = commandId,
                    ["payload"] = payload,
                }, JsonOptions);
                var bytes = Encoding.UTF8.GetBytes(frame);
                await ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                this._pending.TryRemove(requestId, out _);
                return new CommandResult(false, commandId, Reason: $"send-failed: {ex.Message}");
            }

            try
            {
                return await tcs.Task.WaitAsync(CommandTimeout).ConfigureAwait(false);
            }
            catch (TimeoutException)
            {
                this._pending.TryRemove(requestId, out _);
                return new CommandResult(false, commandId, Reason: "plugin-timeout");
            }
        }

        // ── Internal: connection lifecycle ──────────────────────────────────

        private async Task RunLoopAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                var connected = await this.TryConnectOnceAsync(ct).ConfigureAwait(false);
                if (ct.IsCancellationRequested) break;
                if (!connected)
                {
                    await this.DelayForReconnectAsync(ct).ConfigureAwait(false);
                    continue;
                }
                // TryConnectOnceAsync only returns true after the receive loop
                // it started has already exited (disconnected) — loop back to
                // reconnect unless we were told to stop meanwhile.
                if (!ct.IsCancellationRequested) await this.DelayForReconnectAsync(ct).ConfigureAwait(false);
            }
        }

        /// <returns>true once a connection was established AND has since
        /// ended (so the caller should treat this as "one connection cycle
        /// completed, try again after backoff"); false if discovery/connect
        /// itself failed before ever reaching "connected" (caller backs off
        /// the same way).</returns>
        private async Task<bool> TryConnectOnceAsync(CancellationToken ct)
        {
            this.SetConnectionStateAndState(ConnectionState.Discovering, null);
            Descriptor descriptor;
            try
            {
                descriptor = DescriptorDiscovery.Discover(this._homeOverride);
            }
            catch (DescriptorException ex)
            {
                this._log("debug", $"descriptor not available ({ex.Code}) — will retry");
                this.SetConnectionStateAndState(ConnectionState.Disconnected, null);
                return false;
            }

            this.SetConnectionStateAndState(ConnectionState.Connecting, null);
            this._log("info", $"connecting to AutoIngest on 127.0.0.1:{descriptor.Port}");

            using var ws = new ClientWebSocket();
            try
            {
                // Loopback only — never anything other than 127.0.0.1, matching
                // the transport's own binding guarantee.
                await ws.ConnectAsync(new Uri($"ws://127.0.0.1:{descriptor.Port}"), ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                this._log("warn", $"failed to open socket: {ex.Message}");
                this.SetConnectionStateAndState(ConnectionState.Disconnected, null);
                return false;
            }
            if (ct.IsCancellationRequested) return false;

            lock (this._sync) this._ws = ws;
            this.SetConnectionStateAndState(ConnectionState.Authenticating, null);

            try
            {
                var hello = JsonSerializer.Serialize(new Dictionary<string, object>
                {
                    ["type"] = "hello",
                    ["token"] = descriptor.Token,
                    ["protocolVersion"] = ProtocolVersion,
                }, JsonOptions);
                await ws.SendAsync(Encoding.UTF8.GetBytes(hello), WebSocketMessageType.Text, true, ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                this._log("warn", $"failed to send hello: {ex.Message}");
                this.TeardownSocket();
                return false;
            }

            // Receive loop runs until the socket closes, errors, or ct cancels
            // — never blocks this method's caller beyond that (this IS the
            // dedicated receive Task; TryConnectOnceAsync's own caller is
            // itself already running on a background Task from Connect()).
            try
            {
                await this.ReceiveLoopAsync(ws, ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                this._log("debug", $"receive loop ended with exception: {ex.Message}");
            }

            var wasConnected = this.GetConnectionState() == ConnectionState.Connected;
            this._log(wasConnected ? "info" : "debug", "AutoIngest disconnected");
            this.TeardownSocket();
            this.SetConnectionStateAndState(ConnectionState.Disconnected, null);
            foreach (var kv in this._pending) kv.Value.TrySetResult(new CommandResult(false, Reason: "not-connected"));
            this._pending.Clear();
            return true;
        }

        private void TeardownSocket()
        {
            lock (this._sync)
            {
                if (this._ws != null)
                {
                    try { this._ws.Abort(); } catch { /* socket may already be gone */ }
                    this._ws.Dispose();
                    this._ws = null;
                }
            }
        }

        private async Task ReceiveLoopAsync(ClientWebSocket ws, CancellationToken ct)
        {
            var buffer = new byte[16 * 1024];
            using var messageStream = new System.IO.MemoryStream();
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                messageStream.SetLength(0);
                WebSocketReceiveResult result;
                do
                {
                    result = await ws.ReceiveAsync(buffer, ct).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    messageStream.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                this.HandleMessage(messageStream.ToArray());
            }
        }

        private void HandleMessage(byte[] raw)
        {
            JsonElement msg;
            try
            {
                using var doc = JsonDocument.Parse(raw);
                msg = doc.RootElement.Clone();
            }
            catch (JsonException)
            {
                return; // malformed frame from a well-behaved server should never happen — ignore rather than crash
            }

            if (!msg.TryGetProperty("type", out var typeEl))
            {
                this._log("debug", "message with no type field — ignored");
                return;
            }
            var type = typeEl.GetString();

            switch (type)
            {
                case "ready":
                {
                    var serverProtocol = msg.TryGetProperty("protocolVersion", out var pv) ? pv.GetInt32() : -1;
                    if (serverProtocol != ProtocolVersion)
                    {
                        this._log("warn", $"protocol mismatch (server={serverProtocol}, plugin={ProtocolVersion}) — disconnecting");
                        lock (this._sync) { try { this._ws?.Abort(); } catch { /* ignore */ } }
                        return;
                    }
                    this._reconnectAttempt = 0;
                    this.SetConnectionStateAndState(ConnectionState.Connected, this.GetLatestState());
                    this._log("info", "authenticated");
                    break;
                }
                case "state":
                {
                    AutoIngestState state = null;
                    if (msg.TryGetProperty("state", out var stateEl) && stateEl.ValueKind != JsonValueKind.Null)
                    {
                        try { state = stateEl.Deserialize<AutoIngestState>(JsonOptions); }
                        catch (JsonException ex) { this._log("warn", $"failed to deserialize state push: {ex.Message}"); }
                    }
                    this.SetConnectionStateAndState(this.GetConnectionState(), state);
                    break;
                }
                case "commandResult":
                {
                    if (!msg.TryGetProperty("requestId", out var reqIdEl)) return;
                    var requestId = reqIdEl.GetString();
                    if (requestId == null || !this._pending.TryRemove(requestId, out var tcs)) return; // already timed out or unsolicited — ignore, never throw
                    CommandResult result;
                    try
                    {
                        result = msg.TryGetProperty("result", out var resultEl)
                            ? resultEl.Deserialize<CommandResult>(JsonOptions)
                            : new CommandResult(false, Reason: "malformed-result");
                    }
                    catch (JsonException)
                    {
                        result = new CommandResult(false, Reason: "malformed-result");
                    }
                    tcs.TrySetResult(result);
                    break;
                }
                case "error":
                {
                    var code = msg.TryGetProperty("code", out var codeEl) ? codeEl.GetString() : "unknown";
                    this._log("warn", $"server error: {code}");
                    if (code is "invalid-token" or "protocol-mismatch" or "already-connected")
                    {
                        lock (this._sync) { try { this._ws?.Abort(); } catch { /* ignore */ } }
                    }
                    break;
                }
                default:
                    this._log("debug", $"unhandled message type: {type}");
                    break;
            }
        }

        private async Task DelayForReconnectAsync(CancellationToken ct)
        {
            // Modest exponential backoff — process discovery ("is AutoIngest
            // running yet/again?"), not application-state polling. Never
            // hammers the descriptor file or a closed socket.
            var attempt = Interlocked.Increment(ref this._reconnectAttempt) - 1;
            var delayMs = Math.Min(ReconnectBaseDelay.TotalMilliseconds * Math.Pow(2, attempt), ReconnectMaxDelay.TotalMilliseconds);
            this._log("debug", $"reconnect scheduled in {delayMs}ms");
            try { await Task.Delay(TimeSpan.FromMilliseconds(delayMs), ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { /* shutdown mid-backoff — normal */ }
        }

        private void SetConnectionStateAndState(ConnectionState connectionState, AutoIngestState state)
        {
            ClientSnapshot snapshot;
            List<Action<ClientSnapshot>> listenersCopy;
            lock (this._sync)
            {
                var changed = this._connectionState != connectionState || !ReferenceEquals(this._latestState, state);
                this._connectionState = connectionState;
                if (connectionState == ConnectionState.Disconnected) this._latestState = null;
                else if (state != null) this._latestState = state;
                if (!changed && state == null) return; // avoid a redundant notify when nothing actually changed
                snapshot = new ClientSnapshot(this._connectionState, this._latestState);
                listenersCopy = new List<Action<ClientSnapshot>>(this._listeners);
            }
            foreach (var listener in listenersCopy)
            {
                try { listener(snapshot); }
                catch (Exception ex) { this._log("error", $"a state listener threw: {ex.Message}"); }
            }
        }
    }
}
