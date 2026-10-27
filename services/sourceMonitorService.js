/**
 * sourceMonitorService.js — the ONE drive/card poller (AI-FEAT-061 Q1, risk R2).
 *
 * Previously main.js owned a setInterval poll that started inside 'splash:complete'
 * (i.e. only once the main window existed) and stopped in 'window-all-closed'. The
 * menu-bar/tray companion needs card status even when the main window is closed, so
 * polling now belongs to the application, not to a window — but there is still only
 * ever ONE poller.
 *
 * Lifecycle is consumer-based: the poller runs while at least one consumer holds it
 * ('main-window', 'companion'). With the companion disabled, the main window is the
 * only consumer and polling starts/stops exactly where it used to.
 *
 * Broadcast contract is unchanged: every poll sends 'drives:updated' (DCIM cards)
 * and 'drives:allUpdated' (removable volumes) to each app window via
 * webContents.send — the same channels, payloads and per-window send call the old
 * loop used (existing live tests intercept exactly that call).
 *
 * In addition, the monitor keeps the latest result and tracks mount instances so
 * subscribers (the companion) get a stable, opaque sourceId per attachment. A volume
 * label is NOT an identity: two cards can both be named "EOS_DIGITAL", and the same
 * card ejected and reinserted is a new attachment.
 */

'use strict';

const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Pure attachment tracker: maps mountpoints to per-attachment ids across polls.
 * @returns {{ update: (cards: Array<{mountpoint: string}>) => Array<object>, reset: () => void }}
 */
function createAttachmentTracker() {
  let _nextId = 1;
  let _byMount = new Map(); // mountpoint -> sourceId (current attachments only)

  function update(cards) {
    const next = new Map();
    const result = [];
    for (const card of cards || []) {
      if (!card || typeof card.mountpoint !== 'string' || !card.mountpoint) continue;
      if (next.has(card.mountpoint)) continue; // one entry per mount
      const sourceId = _byMount.get(card.mountpoint) || `src-${_nextId++}`;
      next.set(card.mountpoint, sourceId);
      result.push({ ...card, sourceId });
    }
    _byMount = next; // detached mounts are forgotten: reinsertion gets a fresh id
    const labelCounts = new Map();
    for (const c of result) labelCounts.set(c.label, (labelCounts.get(c.label) || 0) + 1);
    return result.map(c => ({ ...c, labelCollision: labelCounts.get(c.label) > 1 }));
  }

  function reset() { _byMount = new Map(); }

  return { update, reset };
}

/**
 * @param {object} deps
 * @param {() => Promise<{dcim: Array, removable: Array}>} deps.listDrives
 * @param {() => Array<import('electron').BrowserWindow>} deps.getTargets  windows to broadcast to
 * @param {(msg: string) => void} [deps.log]
 * @param {number} [deps.intervalMs]
 */
function createSourceMonitor({ listDrives, getTargets, log = () => {}, intervalMs = DEFAULT_POLL_INTERVAL_MS }) {
  const _consumers = new Set();
  const _subscribers = new Set();
  const _tracker = createAttachmentTracker();
  let _handle = null;
  let _inFlight = null;
  let _pollCount = 0;
  let _latest = { cards: [], removable: [], polledAt: null };

  function _broadcast(dcim, removable) {
    for (const win of getTargets()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('drives:updated', dcim);
        win.webContents.send('drives:allUpdated', removable);
      }
    }
  }

  async function _pollOnce() {
    try {
      const { dcim, removable } = await listDrives();
      _pollCount++;
      if (dcim.length) {
        dcim.forEach(c => log(`Drive detected: ${c.mountpoint} (${c.label})`));
      }
      _broadcast(dcim, removable);
      _latest = { cards: _tracker.update(dcim), removable, polledAt: new Date().toISOString() };
      for (const fn of _subscribers) {
        try { fn(_latest); } catch (err) { log(`[sourceMonitor] subscriber error: ${err.message}`); }
      }
    } catch (err) {
      console.error('[driveDetector] poll error:', err.message);
    }
  }

  /** Runs one poll now; concurrent callers share the in-flight poll (never two at once). */
  function pollNow() {
    if (!_inFlight) _inFlight = _pollOnce().finally(() => { _inFlight = null; });
    return _inFlight;
  }

  function _start() {
    if (_handle) return;
    _handle = setInterval(() => { pollNow(); }, intervalMs);
  }

  function _stop() {
    if (!_handle) return;
    clearInterval(_handle);
    _handle = null;
    _tracker.reset();
    _latest = { cards: [], removable: [], polledAt: null };
  }

  /**
   * Registers a consumer, (re)starts the interval phase and polls immediately —
   * exactly what the old 'splash:complete' path did (clearInterval + new interval +
   * immediate poll), so a newly created main window sees the same poll timing as
   * before even when the companion already had the poller running. Idempotent per name.
   * @param {string} name
   */
  function acquire(name) {
    if (_consumers.has(name)) return pollNow();
    _consumers.add(name);
    if (_handle) { clearInterval(_handle); _handle = null; }
    _start();
    return pollNow();
  }

  /** @param {string} name — stops the poller once no consumer remains */
  function release(name) {
    _consumers.delete(name);
    if (_consumers.size === 0) _stop();
  }

  /** @param {(latest: object) => void} fn @returns {() => void} unsubscribe */
  function subscribe(fn) {
    _subscribers.add(fn);
    return () => _subscribers.delete(fn);
  }

  function getLatest() { return _latest; }

  function getDiagnostics() {
    return {
      running: !!_handle,
      consumers: [..._consumers].sort(),
      subscriberCount: _subscribers.size,
      pollCount: _pollCount,
    };
  }

  return { acquire, release, subscribe, pollNow, getLatest, getDiagnostics };
}

module.exports = { createSourceMonitor, createAttachmentTracker, DEFAULT_POLL_INTERVAL_MS };
