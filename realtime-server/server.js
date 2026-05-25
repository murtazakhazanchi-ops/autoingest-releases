/**
 * AutoIngest Realtime Dev Relay Server
 *
 * ADVISORY LAYER ONLY — NOT source of truth for any AutoIngest data.
 * This server relays live operational signals between AutoIngest devices.
 * It does NOT read or write event.json, sync manifests, archive folders,
 * metadata files, or any other authoritative AutoIngest file.
 *
 * Usage:
 *   cd realtime-server && npm install && npm start
 *
 * Default port: 4040 (override with PORT env var)
 */

'use strict';

const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = parseInt(process.env.PORT || '4040', 10);

// In-memory device registry — ephemeral, cleared on restart. Never persisted.
const _devices = new Map(); // socketId → { deviceId, deviceDisplayName, operatorName, connectedAt }

// In-memory collection/event registry — ephemeral, reset on server restart.
// Advisory only — not source of truth for any AutoIngest data.
const _registry = new Map(); // registryId → sanitized entry

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      devicesOnline: _devices.size,
      uptime: Math.floor(process.uptime()),
    }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

// Relay events — all events are broadcast to all OTHER connected clients.
// The server does no validation of business logic; it only sanitises
// against oversized payloads to prevent memory abuse.
const MAX_PAYLOAD_BYTES = 8192;

const RELAY_EVENTS = [
  'device:presence',
  'operator:status',
  'collection:visible',
  'event:visible',
  'import:progress',
  'import:completed',
  'sync:status',
  'sync:completed',
  'conflict:warning',
  'dashboard:update',
];

function _truncateStrings(obj, maxLen = 512) {
  if (typeof obj === 'string') return obj.slice(0, maxLen);
  if (Array.isArray(obj)) return obj.slice(0, 64).map(v => _truncateStrings(v, maxLen));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k.slice(0, 128)] = _truncateStrings(v, maxLen);
    }
    return out;
  }
  return obj;
}

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on('device:hello', (payload) => {
    const safe = _truncateStrings(payload || {});
    _devices.set(socket.id, {
      deviceId: safe.deviceId || socket.id,
      deviceDisplayName: safe.deviceDisplayName || 'Unknown',
      operatorName: safe.operatorName || null,
      connectedAt: Date.now(),
    });
    console.log(`[hello] ${safe.deviceDisplayName || safe.deviceId || socket.id} — devices online: ${_devices.size}`);

    // Broadcast updated device count to all clients
    io.emit('dashboard:update', { devicesOnline: _devices.size });
  });

  // Register relay handlers for all operational events
  for (const eventName of RELAY_EVENTS) {
    socket.on(eventName, (payload) => {
      const raw = JSON.stringify(payload || {});
      if (raw.length > MAX_PAYLOAD_BYTES) {
        console.warn(`[drop] ${eventName} from ${socket.id} — payload too large (${raw.length} bytes)`);
        return;
      }
      const safe = _truncateStrings(payload || {});
      // Relay to all OTHER connected clients
      socket.broadcast.emit(eventName, safe);
    });
  }

  // Registry: store incoming entries and relay to other clients
  socket.on('registry:register', (payload) => {
    if (!payload?.registryId || typeof payload.registryId !== 'string') return;
    const raw = JSON.stringify(payload || {});
    if (raw.length > MAX_PAYLOAD_BYTES) {
      console.warn(`[drop] registry:register from ${socket.id} — payload too large (${raw.length} bytes)`);
      return;
    }
    const safe = _truncateStrings(payload || {});
    _registry.set(safe.registryId, { ...safe, _seenAt: Date.now() });
    socket.broadcast.emit('registry:register', safe);
  });

  // Registry: send current snapshot to requesting client
  socket.on('registry:request', () => {
    const entries = Array.from(_registry.values()).map(({ _seenAt: _, ...rest }) => rest);
    socket.emit('registry:snapshot', { entries });
  });

  socket.on('disconnect', (reason) => {
    const dev = _devices.get(socket.id);
    _devices.delete(socket.id);
    console.log(`[disconnect] ${dev?.deviceDisplayName || socket.id} — reason: ${reason} — devices online: ${_devices.size}`);
    // Broadcast updated device count
    io.emit('dashboard:update', { devicesOnline: _devices.size });
  });
});

httpServer.listen(PORT, () => {
  console.log(`AutoIngest Realtime Dev Server listening on :${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log('ADVISORY ONLY — not source of truth for any AutoIngest data.');
});
