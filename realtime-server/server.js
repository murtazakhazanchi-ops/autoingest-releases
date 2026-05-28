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

const fs   = require('fs');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = parseInt(process.env.PORT || '4040', 10);

// Persistent registry storage — advisory coordination only.
const DATA_DIR      = path.join(__dirname, 'data');
const REGISTRY_PATH = path.join(DATA_DIR, 'registry.json');
const REGISTRY_TMP  = path.join(DATA_DIR, '.registry.tmp');

// In-memory device registry — ephemeral, cleared on restart. Never persisted.
const _devices = new Map(); // socketId → { deviceId, deviceDisplayName, operatorName, connectedAt }

// In-memory collection/event registry — runtime cache, loaded from registry.json on startup.
// Advisory only — not source of truth for any AutoIngest data.
const _registry = new Map(); // registryId → sanitized entry

// In-memory per-device activity — latest known state per socket.
// Advisory only — cleared on server restart or disconnect.
const _deviceActivity = new Map(); // socketId → sanitized activity payload

// ── Sync slot coordination — runtime only, never persisted ────────────────────
// Advisory timing gate: server grants a sync slot to limit concurrent NAS writers.
// The server does NOT validate sync correctness — slot grant is a timing hint only.
const MAX_CONCURRENT_SYNCS = 1;
const SLOT_TIMEOUT_MS      = 90_000;  // drop slot if no heartbeat for 90 s
const QUEUE_TIMEOUT_MS     = 300_000; // drop queued request after 5 min

const _syncSlots     = new Map(); // deviceId → slot info
const _syncSlotQueue = [];        // queued slot requests, in order

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

// ── Server key authentication ─────────────────────────────────────────────────
// Set REALTIME_SERVER_KEY env var before public deployment.
// If unset, the server is open (compatible with local/LAN usage).
const _expectedKey = process.env.REALTIME_SERVER_KEY || null;
if (!_expectedKey) {
  console.warn('[security] REALTIME_SERVER_KEY not set — realtime server is open. Set this variable before public deployment.');
}

io.use((socket, next) => {
  if (!_expectedKey) return next();
  const provided = socket.handshake.auth?.serverKey;
  if (typeof provided === 'string' && provided === _expectedKey) return next();
  next(new Error('auth-failed'));
});

// Relay events — all events are broadcast to all OTHER connected clients.
// The server does no validation of business logic; it only sanitises
// against oversized payloads to prevent memory abuse.
const MAX_PAYLOAD_BYTES = 16384; // registry event entries with full eventJsonShell can reach ~9 KB

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
  'device:health',
];

// ── Sync slot helpers ─────────────────────────────────────────────────────────

function _broadcastSlotStatus() {
  const slots = Array.from(_syncSlots.values()).map(s => ({
    deviceId:        s.deviceId,
    operatorName:    s.operatorName,
    deviceName:      s.deviceName,
    collectionName:  s.collectionName,
    eventFolderName: s.eventFolderName,
    startedAt:       s.startedAt,
  }));
  const queue = _syncSlotQueue.map((r, i) => ({
    deviceId:     r.deviceId,
    operatorName: r.operatorName,
    deviceName:   r.deviceName,
    position:     i + 1,
  }));
  io.emit('sync:slot:status', { slots, queue, maxConcurrent: MAX_CONCURRENT_SYNCS });
}

function _grantNextSlot() {
  const now = Date.now();
  while (_syncSlotQueue.length > 0 && now - _syncSlotQueue[0].requestedAt > QUEUE_TIMEOUT_MS) {
    _syncSlotQueue.shift();
  }
  if (_syncSlots.size >= MAX_CONCURRENT_SYNCS) return;
  if (_syncSlotQueue.length === 0) return;

  const next   = _syncSlotQueue.shift();
  const target = io.sockets.sockets.get(next.socketId);
  if (!target || !target.connected) { _grantNextSlot(); return; } // socket gone — try next

  _syncSlots.set(next.deviceId, { ...next, startedAt: now, lastHeartbeat: now });
  target.emit('sync:slot:response', { granted: true, jobId: next.jobId });
  console.log(`[sync-slot] granted to ${next.deviceName || next.deviceId}`);
}

