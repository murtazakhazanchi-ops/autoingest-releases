'use strict';

/**
 * realtimeOperationsService — Advisory realtime client for the main process.
 *
 * Connects to a configured Socket.IO server to share operational awareness
 * across AutoIngest devices. Strictly advisory: never writes event.json,
 * sync manifests, archive folders, metadata files, or any authoritative state.
 *
 * Incoming socket payloads are validated and sanitised before forwarding to
 * the renderer via IPC push. Remote events may only update UI visibility,
 * show suggestions, or refresh advisory dashboard data.
 *
 * Source-of-truth boundary:
 *   Any real local change must still go through existing app flows and
 *   validation — event.json, import transactions, sync manifests remain
 *   authoritative. This service is advisory/live-awareness only.
 */

const { BrowserWindow } = require('electron');
const os      = require('os');
const crypto  = require('crypto');
const settings = require('./settings');

// ── State ─────────────────────────────────────────────────────────────────────
let _socket        = null;
let _status        = 'disabled'; // disabled | not-configured | connecting | connected | offline | reconnecting | auth-failed
let _devicesOnline = 0;
let _operatorName  = null;

// Advisory-only in-memory cache of remotely-visible names (not authoritative).
let _remoteCollections = []; // string[]
let _remoteEvents      = []; // { key, collectionName, eventFolderName, eventDisplayName }[]

// Full advisory registry of collections/events from all connected devices.
// Keyed by registryId. Ephemeral — cleared on service restart.
const _registry = new Map(); // registryId → entry

// Advisory per-device activity state for Team Live. Never written to disk.
const _teamDevices    = new Map(); // deviceId → latest activity payload
const TL_MAX_ACTIVITY = 100;
let   _teamActivity   = []; // bounded array, newest first

// Per-device health snapshots — advisory, cleared on restart.
const _teamDeviceHealth = new Map(); // deviceId → health payload

// Last known sync slot status broadcast by server.
let _lastKnownSlotStatus = null;

// Presence heartbeat timer — keeps this device visible as Online on remote devices
// while the app is open and connected. Cleared on disconnect.
let _presenceTimer = null;

// Last URL and key used in connect() — used to skip a redundant reconnect when
// the socket is already connected with the same credentials.
let _lastConnectUrl = null;
let _lastConnectKey = null;

// Pending sync slot Promise resolver (for requestSyncSlot).
let _pendingSlotResolve = null; // { resolve, reject, jobId, timer }

// Last registry entries emitted by this device — re-sent on socket reconnect.
let _lastRegistryCollEntry = null;
let _lastRegistryEvtEntry  = null;

// Throttle map for outbound import/sync events: key → lastEmitMs
const _throttle   = new Map();
const THROTTLE_MS = 2000;
const MAX_CACHED  = 500;

// ── Internal helpers ──────────────────────────────────────────────────────────

function _send(eventName, payload) {
  if (_socket && _socket.connected) {
    _socket.emit(eventName, payload);
  }
}

function _broadcast(channel, data) {
  const wins = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
  for (const w of wins) w.webContents.send(channel, data);
}

function _setStatus(next) {
  if (_status === next) return;
  _status = next;
  _broadcast('realtime:statusChanged', { status: _status, devicesOnline: _devicesOnline });
}

function _isStr(v) { return typeof v === 'string' && v.length > 0; }

function _sanitiseRegistryEntry(raw) {
  return {
    registryId:          _sanitiseStr(raw.registryId),
    entryType:           _sanitiseStr(raw.entryType)           || 'collection',
    origin:              _sanitiseStr(raw.origin)              || 'remote-created',
    collectionName:      _sanitiseStr(raw.collectionName)      || null,
    eventFolderName:     _sanitiseStr(raw.eventFolderName)     || null,
    eventDisplayName:    _sanitiseStr(raw.eventDisplayName)    || null,
    nasCollectionPath:   _sanitiseStr(raw.nasCollectionPath)   || null,
    nasEventPath:        _sanitiseStr(raw.nasEventPath)        || null,
    eventJsonShell:      (raw.eventJsonShell && typeof raw.eventJsonShell === 'object' && !Array.isArray(raw.eventJsonShell)) ? raw.eventJsonShell : null,
    createdByDeviceId:   _sanitiseStr(raw.createdByDeviceId)   || null,
    createdByDeviceName: _sanitiseStr(raw.createdByDeviceName) || null,
    createdByOperator:   _sanitiseStr(raw.createdByOperator)   || null,
    createdAt:           _sanitiseStr(raw.createdAt)           || null,
    updatedAt:           _sanitiseStr(raw.updatedAt)           || null,
  };
}

