/**
 * renderer.js — UI logic only.
 * Uses window.api (contextBridge). No require(), no Node, no Electron.
 *
 * Performance architecture (this update):
 *  - tileMap: Map<path, HTMLElement> built once per render, used for all O(1) lookups
 *  - Event delegation: ALL tile clicks/changes handled by ONE delegated listener on #fileGrid
 *  - No re-render on: selection toggle, dest change (only class sync), post-import (only class sync)
 *  - Full re-render ONLY on: folder change, sort change, view mode change, initial load
 *  - Scroll listener gates thumbnail work; selection/import stay scroll-independent
 *  - loading="lazy" on all <img> thumbnails
 *  - contain: content on tiles to isolate paint/layout
 */

'use strict';

// ════════════════════════════════════════════════════════════════
// USER FEEDBACK — non-blocking status bar messages
// Replaces alert() for all user-facing notifications.
// ════════════════════════════════════════════════════════════════
let _msgTimer = null;

function showMessage(msg, durationMs = 4000) {
  const el = document.getElementById('statusMessage');
  if (!el) return;
  el.textContent = msg;
  if (_msgTimer) clearTimeout(_msgTimer);
  _msgTimer = setTimeout(() => {
    el.textContent = '';
    _msgTimer = null;
  }, durationMs);
}

/**
 * Show a one-time inline hint banner inside a container element.
 * Guarded by localStorage so it only appears once per key.
 * Auto-fades via CSS animation after ~4.5 s, then removes itself.
 *
 * @param {string} containerId  ID of the element to prepend the hint into
 * @param {string} message      Hint text
 * @param {string} storageKey   localStorage key — set to '1' on first show
 */
function showInlineHint(containerId, message, storageKey) {
  if (localStorage.getItem(storageKey)) return;
  const container = document.getElementById(containerId);
  if (!container) return;
  localStorage.setItem(storageKey, '1');

  const hint = document.createElement('div');
  hint.className = 'inline-hint';
  hint.innerHTML = `<span>💡</span><span>${message}</span>`;
  container.insertAdjacentElement('afterbegin', hint);

  // Remove from DOM after CSS fade animation completes (5 s total)
  setTimeout(() => { if (hint.parentNode) hint.remove(); }, 5000);
}

// ════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════
let activeDrive      = null;
let activeFolderPath = null;

/** Sidebar expansion state — persists across folder navigation, cleared on drive change */
let expandedFolders   = new Set();
let dcimChildrenCache = [];   // DCIM's immediate subfolders (cached so they stay visible)
let cachedDcimPath    = null; // DCIM root path, null until first drive load

// Commit 6 (v0.6.0): folder tree object from files:get. Nested node.
// Batches do NOT mutate this. Populated only on final browseFolder result.
let currentFolderTree = null;

// Commit 7 (v0.6.0): view-mode state. Toggles between the original flat
// media view and the upcoming folder-tree browse view. UI toggle wired in
// Commit 8; rendering dispatch in Commit 9. Default 'media' preserves
// existing behaviour for every pre-Commit-8 code path.
let viewModeType = 'media';  // 'media' | 'folder'

// Tracks what the folder view is currently showing. Populated in Commits 9-11.
// isRoot=true means the folder view should render top-level folder cards;
// isRoot=false means we are inside a specific folder and should render its files.
let currentFolderContext = {
  path:   null,
  files:  [],
  isRoot: true,
};
let selectedFiles    = new Set();   // absolute source paths — selection truth
let currentFiles     = [];          // flat list of all files in current folder
let sortKey          = 'date';
let sortDir          = 'desc';
let destPath         = '';
let importRunning    = false;
let viewMode         = 'icon';
let lastClickedPath  = null;
let fileLoadRequestId = 0;
let showThumbnails    = true;
let isScrolling       = false;
let isShuttingDown    = false;  // true while eject is in progress — blocks all new thumb I/O
let scrollIdleTimer   = null;
let thumbDrainTimer   = null;
let lastThumbDispatch = 0;

/** Dest file cache: lowercase-filename → size */
let destFileCache = new Map();

function getFileKey(file) {
  return file.name.toLowerCase() + '_' + file.size;
}

function isAlreadyImported(file) {
  const key = getFileKey(file);

  // Check destination cache (current folder)
  if (destFileCache && destFileCache.has(key)) {
    return true;
  }

  // Check global index (all previous imports)
  if (globalImportIndex && globalImportIndex[key]) {
    return true;
  }

  return false;
}

/** Collapse state per group — persists across folder navigations, resets on drive change */
let collapsedGroups = { raw: false, photo: false, video: false };

/** True only after the user has explicitly clicked a drive card — gates the loading state. */
let hasSelectedDrive = false;

/** True while a file-fetch IPC call is in-flight for a user-selected folder. */
let isLoadingFiles = false;

/** The folder path currently shown in the file area. null = no folder selected yet. */
let currentFolder = null;

/** Global cross-session import index: lowercaseFilename → sizeBytes */
let globalImportIndex = {};

/**
 * PERF — tileMap: path → DOM element (div.file-tile or tr.file-tile).
 * Built once in renderFileArea(). Used for all single-tile updates.
 * Never iterate querySelectorAll for individual lookups.
 * @type {Map<string, HTMLElement>}
 */
let tileMap = new Map();

// ── View organisation state ────────────────────────────────────────────────────
let pairingEnabled = false;   // Smart Pairing: reorder JPG+RAW pairs adjacent
let timelineMode   = false;   // Timeline: group by date+hour instead of type sections
let cachedPaired   = null;    // sorted (+ optionally paired) flat file array
let cachedTimeline = null;    // Array<[key, files[]]> from groupByTime
let cacheKey       = null;    // generateCacheKey result; null forces rebuild

/**
 * Single IntersectionObserver for viewport-based image loading.
 * Disconnected and recreated on each renderFileArea() call.
 * Never more than one instance alive at a time.
 * @type {IntersectionObserver|null}
 */
let thumbObserver = null;

// ── Thumbnail load-control state ──────────────────────────────────────────────
// Tracks how many getThumb IPC calls are currently awaiting resolution.
// If at MAX_ACTIVE_LOADS, visible/selected requests are deferred into pendingThumbQueue.
// The queue drains automatically each time a load completes.
const MAX_ACTIVE_LOADS = 2;  // max simultaneous in-flight IPC requests
const THUMB_DISPATCH_GAP_MS = 12;
const SCROLL_IDLE_MS = 120;
const THUMB_MAX_RETRIES = 2;    // max retry attempts per image before fallback SVG
const THUMB_RETRY_DELAY_MS = 100;

let activeLoads       = 0;           // current in-flight getThumb calls
let pendingThumbQueue = [];          // Array<() => void> — deferred load starters

/**
 * Monotonically-increasing counter incremented at the top of every
 * renderFileArea() call. Each thumbnail startLoad() closure captures the
 * session value at the moment it was created; the post-await check compares
 * against the current value so any response that arrives after a folder
 * change (new render) is silently discarded instead of writing into the
 * wrong tile or a detached DOM node.
 */
let renderSessionId = 0;

/**
 * Resets thumbnail load-control state.
 * Called at the start of each renderFileArea() so a fresh folder never
 * inherits queued work from the previous one.
 */
function resetThumbLoadState() {
  pendingThumbQueue = [];
  isScrolling = false;
  if (scrollIdleTimer) {
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = null;
  }
  if (thumbDrainTimer) {
    clearTimeout(thumbDrainTimer);
    thumbDrainTimer = null;
  }
}

/**
 * Drains the next pending thumbnail load if a slot is available.
 * Called in the .finally() of every completed getThumb IPC call.
 * Runs synchronously — no timer, no microtask delay.
 */
function drainThumbQueue() {
  // Hard stop during eject — no new file I/O while the drive is being released.
  if (isShuttingDown) return;
  // Only hard-block the queue if we're scrolling AND there's already work in flight.
  // When activeLoads === 0 (nothing loading), allow one load to start even while
  // scrolling so tiles don't stay permanently blank on slow scroll.
  if (isScrolling && activeLoads >= 1) return;
  if (pendingThumbQueue.length === 0) return;
  if (activeLoads >= MAX_ACTIVE_LOADS) return;

  const elapsed = Date.now() - lastThumbDispatch;
  if (elapsed < THUMB_DISPATCH_GAP_MS) {
    scheduleThumbDrain(THUMB_DISPATCH_GAP_MS - elapsed);
    return;
  }

  const next = pendingThumbQueue.shift();
  lastThumbDispatch = Date.now();
  next();   // starts the deferred load immediately, or drops stale work

  if (pendingThumbQueue.length > 0 && activeLoads < MAX_ACTIVE_LOADS) {
    scheduleThumbDrain(THUMB_DISPATCH_GAP_MS);
  }
}

function scheduleThumbDrain(delay = THUMB_DISPATCH_GAP_MS) {
  if (thumbDrainTimer) return;
  thumbDrainTimer = setTimeout(() => {
    thumbDrainTimer = null;
    drainThumbQueue();
  }, delay);
}

// ════════════════════════════════════════════════════════════════
// PAIRING + TIMELINE — display-reordering helpers
// All operations O(n). No DOM access. No nested structures.
// ════════════════════════════════════════════════════════════════
function generateCacheKey(files) {
  return files.length + '-' + (files[0]?.path || '');
}

function resetViewCache() {
  cachedPaired = null;
  cachedTimeline = null;
  cacheKey = null;
}

function pairFiles(files) {
  const map = new Map();
  for (const file of files) {
    const base = file.name.replace(/\.[^/.]+$/, '');
    if (!map.has(base)) map.set(base, { jpg: null, raw: null, others: [] });
    const entry = map.get(base);
    const ext = file.name.split('.').pop().toUpperCase();
    if (ext === 'JPG' || ext === 'JPEG') entry.jpg = file;
    else if (entry.raw === null && (
      ext === 'CR2' || ext === 'CR3' || ext === 'NEF' || ext === 'NRW' ||
      ext === 'ARW' || ext === 'SR2' || ext === 'SRF' || ext === 'DNG' ||
      ext === 'RAF' || ext === 'ORF' || ext === 'RW2' || ext === 'PEF' || ext === 'X3F'
    )) entry.raw = file;
    else entry.others.push(file);
  }
  const result = [];
  for (const entry of map.values()) {
    if (entry.jpg) result.push(entry.jpg);
    if (entry.raw) result.push(entry.raw);
    result.push(...entry.others);
  }
  return result;
}