// Expire stale slots that missed heartbeats (runs every 30 s).
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [deviceId, slot] of _syncSlots) {
    if (now - slot.lastHeartbeat > SLOT_TIMEOUT_MS) {
      _syncSlots.delete(deviceId);
      console.log(`[sync-slot] expired stale slot for ${slot.deviceName || deviceId}`);
      changed = true;
    }
  }
  if (changed) { _grantNextSlot(); _broadcastSlotStatus(); }
}, 30_000);

// ── Registry persistence ──────────────────────────────────────────────────────

const STR_MAX   = 256;
const SHELL_MAX = 8192; // eventJsonShell is an object; limit applied to its JSON serialisation
const VALID_ENTRY_TYPES  = ['collection', 'event'];
const VALID_ENTRY_ORIGINS = ['archive-available', 'remote-created'];

function _s(v) { return typeof v === 'string' ? v.slice(0, STR_MAX).trim() || null : null; }

function _sanitiseRegistryEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const registryId = _s(raw.registryId);
  if (!registryId) return null;

  const entryType = typeof raw.entryType === 'string' ? raw.entryType : null;
  if (!VALID_ENTRY_TYPES.includes(entryType)) return null;

  const collectionName = _s(raw.collectionName);
  if (!collectionName) return null;

  if (entryType === 'event') {
    const eventFolderName = _s(raw.eventFolderName);
    if (!eventFolderName) return null;
  }

  const entry = {
    registryId,
    entryType,
    origin:              VALID_ENTRY_ORIGINS.includes(raw.origin) ? raw.origin : null,
    collectionName,
    nasRoot:             _s(raw.nasRoot),
    nasCollectionPath:   _s(raw.nasCollectionPath),
    createdByDeviceId:   _s(raw.createdByDeviceId),
    createdByDeviceName: _s(raw.createdByDeviceName),
    createdByOperator:   _s(raw.createdByOperator),
    createdAt:           _s(raw.createdAt),
    updatedAt:           _s(raw.updatedAt),
    status:              _s(raw.status),
  };

  if (entryType === 'event') {
    entry.eventFolderName  = _s(raw.eventFolderName);
    entry.eventDisplayName = _s(raw.eventDisplayName);
    entry.nasEventPath     = _s(raw.nasEventPath);
    // eventJsonShell arrives as an object from the Electron app; stored as-is if within size limit
    if (raw.eventJsonShell && typeof raw.eventJsonShell === 'object' && !Array.isArray(raw.eventJsonShell)) {
      const shellStr = JSON.stringify(raw.eventJsonShell);
      entry.eventJsonShell = shellStr.length <= SHELL_MAX ? raw.eventJsonShell : null;
    } else {
      entry.eventJsonShell = null;
    }
  }

  // Strip null fields for a clean snapshot.
  for (const k of Object.keys(entry)) { if (entry[k] === null) delete entry[k]; }

  return entry;
}

function _loadRegistry() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}

  if (!fs.existsSync(REGISTRY_PATH)) {
    console.log('[registry] no persistent registry found — starting empty');
    return;
  }

  try {
    const raw    = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) throw new Error('invalid snapshot shape');
    let count = 0;
    for (const entry of parsed.entries) {
      const clean = _sanitiseRegistryEntry(entry);
      if (clean) { _registry.set(clean.registryId, clean); count++; }
    }
    console.log(`[registry] loaded ${count} entries from registry.json`);
  } catch (err) {
    console.warn(`[registry] warning — corrupt registry.json, starting empty: ${err.message}`);
  }
}