function _sanitiseStr(v, max = 512) {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s.length > 0 ? s : null;
}

function _sanitiseDeviceActivity(raw) {
  const VALID_MODES = ['idle', 'importing', 'syncing', 'viewing', 'preparing'];
  const mode       = _sanitiseStr(raw.mode);
  // Normalize identity fields — accept any alias from old or new payload shapes.
  const deviceName = _sanitiseStr(raw.deviceName || raw.deviceDisplayName || raw.hostname || raw.name) || null;
  const userName   = _sanitiseStr(raw.operatorName || raw.userName || raw.activeUserName) || null;
  return {
    deviceId:          _sanitiseStr(raw.deviceId),
    deviceName,
    userName,
    deviceDisplayName: deviceName,  // keep for backward-compat with old renderers
    operatorName:      userName,    // keep for backward-compat
    photographer:      _sanitiseStr(raw.photographer)      || null,
    mode:              VALID_MODES.includes(mode) ? mode : 'idle',
    collectionName:    _sanitiseStr(raw.collectionName)    || null,
    eventFolderName:   _sanitiseStr(raw.eventFolderName)   || null,
    status:            _sanitiseStr(raw.status)            || null,
    progressCurrent:   (typeof raw.progressCurrent === 'number' && raw.progressCurrent >= 0) ? raw.progressCurrent : null,
    progressTotal:     (typeof raw.progressTotal   === 'number' && raw.progressTotal   >= 0) ? raw.progressTotal   : null,
    appVersion:        _sanitiseStr(raw.appVersion || raw.version) || null,
    ts:                _sanitiseStr(raw.ts || raw.timestamp)       || new Date().toISOString(),
  };
}

function _validateIncoming(payload) {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload);
}

