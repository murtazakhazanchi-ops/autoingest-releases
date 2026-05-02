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

// ── Platform detection (frameless window) ─────────────────────────────────────
if (navigator.platform.startsWith('Mac')) document.body.classList.add('is-mac');

// ════════════════════════════════════════════════════════════════
// THEME SYSTEM
// ════════════════════════════════════════════════════════════════

function getEffectiveTheme() {
  const pref = localStorage.getItem('theme') || 'auto';
  if (pref === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', getEffectiveTheme());
}

function setThemePref(pref) {
  localStorage.setItem('theme', pref);
  applyTheme();
  document.querySelectorAll('.settings-theme-radio').forEach(r => {
    r.checked = r.value === pref;
  });
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem('theme') || 'auto') === 'auto') applyTheme();
});

// Settings modal open
document.getElementById('settingsBtn')?.addEventListener('click', () => {
  const pref = localStorage.getItem('theme') || 'auto';
  document.querySelectorAll('.settings-theme-radio').forEach(r => { r.checked = r.value === pref; });
  document.getElementById('settingsModal').classList.add('visible');
});

// Settings modal close
document.getElementById('settingsClose')?.addEventListener('click', () => {
  document.getElementById('settingsModal').classList.remove('visible');
});

// Radio changes
document.querySelectorAll('.settings-theme-radio').forEach(r => {
  r.addEventListener('change', () => setThemePref(r.value));
});

// Click-outside dismiss
document.getElementById('settingsModal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('visible');
});

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

// Priority-based status bar messages: higher priority wins.
// 3 = importing (highest), 2 = selection, 1 = info/filter, 0 = default
const _statusMessages = {};
function setStatusBarMessage(key, text, priority = 1) {
  if (text == null || text === '') {
    delete _statusMessages[key];
  } else {
    _statusMessages[key] = { text, priority };
  }
  const top = Object.values(_statusMessages).sort((a, b) => b.priority - a.priority)[0];
  const el = document.getElementById('statusMessage');
  if (el) el.textContent = top ? top.text : '';
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
  hint.innerHTML = `<span class="hint-icon-wrap" aria-hidden="true">${SVG.info}</span><span>${message}</span>`;
  container.insertAdjacentElement('afterbegin', hint);

  // Remove from DOM after CSS fade animation completes (5 s total)
  setTimeout(() => { if (hint.parentNode) hint.remove(); }, 5000);
}

// ════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════
let activeDrive      = null;
let activeFolderPath = null;
let activeSource     = null; // { type: 'memory-card'|'external-drive'|'local-folder', name, path }
let _prevDriveKeys   = null; // diff key for drive list; null = never rendered
let _prevExtKeys     = null; // diff key for external drive list
let quickImportDest  = localStorage.getItem('quickImportDest') || null;
let _currentMemCardMountpoints = new Set(); // mountpoints of DCIM cards, for ext-drive filtering

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
  isLeaf: false,
};
let selectedFiles    = new Set();   // absolute source paths — selection truth
let currentFiles     = [];          // flat list of all files in current folder
let sortKey          = 'date';
let sortDir          = 'desc';
let destPath         = '';
let importRunning    = false;
let viewMode         = 'icon';
let importMode       = 'event'; // 'event' | 'quick'
let lastClickedPath  = null;
let _selectionAnchor = null;       // last explicitly import-selected path (shift-click range anchor)
let _prevFocusPath   = null;       // previous pv-focused tile path for O(1) class swap
let fileLoadRequestId = 0;
let _draggedPaths    = [];          // paths being dragged from the file grid
let _csqEligibleFiles = null;       // [{src,dest,size}] — set after successful import
let _csqSourceRoot    = null;       // source root path for path-containment validation
let _previewOpen      = false;      // true while preview overlay is visible
let _previewPath      = null;       // path of currently previewed file
let _previewOrder     = [];         // snapshot of getRenderedPathOrder() at open time
let _pvRawImg         = null;       // reused <img> node for RAW preview renders
let _pvObjUrls        = [];         // object URLs to revoke on close
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
let _syncingToggles = false;  // re-entrancy guard for syncViewToggles()

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

function normalizeImportDisplayEntry(entry) {
  const timestamp = typeof entry?.timestamp === 'string' ? entry.timestamp : '';
  const timeMs = Date.parse(timestamp);
  if (!Number.isFinite(timeMs)) return null;

  const photographer  = typeof entry?.photographer  === 'string' ? entry.photographer.trim()  : '';
  const componentName = typeof entry?.componentName === 'string' ? entry.componentName.trim() : '';

  const photos = Math.max(0, parseInt(entry?.counts?.photos, 10) || 0);
  const videos = Math.max(0, parseInt(entry?.counts?.videos, 10) || 0);

  const skipped    = Math.max(0, parseInt(entry?.skipped,    10) || 0);
  const duplicates = Math.max(0, parseInt(entry?.duplicates, 10) || 0);
  const source     = entry?.source || null;
  const importedBy = (entry?.importedBy && typeof entry.importedBy === 'object')
    ? entry.importedBy
    : null;

  return {
    photographer:  photographer  || '—',
    componentName: componentName || '—',
    timestamp,
    timeMs,
    seq:       parseInt(entry?.seq, 10) || 0,
    photos,
    videos,
    skipped,
    duplicates,
    source,
    importedBy,
  };
}

function getEventImportSummary(event) {
  const imports = Array.isArray(event?.imports) ? event.imports : [];
  const entries = imports
    .map(normalizeImportDisplayEntry)
    .filter(Boolean)
    .sort((a, b) => {
      const t = b.timeMs - a.timeMs;
      if (t !== 0) return t;
      return (b.seq || 0) - (a.seq || 0);
    });

  if (entries.length === 0) return null;

  let totalPhotos = 0;
  let totalVideos = 0;

  for (const entry of entries) {
    totalPhotos += entry.photos;
    totalVideos += entry.videos;
  }

  return {
    totalPhotos,
    totalVideos,
    lastImport: entries[0],
    entries,
  };
}