function _saveRegistry() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const entries  = Array.from(_registry.values()).map(({ _seenAt: _, ...rest }) => rest);
    const snapshot = { schemaVersion: 1, updatedAt: Date.now(), entries };
    fs.writeFileSync(REGISTRY_TMP, JSON.stringify(snapshot, null, 2), 'utf8');
    fs.renameSync(REGISTRY_TMP, REGISTRY_PATH);
    console.log(`[registry] persisted ${entries.length} entries`);
  } catch (err) {
    console.warn(`[registry] warning — persistence failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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
    const safe         = _truncateStrings(payload || {});
    const resolvedName = safe.deviceDisplayName || safe.deviceName || safe.hostname || null;
    const resolvedOp   = safe.operatorName || safe.userName || null;
    _devices.set(socket.id, {
      deviceId:          safe.deviceId || socket.id,
      deviceName:        resolvedName,
      deviceDisplayName: resolvedName,
      operatorName:      resolvedOp,
      userName:          resolvedOp,
      connectedAt:       Date.now(),
    });
    console.log(`[hello] ${resolvedName || safe.deviceId || socket.id} op=${resolvedOp || 'none'} — devices online: ${_devices.size}`);

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

  // Registry: store incoming entries, persist, and relay to other clients
  socket.on('registry:register', (payload) => {
    if (!payload?.registryId || typeof payload.registryId !== 'string') return;
    const raw = JSON.stringify(payload || {});
    if (raw.length > MAX_PAYLOAD_BYTES) {
      console.warn(`[drop] registry:register from ${socket.id} — payload too large (${raw.length} bytes)`);
      return;
    }

    const entry = _sanitiseRegistryEntry(payload);
    if (!entry) {
      console.warn(`[drop] registry:register from ${socket.id} — failed sanitisation`);
      return;
    }

    // Preserve createdAt from an existing entry on update; always refresh updatedAt.
    const existing = _registry.get(entry.registryId);
    if (existing?.createdAt && !entry.createdAt) entry.createdAt = existing.createdAt;
    entry.updatedAt = new Date().toISOString();

    _registry.set(entry.registryId, { ...entry, _seenAt: Date.now() });
    _saveRegistry();
    socket.broadcast.emit('registry:register', entry);
  });

  // Registry: send current snapshot to requesting client
  socket.on('registry:request', () => {
    const entries = Array.from(_registry.values()).map(({ _seenAt: _, ...rest }) => rest);
    socket.emit('registry:snapshot', { entries });
  });

  // Device activity: store latest state and relay to other clients
  socket.on('device:activity', (payload) => {
    if (!payload?.deviceId || typeof payload.deviceId !== 'string') return;
    const raw = JSON.stringify(payload || {});
    if (raw.length > MAX_PAYLOAD_BYTES) {
      console.warn(`[drop] device:activity from ${socket.id} — payload too large`);
      return;
    }
    const safe    = _truncateStrings(payload || {});
    // Enrich with registered identity when payload lacks it (handles old/transitional builds)
    const devInfo = _devices.get(socket.id) || {};
    if (!safe.deviceName        && devInfo.deviceName)        safe.deviceName        = devInfo.deviceName;
    if (!safe.deviceDisplayName && devInfo.deviceDisplayName) safe.deviceDisplayName = devInfo.deviceDisplayName;
    if (!safe.operatorName      && devInfo.operatorName)      safe.operatorName      = devInfo.operatorName;
    if (!safe.userName          && devInfo.userName)          safe.userName          = devInfo.userName;
    _deviceActivity.set(socket.id, { ...safe, _socketId: socket.id });
    socket.broadcast.emit('device:activity', safe);
  });

  // Device activity snapshot: send all current device states to requesting client
  socket.on('device:activity:request', () => {
    const activities = Array.from(_deviceActivity.values()).map(({ _socketId: _, ...rest }) => rest);
    socket.emit('device:activity:snapshot', { activities });
  });

  // ── Sync slot coordination ────────────────────────────────────────────────────
  // Advisory timing gate. Server grants a slot to limit concurrent NAS writers.
  // Does NOT validate sync correctness — local sync safety rules still apply.

  socket.on('sync:slot:request', (payload) => {
    const safe       = _truncateStrings(payload || {});
    const deviceInfo = _devices.get(socket.id) || {};
    const deviceId   = deviceInfo.deviceId || socket.id;

    // Clear any existing slot or queue entry for this device before re-requesting.
    _syncSlots.delete(deviceId);
    const qi = _syncSlotQueue.findIndex(r => r.deviceId === deviceId);
    if (qi !== -1) _syncSlotQueue.splice(qi, 1);

    const now = Date.now();
    if (_syncSlots.size < MAX_CONCURRENT_SYNCS) {
      _syncSlots.set(deviceId, {
        deviceId,
        socketId:        socket.id,
        operatorName:    deviceInfo.operatorName    || null,
        deviceName:      deviceInfo.deviceDisplayName || null,
        collectionName:  _s(safe.collectionName),
        eventFolderName: _s(safe.eventFolderName),
        jobId:           _s(safe.jobId),
        startedAt:       now,
        lastHeartbeat:   now,
      });
      socket.emit('sync:slot:response', { granted: true, jobId: safe.jobId });
      console.log(`[sync-slot] granted immediately to ${deviceInfo.deviceDisplayName || deviceId}`);
    } else {
      const position = _syncSlotQueue.length + 1;
      _syncSlotQueue.push({
        deviceId,
        socketId:        socket.id,
        operatorName:    deviceInfo.operatorName    || null,
        deviceName:      deviceInfo.deviceDisplayName || null,
        collectionName:  _s(safe.collectionName),
        eventFolderName: _s(safe.eventFolderName),
        jobId:           _s(safe.jobId),
        requestedAt:     now,
      });
      socket.emit('sync:slot:response', { granted: false, queued: true, position, jobId: safe.jobId });
      console.log(`[sync-slot] queued ${deviceInfo.deviceDisplayName || deviceId} at position ${position}`);
    }
    _broadcastSlotStatus();
  });

  socket.on('sync:slot:heartbeat', () => {
    const deviceInfo = _devices.get(socket.id) || {};
    const deviceId   = deviceInfo.deviceId || socket.id;
    const slot = _syncSlots.get(deviceId);
    if (slot) slot.lastHeartbeat = Date.now();
  });

  socket.on('sync:slot:release', () => {
    const deviceInfo = _devices.get(socket.id) || {};
    const deviceId   = deviceInfo.deviceId || socket.id;
    const hadSlot    = _syncSlots.delete(deviceId);
    const qi = _syncSlotQueue.findIndex(r => r.deviceId === deviceId);
    if (qi !== -1) _syncSlotQueue.splice(qi, 1);
    if (hadSlot) {
      console.log(`[sync-slot] released by ${deviceInfo.deviceDisplayName || deviceId}`);
      _grantNextSlot();
    }
    _broadcastSlotStatus();
  });

  socket.on('disconnect', (reason) => {
    const dev = _devices.get(socket.id);
    const act = _deviceActivity.get(socket.id);
    _devices.delete(socket.id);
    _deviceActivity.delete(socket.id);

    // Release sync slot if held by this socket's device.
    if (act?.deviceId) {
      const hadSlot = _syncSlots.delete(act.deviceId);
      const qi = _syncSlotQueue.findIndex(r => r.deviceId === act.deviceId);
      if (qi !== -1) _syncSlotQueue.splice(qi, 1);
      if (hadSlot) { _grantNextSlot(); _broadcastSlotStatus(); }
    }

    // Notify other clients so they can remove this device from Team Live.
    if (act?.deviceId) {
      socket.broadcast.emit('device:offline', { deviceId: act.deviceId });
    }
    console.log(`[disconnect] ${dev?.deviceDisplayName || socket.id} — reason: ${reason} — devices online: ${_devices.size}`);
    io.emit('dashboard:update', { devicesOnline: _devices.size });
  });
});

_loadRegistry();

httpServer.listen(PORT, () => {
  console.log(`AutoIngest Realtime Dev Server listening on :${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log('ADVISORY ONLY — not source of truth for any AutoIngest data.');
});