function _handleIncoming(eventName, payload) {
  if (!_validateIncoming(payload)) return;

  switch (eventName) {

    case 'device:presence': {
      if (typeof payload.deviceCount === 'number' && payload.deviceCount >= 0) {
        _devicesOnline = Math.min(payload.deviceCount, 9999);
        _broadcast('realtime:statusChanged', { status: _status, devicesOnline: _devicesOnline });
      }
      break;
    }

    case 'collection:visible': {
      const name = _sanitiseStr(payload.collectionName);
      if (!name) return;
      if (!_remoteCollections.includes(name)) {
        _remoteCollections = [..._remoteCollections, name].slice(-MAX_CACHED);
      }
      _broadcast('realtime:event', {
        type:         'collection:visible',
        collectionName: name,
        deviceId:     _sanitiseStr(payload.createdByDeviceId),
        operatorName: _sanitiseStr(payload.createdByOperator),
      });
      break;
    }

    case 'event:visible': {
      const eFolderName = _sanitiseStr(payload.eventFolderName);
      if (!eFolderName) return;
      const cName   = _sanitiseStr(payload.collectionName) || '';
      const display = _sanitiseStr(payload.eventDisplayName) || eFolderName;
      const key     = `${cName}/${eFolderName}`;
      if (!_remoteEvents.find(e => e.key === key)) {
        _remoteEvents = [
          ..._remoteEvents,
          { key, collectionName: cName || null, eventFolderName: eFolderName, eventDisplayName: display },
        ].slice(-MAX_CACHED);
      }
      _broadcast('realtime:event', {
        type:             'event:visible',
        collectionName:   cName || null,
        eventFolderName:  eFolderName,
        eventDisplayName: display,
        deviceId:         _sanitiseStr(payload.createdByDeviceId),
        operatorName:     _sanitiseStr(payload.createdByOperator),
      });
      break;
    }

    case 'import:progress': {
      _broadcast('realtime:event', {
        type:           'import:progress',
        jobId:          _sanitiseStr(payload.jobId),
        collectionName: _sanitiseStr(payload.collectionName),
        status:         _sanitiseStr(payload.status) || 'importing',
        completedFiles: typeof payload.completedFiles === 'number' ? payload.completedFiles : 0,
        totalFiles:     typeof payload.totalFiles     === 'number' ? payload.totalFiles     : 0,
        deviceId:       _sanitiseStr(payload.deviceId),
        operatorName:   _sanitiseStr(payload.operatorName),
      });
      break;
    }

    case 'import:completed': {
      _broadcast('realtime:event', {
        type:           'import:completed',
        jobId:          _sanitiseStr(payload.jobId),
        collectionName: _sanitiseStr(payload.collectionName),
        completedFiles: typeof payload.completedFiles === 'number' ? payload.completedFiles : 0,
        deviceId:       _sanitiseStr(payload.deviceId),
        operatorName:   _sanitiseStr(payload.operatorName),
      });
      break;
    }

    case 'sync:status': {
      _broadcast('realtime:event', {
        type:            'sync:status',
        jobId:           _sanitiseStr(payload.jobId),
        collectionName:  _sanitiseStr(payload.collectionName),
        eventFolderName: _sanitiseStr(payload.eventFolderName),
        status:          _sanitiseStr(payload.status) || 'syncing',
        deviceId:        _sanitiseStr(payload.deviceId),
      });
      break;
    }

    case 'conflict:warning': {
      _broadcast('realtime:event', {
        type:            'conflict:warning',
        collectionName:  _sanitiseStr(payload.collectionName),
        eventFolderName: _sanitiseStr(payload.eventFolderName),
        deviceId:        _sanitiseStr(payload.deviceId),
      });
      break;
    }

    case 'dashboard:update': {
      _broadcast('realtime:event', {
        type:        'dashboard:update',
        deviceCount: typeof payload.deviceCount === 'number' ? payload.deviceCount : 0,
      });
      break;
    }

    case 'registry:register': {
      const id = _sanitiseStr(payload.registryId);
      if (!id) return;
      const entry = _sanitiseRegistryEntry(payload);
      _registry.set(id, entry);
      _broadcast('realtime:registry:entry', entry);
      break;
    }

    case 'registry:snapshot': {
      if (!Array.isArray(payload.entries)) return;
      for (const e of payload.entries.slice(0, MAX_CACHED)) {
        const id = _sanitiseStr(e?.registryId);
        if (!id) continue;
        // Always update — snapshot reflects the server's persisted truth after restart
        _registry.set(id, _sanitiseRegistryEntry(e));
      }
      break;
    }

    case 'device:activity': {
      const act = _sanitiseDeviceActivity(payload);
      if (!act.deviceId) return;
      _teamDevices.set(act.deviceId, act);
      _teamActivity = [act, ..._teamActivity].slice(0, TL_MAX_ACTIVITY);
      _broadcast('realtime:team:update', { type: 'device:activity', ...act });
      break;
    }

    case 'device:activity:snapshot': {
      if (!Array.isArray(payload.activities)) return;
      for (const raw of payload.activities.slice(0, 100)) {
        const act = _sanitiseDeviceActivity(raw || {});
        if (!act.deviceId || _teamDevices.has(act.deviceId)) continue;
        _teamDevices.set(act.deviceId, act);
      }
      _broadcast('realtime:team:update', {
        type:       'device:activity:snapshot',
        activities: Array.from(_teamDevices.values()),
      });
      break;
    }

    case 'device:offline': {
      const id = _sanitiseStr(payload.deviceId);
      if (!id) return;
      _teamDevices.delete(id);
      _teamDeviceHealth.delete(id);
      _broadcast('realtime:team:update', { type: 'device:offline', deviceId: id });
      break;
    }

    case 'device:health': {
      const id = _sanitiseStr(payload.deviceId);
      if (!id) return;
      const health = {
        deviceId:         id,
        appVersion:       _sanitiseStr(payload.appVersion)  || null,
        nasConnected:     payload.nasConnected     === true,
        stagingAvailable: payload.stagingAvailable === true,
        pendingSyncCount: typeof payload.pendingSyncCount === 'number' ? payload.pendingSyncCount : 0,
        failedSyncCount:  typeof payload.failedSyncCount  === 'number' ? payload.failedSyncCount  : 0,
        ts:               _sanitiseStr(payload.ts) || new Date().toISOString(),
      };
      _teamDeviceHealth.set(id, health);
      _broadcast('realtime:team:update', { type: 'device:health', ...health });
      break;
    }

    case 'sync:slot:response': {
      // Response arrives on this socket directly (not broadcast).
      // Two cases: immediate response to requestSyncSlot(), or deferred grant (was queued).
      if (payload.granted) {
        const jobId = _sanitiseStr(payload.jobId);
        if (_pendingSlotResolve) {
          const { resolve, timer } = _pendingSlotResolve;
          clearTimeout(timer);
          _pendingSlotResolve = null;
          resolve({ granted: true, jobId });
        } else {
          // Deferred grant — device was queued; push to renderer so it can proceed.
          _broadcast('realtime:syncSlot:granted', { jobId });
        }
      } else if (payload.queued && _pendingSlotResolve) {
        if (_pendingSlotResolve.batchMode) {
          // Batch mode (waitForSyncSlot): keep the promise open; extend timer to queue lifetime.
          clearTimeout(_pendingSlotResolve.timer);
          const { resolve } = _pendingSlotResolve;
          _pendingSlotResolve.timer = setTimeout(() => {
            _pendingSlotResolve = null;
            resolve({ granted: true, fallback: true, timedOut: true });
          }, 300_000);
        } else {
          // Renderer individual-sync mode: resolve immediately so UI can show waiting state.
          const { resolve, timer } = _pendingSlotResolve;
          clearTimeout(timer);
          _pendingSlotResolve = null;
          resolve({
            granted:  false,
            queued:   true,
            position: typeof payload.position === 'number' ? payload.position : null,
            jobId:    _sanitiseStr(payload.jobId),
          });
        }
      }
      break;
    }

    case 'sync:slot:status': {
      _lastKnownSlotStatus = {
        slots:         Array.isArray(payload.slots) ? payload.slots.slice(0, 10)  : [],
        queue:         Array.isArray(payload.queue) ? payload.queue.slice(0, 20)  : [],
        maxConcurrent: typeof payload.maxConcurrent === 'number' ? payload.maxConcurrent : 1,
      };
      _broadcast('realtime:syncSlot:update', _lastKnownSlotStatus);
      break;
    }

    default: break;
  }
}