// ── Inline SVG icon strings ───────────────────────────────────────────────────
// Convention: viewBox 0 0 24 24, fill none, stroke currentColor, stroke-width 1.6
const SVG = (() => {
  const i = (path, w = 14) =>
    `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  return {
    check:        i('<polyline points="20 6 9 17 4 12"/>'),
    checkCircle:  i('<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>', 36),
    warn:         i('<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    warnCircle:   i('<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 36),
    block:        i('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>', 36),
    skip:         i('<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/>'),
    clock:        i('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    loader:       i('<path d="M21 12a9 9 0 11-6.22-8.56"/>'),
    download:     i('<polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/>'),
    pause:        i('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'),
    play:         i('<polygon points="5 3 19 12 5 21 5 3"/>'),
    chevronRight: i('<polyline points="9 18 15 12 9 6"/>', 10),
    chevronDown:  i('<polyline points="6 9 12 15 18 9"/>', 10),
    folder:       i('<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>'),
    folderLg:     i('<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>', 36),
    flag:         i('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'),
    info:         i('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
    camera:       i('<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>', 48),
    layers:       i('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>', 48),
    save:         i('<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>', 48),
    sparkles:     i('<path d="M12 3l1.09 3.26L16 7.27l-2.91.67L12 11l-1.09-3.06L8 7.27l2.91-.01z"/><path d="M5 13l.73 2.18L8 16.09l-2.27.73L5 19l-.73-2.18L2 16.09l2.27-.73z"/><path d="M18 1l.73 2.18L21 4.09l-2.27.73L18 7l-.73-2.18L15 4.09l2.27-.73z"/>', 48),
  };
})();

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

function mediaCountLabel(photos, videos) {
  const photoCount = parseInt(photos, 10) || 0;
  const videoCount = parseInt(videos, 10) || 0;
  const parts = [`${photoCount} photo${photoCount === 1 ? '' : 's'}`];
  if (videoCount > 0) parts.push(`${videoCount} video${videoCount === 1 ? '' : 's'}`);
  return parts.join(' • ');
}

function LastImportArea(summary) {
  const lastImport = summary?.lastImport;
  if (!lastImport) return '';

  const lastTimestamp = formatDate(lastImport.timestamp);
  const totalMedia = mediaCountLabel(lastImport.photos, lastImport.videos);

  return `
    <div class="last-import-area" aria-label="Last import">
      <div class="last-import-summary">
        <span class="last-import-icon">${SVG.clock}</span>
        <span class="last-import-title">Last Import</span>
        <span class="last-import-separator">·</span>
        <span class="last-import-meta">${escapeHtml(lastImport.photographer)} · ${escapeHtml(lastTimestamp)}</span>
        <span class="last-import-total">${escapeHtml(totalMedia)}</span>
      </div>
    </div>
  `;
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

// Guard: only allow data:image/* and file:// URLs as img.src values.
// Prevents stray non-URL strings from reaching the DOM (defense-in-depth).
function safeSetImageSrc(img, src) {
  if (!src) return;
  if (src.startsWith('data:image/') || src.startsWith('file://')) {
    img.src = src;
    return;
  }
  if (process.env.NODE_ENV === 'development') {
    console.warn('[INVALID IMG SRC]', src);
  }
}

// ════════════════════════════════════════════════════════════════
// THUMBNAIL BUILDER
// Single element inside .file-thumb — no overlapping layers.
// ════════════════════════════════════════════════════════════════
const SVG_FALLBACK_PHOTO = `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="9" width="34" height="26" rx="3" fill="currentColor" fill-opacity="0.13" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="4" width="12" height="6" rx="2" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.2"/><circle cx="20" cy="23" r="7" stroke="currentColor" stroke-width="1.5"/><circle cx="20" cy="23" r="3.5" stroke="currentColor" stroke-width="1.2"/><circle cx="20" cy="23" r="1.2" fill="currentColor"/></svg>`;

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

  // VIDEO — lazy thumbnail with play badge when thumbnails are enabled
  if (file.type === 'video') {
    if (showThumbnails) {
      return `<div class="video-thumb-container"><img
          class="thumb-img video-thumb lazy-thumb"
          data-thumb-type="video"
          data-src="${escapeHtml(file.path)}"
          data-file="${escapeHtml(file.path)}"
          data-size="${file.size}"
          data-modified="${escapeHtml(file.modifiedAt)}"
          alt="" decoding="async"
        /><span class="video-play-badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" width="18" height="18"><path d="M8 5v14l11-7z"/></svg></span></div>`;
    }
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
  safeSetImageSrc(img, cachedUrl);
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
      safeSetImageSrc(img, cachedUrl);
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
    const _thumbFn = (img.dataset.thumbType === 'video' && window.api.getVideoThumb)
      ? window.api.getVideoThumb
      : window.api.getThumb;
    _thumbFn(srcPath)
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
        safeSetImageSrc(img, url);
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
          const accentHex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#89b4fa';
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG_FALLBACK_PHOTO.replace(/currentColor/g, accentHex))}`;
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

// 'card' = import-from-card path  |  'event' = event-creation path
let railMode = 'card';

const RAIL_LABELS = {
  card:  ['Select Memory Card', 'Browse &amp; Select Files', 'Import'],
  event: ['Create Collection',  'Create Event',              'Import'],
};

function setRailMode(mode) {
  if (railMode === mode) return;
  railMode = mode;
}

function updateSteps() {
  if (railMode === 'event') {
    // Rail highlight managed per-step by EventCreator.syncRail()
    EventCreator.syncRail();
    return;
  }
  // card path
  const hasDrive = activeSource !== null;
  const hasSel   = selectedFiles.size > 0;
  setStep('step1Indicator', !hasDrive ? 'active' : 'done');
  setStep('step2Indicator', !hasDrive ? '' : (!hasSel ? 'active' : 'done'));
  setStep('step3Indicator', hasSel ? 'active' : '');
}
function setStep(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active','done');
  if (state) el.classList.add(state);
}

// ════════════════════════════════════════════════════════════════
// M8: CONTEXT BAR — breadcrumb + mode indicator
// ════════════════════════════════════════════════════════════════

function _updateContextBar() {
  const bar = document.getElementById('contextBar');
  if (!bar) return;

  if (EventMgmt.isOpen()) { bar.classList.remove('visible'); return; }
  if (!activeSource)      { bar.classList.remove('visible'); return; }

  const srcValEl    = document.getElementById('ctxSourceVal');
  const srcTypeEl   = document.getElementById('ctxSourceType');
  const line2Event  = document.getElementById('ctxLine2Event');
  const line2Quick  = document.getElementById('ctxLine2Quick');
  const ejectBtn    = document.getElementById('ejectBtn');

  if (srcValEl) srcValEl.textContent = activeSource.name;

  if (srcTypeEl) {
    const typeLabels = { 'memory-card': 'CARD', 'external-drive': 'DRIVE', 'local-folder': 'LOCAL' };
    const label = typeLabels[activeSource.type] || '';
    srcTypeEl.textContent    = label;
    srcTypeEl.style.display  = label ? '' : 'none';
  }

  const isEjectable = activeSource.type === 'memory-card' || activeSource.type === 'external-drive';
  if (ejectBtn) ejectBtn.style.display = isEjectable ? 'inline-flex' : 'none';

  const eventData = EventCreator.getActiveEventData();
  const master    = EventCreator.getActiveMaster();

  if (importMode === 'event' && eventData) {
    const masterValEl = document.getElementById('ctxMasterVal');
    const eventValEl  = document.getElementById('ctxEventVal');
    const compTagEl   = document.getElementById('ctxCompTag');
    if (masterValEl) masterValEl.textContent = master?.name || eventData.coll.name || '';
    if (eventValEl)  eventValEl.textContent  = eventData.event.displayName || eventData.event.name || '';
    if (compTagEl) {
      const _heroComps = Array.isArray(eventData.event.components) ? eventData.event.components : [];
      compTagEl.textContent = _heroComps.length > 1 ? 'MULTI' : 'SINGLE';
    }
    if (line2Event) line2Event.style.display = '';
    if (line2Quick) line2Quick.style.display = 'none';
  } else {
    if (line2Event) line2Event.style.display = 'none';
    if (line2Quick) line2Quick.style.display = '';
  }

  bar.classList.add('visible');
}

// ════════════════════════════════════════════════════════════════
// EVENT CREATOR NAVIGATION
// ════════════════════════════════════════════════════════════════

function _ecPanelOpen() {
  setRailMode('event');
  updateSteps();
  EventMgmt.open({ mode: 'select' });
  _updateContextBar();
}

function showEventCreator() {
  // Entering event creator invalidates any existing group→sub-event mappings
  _clearHeroLastImportArea();
  GroupManager.reset();
  renderGroupPanel();
  _ecPanelOpen();
  EventCreator.start();
}

function showEventCreatorResume() {
  // Re-entering to change the event also invalidates existing group mappings
  _clearHeroLastImportArea();
  GroupManager.reset();
  renderGroupPanel();
  _ecPanelOpen();
  EventCreator.resetToList();
}

function showLanding() {
  // Render home first so the hero reflects the new event state before the modal fade begins.
  document.getElementById('workspace').classList.remove('visible');
  document.getElementById('step1Panel').style.display = '';
  setRailMode('card');
  updateSteps();
  _updateContextBar();
  renderHome();
  // Close modal after hero is updated so the user sees the correct state through the fade.
  EventMgmt.close();
}

// Clears event/source/group context when the user explicitly returns to landing
// (e.g. "Change Source" from workspace). NOT called from event-creator back navigation,
// which must preserve event state.
function resetWorkspaceState() {
  activeSource = null;
  activeDrive  = null;
  GroupManager.reset();
  setRailMode('card');
}

function resetEntireSession() {
  resetWorkspaceState();
  EventCreator.resetSelection();
}

function _typeLabelFor(type) {
  return type === 'memory-card'   ? 'Memory Card'
       : type === 'external-drive' ? 'External Drive'
       : 'Local Folder';
}

/**
 * Set the active import source and sync all UI that depends on it:
 *   - highlights the owning source card
 *   - updates hero source label, readiness, and Continue button
 *     via targeted DOM update (preserves CSS transitions on the button)
 */
function _setActiveSource(source) {
  activeSource = source;

  // 1. Source card highlight
  ['srcMemCard', 'srcExtDrive', 'srcLocalFolder'].forEach(id =>
    document.getElementById(id)?.classList.remove('active-source'));
  if (source) {
    const cardId = source.type === 'memory-card'   ? 'srcMemCard'
                 : source.type === 'external-drive' ? 'srcExtDrive'
                 : 'srcLocalFolder';
    document.getElementById(cardId)?.classList.add('active-source');
  }

  const onLanding = document.getElementById('step1Panel')?.style.display !== 'none';
  if (!onLanding) return;

  _syncQiImportBtn();

  const heroCard = document.getElementById('heroCard');
  const srcReady = source !== null;

  if (heroCard?.classList.contains('has-event')) {
    // 2. Targeted hero update — no innerHTML rebuild, so transitions fire cleanly
    const srcVal = heroCard.querySelector('.hero-src-val');
    const readiness = heroCard.querySelector('.hero-readiness');
    const continueBtn = document.getElementById('heroPrimaryBtn');

    if (srcVal) {
      srcVal.innerHTML = srcReady
        ? `${_esc(source.name)}<span class="hero-src-type">(${_typeLabelFor(source.type)})</span>`
        : '—';
    }
    if (readiness) {
      readiness.className = `hero-readiness${srcReady ? ' ready' : ''}`;
      readiness.innerHTML = `<span class="hero-readiness-dot"></span>${srcReady ? 'Ready to import' : 'Select a source to continue'}`;
    }
    if (continueBtn) {
      const wasDisabled = continueBtn.disabled;
      continueBtn.disabled = !srcReady;
      if (wasDisabled && srcReady) {
        continueBtn.classList.add('just-enabled');
        continueBtn.addEventListener('animationend', () => continueBtn.classList.remove('just-enabled'), { once: true });
      }
    }
  } else {
    // No-event state: full rebuild (no source row rendered there anyway)
    _renderLandingEventCard();
  }
}

// ── Simple HTML escaper for landing card dynamic content ──────────────────
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _renderLandingEventCard() {
  const card = document.getElementById('heroCard');
  if (!card) return;

  const data = EventCreator.getActiveEventData();
  const activeClass = card.classList.contains('card-active') || importMode === 'event' ? ' card-active' : '';

  if (!data) {
    card.className = `event-context-section event-context-section--hero${activeClass}`;
    card.innerHTML = `
      <div class="hero-icon-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
      <div class="hero-body">
        <div class="hero-pretitle">Create or Select Event</div>
        <div class="hero-event-name">Set up a new event or select an existing one before importing files.</div>
      </div>
      <div class="hero-actions">
        <button id="heroPrimaryBtn" class="hero-btn-primary">Continue →</button>
      </div>`;
    document.getElementById('heroPrimaryBtn')
      ?.addEventListener('click', showEventCreator);
    return;
  }

  // Event confirmed — show summary in hero
  const { coll, event, idx: activeIdx } = data;
  const components = Array.isArray(event?.components) ? event.components : [];
  const isMulti    = components.length > 1;
  const modeLabel  = isMulti ? 'Multi-component' : 'Single component';
  const events    = coll.events;

  const eventDisplay = `<div class="hero-event-name">${_esc(event.displayName || event.name)}</div>`;

  const srcReady = activeSource !== null;

  card.className = `event-context-section event-context-section--hero has-event${activeClass}`;
  card.innerHTML = `
    <div class="hero-icon-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <path d="M9 14l2 2 4-4"/>
      </svg>
    </div>
    <div class="hero-body">
      <div class="hero-pretitle">Current Event</div>
      ${eventDisplay}
      <div class="hero-collection">
        <span class="hero-coll-label">Collection</span>${_esc(coll.name)}
      </div>
      <span class="hero-mode-badge ${isMulti ? 'multi' : 'single'}">${_esc(modeLabel)}</span>
      <div class="hero-source-row">
        <span class="hero-src-lbl">Source</span>
        <span class="hero-src-val">${srcReady ? `${_esc(activeSource.name)}<span class="hero-src-type">(${_typeLabelFor(activeSource.type)})</span>` : '—'}</span>
      </div>
      <div class="hero-readiness${srcReady ? ' ready' : ''}">
        <span class="hero-readiness-dot"></span>
        ${srcReady ? 'Ready to import' : 'Select a source to continue'}
      </div>
    </div>
    <div class="hero-actions">
      <button id="heroPrimaryBtn" class="hero-btn-primary green"${srcReady ? '' : ' disabled'}>Continue →</button>
      <button id="heroSecondaryBtn" class="hero-btn-secondary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>Change Event</button>
    </div>`;

  document.getElementById('heroPrimaryBtn')
    ?.addEventListener('click', async () => {
      if (!activeSource) { showMessage('Select a source to continue'); return; }
      const btn = document.getElementById('heroPrimaryBtn');
      const { type: srcType, path: srcPath, name: srcName } = activeSource;
      showSourceScanState(srcName);
      if (btn) btn.disabled = true;
      try {
        await selectSource({ type: srcType, path: srcPath, label: srcName });
      } finally {
        hideSourceScanState();
        const b = document.getElementById('heroPrimaryBtn');
        if (b) b.disabled = !activeSource;
      }
    });
  document.getElementById('heroSecondaryBtn')
    ?.addEventListener('click', showEventCreatorResume);
}

let lastImportRenderSeq = 0;

function _removeHeroLastImportArea() {
  document.querySelectorAll('.last-import-area').forEach(el => el.remove());
}

function _clearHeroLastImportArea() {
  lastImportRenderSeq++;
  _removeHeroLastImportArea();
}

async function _renderHeroLastImportArea() {
  const renderSeq = ++lastImportRenderSeq;

  _removeHeroLastImportArea();

  const activeData = EventCreator.getActiveEventData();
  const eventJsonPath = activeData?.eventPath;
  if (importMode !== 'event') return;
  if (!eventJsonPath) return;

  let currentEvent = null;
  try {
    currentEvent = await window.api.readEventJson(eventJsonPath);
  } catch {
    return;
  }

  if (renderSeq !== lastImportRenderSeq) return;
  if (importMode !== 'event') return;
  if (EventCreator.getActiveEventData()?.eventPath !== eventJsonPath) return;

  const summary = getEventImportSummary(currentEvent);
  if (!summary) return;

  const heroCard = document.getElementById('heroCard');
  const heroBody = heroCard?.querySelector('.hero-body');
  if (!heroCard?.classList.contains('has-event') || !heroBody) return;

  heroBody.insertAdjacentHTML('beforeend', LastImportArea(summary));
}

function _renderHomeContextBar() {
  const archiveRoot = EventCreator.getSessionArchiveRoot();
  const archiveEl   = document.getElementById('archivePath');
  if (archiveEl) {
    archiveEl.textContent = archiveRoot
      ? (archiveRoot.length > 52 ? '…' + archiveRoot.slice(-49) : archiveRoot)
      : 'No archive set';
  }
}

// ── Activity Log Modal ────────────────────────────────────────────────────────

let _alEventList        = null;
let _alMasterPath       = null;
let _alCurrentEventPath = null;

function _alClose() {
  const overlay = document.getElementById('activityLogModal');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  _alEventList        = null;
  _alMasterPath       = null;
  _alCurrentEventPath = null;
  const pickerRow = document.getElementById('alPickerRow');
  if (pickerRow) pickerRow.innerHTML = '';
  document.getElementById('ovActivityLog')?.focus();
}

function _buildImportSourceMeta() {
  if (!activeSource) {
    return { type: 'unknown', label: 'Unknown source', path: '' };
  }
  return {
    type:  activeSource.type || 'unknown',
    label: activeSource.name || 'Unknown source',
    path:  activeSource.path || '',
  };
}

function _formatImportSource(source) {
  if (!source || typeof source !== 'object') return 'Not recorded';
  const label = typeof source.label === 'string' ? source.label.trim() : '';
  const p     = typeof source.path  === 'string' ? source.path.trim()  : '';
  if (!label) return 'Not recorded';
  if (p && p !== label) return `${escapeHtml(label)} &middot; ${escapeHtml(p)}`;
  return escapeHtml(label);
}

function _wireAlVerifyBtn() {
  document.getElementById('alVerifyBtn')
    ?.addEventListener('click', _runAlVerify);
}

async function _runAlVerify() {
  const btn    = document.getElementById('alVerifyBtn');
  const result = document.getElementById('alVerifyResult');
  if (!btn || !result || !_alCurrentEventPath) return;

  btn.disabled    = true;
  btn.textContent = 'Verifying…';
  result.innerHTML = '';

  let res;
  try {
    res = await window.api.verifyEventIntegrity(_alCurrentEventPath);
  } catch {
    res = { ok: false, error: 'Verification failed' };
  }

  btn.disabled    = false;
  btn.textContent = 'Verify Integrity';

  if (!res.ok) {
    result.innerHTML = `<div class="al-verify-result al-verify-result--error">${SVG.warn} ${escapeHtml(res.error || 'Verification error')}</div>`;
    return;
  }

  if (res.match) {
    result.innerHTML = `<div class="al-verify-result al-verify-result--ok">${SVG.check} Audit Verified &middot; ${res.actualTotal} file${res.actualTotal === 1 ? '' : 's'} on disk</div>`;
  } else {
    const delta = res.actualTotal - res.expectedTotal;
    const sign  = delta > 0 ? '+' : '';
    result.innerHTML = `<div class="al-verify-result al-verify-result--warn">${SVG.warn} Mismatch &middot; Expected: ${res.expectedTotal} &middot; Found: ${res.actualTotal} (${sign}${delta})</div>`;
  }
}

function _hasEntryIssue(entry) {
  if (!Number.isFinite(entry.timeMs))  return true;
  if (entry.photographer === '—')      return true;
  if (entry.componentName === '—')     return true;
  if (entry.photos <= 0 && entry.videos <= 0) return true;
  return false;
}

function _getEventIssueCount(entries) {
  let count = 0;
  for (const entry of entries) {
    if (_hasEntryIssue(entry)) count++;
  }
  return count;
}

function _groupEntriesByDate(entries) {
  const groups = [];
  let currentDateStr = null;
  let currentGroup   = null;
  for (const entry of entries) {
    const dateStr = new Date(entry.timeMs).toLocaleDateString(undefined, {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    if (dateStr !== currentDateStr) {
      currentDateStr = dateStr;
      currentGroup = { date: dateStr, entries: [] };
      groups.push(currentGroup);
    }
    currentGroup.entries.push(entry);
  }
  return groups;
}

function _renderActivityLogBody(ev, activeData, folderName) {
  const eventName = folderName || ev?.name || ev?.folderName || activeData?.event?.name || '—';
  const collName  = activeData?.coll?.name || null;

  const collRow = collName
    ? `<p class="al-coll-name">${escapeHtml(collName)}</p>`
    : '';
  const headerHTML = `
    <div class="al-event-header">
      <p class="al-event-name">${escapeHtml(eventName)}</p>
      ${collRow}
    </div>`;

  const summary = getEventImportSummary(ev);

  if (!summary) {
    return `${headerHTML}
      <div class="al-empty">
        <div class="al-empty-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="al-empty-title">No imports recorded yet</div>
        <p>Imports will appear here after the first ingest.</p>
      </div>`;
  }

  const mediaParts = [`${summary.totalPhotos} photo${summary.totalPhotos === 1 ? '' : 's'}`];
  if (summary.totalVideos > 0) mediaParts.push(`${summary.totalVideos} video${summary.totalVideos === 1 ? '' : 's'}`);
  const sessionCount = summary.entries.length;
  const sessionLabel = `${sessionCount} import${sessionCount === 1 ? '' : 's'}`;
  const issueCount   = _getEventIssueCount(summary.entries);
  const lastOrWarn   = issueCount > 0
    ? `<span class="al-summary-stat al-summary-warn">Check Imports</span>`
    : (summary.lastImport
        ? `<span class="al-summary-stat">${SVG.clock} Last by ${escapeHtml(summary.lastImport.photographer)} &middot; ${escapeHtml(formatDate(summary.lastImport.timestamp))}</span>`
        : '');
  const summaryHTML = `
    <div class="al-summary-row">
      <span class="al-summary-stat">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        ${mediaParts.join(' &bull; ')}
      </span>
      <span class="al-summary-stat">${escapeHtml(sessionLabel)}</span>
      ${lastOrWarn}
    </div>`;

  const groups = _groupEntriesByDate(summary.entries);
  const groupsHTML = groups.map(({ date, entries }) => {
    const entriesHTML = entries.map(entry => {
      const counts    = mediaCountLabel(entry.photos, entry.videos);
      const badgeHTML = _hasEntryIssue(entry)
        ? `<span class="al-entry-badge al-entry-badge--warn">Check</span>`
        : '';
      const qParts = [];
      if (entry.skipped    > 0) qParts.push(`${entry.skipped} skipped`);
      if (entry.duplicates > 0) qParts.push(`${entry.duplicates} duplicate${entry.duplicates === 1 ? '' : 's'}`);
      const qualityHTML = qParts.length > 0
        ? `<div class="al-entry-quality">${escapeHtml(qParts.join(' • '))}</div>`
        : '';
      const sourceHTML = `<div class="al-entry-source">Source: ${_formatImportSource(entry.source)}</div>`;
      const importedByName = (entry.importedBy?.name && typeof entry.importedBy.name === 'string')
        ? escapeHtml(entry.importedBy.name)
        : 'Not recorded';
      const importedByHTML = `<div class="al-entry-source">Imported by: ${importedByName}</div>`;
      return `
        <div class="al-entry">
          <div class="al-entry-header">
            <span class="al-entry-photographer">${escapeHtml(entry.photographer)}</span>
            <span class="al-entry-time">${escapeHtml(formatDate(entry.timestamp))}</span>
          </div>
          <div class="al-entry-meta">
            <span class="al-entry-component">${escapeHtml(entry.componentName)}</span>
            ${badgeHTML}
            <span class="al-entry-counts">${escapeHtml(counts)}</span>
          </div>
          ${qualityHTML}
          ${sourceHTML}
          ${importedByHTML}
        </div>`;
    }).join('');
    return `
      <div class="al-date-group">
        <div class="al-date-label">${escapeHtml(date)}</div>
        <div class="al-date-entries">${entriesHTML}</div>
      </div>`;
  }).join('');

  return `${headerHTML}
    ${summaryHTML}
    <div class="al-divider"></div>
    <p class="al-section-label">Import History</p>
    ${groupsHTML}
    <div class="al-verify-area">
      <button class="al-verify-btn" id="alVerifyBtn" type="button">Verify Integrity</button>
      <div id="alVerifyResult"></div>
    </div>`;
}

function _renderAlPicker(events, activeFolder) {
  const options = events.map(ev => {
    const folder = ev.folderName || '';
    const sel = folder === activeFolder ? ' selected' : '';
    return `<option value="${escapeHtml(folder)}"${sel}>${escapeHtml(folder)}</option>`;
  }).join('');
  return `<span class="al-picker-label">Event</span>
    <select class="al-picker-select" id="alPickerSelect" aria-label="Select event to view">${options}</select>`;
}

async function _onAlPickerChange(e) {
  const folderName = e.target.value;
  const activeData = EventCreator.getActiveEventData();
  const body       = document.getElementById('alBody');
  if (!body || !folderName || !_alMasterPath) return;
  body.innerHTML = '';

  let ev = null;
  try {
    ev = await window.api.readEventJson(_alMasterPath + '/' + folderName);
  } catch { ev = null; }

  const ctx = folderName === (activeData?.event?.name || '')
    ? activeData
    : { coll: activeData?.coll, event: { name: folderName } };
  body.innerHTML = _renderActivityLogBody(ev, ctx, folderName);
  _alCurrentEventPath = _alMasterPath ? (_alMasterPath + '/' + folderName) : null;
  _wireAlVerifyBtn();
}

async function openActivityLogModal() {
  const overlay   = document.getElementById('activityLogModal');
  const body      = document.getElementById('alBody');
  const pickerRow = document.getElementById('alPickerRow');
  if (!overlay || !body) return;

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  body.innerHTML = '';
  if (pickerRow) pickerRow.innerHTML = '';
  setTimeout(() => document.getElementById('alCloseBtn')?.focus(), 200);

  if (importMode !== 'event') {
    body.innerHTML = `
      <div class="al-empty">
        <div class="al-empty-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
        </div>
        <div class="al-empty-title">Event mode only</div>
        <p>Activity Log shows import history for events.<br>Switch to Event mode and select an event to view history.</p>
      </div>`;
    return;
  }

  const master     = EventCreator.getActiveMaster();
  const activeData = EventCreator.getActiveEventData();

  if (!activeData?.eventPath) {
    body.innerHTML = `
      <div class="al-empty">
        <div class="al-empty-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div class="al-empty-title">No event selected</div>
        <p>Select an event to view its import history.</p>
      </div>`;
    return;
  }

  // Load active event immediately while scan runs in parallel
  let currentEvent = null;
  try {
    currentEvent = await window.api.readEventJson(activeData.eventPath);
  } catch {
    body.innerHTML = `
      <div class="al-empty">
        <div class="al-empty-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div class="al-empty-title">Could not load event data</div>
        <p>The event file could not be read.</p>
      </div>`;
    return;
  }

  if (!currentEvent) {
    body.innerHTML = `
      <div class="al-empty">
        <div class="al-empty-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </div>
        <div class="al-empty-title">Event not found</div>
        <p>The event file could not be found on disk.</p>
      </div>`;
    return;
  }

  const activeFolder = activeData.event?.name || '';
  body.innerHTML = _renderActivityLogBody(currentEvent, activeData, activeFolder);
  _alCurrentEventPath = activeData.eventPath || null;
  _wireAlVerifyBtn();

  // Scan master for all events to populate picker
  if (!master?.path) return;
  _alMasterPath = master.path;
  let rawList = [];
  try {
    rawList = await window.api.scanMasterEvents(master.path);
  } catch { rawList = []; }

  // Strip _eventJson immediately — store only lightweight picker data to prevent OOM.
  // Full event.json is loaded on demand per-event when the picker selection changes.
  _alEventList = (rawList || [])
    .filter(e => e.isParseable && !e.isCorrupt)
    .map(({ folderName, hijriDate, sequence, isLegacy }) => ({
      folderName,
      hijriDate:  hijriDate  || '',
      sequence:   sequence   || '',
      isLegacy:   isLegacy   || false,
    }));

  if (pickerRow && _alEventList.length > 1) {
    pickerRow.innerHTML = _renderAlPicker(_alEventList, activeFolder);
    document.getElementById('alPickerSelect')
      ?.addEventListener('change', _onAlPickerChange);
  }
}

function _renderInsightsBar() {
  const count = Object.keys(globalImportIndex || {}).length;
  const impEl = document.getElementById('ovImportsVal');
  if (impEl) impEl.textContent = count > 0 ? String(count) : '—';
  const lastEntry = Object.values(globalImportIndex || {})
    .sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0))[0];
  const lastEl = document.getElementById('ovLastImportVal');
  if (lastEl) lastEl.textContent = lastEntry?.importedAt
    ? new Date(lastEntry.importedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';
}

function _switchModeCard(toMode) {
  document.getElementById('heroCard')?.classList.toggle('card-active', toMode === 'event');
  document.getElementById('quickImportCard')?.classList.toggle('card-active', toMode === 'quick');
}

function _getEffectiveQuickDest() {
  return quickImportDest || EventCreator.getSessionArchiveRoot() || '';
}

function _syncQiImportBtn() {
  const btn = document.getElementById('qiImportBtn');
  if (btn) btn.disabled = !(activeSource && _getEffectiveQuickDest());
}

function _renderQuickImportCard() {
  const dest = _getEffectiveQuickDest();
  const el   = document.getElementById('qiDestPath');
  if (el) el.textContent = dest
    ? (dest.length > 60 ? '…' + dest.slice(-57) : dest)
    : 'Select a destination to continue';
  _syncQiImportBtn();
}

function _applyImportMode(mode) {
  importMode = mode;
  document.getElementById('modeEventBtn')?.classList.toggle('active', mode === 'event');
  document.getElementById('modeQuickBtn')?.classList.toggle('active', mode === 'quick');
  const srcLocal = document.getElementById('srcLocalFolder');
  if (srcLocal) srcLocal.classList.toggle('hidden', mode === 'quick');
  _switchModeCard(mode);
  if (mode === 'quick') {
    _clearHeroLastImportArea();
    _renderQuickImportCard();
  }
}

function renderHome() {
  _renderHomeContextBar();
  _renderLandingEventCard();
  _renderInsightsBar();
  _applyImportMode(importMode);
  _renderHeroLastImportArea();
}

function _updateMemCardBadge(count) {
  const badge = document.getElementById('srcMemCardBadge');
  if (badge) {
    badge.textContent = String(count);
    badge.classList.toggle('visible', count > 0);
  }
  document.getElementById('srcMemCard')?.classList.toggle('highlighted', count > 0);

  const statusEl = document.getElementById('srcMemCardStatus');
  if (statusEl) {
    statusEl.textContent = count > 0
      ? `${count} card${count > 1 ? 's' : ''} detected`
      : 'No memory cards detected';
    const dot = statusEl.previousElementSibling;
    if (dot) dot.className = count > 0 ? 'src-h-dot src-h-dot--active' : 'src-h-dot';
  }

}

async function chooseSourceFolder() {
  return await window.api.chooseDest();
}

async function selectExternalDrive() {
  const chosen = await chooseSourceFolder();
  if (!chosen) return;
  const label = chosen.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'External Drive';
  _setActiveSource({ type: 'external-drive', name: label, path: chosen });
}

async function selectLocalFolder() {
  const chosen = await chooseSourceFolder();
  if (!chosen) return;
  const label = chosen.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Local Folder';
  _setActiveSource({ type: 'local-folder', name: label, path: chosen });
}

document.getElementById('ecBackBtn')?.addEventListener('click', () => {
  if (!EventCreator.navigateBack()) showLanding();
});
document.getElementById('emmBackBtn')?.addEventListener('click', () => EventMgmt.handleBack());
document.getElementById('emmCloseBtn')?.addEventListener('click', () => EventMgmt.requestClose());
document.getElementById('emmContinueBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('emmContinueBtn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  try {
    const ok = await EventCreator.adoptSelectedEvent();
    if (!ok) console.warn('[emmContinueBtn] adoptSelectedEvent returned false — check _selectedListFolder and _scannedEvents');
    // On success, eventcreator:done fires → showLanding → modal closes. No re-enable needed.
  } finally {
    // Re-enable only if the modal is still open (adoptSelectedEvent failed silently).
    if (EventMgmt.isOpen()) btn.disabled = false;
  }
});
document.getElementById('emmCreateBtn')?.addEventListener('click', () => {
  const btn = document.getElementById('emmCreateBtn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  try {
    EventCreator.tryCreateEvent();
    // On success, eventcreator:done fires → showLanding → modal closes. No re-enable needed.
  } finally {
    // Re-enable only if the modal is still open (validation failed or exception thrown).
    if (EventMgmt.isOpen()) btn.disabled = false;
  }
});
document.getElementById('emmEditBtn')?.addEventListener('click', async () => {
  // Point 4: setMode first so the footer updates before the form renders.
  EventMgmt.setMode('edit');
  const ok = await EventCreator.editSelectedEvent();
  if (!ok) EventMgmt.setMode('select');
});
document.getElementById('emmSaveBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('emmSaveBtn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  try {
    await EventCreator.saveEditedEvent();
    // On success, eventcreator:done fires → showLanding. No re-enable needed.
  } finally {
    if (EventMgmt.isOpen()) btn.disabled = false;
  }
});
document.getElementById('emmRepairBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('emmRepairBtn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  try {
    await EventCreator.tryRepairEvent();
    // On success, returns to event list with preselected event. No re-enable needed.
  } finally {
    if (EventMgmt.isOpen()) btn.disabled = false;
  }
});
document.addEventListener('eventcreator:listSelect', () => {
  const cont = document.getElementById('emmContinueBtn');
  if (cont) cont.disabled = false;
  const edit = document.getElementById('emmEditBtn');
  if (edit) edit.style.display = '';
});
// Point 8: deselect — restore disabled/hidden state on Continue + Edit.
document.addEventListener('eventcreator:listDeselect', () => {
  const cont = document.getElementById('emmContinueBtn');
  if (cont) cont.disabled = true;
  const edit = document.getElementById('emmEditBtn');
  if (edit) edit.style.display = 'none';
});
document.addEventListener('eventmgmt:requestClose', showLanding);
document.addEventListener('eventcreator:done', () => {
  GroupManager.reset();
  renderGroupPanel();
  showLanding();
});
document.getElementById('srcExtDriveBtn')?.addEventListener('click', selectExternalDrive);
document.getElementById('srcLocalFolderBtn')?.addEventListener('click', selectLocalFolder);
document.getElementById('modeEventBtn')?.addEventListener('click', () => {
  _applyImportMode('event');
  _renderHeroLastImportArea();
});
document.getElementById('modeQuickBtn')?.addEventListener('click', () => {
  _applyImportMode('quick');
  _renderHeroLastImportArea();
});

document.getElementById('qiChangeDestBtn')?.addEventListener('click', async () => {
  const chosen = await window.api.chooseDest();
  if (chosen) {
    quickImportDest = chosen;
    localStorage.setItem('quickImportDest', chosen);
    _renderQuickImportCard();
  }
});

document.getElementById('qiImportBtn')?.addEventListener('click', async () => {
  const dest = _getEffectiveQuickDest();
  if (!activeSource || !dest) return;
  const btn = document.getElementById('qiImportBtn');
  showSourceScanState(activeSource.name);
  if (btn) btn.disabled = true;
  try {
    await setDestPath(dest);
    const { type: srcType, path: srcPath, name: srcName } = activeSource;
    await selectSource({ type: srcType, path: srcPath, label: srcName });
  } finally {
    hideSourceScanState();
    const b = document.getElementById('qiImportBtn');
    if (b) b.disabled = false;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && EventMgmt.isOpen()) EventMgmt.requestClose();
  if (e.key === 'Escape' && document.getElementById('activityLogModal')?.classList.contains('open')) _alClose();
});

document.getElementById('ovActivityLog')?.addEventListener('click', openActivityLogModal);
document.getElementById('ovActivityLog')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openActivityLogModal(); }
});
document.getElementById('alCloseBtn')?.addEventListener('click', _alClose);
document.getElementById('alCloseFooterBtn')?.addEventListener('click', _alClose);

// ════════════════════════════════════════════════════════════════
// DRIVE METADATA HELPERS
// ════════════════════════════════════════════════════════════════

function _formatCapacity(bytes) {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${Math.round(gb)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${Math.round(mb)} MB`;
}

