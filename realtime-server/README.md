# AutoIngest Realtime Server

Socket.IO relay server for team coordination (sync-slot negotiation, live activity, device presence).

## First-Run Setup

The realtime server has its own `node_modules` and must be installed separately from the main app:

```bash
cd realtime-server
npm install
node server.js
```

The server starts on **port 4040** by default.

### Health check

```
http://localhost:4040/health
```

Returns `{ ok: true }` when the server is running.

## Starting with npm scripts (from repo root)

```bash
npm run realtime:install   # one-time: installs realtime-server/node_modules
npm run realtime:start     # starts the relay server
```

## Windows: Firewall

On first run, Windows Defender Firewall may prompt to allow `node.exe` on port 4040.
Allow access on **Private networks** only. Do not allow on Public networks.

Alternatively, add a manual inbound rule:
- Protocol: TCP
- Local port: 4040
- Scope: LAN/VPN subnet only (e.g. 192.168.x.x/24)

## Security: LAN / VPN only

**The realtime server has no authentication and uses plain HTTP.**
It is designed for trusted LAN or VPN environments only — all connected devices on
the same network can read and write to the relay.

- Do NOT expose port 4040 to the public internet.
- Do NOT run behind a public reverse proxy without adding authentication and TLS.
- For public or multi-tenant deployment: add token-based auth (e.g. `socket.io` middleware)
  and terminate TLS at a reverse proxy (nginx, Caddy) before shipping.

The app functions normally without the realtime server — it degrades gracefully to
direct archive operations when the relay is unreachable.