// ── Device identity ───────────────────────────────────────────────────────────

function _getDeviceId() {
  let id = settings.getDeviceId();
  if (!id) {
    id = crypto.randomUUID();
    settings.saveDeviceIdSync(id);
  }
  return id;
}

function _buildPresencePayload() {
  const { app } = require('electron');
  return {
    deviceId:     _getDeviceId(),
    deviceName:        settings.getDeviceDisplayName() || os.hostname(),
    deviceDisplayName: settings.getDeviceDisplayName() || os.hostname(), // server reads deviceDisplayName for device:hello
    operatorName:      _operatorName || null,
    appVersion:   app.getVersion(),
    status:       'online',
    timestamp:    new Date().toISOString(),
  };
}

// ── Connection lifecycle ──────────────────────────────────────────────────────

function connect(serverUrl) {
  if (!serverUrl || typeof serverUrl !== 'string') {
    _setStatus('disabled');
    return;
  }

  const currentKey = settings.getRealtimeServerKey() || '';
  if (_socket && _socket.connected && _lastConnectUrl === serverUrl && _lastConnectKey === currentKey) {
    return; // Already connected with same URL and key — no reconnect needed.
  }

  if (_socket) {
    _socket.removeAllListeners();
    _socket.disconnect();
    _socket = null;
  }

  _lastConnectUrl = serverUrl;
  _lastConnectKey = currentKey;

  let io;
  try {
    io = require('socket.io-client');
  } catch (err) {
    console.error('[realtime] socket.io-client not installed:', err.message);
    _setStatus('disabled');
    return;
  }

  _setStatus('connecting');

  _socket = io(serverUrl, {
    auth:                 { serverKey: settings.getRealtimeServerKey() || '' },
    autoConnect:          true,
    reconnection:         true,
    reconnectionDelay:    2000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
    timeout:              10000,
    transports:           ['websocket', 'polling'],
  });

  _socket.on('connect', () => {
    _devicesOnline = 0;
    _setStatus('connected');
    _send('device:hello',            _buildPresencePayload());
    _send('device:presence',         _buildPresencePayload());
    _send('registry:request',        {}); // pull current registry snapshot from server
    _send('device:activity:request', {}); // pull current team activity snapshot from server
    // Re-publish this device's last known registry entries so other devices see them after reconnect
    if (_lastRegistryCollEntry) _send('registry:register', _lastRegistryCollEntry);
    if (_lastRegistryEvtEntry)  _send('registry:register', _lastRegistryEvtEntry);
    // Emit an immediate activity so this device appears in remote snapshots, then
    // keep emitting on a 45 s heartbeat so it stays Online regardless of modal state.
    emitDeviceActivity({ mode: 'idle' });
    if (_presenceTimer) clearInterval(_presenceTimer);
    _presenceTimer = setInterval(() => emitDeviceActivity({ mode: 'idle' }), 45_000);
  });

  _socket.on('disconnect', () => {
    if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
    // Do not overwrite auth-failed — that status was set intentionally and must
    // be visible to the user.  All other disconnect reasons show as offline.
    if (_status !== 'auth-failed') _setStatus('offline');
    // Unblock any batch slot wait that is sitting in the queue — fallback so jobs can proceed.
    if (_pendingSlotResolve) {
      const { resolve, timer } = _pendingSlotResolve;
      clearTimeout(timer);
      _pendingSlotResolve = null;
      resolve({ granted: true, fallback: true });
    }
  });
  _socket.on('connect_error', (err) => {
    if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
    if (err?.message === 'auth-failed') {
      _setStatus('auth-failed');
      // Stop the reconnect loop — a wrong key won't fix itself on retry.
      const s = _socket; _socket = null; s?.disconnect();
    } else {
      _setStatus('offline');
    }
  });
  _socket.on('reconnect_attempt', () => { _setStatus('reconnecting'); });

  const INCOMING_EVENTS = [
    'device:presence',        'collection:visible',       'event:visible',
    'import:progress',        'import:completed',         'sync:status',
    'conflict:warning',       'dashboard:update',
    'registry:register',      'registry:snapshot',
    'device:activity',        'device:activity:snapshot', 'device:offline',
    'device:health',          'sync:slot:response',       'sync:slot:status',
  ];
  for (const ev of INCOMING_EVENTS) {
    _socket.on(ev, (payload) => _handleIncoming(ev, payload));
  }
}