function _inferCardType(drive) {
  const bus  = (drive.busType    || '').toUpperCase();
  const desc = (drive.description || '').toLowerCase();
  if (bus === 'SD' || drive.isCard) {
    if (desc.includes('sdxc')) return 'SDXC';
    if (desc.includes('sdhc')) return 'SDHC';
    if (desc.includes('sdsc') || desc.includes('sd ')) return 'SD';
    return 'SD Card';
  }
  if (bus === 'USB') return 'USB';
  if (bus === 'ATA' || bus === 'SATA') return 'SSD';
  if (bus === 'NVME') return 'NVMe';
  return '';
}

function _buildDeviceMeta(drive) {
  const parts = [drive.mountpoint];
  const cap  = _formatCapacity(drive.size);
  if (cap) parts.push(cap);
  const type = _inferCardType(drive);
  if (type) parts.push(type);
  return parts.join(' • '); // bullet separator
}

// ════════════════════════════════════════════════════════════════
// DRIVE SELECTION
// ════════════════════════════════════════════════════════════════
function renderDrives(cards) {
  document.getElementById('statusDrives').textContent =
    `Drives scanned: ${new Date().toLocaleTimeString()}`;
  _updateMemCardBadge(cards.length);
  _currentMemCardMountpoints = new Set(cards.map(c => c.mountpoint));

  // ── Disconnect detection: active workspace drive removed ───────
  // Only check DCIM presence when the active source IS a memory card.
  // Local folder and external drive paths never appear in the DCIM card list.
  if (activeDrive && activeSource?.type === 'memory-card') {
    const stillPresent = cards.some(c => c.mountpoint === activeDrive.mountpoint);
    if (!stillPresent) {
      window.api.abortCopy();
      importRunning = false;
      document.getElementById('progressOverlay').classList.remove('visible');
      showMessage('Card disconnected. Import cancelled.');
      resetAppState();
      return;
    }
  }

  // ── Disconnect detection: selected source card removed ─────────
  if (activeSource && activeSource.type === 'memory-card') {
    const stillPresent = cards.some(c => c.mountpoint === activeSource.path);
    if (!stillPresent) {
      activeSource = null;
      _renderLandingEventCard();
    }
  }

  // ── Render drive list inside the Memory Card source card ───────
  const list = document.getElementById('srcMemCardList');
  if (!list) return;

  const newKey = cards.map(c => c.mountpoint).join('|');

  if (newKey === _prevDriveKeys) {
    // List unchanged — sync selection highlights only (prevents DOM-rebuild flicker)
    const selectedPath = activeSource?.type === 'memory-card' ? activeSource.path : null;
    list.querySelectorAll('.src-device-item').forEach(item => {
      const sel = item.dataset.mountpoint === selectedPath;
      item.classList.toggle('selected', sel);
      const chk = item.querySelector('.src-device-check');
      if (chk) chk.innerHTML = sel ? SVG.check : '';
    });
    return;
  }
  _prevDriveKeys = newKey;

  if (!cards.length) {
    list.innerHTML = `<div class="src-device-empty-row"><span class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2h11v20H4V8z"/></svg></span><span>No memory cards detected</span><span class="empty-sub">Connect a camera card to continue</span></div>`;
    return;
  }

  const selectedPath = activeSource?.type === 'memory-card' ? activeSource.path : null;
  list.innerHTML = cards.map(c => {
    const isSel = c.mountpoint === selectedPath;
    return `<div class="src-device-item${isSel ? ' selected' : ''}"
         data-mountpoint="${escapeHtml(c.mountpoint)}"
         data-label="${escapeHtml(c.label)}">
      <svg class="device-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2h11v20H4V8z"/><path d="M9 14v5M12 14v5M15 14v5"/></svg>
      <div style="flex:1;min-width:0">
        <div class="src-device-item-name">${escapeHtml(c.label)}</div>
        <div class="src-device-item-meta">${escapeHtml(_buildDeviceMeta(c))}</div>
      </div>
      <div class="src-device-check">${isSel ? SVG.check : ''}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.src-device-item').forEach(el => {
    el.addEventListener('click', () => {
      _setActiveSource({ type: 'memory-card', name: el.dataset.label, path: el.dataset.mountpoint });
      // Sync selection visuals immediately (no full re-render of list)
      list.querySelectorAll('.src-device-item').forEach(item => {
        const sel = item.dataset.mountpoint === el.dataset.mountpoint;
        item.classList.toggle('selected', sel);
        const chk = item.querySelector('.src-device-check');
        if (chk) chk.innerHTML = sel ? SVG.check : '';
      });
      // Confirmation pulse
      el.classList.add('just-selected');
      el.addEventListener('animationend', () => el.classList.remove('just-selected'), { once: true });
    });
  });
}

function renderExtDrives(cards) {
  const list = document.getElementById('srcExtDriveList');
  if (!list) return;

  const filtered = cards.filter(c => c.mountpoint && !_currentMemCardMountpoints.has(c.mountpoint));

  // Disconnect detection: selected ext drive removed
  if (activeSource && activeSource.type === 'external-drive') {
    const stillPresent = filtered.some(c => c.mountpoint === activeSource.path);
    if (!stillPresent) {
      activeSource = null;
      _renderLandingEventCard();
    }
  }
  const newKey   = filtered.map(c => c.mountpoint).join('|');

  if (newKey === _prevExtKeys) {
    // List unchanged — sync selection highlights only
    const selectedPath = activeSource?.type === 'external-drive' ? activeSource.path : null;
    list.querySelectorAll('.src-device-item').forEach(item => {
      const sel = item.dataset.mountpoint === selectedPath;
      item.classList.toggle('selected', sel);
      const chk = item.querySelector('.src-device-check');
      if (chk) chk.innerHTML = sel ? SVG.check : '';
    });
    return;
  }
  _prevExtKeys = newKey;

  if (!filtered.length) {
    list.innerHTML = `<div class="src-device-empty-row"><span class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="17" cy="12" r="1.5"/><path d="M6 12h6"/></svg></span><span>No external drives detected</span><span class="empty-sub">Connect a drive to continue</span></div>`;
    return;
  }

  const selectedPath = activeSource?.type === 'external-drive' ? activeSource.path : null;
  list.innerHTML = filtered.map(d => {
    const name = d.label || d.device || d.mountpoint;
    const isSel = d.mountpoint === selectedPath;
    return `<div class="src-device-item${isSel ? ' selected' : ''}"
         data-mountpoint="${escapeHtml(d.mountpoint)}"
         data-label="${escapeHtml(name)}">
      <svg class="device-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="17" cy="12" r="1.5"/><path d="M6 12h6"/></svg>
      <div style="flex:1;min-width:0">
        <div class="src-device-item-name">${escapeHtml(name)}</div>
        <div class="src-device-item-meta">${escapeHtml(d.busType || 'USB')}</div>
      </div>
      <div class="src-device-check">${isSel ? SVG.check : ''}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.src-device-item').forEach(el => {
    el.addEventListener('click', () => {
      _setActiveSource({ type: 'external-drive', name: el.dataset.label, path: el.dataset.mountpoint });
      list.querySelectorAll('.src-device-item').forEach(item => {
        const sel = item.dataset.mountpoint === el.dataset.mountpoint;
        item.classList.toggle('selected', sel);
        const chk = item.querySelector('.src-device-check');
        if (chk) chk.innerHTML = sel ? SVG.check : '';
      });
      el.classList.add('just-selected');
      el.addEventListener('animationend', () => el.classList.remove('just-selected'), { once: true });
    });
  });
}

async function selectSource({ type, path, label = null, driveObj = null }) {
  if (!type || !path) {
    console.error('selectSource: invalid source', { type, path });
    return;
  }
  if (isShuttingDown) return; // Patch 13: block during eject
  // Reject concurrent calls — a second click while loading would create a stale
  // browseFolder race. The first call's own ++fileLoadRequestId inside browseFolder
  // makes subsequent calls supersede it; guard here so only one proceeds at a time.
  if (isLoadingFiles) return;

  const parts = path.split(/[\\/]/);
  const name  = label || parts[parts.length - 1] || path;

  hasSelectedDrive = true;
  isLoadingFiles   = false;
  currentFolder    = null;

  activeSource     = { type, path, name };
  activeDrive      = (type === 'memory-card' || type === 'external-drive') ? (driveObj || { mountpoint: path, label: name }) : null;
  activeFolderPath = null;

  expandedFolders.clear(); dcimChildrenCache = []; cachedDcimPath = null;
  selectedFiles.clear(); currentFiles = []; lastClickedPath = null; _selectionAnchor = null; _prevFocusPath = null; tileMap = new Map();
  resetViewCache();
  GroupManager.reset();
  renderGroupPanel();

  // Prepare workspace while still hidden — DOM updates on hidden elements are safe
  document.getElementById('folderList').innerHTML =
    `<div class="sidebar-empty">Loading folders…</div>`;

  // Load files BEFORE transitioning the UI (requirement 7: never render before files exist)
  isLoadingFiles = true;
  const loaded = await browseFolder(path, null);

  // browseFolder returns undefined when a newer request superseded this one.
  // Distinguish that from false (genuine IPC/render failure) before the
  // activeSource path guard — a double-click keeps activeSource.path the same,
  // so the path guard alone can't detect the superseded case.
  if (loaded === undefined) { isLoadingFiles = false; return; }

  // Abort if another selectSource() call changed the active source mid-load.
  if (activeSource?.path !== path) { isLoadingFiles = false; return; }

  // Abort if IPC failed — browseFolder already rendered the error into the workspace.
  if (!loaded) {
    isLoadingFiles = false;
    console.error('selectSource: file load failed — aborting workspace transition');
    return;
  }

  isLoadingFiles = false;

  // Files ready — reveal workspace; tiles already rendered by browseFolder
  document.getElementById('step1Panel').style.display = 'none';
  document.getElementById('workspace').classList.add('visible');
  updateSteps(); updateSelectionBar();
  _updateContextBar();
}

document.getElementById('changeDriveBtn').addEventListener('click', () => {
  hideSourceScanState();
  resetWorkspaceState();
  hasSelectedDrive = false;
  isLoadingFiles   = false;
  currentFolder    = null;
  fileLoadRequestId++;
  activeDrive = null; activeFolderPath = null; activeSource = null;
  expandedFolders.clear(); dcimChildrenCache = []; cachedDcimPath = null;
  selectedFiles.clear(); currentFiles = []; lastClickedPath = null; _selectionAnchor = null; _prevFocusPath = null; tileMap = new Map();
  resetViewCache();
  document.getElementById('workspace').classList.remove('visible');
  document.getElementById('step1Panel').style.display = '';
  updateSteps(); updateSelectionBar();
  _updateContextBar();
  renderHome();
});

function showSourceScanState(label) {
  const el  = document.getElementById('sourceScanState');
  const sub = document.getElementById('scanSubtitle');
  if (!el) return;
  if (sub) sub.textContent = label ? `Scanning ${label}` : 'Preparing media list';
  el.classList.remove('hidden');
}

function hideSourceScanState() {
  const el = document.getElementById('sourceScanState');
  if (el) el.classList.add('hidden');
}

/**
 * resetAppState — called after eject or device disconnect.
 * Clears all drive/file state and returns UI to the landing screen.
 */
function resetAppState() {
  hideSourceScanState();
  closePreview();
  _csqEligibleFiles = null;
  _csqSourceRoot    = null;
  hasSelectedDrive  = false;
  isLoadingFiles    = false;
  currentFolder     = null;
  fileLoadRequestId++;   // invalidate any in-flight file loads

  activeDrive      = null;
  activeFolderPath = null;
  activeSource     = null;
  lastClickedPath  = null;
  _selectionAnchor = null;
  _prevFocusPath   = null;
  importRunning    = false;
  isShuttingDown   = false;  // cleared last — safe to accept a new card
  expandedFolders.clear(); dcimChildrenCache = []; cachedDcimPath = null;

  selectedFiles.clear();
  currentFiles = [];
  destFileCache = new Map();
  resetViewCache();
  GroupManager.reset();
  renderGroupPanel();

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
  const _bc0 = document.getElementById('breadcrumb'); if (_bc0) _bc0.textContent = '';

  // Hide workspace + event modal, show landing screen
  document.getElementById('workspace').classList.remove('visible');
  EventMgmt.close();
  EventCreator.resetSelection();
  document.getElementById('step1Panel').style.display = '';
  setRailMode('card');

  updateSteps();
  updateSelectionBar();
  _updateContextBar();
  renderHome();
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
  // Commit 12c: show a confirmation modal before resetting UI. Previously a
  // 4-second toast in the footer was routinely missed because the UI jumped
  // back to the drive-list screen at the same moment. Reset only AFTER the
  // user clicks OK.
  const overlay = document.getElementById('ejectOverlay');
  const modal   = document.getElementById('ejectModal');
  const icon    = document.getElementById('ejectIcon');
  const title   = document.getElementById('ejectTitle');
  const msg     = document.getElementById('ejectMessage');
  const okBtn   = document.getElementById('ejectOkBtn');

  if (modal) modal.classList.toggle('eject-failure', !ejected);
  if (icon)  icon.innerHTML    = ejected ? SVG.checkCircle : SVG.warnCircle;
  if (title) title.textContent = ejected ? 'Card safely ejected' : 'Eject failed';
  if (msg)   msg.textContent   = ejected
    ? 'You can now safely remove the card from your computer.'
    : 'The card could not be unmounted. Please close any open files and try again, or remove it manually.';

  await new Promise(resolve => {
    const done = () => {
      if (overlay) overlay.classList.remove('visible');
      if (okBtn)   okBtn.removeEventListener('click', done);
      document.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (e) => { if (e.key === 'Enter' || e.key === 'Escape') done(); };
    if (okBtn)   okBtn.addEventListener('click', done);
    document.addEventListener('keydown', onKey);
    if (overlay) overlay.classList.add('visible');
    if (okBtn)   okBtn.focus();
  });

  // NOW reset the UI and re-poll drives so the drive list is fresh.
  resetAppState();  // clears isShuttingDown as its last step
  try { await window.api.getDrives(); } catch {}
});

// ════════════════════════════════════════════════════════════════
// FOLDER SIDEBAR
// ════════════════════════════════════════════════════════════════

// Sidebar SVG icon constants — 14×14px, stroke-based, currentColor, matches toolbar system
const _SVG_CHEVRON_DOWN  = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const _SVG_CHEVRON_RIGHT = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
const _SVG_FOLDER        = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
const _SVG_SD_CARD       = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2h11v20H4V8z"/><path d="M9 14v5M12 14v5M15 14v5"/></svg>`;
const _SVG_HDD           = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="17" cy="12" r="1.5"/></svg>`;
const _SVG_LEAF_DOT      = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`;
const _SVG_FOLDER_LG     = `<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
const _SVG_SEARCH_LG     = `<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
const _SVG_CLOCK_SM      = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const _SVG_CHECK_XS      = `<svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="1.5 6 4.5 9 10.5 3"/></svg>`;
const _SVG_SECT_RAW      = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 23v-3M15 23v-3M1 9h3M1 15h3M23 9h-3M23 15h-3"/></svg>`;
const _SVG_SECT_PHOTO    = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
const _SVG_SECT_VIDEO    = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;

// Returns the source-type-specific icon for root nodes.
function getSourceIcon(sourceType) {
  switch (sourceType) {
    case 'memory-card':    return _SVG_SD_CARD;
    case 'external-drive': return _SVG_HDD;
    case 'local-folder':   return _SVG_FOLDER;
    default:               return _SVG_FOLDER;
  }
}

// Node-aware icon: root reflects source type, every child node is always a folder.
function getNodeIcon(node, sourceType) {
  return node.isRoot ? getSourceIcon(sourceType) : _SVG_FOLDER;
}