function groupByTime(files) {
  const groups = new Map();
  for (const file of files) {
    const date = file.modifiedAt ? new Date(file.modifiedAt) : new Date(0);
    const key = date.toDateString() + '-' + date.getHours();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  return Array.from(groups.entries());
}

function isSamePair(a, b) {
  return a.name.replace(/\.[^/.]+$/, '') === b.name.replace(/\.[^/.]+$/, '');
}

/** Sorted + paired flat list, or timeline groups. Cached per folder load. */
function prepareDisplayData(files) {
  const key = generateCacheKey(files);
  if (key !== cacheKey) {
    cacheKey = key;
    const sorted   = sortGroup(files);
    cachedPaired   = pairingEnabled ? pairFiles(sorted) : sorted;
    cachedTimeline = groupByTime(cachedPaired);
  }
  return timelineMode ? cachedTimeline : cachedPaired;
}

// ════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════
const RAW_EXT_SET   = new Set(['.cr2','.cr3','.nef','.nrw','.arw','.sr2','.srf',
                                '.dng','.raf','.orf','.rw2','.pef','.x3f']);
const PHOTO_EXT_SET = new Set(['.jpg','.jpeg','.png','.tiff','.tif']);
const VIDEO_EXT_SET = new Set(['.mp4','.mov']);
const THUMB_EXT_SET = new Set(['.jpg','.jpeg','.png']);

function fileExt(filename) {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i).toLowerCase() : '';
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════
function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatSize(b) {
  if (b == null) return '—';
  if (b < 1024)     return `${b} B`;
  if (b < 1024**2)  return `${(b/1024).toFixed(1)} KB`;
  if (b < 1024**3)  return `${(b/1024**2).toFixed(1)} MB`;
  return `${(b/1024**3).toFixed(2)} GB`;
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}

// ════════════════════════════════════════════════════════════════
// IN-MEMORY LRU THUMBNAIL CACHE
//
// Prevents redundant IPC round-trips to the main process when the
// user scrolls back to already-seen files or switches folders.
//
// Key:   filePath + "|" + fileSize + "|" + lastModified
// Value: the URL string returned by window.api.getThumb()
//
// LRU eviction: a Map preserves insertion order; re-inserting an
// existing key moves it to the end (most-recently-used). When the
// map exceeds MAX_ENTRIES we delete the first (oldest) entry.
// All operations are O(1) — Map.keys().next() for oldest entry.
//
// Sizing: 500 × ~200-char URL ≈ 100 KB worst case. Safe for the
// renderer process even in long sessions with large cards.
// ════════════════════════════════════════════════════════════════
const THUMB_CACHE_MAX = 500;

class LRUThumbCache {
  constructor(maxSize) {
    this._max  = maxSize;
    this._map  = new Map();   // key → url, insertion-order = LRU order
  }

  /** Build the cache key from a file's identity. */
  static key(filePath, fileSize, lastModified) {
    return `${filePath}|${fileSize}|${lastModified}`;
  }

  /**
   * Return the cached URL, or undefined on a miss.
   * A hit promotes the entry to most-recently-used.
   */
  get(k) {
    if (!this._map.has(k)) return undefined;
    const url = this._map.get(k);
    // Promote: delete + re-insert moves the entry to the Map's tail
    this._map.delete(k);
    this._map.set(k, url);
    return url;
  }

  /**
   * Store a URL. Evicts the LRU entry when the cache is full.
   */
  set(k, url) {
    if (this._map.has(k)) this._map.delete(k);   // re-insert at tail
    this._map.set(k, url);
    if (this._map.size > this._max) {
      // Map iterator returns entries in insertion order; first = oldest
      this._map.delete(this._map.keys().next().value);
    }
  }

  /** Return cached URL without promoting to MRU (Patch 47). */
  peek(k) {
    return this._map.get(k);
  }

  /** Current number of cached entries (for debugging). */
  get size() { return this._map.size; }
}

// Module-level singleton — lives for the entire renderer session
const thumbCache = new LRUThumbCache(THUMB_CACHE_MAX);

// ════════════════════════════════════════════════════════════════
// THUMBNAIL BUILDER
// Single element inside .file-thumb — no overlapping layers.
// ════════════════════════════════════════════════════════════════
const SVG_FALLBACK_PHOTO = `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="9" width="34" height="26" rx="3" fill="#89b4fa22" stroke="#89b4fa" stroke-width="1.5"/><rect x="14" y="4" width="12" height="6" rx="2" fill="#89b4fa33" stroke="#89b4fa" stroke-width="1.2"/><circle cx="20" cy="23" r="7" stroke="#89b4fa" stroke-width="1.5"/><circle cx="20" cy="23" r="3.5" stroke="#89b4fa" stroke-width="1.2"/><circle cx="20" cy="23" r="1.2" fill="#89b4fa"/></svg>`;

function thumbHtml(file) {
  const ext   = fileExt(file.name);
  const extUp = ext.slice(1).toUpperCase();

  // Thumbnail-supported files
  if (showThumbnails && (file.type === 'raw' || THUMB_EXT_SET.has(ext))) {

    const cacheKey = LRUThumbCache.key(
      file.path,
      file.size || '',
      file.modifiedAt || ''
    );

    // Patch 48: use peek (no LRU promotion) for read-only access in thumbHtml
    const cachedUrl = thumbCache.peek ? thumbCache.peek(cacheKey) : thumbCache.get(cacheKey);

    return `<img
      class="thumb-img ${cachedUrl ? 'thumb-loaded' : 'lazy-thumb'}"
      data-src="${escapeHtml(file.path)}"
      data-file="${escapeHtml(file.path)}"
      data-size="${file.size}"
      data-modified="${escapeHtml(file.modifiedAt)}"
      ${cachedUrl ? `src="${cachedUrl}" data-loaded="true"` : ''}
      alt="" decoding="async"
    />`;
  }

  // RAW fallback
  if (file.type === 'raw') {
    return `<div>${extUp}</div>`;
  }

  // VIDEO fallback
  if (file.type === 'video') {
    return `<div>VIDEO</div>`;
  }

  // Default fallback
  return SVG_FALLBACK_PHOTO;
}

function shouldLoadThumb(img) {
  const state = img && img.dataset.loaded;
  // Block if already loading or successfully loaded; allow retry/unset
  if (state === 'loading' || state === 'true' || img.src) return false;
  return showThumbnails &&
    img &&
    img.isConnected &&
    !isScrolling &&
    (img.dataset.visible === 'true' || selectedFiles.has(img.dataset.file));
}

function requestThumbForImage(img, priority = false, session = renderSessionId) {
  if (!img || !showThumbnails) return;
  if (isShuttingDown) return;  // eject in progress — no new file I/O
  // Allow retry state — only skip if truly loaded or already loading
  const loadedState = img.dataset.loaded;
  if (loadedState === 'loading' || loadedState === 'true') return;
  if (img.dataset.queued || img.dataset.loaded === 'true') return;
  if (isScrolling && !selectedFiles.has(img.dataset.file)) return;

  // Pre-enqueue identity capture: snapshot the file path NOW, before any async
  // work or queue insertion. startLoad() re-reads this same attribute; if the
  // DOM node has been reused by the time startLoad() runs, the post-await
  // stale-check 3 will catch it. But capturing here also lets us bail out
  // before even setting dataset.queued when the element is already stale.
  const srcPathAtEnqueue = img.dataset.file;
  if (!srcPathAtEnqueue) return;  // disconnected or incomplete element — skip
  // ── EARLY CACHE HIT (PREVENT QUEUEING) ──
  const cacheKey = LRUThumbCache.key(
  img.dataset.file,
  img.dataset.size || '',
  img.dataset.modified || ''
);

  const cachedUrl = thumbCache.get(cacheKey);
if (cachedUrl) {
  img.src = cachedUrl;
  img.dataset.loaded = 'true';
  img.classList.add('thumb-loaded');
  return; // 🚀 STOP — do NOT queue
}
  img.dataset.queued = 'true';

  const retryCount = parseInt(img.dataset.retries || '0', 10);

  const startLoad = () => {
    delete img.dataset.queued;
    if (!img.isConnected) return;
    if (img.dataset.loaded === 'loading' || img.dataset.loaded === 'true') return;
    // Pre-execution identity check: if data-file changed between enqueue and
    // execution (DOM node reused while task sat in pendingThumbQueue), bail out
    // before doing any work — no IPC call, no state mutation.
    if (img.dataset.file !== srcPathAtEnqueue) return;
    if (!shouldLoadThumb(img)) return;

    img.dataset.loaded = 'loading';
    if (thumbObserver) thumbObserver.unobserve(img);

    const srcPath        = img.dataset.file;
    const expectedSrc    = img.dataset.src;
    const sessionAtStart = session;  // captured at queue time, checked post-await

    // ── LRU cache check ───────────────────────────────────────────
    // Build the key from the three identity fields stamped on the img
    // by thumbHtml(). A cache hit skips the IPC round-trip entirely.
    const cacheKey = LRUThumbCache.key(
      srcPath,
      img.dataset.size     || '',
      img.dataset.modified || ''
    );
    const cachedUrl = thumbCache.get(cacheKey);
    if (cachedUrl) {
      img.src = cachedUrl;
      const done = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
      done.then(() => {
        img.dataset.loaded = 'true';
        img.classList.add('thumb-loaded');
      });
      // Cache hit: activeLoads was not incremented, so do not decrement.
      // Still drain the queue so the next pending request gets a slot.
      drainThumbQueue();
      return;
    }

    activeLoads++;
    window.api.getThumb(srcPath)
      .then(url => {
        // Stale-check 1: render session — a new folder was opened while this
        // request was in-flight; discard the result entirely.
        if (sessionAtStart !== renderSessionId) return;
        // Stale-check 2: img identity — tile data-src changed within the session.
        if (img.dataset.src !== expectedSrc) return;
        // Stale-check 3: file identity — data-file was mutated (DOM node reuse);
        // the element now represents a different file, so discard this result.
        if (img.dataset.file !== srcPath) return;
        if (!url) throw new Error('no thumbnail');
        // Store in LRU cache before applying to DOM (Patch 24: skip SVG placeholders)
        if (url && !url.includes('svg+xml')) {
          thumbCache.set(cacheKey, url);
        }
        img.src = url;
        const done = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
        return done.then(() => {
          img.dataset.loaded = 'true';
          img.classList.add('thumb-loaded');
        });
      })
      .catch(() => {
        if (!img.isConnected) return;
        // Session guard in catch: don't mutate state for a dead render.
        if (sessionAtStart !== renderSessionId) return;
        if (img.dataset.src !== expectedSrc) return;
        const attempts = parseInt(img.dataset.retries || '0', 10);
        if (attempts < THUMB_MAX_RETRIES) {
          img.dataset.retries = String(attempts + 1);
          img.dataset.loaded = 'retry';
          // Schedule a retry after a short delay
          setTimeout(() => {
            // DOM containment check first — isConnected can be true for nodes
            // attached to a detached subtree; body.contains confirms the element
            // is still reachable in the live document.
            if (!document.body.contains(img)) return;
            if (!img.isConnected) return;
            if (isShuttingDown) return;          // eject started while retry was pending
            if (sessionAtStart !== renderSessionId) return;  // folder changed
            delete img.dataset.queued;
            img.dataset.loaded = 'retry';
            requestThumbForImage(img, priority, session);
          }, THUMB_RETRY_DELAY_MS);
        } else {
          img.dataset.loaded = 'error';
          img.classList.add('thumb-error');
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG_FALLBACK_PHOTO)}`;
        }
      })
      .finally(() => {
        activeLoads--;
        drainThumbQueue();
      });
  };

  if (activeLoads < MAX_ACTIVE_LOADS) {
    if (priority) pendingThumbQueue.unshift(startLoad);
    else pendingThumbQueue.push(startLoad);
    drainThumbQueue();
  } else {
    if (priority) pendingThumbQueue.unshift(startLoad);
    else pendingThumbQueue.push(startLoad);
    scheduleThumbDrain();
  }
}

function requestThumbForPath(filePath, priority = true) {
  const tile = tileMap.get(filePath);
  const img = tile ? tile.querySelector('img.thumb-img[data-file]') : null;
  requestThumbForImage(img, priority);
  drainThumbQueue();
}

function requestThumbsForPaths(filePaths) {
  if (!showThumbnails) return;
  filePaths.forEach(path => requestThumbForPath(path, true));
}

function requestVisibleAndSelectedThumbs() {
  if (!showThumbnails || isScrolling) return;

  for (const [filePath, tile] of tileMap) {
    const img = tile.querySelector('img.thumb-img[data-file]');
    if (!img) continue;
    if (img.dataset.visible === 'true' || selectedFiles.has(filePath)) {
      requestThumbForImage(img, selectedFiles.has(filePath));
    }
  }

  drainThumbQueue();
}

function handleFileGridScroll() {
  isScrolling = true;
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer);

  scrollIdleTimer = setTimeout(() => {
    isScrolling = false;
    // Idle recovery: retry any stuck thumbnails before requesting visible ones
    recoverStuckThumbs();
    requestVisibleAndSelectedThumbs();
  }, SCROLL_IDLE_MS);
}

let lastRecoveryAt = 0;
const RECOVERY_COOLDOWN_MS = 1500;

/**
 * Scan tileMap for stuck thumbnails. Cooldown prevents over-triggering.
 * Only processes visible or selected tiles (Patch 16).
 */
function recoverStuckThumbs() {
  if (!showThumbnails) return;
  const now = Date.now();
  if (now - lastRecoveryAt < RECOVERY_COOLDOWN_MS) return;
  lastRecoveryAt = now;

  let recovered = 0;
  const MAX_RECOVERIES_PER_PASS = 20;

  for (const [filePath, tile] of tileMap) {
    if (recovered >= MAX_RECOVERIES_PER_PASS) break;
    const img = tile.querySelector('img.thumb-img[data-file]');
    if (!img) continue;
    if (img.dataset.visible !== 'true' && !selectedFiles.has(filePath)) continue;
    const state = img.dataset.loaded;
    if (!state || state === 'retry') {
      delete img.dataset.queued;
      requestThumbForImage(img, false);
      recovered++;
    }
  }
}

// ════════════════════════════════════════════════════════════════
// DESTINATION FILE CACHE
// ════════════════════════════════════════════════════════════════
async function refreshDestCache() {
  if (!destPath) { 
    destFileCache = new Map(); 
    return; 
  }

  try {
    const raw = await window.api.scanDest(destPath);

    destFileCache = new Map(
      Object.entries(raw).map(([n, s]) => {
        const key = getFileKey({ name: n, size: s });
        return [key, true];
      })
    );

  } catch {
    destFileCache = new Map();
  }
}

// ════════════════════════════════════════════════════════════════
// STEP RAIL
// ════════════════════════════════════════════════════════════════
function updateSteps() {
  const hasDrive  = activeDrive !== null;
  const hasFolder = activeFolderPath !== null;
  const hasSel    = selectedFiles.size > 0;
  setStep('step1Indicator', !hasDrive ? 'active' : 'done');
  setStep('step2Indicator', !hasDrive ? '' : (!hasFolder ? 'active' : 'done'));
  setStep('step3Indicator', !hasFolder ? '' : (!hasSel ? 'active' : 'done'));
  setStep('step4Indicator', hasSel ? 'active' : '');
}
function setStep(id, state) {
  const el = document.getElementById(id);
  el.classList.remove('active','done');
  if (state) el.classList.add(state);
}

// ════════════════════════════════════════════════════════════════
// DRIVE SELECTION
// ════════════════════════════════════════════════════════════════
function renderDrives(cards) {
  const container = document.getElementById('driveListLarge');
  document.getElementById('statusDrives').textContent =
    `Drives scanned: ${new Date().toLocaleTimeString()}`;

  // ── Disconnect detection ───────────────────────────────────────
  // If the active drive is no longer in the card list, it was physically removed.
  if (activeDrive) {
    const stillPresent = cards.some(c => c.mountpoint === activeDrive.mountpoint);
    if (!stillPresent) {
      // Patch 35: abort any running import immediately before clearing state
      window.api.abortCopy();
      // Stop any running import gracefully (importRunning flag gates further IPC)
      importRunning = false;
      // Close progress overlay if open
      document.getElementById('progressOverlay').classList.remove('visible');
      showMessage('Card disconnected. Import cancelled.');
      resetAppState();
      return;
    }
  }

  const subtitle = document.getElementById('step1Subtitle');
  if (!cards.length) {
    if (subtitle) subtitle.textContent = 'Insert a camera card to start browsing photos and videos.';
    container.innerHTML = `<div id="noDriveMsg"><span class="msg-icon">🔌</span><span>No memory cards detected. Connect a camera card to begin.</span></div>`;
    return;
  }
  if (subtitle) subtitle.textContent = 'Select a card below to view photos and videos.';
  container.innerHTML = cards.map(c => `
    <div class="drive-card-large"
         data-mountpoint="${escapeHtml(c.mountpoint)}"
         data-label="${escapeHtml(c.label)}">
      <span class="dc-icon">📸</span>
      <span class="dc-label">${escapeHtml(c.label)}</span>
      <span class="dc-path">${escapeHtml(c.mountpoint)}</span>
    </div>`).join('');
  container.querySelectorAll('.drive-card-large').forEach(el =>
    el.addEventListener('click', () =>
      selectDrive({ mountpoint: el.dataset.mountpoint, label: el.dataset.label })));
}

async function selectDrive(drive) {
  if (isShuttingDown) return; // Patch 13: block during eject
  hasSelectedDrive = true;
  isLoadingFiles   = false;  // not loading files — waiting for user to pick a folder
  currentFolder    = null;   // no folder selected yet
  activeDrive = drive; activeFolderPath = null;
  expandedFolders.clear(); dcimChildrenCache = []; cachedDcimPath = null;
  selectedFiles.clear(); currentFiles = []; lastClickedPath = null; tileMap = new Map();
  resetViewCache();
  document.getElementById('step1Panel').style.display = 'none';
  document.getElementById('workspace').classList.add('visible');
  document.getElementById('activeDriveName').textContent = drive.label;
  updateSteps(); updateSelectionBar();
  renderFileArea([]);   // shows "Select a folder to begin"
  document.getElementById('folderList').innerHTML =
    `<div class="sidebar-empty">Loading folders…</div>`;
  await browseFolder(drive.mountpoint, null);  // populates sidebar only
}

document.getElementById('changeDriveBtn').addEventListener('click', () => {
  hasSelectedDrive = false;
  isLoadingFiles   = false;
  currentFolder    = null;
  fileLoadRequestId++;
  activeDrive = null; activeFolderPath = null;
  expandedFolders.clear(); dcimChildrenCache = []; cachedDcimPath = null;
  selectedFiles.clear(); currentFiles = []; lastClickedPath = null; tileMap = new Map();
  resetViewCache();
  document.getElementById('workspace').classList.remove('visible');
  document.getElementById('step1Panel').style.display = '';
  updateSteps(); updateSelectionBar();
});

/**
 * resetAppState — called after eject or device disconnect.
 * Clears all drive/file state and returns UI to the landing screen.
 */
function resetAppState() {
  hasSelectedDrive  = false;
  isLoadingFiles    = false;
  currentFolder     = null;
  fileLoadRequestId++;   // invalidate any in-flight file loads

  activeDrive      = null;
  activeFolderPath = null;
  lastClickedPath  = null;
  importRunning    = false;
  isShuttingDown   = false;  // cleared last — safe to accept a new card
  expandedFolders.clear(); dcimChildrenCache = []; cachedDcimPath = null;

  selectedFiles.clear();
  currentFiles = [];
  destFileCache = new Map();
  resetViewCache();

  // Clear tileMap and disconnect observer
  tileMap = new Map();
  if (thumbObserver) {
    thumbObserver.disconnect();
    thumbObserver = null;
  }
  resetThumbLoadState();

  // Clear DOM
  const fileGrid = document.getElementById('fileGrid');
  fileGrid.onscroll = null;
  fileGrid.className = '';
  fileGrid.innerHTML = '';

  document.getElementById('folderList').innerHTML = '';
  document.getElementById('breadcrumb').textContent = '';

  // Hide workspace, show landing screen
  document.getElementById('workspace').classList.remove('visible');
  document.getElementById('step1Panel').style.display = '';

  updateSteps();
  updateSelectionBar();
}

document.getElementById('ejectBtn').addEventListener('click', async () => {
  if (!activeDrive || isShuttingDown) return;

  const mountpoint = activeDrive.mountpoint;

  // ── Phase 1: stop all thumbnail I/O immediately ───────────────
  // Set the flag first so drainThumbQueue and requestThumbForImage
  // both return early from this point forward.
  isShuttingDown = true;

  // Disconnect the observer — no more intersection callbacks
  if (thumbObserver) {
    thumbObserver.disconnect();
    thumbObserver = null;
  }

  // Drain pending queue and freeze active-load counter.
  // In-flight IPC calls will resolve/reject naturally but their
  // .finally() drainThumbQueue() is now gated and will no-op.
  pendingThumbQueue = [];
  activeLoads = 0;

  // Clear any scheduled drain timers
  if (thumbDrainTimer) { clearTimeout(thumbDrainTimer); thumbDrainTimer = null; }
  if (scrollIdleTimer)  { clearTimeout(scrollIdleTimer);  scrollIdleTimer = null; }

  // ── Phase 2: wait for OS to flush any open file handles ───────
  // 300 ms is enough for in-flight sharp/exifr operations to
  // finish and close their descriptors before the unmount call.
  await new Promise(resolve => setTimeout(resolve, 300));

  // ── Phase 3: eject ────────────────────────────────────────────
  let ejected = false;
  try {
    await window.api.ejectDrive(mountpoint);
    ejected = true;
  } catch {
    ejected = false;
  }

  // ── Phase 4: always reset UI, report outcome ──────────────────
  resetAppState();  // clears isShuttingDown as its last step

  // Patch 14: immediate poll so drive list updates without waiting for next 5s cycle
  try { await window.api.getDrives(); } catch {}

  if (ejected) {
    showMessage('Card safely ejected.');
  } else {
    showMessage('Eject failed. Please remove the card manually.');
  }
});

// ════════════════════════════════════════════════════════════════
// FOLDER SIDEBAR
// ════════════════════════════════════════════════════════════════
function renderFolders(folders, dcimPath) {
  const list = document.getElementById('folderList');

  // Cache DCIM's children on first load or when browsing DCIM directly.
  // When browsing a subfolder (activeFolderPath !== dcimPath), keep the
  // cached list so the sidebar stays expanded.
  if (!cachedDcimPath || activeFolderPath === dcimPath) {
    if (!cachedDcimPath) expandedFolders.add(dcimPath);  // auto-expand on first drive load
    dcimChildrenCache = folders;
    cachedDcimPath    = dcimPath;
  }

  const isExpanded = expandedFolders.has(dcimPath);

  const childrenHtml = isExpanded
    ? dcimChildrenCache.map(f => `
        <div class="folder-item folder-child${activeFolderPath === f.path ? ' active' : ''}"
             data-path="${escapeHtml(f.path)}">
          <span class="fi-icon">📁</span>
          <span class="fi-name">${escapeHtml(f.name)}</span>
        </div>`).join('')
    : '';

  list.innerHTML = `
    <div class="folder-item folder-root${activeFolderPath === dcimPath ? ' active' : ''}"
         data-path="${escapeHtml(dcimPath)}">
      <span class="fi-toggle">${isExpanded ? '▾' : '▸'}</span>
      <span class="fi-icon">📷</span>
      <span class="fi-name">DCIM</span>
    </div>
    ${childrenHtml}`;

  // Toggle arrow: expand/collapse without navigating
  list.querySelector('.fi-toggle').addEventListener('click', e => {
    e.stopPropagation();
    if (expandedFolders.has(dcimPath)) {
      expandedFolders.delete(dcimPath);
    } else {
      expandedFolders.add(dcimPath);
    }
    renderFolders(dcimChildrenCache, dcimPath);
  });

  // Folder row clicks navigate to that folder
  list.querySelectorAll('.folder-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!activeDrive) return;
      browseFolder(activeDrive.mountpoint, item.dataset.path);
    });
  });

  // Scroll active folder into view without jarring jumps
  requestAnimationFrame(() => {
    const activeEl = list.querySelector('.folder-item.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

// ════════════════════════════════════════════════════════════════
// SORT
// ════════════════════════════════════════════════════════════════
function sortGroup(files) {
  const copy = [...files];
  copy.sort((a, b) => {
    let cmp = 0;
    if      (sortKey === 'date') cmp = new Date(a.modifiedAt) - new Date(b.modifiedAt);
    else if (sortKey === 'size') cmp = (a.size ?? 0) - (b.size ?? 0);
    else                         cmp = a.name.localeCompare(b.name, undefined, { sensitivity:'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });
  return copy;
}

function updateSortButtons() {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    const active = btn.dataset.sort === sortKey;
    btn.classList.toggle('sort-active', active);
    const arrow = btn.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
  });
}

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sort;
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = key === 'name' ? 'asc' : 'desc';
    }
    updateSortButtons();
    resetViewCache();
    if (currentFiles.length) renderFileArea(currentFiles);  // legitimate re-render
  });
});

// ════════════════════════════════════════════════════════════════

// ????????????????????????????????????????????????????????????????
// MEDIA / FOLDER VIEW TOGGLE  (Commit 8/14)
// ????????????????????????????????????????????????????????????????
// Flips between the flat media list and the folder-tree view.
// Calls renderCurrentView() which dispatches based on viewModeType.
// In Commit 8 this function is a stub that falls back to renderFileArea;
// Commit 9 implements real dispatch; Commits 10-11 add folder view content.

function renderCurrentView() {
  // Commit 11 (v0.6.0): show folder-view back-bar only when inside a folder.
  const backBar = document.getElementById('folderBackBar');
  const insideFolder = (viewModeType === 'folder') && !currentFolderContext.isRoot;
  if (backBar) {
    backBar.style.display = insideFolder ? 'flex' : 'none';
    if (insideFolder) {
      const pathEl = document.getElementById('folderBackPath');
      if (pathEl) pathEl.textContent = currentFolderContext.path || '';
    }
  }

  // Commit 9 (v0.6.0): dispatch based on viewModeType.
  if (viewModeType === 'media') {
    renderFileArea(currentFiles);
    return;
  }

  // Folder view.
  if (currentFolderContext.isRoot) {
    renderFolderOnly();
    return;
  }

  // Inside a folder: render that folder's files through the existing pipeline.
  renderFileArea(currentFolderContext.files);
}

// Commit 11 (v0.6.0): navigate into a folder node from the pre-built tree.
// Pure in-memory nav; no file I/O, no IPC, no re-scan.
// The node argument can be a folder node from currentFolderTree, or a path string
// that will be looked up inside currentFolderTree.
function enterFolderView(folderPath) {
  if (!currentFolderTree) return;

  // Locate the node by path (DFS over the cached tree).
  const target = findNodeByPath(currentFolderTree, folderPath);
  if (!target) return;

  // Gather every file under this node, sorted newest-first to match Media View ordering.
  const files = collectFilesRecursive(target);
  files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

  currentFolderContext = {
    path:   target.path,
    files:  files,
    isRoot: false,
  };
  // Ensure renderFileArea's empty-state check passes.
  currentFolder = target.path;
  currentFiles  = files;
  // Clear any cached pairing/timeline view so sort applies cleanly to new scope.
  resetViewCache();
  // Reset scroll and re-render through the dispatcher.
  const area = document.getElementById('fileGrid');
  if (area) area.scrollTop = 0;
  renderCurrentView();
  updateSteps();
}

function exitToFolderRoot() {
  currentFolderContext = { path: null, files: [], isRoot: true };
  // When returning to folder root, currentFiles must NOT stay scoped to the
  // subfolder. Restore the whole-card file list from... wait, we don't keep
  // that separately. Recompute from the tree.
  if (currentFolderTree) {
    currentFiles = collectFilesRecursive(currentFolderTree);
    currentFiles.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
  }
  currentFolder = currentFolderTree ? currentFolderTree.path : null;
  resetViewCache();
  renderCurrentView();
  updateSteps();
}

// Pure helper: DFS the tree looking for a node whose path matches.
function findNodeByPath(node, targetPath) {
  if (!node) return null;
  if (node.path === targetPath) return node;
  if (!node.children) return null;
  for (const c of node.children) {
    const found = findNodeByPath(c, targetPath);
    if (found) return found;
  }
  return null;
}

// Pure helper: flatten all files in a subtree.
function collectFilesRecursive(node) {
  const out = [];
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n.files) out.push(...n.files);
    if (n.children) {
      for (const c of n.children) stack.push(c);
    }
  }
  return out;
}

// Commit 10 (v0.6.0): recursively count files (with type breakdown) under a tree node.
// Pure function; no DOM, no I/O. Used for the folder-tile summary labels.
function folderCounts(node) {
  if (!node) return { total: 0, raw: 0, photo: 0, video: 0 };
  let total = 0, raw = 0, photo = 0, video = 0;
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n.files) {
      for (const f of n.files) {
        total++;
        if      (f.type === 'raw')   raw++;
        else if (f.type === 'photo') photo++;
        else if (f.type === 'video') video++;
      }
    }
    if (n.children) {
      for (const c of n.children) stack.push(c);
    }
  }
  return { total, raw, photo, video };
}

function renderFolderOnly() {
  const area = document.getElementById('fileGrid');
  if (!area) return;
  area.onscroll = null;
  area.className = '';

  // No tree yet (card not browsed). Empty state.
  if (!currentFolderTree || !Array.isArray(currentFolderTree.children) || currentFolderTree.children.length === 0) {
    area.innerHTML = '<div class="panel-state"><span class="state-icon">?</span><span>No folders found on this card</span></div>';
    updateSelectionBar();
    return;
  }

  // Build the folder-card grid. Counts are derived from the tree; no I/O.
  const cards = currentFolderTree.children.map(node => {
    const c = folderCounts(node);
    const badges = [
      c.raw   ? '<span class="ft-badge raw">' + c.raw + ' RAW</span>'   : '',
      c.photo ? '<span class="ft-badge">'    + c.photo + ' img</span>' : '',
      c.video ? '<span class="ft-badge vid">' + c.video + ' vid</span>' : '',
    ].filter(Boolean).join('');
    return '<div class="folder-tile" data-path="' + escapeHtml(node.path) + '">'
         +   '<div class="ft-top">'
         +     '<span class="ft-icon">?</span>'
         +     '<span class="ft-name" title="' + escapeHtml(node.name) + '">' + escapeHtml(node.name) + '</span>'
         +   '</div>'
         +   '<div class="ft-meta">' + c.total + ' file' + (c.total !== 1 ? 's' : '') + '</div>'
         +   (badges ? '<div class="ft-badges">' + badges + '</div>' : '')
         + '</div>';
  }).join('');

  area.innerHTML = '<div class="icon-grid">' + cards + '</div>';
  updateSelectionBar();

  // Commit 10 note: folder-tile clicks are intentionally no-op in this commit.
  // Commit 11 wires browseFolder navigation.
}

document.getElementById('viewMediaBtn').addEventListener('click', () => {
  if (viewModeType === 'media') return;
  viewModeType = 'media';
  document.getElementById('viewMediaBtn').classList.add('view-active');
  document.getElementById('viewFolderBtn').classList.remove('view-active');
  renderCurrentView();
});

document.getElementById('viewFolderBtn').addEventListener('click', () => {
  if (viewModeType === 'folder') return;
  viewModeType = 'folder';
  document.getElementById('viewFolderBtn').classList.add('view-active');
  document.getElementById('viewMediaBtn').classList.remove('view-active');
  renderCurrentView();
});
// Commit 11 (v0.6.0): back-button for folder-view drill-down.
(function wireFolderBackButton() {
  const btn = document.getElementById('folderBackBtn');
  if (btn) btn.addEventListener('click', () => exitToFolderRoot());
})();


// VIEW MODE TOGGLE
// ════════════════════════════════════════════════════════════════
document.getElementById('viewIconBtn').addEventListener('click', () => {
  if (viewMode === 'icon') return;  // no-op if already in icon mode
  viewMode = 'icon';
  document.getElementById('viewIconBtn').classList.add('view-active');
  document.getElementById('viewListBtn').classList.remove('view-active');
  if (currentFiles.length) renderFileArea(currentFiles);  // legitimate re-render
});
document.getElementById('viewListBtn').addEventListener('click', () => {
  if (viewMode === 'list') return;  // no-op if already in list mode
  viewMode = 'list';
  document.getElementById('viewListBtn').classList.add('view-active');
  document.getElementById('viewIconBtn').classList.remove('view-active');
  if (currentFiles.length) renderFileArea(currentFiles);  // legitimate re-render
});

document.getElementById('thumbToggleBtn').addEventListener('click', () => {
  showThumbnails = !showThumbnails;
  document.getElementById('thumbToggleBtn').classList.toggle('view-active', showThumbnails);
  resetThumbLoadState();
  if (currentFiles.length) renderFileArea(currentFiles);
});

document.getElementById('timelineViewBtn').addEventListener('click', () => {
  timelineMode = !timelineMode;
  document.getElementById('timelineViewBtn').classList.toggle('view-active', timelineMode);
  resetViewCache();
  if (currentFiles.length) renderFileArea(currentFiles);
});

document.getElementById('pairToggle').addEventListener('change', e => {
  pairingEnabled = e.target.checked;
  resetViewCache();
  if (currentFiles.length) renderFileArea(currentFiles);
});

// ════════════════════════════════════════════════════════════════
// RENDER FILE AREA
// Called ONLY on: folder change, sort change, view change, initial load.
// NEVER called on: scroll, selection toggle, dest change, post-import.
// ════════════════════════════════════════════════════════════════
function renderFileArea(files) {
  // Flush the pending queue FIRST — before the session counter advances and
  // before resetThumbLoadState() runs. Truncating in-place (length = 0) rather
  // than replacing the reference means any drainThumbQueue() call that fires
  // synchronously on this turn of the event loop sees an empty queue immediately.
  pendingThumbQueue.length = 0;

  // Advance the session counter FIRST. Any thumbnail closure that captured an
  // older value will see the mismatch after its await and silently exit.
  renderSessionId++;
  const currentSession = renderSessionId;

  const area = document.getElementById('fileGrid');
  area.onscroll = null;

  // Always clear tileMap before rebuilding
  tileMap = new Map();

  // Disconnect previous observer — ensures never more than one instance alive
  if (thumbObserver) {
    thumbObserver.disconnect();
    thumbObserver = null;
  }

  // Reset queued thumbnail work — in-flight IPCs remain counted until they finish
  resetThumbLoadState();

  if (currentFolder === null) {
    area.className = '';
    area.innerHTML = `<div class="panel-state"><span class="state-icon">📁</span><span>Select a folder to begin</span><span style="font-size:0.75rem;opacity:0.6">Choose DCIM or a subfolder from the left panel</span></div>`;
    updateSelectionBar();
    return;
  }
  if (!files.length) {
    area.className = '';
    area.innerHTML = `<div class="panel-state"><span class="state-icon">📭</span><span>No supported media files found in this folder</span></div>`;
    updateSelectionBar();
    return;
  }

  // Build HTML — all <img> have data-src, no src yet
  area.className = viewMode === 'list' ? 'file-area-list' : '';

  if (timelineMode) {
    area.innerHTML = buildTimelineHtml(prepareDisplayData(files));
  } else if (pairingEnabled) {
    area.innerHTML = buildFlatHtml(prepareDisplayData(files));
  } else {
    const sections = [
      { key:'raw',   label:'RAW Files',   icon:'🟡', files: files.filter(f => f.type === 'raw')   },
      { key:'photo', label:'Image Files', icon:'🔵', files: files.filter(f => f.type === 'photo') },
      { key:'video', label:'Video Files', icon:'🟣', files: files.filter(f => f.type === 'video') },
    ].filter(s => s.files.length > 0);
    area.innerHTML = sections.map(s => buildSectionHtml(s)).join('');
  }

  // Patch 27: create observer BEFORE building tileMap, then do one combined pass

  // Create ONE IntersectionObserver scoped to #fileGrid.
  // root: area          — observe within the scroll container, not the full viewport
  // rootMargin: "200px" — preload near-visible images only
  // threshold: 0        — trigger on the first visible pixel
  thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      entry.target.dataset.visible = entry.isIntersecting ? 'true' : 'false';
    });

    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));

    if (visible.length && !isScrolling) {
      setTimeout(() => {
        if (isScrolling) return;
        visible.forEach(entry => requestThumbForImage(entry.target, false, currentSession));
      }, 0);
    }
  }, {
    root:       area,
    rootMargin: '200px',
    threshold:  0,
  });

  // Build tileMap + observe imgs in one combined pass (Patch 27)
  area.querySelectorAll('.file-tile').forEach(tile => {
    if (tile.dataset.path) tileMap.set(tile.dataset.path, tile);
    const img = tile.querySelector('img.thumb-img[data-file]');
    if (img && !img.dataset.observed) {
      img.dataset.observed = 'true';
      thumbObserver.observe(img);
    }
    if (img && selectedFiles.has(img.dataset.file)) requestThumbForImage(img, true, currentSession);
  });

  area.onscroll = handleFileGridScroll;

  // Note: NO per-tile addEventListener here.
  // ALL tile interaction is handled by the delegated listener below.

  // Patch 31: delegated error listener for image load failures
  area.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('thumb-img')) return;
    if (img.dataset.loaded === 'error') return;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG_FALLBACK_PHOTO)}`;
    img.dataset.loaded = 'error';
    img.classList.add('thumb-error');
  }, true);

  updateSelectionBar();

  // ── Post-render thumbnail recovery ──────────────────────────────────────────
  // Two-pass approach to ensure no visible tile stays blank:
  //
  // Pass 1 (100 ms): IntersectionObserver fires its initial callbacks ~1 frame
  // after observe() is called, but drainThumbQueue may have been blocked by a
  // stale isScrolling flag carried from the previous folder navigation. Running
  // requestVisibleAndSelectedThumbs() here picks up everything the observer
  // flagged as visible before the first user interaction.
  //
  // Pass 2 (400 ms): By now the concurrency queue has had time to drain its
  // first batch. recoverStuckThumbs() rescans for tiles still in no-state or
  // 'retry' — catches anything that lost a race in pass 1 or was queued but
  // dropped due to a transient isScrolling block.
  setTimeout(() => {
    requestVisibleAndSelectedThumbs();
  }, 100);

  setTimeout(() => {
    recoverStuckThumbs();
    requestVisibleAndSelectedThumbs();
  }, 400);
}

// ════════════════════════════════════════════════════════════════
// SECTION + TILE HTML BUILDERS
// Pure string functions — no DOM queries, no listeners.
// ════════════════════════════════════════════════════════════════
function buildSectionHtml({ key, label, icon, files }) {
  const sorted    = sortGroup(files);
  const count     = sorted.length;
  const tilesHtml = viewMode === 'list' ? buildListRowsHtml(sorted) : buildIconTilesHtml(sorted);
  const collapsed = collapsedGroups[key];

  return `<div class="file-section" data-group="${key}">
    <div class="section-header" data-group="${key}">
      <span class="section-toggle" data-group="${key}">${collapsed ? '▶' : '▼'}</span>
      <span class="section-icon">${icon}</span>
      <span class="section-label">${label}</span>
      <span class="section-count">${count} file${count !== 1 ? 's' : ''}</span>
      <button class="sel-group-btn" data-group="${key}">Select All</button>
      <button class="desel-group-btn" data-group="${key}">Deselect All</button>
    </div>
    <div class="section-body${collapsed ? ' collapsed' : ''}">
      ${viewMode === 'list'
        ? `<table class="list-table"><thead><tr>
             <th class="lt-check"></th><th class="lt-thumb"></th>
             <th class="lt-name">Name</th><th class="lt-type">Type</th>
             <th class="lt-size">Size</th><th class="lt-date">Date</th>
           </tr></thead><tbody>${tilesHtml}</tbody></table>`
        : `<div class="icon-grid">${tilesHtml}</div>`}
    </div>
  </div>`;
}

function buildIconTilesHtml(files, enablePairing = false) {
  return files.map((file, i) => {
    const checked  = selectedFiles.has(file.path);
    const imported = isAlreadyImported(file);
    const ext      = fileExt(file.name);
    const extUp    = ext.slice(1).toUpperCase();
    const badgeCls = file.type === 'video' ? 'ext-video' : file.type === 'raw' ? 'ext-raw' : 'ext-photo';
    const base     = file.name.replace(/\.[^/.]+$/, '');
    let pairCls = '';
    if (enablePairing) {
      if (files[i + 1] && isSamePair(file, files[i + 1])) pairCls += ' pair-start';
      if (i > 0 && isSamePair(file, files[i - 1]))        pairCls += ' pair-linked';
    }
    const tileCls  = 'file-tile' + (checked ? ' selected' : '') + (imported ? ' already-imported' : '') + pairCls;
    const dupBadge = imported ? `<div class="dup-overlay-badge">Already Imported</div>` : '';

    return `<div class="${tileCls}" data-path="${escapeHtml(file.path)}" data-size="${file.size}" data-base="${escapeHtml(base)}">
      <input type="checkbox" ${checked ? 'checked' : ''} data-path="${escapeHtml(file.path)}" />
      ${dupBadge}
      <div class="file-thumb">${thumbHtml(file)}</div>
      <div class="file-meta">
        <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
        <div class="file-details">
          <span class="file-ext-badge ${badgeCls}">${extUp}</span>
          <span class="file-size">${formatSize(file.size)}</span>
        </div>
        <div class="file-date">${formatDate(file.modifiedAt)}</div>
      </div>
    </div>`;
  }).join('');
}

function buildListRowsHtml(files, enablePairing = false) {
  return files.map((file, i) => {
    const checked  = selectedFiles.has(file.path);
    const imported = isAlreadyImported(file);
    const ext      = fileExt(file.name);
    const extUp    = ext.slice(1).toUpperCase();
    const badgeCls = file.type === 'video' ? 'ext-video' : file.type === 'raw' ? 'ext-raw' : 'ext-photo';
    const base     = file.name.replace(/\.[^/.]+$/, '');
    let pairCls = '';
    if (enablePairing) {
      if (files[i + 1] && isSamePair(file, files[i + 1])) pairCls += ' pair-start';
      if (i > 0 && isSamePair(file, files[i - 1]))        pairCls += ' pair-linked';
    }
    const rowCls   = 'file-tile' + (checked ? ' selected' : '') + (imported ? ' already-imported' : '') + pairCls;
    const dupLabel = imported ? `<span class="dup-list-badge">✓ Imported</span>` : '';

    return `<tr class="${rowCls}" data-path="${escapeHtml(file.path)}" data-size="${file.size}" data-base="${escapeHtml(base)}">
      <td class="lt-check"><input type="checkbox" ${checked ? 'checked' : ''} data-path="${escapeHtml(file.path)}" /></td>
      <td class="lt-thumb"><div class="list-thumb">${thumbHtml(file)}</div></td>
      <td class="lt-name"><span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>${dupLabel}</td>
      <td class="lt-type"><span class="file-ext-badge ${badgeCls}">${extUp}</span></td>
      <td class="lt-size">${formatSize(file.size)}</td>
      <td class="lt-date">${formatDate(file.modifiedAt)}</td>
    </tr>`;
  }).join('');
}

/** Flat list of all files — no section headers. Used when pairingEnabled. */
function buildFlatHtml(files) {
  const tilesHtml = viewMode === 'list'
    ? buildListRowsHtml(files, true)
    : buildIconTilesHtml(files, true);
  return viewMode === 'list'
    ? `<table class="list-table"><thead><tr>
         <th class="lt-check"></th><th class="lt-thumb"></th>
         <th class="lt-name">Name</th><th class="lt-type">Type</th>
         <th class="lt-size">Size</th><th class="lt-date">Date</th>
       </tr></thead><tbody>${tilesHtml}</tbody></table>`
    : `<div class="icon-grid">${tilesHtml}</div>`;
}

/** Timeline view — groups of date+hour with sticky headers. */
function buildTimelineHtml(groups) {
  if (!groups.length) return '';
  return groups.map(([key, files]) => {
    const lastDash = key.lastIndexOf('-');
    const datePart = key.slice(0, lastDash);
    const hour     = parseInt(key.slice(lastDash + 1), 10);
    const label    = `${datePart}  ·  ${String(hour).padStart(2, '0')}:00`;
    const tilesHtml = viewMode === 'list'
      ? buildListRowsHtml(files, pairingEnabled)
      : buildIconTilesHtml(files, pairingEnabled);
    return `<div class="timeline-group">
      <div class="timeline-header">
        <span class="timeline-icon">🕐</span>
        <span class="timeline-label">${escapeHtml(label)}</span>
        <span class="section-count">${files.length} file${files.length !== 1 ? 's' : ''}</span>
      </div>
      ${viewMode === 'list'
        ? `<table class="list-table"><thead><tr>
             <th class="lt-check"></th><th class="lt-thumb"></th>
             <th class="lt-name">Name</th><th class="lt-type">Type</th>
             <th class="lt-size">Size</th><th class="lt-date">Date</th>
           </tr></thead><tbody>${tilesHtml}</tbody></table>`
        : `<div class="icon-grid">${tilesHtml}</div>`}
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════
// EVENT DELEGATION — ONE listener for ALL tile interactions
//
// This replaces attaching individual listeners to every tile.
// The listener lives on #fileGrid and never needs to be re-attached.
// It handles: tile click, checkbox change, group select-all button.
// ════════════════════════════════════════════════════════════════
document.getElementById('fileGrid').addEventListener('click', e => {
  // ── Section collapse toggle ────────────────────────────────────
  const toggle = e.target.closest('.section-toggle');
  if (toggle) {
    const group   = toggle.dataset.group;
    collapsedGroups[group] = !collapsedGroups[group];
    const section = toggle.closest('.file-section');
    const body    = section.querySelector('.section-body');
    body.classList.toggle('collapsed', collapsedGroups[group]);
    toggle.textContent = collapsedGroups[group] ? '▶' : '▼';
    return;
  }

  // ── Group "Select All" button ──────────────────────────────────
  const groupBtn = e.target.closest('.sel-group-btn');
  if (groupBtn) {
    const group = groupBtn.dataset.group;
    const paths = currentFiles.filter(f => f.type === group).map(f => f.path);
    paths.forEach(path => selectedFiles.add(path));
    syncAllTiles();
    requestThumbsForPaths(paths);
    updateSelectionBar();
    updateSteps();
    return;
  }

  // ── Group "Deselect All" button ────────────────────────────────
  const deselBtn = e.target.closest('.desel-group-btn');
  if (deselBtn) {
    const group = deselBtn.dataset.group;
    currentFiles.filter(f => f.type === group).forEach(f => selectedFiles.delete(f.path));
    syncAllTiles();
    updateSelectionBar();
    updateSteps();
    return;
  }

  // ── Checkbox click — handled by the change event below, skip here ──
  if (e.target.type === 'checkbox') return;

  // ?? Folder-tile click (Commit 11) ?????????????????????????????
  const folderTile = e.target.closest('.folder-tile');
  if (folderTile && folderTile.dataset.path) {
    enterFolderView(folderTile.dataset.path);
    return;
  }

  // ── Tile click (anywhere on tile except checkbox) ──────────────
  const tile = e.target.closest('.file-tile');
  if (!tile || !tile.dataset.path) return;
  handleTileClick(tile.dataset.path, e.shiftKey);
});

// Separate delegated listener for checkbox change events
document.getElementById('fileGrid').addEventListener('change', e => {
  if (e.target.type !== 'checkbox') return;
  const path = e.target.dataset.path;
  if (!path) return;
  handleTileClick(path, false);
  // Restore checkbox visual state to match selectedFiles (handleTileClick already syncs)
});

// ════════════════════════════════════════════════════════════════
// SELECTION — O(1) tile updates via tileMap
// ════════════════════════════════════════════════════════════════

/**
 * Returns file paths in rendered order — matches the visual layout.
 * Used for shift-click range calculation. Pure computation, no DOM.
 */
function getRenderedPathOrder() {
  if (timelineMode || pairingEnabled) {
    const data = prepareDisplayData(currentFiles);
    if (timelineMode) {
      // data is Array<[key, files[]]>
      return data.flatMap(([, files]) => files.map(f => f.path));
    }
    // pairingEnabled: data is flat paired array
    return data.map(f => f.path);
  }
  // Existing section order (RAW → Photo → Video, sorted within each)
  return ['raw','photo','video'].flatMap(type =>
    sortGroup(currentFiles.filter(f => f.type === type)).map(f => f.path)
  );
}

function handleTileClick(filePath, shiftKey) {
  if (shiftKey && lastClickedPath && lastClickedPath !== filePath) {
    const order = getRenderedPathOrder();
    const a = order.indexOf(lastClickedPath);
    const b = order.indexOf(filePath);
    if (a !== -1 && b !== -1) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const paths = order.slice(lo, hi + 1);
      paths.forEach(path => selectedFiles.add(path));
      syncAllTiles();
      requestThumbsForPaths(paths);
      updateSelectionBar();
      updateSteps();
      return;
    }
  }

  // Normal toggle
  if (selectedFiles.has(filePath)) {
    selectedFiles.delete(filePath);
  } else {
    selectedFiles.add(filePath);
    requestThumbForPath(filePath, true);
  }
  lastClickedPath = filePath;

  // O(1) single-tile sync via tileMap
  syncOneTile(filePath);
  updateSelectionBar();
  updateSteps();
}

/**
 * PERF — O(1) single-tile update via tileMap.
 * No DOM scan. No querySelectorAll.
 */
function syncOneTile(filePath) {
  const tile = tileMap.get(filePath);
  if (!tile) return;
  const checked = selectedFiles.has(filePath);
  tile.classList.toggle('selected', checked);
  const cb = tile.querySelector('input[type="checkbox"]');
  if (cb) cb.checked = checked;
  syncPairLinks();
}

/**
 * PERF — Bulk sync using tileMap.values() instead of querySelectorAll.
 * Used for Select All, Clear, Cmd+A, shift-range, group select.
 */
function syncAllTiles() {
  for (const [path, tile] of tileMap) {
    const checked = selectedFiles.has(path);
    tile.classList.toggle('selected', checked);
    const cb = tile.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = checked;
  }
  syncPairLinks();
}

/**
 * Update selected-linked highlight on paired tiles.
 * O(n) — two passes over tileMap. Called after any selection change
 * when pairingEnabled. No-op when pairing is off.
 */
function syncPairLinks() {
  if (!pairingEnabled) return;
  // Pass 1: which base names have at least one selected tile?
  const baseSelected = new Map();
  for (const [path, tile] of tileMap) {
    const base = tile.dataset.base;
    if (!base) continue;
    if (selectedFiles.has(path)) baseSelected.set(base, true);
    else if (!baseSelected.has(base)) baseSelected.set(base, false);
  }
  // Pass 2: mark unselected tiles whose pair IS selected
  for (const [path, tile] of tileMap) {
    const base = tile.dataset.base;
    if (!base) continue;
    tile.classList.toggle('selected-linked',
      !selectedFiles.has(path) && baseSelected.get(base) === true
    );
  }
}

// ════════════════════════════════════════════════════════════════
// GLOBAL SELECT ALL / CLEAR
// ════════════════════════════════════════════════════════════════
document.getElementById('selectAllBtn').addEventListener('click', () => {
  const paths = currentFiles.map(f => f.path);
  paths.forEach(path => selectedFiles.add(path));
  syncAllTiles();
  requestThumbsForPaths(paths);
  updateSelectionBar();
  updateSteps();
});

document.getElementById('clearSelBtn').addEventListener('click', () => {
  selectedFiles.clear();
  lastClickedPath = null;
  syncAllTiles();
  updateSelectionBar();
  updateSteps();
});

// ════════════════════════════════════════════════════════════════
// Cmd/Ctrl+A keyboard shortcut
// ════════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== 'a') return;
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (!currentFiles.length) return;
  e.preventDefault();
  const paths = currentFiles.map(f => f.path);
  paths.forEach(path => selectedFiles.add(path));
  syncAllTiles();
  requestThumbsForPaths(paths);
  updateSelectionBar();
  updateSteps();
});

// ════════════════════════════════════════════════════════════════
// SELECTION BAR STATE
// ════════════════════════════════════════════════════════════════
function updateSelectionBar() {
  const hasFiles = currentFiles.length > 0;
  const n        = selectedFiles.size;

  document.getElementById('selectionBar').classList.toggle('visible', hasFiles);
  document.getElementById('selCount').textContent = `${n} selected`;

  document.getElementById('selectAllBtn').disabled = !hasFiles || n === currentFiles.length;
  document.getElementById('clearSelBtn').disabled  = n === 0;

  const importBtn = document.getElementById('importBtn');
  importBtn.classList.toggle('visible', n > 0);
  importBtn.disabled = n === 0 || importRunning;
}

// ════════════════════════════════════════════════════════════════
// BROWSE
// ════════════════════════════════════════════════════════════════
function updateFileStatus(files, processed = null, total = null) {
  // Commit 6: folder count comes from currentFolderTree (top-level children).
  const folderCount = (currentFolderTree && Array.isArray(currentFolderTree.children))
    ? currentFolderTree.children.length : 0;
  const raw   = files.filter(f => f.type === 'raw').length;
  const photo = files.filter(f => f.type === 'photo').length;
  const video = files.filter(f => f.type === 'video').length;
  const loading = total !== null && processed !== null && processed < total;

  document.getElementById('statusFiles').textContent =
    files.length + ' files' +
    (raw   ? ' \u00b7 ' + raw + ' RAW'   : '') +
    (photo ? ' \u00b7 ' + photo + ' img' : '') +
    (video ? ' \u00b7 ' + video + ' vid' : '') +
    ' \u00b7 ' + folderCount + ' folder' + (folderCount !== 1 ? 's' : '') +
    (loading ? ' \u00b7 loading ' + processed + '/' + total : '');
}

function applyFileBatch(batch) {
  if (batch.requestId !== fileLoadRequestId) return;

  document.getElementById('breadcrumb').textContent = batch.folderPath;
  activeFolderPath = batch.folderPath;
  // Commit 6: batches pass folders=null (no tree change). Sidebar only updates on final result.
  if (batch.folders !== null && batch.folders !== undefined) {
    const list = Array.isArray(batch.folders)
      ? batch.folders
      : (batch.folders && batch.folders.children ? batch.folders.children : []);
    renderFolders(list, batch.dcimPath);
  }

  const seen = new Set(currentFiles.map(f => f.path));
  batch.files.forEach(file => {
    if (!seen.has(file.path)) {
      seen.add(file.path);
      currentFiles.push(file);
    }
  });

  renderFileArea(currentFiles);
  updateSelectionBar();
  updateSortButtons();
  updateSteps();
  updateFileStatus(currentFiles, batch.processed, batch.total);
}

async function browseFolder(drivePath, folderPath) {
  const requestId = ++fileLoadRequestId;
  activeFolderPath = folderPath;
  selectedFiles.clear(); currentFiles = []; lastClickedPath = null;
  resetViewCache();

  // Commit 3 (v0.6.0): folderPath === null is now a valid user-visible browse.
  // selectDrive calls browseFolder(drive, null) which triggers a full-card recursive scan;
  // the resulting file list must be rendered. Treat every browseFolder call as user-facing.
  const isUserFolderSelection = true;
  currentFolder = folderPath || drivePath;

  updateSelectionBar(); updateSteps();

  try {
    const result = await window.api.getFiles(drivePath, folderPath, requestId);
    if (requestId !== fileLoadRequestId) return;

    document.getElementById('breadcrumb').textContent = result.folderPath;
    activeFolderPath = result.folderPath;
    // Commit 6b: preserve root tree across subfolder browses.
    // Only overwrite currentFolderTree on a root browse (folderPath === null).
    // Subfolder browses return a scoped tree we intentionally ignore here so the
    // sidebar + folder-count remain anchored to the whole-card view.
    if (folderPath === null) {
      currentFolderTree = (result.folders && typeof result.folders === 'object' && !Array.isArray(result.folders))
        ? result.folders : null;
    }
    // Sidebar always renders the root tree's top-level children.
    const sidebarFolders = currentFolderTree
      ? currentFolderTree.children
      : (Array.isArray(result.folders) ? result.folders : []);
    renderFolders(sidebarFolders, result.dcimPath);
    document.querySelectorAll('.folder-item').forEach(item =>
      item.classList.toggle('active', item.dataset.path === result.folderPath));

    if (isUserFolderSelection) {
      currentFolder = result.folderPath;
    }

    const progressiveComplete =
      currentFiles.length === result.files.length &&
      result.files.every(file => tileMap.has(file.path));

    currentFiles = result.files;
    await refreshDestCache();
    if (progressiveComplete) {
      syncImportedBadges();
    } else if (isUserFolderSelection) {
      renderFileArea(currentFiles);
    }
    updateSelectionBar(); updateSortButtons(); updateSteps();
    updateFileStatus(currentFiles);

  } catch (err) {
    if (requestId !== fileLoadRequestId) return;
    document.getElementById('folderList').innerHTML =
      `<div class="sidebar-empty">⚠️ ${escapeHtml(err.message)}</div>`;
    document.getElementById('fileGrid').innerHTML =
      `<div class="panel-state"><span class="state-icon">⚠️</span><span>${escapeHtml(err.message)}</span></div>`;
  }
}

// ════════════════════════════════════════════════════════════════
// DESTINATION
// Dest change: refresh cache, then sync imported badges in-place.
// NO full re-render. Scroll position preserved.
// ════════════════════════════════════════════════════════════════
async function setDestPath(p) {
  destPath = p;
  document.getElementById('destPath').textContent = p;

  await refreshDestCache();
  try { globalImportIndex = await window.api.getImportIndex() || {}; } catch { /* non-critical */ }

  // Re-render files so badges update correctly
  renderFileArea(currentFiles);
}

/**
 * Update .already-imported classes and dup badges in-place.
 * Uses tileMap for O(1) tile access. No DOM scan. No scroll reset.
 */
function syncImportedBadges() {
  // Build O(1) lookup from path → file object once, not inside the loop
  const fileByPath = new Map(currentFiles.map(f => [f.path, f]));

  for (const [path, tile] of tileMap) {
    const file = fileByPath.get(path);
    if (!file) continue;
    const imported = isAlreadyImported(file);
    tile.classList.toggle('already-imported', imported);

    // Update or add/remove the dup-overlay-badge (icon view)
    if (viewMode === 'icon') {
      let badge = tile.querySelector('.dup-overlay-badge');
      if (imported && !badge) {
        badge = document.createElement('div');
        badge.className = 'dup-overlay-badge';
        badge.textContent = 'Already Imported';
        tile.insertBefore(badge, tile.firstChild);
      } else if (!imported && badge) {
        badge.remove();
      }
    }

    // Update dup-list-badge (list view)
    if (viewMode === 'list') {
      const nameCell = tile.querySelector('.lt-name');
      if (!nameCell) continue;
      let badge = nameCell.querySelector('.dup-list-badge');
      if (imported && !badge) {
        badge = document.createElement('span');
        badge.className = 'dup-list-badge';
        badge.textContent = '✓ Imported';
        nameCell.appendChild(badge);
      } else if (!imported && badge) {
        badge.remove();
      }
    }
  }
}

// Dest path is now initialised inside initApp() after the import index loads.

// Show beta version label in status bar
try {
  const ver = window.api.getVersion();
  const el  = document.getElementById('appVersion');
  if (el) el.textContent = `AutoIngest Beta v${ver}`;
} catch { /* non-critical — version label is informational only */ }

document.getElementById('changeDestBtn').addEventListener('click', async () => {
  const chosen = await window.api.chooseDest();
  if (chosen) await setDestPath(chosen);
});

// ════════════════════════════════════════════════════════════════
// PRE-IMPORT DUPLICATE DETECTION
// ════════════════════════════════════════════════════════════════
function detectDuplicates(filePaths) {
  const sizeMap    = new Map(currentFiles.map(f => [f.path, f.size]));
  const duplicates = [], clean = [];
  for (const p of filePaths) {
    const filename = p.replace(/\\/g,'/').split('/').pop();
    const size     = sizeMap.get(p);
    if (size !== undefined && destFileCache.has(filename.toLowerCase() + '_' + size)) {
      duplicates.push(p);
    } else {
      clean.push(p);
    }
  }
  return { duplicates, clean };
}

function showDupWarning(duplicates, total) {
  return new Promise(resolve => {
    const overlay = document.getElementById('dupWarningOverlay');
    document.getElementById('dupCount').textContent = duplicates.length;
    document.getElementById('dupTotal').textContent = total;
    const preview = duplicates.slice(0,5).map(p => p.replace(/\\/g,'/').split('/').pop());
    const el = document.getElementById('dupFileList');
    el.innerHTML = preview.map(n => `<div class="dup-file-row">↩ ${escapeHtml(n)}</div>`).join('');
    if (duplicates.length > 5)
      el.innerHTML += `<div class="dup-file-row dup-more">…and ${duplicates.length-5} more</div>`;
    overlay.classList.add('visible');

    function close(r) {
      overlay.classList.remove('visible');
      document.getElementById('dupSkipBtn').removeEventListener('click', onSkip);
      document.getElementById('dupImportAllBtn').removeEventListener('click', onAll);
      document.getElementById('dupCancelBtn').removeEventListener('click', onCancel);
      resolve(r);
    }
    const onSkip   = () => close('skip');
    const onAll    = () => close('import-all');
    const onCancel = () => close('cancel');
    document.getElementById('dupSkipBtn').addEventListener('click', onSkip, { once: true });
    document.getElementById('dupImportAllBtn').addEventListener('click', onAll, { once: true });
    document.getElementById('dupCancelBtn').addEventListener('click', onCancel, { once: true });
  });
}

// ════════════════════════════════════════════════════════════════
// IMPORT
// ════════════════════════════════════════════════════════════════
function formatETA(seconds) {
  if (seconds === null || seconds === undefined || !isFinite(seconds) || seconds < 0) return 'Calculating…';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s remaining`;
  return `${mins}m ${secs}s remaining`;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m === 0 ? `${r}s` : `${m}m ${r}s`;
}

function formatSpeed(bps) {
  if (!bps || bps <= 0) return '';
  const mbps = bps / (1024 * 1024);
  return mbps >= 1 ? `${mbps.toFixed(1)} MB/s` : `${(bps / 1024).toFixed(0)} KB/s`;
}

function showProgress() {
  document.getElementById('progressOverlay').classList.add('visible');
  document.getElementById('progressSummary').classList.remove('visible');
  document.getElementById('progressDoneBtn').classList.remove('visible');
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressCount').textContent = '0 / 0';
  document.getElementById('progressFilename').textContent = 'Preparing…';
  document.getElementById('progressEta').textContent = '';
  document.getElementById('progressSkipDetails').innerHTML = '';
  document.getElementById('progressSkipDetails').style.display = 'none';
  // Reset pause/resume buttons
  document.getElementById('progressPauseBtn').style.display = '';
  document.getElementById('progressResumeBtn').style.display = 'none';
}

function updateProgress({ total, index, completedCount, filename, status, skipReason, error, eta, speedBps }) {
  // Use completedCount for the bar when available (concurrent mode); fall back to index
  const done = (completedCount !== undefined) ? completedCount : index;
  const pct  = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('progressFill').style.width  = `${pct}%`;
  document.getElementById('progressCount').textContent = `${done} / ${total}`;

  if (eta !== undefined && eta !== null && status !== 'copying') {
    const etaStr   = formatETA(eta);
    const speedStr = speedBps ? formatSpeed(speedBps) : '';
    document.getElementById('progressEta').textContent = speedStr ? `${etaStr} · ${speedStr}` : etaStr;
  }

  let label;
  if      (status === 'copying') label = `⏳ Copying: ${filename}`;
  else if (status === 'done')    label = `✓ Copied: ${filename}`;
  else if (status === 'renamed') label = `✓ Copied (renamed): ${filename} — ${skipReason}`;
  else if (status === 'skipped') label = `↩ Skipped: ${filename} — ${skipReason}`;
  else if (status === 'error')   label = `⚠ Error: ${filename} — ${error}`;
  else                           label = filename;
  document.getElementById('progressFilename').textContent = label;
}

function showProgressSummary({ copied, skipped, errors, skippedReasons, failedFiles, duration, integrity }) {
  document.getElementById('progressFilename').textContent = 'Import complete.';
  document.getElementById('sumCopied').textContent  = copied;
  document.getElementById('sumSkipped').textContent = skipped;
  document.getElementById('sumErrors').textContent  = errors;

  // Duration row
  const durEl = document.getElementById('sumDuration');
  const durRow = document.getElementById('sumDurationRow');
  if (duration && durEl && durRow) {
    durEl.textContent = formatDuration(duration);
    durRow.style.display = 'flex';
  }

  // Detail rows: failed files (after retry) first, then skip/rename notices
  const rows = [];
  if (failedFiles && failedFiles.length) {
    failedFiles.forEach(f =>
      rows.push(`<div class="skip-reason-row skip-reason-failed">⚠ Failed: ${escapeHtml(f.filename)} — ${escapeHtml(f.reason)}</div>`)
    );
  }
  if (skippedReasons && skippedReasons.length) {
    skippedReasons.forEach(r =>
      rows.push(`<div class="skip-reason-row">${escapeHtml(r)}</div>`)
    );
  }
  const el = document.getElementById('progressSkipDetails');
  if (rows.length) {
    el.style.display = 'block';
    el.innerHTML = rows.join('');
  } else {
    el.style.display = 'none';
  }
  document.getElementById('progressSummary').classList.add('visible');
  document.getElementById('progressDoneBtn').classList.add('visible');
  // Hide pause/resume once import finishes
  document.getElementById('progressPauseBtn').style.display  = 'none';
  document.getElementById('progressResumeBtn').style.display = 'none';
  // Hint 4: show once after first import completes
  showInlineHint('progressModal', 'Review the Copied / Skipped / Failed summary above', 'hint_import_done');

  // ── File integrity indicator (always shown when integrity is confirmed) ───────
  const summaryEl = document.getElementById('progressSummary');
  if (summaryEl && !summaryEl.querySelector('#sumIntegrity') && integrity === 'verified') {
    const row = document.createElement('div');
    row.id        = 'sumIntegrity';
    row.className = 'sum-row';
    row.style.cssText = 'color:var(--green);font-size:0.78rem;margin-top:2px;opacity:1;';
    row.textContent = '✔ File Integrity Verified (Size Check)';
    summaryEl.appendChild(row);
  }

  // ── Deep Verify (Checksum) button — user-triggered, runs in background ────────
  const modal = document.getElementById('progressModal');
  if (modal && !modal.querySelector('#runChecksumBtn') && integrity === 'verified') {
    const checksumBtn = document.createElement('button');
    checksumBtn.id = 'runChecksumBtn';
    checksumBtn.textContent = 'Deep Verify (Checksum)';
    checksumBtn.style.cssText =
      'padding:6px 14px;font-size:0.75rem;background:transparent;' +
      'border:1px solid var(--border);border-radius:7px;color:var(--subtext);' +
      'cursor:pointer;align-self:flex-start;margin-top:-4px;';
    checksumBtn.onmouseenter = () => {
      if (!checksumBtn.disabled) { checksumBtn.style.borderColor = 'var(--blue)'; checksumBtn.style.color = 'var(--blue)'; }
    };
    checksumBtn.onmouseleave = () => {
      if (!checksumBtn.disabled) { checksumBtn.style.borderColor = 'var(--border)'; checksumBtn.style.color = 'var(--subtext)'; }
    };
    checksumBtn.addEventListener('click', async () => {
      checksumBtn.disabled = true;
      checksumBtn.innerText = 'Verifying... 0%';
      checksumBtn.style.opacity = '0.7';
      checksumBtn.style.cursor = 'default';
      await window.api.runChecksumVerification();
    });
    document.getElementById('progressDoneBtn').insertAdjacentElement('beforebegin', checksumBtn);
  }

  // ── Report Issue button (shown after every import) ─────────────────────────
  // Removed after Done is clicked to keep the modal clean on next import.
  if (modal && !modal.querySelector('#progressReportBtn')) {
    const btn = document.createElement('button');
    btn.id          = 'progressReportBtn';
    btn.textContent = '⚑ Report an Issue';
    btn.style.cssText =
      'padding:6px 14px;font-size:0.75rem;background:transparent;' +
      'border:1px solid var(--border);border-radius:7px;color:var(--subtext);' +
      'cursor:pointer;align-self:flex-start;margin-top:-4px;';
    btn.onmouseenter = () => { btn.style.borderColor = 'var(--red)'; btn.style.color = 'var(--red)'; };
    btn.onmouseleave = () => { btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--subtext)'; };
    btn.addEventListener('click', () => {
      document.getElementById('progressOverlay').classList.remove('visible');
      openFeedbackModal({
        issueType:    errors > 0 ? 'Import Failure' : '',
        importResult: `Copied: ${copied}  Skipped: ${skipped}  Failed: ${errors}`,
      });
    });
    document.getElementById('progressDoneBtn').insertAdjacentElement('beforebegin', btn);
  }
}

window.api.onImportProgress(updateProgress);

window.api.onChecksumProgress(({ completed, total }) => {
  const btn = document.getElementById('runChecksumBtn');
  if (!btn) return;
  const pct = total > 0 ? Math.floor((completed / total) * 100) : 0;
  btn.innerText = `Verifying... ${pct}%`;
});

window.api.onChecksumComplete(({ failed }) => {
  const btn = document.getElementById('runChecksumBtn');
  if (!btn) return;
  btn.style.opacity = '1';
  if (failed === 0) {
    btn.innerText = '✔ Deep Verification Complete';
    btn.classList.add('csq-success');
  } else {
    btn.innerText = `⚠ ${failed} file(s) failed`;
    btn.classList.add('csq-error');
  }
  window.api.getImportIndex().then(index => {
    globalImportIndex = index || {};
    });
});


document.getElementById('importBtn').addEventListener('click', async () => {
  if (!selectedFiles.size || !destPath || importRunning) return;
  let filePaths = [...selectedFiles];

  const { duplicates, clean } = detectDuplicates(filePaths);
  if (duplicates.length > 0) {
    const decision = await showDupWarning(duplicates, filePaths.length);
    if (decision === 'cancel') return;
    if (decision === 'skip')   filePaths = clean;
  }
  if (!filePaths.length) return;

  importRunning = true;
  updateSelectionBar();
  showProgress();

  try {
    const summary = await window.api.importFiles(filePaths, destPath);
    if (!activeDrive) return; // Patch 36: card was disconnected mid-import; reset already ran
    showProgressSummary(summary);
    // Refresh both caches after import so badges survive a destination change
    await refreshDestCache();
    try { globalImportIndex = await window.api.getImportIndex() || {}; } catch { /* non-critical */ }
  } catch (err) {
    document.getElementById('progressFilename').textContent = `Error: ${err.message}`;
    document.getElementById('progressDoneBtn').classList.add('visible');
  } finally {
    importRunning = false;
  }
});

document.getElementById('progressPauseBtn').addEventListener('click', () => {
  window.api.pauseCopy();
  document.getElementById('progressPauseBtn').style.display  = 'none';
  document.getElementById('progressResumeBtn').style.display = '';
  document.getElementById('progressEta').textContent = 'Paused';
});

document.getElementById('progressResumeBtn').addEventListener('click', () => {
  window.api.resumeCopy();
  document.getElementById('progressResumeBtn').style.display = 'none';
  document.getElementById('progressPauseBtn').style.display  = '';
  document.getElementById('progressEta').textContent = 'Resuming…';
});

document.getElementById('progressDoneBtn').addEventListener('click', () => {
  document.getElementById('progressOverlay').classList.remove('visible');
  importRunning = false;
  // Remove per-import buttons and rows so the next import gets a clean modal
  const reportBtn   = document.getElementById('progressReportBtn');
  if (reportBtn) reportBtn.remove();
  const checksumBtn = document.getElementById('runChecksumBtn');
  if (checksumBtn) checksumBtn.remove();
  const integrityRow = document.getElementById('sumIntegrity');
  if (integrityRow) integrityRow.remove();
  // PERF: sync badges in-place instead of re-rendering the entire grid
  // This preserves scroll position and avoids image reload
  if (currentFiles.length) syncImportedBadges();
  updateSelectionBar();
});

// ════════════════════════════════════════════════════════════════
// APP BOOTSTRAP
// Load the global import index FIRST so "Already Imported" badges
// are correct on the very first render — then start drive polling.
// Nothing that can trigger renderFileArea() runs before this.
// ════════════════════════════════════════════════════════════════
async function initApp() {
  try {
    globalImportIndex = await window.api.getImportIndex() || {};
  } catch (e) {
    console.error('Failed to load import index', e);
    globalImportIndex = {};
  }

  // Patch 49: await default-dest so import index is loaded before setDestPath runs
  try {
    const p = await window.api.getDefaultDest();
    await setDestPath(p);
  } catch (e) {
    console.error('Failed to load default destination', e);
  }

  // Register batch listener before the initial getDrives call so no
  // in-flight batch event is missed between registration and first poll.
  window.api.onFilesBatch(applyFileBatch);
  window.api.onDrivesUpdated(renderDrives);

  window.api.getDrives().then(renderDrives).catch(err => {
    document.getElementById('driveListLarge').innerHTML =
      `<div id="noDriveMsg"><span class="msg-icon">⚠️</span><span>${escapeHtml(err.message)}</span></div>`;
  });

  // Show "What's New" if the app just updated — non-blocking, after UI is ready
  try {
    const updateInfo = await window.api.getLastUpdateInfo();
    if (updateInfo) showWhatsNewModal(updateInfo);
  } catch { /* non-critical — never block startup */ }
}

initApp();

// ════════════════════════════════════════════════════════════════
// WHAT'S NEW MODAL
// Shown once after an app update. Content comes from GitHub release
// notes; falls back to a curated summary if notes are empty.
// ════════════════════════════════════════════════════════════════
function showWhatsNewModal({ version, notes }) {
  const DEFAULT_NOTES = `
    <ul>
      <li><strong>Sony PRIVATE folder support</strong><br>
          Videos from Sony cameras (M4ROOT/CLIP, AVCHD/STREAM) are detected automatically.</li>
      <li><strong>Collapsible file type sections</strong><br>
          RAW / JPG / VIDEO groups can be collapsed to reduce clutter.</li>
      <li><strong>Deselect all by file type</strong><br>
          Quickly deselect all files in a group with one click.</li>
      <li><strong>Improved "Already Imported" detection</strong><br>
          Badge now appears even for files copied in a previous session or to a different folder.</li>
    </ul>`;

  const modal = document.createElement('div');
  modal.className = 'whats-new-overlay';
  modal.innerHTML = `
    <div class="whats-new-modal" role="dialog" aria-modal="true" aria-label="What's New">
      <h2 class="wn-title">What's New in v${escapeHtml(String(version))}</h2>
      <div class="wn-body">${notes ? escapeHtml(String(notes)) : DEFAULT_NOTES}</div>
      <button class="wn-close-btn" id="wnCloseBtn">Got it</button>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('wnCloseBtn').addEventListener('click', close, { once: true });
  // Also close on backdrop click
  modal.addEventListener('click', e => { if (e.target === modal) close(); }, { once: true });
}

// ════════════════════════════════════════════════════════════════
// ONBOARDING + HELP SYSTEM
// ════════════════════════════════════════════════════════════════

// ── Shared tips content (rendered in both onboarding step 4 and Help modal) ──
function renderTipsContent() {
  return `
    <div class="ob-tips">
      <div class="ob-tip">
        <div class="ob-tip-label">📅 Sorting</div>
        Use Date, Name, or Size to organise files.
        <div class="ob-tip-hint">Tip: Sort by Date to review newest photos first.</div>
      </div>
      <div class="ob-tip">
        <div class="ob-tip-label">☑ Selecting files</div>
        Only new files are selected automatically — you can still select or deselect manually.
      </div>
      <div class="ob-tip">
        <div class="ob-tip-label">📂 Destination folder</div>
        Check the destination path before importing. Use <strong>"Change Location"</strong> if needed.
      </div>
      <div class="ob-tip">
        <div class="ob-tip-label">📊 Import results</div>
        <div class="ob-result-rows">
          <div class="ob-result-row"><span class="ob-result-icon sum-copied">✓</span><span><strong>Copied</strong> — successfully imported</span></div>
          <div class="ob-result-row"><span class="ob-result-icon sum-skipped">↩</span><span><strong>Skipped</strong> — already exists at destination</span></div>
          <div class="ob-result-row"><span class="ob-result-icon sum-errors">⚠</span><span><strong>Failed</strong> — could not be copied</span></div>
        </div>
      </div>
    </div>
    <div class="ob-beta">
      <div class="ob-beta-title">🧪 Help us improve</div>
      <ul class="ob-beta-list">
        <li><strong>Speed</strong> — does anything feel slow?</li>
        <li><strong>Ease</strong> — is anything confusing?</li>
        <li><strong>Reliability</strong> — did anything fail?</li>
      </ul>
      <div style="margin-top:10px; font-size:0.82rem; color:var(--subtext);">
        If something doesn't work: take a screenshot, send a short message, and share the log file if possible.
      </div>
      <div class="ob-log">
        <strong style="color:var(--text);">Log file location:</strong><br>
        Mac: ~/Library/Application Support/AutoIngest/app.log<br>
        Windows: AppData → Roaming → AutoIngest → app.log
      </div>
    </div>`;
}

// ── Onboarding screens definition ────────────────────────────────────────────
const OB_SCREENS = [
  {
    hero:  '📸',
    title: 'Import your camera files safely',
    body:  `<p class="ob-text">Quickly select and copy photos from memory cards — without duplicates.</p>`
  },
  {
    hero:  '🗂️',
    title: 'How it works',
    body: `
      <div class="ob-steps">
        <div class="ob-step-row"><span class="ob-step-num">1</span><span>Insert your memory card</span></div>
        <div class="ob-step-row"><span class="ob-step-num">2</span><span>Select the files you want</span></div>
        <div class="ob-step-row"><span class="ob-step-num">3</span><span>Click <strong>Import</strong></span></div>
      </div>
      <p class="ob-text">Only new files are selected automatically.</p>`
  },
  {
    hero:  '💾',
    title: 'Ready to begin',
    body:  `<p class="ob-text" style="text-align:center; font-size:1rem;">Insert a card to begin.</p>
            <p class="ob-text">AutoIngest will detect your memory card automatically and show your files within seconds.</p>`
  },
  {
    hero:  '🎉',
    title: "You're ready — a few quick tips",
    body:  renderTipsContent()
  }
];

// ── Onboarding controller ─────────────────────────────────────────────────────
let obStep = 0;

function obRender() {
  const screen = OB_SCREENS[obStep];
  const body   = document.getElementById('onboardingBody');
  body.innerHTML = `
    <div class="ob-hero">${screen.hero}</div>
    <div class="ob-title">${screen.title}</div>
    ${screen.body}`;

  // Dots
  document.querySelectorAll('.ob-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === obStep);
  });

  // Back button — hidden on first screen
  document.getElementById('obBackBtn').style.display = obStep === 0 ? 'none' : '';

  // Next / Finish button label
  const nextBtn = document.getElementById('obNextBtn');
  nextBtn.textContent = obStep === OB_SCREENS.length - 1 ? 'Start Using App' : 'Next →';
}

function obFinish() {
  localStorage.setItem('onboarding_done', '1');
  document.getElementById('onboardingOverlay').classList.remove('visible');
}

document.getElementById('obNextBtn').addEventListener('click', () => {
  if (obStep < OB_SCREENS.length - 1) {
    obStep++;
    obRender();
  } else {
    obFinish();
  }
});

document.getElementById('obBackBtn').addEventListener('click', () => {
  if (obStep > 0) { obStep--; obRender(); }
});

document.getElementById('onboardingSkip').addEventListener('click', obFinish);

// Show onboarding only on first launch
if (!localStorage.getItem('onboarding_done')) {
  obStep = 0;
  obRender();
  document.getElementById('onboardingOverlay').classList.add('visible');
}

// ── Help modal ────────────────────────────────────────────────────────────────
function openHelp() {
  document.getElementById('helpModalBody').innerHTML = `
    <div class="ob-title" style="font-size:0.95rem; text-align:left; margin-bottom:4px;">Tips &amp; Reference</div>
    ${renderTipsContent()}`;
  document.getElementById('helpOverlay').classList.add('visible');
}

document.getElementById('helpBtn').addEventListener('click', openHelp);
document.getElementById('helpCloseBtn').addEventListener('click', () => {
  document.getElementById('helpOverlay').classList.remove('visible');
});
// Close on backdrop click
document.getElementById('helpOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('helpOverlay')) {
    document.getElementById('helpOverlay').classList.remove('visible');
  }
});

// ── Inline hints ──────────────────────────────────────────────────────────────
// Each hint shows once (guarded by localStorage), auto-fades via CSS animation.

// Hint 1: Sort bar — shown once when files first load
const _origRenderFileArea = renderFileArea;  // patch-point reference
// We hook into the existing renderFileArea via a post-call observer on
// currentFiles becoming non-empty (avoids touching core logic).
const _hintSortObserver = setInterval(() => {
  if (currentFiles.length > 0) {
    showInlineHint('toolbar', 'Sort by Date to quickly review newest files first', 'hint_sort_done');
    clearInterval(_hintSortObserver);
  }
}, 800);

// Hint 2: Destination bar — shown on first load
setTimeout(() => {
  showInlineHint('importFooter', 'Check destination before importing', 'hint_dest_done');
}, 1200);

// Hint 3: Selection hint — shown when files load but nothing is selected
const _hintSelObserver = setInterval(() => {
  if (currentFiles.length > 0 && selectedFiles.size === 0) {
    showInlineHint('selectionBar', 'New files are auto-selected', 'hint_sel_done');
    clearInterval(_hintSelObserver);
  }
}, 1500);

// Hint 4 fires directly inside showProgressSummary — no patching needed.

// ════════════════════════════════════════════════════════════════
// FEEDBACK MODAL — active user reporting
//
// openFeedbackModal(prefill?)  — opens the modal, optionally pre-fills fields
// Prefill shape: { issueType, importResult, description }
//
// Auto-opens after crash recovery if sessionStorage.crashRecovery is set
// (crashReporter sets this flag before reload via renderer:crashRecovery IPC).
// ════════════════════════════════════════════════════════════════

const FEEDBACK_NAME_KEY = 'feedback_reporter_name';
let   _fpSeverity       = 'Low';

function openFeedbackModal(prefill = {}) {
  const overlay = document.getElementById('feedbackOverlay');
  if (!overlay) return;

  // Restore saved name
  const nameInput = document.getElementById('fpName');
  if (nameInput && !nameInput.value) {
    nameInput.value = localStorage.getItem(FEEDBACK_NAME_KEY) || '';
  }

  // Fill version + platform pills
  try {
    document.getElementById('fpMetaVersion').textContent  = `v${window.api.getVersion()}`;
    document.getElementById('fpMetaPlatform').textContent =
      navigator.platform.toLowerCase().includes('win') ? 'Windows' : 'Mac';
  } catch {}

  // Import result pill
  const importPill = document.getElementById('fpMetaImport');
  if (importPill) {
    importPill.textContent  = prefill.importResult || '';
    importPill.style.display = prefill.importResult ? '' : 'none';
  }

  // Pre-fill issue type
  if (prefill.issueType) {
    const sel = document.getElementById('fpType');
    if (sel) sel.value = prefill.issueType;
  }

  // Pre-fill description
  if (prefill.description) {
    const desc = document.getElementById('fpDesc');
    if (desc) desc.value = prefill.description;
  }

  // Auto-set severity for import failures
  if (prefill.issueType === 'Import Failure' || prefill.issueType === 'Crash') {
    _setFpSeverity(prefill.issueType === 'Crash' ? 'Critical' : 'High');
  }

  // Reset submit button
  const submitBtn = document.getElementById('fpSubmitBtn');
  if (submitBtn) { submitBtn.textContent = 'Send Report'; submitBtn.disabled = false; }

  overlay.classList.add('visible');
  if (nameInput) nameInput.focus();
}

function closeFeedbackModal() {
  const overlay = document.getElementById('feedbackOverlay');
  if (overlay) overlay.classList.remove('visible');
  // Clear errors
  ['fpName', 'fpDesc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('fp-error');
  });
}

function _setFpSeverity(sev) {
  _fpSeverity = sev;
  document.querySelectorAll('.fp-sev').forEach(btn => {
    btn.classList.toggle('fp-sev-active', btn.dataset.sev === sev);
  });
}

async function _submitFeedback() {
  const name    = (document.getElementById('fpName').value  || '').trim();
  const desc    = (document.getElementById('fpDesc').value  || '').trim();
  const type    = (document.getElementById('fpType').value  || '').trim();
  const withLog = document.getElementById('fpIncludeLog').checked;

  // Validate
  let valid = true;
  if (!name) { document.getElementById('fpName').classList.add('fp-error'); valid = false; }
  if (!desc) { document.getElementById('fpDesc').classList.add('fp-error'); valid = false; }
  if (!valid) return;

  // Save name for next time
  localStorage.setItem(FEEDBACK_NAME_KEY, name);

  const submitBtn = document.getElementById('fpSubmitBtn');
  submitBtn.textContent = 'Sending…';
  submitBtn.disabled    = true;

  try {
    const result = await window.api.sendFeedback({
      reporter:    name,
      issueType:   type || 'Other',
      severity:    _fpSeverity,
      description: desc,
      includeLog:  withLog,
    });

    closeFeedbackModal();

    if (result && result.success) {
      showMessage('✅ Report sent — thank you!', 5000);
    } else {
      showMessage('⚠️ Saved locally — will send when online.', 5000);
    }
  } catch {
    closeFeedbackModal();
    showMessage('⚠️ Saved locally — will send when online.', 5000);
  }
}

// ── Wire up modal events ──────────────────────────────────────────────────────
(function initFeedbackEvents() {
  // Open via floating button
  const fab = document.getElementById('bugReportBtn');
  if (fab) fab.addEventListener('click', () => openFeedbackModal());

  // Close buttons
  const closeBtn  = document.getElementById('feedbackPanelClose');
  const cancelBtn = document.getElementById('fpCancelBtn');
  if (closeBtn)  closeBtn.addEventListener('click', closeFeedbackModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeFeedbackModal);

  // Backdrop click closes
  const overlay = document.getElementById('feedbackOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeFeedbackModal();
    });
  }

  // Submit
  const submitBtn = document.getElementById('fpSubmitBtn');
  if (submitBtn) submitBtn.addEventListener('click', _submitFeedback);

  // Ctrl/Cmd+Enter submits
  const panel = document.getElementById('feedbackPanel');
  if (panel) {
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeFeedbackModal(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) _submitFeedback();
    });
  }

  // Severity chip clicks
  document.querySelectorAll('.fp-sev').forEach(btn => {
    btn.addEventListener('click', () => _setFpSeverity(btn.dataset.sev));
  });

  // Clear error styling on input
  ['fpName', 'fpDesc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => el.classList.remove('fp-error'));
  });

  // Auto-open after crash recovery
  // crashReporter sets sessionStorage.crashRecovery = '1' before reloading
  if (sessionStorage.getItem('crashRecovery')) {
    sessionStorage.removeItem('crashRecovery');
    setTimeout(() => openFeedbackModal({
      issueType:   'Crash',
      description: 'The app crashed during the last session. What were you doing?',
    }), 1200);
  }
})();

// ── AUTO-UPDATE BANNER ────────────────────────────────────────────────────────
(function initUpdateBanner() {
  const banner      = document.getElementById('updateBanner');
  const msgEl       = document.getElementById('updMsg');
  const progressEl  = document.getElementById('updProgress');
  const installBtn  = document.getElementById('updInstallBtn');
  const dismissBtn  = document.getElementById('updDismissBtn');

  if (!banner || !window.api) return;

  function showBanner() { banner.classList.add('visible'); }
  function hideBanner() { banner.classList.remove('visible'); }

  // 1 — Update available: download starting
  window.api.onUpdateAvailable(({ version }) => {
    msgEl.textContent      = `Downloading update v${version}…`;
    progressEl.textContent = '';
    installBtn.style.display = 'none';
    showBanner();
  });

  // 2 — Download progress
  window.api.onUpdateProgress(({ percent }) => {
    progressEl.textContent = `${percent}%`;
  });

  // 3 — Ready to install
  window.api.onUpdateReady(({ version }) => {
    msgEl.textContent        = `v${version} ready to install`;
    progressEl.textContent   = '';
    installBtn.style.display = 'inline-block';
    showBanner();
  });

  // Install button
  installBtn.addEventListener('click', () => {
    installBtn.textContent  = 'Restarting…';
    installBtn.disabled     = true;
    window.api.installUpdate();
  });

  // Dismiss (hides banner; update still downloaded and will apply on next launch)
  dismissBtn.addEventListener('click', hideBanner);

  // Patch 46: replay last update state if renderer was reloaded mid-update
  if (window.api.getLastUpdateState) {
    window.api.getLastUpdateState().then(state => {
      if (!state) return;
      if (state.channel === 'update:available') {
        msgEl.textContent = `Downloading update v${state.payload.version}…`;
        showBanner();
      } else if (state.channel === 'update:ready') {
        msgEl.textContent = `v${state.payload.version} ready to install`;
        installBtn.style.display = 'inline-block';
        showBanner();
      }
    }).catch(() => {});
  }
})();