function disconnect(status = 'disabled') {
  if (_socket) {
    _socket.removeAllListeners();
    _socket.disconnect();
    _socket = null;
  }
  _setStatus(status);
}

// ── Public API ────────────────────────────────────────────────────────────────

function init() {
  const enabled = settings.getRealtimeEnabled();
  const url     = settings.getRealtimeServerUrl();
  if (enabled && url) {
    connect(url);
  } else if (enabled) {
    _setStatus('not-configured');
  } else {
    _setStatus('disabled');
  }
}

function shutdown() {
  disconnect();
}

function getStatus() {
  return { status: _status, devicesOnline: _devicesOnline };
}

function getKnownNames() {
  return {
    collections: [..._remoteCollections],
    events:      [..._remoteEvents],
  };
}

function setOperatorName(name) {
  _operatorName = _isStr(name) ? name : null;
}

function emitCollectionVisible({ collectionName, operatorName } = {}) {
  if (!_isStr(collectionName)) return;
  _send('collection:visible', {
    collectionName,
    createdByDeviceId: _getDeviceId(),
    createdByOperator: operatorName || _operatorName || null,
    createdAt:         new Date().toISOString(),
  });
}

function emitEventVisible({ collectionName, eventFolderName, eventDisplayName, operatorName } = {}) {
  if (!_isStr(eventFolderName)) return;
  _send('event:visible', {
    collectionName:    collectionName   || null,
    eventFolderName,
    eventDisplayName:  eventDisplayName || eventFolderName,
    createdByDeviceId: _getDeviceId(),
    createdByOperator: operatorName || _operatorName || null,
    createdAt:         new Date().toISOString(),
  });
}