function renderFolders(folders, dcimPath) {
  const list = document.getElementById('folderList');

  // --- Path A: legacy flat-array shape (pre-Commit-6 callers) ---
  // Kept for backward compat in case any pre-tree code path reaches here.
  if (Array.isArray(folders)) {
    if (!cachedDcimPath || activeFolderPath === dcimPath) {
      if (!cachedDcimPath) expandedFolders.add(dcimPath);
      dcimChildrenCache = folders;
      cachedDcimPath    = dcimPath;
    }
    const isExpanded = expandedFolders.has(dcimPath);
    const childrenHtml = isExpanded
      ? dcimChildrenCache.map(f => `
          <div class="folder-item folder-child${activeFolderPath === f.path ? ' active' : ''}"
               data-path="${escapeHtml(f.path)}">
            <span class="fi-toggle" style="opacity:0;pointer-events:none">${_SVG_LEAF_DOT}</span>
            <span class="fi-icon">${_SVG_FOLDER}</span>
            <span class="fi-name">${escapeHtml(f.name)}</span>
          </div>`).join('')
      : '';
    list.innerHTML = `
      <div class="folder-item folder-root${activeFolderPath === dcimPath ? ' active' : ''}"
           data-path="${escapeHtml(dcimPath)}">
        <span class="fi-toggle">${isExpanded ? _SVG_CHEVRON_DOWN : _SVG_CHEVRON_RIGHT}</span>
        <span class="fi-icon">${getNodeIcon({ isRoot: true }, activeSource?.type)}</span>
        <span class="fi-name">${escapeHtml(cardDisplayName(dcimPath))}</span>
      </div>
      ${childrenHtml}`;
    wireFolderListClicks(list, { treeMode: false, dcimPath });
    return;
  }

  // --- Path B: tree-mode (Commit 11b) ---
  // folders is the currentFolderTree object {name, path, children, files}.
  const tree = folders;
  if (!tree || typeof tree !== 'object') {
    list.innerHTML = '';
    return;
  }
  // Auto-expand root on first render.
  if (!expandedFolders.has(tree.path)) expandedFolders.add(tree.path);

  const rootName = cardDisplayName(tree.path) || tree.name || 'Card';
  const active   = (currentFolderContext && currentFolderContext.path) || null;

  const rootHtml = `
    <div class="folder-item folder-root${active === tree.path || currentFolderContext.isRoot ? ' active' : ''}"
         data-path="${escapeHtml(tree.path)}">
      <span class="fi-toggle">${expandedFolders.has(tree.path) ? _SVG_CHEVRON_DOWN : _SVG_CHEVRON_RIGHT}</span>
      <span class="fi-icon">${getNodeIcon({ isRoot: true }, activeSource?.type)}</span>
      <span class="fi-name">${escapeHtml(rootName)}</span>
    </div>`;

  const childrenHtml = expandedFolders.has(tree.path)
    ? tree.children.map(c => renderTreeNodeRecursive(c, 1, active)).join('')
    : '';

  list.innerHTML = rootHtml + childrenHtml;
  wireFolderListClicks(list, { treeMode: true, dcimPath: tree.path });

  requestAnimationFrame(() => {
    const activeEl = list.querySelector('.folder-item.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

// Recursively render one tree node and its expanded descendants.
function renderTreeNodeRecursive(node, depth, activePath) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded  = expandedFolders.has(node.path);
  const isActive    = activePath === node.path;
  const indent     = 8 + depth * 14;
  const toggleSvg  = hasChildren ? (isExpanded ? _SVG_CHEVRON_DOWN : _SVG_CHEVRON_RIGHT) : _SVG_LEAF_DOT;
  const toggleAttr = hasChildren ? '' : ' style="opacity:0;pointer-events:none"';
  const html = `
    <div class="folder-item folder-child${isActive ? ' active' : ''}"
         data-path="${escapeHtml(node.path)}"
         style="padding-left:${indent}px">
      <span class="fi-toggle"${toggleAttr}>${toggleSvg}</span>
      <span class="fi-icon">${_SVG_FOLDER}</span>
      <span class="fi-name">${escapeHtml(node.name)}</span>
    </div>`;
  const kids = (hasChildren && isExpanded)
    ? node.children.map(c => renderTreeNodeRecursive(c, depth + 1, activePath)).join('')
    : '';
  return html + kids;
}

// Derive a human-friendly name for the drive root from its path.
// /Volumes/EOS_DIGITAL -> EOS_DIGITAL
// C:\ -> C:
function cardDisplayName(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

// Shared click wiring for the sidebar. Called after every innerHTML rewrite.
function wireFolderListClicks(list, opts) {
  // Toggle chevrons (expand/collapse) without navigating.
  list.querySelectorAll('.fi-toggle').forEach(t => {
    t.addEventListener('click', e => {
      e.stopPropagation();
      const item = t.closest('.folder-item');
      if (!item) return;
      const p = item.dataset.path;
      if (!p) return;
      if (expandedFolders.has(p)) expandedFolders.delete(p);
      else                         expandedFolders.add(p);
      // Re-render the sidebar. In tree mode we pass the tree; in flat mode the cached array.
      if (opts.treeMode) renderFolders(currentFolderTree, opts.dcimPath);
      else               renderFolders(dcimChildrenCache, opts.dcimPath);
    });
  });

  // Row clicks navigate.
  list.querySelectorAll('.folder-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!activeSource) return;
      const p = item.dataset.path;
      if (!p) return;
      if (opts.treeMode) {
        // Tree mode: use pre-built tree; no rescan.
        if (p === opts.dcimPath) {
          exitToFolderRoot();
        } else {
          enterFolderView(p);
        }
      } else {
        // Legacy flat-list mode: IPC rescan.
        browseFolder(activeSource.path, p);
      }
    });
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

  // Commit 11b: sidebar is only useful in Folder view. Hide it in Media view
  // so users understand the flat list is the whole card. Show it in Folder view
  // as the primary navigation surface.
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = (viewModeType === 'folder') ? '' : 'none';


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

  // Commit 11d: strict leaf-only render. Intermediate folders (with subfolders)
  // show the same instruction panel; only leaves show files. This forces the
  // sidebar drill-down so users always know which specific folder the media
  // lives in.
  if (!currentFolderContext.isLeaf) {
    renderFolderOnly();
    return;
  }

  // Leaf folder: render its files through the existing pipeline.
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

  const isLeaf = !target.children || target.children.length === 0;
  currentFolderContext = {
    path:   target.path,
    files:  files,
    isRoot: false,
    isLeaf: isLeaf,
  };
  // Ensure renderFileArea's empty-state check passes.
  currentFolder = target.path;
  currentFiles  = files;
  // Clear any cached pairing/timeline view so sort applies cleanly to new scope.
  resetViewCache();
  // Reset scroll and re-render through the dispatcher.
  const area = document.getElementById('fileGrid');
  if (area) area.scrollTop = 0;
  // Commit 12b: refresh sidebar so the newly-active folder row gets the blue highlight.
  if (currentFolderTree) renderFolders(currentFolderTree, currentFolderTree.path);
  renderCurrentView();
  updateSteps();
}

function exitToFolderRoot() {
  currentFolderContext = { path: null, files: [], isRoot: true, isLeaf: false };
  // When returning to folder root, currentFiles must NOT stay scoped to the
  // subfolder. Restore the whole-card file list from... wait, we don't keep
  // that separately. Recompute from the tree.
  if (currentFolderTree) {
    currentFiles = collectFilesRecursive(currentFolderTree);
    currentFiles.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
  }
  currentFolder = currentFolderTree ? currentFolderTree.path : null;
  resetViewCache();
  // Commit 12b: refresh sidebar so active-row highlight is cleared.
  if (currentFolderTree) renderFolders(currentFolderTree, currentFolderTree.path);
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

// Commit 11c (v0.6.0): folder-view root state.
// Navigation happens exclusively through the sidebar tree; the right side
// never shows clickable folder cards. When no folder is selected, show an
// instruction panel pointing users to the sidebar.
function renderFolderOnly() {
  const area = document.getElementById('fileGrid');
  if (!area) return;
  area.onscroll = null;
  area.className = '';

  if (!currentFolderTree) {
    area.innerHTML = `<div class="panel-state"><span class="state-icon">${_SVG_FOLDER_LG}</span><span>No card loaded</span></div>`;
    updateSelectionBar();
    return;
  }

  area.innerHTML =
      `<div class="panel-state">`
    +   `<span class="state-icon">${_SVG_FOLDER_LG}</span>`
    +   `<span>Pick a folder from the left to view its files</span>`
    +   `<span style="font-size:0.75rem;opacity:0.55;margin-top:4px">Drill into a folder to see its media</span>`
    + `</div>`;
  updateSelectionBar();
}

document.getElementById('viewMediaBtn').addEventListener('click', () => {
  if (viewModeType === 'media') return;
  viewModeType = 'media';
  document.getElementById('viewMediaBtn').classList.add('view-active');
  document.getElementById('viewFolderBtn').classList.remove('view-active');
  // Commit 14: reset scroll on view toggle so the user doesn't land mid-list.
  const fg = document.getElementById('fileGrid');
  if (fg) fg.scrollTop = 0;
  renderCurrentView();
  syncViewToggles();
});

document.getElementById('viewFolderBtn').addEventListener('click', () => {
  if (viewModeType === 'folder') return;
  viewModeType = 'folder';
  document.getElementById('viewFolderBtn').classList.add('view-active');
  document.getElementById('viewMediaBtn').classList.remove('view-active');
  // Commit 14: reset scroll on view toggle so the user doesn't land mid-list.
  const fg = document.getElementById('fileGrid');
  if (fg) fg.scrollTop = 0;
  renderCurrentView();
  syncViewToggles();
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
  syncViewToggles();
});
document.getElementById('viewListBtn').addEventListener('click', () => {
  if (viewMode === 'list') return;  // no-op if already in list mode
  viewMode = 'list';
  document.getElementById('viewListBtn').classList.add('view-active');
  document.getElementById('viewIconBtn').classList.remove('view-active');
  if (currentFiles.length) renderFileArea(currentFiles);  // legitimate re-render
  syncViewToggles();
});


document.getElementById('timelineViewBtn').addEventListener('click', () => {
  timelineMode = !timelineMode;
  document.getElementById('timelineViewBtn').classList.toggle('view-active', timelineMode);
  resetViewCache();
  if (currentFiles.length) renderFileArea(currentFiles);
  syncViewToggles();
});

document.getElementById('pairToggle').addEventListener('change', e => {
  pairingEnabled = e.target.checked;
  resetViewCache();
  if (currentFiles.length) renderFileArea(currentFiles);
});

// Media/Folder toggle: unchecked = Media (left/default), checked = Folder (right)
document.getElementById('mediaFolderSwitch').addEventListener('change', e => {
  if (_syncingToggles) return;
  if (e.target.checked) document.getElementById('viewFolderBtn').click();
  else document.getElementById('viewMediaBtn').click();
});

// Grid/List toggle: unchecked = Grid (left/default), checked = List (right)
// Inlined directly — avoids relying on hidden button .click() dispatch.
document.getElementById('gridListSwitch').addEventListener('change', e => {
  if (_syncingToggles) return;
  const next = e.target.checked ? 'list' : 'icon';
  if (viewMode === next) return;
  viewMode = next;
  if (currentFiles.length) renderFileArea(currentFiles);
  syncViewToggles();
});

// Timeline toggle switch — proxies to the hidden timelineViewBtn
document.getElementById('timelineSwitch').addEventListener('change', () => {
  if (_syncingToggles) return;
  document.getElementById('timelineViewBtn').click();
});

// Syncs toggle switch checked states to match current JS state variables.
// Called after any programmatic view change so UI never drifts.
// Convention: unchecked = left option, checked = right option.
function syncViewToggles() {
  _syncingToggles = true;
  const mf = document.getElementById('mediaFolderSwitch');
  const gl = document.getElementById('gridListSwitch');
  const tl = document.getElementById('timelineSwitch');
  if (mf) mf.checked = (viewModeType === 'folder');
  if (gl) gl.checked = (viewMode === 'list');
  if (tl) tl.checked = timelineMode;
  _syncingToggles = false;
}

// ════════════════════════════════════════════════════════════════
// RENDER FILE AREA
// Called ONLY on: folder change, sort change, view change, initial load.
// NEVER called on: scroll, selection toggle, dest change, post-import.
// ════════════════════════════════════════════════════════════════
function renderFileArea(files) {
  if (!currentFiles) {
    console.error('renderFileArea called without files — aborting');
    return;
  }
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
    area.innerHTML = `<div class="panel-state"><span class="state-icon">${_SVG_FOLDER_LG}</span><span>Select a folder to begin</span><span style="font-size:0.75rem;opacity:0.6">Choose DCIM or a subfolder from the left panel</span></div>`;
    updateSelectionBar();
    return;
  }
  if (!files.length) {
    area.className = '';
    area.innerHTML = `<div class="panel-state"><span class="state-icon">${_SVG_SEARCH_LG}</span><span>No supported media files found in this folder</span></div>`;
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
      { key:'raw',   label:'RAW Files',   icon:_SVG_SECT_RAW,   files: files.filter(f => f.type === 'raw')   },
      { key:'photo', label:'Image Files', icon:_SVG_SECT_PHOTO, files: files.filter(f => f.type === 'photo') },
      { key:'video', label:'Video Files', icon:_SVG_SECT_VIDEO, files: files.filter(f => f.type === 'video') },
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

  // Restore preview-focus ring after render (pv-focused not baked into HTML)
  if (lastClickedPath) {
    tileMap.get(lastClickedPath)?.classList.add('pv-focused');
    _prevFocusPath = lastClickedPath;
  }

  area.onscroll = handleFileGridScroll;

  // Note: NO per-tile addEventListener here.
  // ALL tile interaction is handled by the delegated listener below.

  // Patch 31: delegated error listener for image load failures
  area.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('thumb-img')) return;
    if (img.dataset.loaded === 'error') return;
    const accentHex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#89b4fa';
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG_FALLBACK_PHOTO.replace(/currentColor/g, accentHex))}`;
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
      <span class="section-toggle" data-group="${key}">${collapsed ? SVG.chevronRight : SVG.chevronDown}</span>
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
    const tileCls      = 'file-tile' + (checked ? ' selected' : '') + (imported ? ' already-imported' : '') + pairCls;
    const importedLabel = imported ? `<div class="file-imported-label">${_SVG_CHECK_XS}Imported</div>` : '';
    const grp           = GroupManager.getGroupForFile(file.path);
    const grpBadge      = grp
      ? `<div class="file-group-badge" style="--group-color:${GroupManager.getGroupColor(GroupManager.getGroupIndex(grp.id))}">${grp.label}</div>`
      : '';

    return `<div class="${tileCls}" data-path="${escapeHtml(file.path)}" data-size="${file.size}" data-base="${escapeHtml(base)}" draggable="true">
      <input type="checkbox" ${checked ? 'checked' : ''} data-path="${escapeHtml(file.path)}" />
      ${importedLabel}
      <div class="file-thumb">${thumbHtml(file)}</div>
      <div class="file-meta">
        <div class="file-meta-row">
          <div class="file-meta-left">
            <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
            <div class="file-details">
              <span class="file-ext-badge ${badgeCls}">${extUp}</span>
              <span class="file-size">${formatSize(file.size)}</span>
            </div>
            <div class="file-date">${formatDate(file.modifiedAt)}</div>
          </div>
          <div class="file-meta-right">${grpBadge}</div>
        </div>
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
    const dupLabel = imported ? `<span class="dup-list-badge">Imported</span>` : '';
    const grpR     = GroupManager.getGroupForFile(file.path);
    const grpLabel = grpR
      ? `<span class="grp-badge-list" style="--group-color:${GroupManager.getGroupColor(GroupManager.getGroupIndex(grpR.id))}">${grpR.label}</span>`
      : '';

    return `<tr class="${rowCls}" data-path="${escapeHtml(file.path)}" data-size="${file.size}" data-base="${escapeHtml(base)}" draggable="true">
      <td class="lt-check"><input type="checkbox" ${checked ? 'checked' : ''} data-path="${escapeHtml(file.path)}" /></td>
      <td class="lt-thumb"><div class="list-thumb">${thumbHtml(file)}</div></td>
      <td class="lt-name"><span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>${dupLabel}${grpLabel}</td>
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
        <span class="timeline-icon">${_SVG_CLOCK_SM}</span>
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
    toggle.innerHTML = collapsedGroups[group] ? SVG.chevronRight : SVG.chevronDown;
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
  // Returning early prevents the click from also reaching handleTileClick,
  // avoiding a double-trigger (click + change both calling handleTileClick).
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
  handleTileClick(tile.dataset.path, e.shiftKey, e.metaKey || e.ctrlKey);
});

// Separate delegated listener for checkbox change events
document.getElementById('fileGrid').addEventListener('change', e => {
  if (e.target.type !== 'checkbox') return;
  const path = e.target.dataset.path;
  if (!path) return;
  handleTileClick(path, false, true);  // checkbox = explicit import selection (always ctrlKey semantics)
  // Restore checkbox visual state to match selectedFiles (handleTileClick already syncs)
});

// ── Drag-and-drop: source (file grid) ────────────────────────────────────────
// Tiles are made draggable via draggable="true" in buildIconTilesHtml /
// buildListRowsHtml. Drag all currently-selected files when the dragged tile
// is inside the selection; otherwise drag only the single tile.

function _buildDragGhost(paths) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';

  // Try to reuse the thumbnail from the first tile in tileMap
  const firstTile = tileMap.get(paths[0]);
  const firstImg  = firstTile?.querySelector('img');
  const thumbHtml = (firstImg && firstImg.src && firstImg.src.startsWith('file://'))
    ? `<div class="drag-ghost-thumb"><img src="${firstImg.src}" alt="" draggable="false"></div>`
    : `<div class="drag-ghost-thumb"><svg width="12" height="14" viewBox="0 0 12 14" fill="none">
        <rect x="1" y="1" width="10" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
        <line x1="3" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1"/>
        <line x1="3" y1="7.5" x2="9" y2="7.5" stroke="currentColor" stroke-width="1"/>
        <line x1="3" y1="10" x2="7" y2="10" stroke="currentColor" stroke-width="1"/>
      </svg></div>`;

  const label     = paths.length === 1 ? '1 file' : `${paths.length} files`;
  const badgeHtml = paths.length > 1
    ? `<span class="drag-ghost-badge">${paths.length}</span>`
    : '';

  ghost.innerHTML = `${thumbHtml}<span>${label}</span>${badgeHtml}`;
  ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;pointer-events:none;z-index:9999;';
  document.body.appendChild(ghost);
  return ghost;
}

document.getElementById('fileGrid').addEventListener('dragstart', e => {
  const tile = e.target.closest('.file-tile[data-path]');
  if (!tile) { e.preventDefault(); return; }
  const path = tile.dataset.path;
  _draggedPaths = selectedFiles.has(path) ? [...selectedFiles] : [path];
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(_draggedPaths.length));

  // Custom drag image — ghost offset (0,0) puts top-left at cursor, ghost appears below-right
  const ghost = _buildDragGhost(_draggedPaths);
  e.dataTransfer.setDragImage(ghost, 0, 0);
  setTimeout(() => { ghost.parentNode?.removeChild(ghost); }, 0);

  for (const p of _draggedPaths) tileMap.get(p)?.classList.add('dragging');
});

document.getElementById('fileGrid').addEventListener('dragend', () => {
  for (const p of _draggedPaths) tileMap.get(p)?.classList.remove('dragging');
  _draggedPaths = [];
  const panel = document.getElementById('groupPanel');
  panel.classList.remove('gp-drop-over');
  panel.querySelectorAll('.gp-tab').forEach(t => t.classList.remove('gp-drop-tab'));
  const hint = document.getElementById('gpDragHint');
  if (hint) hint.classList.remove('visible');
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

/**
 * O(1) — swaps pv-focused class from the old focused tile to the new one.
 * Always updates lastClickedPath.
 */
function _setPreviewFocus(path) {
  if (_prevFocusPath) tileMap.get(_prevFocusPath)?.classList.remove('pv-focused');
  if (path) tileMap.get(path)?.classList.add('pv-focused');
  _prevFocusPath  = path;
  lastClickedPath = path;
}

/**
 * Returns the target path for arrow-key focus navigation, or null if already at boundary.
 *
 * Left/Right : ±1 in flat rendered order (both grid and list).
 * Up/Down    : ±1 in list view; visual-row navigation in grid view via getBoundingClientRect.
 *
 * @param {string}   key    — ArrowLeft | ArrowRight | ArrowUp | ArrowDown
 * @param {string[]} order  — getRenderedPathOrder() snapshot
 */
function _arrowFocusTarget(key, order) {
  const curIdx = lastClickedPath ? order.indexOf(lastClickedPath) : -1;

  if (key === 'ArrowLeft') {
    if (curIdx === -1) return order[0];
    return curIdx > 0 ? order[curIdx - 1] : null;
  }
  if (key === 'ArrowRight') {
    if (curIdx === -1) return order[0];
    return curIdx < order.length - 1 ? order[curIdx + 1] : null;
  }

  // Up/Down in list mode: ±1 (single-column layout)
  if (viewMode === 'list') {
    if (curIdx === -1) return order[0];
    const next = curIdx + (key === 'ArrowDown' ? 1 : -1);
    return (next >= 0 && next < order.length) ? order[next] : null;
  }

  // Up/Down in grid/icon mode: find tile in same visual column of next/prev row
  if (curIdx === -1) return order[0];
  const curTile = tileMap.get(lastClickedPath);
  if (!curTile) return null;

  const curRect = curTile.getBoundingClientRect();
  const TOL     = 4; // px — same-row tolerance
  const goDown  = key === 'ArrowDown';

  // 1. Find the y-coordinate of the adjacent row
  let targetY = null;
  for (const t of tileMap.values()) {
    const ty = t.getBoundingClientRect().top;
    if (goDown) {
      if (ty > curRect.top + TOL && (targetY === null || ty < targetY)) targetY = ty;
    } else {
      if (ty < curRect.top - TOL && (targetY === null || ty > targetY)) targetY = ty;
    }
  }
  if (targetY === null) return null;  // already at top/bottom row

  // 2. Find tile in that row whose horizontal centre is closest to ours
  const curCX = curRect.left + curRect.width / 2;
  let best = null, bestD = Infinity;
  for (const [path, t] of tileMap) {
    const r = t.getBoundingClientRect();
    if (Math.abs(r.top - targetY) <= TOL) {
      const d = Math.abs((r.left + r.width / 2) - curCX);
      if (d < bestD) { bestD = d; best = path; }
    }
  }
  return best;
}

/**
 * @param {string}  filePath
 * @param {boolean} shiftKey  — extend import selection range from anchor
 * @param {boolean} ctrlKey   — toggle import selection for this file
 *
 * Normal click (shiftKey=false, ctrlKey=false): sets preview focus only.
 * Cmd/Ctrl-click: toggles import selection + sets anchor + preview focus.
 * Shift-click: range-selects from _selectionAnchor to filePath + preview focus.
 */
function handleTileClick(filePath, shiftKey, ctrlKey = false) {
  // Preview focus always follows the clicked file
  _setPreviewFocus(filePath);

  // Guard: if anchor left currentFiles (sort/filter/folder change), reset it
  if (_selectionAnchor && !currentFiles.some(f => f.path === _selectionAnchor)) {
    _selectionAnchor = null;
  }

  if (shiftKey && _selectionAnchor && _selectionAnchor !== filePath) {
    const order = getRenderedPathOrder();
    const a = order.indexOf(_selectionAnchor);
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

  if (shiftKey && !_selectionAnchor) {
    // Shift with no anchor: add this one file to import selection, set anchor
    selectedFiles.add(filePath);
    _selectionAnchor = filePath;
    requestThumbForPath(filePath, true);
    syncOneTile(filePath);
    updateSelectionBar();
    updateSteps();
    return;
  }

  if (ctrlKey) {
    // Cmd/Ctrl-click: toggle import selection, update anchor
    if (selectedFiles.has(filePath)) {
      selectedFiles.delete(filePath);
    } else {
      selectedFiles.add(filePath);
      requestThumbForPath(filePath, true);
    }
    _selectionAnchor = filePath;
    syncOneTile(filePath);
    updateSelectionBar();
    updateSteps();
    return;
  }

  // Normal click: preview focus only — no selection change
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
    tile.classList.toggle('pv-focused', path === lastClickedPath);
    const cb = tile.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = checked;
  }
  _prevFocusPath = lastClickedPath;
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
// VISIBLE FILE SCOPE
// Returns only the files currently rendered in the grid.
// Media mode → all currentFiles; folder-leaf mode → leaf files only;
// folder-root/non-leaf → [] (instruction panel, no tiles rendered).
// ════════════════════════════════════════════════════════════════
function getVisibleFiles() {
  if (viewModeType === 'folder') {
    return (currentFolderContext.isLeaf && !currentFolderContext.isRoot)
      ? currentFolderContext.files
      : [];
  }
  return currentFiles;
}

// ════════════════════════════════════════════════════════════════
// GLOBAL SELECT ALL / CLEAR
// ════════════════════════════════════════════════════════════════
document.getElementById('selectAllBtn').addEventListener('click', () => {
  const visible      = getVisibleFiles();
  const visiblePaths = visible.map(f => f.path);
  const allVisibleSelected = visiblePaths.length > 0 &&
    visiblePaths.every(p => selectedFiles.has(p));
  if (allVisibleSelected) {
    visiblePaths.forEach(p => selectedFiles.delete(p));
    _selectionAnchor = null;
  } else {
    visiblePaths.forEach(p => selectedFiles.add(p));
    requestThumbsForPaths(visiblePaths);
  }
  syncAllTiles();
  updateSelectionBar();
  updateSteps();
});

document.getElementById('clearSelBtn').addEventListener('click', () => {
  selectedFiles.clear();
  _selectionAnchor = null;
  syncAllTiles();
  updateSelectionBar();
  updateSteps();
});

// ════════════════════════════════════════════════════════════════
// Cmd/Ctrl+A keyboard shortcut — mirrors Select All visible scope
// ════════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== 'a') return;
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const visible = getVisibleFiles();
  if (!visible.length) return;
  e.preventDefault();
  const visiblePaths = visible.map(f => f.path);
  const allVisibleSelected = visiblePaths.every(p => selectedFiles.has(p));
  if (allVisibleSelected) {
    visiblePaths.forEach(p => selectedFiles.delete(p));
    _selectionAnchor = null;
  } else {
    visiblePaths.forEach(p => selectedFiles.add(p));
    requestThumbsForPaths(visiblePaths);
  }
  syncAllTiles();
  updateSelectionBar();
  updateSteps();
});

// ════════════════════════════════════════════════════════════════
// Cmd/Ctrl+D — deselect all import selection, preserve preview focus
// ════════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== 'd') return;
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (!getVisibleFiles().length) return;
  e.preventDefault();
  selectedFiles.clear();
  _selectionAnchor = null;
  syncAllTiles();
  updateSelectionBar();
  updateSteps();
});

// ════════════════════════════════════════════════════════════════
// SELECTION BAR STATE
// ════════════════════════════════════════════════════════════════
function updateSelectionBar() {
  const n            = selectedFiles.size;
  const visible      = getVisibleFiles();
  const visiblePaths = visible.map(f => f.path);
  const allVisibleSelected = visiblePaths.length > 0 &&
    visiblePaths.every(p => selectedFiles.has(p));

  document.getElementById('toolbar').classList.toggle('has-selection', n > 0);
  document.body.classList.toggle('has-import-selection', n > 0);  // CSS: focus ring strength
  document.getElementById('selCount').textContent = `${n} selected`;
  setStatusBarMessage('selection', n > 0 ? `${n} file${n === 1 ? '' : 's'} selected` : null, 2);

  const selectAllBtn = document.getElementById('selectAllBtn');
  selectAllBtn.textContent = allVisibleSelected ? 'Deselect All' : 'Select All';
  selectAllBtn.disabled = visiblePaths.length === 0;
  document.getElementById('clearSelBtn').disabled = n === 0;

  const importBtn = document.getElementById('importBtn');
  // Show "Import Groups" when an event is active and groups exist — regardless of railMode.
  const hasGroupedFiles = EventCreator.getActiveEventData() !== null && GroupManager.hasGroups();
  const canImport = n > 0 || hasGroupedFiles;
  importBtn.classList.toggle('visible', canImport);
  importBtn.disabled = !canImport || importRunning;
  importBtn.innerHTML = hasGroupedFiles
    ? `${SVG.download} Import Groups`
    : `${SVG.download} Import Selected`;
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

  const _bc1 = document.getElementById('breadcrumb'); if (_bc1) _bc1.textContent = batch.folderPath;
  activeFolderPath = batch.folderPath;
  // Commit 6 (+11b): batches pass folders=null. Sidebar renders from currentFolderTree
  // when it exists, falling back to the batch payload for the very first render.
  if (batch.folders !== null && batch.folders !== undefined) {
    renderFolders(currentFolderTree || batch.folders, batch.dcimPath);
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
  selectedFiles.clear(); currentFiles = []; lastClickedPath = null; _selectionAnchor = null; _prevFocusPath = null;
  resetViewCache();

  // Commit 3 (v0.6.0): folderPath === null is a valid user-visible browse.
  // Every browseFolder call is treated as user-facing; the resulting list must be rendered.
  const isUserFolderSelection = true;
  currentFolder = folderPath || drivePath;

  updateSelectionBar(); updateSteps();

  try {
    const result = await window.api.getFiles(drivePath, folderPath, requestId);
    if (requestId !== fileLoadRequestId) return;

    const _bc2 = document.getElementById('breadcrumb'); if (_bc2) _bc2.textContent = result.folderPath;
    activeFolderPath = result.folderPath;
    // Commit 6b: preserve root tree across subfolder browses.
    // Only overwrite currentFolderTree on a root browse (folderPath === null).
    // Subfolder browses return a scoped tree we intentionally ignore here so the
    // sidebar + folder-count remain anchored to the whole-card view.
    if (folderPath === null) {
      currentFolderTree = (result.folders && typeof result.folders === 'object' && !Array.isArray(result.folders))
        ? result.folders : null;
    }
    // Commit 11b: sidebar renders the full nested tree (when available).
    renderFolders(currentFolderTree || (Array.isArray(result.folders) ? result.folders : []), result.dcimPath);
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
    return true;

  } catch (err) {
    console.error('[browseFolder] exception during file load:', err);
    if (requestId !== fileLoadRequestId) return;
    const msg = (err && err.message) ? err.message : String(err);
    document.getElementById('folderList').innerHTML =
      `<div class="sidebar-empty">${escapeHtml(msg)}</div>`;
    document.getElementById('fileGrid').innerHTML =
      `<div class="panel-state"><span class="state-icon">${SVG.warn}</span><span>${escapeHtml(msg)}</span></div>`;
    return false;
  }
}

// ════════════════════════════════════════════════════════════════
// DESTINATION
// Dest change: refresh cache, then sync imported badges in-place.
// NO full re-render. Scroll position preserved.
// ════════════════════════════════════════════════════════════════
async function setDestPath(p) {
  destPath = p;
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

    // Update or add/remove the imported label (icon view)
    if (viewMode === 'icon') {
      let label = tile.querySelector('.file-imported-label');
      if (imported && !label) {
        label = document.createElement('div');
        label.className = 'file-imported-label';
        label.innerHTML = _SVG_CHECK_XS + 'Imported';
        // Insert after checkbox (first child)
        const cb = tile.querySelector('input[type="checkbox"]');
        if (cb) cb.after(label);
        else tile.insertBefore(label, tile.firstChild);
      } else if (!imported && label) {
        label.remove();
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
        badge.textContent = 'Imported';
        nameCell.appendChild(badge);
      } else if (!imported && badge) {
        badge.remove();
      }
    }
  }
}

// Dest path is now initialised inside initApp() after the import index loads.

// Populate version span in global title bar
try {
  const ver = window.api.getVersion();
  const el  = document.getElementById('appVersion');
  if (el) el.textContent = `v${ver}`;
} catch { /* non-critical — version label is informational only */ }


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
    el.innerHTML = preview.map(n => `<div class="dup-file-row">${SVG.skip} ${escapeHtml(n)}</div>`).join('');
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
  document.getElementById('progressFill').classList.remove('done');
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

  const fn = escapeHtml(filename);
  let labelHtml;
  if      (status === 'copying') labelHtml = `${SVG.loader} Copying: ${fn}`;
  else if (status === 'done')    labelHtml = `${SVG.check} Copied: ${fn}`;
  else if (status === 'renamed') labelHtml = `${SVG.check} Copied (renamed): ${fn} — ${escapeHtml(skipReason || '')}`;
  else if (status === 'skipped') labelHtml = `${SVG.skip} Skipped: ${fn} — ${escapeHtml(skipReason || '')}`;
  else if (status === 'error')   labelHtml = `${SVG.warn} Error: ${fn} — ${escapeHtml(error || '')}`;
  else                           labelHtml = fn;
  document.getElementById('progressFilename').innerHTML = labelHtml;
}

function showProgressSummary({ copied, skipped, errors, skippedReasons, failedFiles, duration, integrity, copiedFiles }) {
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
      rows.push(`<div class="skip-reason-row skip-reason-failed">${SVG.warn} Failed: ${escapeHtml(f.filename)} — ${escapeHtml(f.reason)}</div>`)
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
  document.getElementById('progressFill').classList.add('done');
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
    row.innerHTML = `${SVG.check} File Integrity Verified (Size Check)`;
    summaryEl.appendChild(row);
  }

  // ── Deep Verify (Checksum) button — user-triggered, runs in background ────────
  const modal = document.getElementById('progressModal');
  const actLeft = modal && modal.querySelector('.im-actions-left');
  if (actLeft && !modal.querySelector('#runChecksumBtn') && integrity === 'verified') {
    const checksumBtn = document.createElement('button');
    checksumBtn.id        = 'runChecksumBtn';
    checksumBtn.className = 'im-btn-secondary';
    checksumBtn.textContent = 'Deep Verify';
    checksumBtn.title       = 'Deep Verify (Checksum)';
    checksumBtn.addEventListener('click', async () => {
      checksumBtn.disabled    = true;
      checksumBtn.textContent = 'Verifying... 0%';
      await window.api.runChecksumVerification();
    });
    actLeft.appendChild(checksumBtn);
  }

  // ── Report Issue button (shown after every import) ─────────────────────────
  // Removed after Done is clicked to keep the modal clean on next import.
  if (actLeft && !modal.querySelector('#progressReportBtn')) {
    const btn = document.createElement('button');
    btn.id        = 'progressReportBtn';
    btn.className = 'im-btn-tertiary';
    btn.title     = 'Report an Issue';
    btn.innerHTML = `<span class="icon">${SVG.flag}</span> Report Issue`;
    btn.addEventListener('click', () => {
      document.getElementById('progressOverlay').classList.remove('visible');
      openFeedbackModal({
        issueType:    errors > 0 ? 'Import Failure' : '',
        importResult: `Copied: ${copied}  Skipped: ${skipped}  Failed: ${errors}`,
      });
    });
    actLeft.appendChild(btn);
  }

  // ── Clean Up Source button — only when files were copied ───────────────────
  if (actLeft && !modal.querySelector('#scqOpenBtn') && copiedFiles && copiedFiles.length > 0 && activeSource?.path) {
    _csqEligibleFiles = copiedFiles;
    _csqSourceRoot    = activeSource.path;
    const cleanBtn = document.createElement('button');
    cleanBtn.id        = 'scqOpenBtn';
    cleanBtn.className = 'im-btn-secondary';
    cleanBtn.textContent = 'Review Cleanup';
    cleanBtn.title       = 'Review Source Cleanup';
    cleanBtn.addEventListener('click', () => openSourceCleanup());
    actLeft.appendChild(cleanBtn);
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
  if (failed === 0) {
    btn.innerHTML = `${SVG.check} Deep Verification Complete`;
    btn.classList.add('csq-success');
  } else {
    btn.innerHTML = `${SVG.warn} ${failed} file(s) failed`;
    btn.classList.add('csq-error');
  }
  window.api.getImportIndex().then(index => {
    globalImportIndex = index || {};
    });
});

// ── Source Cleanup ─────────────────────────────────────────────────────────

function _formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function _updateScqDeleteBtn() {
  const list    = document.getElementById('scFileList');
  const input   = document.getElementById('scConfirmInput');
  const btn     = document.getElementById('scDeleteBtn');
  const countEl = document.getElementById('scSelCount');
  if (!list || !input || !btn) return;
  const checked = list.querySelectorAll('input[type="checkbox"]:checked');
  const n = checked.length;
  if (countEl) countEl.textContent = n > 0 ? `${n} file${n > 1 ? 's' : ''} selected` : '';
  btn.disabled = !(n > 0 && input.value === 'DELETE FROM SOURCE');
}

function openSourceCleanup() {
  const overlay      = document.getElementById('sourceCleanupOverlay');
  const fileList     = document.getElementById('scFileList');
  const confirmInput = document.getElementById('scConfirmInput');
  const resultArea   = document.getElementById('scResultArea');
  const selectAll    = document.getElementById('scSelectAll');
  const deleteBtn    = document.getElementById('scDeleteBtn');
  const cancelBtn    = document.getElementById('scCancelBtn');
  const confirmGate  = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-confirm-gate');
  const scActions    = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-actions');
  const selectAllRow = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-select-all-row');
  if (!overlay || !fileList || !_csqEligibleFiles) return;

  // Reset modal to file-list state
  fileList.innerHTML = '';
  if (confirmInput) confirmInput.value = '';
  if (resultArea)   { resultArea.style.display = 'none'; resultArea.innerHTML = ''; }
  if (selectAll)    { selectAll.checked = false; selectAll.indeterminate = false; }
  if (deleteBtn)    { deleteBtn.disabled = true; deleteBtn.textContent = 'Delete Selected'; }
  if (cancelBtn)    { cancelBtn.disabled = false; cancelBtn.textContent = 'Cancel'; cancelBtn.onclick = _closeSourceCleanup; }
  if (confirmGate)  confirmGate.style.display = '';
  if (scActions)    scActions.style.display = '';
  if (selectAllRow) selectAllRow.style.display = '';

  // Populate file rows using current _csqEligibleFiles (already filtered of past deletions)
  _csqEligibleFiles.forEach((f, idx) => {
    const filename = f.src.split(/[\\/]/).pop();
    const row = document.createElement('label');
    row.className = 'sc-file-row';
    row.dataset.src = f.src;
    row.innerHTML = `
      <input type="checkbox" data-idx="${idx}" />
      <span class="sc-file-name" title="${escapeHtml(f.src)}">${escapeHtml(filename)}</span>
      <span class="sc-file-size">${_formatBytes(f.size)}</span>`;
    row.querySelector('input').addEventListener('change', () => {
      _syncSelectAll();
      _updateScqDeleteBtn();
    });
    fileList.appendChild(row);
  });

  if (selectAll) {
    selectAll.onchange = () => {
      fileList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = selectAll.checked);
      _updateScqDeleteBtn();
    };
  }
  if (confirmInput) confirmInput.oninput = _updateScqDeleteBtn;
  if (deleteBtn)    deleteBtn.onclick = _handleSourceDelete;

  overlay.classList.remove('hidden');
}

function _syncSelectAll() {
  const list      = document.getElementById('scFileList');
  const selectAll = document.getElementById('scSelectAll');
  if (!list || !selectAll) return;
  const all     = list.querySelectorAll('input[type="checkbox"]');
  const checked = list.querySelectorAll('input[type="checkbox"]:checked');
  selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
  selectAll.checked       = all.length > 0 && checked.length === all.length;
}

async function _handleSourceDelete() {
  if (!_csqEligibleFiles || !_csqSourceRoot) return;
  const list       = document.getElementById('scFileList');
  const deleteBtn  = document.getElementById('scDeleteBtn');
  const cancelBtn  = document.getElementById('scCancelBtn');
  const resultArea = document.getElementById('scResultArea');
  if (!list || !deleteBtn) return;

  const checkedBoxes = list.querySelectorAll('input[type="checkbox"]:checked');
  const toDelete = Array.from(checkedBoxes).map(cb => {
    const idx = parseInt(cb.getAttribute('data-idx'), 10);
    return _csqEligibleFiles[idx];
  }).filter(Boolean);
  if (!toDelete.length) return;

  deleteBtn.disabled = true;
  deleteBtn.textContent = 'Deleting…';
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    const { ok, results, error } = await window.api.deleteFromSource(toDelete, _csqSourceRoot);

    if (!ok) {
      if (resultArea) {
        resultArea.style.display = '';
        resultArea.innerHTML = `<div class="sc-result-err">Error: ${escapeHtml(error || 'Unknown error')}</div>`;
      }
      deleteBtn.textContent = 'Delete Selected';
      deleteBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
      return;
    }

    let successCount = 0;
    let failCount    = 0;
    const lines = results.map(r => {
      const name = (r.src || '').split(/[\\/]/).pop();
      if (r.deleted) {
        successCount++;
        return `<div class="sc-result-ok">✓ ${escapeHtml(name)}</div>`;
      }
      failCount++;
      return `<div class="sc-result-err">✗ ${escapeHtml(name)} — ${escapeHtml(r.error || 'Unknown')}</div>`;
    });

    // Remove deleted rows from DOM and update eligible set
    const deletedSrcs = new Set(results.filter(r => r.deleted).map(r => r.src));
    Array.from(checkedBoxes).forEach(cb => {
      const idx = parseInt(cb.getAttribute('data-idx'), 10);
      const f   = _csqEligibleFiles[idx];
      if (f && deletedSrcs.has(f.src)) cb.closest('.sc-file-row').remove();
    });
    _csqEligibleFiles = _csqEligibleFiles.filter(f => !deletedSrcs.has(f.src));

    // Surgically remove deleted files from the visible file grid
    if (deletedSrcs.size > 0) {
      currentFiles = currentFiles.filter(f => !deletedSrcs.has(f.path));
      for (const srcPath of deletedSrcs) {
        selectedFiles.delete(srcPath);
        const tile = tileMap.get(srcPath);
        if (tile) { tile.remove(); tileMap.delete(srcPath); }
      }
      updateSelectionBar();
    }

    // Show result summary
    const summary = successCount > 0
      ? `<div class="sc-result-ok" style="margin-bottom:6px;font-weight:600;">${successCount} file${successCount > 1 ? 's' : ''} removed from source${failCount > 0 ? `, ${failCount} failed` : ''}.</div>`
      : '';
    if (resultArea) {
      resultArea.style.display = '';
      resultArea.innerHTML = summary + lines.join('');
    }

    // Replace action row with a single Done button — no auto-close
    const scActions = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-actions');
    const confirmGate = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-confirm-gate');
    const selectAllRow = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-select-all-row');
    if (confirmGate)  confirmGate.style.display  = 'none';
    if (selectAllRow) selectAllRow.style.display = 'none';
    if (scActions) {
      scActions.innerHTML = '';
      const doneBtn = document.createElement('button');
      doneBtn.className   = 'sc-btn-cancel';
      doneBtn.textContent = 'Done';
      doneBtn.onclick     = _closeSourceCleanup;
      scActions.appendChild(doneBtn);
    }

    // If failures remain, re-enable for retry
    if (failCount > 0) {
      _syncSelectAll();
      _updateScqDeleteBtn();
    }
  } catch (err) {
    if (resultArea) {
      resultArea.style.display = '';
      resultArea.innerHTML = `<div class="sc-result-err">Error: ${escapeHtml(err.message)}</div>`;
    }
    deleteBtn.textContent = 'Delete Selected';
    deleteBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

function _closeSourceCleanup() {
  const overlay = document.getElementById('sourceCleanupOverlay');
  if (overlay) overlay.classList.add('hidden');
  // State (_csqEligibleFiles, _csqSourceRoot) intentionally kept — cleared by
  // progressDoneBtn or resetAppState, not here, so partial results survive Cancel.
}

// ── Space-bar Media Preview ────────────────────────────────────────────────
// Phase 1: JPEG/PNG (full-res via files:getPreviewUrl), RAW (thumbnail via
// getThumb), MP4/MOV (native <video>). Arrow navigation, Esc/Space to close.
//
// Phase 2 extension point: when rawPreviewService.js is available, replace the
// getThumb call in _pvLoadContent (RAW branch) with:
//   window.api.getRawPreview(file.path)
//   → IPC → main/rawPreviewService.js → LibRaw embedded JPEG → cached file URL
// No renderer changes needed beyond swapping that one call.

function _isEditableTarget(el) {
  if (!el) return false;
  const t = el.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

// Ref.6 — centralised blocking-overlay check, future-safe
function _isAnyBlockingOverlayOpen() {
  if (document.getElementById('progressOverlay')?.classList.contains('visible')) return true;
  if (document.getElementById('settingsModal')?.classList.contains('visible')) return true;
  if (document.getElementById('onboardingOverlay')?.classList.contains('visible')) return true;
  if (document.getElementById('helpOverlay')?.classList.contains('visible')) return true;
  if (!document.getElementById('sourceCleanupOverlay')?.classList.contains('hidden')) return true;
  if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen?.()) return true;
  return false;
}

async function openPreview(filePath) {
  if (_previewOpen) return;
  if (!filePath) return;
  if (_isAnyBlockingOverlayOpen()) return;    // Ref.6

  const file = currentFiles.find(f => f.path === filePath);
  if (!file) return;

  _previewPath  = filePath;
  _previewOrder = getRenderedPathOrder();
  _previewOpen  = true;

  const overlay    = document.getElementById('previewOverlay');
  const pvContent  = document.getElementById('pvContent');
  const pvFilename = document.getElementById('pvFilename');
  const pvBadge    = document.getElementById('pvTypeBadge');

  pvFilename.textContent = file.name;
  pvBadge.textContent    = '';
  pvBadge.className      = 'pv-badge';
  pvContent.innerHTML    = '<div class="pv-loading">Loading…</div>';
  overlay.classList.remove('hidden');

  await _pvLoadContent(file, true);
  _pvUpdateNav();

  document.getElementById('pvCloseBtn').onclick = closePreview;
  document.getElementById('pvPrevBtn').onclick  = () => navigatePreview(-1);
  document.getElementById('pvNextBtn').onclick  = () => navigatePreview(1);
}

async function _pvLoadContent(file, autoplay = false) {
  const pvContent = document.getElementById('pvContent');
  const pvBadge   = document.getElementById('pvTypeBadge');
  if (!pvContent || !pvBadge) return;

  try {
    if (file.type === 'video') {
      const url = await window.api.getPreviewUrl(file.path);
      if (!_previewOpen || _previewPath !== file.path) return;
      if (!url) { pvContent.innerHTML = '<div class="pv-err">Preview unavailable</div>'; return; }
      const vid = document.createElement('video');
      vid.id        = 'pvVideo';
      vid.controls  = true;
      vid.preload   = 'metadata';
      vid.className = 'pv-video';
      vid.src = url;
      pvContent.innerHTML = '';
      pvContent.appendChild(vid);
      pvBadge.textContent = 'Video';
      pvBadge.className   = 'pv-badge pv-badge-video';

      if (autoplay) {
        vid.currentTime = 0;
        const playPromise = vid.play();
        if (playPromise) playPromise.catch(() => {});
      }

    } else if (file.type === 'raw') {
      pvBadge.textContent = 'RAW';
      pvBadge.className   = 'pv-badge pv-badge-raw';
      pvContent.innerHTML = '<div class="pv-loading"><span class="pv-loading-label">RAW PREVIEW</span>Extracting high-quality preview…</div>';

      const rawUrl = await window.api.getRawPreview(file.path);
      if (!_previewOpen || _previewPath !== file.path) return;

      let displayUrl = rawUrl;
      let caption    = 'extracted preview';
      if (!displayUrl) {
        displayUrl = await window.api.getThumb(file.path);
        if (!_previewOpen || _previewPath !== file.path) return;
        caption = process.platform === 'win32' ? 'thumbnail preview (RAW codec not available)' : 'thumbnail preview';
      }

      if (!_pvRawImg) {
        _pvRawImg = document.createElement('img');
        _pvRawImg.className = 'pv-image';
        _pvRawImg.onload = () => {
          const MAX_PX = 1200;
          if (_pvRawImg.naturalWidth > MAX_PX || _pvRawImg.naturalHeight > MAX_PX) {
            _pvRawImg.style.maxWidth  = MAX_PX + 'px';
            _pvRawImg.style.maxHeight = MAX_PX + 'px';
          }
        };
      }
      _pvRawImg.style.maxWidth  = '';
      _pvRawImg.style.maxHeight = '';
      _pvRawImg.alt             = file.name;
      _pvRawImg.src             = displayUrl || '';
      pvContent.innerHTML = '';
      pvContent.appendChild(_pvRawImg);
      const cap = document.createElement('div');
      cap.className   = 'pv-raw-caption';
      cap.textContent = caption;
      pvContent.appendChild(cap);

    } else {
      // photo (JPEG / PNG — full resolution)
      const url = await window.api.getPreviewUrl(file.path);
      if (!_previewOpen || _previewPath !== file.path) return;
      if (!url) { pvContent.innerHTML = '<div class="pv-err">Preview unavailable</div>'; return; }
      const img = document.createElement('img');
      img.className = 'pv-image';
      img.alt       = file.name;
      img.src       = url;
      pvContent.innerHTML = '';
      pvContent.appendChild(img);
    }
  } catch (err) {
    if (!_previewOpen || _previewPath !== file.path) return;
    pvContent.innerHTML = `<div class="pv-err">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function _pvUpdateNav() {
  const idx     = _previewOrder.indexOf(_previewPath);
  const prevBtn = document.getElementById('pvPrevBtn');
  const nextBtn = document.getElementById('pvNextBtn');
  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx < 0 || idx >= _previewOrder.length - 1;
}

function closePreview() {
  if (!_previewOpen) return;

  // Stop and clear video to fully release media resources (Ref.5)
  const vid = document.getElementById('pvVideo');
  if (vid) { vid.pause(); vid.currentTime = 0; vid.removeAttribute('src'); vid.load(); }

  _pvObjUrls.forEach(u => URL.revokeObjectURL(u));
  _pvObjUrls = [];

  _previewOpen  = false;
  _previewPath  = null;
  _previewOrder = [];

  const overlay = document.getElementById('previewOverlay');
  if (overlay) overlay.classList.add('hidden');
}

async function navigatePreview(dir) {
  if (!_previewOpen || !_previewPath || !_previewOrder.length) return;

  // Ref.2 — close gracefully if current path is no longer in the snapshot
  // (e.g. Source Cleanup removed the file, or folder changed mid-preview)
  if (!_previewOrder.includes(_previewPath)) { closePreview(); return; }

  const idx = _previewOrder.indexOf(_previewPath);
  if (idx === -1) return;
  const next = idx + dir;
  if (next < 0 || next >= _previewOrder.length) return;
  const nextPath = _previewOrder[next];

  // Ref.7 — skip redundant load on rapid key presses
  if (nextPath === _previewPath) return;

  const nextFile = currentFiles.find(f => f.path === nextPath);
  if (!nextFile) return;

  // Stop current video before switching (Ref.5)
  const vid = document.getElementById('pvVideo');
  if (vid) { vid.pause(); vid.currentTime = 0; vid.removeAttribute('src'); vid.load(); }

  _previewPath = nextPath;

  const pvContent  = document.getElementById('pvContent');
  const pvFilename = document.getElementById('pvFilename');
  const pvBadge    = document.getElementById('pvTypeBadge');
  pvFilename.textContent = nextFile.name;
  pvBadge.textContent    = '';
  pvBadge.className      = 'pv-badge';
  pvContent.innerHTML    = '<div class="pv-loading">Loading…</div>';

  await _pvLoadContent(nextFile);
  _pvUpdateNav();
}

// ── Preview keyboard handler ───────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (_isEditableTarget(document.activeElement)) return;

  if (e.key === ' ') {
    if (_previewOpen) { e.preventDefault(); e.stopPropagation(); closePreview(); return; }
    // Ref.1 — fallback: lastClick → first selected → first file in view
    const fp = lastClickedPath || [...selectedFiles][0] || currentFiles[0]?.path;
    if (fp) { e.preventDefault(); e.stopPropagation(); openPreview(fp); }
    return;
  }

  // ── Grid focus navigation (preview closed) ───────────────────────
  if (!_previewOpen &&
      (e.key === 'ArrowRight' || e.key === 'ArrowLeft' ||
       e.key === 'ArrowDown'  || e.key === 'ArrowUp')) {
    if (_isAnyBlockingOverlayOpen()) return;
    const order = getRenderedPathOrder();
    if (!order.length) return;
    e.preventDefault();
    e.stopPropagation();
    const nextPath = _arrowFocusTarget(e.key, order);
    if (nextPath) {
      _setPreviewFocus(nextPath);
      tileMap.get(nextPath)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    return;
  }

  if (!_previewOpen) return;

  if (e.key === 'Escape')     { closePreview(); return; }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); navigatePreview(-1); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); navigatePreview(1);  return; }
});


document.getElementById('importBtn').addEventListener('click', async () => {
  if (importRunning) return;

  const eventData = EventCreator.getActiveEventData();
  const mode = importMode;

  if (mode === 'event' && !eventData) {
    console.warn('[IMPORT] Event mode active but no event selected');
    showMessage('No event selected. Please select or create an event before importing.');
    return;
  }

  // ── Event Import path (G4 + G5) ──────────────────────────────────────────
  if (mode === 'event') {
    // Enforce invariant: _eventComps must match session store before import.
    // resetToList() clears _eventComps but leaves event.components intact — re-sync here.
    if (!EventCreator.getEventComps().length && eventData?.event?.components?.length) {
      console.warn('[IMPORT FIX] Hydrating _eventComps from currentEvent');
      EventCreator.setEventComps(eventData.event.components);
    }

    const liveComps = EventCreator.getEventComps()?.length
      ? EventCreator.getEventComps()
      : (eventData?.event?.components ? JSON.parse(JSON.stringify(eventData.event.components)) : []);

    if (!liveComps || liveComps.length === 0) {
      console.error('[IMPORT] No components available');
      return;
    }

    if (
      !eventData?.eventPath ||
      !eventData?.event ||
      !Array.isArray(eventData.event.components) ||
      eventData.event.components.length === 0
    ) {
      console.error('[IMPORT BLOCKED] Invalid eventData structure', eventData);
      return;
    }

    if (!eventData.collectionPath) {
      console.error('[IMPORT] Missing collectionPath — cannot route files. Aborting.');
      return;
    }

    // Determine import mode from live component count.
    // Single-component: bypass GroupManager entirely — files route directly to eventPath/photographer.
    // Multi-component: full GroupManager flow, unchanged.
    const isMulti = liveComps.length > 1;

    // Inject live components so all downstream consumers use _eventComps as source.
    eventData.event.components = liveComps;

    let groups;
    if (isMulti) {
      // Multi-component: explicit groups required.
      if (!GroupManager.hasGroups()) {
        showMessage('Multi-component events require file grouping — use Cmd+G to assign files to sub-events.');
        return;
      }
      groups = GroupManager.getGroups();

      // G4-1: Blocking — groups with no sub-event in a multi-component event.
      if (GroupManager.hasMissingSubEvents()) {
        await showMissingSubEventModal();
        return;
      }

      // G4-2: Non-blocking — selected files not assigned to any group.
      const unassigned = GroupManager.getUnassignedFiles([...selectedFiles]);
      if (unassigned.length > 0) {
        const proceed = await showUnassignedWarningModal(unassigned.length);
        if (!proceed) return;
      }

      // G4-3: Non-blocking — multiple groups mapped to the same sub-event.
      const dupSubs = GroupManager.getDuplicateSubEvents();
      if (dupSubs.length > 0) {
        const proceed = await showDupSubEventModal(dupSubs);
        if (!proceed) return;
      }
    } else {
      // Single-component: GroupManager not touched.
      // Files route to eventPath/photographer with no sub-event folder.
      if (selectedFiles.size === 0) {
        showMessage('Select files to import.');
        return;
      }
      groups = [{ id: 0, files: new Set([...selectedFiles]), subEventId: null }];
    }

    // G4-4: Blocking — component missing event type or city (can't build folder structure).
    const incompleteComp = liveComps.find(c => !c.eventTypes?.length || !c.city?.label);
    if (incompleteComp) {
      showMessage('Complete all event details (event type + city) before importing.');
      return;
    }

    // G5: Confirmation screen — photographer + mapping summary.
    const photographer = await showEventImportConfirmModal(groups, eventData);

    const { fileJobs } = ImportRouter.buildFileJobs({ groups, eventData, photographer });
    if (fileJobs.length === 0) { showMessage('No files to import.'); return; }

    // Use path from getActiveEventData() — already validated above.
    const _eventJsonPath = eventData.eventPath;

    importRunning = true;
    updateSelectionBar();
    showProgress();

    // Mark event as in-progress so an interrupted import is detectable on restart.
    if (_eventJsonPath) {
      await window.api.updateEventJson(_eventJsonPath, { status: 'in-progress' });
    }

    const auditContext = {
      collName: eventData.coll?.name,
      photographer,
      subEventNames: EventCreator.getSubEventNames(),
      liveComps,
      groups: groups.map(group => ({
        id: group.id,
        subEventId: group.subEventId,
        files: [...group.files],
      })),
      source: _buildImportSourceMeta(),
      importedBy: _activeUser ? { id: _activeUser.id, name: _activeUser.name } : null,
    };

    try {
      const summary = await window.api.commitImportTransaction(fileJobs, _eventJsonPath, auditContext);
      if (!activeSource) return;

      showProgressSummary(summary);
      EventCreator.invalidateScannedEvents();
      await refreshDestCache();
      try { globalImportIndex = await window.api.getImportIndex() || {}; } catch { /* non-critical */ }
      _renderHeroLastImportArea();
    } catch (err) {
      document.getElementById('progressFilename').textContent = `Error: ${err.message}`;
      document.getElementById('progressDoneBtn').classList.add('visible');
      // Reset to 'created' so the event is not stuck in-progress after failure.
      if (_eventJsonPath) {
        await window.api.updateEventJson(_eventJsonPath, { status: 'created' });
      }
    } finally {
      importRunning = false;
    }
    return;
  }

  // ── Quick Import path ────────────────────────────────────────────────────
  if (!selectedFiles.size || !destPath) return;
  let filePaths = [...selectedFiles];

  const { duplicates, clean } = detectDuplicates(filePaths);
  if (duplicates.length > 0) {
    const decision = await showDupWarning(duplicates, filePaths.length);
    if (decision === 'cancel') return;
    if (decision === 'skip')   filePaths = clean;
  }
  if (!filePaths.length) return;

  const photographer = await showQuickImportConfirmModal(filePaths.length, destPath);
  if (!photographer) return;

  const uniqueFiles = Array.from(new Set(filePaths));
  const finalDest = destPath + '/' + photographer;

  await window.api.ensureDir(finalDest);

  importRunning = true;
  setStatusBarMessage('selection', null);
  setStatusBarMessage('import', 'Importing…', 3);
  updateSelectionBar();
  showProgress();

  try {
    const summary = await window.api.importFiles(uniqueFiles, finalDest, {
      importedBy: _activeUser ? { id: _activeUser.id, name: _activeUser.name } : null,
    });
    if (!activeSource) return; // workspace cleared (disconnect or eject) mid-import
    showProgressSummary(summary);
    await refreshDestCache();
    try { globalImportIndex = await window.api.getImportIndex() || {}; } catch { /* non-critical */ }
  } catch (err) {
    document.getElementById('progressFilename').textContent = `Error: ${err.message}`;
    document.getElementById('progressDoneBtn').classList.add('visible');
  } finally {
    importRunning = false;
    setStatusBarMessage('import', null);
  }
});