function emitImportCompleted({ collectionName, eventFolderName, photographer, completedFiles, totalFiles } = {}) {
  _send('import:completed', {
    collectionName:  collectionName  || null,
    eventFolderName: eventFolderName || null,
    photographer:    photographer    || null,
    status:          'completed',
    completedFiles:  completedFiles  || 0,
    totalFiles:      totalFiles      || 0,
    deviceId:        _getDeviceId(),
    operatorName:    _operatorName   || null,
    timestamp:       new Date().toISOString(),
  });
}

function emitSyncStatus({ jobId, collectionName, eventFolderName, photographer, status } = {}) {
  const key      = `sync:${jobId || 'unknown'}`;
  const now      = Date.now();
  // Terminal states always emit immediately; intermediate states are throttled.
  const terminal = status === 'synced' || status === 'sync-failed' || status === 'needs-attention';
  if (!terminal && (now - (_throttle.get(key) || 0)) < THROTTLE_MS) return;
  _throttle.set(key, now);
  _send('sync:status', {
    jobId:           jobId           || null,
    collectionName:  collectionName  || null,
    eventFolderName: eventFolderName || null,
    photographer:    photographer    || null,
    status:          status          || 'syncing',
    deviceId:        _getDeviceId(),
    timestamp:       new Date().toISOString(),
  });
}

function getRegistry() {
  return Array.from(_registry.values());
}

function emitDeviceActivity({ mode, collectionName, eventFolderName, photographer, status, progressCurrent, progressTotal } = {}) {
  const VALID_MODES = ['idle', 'importing', 'syncing', 'viewing', 'preparing'];
  const safeMode = VALID_MODES.includes(mode) ? mode : 'idle';
  const { app } = require('electron');
  _send('device:activity', {
    deviceId:          _getDeviceId(),
    deviceName:        settings.getDeviceDisplayName() || os.hostname(),
    deviceDisplayName: settings.getDeviceDisplayName() || os.hostname(), // backward compat
    userName:          _operatorName || null,
    operatorName:      _operatorName || null, // backward compat
    photographer:      (typeof photographer === 'string' ? photographer : null) || null,
    mode:              safeMode,
    collectionName:    (typeof collectionName === 'string' ? collectionName : null) || null,
    eventFolderName:   (typeof eventFolderName === 'string' ? eventFolderName : null) || null,
    status:            (typeof status === 'string' ? status : null) || null,
    progressCurrent:   (typeof progressCurrent === 'number' && progressCurrent >= 0) ? progressCurrent : null,
    progressTotal:     (typeof progressTotal   === 'number' && progressTotal   >= 0) ? progressTotal   : null,
    appVersion:        app.getVersion(),
    ts:                new Date().toISOString(),
  });
}

function emitDeviceHealth({ nasConnected, stagingAvailable, pendingSyncCount, failedSyncCount } = {}) {
  const { app } = require('electron');
  _send('device:health', {
    deviceId:         _getDeviceId(),
    appVersion:       app.getVersion(),
    nasConnected:     nasConnected     === true,
    stagingAvailable: stagingAvailable === true,
    pendingSyncCount: typeof pendingSyncCount === 'number' ? pendingSyncCount : 0,
    failedSyncCount:  typeof failedSyncCount  === 'number' ? failedSyncCount  : 0,
    ts:               new Date().toISOString(),
  });
}

function requestSyncSlot(jobId) {
  if (!_socket || !_socket.connected) {
    return Promise.resolve({ granted: true, fallback: true });
  }
  // Cancel any in-flight pending slot request.
  if (_pendingSlotResolve) {
    const { reject, timer } = _pendingSlotResolve;
    clearTimeout(timer);
    _pendingSlotResolve = null;
    reject(new Error('superseded'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pendingSlotResolve = null;
      resolve({ granted: true, fallback: true, timedOut: true }); // safety fallback
    }, 10_000);
    _pendingSlotResolve = { resolve, reject, jobId: jobId || null, timer };
    _send('sync:slot:request', { jobId: jobId || null });
  });
}