// ════════════════════════════════════════════════════════════════
// G4: PRE-IMPORT VALIDATION MODALS
// ════════════════════════════════════════════════════════════════

function showMissingSubEventModal() {
  return new Promise(resolve => {
    const overlay = document.getElementById('missingSubEventOverlay');
    overlay.classList.add('visible');
    const btn = document.getElementById('missingSubEventOkBtn');
    function onOk() {
      overlay.classList.remove('visible');
      btn.removeEventListener('click', onOk);
      resolve();
    }
    btn.addEventListener('click', onOk, { once: true });
  });
}

function showUnassignedWarningModal(count) {
  return new Promise(resolve => {
    const overlay = document.getElementById('unassignedOverlay');
    document.getElementById('unassignedCount').textContent = count;
    overlay.classList.add('visible');

    function close(result) {
      overlay.classList.remove('visible');
      document.getElementById('unassignedContinueBtn').removeEventListener('click', onContinue);
      document.getElementById('unassignedCancelBtn').removeEventListener('click', onCancel);
      resolve(result);
    }
    const onContinue = () => close(true);
    const onCancel   = () => close(false);
    document.getElementById('unassignedContinueBtn').addEventListener('click', onContinue, { once: true });
    document.getElementById('unassignedCancelBtn').addEventListener('click', onCancel,   { once: true });
  });
}

function showDupSubEventModal(dupSubEvents) {
  return new Promise(resolve => {
    const overlay = document.getElementById('dupSubEventOverlay');
    const list    = document.getElementById('dupSubEventList');
    list.innerHTML = dupSubEvents.map(id =>
      `<div class="dup-file-row">${SVG.skip} ${_esc(id)}</div>`
    ).join('');
    overlay.classList.add('visible');

    function close(result) {
      overlay.classList.remove('visible');
      document.getElementById('dupSubEventContinueBtn').removeEventListener('click', onContinue);
      document.getElementById('dupSubEventCancelBtn').removeEventListener('click', onCancel);
      resolve(result);
    }
    const onContinue = () => close(true);
    const onCancel   = () => close(false);
    document.getElementById('dupSubEventContinueBtn').addEventListener('click', onContinue, { once: true });
    document.getElementById('dupSubEventCancelBtn').addEventListener('click', onCancel,   { once: true });
  });
}

// ════════════════════════════════════════════════════════════════
// G5: EVENT IMPORT CONFIRMATION MODAL
// ════════════════════════════════════════════════════════════════

let _eiPhotographerDD = null;

/**
 * Opens the event import confirmation modal.
 * @returns {Promise<string|null>} Photographer name, or null if cancelled.
 */
function _renderDestinationTree(groups, eventData, photographerName) {
  const VIDEO_EXTS = new Set(['.mp4', '.mov']);
  const extOf  = p => { const i = p.lastIndexOf('.'); return i >= 0 ? p.slice(i).toLowerCase() : ''; };
  const baseOf = p => p.replace(/\\/g, '/').split('/').pop();
  const lastSeg = p => (p || '').replace(/\\/g, '/').replace(/\/$/, '').split('/').filter(Boolean).pop() || '?';

  const collParts       = (eventData.collectionPath || '').replace(/\\/g, '/').replace(/\/$/, '').split('/').filter(Boolean);
  const archiveName     = collParts.length >= 2 ? collParts[collParts.length - 2] : '?';
  const collName        = collParts[collParts.length - 1] || '?';
  const eventFolderName = lastSeg(eventData.eventPath);
  const isMulti         = Array.isArray(eventData.event.components) && eventData.event.components.length > 1;

  function node(text, level, cls, count) {
    const cnt = count != null
      ? ` <span class="cm-node-count">${count} file${count !== 1 ? 's' : ''}</span>`
      : '';
    return `<div class="cm-node ${cls} cm-level-${level}">${_esc(text)}${cnt}</div>`;
  }
  function phNode(text, level) {
    return `<div class="cm-node placeholder cm-level-${level}">${_esc(text)}</div>`;
  }
  function photographerNodes(files, photName, level) {
    const photos = files.filter(f => !VIDEO_EXTS.has(extOf(baseOf(f))));
    const videos = files.filter(f =>  VIDEO_EXTS.has(extOf(baseOf(f))));
    const rows = [];
    if (photName) {
      rows.push(node(photName + '/', level, 'photographer', photos.length));
      if (videos.length) rows.push(node('VIDEO/', level, 'video-dir', videos.length));
    } else {
      rows.push(phNode('Photographer (not selected)', level));
      if (videos.length) rows.push(node('VIDEO/', level, 'video-dir', videos.length));
    }
    return rows;
  }

  const rows = [
    `<div class="cm-node root">${_esc(archiveName + '/')}</div>`,
    node(collName + '/', 1, 'branch', null),
    node(eventFolderName + '/', 2, 'branch', null),
  ];

  if (isMulti) {
    for (const g of groups) {
      const subId = (g.subEventId || '').trim();
      const files = [...(g.files || [])];
      rows.push(
        subId
          ? node(subId + '/', 3, 'branch', null)
          : node('(Unassigned)/', 3, 'branch placeholder', null)
      );
      rows.push(...photographerNodes(files, photographerName, 4));
    }
  } else {
    const allFiles = groups.flatMap(g => [...(g.files || [])]);
    rows.push(...photographerNodes(allFiles, photographerName, 3));
  }

  return rows.join('');
}

function showEventImportConfirmModal(groups, eventData) {
  return new Promise(resolve => {
    const overlay   = document.getElementById('eventImportOverlay');
    const importBtn = document.getElementById('eiImportBtn');

    // Event name
    document.getElementById('eiEventName').textContent = eventData.event.displayName || eventData.event.name;

    // Destination structure tree (defined first so _updateTree is in scope for onSelect)
    const treeEl = document.getElementById('cmDestinationTree');
    function _updateTree(photographerName) {
      treeEl.innerHTML = _renderDestinationTree(groups, eventData, photographerName);
    }

    // Photographer dropdown
    const container = document.getElementById('eiPhotographerContainer');
    container.innerHTML = '';
    if (_eiPhotographerDD) { _eiPhotographerDD.destroy(); _eiPhotographerDD = null; }

    importBtn.disabled = true;
    _eiPhotographerDD = new TreeAutocomplete({
      container,
      type:        'photographers',
      placeholder: 'Search photographer…',
      onSelect:    ({ label }) => {
        importBtn.disabled = !label?.trim();
        _updateTree(label?.trim() || null);
      },
    });

    // Group → sub-event mapping table (multi-component events only)
    const isMulti         = Array.isArray(eventData.event.components) && eventData.event.components.length > 1;
    const mappingSection  = document.getElementById('eiMappingSection');
    const mappingTable    = document.getElementById('eiMappingTable');
    if (isMulti) {
      mappingSection.style.display = '';
      mappingTable.innerHTML = groups.map((g, idx) => {
        const color = GroupManager.getGroupColor(idx);
        const count = g.files.size;
        return `<div class="ei-map-row">
          <span class="ei-map-group" style="--group-color:${color}">${_esc(g.label)}</span>
          <span class="ei-map-arrow">→</span>
          <span class="ei-map-sub">${_esc(g.subEventId || '—')}</span>
          <span class="ei-map-count">${count} file${count !== 1 ? 's' : ''}</span>
        </div>`;
      }).join('');
    } else {
      mappingSection.style.display = 'none';
    }

    // Initial destination tree (no photographer selected yet)
    _updateTree(null);

    // File count summary
    const total = groups.reduce((s, g) => s + g.files.size, 0);
    document.getElementById('eiFileSummary').textContent =
      `${total} file${total !== 1 ? 's' : ''} will be imported`;

    overlay.classList.add('visible');

    function close(result) {
      overlay.classList.remove('visible');
      document.getElementById('eiCancelBtn').removeEventListener('click', onCancel);
      importBtn.removeEventListener('click', onImport);
      if (_eiPhotographerDD) { _eiPhotographerDD.destroy(); _eiPhotographerDD = null; }
      resolve(result);
    }

    function onCancel() { close(null); }
    function onImport() {
      const val = _eiPhotographerDD?.getValue();
      if (!val?.label?.trim()) return;
      close(val.label.trim());
    }

    document.getElementById('eiCancelBtn').addEventListener('click', onCancel, { once: true });
    importBtn.addEventListener('click', onImport, { once: true });
  });
}

let _qiPhotographerDD = null;

function showQuickImportConfirmModal(fileCount, destPath) {
  return new Promise(resolve => {
    const overlay   = document.getElementById('quickImportOverlay');
    const importBtn = document.getElementById('qiModalImportBtn');

    document.getElementById('qiModalDestPath').textContent = destPath;
    document.getElementById('qiModalFileSummary').textContent =
      `${fileCount} file${fileCount !== 1 ? 's' : ''} will be imported`;

    const container = document.getElementById('qiModalPhotographerContainer');
    container.innerHTML = '';
    if (_qiPhotographerDD) { _qiPhotographerDD.destroy(); _qiPhotographerDD = null; }

    importBtn.disabled = true;
    _qiPhotographerDD = new TreeAutocomplete({
      container,
      type:        'photographers',
      placeholder: 'Search photographer…',
      onSelect:    ({ label }) => { importBtn.disabled = !label?.trim(); },
    });

    overlay.classList.add('visible');

    function close(result) {
      overlay.classList.remove('visible');
      document.getElementById('qiModalCancelBtn').removeEventListener('click', onCancel);
      importBtn.removeEventListener('click', onImport);
      document.removeEventListener('keydown', onKey);
      if (_qiPhotographerDD) { _qiPhotographerDD.destroy(); _qiPhotographerDD = null; }
      resolve(result);
    }

    function onCancel() { close(null); }
    function onImport() {
      const val = _qiPhotographerDD?.getValue();
      if (!val?.label?.trim()) return;
      close(val.label.trim());
    }
    function onKey(e) {
      if (e.key === 'Escape') { close(null); }
      if (e.key === 'Enter' && !importBtn.disabled) { onImport(); }
    }

    document.getElementById('qiModalCancelBtn').addEventListener('click', onCancel, { once: true });
    importBtn.addEventListener('click', onImport, { once: true });
    document.addEventListener('keydown', onKey);
  });
}

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
  const cleanupBtn = document.getElementById('scqOpenBtn');
  if (cleanupBtn) cleanupBtn.remove();
  _csqEligibleFiles = null;
  _csqSourceRoot    = null;
  // PERF: sync badges in-place instead of re-rendering the entire grid
  // This preserves scroll position and avoids image reload
  if (currentFiles.length) syncImportedBadges();
  updateSelectionBar();
});

// ── Header date display ───────────────────────────────────────────────────────

function updateHeaderDate() {
  window.api.getTodayDate().then(data => {
    const gregEl  = document.getElementById('headerDateGreg');
    const hijriEl = document.getElementById('headerDateHijri');
    if (gregEl)  gregEl.textContent  = data.gregorian.display;
    if (hijriEl) hijriEl.textContent = data.hijri.display;
  }).catch(err => {
    console.error('Date fetch failed', err);
  });
}

function scheduleMidnightRefresh() {
  const now  = new Date();
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  setTimeout(() => {
    updateHeaderDate();
    setInterval(updateHeaderDate, 24 * 60 * 60 * 1000);
  }, next - now);
}

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

  // Prime EventCreator's sessionArchiveRoot from persisted settings so the
  // Location row appears immediately in Step 1 (no picker prompt on subsequent
  // app launches once the user has chosen a location once).
  try {
    await EventCreator.primeFromSettings();
  } catch (e) {
    console.error('Failed to prime archive root', e);
  }

  // Restore last active event — all logic delegated to EventCreator.
  await EventCreator.restoreLastEvent();

  // Quick Import: use last chosen destination; fall back to DEFAULT_DEST.
  try {
    const saved = await window.api.getLastDestPath();
    const p = saved || await window.api.getDefaultDest();
    await setDestPath(p);
  } catch (e) {
    console.error('Failed to load destination', e);
  }

  updateHeaderDate();
  scheduleMidnightRefresh();

  // Render the full home dashboard (context bar, primary card, insights)
  renderHome();

  // Register batch listener before the initial getDrives call so no
  // in-flight batch event is missed between registration and first poll.
  window.api.onFilesBatch(applyFileBatch);
  window.api.onDrivesUpdated(renderDrives);
  window.api.onAllDrivesUpdated(renderExtDrives);

  window.api.getDrives().then(renderDrives).catch(err => {
    const list = document.getElementById('srcMemCardList');
    if (list) list.innerHTML = `<div class="src-device-empty-row"><span class="empty-icon">${SVG.warn}</span><span>${escapeHtml(err.message)}</span></div>`;
  });

  // Show "What's New" if the app just updated — non-blocking, after UI is ready
  try {
    const updateInfo = await window.api.getLastUpdateInfo();
    if (updateInfo) showWhatsNewModal(updateInfo);
  } catch { /* non-critical — never block startup */ }

  // Commit 11b: default view is Media, which hides the sidebar. Apply it on
  // first paint so the user sees the flat-list-only layout from the start.
  const sidebar = document.getElementById('sidebar');
  if (sidebar && viewModeType === 'media') sidebar.style.display = 'none';
}

// ════════════════════════════════════════════════════════════════
// OPERATOR IDENTITY — in-app user switching via compact dropdown
// ════════════════════════════════════════════════════════════════

let _activeUser  = null;  // { id, name, role, initials }
let _splashUsers = [];

// ── Operator dropdown ──────────────────────────────────────────

function _renderOpDropdownList() {
  const list = document.getElementById('opDropdownList');
  if (!list) return;
  list.innerHTML = '';
  _splashUsers.forEach(u => {
    const item = document.createElement('div');
    item.className = 'op-dropdown-item' + (u.id === _activeUser?.id ? ' op-active' : '');
    item.setAttribute('role', 'menuitem');
    item.dataset.userId = u.id;
    item.innerHTML =
      `<div class="op-dropdown-initials">${escapeHtml(u.initials || '?')}</div>` +
      `<div class="op-dropdown-item-info">` +
        `<div class="op-dropdown-item-name">${escapeHtml(u.name)}</div>` +
        (u.role ? `<div class="op-dropdown-item-role">${escapeHtml(u.role)}</div>` : '') +
      `</div>`;
    item.addEventListener('click', async () => {
      _closeOpDropdown();
      if (u.id === _activeUser?.id) return;
      try {
        const updated = await window.api.setActiveUser(u.id);
        _activeUser = updated;
        updateOperatorIndicator();
      } catch (err) {
        console.error('[operator] setActiveUser failed:', err.message);
      }
    });
    list.appendChild(item);
  });
}

function _openOpDropdown() {
  const dropdown = document.getElementById('operatorDropdown');
  const switchBtn = document.getElementById('operatorSwitchBtn');
  if (!dropdown || !switchBtn) return;
  const rect  = switchBtn.getBoundingClientRect();
  const vw    = document.documentElement.clientWidth;
  const vh    = document.documentElement.clientHeight;
  const GUTTER = 8;

  // First pass: render (hidden) so we can measure natural size
  dropdown.style.visibility = 'hidden';
  dropdown.style.display    = '';
  _renderOpDropdownList();

  const dw = dropdown.offsetWidth;
  const dh = dropdown.offsetHeight;

  // Horizontal: right-align to button; clamp so left edge stays on-screen
  let rightEdge = vw - rect.right;
  if (rect.right - dw < GUTTER) rightEdge = vw - dw - GUTTER;
  dropdown.style.right = rightEdge + 'px';
  dropdown.style.left  = 'auto';

  // Vertical: below button unless it clips bottom; flip above if needed
  if (rect.bottom + 6 + dh + GUTTER > vh) {
    dropdown.style.top    = 'auto';
    dropdown.style.bottom = (vh - rect.top + 6) + 'px';
  } else {
    dropdown.style.top    = (rect.bottom + 6) + 'px';
    dropdown.style.bottom = 'auto';
  }

  dropdown.style.visibility = '';
  requestAnimationFrame(() => dropdown.classList.add('op-dropdown-visible'));
}

function _closeOpDropdown() {
  const dropdown = document.getElementById('operatorDropdown');
  if (!dropdown || dropdown.style.display === 'none') return;
  dropdown.classList.remove('op-dropdown-visible');
  dropdown.addEventListener('transitionend', () => { dropdown.style.display = 'none'; }, { once: true });
}

// ── Add-operator modal ─────────────────────────────────────────

function _openAddUserModal() {
  const modal    = document.getElementById('addUserModal');
  const nameInp  = document.getElementById('addUserName');
  const roleInp  = document.getElementById('addUserRole');
  const errEl    = document.getElementById('addUserError');
  const createBtn = document.getElementById('addUserCreateBtn');
  if (!modal) return;
  if (nameInp) nameInp.value = '';
  if (roleInp) roleInp.value = '';
  if (errEl)   { errEl.textContent = ''; errEl.style.display = 'none'; }
  if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Create'; }
  modal.style.display = '';
  requestAnimationFrame(() => modal.classList.add('au-modal-visible'));
  nameInp?.focus();
}

function _closeAddUserModal() {
  const modal = document.getElementById('addUserModal');
  if (!modal) return;
  modal.classList.remove('au-modal-visible');
  modal.addEventListener('transitionend', () => { modal.style.display = 'none'; }, { once: true });
}

async function _addUserCreate() {
  const nameInp  = document.getElementById('addUserName');
  const roleInp  = document.getElementById('addUserRole');
  const errEl    = document.getElementById('addUserError');
  const createBtn = document.getElementById('addUserCreateBtn');
  const name = (nameInp?.value || '').trim();
  if (!name) {
    if (errEl) { errEl.textContent = 'Full name is required.'; errEl.style.display = ''; }
    nameInp?.focus();
    return;
  }
  if (errEl) errEl.style.display = 'none';
  if (createBtn) { createBtn.disabled = true; createBtn.textContent = 'Creating…'; }
  try {
    const user = await window.api.createUser({ name, role: (roleInp?.value || '').trim() || null });
    _splashUsers = (await window.api.listUsers()) || [];
    _activeUser  = user;
    updateOperatorIndicator();
    _closeAddUserModal();
  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Could not create profile.'; errEl.style.display = ''; }
    if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Create'; }
  }
}

// ── Wire all operator-switch interactions ──────────────────────

function _wireSplashHandlers() {
  const switchBtn = document.getElementById('operatorSwitchBtn');
  const dropdown  = document.getElementById('operatorDropdown');

  switchBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (importRunning) return;
    if (dropdown && dropdown.style.display !== 'none') { _closeOpDropdown(); return; }
    try { _splashUsers = (await window.api.listUsers()) || []; } catch { /* ignore */ }
    _openOpDropdown();
  });

  document.addEventListener('click', (e) => {
    if (!dropdown || dropdown.style.display === 'none') return;
    if (!dropdown.contains(e.target) && !switchBtn?.contains(e.target)) _closeOpDropdown();
  });

  document.getElementById('opAddUserBtn')?.addEventListener('click', () => {
    _closeOpDropdown();
    _openAddUserModal();
  });

  document.getElementById('addUserCreateBtn')?.addEventListener('click', _addUserCreate);
  document.getElementById('addUserName')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _addUserCreate();
  });
  document.getElementById('addUserCancelBtn')?.addEventListener('click', _closeAddUserModal);
  document.getElementById('addUserModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('addUserModal')) _closeAddUserModal();
  });
}

async function initOperator() {
  try {
    const user = await window.api.getActiveUser();
    if (user) _activeUser = user;
    _splashUsers = (await window.api.listUsers()) || [];
  } catch { /* ignore */ }
  updateOperatorIndicator();
  _wireSplashHandlers();
}

function updateOperatorIndicator() {
  const initialsEl = document.getElementById('operatorInitials');
  const nameEl     = document.getElementById('operatorName');
  const switchBtn  = document.getElementById('operatorSwitchBtn');
  if (_activeUser) {
    if (initialsEl) initialsEl.textContent = _activeUser.initials || '?';
    if (nameEl)     nameEl.textContent     = _activeUser.name || '—';
    if (switchBtn)  switchBtn.disabled     = importRunning;
  } else {
    if (initialsEl) initialsEl.textContent = '—';
    if (nameEl)     nameEl.textContent     = '—';
  }
}