// waitForSyncSlot: like requestSyncSlot but keeps the Promise open when queued.
// Resolves only when the slot is actually granted, realtime disconnects, or the
// queue lifetime expires. Used by batch operations (syncAllReadyJobs) that must
// not start file copies until coordination is confirmed.
function waitForSyncSlot(jobId) {
  if (!_socket || !_socket.connected) {
    return Promise.resolve({ granted: true, fallback: true });
  }
  if (_pendingSlotResolve) {
    const { reject, timer } = _pendingSlotResolve;
    clearTimeout(timer);
    _pendingSlotResolve = null;
    reject(new Error('superseded'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pendingSlotResolve = null;
      resolve({ granted: true, fallback: true, timedOut: true });
    }, 10_000);
    _pendingSlotResolve = { resolve, reject, jobId: jobId || null, timer, batchMode: true };
    _send('sync:slot:request', { jobId: jobId || null });
  });
}

function releaseSyncSlot(jobId) {
  _send('sync:slot:release', { jobId: jobId || null });
}

function cancelSyncSlot(jobId) {
  if (_pendingSlotResolve) {
    const { reject, timer } = _pendingSlotResolve;
    clearTimeout(timer);
    _pendingSlotResolve = null;
    reject(new Error('cancelled'));
  }
  _send('sync:slot:release', { jobId: jobId || null });
}

function sendSlotHeartbeat(jobId) {
  _send('sync:slot:heartbeat', { jobId: jobId || null });
}

function getSyncSlotStatus() {
  return _lastKnownSlotStatus;
}

function getTeamLiveSnapshot() {
  return {
    devices:        Array.from(_teamDevices.values()),
    deviceHealth:   Array.from(_teamDeviceHealth.values()),
    recentActivity: _teamActivity.slice(0, 100),
    slotStatus:     _lastKnownSlotStatus,
    status:         _status,
  };
}

function emitRegistryCollection({ registryId, collectionName, nasRoot, nasCollectionPath, origin, createdByDeviceName } = {}) {
  if (!_isStr(collectionName)) return;
  const id       = registryId || `coll:${collectionName}`;
  const now      = new Date().toISOString();
  const existing = _registry.get(id);
  const entry = {
    registryId:          id,
    entryType:           'collection',
    origin:              origin || 'remote-created',
    collectionName,
    nasRoot:             nasRoot             || null,
    nasCollectionPath:   nasCollectionPath   || null,
    createdByDeviceId:   _getDeviceId(),
    createdByDeviceName: createdByDeviceName || settings.getDeviceDisplayName() || os.hostname() || null,
    createdByOperator:   _operatorName       || null,
    createdAt:           existing?.createdAt || now,
    updatedAt:           now,
  };
  _registry.set(id, entry);
  _lastRegistryCollEntry = entry;
  _send('registry:register', entry);
}

function emitRegistryEvent({ registryId, collectionName, eventFolderName, eventDisplayName, eventJsonShell, nasCollectionPath, nasEventPath, origin, createdByDeviceName } = {}) {
  if (!_isStr(eventFolderName)) return;
  const cName    = collectionName || '';
  const id       = registryId || `evt:${cName}:${eventFolderName}`;
  const now      = new Date().toISOString();
  const existing = _registry.get(id);
  const entry = {
    registryId:          id,
    entryType:           'event',
    origin:              origin || 'remote-created',
    collectionName:      cName || null,
    eventFolderName,
    eventDisplayName:    eventDisplayName || eventFolderName,
    nasCollectionPath:   nasCollectionPath || null,
    nasEventPath:        nasEventPath      || null,
    eventJsonShell:      eventJsonShell    || null,
    createdByDeviceId:   _getDeviceId(),
    createdByDeviceName: createdByDeviceName || settings.getDeviceDisplayName() || os.hostname() || null,
    createdByOperator:   _operatorName       || null,
    createdAt:           existing?.createdAt || now,
    updatedAt:           now,
  };
  _registry.set(id, entry);
  _lastRegistryEvtEntry = entry;
  _send('registry:register', entry);
}

module.exports = {
  init,
  shutdown,
  connect,
  disconnect,
  getStatus,
  getKnownNames,
  getRegistry,
  getTeamLiveSnapshot,
  getSyncSlotStatus,
  setOperatorName,
  emitCollectionVisible,
  emitEventVisible,
  emitRegistryCollection,
  emitRegistryEvent,
  emitImportCompleted,
  emitSyncStatus,
  emitDeviceActivity,
  emitDeviceHealth,
  requestSyncSlot,
  waitForSyncSlot,
  releaseSyncSlot,
  cancelSyncSlot,
  sendSlotHeartbeat,
};