initOperator();
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
  const importIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
  const qiIcon     = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>`;
  const selIcon    = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`;
  const groupIcon  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
  const logIcon    = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  const resIcon    = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
  return `
    <div class="ob-tips">
      <div class="ob-tip">
        <div class="ob-tip-label">${importIcon} Event Import</div>
        Create or select an event, then import files into the structured archive.
        <div class="ob-tip-hint">For multi-component events, assign files to groups/sub-events before importing.</div>
      </div>
      <div class="ob-tip">
        <div class="ob-tip-label">${qiIcon} Quick Import</div>
        Use Quick Import for simple destination-based imports without event routing.
        <div class="ob-tip-hint">Choose a destination, select files, and import directly.</div>
      </div>
      <div class="ob-tip">
        <div class="ob-tip-label">${selIcon} Selecting &amp; Sorting</div>
        Select files manually or use Shift+click for range selection. Sort by Date to review newest files first.
        <div class="ob-tip-hint">Already-imported files are marked so they can be skipped safely.</div>
      </div>
      <div class="ob-tip">
        <div class="ob-tip-label">${groupIcon} Grouping Files</div>
        Use groups to route files into the correct sub-event.
        <div class="ob-tip-hint">Right-click selected files or use Cmd/Ctrl+G to assign them.</div>
      </div>
      <div class="ob-tip">
        <div class="ob-tip-label">${logIcon} Activity Log &amp; Verify Integrity</div>
        The Activity Log shows who imported what, when, from which source, and into which sub-event. Older imports may show "Source: Not recorded."
        <div class="ob-tip-hint">Use Verify Integrity to compare the audit record with files on disk — read-only, no changes made.</div>
      </div>
      <div class="ob-tip">
        <div class="ob-tip-label">${resIcon} Import Results</div>
        <div class="ob-result-rows">
          <div class="ob-result-row"><span class="ob-result-icon sum-copied">${SVG.check}</span><span><strong>Copied</strong> — successfully imported</span></div>
          <div class="ob-result-row"><span class="ob-result-icon sum-skipped">${SVG.skip}</span><span><strong>Skipped</strong> — already exists or intentionally skipped</span></div>
          <div class="ob-result-row"><span class="ob-result-icon sum-errors">${SVG.warn}</span><span><strong>Failed</strong> — could not be copied</span></div>
          <div class="ob-result-row"><span class="ob-result-icon" style="color:var(--yellow)">${SVG.warn}</span><span><strong>Check Imports</strong> — the audit entry needs review</span></div>
        </div>
      </div>
    </div>
    <div class="ob-beta">
      <div class="ob-beta-title">Beta Feedback</div>
      <ul class="ob-beta-list">
        <li><strong>Speed</strong> — anything slow or stuck?</li>
        <li><strong>Ease</strong> — anything confusing?</li>
        <li><strong>Reliability</strong> — any failed import, mismatch, or unexpected result?</li>
      </ul>
      <div style="margin-top:10px; font-size:0.82rem; color:var(--subtext);">
        If something fails: send a screenshot, describe what you were doing, and share the log file if possible.
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
    hero:  SVG.layers,
    title: 'Choose Event Import or Quick Import',
    body: `
      <div class="ob-steps">
        <div class="ob-step-row"><span class="ob-step-num">1</span><span><strong>Event Import</strong> — structured archive work with event routing and grouping.</span></div>
        <div class="ob-step-row"><span class="ob-step-num">2</span><span><strong>Quick Import</strong> — simple destination-based copying without event setup.</span></div>
      </div>
      <p class="ob-text">Select your mode on the home screen before starting.</p>`
  },
  {
    hero:  SVG.save,
    title: 'Set the event context',
    body: `
      <p class="ob-text">Create a new event or select an existing one from your master archive.</p>
      <p class="ob-text">AutoIngest uses the event structure to route files into the correct archive folders — no manual path entry needed.</p>`
  },
  {
    hero:  SVG.camera,
    title: 'Select and route files',
    body: `
      <div class="ob-steps">
        <div class="ob-step-row"><span class="ob-step-num">1</span><span>Connect or choose your source (card, drive, or folder)</span></div>
        <div class="ob-step-row"><span class="ob-step-num">2</span><span>Select the files you want to import</span></div>
        <div class="ob-step-row"><span class="ob-step-num">3</span><span>For multi-component events, assign files to <strong>groups/sub-events</strong></span></div>
        <div class="ob-step-row"><span class="ob-step-num">4</span><span>Choose photographer and click <strong>Import</strong></span></div>
      </div>`
  },
  {
    hero:  SVG.sparkles,
    title: "You're ready — quick reference",
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

// ── Frameless window controls ─────────────────────────────────────────────────
document.getElementById('minBtn')?.addEventListener('click', () => window.api.minimize());
document.getElementById('maxBtn')?.addEventListener('click', () => window.api.toggleMaximize());
document.getElementById('closeBtn')?.addEventListener('click', () => window.api.close());
document.getElementById('dashHeader')?.addEventListener('dblclick', (e) => {
  if (e.target.closest('button, input, select, a')) return;
  window.api.toggleMaximize();
});
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


// Hint 3: Selection hint — shown when files load but nothing is selected
const _hintSelObserver = setInterval(() => {
  if (currentFiles.length > 0 && selectedFiles.size === 0) {
    showInlineHint('toolbarSelCluster', 'New files are auto-selected', 'hint_sel_done');
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
      showMessage('Report sent — thank you!', 5000);
    } else {
      showMessage('Saved locally — will send when online.', 5000);
    }
  } catch {
    closeFeedbackModal();
    showMessage('Saved locally — will send when online.', 5000);
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

// ── TAC smoke-test panel (remove after Commit B) ──────────────────────────────
(function initTacTestPanel() {
  const overlay  = document.getElementById('tacTestOverlay');
  const closeBtn = document.getElementById('tacTestClose');
  const log      = document.getElementById('tacTestLog');
  if (!overlay) return;

  let instances = null;

  function logSelection(type, val) {
    const ts  = new Date().toLocaleTimeString();
    const msg = val
      ? `[${ts}] ${type}: "${val.label}"  (id: ${val.id})`
      : `[${ts}] ${type}: cleared`;
    log.textContent = msg + '\n' + log.textContent;
  }

  function mountInstances() {
    if (instances) return;
    instances = [
      new TreeAutocomplete({
        container:   document.getElementById('tacTestEventType'),
        type:        'event-types',
        placeholder: 'Select event type…',
        onSelect:    v => logSelection('event-types', v),
      }),
      new TreeAutocomplete({
        container:   document.getElementById('tacTestCity'),
        type:        'cities',
        placeholder: 'Select or add city…',
        onSelect:    v => logSelection('cities', v),
      }),
      new TreeAutocomplete({
        container:   document.getElementById('tacTestLocation'),
        type:        'locations',
        placeholder: 'Select or add location…',
        onSelect:    v => logSelection('locations', v),
      }),
      new TreeAutocomplete({
        container:   document.getElementById('tacTestPhotographer'),
        type:        'photographers',
        placeholder: 'Select or add photographer…',
        onSelect:    v => logSelection('photographers', v),
      }),
    ];
  }

  function open()  { mountInstances(); overlay.classList.add('visible'); }
  function close() { overlay.classList.remove('visible'); }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });

  const triggerBtn = document.getElementById('tacTestBtn');
  if (triggerBtn) triggerBtn.addEventListener('click', () => overlay.classList.contains('visible') ? close() : open());

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) close();
  });
}());

// ════════════════════════════════════════════════════════════════
// GROUPING — Commit F
// Steps 7 + 8: file-to-group assignment, group panel, context menu
// ════════════════════════════════════════════════════════════════

// ── Badge sync ─────────────────────────────────────────────────────────────

function syncGroupBadge(path) {
  const tile = tileMap.get(path);
  if (!tile) return;
  const g = GroupManager.getGroupForFile(path);

  // Bind tile-level group state so CSS rules for .in-group can read --group-color.
  if (g) {
    const tileColor = GroupManager.getGroupColor(GroupManager.getGroupIndex(g.id));
    tile.classList.add('in-group');
    tile.style.setProperty('--group-color', tileColor);
  } else {
    tile.classList.remove('in-group');
    tile.style.removeProperty('--group-color');
  }

  if (viewMode === 'icon') {
    let badge = tile.querySelector('.file-group-badge');
    if (g) {
      const color = GroupManager.getGroupColor(GroupManager.getGroupIndex(g.id));
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'file-group-badge';
        const metaRight = tile.querySelector('.file-meta-right');
        (metaRight || tile).appendChild(badge);
      }
      badge.textContent = g.label;
      badge.style.setProperty('--group-color', color);
      badge.style.removeProperty('background');
      badge.style.removeProperty('color');
    } else if (badge) {
      badge.remove();
    }
  } else {
    const nameCell = tile.querySelector('.lt-name');
    if (!nameCell) return;
    let badge = nameCell.querySelector('.grp-badge-list');
    if (g) {
      const color = GroupManager.getGroupColor(GroupManager.getGroupIndex(g.id));
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'grp-badge-list';
        nameCell.appendChild(badge);
      }
      badge.textContent = g.label;
      badge.style.setProperty('--group-color', color);
      badge.style.removeProperty('background');
      badge.style.removeProperty('color');
    } else if (badge) {
      badge.remove();
    }
  }
}

function syncAllGroupBadges() {
  for (const [path] of tileMap) syncGroupBadge(path);
}

// ── Portal dropdown (sub-event assignment) ────────────────────────────────

const Dropdown = (() => {
  let _menu = null;
  let _gid  = null;

  function close() {
    if (_menu) { _menu.remove(); _menu = null; _gid = null; }
  }

  function isOpen(gid) { return _gid === gid; }

  function open({ trigger, gid, items, groupColor, onSelect }) {
    close();
    const root = document.getElementById('dropdown-root');
    if (!root) return;

    const rect       = trigger.getBoundingClientRect();
    const menuWidth  = Math.max(rect.width, 180);
    const approxH    = items.length * 34 + 52; // items + clear row + padding

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Vertical: prefer below, flip above if it clips
    let top = rect.bottom + 6;
    if (top + approxH > vh - 8) top = Math.max(8, rect.top - approxH - 6);

    // Horizontal: clamp to viewport
    let left = rect.left;
    if (left + menuWidth > vw - 8) left = Math.max(8, vw - menuWidth - 8);

    const menu = document.createElement('div');
    menu.className = 'gc-dropdown';
    menu.style.cssText = `top:${top}px;left:${left}px;width:${menuWidth}px;--group-color:${groupColor};`;

    // Clear option at top
    const clearEl = document.createElement('div');
    clearEl.className = 'gc-dropdown-item gc-dropdown-clear';
    clearEl.textContent = '— clear —';
    menu.appendChild(clearEl);

    items.forEach(item => {
      const el = document.createElement('div');
      const classes = ['gc-dropdown-item'];
      if (item.disabled) classes.push('disabled');
      if (item.current)  classes.push('current');
      el.className = classes.join(' ');
      el.dataset.value = item.value;
      el.textContent   = item.label;
      menu.appendChild(el);
    });

    menu.addEventListener('click', e => {
      const item = e.target.closest('.gc-dropdown-item');
      if (!item || item.classList.contains('disabled')) return;
      const value = item.classList.contains('gc-dropdown-clear') ? '' : (item.dataset.value ?? '');
      close();
      onSelect(value);
    });

    root.appendChild(menu);
    _menu = menu;
    _gid  = gid;
  }

  // Outside-click dismissal (skip triggers — let trigger handler manage toggle)
  document.addEventListener('click', e => {
    if (_menu && !_menu.contains(e.target) && !e.target.closest('.gc-sub-trigger')) close();
  });

  // Scroll repositions trigger but not the fixed menu, so close
  document.addEventListener('scroll', close, true);

  // Keyboard dismiss
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _menu) close(); });

  return { open, close, isOpen };
})();

// Delegated handler for all .gc-sub-trigger clicks (survives innerHTML rebuilds)
document.addEventListener('click', e => {
  const trigger = e.target.closest('.gc-sub-trigger[data-gid]');
  if (!trigger) return;

  const gid = Number(trigger.dataset.gid);

  if (Dropdown.isOpen(gid)) { Dropdown.close(); return; }

  const groups    = GroupManager.getGroups();
  const subNames  = EventCreator.getSubEventNames();
  const thisGroup = groups.find(g => g.id === gid);
  if (!thisGroup) return;

  const takenIds = new Set(
    groups.filter(g => g.id !== gid && g.subEventId).map(g => g.subEventId)
  );
  const groupIdx   = groups.findIndex(g => g.id === gid);
  const groupColor = GroupManager.getGroupColor(groupIdx);

  const items = subNames.map(s => ({
    value:    s.id,
    label:    s.name,
    current:  thisGroup.subEventId === s.id,
    disabled: takenIds.has(s.id),
  }));

  Dropdown.open({
    trigger,
    gid,
    items,
    groupColor,
    onSelect(value) {
      GroupManager.setSubEvent(gid, value);
      renderGroupPanel();
    },
  });
});

// ── Group panel renderer ───────────────────────────────────────────────────

function renderGroupPanel() {
  Dropdown.close(); // close any open portal menu before rebuilding innerHTML

  const panel = document.getElementById('groupPanel');
  if (!panel) return;

  if ((EventCreator.getActiveEventData()?.event?.components?.length ?? 0) <= 1) {
    panel.classList.remove('visible');
    panel.innerHTML = '';
    return;
  }

  if (!GroupManager.hasGroups()) {
    panel.classList.remove('visible');
    panel.innerHTML = '';
    return;
  }
  panel.classList.add('visible');

  const groups   = GroupManager.getGroups();
  const subNames = EventCreator.getSubEventNames();

  // O(1) lookup for file metadata (name, modifiedAt) from the currently-loaded file list.
  const fileMetaMap = new Map((currentFiles || []).map(f => [f.path, f]));

  function _buildCardHtml(g, idx) {
    const color = GroupManager.getGroupColor(idx);

    // Sub-event section — only for multi-component events
    let subHtml = '';
    if (subNames.length > 0) {
      const mapped      = g.subEventId !== null;
      const mappedEnt   = mapped ? subNames.find(s => s.id === g.subEventId) : null;
      const mappedLabel = mapped ? (mappedEnt?.name ?? g.subEventId) : null;
      subHtml = `
        <div class="gc-subevent">
          <div class="gc-subevent-row">
            <span class="gp-sl">Sub-Event</span>
            <button class="gc-sub-trigger${mapped ? ' mapped' : ''}" data-gid="${g.id}" type="button">
              <span class="gc-sub-value">${mapped ? _esc(mappedLabel) : '— select —'}</span>
              <svg class="gc-sub-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="gc-status ${mapped ? 'ok' : 'warn'}">
            ${mapped ? `${SVG.check} ${_esc(mappedLabel)}` : `${SVG.warn} Not mapped`}
          </div>
        </div>`;
    }

    // File rows
    const fileRowsHtml = g.files.size === 0
      ? '<div class="gc-empty">Drop files here or use ⌘G</div>'
      : [...g.files].map(p => {
          const meta   = fileMetaMap.get(p);
          const name   = p.split(/[/\\]/).pop();
          const dotIdx = name.lastIndexOf('.');
          const ext    = dotIdx >= 0 ? name.slice(dotIdx + 1).toUpperCase() : '';
          const time   = meta?.modifiedAt
            ? new Date(meta.modifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
          return `<div class="gc-file-row">
            <span class="gc-file-name" title="${_esc(p)}">${_esc(name)}</span>
            ${ext  ? `<span class="gc-file-format">${_esc(ext)}</span>`  : ''}
            ${time ? `<span class="gc-file-time">${_esc(time)}</span>`   : ''}
          </div>`;
        }).join('');

    return `
      <div class="group-card" data-gid="${g.id}" style="--group-color:${color}">
        <div class="gc-header">
          <span class="gc-label">${_esc(g.label)}</span>
          <span class="gc-count">${g.files.size} file${g.files.size !== 1 ? 's' : ''}</span>
        </div>
        ${subHtml}
        <div class="gc-file-list">${fileRowsHtml}</div>
        <div class="gc-footer">
          <button class="gc-remove-btn" data-gid="${g.id}">✕ Remove ${_esc(g.label)}</button>
        </div>
      </div>`;
  }

  panel.innerHTML = `
    <div class="gp-header">Groups</div>
    <div class="gp-cards-container">
      ${groups.map((g, idx) => _buildCardHtml(g, idx)).join('')}
    </div>`;

  // Remove buttons
  panel.querySelectorAll('.gc-remove-btn[data-gid]').forEach(btn => {
    btn.addEventListener('click', () => {
      GroupManager.removeGroup(Number(btn.dataset.gid));
      syncAllGroupBadges();
      renderGroupPanel();
    });
  });

}

// ── Context menu (right-click on tile) ────────────────────────────────────

function _hideCtxMenu() {
  document.getElementById('groupCtxMenu').style.display = 'none';
}

document.getElementById('fileGrid').addEventListener('contextmenu', e => {
  const tile = e.target.closest('[data-path]');
  if (!tile) return;
  e.preventDefault();

  const path = tile.dataset.path;

  // Normalize selection: right-clicking outside current selection resets it
  if (!selectedFiles.has(path)) {
    selectedFiles.clear();
    selectedFiles.add(path);
    syncAllTiles();
    updateSelectionBar();
  }

  _showCtxMenu(e.clientX, e.clientY, path);
});

function _showCtxMenu(x, y, anchorPath) {
  if ((EventCreator.getActiveEventData()?.event?.components?.length ?? 0) <= 1) return;
  const menu    = document.getElementById('groupCtxMenu');
  const groups  = GroupManager.getGroups();
  const curGrp  = GroupManager.getGroupForFile(anchorPath);
  const selCount = selectedFiles.size;

  let html = `<div class="ctx-section">Assign ${selCount > 1 ? selCount + ' files' : 'to'} Group</div>`;

  groups.forEach((g, idx) => {
    const color = GroupManager.getGroupColor(idx);
    const act   = curGrp && curGrp.id === g.id;
    html += `<div class="ctx-item${act ? ' ctx-item-active' : ''}" data-action="assign" data-gid="${g.id}">
      <span class="ctx-dot" style="background:${color}"></span>
      ${_esc(g.label)} <span class="ctx-count">${g.files.size} file${g.files.size !== 1 ? 's' : ''}</span>
    </div>`;
  });

  html += `<div class="ctx-item ctx-item-new" data-action="new">
    <span class="ctx-dot-new">+</span> New Group
  </div>`;

  if (curGrp) {
    html += `<div class="ctx-sep"></div>
    <div class="ctx-item ctx-item-danger" data-action="unassign">Remove from ${_esc(curGrp.label)}</div>`;
  }

  menu.innerHTML = html;

  // Position (keep inside viewport)
  menu.style.display = 'block';
  const mw = menu.offsetWidth  || 220;
  const mh = menu.offsetHeight || 160;
  menu.style.left = (x + mw > window.innerWidth  ? window.innerWidth  - mw - 8 : x) + 'px';
  menu.style.top  = (y + mh > window.innerHeight ? window.innerHeight - mh - 8 : y) + 'px';

  menu.querySelectorAll('.ctx-item[data-action]').forEach(item => {
    item.addEventListener('click', () => {
      const paths = [...selectedFiles];
      if (item.dataset.action === 'assign') {
        GroupManager.assignFiles(paths, Number(item.dataset.gid));
      } else if (item.dataset.action === 'new') {
        const gid = GroupManager.createGroup();
        GroupManager.assignFiles(paths, gid);
      } else if (item.dataset.action === 'unassign') {
        GroupManager.unassignFiles(paths);
      }
      syncAllGroupBadges();
      renderGroupPanel();
      _hideCtxMenu();
    });
  });
}

// Dismiss context menu on click outside
document.addEventListener('click', e => {
  const menu = document.getElementById('groupCtxMenu');
  if (menu && !menu.contains(e.target)) _hideCtxMenu();
}, true);
document.addEventListener('scroll', _hideCtxMenu, true);

// ── Cmd/Ctrl+G → digit chord — group assignment ───────────────────────────
// Phase 1: Cmd+G starts a 500ms window + shows "Assign to group…" toast.
// Phase 2: digit 1–9 completes it, shows "Assigned to G{n}" for 1.2s.
// Guards: no-op when focus is inside an input/select/textarea.
// After assignment, selected files are auto-deselected.

let _gChordActive    = false;
let _gChordTimer     = null;
let _chordToastTimer = null;

function _showChordToast(text, variant) {
  const el = document.getElementById('gpChordToast');
  if (!el) return;
  clearTimeout(_chordToastTimer);
  el.textContent = text;
  el.className   = variant ? `active ${variant}` : 'active';
}
function _hideChordToast(delayMs) {
  _chordToastTimer = setTimeout(() => {
    const el = document.getElementById('gpChordToast');
    if (el) el.className = '';
  }, delayMs ?? 0);
}

document.addEventListener('keydown', e => {
  // Never intercept when the user is typing in a form field
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'Escape') {
    const sm = document.getElementById('settingsModal');
    if (sm?.classList.contains('visible')) { sm.classList.remove('visible'); return; }
  }

  if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
    e.preventDefault();
    if ((EventCreator.getActiveEventData()?.event?.components?.length ?? 0) <= 1) return;
    clearTimeout(_gChordTimer);
    _gChordActive = true;
    _gChordTimer  = setTimeout(() => {
      _gChordActive = false;
      _hideChordToast(0);
    }, 500);
    if (selectedFiles.size > 0) _showChordToast('Assign to group…');
    return;
  }

  if (!_gChordActive) return;
  const n = parseInt(e.key, 10);
  if (isNaN(n) || n < 1 || n > 9) return;

  e.preventDefault();
  clearTimeout(_gChordTimer);
  _gChordActive = false;

  if (selectedFiles.size === 0) { _hideChordToast(0); return; }

  const existing = GroupManager.getGroups().find(g => g.id === n);
  const gid      = existing ? existing.id : GroupManager.createGroup();
  GroupManager.assignFiles([...selectedFiles], gid);

  // Auto-deselect — no renderFileArea(), just tile class sync
  selectedFiles.clear();
  syncAllTiles();
  syncAllGroupBadges();
  renderGroupPanel();

  _showChordToast(`Assigned to G${gid}`, 'success');
  _hideChordToast(1200);
});

// ── Drag-and-drop: drop target (group panel) ─────────────────────────────────
// Delegated once on stable #groupPanel; resolves .group-card[data-gid] target
// on each event so it stays correct across renderGroupPanel() rebuilds.
//
//   Drop on .group-card[data-gid] → assign dragged files to that group

(function _wireGroupPanelDrop() {
  const panel = document.getElementById('groupPanel');
  if (!panel) return;

  panel.addEventListener('dragover', e => {
    if (!_draggedPaths.length) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const card = e.target.closest('.group-card[data-gid]');
    panel.querySelectorAll('.group-card').forEach(c => c.classList.remove('drag-over'));
    if (card) card.classList.add('drag-over');
  });

  panel.addEventListener('dragleave', e => {
    if (panel.contains(e.relatedTarget)) return;
    panel.querySelectorAll('.group-card').forEach(c => c.classList.remove('drag-over'));
  });

  panel.addEventListener('drop', e => {
    e.preventDefault();
    panel.querySelectorAll('.group-card').forEach(c => c.classList.remove('drag-over'));

    if (!_draggedPaths.length) return;
    const paths = [..._draggedPaths];
    for (const p of _draggedPaths) tileMap.get(p)?.classList.remove('dragging');
    _draggedPaths = [];

    const card = e.target.closest('.group-card[data-gid]');
    if (card) {
      GroupManager.assignFiles(paths, Number(card.dataset.gid));
      syncAllGroupBadges();
      renderGroupPanel();
    }
  });
})();
