'use strict';

/**
 * metadataSyncService.js — Bridge/XMP → event.json metadata sync engine.
 *
 * Source-of-truth hierarchy:
 *   event.json             — master event manifest (always authoritative)
 *   event.metadata.json   — child file-level metadata index (controlled by event.json.metadataIndex)
 *   keywords.override.json — controlled vocabulary
 *   XMP / Bridge           — external input layer only
 *
 * Safety rules enforced here:
 *   - Never overwrite event type, location, city, country, creator, or Hijri date.
 *   - Never delete auto-written keywords from the index.
 *   - Idempotent: running twice must not duplicate keywords.
 *   - event.metadata.json is written first; event.json only updated after it succeeds.
 *   - Concurrent sync to the same event is blocked (per-event lock).
 */

const path = require('path');
const fsp  = require('fs').promises;
const { log } = require('../services/logger');
const { readFileTags } = require('./exifService');

// ── Paths ─────────────────────────────────────────────────────────────────────

const REGISTRY_PATH = path.join(__dirname, '..', 'data', 'keywords.registry.json');

// ── Per-event concurrency lock ─────────────────────────────────────────────────
const _activeSyncs = new Map();  // eventFolderPath → 'running'

// ── Category → appliedAs mapping ──────────────────────────────────────────────
const APPLIED_AS_MAP = {
  people:      'personVisible',
  action:      'visualAction',
  attire:      'attireVisible',
  cameraAngle: 'cameraAngle',
  transport:   'transportVisible',
  misc:        'descriptiveContext',
};

// Categories that represent AutoIngest primary event identity.
const IDENTITY_CATEGORIES = new Set(['event', 'location', 'city', 'country']);

// ── Canonical root mapping ────────────────────────────────────────────────────
const _CANONICAL_ROOT = {
  event:       'event',
  location:    'location',
  city:        'city',
  country:     'country',
  people:      'people',
  action:      'action',
  attire:      'attire',
  cameraAngle: 'camera_angle',
  transport:   'transport',
  misc:        'misc',
};

// ── RAW extensions for sidecar peer lookup ────────────────────────────────────
const RAW_EXTENSIONS = ['.cr2', '.cr3', '.raw', '.nef', '.arw', '.dng', '.orf', '.rw2'];

// ── Slug / ID helpers ─────────────────────────────────────────────────────────

function _slugify(str) {
  return (str || '')
    .toLowerCase().trim()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\s_]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Strips leading sequential ordering prefix ("01 ", "04 " etc.) only for numbers ≤ 20.
function _stripOrderingPrefix(label) {
  const m = (label || '').match(/^(\d{1,2})\s(.+)$/);
  if (m && parseInt(m[1], 10) <= 20) return m[2];
  return label;
}

function _generateKeywordId(pathSegments, category) {
  if (!pathSegments || pathSegments.length === 0) return '';
  const root    = _CANONICAL_ROOT[category] || _slugify(pathSegments[0]);
  const parts   = [root];
  const lastIdx = pathSegments.length - 1;
  for (let i = 1; i < pathSegments.length; i++) {
    // Leaf segment preserves leading numbers; branch/group labels strip ordering prefix.
    const isLeaf = (i === lastIdx);
    const seg    = isLeaf ? pathSegments[i] : _stripOrderingPrefix(pathSegments[i]);
    const slug   = _slugify(seg);
    if (slug) parts.push(slug);
  }
  return parts.join('.');
}

function _pathStr(p) {
  return Array.isArray(p) ? p.join(' > ') : (p || '');
}

function _looksLikeSpellingUpdate(newLabel, existingLabel) {
  if (!newLabel || !existingLabel) return false;
  const nl = newLabel.toLowerCase().trim();
  const el = existingLabel.toLowerCase().trim();
  if (nl === el) return false;
  const newNum = nl.match(/^(\d+)\s/);
  const exNum  = el.match(/^(\d+)\s/);
  if (newNum && exNum && newNum[1] === exNum[1]) return true;
  if (nl.startsWith(el) || el.startsWith(nl)) return true;
  return false;
}

function _detectCollisions(parsedKeywords) {
  const seen = new Map();
  const collisions = [];
  for (const kw of parsedKeywords) {
    if (!kw.id) continue;
    if (seen.has(kw.id)) {
      const prev = seen.get(kw.id);
      collisions.push({
        id:    kw.id,
        labelA: prev.label,
        pathA:  _pathStr(prev.path),
        labelB: kw.label,
        pathB:  _pathStr(kw.path),
      });
    } else {
      seen.set(kw.id, kw);
    }
  }
  return collisions;
}

// ── Keyword registry ──────────────────────────────────────────────────────────

let _registry = null;

async function _loadRegistry(userDataPath) {
  if (_registry) return _registry;

  let base = { groups: [], keywords: [] };
  try {
    const raw = await fsp.readFile(REGISTRY_PATH, 'utf8');
    base = JSON.parse(raw);
  } catch {
    log('[metadataSyncService] Base registry not found or invalid — using empty registry.');
  }

  let overrides = { keywords: [] };
  if (userDataPath) {
    const overridePath = path.join(userDataPath, 'keywords.override.json');
    try {
      const raw = await fsp.readFile(overridePath, 'utf8');
      overrides = JSON.parse(raw);
    } catch { /* no override file yet — acceptable */ }
  }

  const allKeywords = [
    ...(base.keywords || []),
    ...(overrides.keywords || []),
  ];
  const groups = base.groups || [];

  const byLabel = new Map();
  const byId    = new Map();
  for (const kw of allKeywords) {
    if (kw.label) byLabel.set(kw.label.toLowerCase().trim(), kw);
    if (kw.id)    byId.set(kw.id, kw);
  }

  _registry = { groups, keywords: allKeywords, byLabel, byId };
  return _registry;
}

function _invalidateRegistry() {
  _registry = null;
}

function _lookupKeyword(label) {
  if (!_registry) return null;
  return _registry.byLabel.get((label || '').toLowerCase().trim()) || null;
}

function _getCategoryForGroup(groupId) {
  if (!_registry) return null;
  const group = _registry.groups.find(g => g.id === groupId);
  return group ? group.category : null;
}

// ── File scanner ──────────────────────────────────────────────────────────────

/**
 * Early-exit walk: returns true as soon as any .xmp sidecar under dir
 * has an mtime strictly after sinceMs (sinceMs=0 means any .xmp file).
 */
async function _hasXmpModifiedAfter(dir, sinceMs, depth) {
  if (depth > 8) return false;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (await _hasXmpModifiedAfter(full, sinceMs, depth + 1)) return true;
    } else if (e.isFile() && path.extname(e.name).toLowerCase() === '.xmp') {
      try {
        const st = await fsp.stat(full);
        if (st.mtimeMs > sinceMs) return true;
      } catch { /* skip unreadable */ }
    }
  }
  return false;
}

async function _scanXmpSidecars(eventFolderPath) {
  const sidecars = [];
  async function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (e.isFile() && path.extname(e.name).toLowerCase() === '.xmp') {
        sidecars.push(full);
      }
    }
  }
  await walk(eventFolderPath, 0);
  return sidecars;
}

/**
 * Returns the RAW peer file path for a given XMP sidecar.
 * Tries common RAW extensions in both lower and upper case.
 * Falls back to the XMP path itself if no RAW peer is found.
 */
async function _findRawPeer(xmpPath) {
  const dir  = path.dirname(xmpPath);
  const base = path.basename(xmpPath, path.extname(xmpPath));
  for (const ext of RAW_EXTENSIONS) {
    for (const variant of [ext, ext.toUpperCase()]) {
      try {
        const candidate = path.join(dir, base + variant);
        await fsp.access(candidate);
        return candidate;
      } catch { /* try next */ }
    }
  }
  return xmpPath;
}

// ── Subject-keyword reader ─────────────────────────────────────────────────────

async function _readKeywordsFromSidecar(xmpPath) {
  try {
    const tags = await readFileTags(xmpPath);
    const raw = tags.Subject ?? tags['XMP-dc:Subject'] ?? null;
    if (!raw) return [];
    return (Array.isArray(raw) ? raw : [raw])
      .map(k => String(k).trim())
      .filter(Boolean);
  } catch (err) {
    log(`[metadataSyncService] Could not read ${xmpPath}: ${err.message}`);
    return [];
  }
}

// ── event.metadata.json builder ───────────────────────────────────────────────

/**
 * Builds a new event.metadata.json document by merging an existing document
 * (if any) with new per-file sync results. Idempotent — running twice does not
 * duplicate keyword IDs or file entries.
 *
 * Storage model:
 *   keywords: { [keywordId]: { label, category, root, path } }  — keyword details once
 *   files:    { [relPath]:   { externalKeywordIds[], ... } }     — IDs only per file
 */
function _buildMetadataJsonDoc(existing, eventDoc, fileSyncMap, syncTs) {
  const keywords = Object.assign({}, existing?.keywords || {});
  const files    = Object.assign({}, existing?.files    || {});

  for (const [relPath, syncResult] of Object.entries(fileSyncMap)) {
    // Add keyword details to the dictionary once per ID
    for (const kw of (syncResult.externalKeywords || [])) {
      if (kw.keywordId && !keywords[kw.keywordId]) {
        keywords[kw.keywordId] = {
          label:    kw.label,
          category: kw.category,
          root:     kw.root || kw.category,
          path:     Array.isArray(kw.path) ? kw.path.join(' > ') : (kw.path || ''),
        };
      }
    }

    // Merge per-file entry (idempotent by ID set and label set)
    const prev         = files[relPath] || {};
    const prevExtIds   = new Set(prev.externalKeywordIds || []);
    const newExtIds    = (syncResult.externalKeywords || []).map(k => k.keywordId).filter(Boolean);
    for (const id of newExtIds) prevExtIds.add(id);

    const prevUnknown   = prev.unknownKeywords || [];
    const prevUnkLabels = new Set(prevUnknown.map(k => (k.label || '').toLowerCase()));
    const newUnknown    = (syncResult.unknownKeywords || []).filter(
      k => !prevUnkLabels.has((k.label || '').toLowerCase())
    );

    files[relPath] = {
      externalKeywordIds: [...prevExtIds],
      autoKeywordIds:     prev.autoKeywordIds || [],
      unknownKeywords:    [...prevUnknown, ...newUnknown],
      drift: {
        removedInExternal: syncResult.metadataDrift?.removedInExternalTool || prev.drift?.removedInExternal || [],
        skippedConflicts:  syncResult.metadataDrift?.skippedConflicts      || prev.drift?.skippedConflicts  || [],
      },
      lastSyncedAt: syncTs,
    };
  }

  // Summary counts
  let totalExtKws = 0, totalUnk = 0, totalDrift = 0;
  for (const f of Object.values(files)) {
    totalExtKws += (f.externalKeywordIds || []).length;
    totalUnk    += (f.unknownKeywords    || []).length;
    totalDrift  += ((f.drift?.removedInExternal?.length || 0) + (f.drift?.skippedConflicts?.length || 0));
  }

  return {
    version:           1,
    eventId:           eventDoc.eventId           || existing?.eventId || null,
    eventName:         eventDoc.eventName          || existing?.eventName || '',
    eventJsonUpdatedAt: eventDoc.updatedAt
      ? new Date(eventDoc.updatedAt).toISOString()
      : (existing?.eventJsonUpdatedAt || null),
    updatedAt: syncTs,
    keywords,
    files,
    summary: {
      filesIndexed:         Object.keys(files).length,
      externalKeywordCount: totalExtKws,
      unknownKeywordCount:  totalUnk,
      driftCount:           totalDrift,
    },
  };
}

/**
 * Writes event.metadata.json atomically, then updates event.json metadataIndex
 * and lastMetadataSync. If the metadata file write fails, event.json is not
 * touched — no partial state.
 */
async function _writeMetadataAndEventJson(eventFolderPath, metaDoc, syncTs) {
  const metaPath = path.join(eventFolderPath, 'event.metadata.json');
  const jsonPath = path.join(eventFolderPath, 'event.json');

  // Step 1: write event.metadata.json atomically
  const tmp1 = metaPath + '.tmp';
  try {
    await fsp.writeFile(tmp1, JSON.stringify(metaDoc, null, 2), 'utf-8');
    await fsp.rename(tmp1, metaPath);
  } catch (err) {
    try { await fsp.unlink(tmp1); } catch {}
    throw new Error(`event.metadata.json write failed: ${err.message}`);
  }

  // Step 2: update event.json (metadataIndex + lastMetadataSync; remove fileMeta if present)
  const raw2 = await fsp.readFile(jsonPath, 'utf8');
  const doc2 = JSON.parse(raw2);

  doc2.metadataIndex = {
    file:                 'event.metadata.json',
    version:              1,
    eventId:              doc2.eventId || null,
    status:               'synced',
    filesIndexed:         metaDoc.summary.filesIndexed,
    externalKeywordCount: metaDoc.summary.externalKeywordCount,
    unknownKeywordCount:  metaDoc.summary.unknownKeywordCount,
    driftCount:           metaDoc.summary.driftCount,
    updatedAt:            syncTs,
  };
  doc2.lastMetadataSync = syncTs;
  delete doc2.lastMetadataSyncError;
  if (doc2.fileMeta) delete doc2.fileMeta;  // migration cleanup
  doc2.updatedAt = Date.now();

  const tmp2 = jsonPath + '.tmp';
  try {
    await fsp.writeFile(tmp2, JSON.stringify(doc2, null, 2), 'utf-8');
    await fsp.rename(tmp2, jsonPath);
  } catch (err) {
    try { await fsp.unlink(tmp2); } catch {}
    throw new Error(`event.json metadataIndex update failed: ${err.message}`);
  }
}

/**
 * Converts a legacy fileMeta object (from event.json) into a fileSyncMap
 * compatible with _buildMetadataJsonDoc. Used during auto-migration.
 */
function _migrateFileMetaInDoc(fileMeta) {
  if (!fileMeta || typeof fileMeta !== 'object') return { fileSyncMap: {}, migratedCount: 0 };
  const fileSyncMap = {};
  for (const [relPath, meta] of Object.entries(fileMeta)) {
    fileSyncMap[relPath] = {
      externalKeywords: meta.externalKeywords || [],
      unknownKeywords:  meta.unknownKeywords  || [],
      metadataDrift: {
        removedInExternalTool: meta.metadataDrift?.removedInExternal || [],
        skippedConflicts:      meta.metadataDrift?.skippedConflicts  || [],
      },
    };
  }
  return { fileSyncMap, migratedCount: Object.keys(fileSyncMap).length };
}

// ── Per-file keyword classifier ───────────────────────────────────────────────

function _classifyKeywords(foundKeywords, autoKeywordSet, eventIdentity) {
  const now = new Date().toISOString();
  const externalKeywords  = [];
  const unknownKeywords   = [];
  const skippedConflicts  = [];

  for (const label of foundKeywords) {
    const kw = _lookupKeyword(label);

    if (!kw) {
      unknownKeywords.push({ label, source: 'bridge-manual', detectedAt: now });
      continue;
    }

    const category = kw.category || _getCategoryForGroup(kw.groupId) || 'misc';

    if (IDENTITY_CATEGORIES.has(category)) {
      const identityValue = eventIdentity[category];
      if (identityValue && identityValue.toLowerCase() !== label.toLowerCase()) {
        skippedConflicts.push({ label, category, reason: 'conflicts with AutoIngest identity', detectedAt: now });
      }
      continue;
    }

    const appliedAs = APPLIED_AS_MAP[category] || 'descriptiveContext';
    externalKeywords.push({
      keywordId: kw.id   || null,
      label,
      category,
      root:      kw.root || category,
      path:      kw.path || kw.groupLabel || '',
      scope:     'file',
      appliedAs,
      source:    'bridge-manual',
      verified:  true,
      syncedAt:  now,
    });
  }

  return { externalKeywords, unknownKeywords, skippedConflicts };
}

function _detectRemovedAutoKeywords(autoKeywords, foundKeywordsSet) {
  const now = new Date().toISOString();
  const removed = [];
  for (const kw of autoKeywords) {
    const label = typeof kw === 'string' ? kw : kw.label;
    if (!label) continue;
    if (!foundKeywordsSet.has(label.toLowerCase())) {
      removed.push({
        label,
        category:   typeof kw === 'object' ? (kw.category || '') : '',
        scope:      typeof kw === 'object' ? (kw.scope || 'file') : 'file',
        source:     'bridge-manual',
        detectedAt: now,
        status:     'pendingReview',
        reason:     'AutoIngest-written keyword missing from external metadata',
      });
    }
  }
  return removed;
}

// ── Public: scan pending events ───────────────────────────────────────────────

/**
 * Resolves the most recent completed metadata sync timestamp from event.json.
 * Prefers lastMetadataSync, then falls back to lastMetadataRun.timestamp
 * (written by the older metadata-tagging system) when its status is 'applied'.
 */
function _resolveLastSyncTs(doc) {
  if (doc.lastMetadataSync) return doc.lastMetadataSync;
  if (doc.lastMetadataRun?.status === 'applied' && doc.lastMetadataRun.timestamp) {
    return doc.lastMetadataRun.timestamp;
  }
  return null;
}

/**
 * Returns the immediate subdirectory names inside eventDir that contain at
 * least one .xmp file with mtime strictly after sinceMs.
 * Adds '.' when a changed .xmp is found directly in eventDir itself.
 */
async function _findChangedXmpSubfolders(eventDir, sinceMs) {
  const found = new Set();
  let entries;
  try { entries = await fsp.readdir(eventDir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(eventDir, e.name);
    if (e.isDirectory()) {
      if (await _hasXmpModifiedAfter(full, sinceMs, 0)) found.add(e.name);
    } else if (e.isFile() && path.extname(e.name).toLowerCase() === '.xmp') {
      try {
        const st = await fsp.stat(full);
        if (st.mtimeMs > sinceMs) found.add('.');
      } catch { /* skip */ }
    }
  }
  return [...found];
}

/**
 * Returns events in masterPath that need metadata sync.
 *
 * Pending reasons:
 *   'never-synced'             — no prior sync timestamp; has XMP sidecars
 *   'sync-error'               — lastMetadataSyncError or bad metadataIndex status
 *   'xmp-changed'              — XMP mtime newer than last sync
 *   'migration-needed'         — legacy fileMeta present, no metadataIndex yet
 *   'metadata-index-missing'   — metadataIndex.status = 'missing'
 *   'metadata-index-mismatch'  — metadataIndex.eventId ≠ event.json.eventId
 *
 * @param {string} masterPath  — the master folder, one level above event folders
 */
async function scanPendingEvents(masterPath) {
  if (!masterPath || typeof masterPath !== 'string') return [];

  let entries;
  try {
    entries = await fsp.readdir(masterPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const pending = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folderName      = entry.name;
    const eventFolderPath = path.join(masterPath, folderName);
    const jsonPath        = path.join(eventFolderPath, 'event.json');

    try {
      const raw = await fsp.readFile(jsonPath, 'utf8');
      const doc = JSON.parse(raw);
      if (!doc) continue;

      // Persisted sync error (current service)
      if (doc.lastMetadataSyncError) {
        pending.push({
          folderName, eventFolderPath,
          eventName:     doc.eventName || folderName,
          pendingReason: 'sync-error',
          lastSyncError: doc.lastMetadataSyncError.message || null,
        });
        continue;
      }

      // Old metadata-tagging system marked the run as error or partial
      const oldRunStatus = doc.lastMetadataRun?.status;
      if (oldRunStatus === 'error' || oldRunStatus === 'partial') {
        pending.push({
          folderName, eventFolderPath,
          eventName:     doc.eventName || folderName,
          pendingReason: 'sync-error',
          lastSyncError: `Previous metadata run status: ${oldRunStatus}`,
        });
        continue;
      }

      // Migration needed: fileMeta present but metadataIndex not yet created
      if (doc.fileMeta && !doc.metadataIndex) {
        pending.push({
          folderName, eventFolderPath,
          eventName:     doc.eventName || folderName,
          pendingReason: 'migration-needed',
          lastSyncError: null,
        });
        continue;
      }

      // Metadata index status checks
      if (doc.metadataIndex) {
        const idxStatus = doc.metadataIndex.status;
        if (idxStatus === 'error' || idxStatus === 'partial') {
          pending.push({
            folderName, eventFolderPath,
            eventName:     doc.eventName || folderName,
            pendingReason: 'sync-error',
            lastSyncError: `Metadata index status: ${idxStatus}`,
          });
          continue;
        }
        if (idxStatus === 'missing') {
          pending.push({
            folderName, eventFolderPath,
            eventName:     doc.eventName || folderName,
            pendingReason: 'metadata-index-missing',
            lastSyncError: null,
          });
          continue;
        }
        // eventId mismatch (only when both are present)
        if (doc.eventId && doc.metadataIndex.eventId && doc.metadataIndex.eventId !== doc.eventId) {
          pending.push({
            folderName, eventFolderPath,
            eventName:     doc.eventName || folderName,
            pendingReason: 'metadata-index-mismatch',
            lastSyncError: `Index eventId ${doc.metadataIndex.eventId} ≠ event ${doc.eventId}`,
          });
          continue;
        }
      }

      // Resolve prior sync timestamp
      const rawSyncTs  = _resolveLastSyncTs(doc);
      const lastSyncMs = rawSyncTs ? new Date(rawSyncTs).getTime() : NaN;

      if (!rawSyncTs || isNaN(lastSyncMs)) {
        // Only mark never-synced if event actually has XMP sidecars
        const hasXmp = await _hasXmpModifiedAfter(eventFolderPath, 0, 0);
        if (hasXmp) {
          pending.push({
            folderName, eventFolderPath,
            eventName:     doc.eventName || folderName,
            pendingReason: 'never-synced',
            lastSyncError: null,
          });
        }
        continue;
      }

      // Check if any XMP was modified after the resolved sync timestamp
      const hasChanged = await _hasXmpModifiedAfter(eventFolderPath, lastSyncMs, 0);
      if (hasChanged) {
        const changedSubfolders = await _findChangedXmpSubfolders(eventFolderPath, lastSyncMs);
        pending.push({
          folderName,
          eventFolderPath,
          eventName:      doc.eventName || folderName,
          pendingReason:  'xmp-changed',
          lastSyncError:  null,
          changedSubfolders,
        });
      }

    } catch {
      // No event.json or unreadable — skip
    }
  }

  return pending;
}

// ── Public: sync one event ─────────────────────────────────────────────────────

/**
 * Scans all XMP sidecars in eventFolderPath, reads keywords, classifies them
 * against the registry, and writes:
 *   1. event.metadata.json — normalized per-file keyword index
 *   2. event.json          — metadataIndex summary + lastMetadataSync
 *
 * Auto-migrates legacy fileMeta if present. Returns a rich result payload.
 *
 * @param {string} eventFolderPath
 * @param {string} userDataPath
 * @returns {Promise<SyncResult>}
 */
async function syncEventMetadata(eventFolderPath, userDataPath) {
  const startMs  = Date.now();
  const jsonPath = path.join(eventFolderPath, 'event.json');

  if (!eventFolderPath || typeof eventFolderPath !== 'string') {
    return { ok: false, success: false, error: 'Invalid event folder path' };
  }
  if (_activeSyncs.has(eventFolderPath)) {
    return { ok: false, success: false, error: 'Sync already running for this event' };
  }
  _activeSyncs.set(eventFolderPath, 'running');

  try {
    await _loadRegistry(userDataPath);

    let doc;
    try {
      const raw = await fsp.readFile(jsonPath, 'utf8');
      doc = JSON.parse(raw);
    } catch (err) {
      return { ok: false, success: false, error: `Cannot read event.json: ${err.message}` };
    }

    // Read existing event.metadata.json if present (for idempotent merging)
    let existingMetaDoc = null;
    const metaPath = path.join(eventFolderPath, 'event.metadata.json');
    try {
      const rawMeta = await fsp.readFile(metaPath, 'utf8');
      existingMetaDoc = JSON.parse(rawMeta);
    } catch { /* first sync or file missing */ }

    // Auto-migration: if legacy fileMeta present, seed existingMetaDoc from it
    if (doc.fileMeta && !doc.metadataIndex) {
      const { fileSyncMap: migMap } = _migrateFileMetaInDoc(doc.fileMeta);
      const migTs = doc.lastMetadataSync || new Date().toISOString();
      existingMetaDoc = _buildMetadataJsonDoc(existingMetaDoc, doc, migMap, migTs);
      log(`[metadataSyncService] Auto-migrating fileMeta for ${eventFolderPath}`);
    }

    // Build event identity map from event.json components
    const components    = Array.isArray(doc.components) ? doc.components : [];
    const eventIdentity = {};
    for (const comp of components) {
      if (comp.eventTypes?.length === 1) eventIdentity.event    = comp.eventTypes[0];
      if (comp.location)                  eventIdentity.location = comp.location;
      if (comp.city?.label)              eventIdentity.city     = comp.city.label;
      if (comp.country)                  eventIdentity.country  = comp.country;
    }

    const sidecars = await _scanXmpSidecars(eventFolderPath);
    const syncTs   = new Date().toISOString();

    if (sidecars.length === 0) {
      const emptyMeta = _buildMetadataJsonDoc(existingMetaDoc, doc, {}, syncTs);
      await _writeMetadataAndEventJson(eventFolderPath, emptyMeta, syncTs);
      return _makeOkResult(doc, eventFolderPath, 0, 0, 0, 0, 0, 0, 0, syncTs, startMs, [], [], []);
    }

    const fileSyncMap = {};
    let filesUpdated = 0;
    let totalExternal = 0, totalUnknown = 0, totalSkipped = 0, totalRemoved = 0;
    const allAddedKeywords  = [];
    const allUnknownKeywords = [];
    const allConflicts      = [];

    for (const sidecarPath of sidecars) {
      const foundKeywords = await _readKeywordsFromSidecar(sidecarPath);
      if (foundKeywords.length === 0) continue;

      const foundSet = new Set(foundKeywords.map(k => k.toLowerCase()));

      // Use RAW peer as the canonical file key (spec: prefer RAW over XMP relPath)
      const rawPeer    = await _findRawPeer(sidecarPath);
      const relPath    = path.relative(eventFolderPath, rawPeer);
      const xmpRelPath = path.relative(eventFolderPath, sidecarPath);

      // Existing auto keyword labels from event.metadata.json
      const existingFile   = existingMetaDoc?.files?.[relPath] || existingMetaDoc?.files?.[xmpRelPath] || {};
      const existingAutoIds = existingFile.autoKeywordIds || [];
      const existingAutoKws = existingAutoIds
        .map(id => existingMetaDoc?.keywords?.[id])
        .filter(Boolean);

      const { externalKeywords, unknownKeywords, skippedConflicts } = _classifyKeywords(
        foundKeywords,
        new Set(existingAutoKws.map(k => (k.label || '').toLowerCase())),
        eventIdentity
      );

      const removedInExternalTool = _detectRemovedAutoKeywords(existingAutoKws, foundSet);

      if (externalKeywords.length > 0 || unknownKeywords.length > 0 || removedInExternalTool.length > 0) {
        fileSyncMap[relPath] = {
          externalKeywords,
          unknownKeywords,
          metadataDrift: { removedInExternalTool, skippedConflicts },
        };
        filesUpdated++;
        totalExternal += externalKeywords.length;
        totalUnknown  += unknownKeywords.length;
        totalSkipped  += skippedConflicts.length;
        totalRemoved  += removedInExternalTool.length;
        allAddedKeywords.push(...externalKeywords.map(k => ({ ...k, file: relPath })));
        allUnknownKeywords.push(...unknownKeywords);
        allConflicts.push(...skippedConflicts);
      }
    }

    const newMetaDoc = _buildMetadataJsonDoc(existingMetaDoc, doc, fileSyncMap, syncTs);
    await _writeMetadataAndEventJson(eventFolderPath, newMetaDoc, syncTs);

    log(`[metadataSyncService] Synced ${eventFolderPath}: ${sidecars.length} XMP, ${filesUpdated} updated`);
    return _makeOkResult(
      doc, eventFolderPath,
      sidecars.length, sidecars.length, filesUpdated,
      totalExternal, totalUnknown, totalSkipped, totalRemoved,
      syncTs, startMs,
      allAddedKeywords, allUnknownKeywords, allConflicts
    );

  } catch (err) {
    log(`[metadataSyncService] Sync failed for ${eventFolderPath}: ${err.message}`);
    try {
      const raw    = await fsp.readFile(jsonPath, 'utf8');
      const errDoc = JSON.parse(raw);
      errDoc.lastMetadataSyncError = { message: err.message, at: new Date().toISOString() };
      errDoc.updatedAt = Date.now();
      const tmp = jsonPath + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(errDoc, null, 2), 'utf-8');
      await fsp.rename(tmp, jsonPath);
    } catch { /* error recording failed — proceed */ }
    return {
      ok: false, success: false,
      eventName: '', eventId: null, eventPath: eventFolderPath,
      scannedFiles: 0, scannedXmp: 0, updatedFiles: 0,
      externalKeywordsAdded: 0, unknownKeywordsFound: 0,
      skippedConflicts: 0, removedInExternalTool: 0,
      eventMetadataJsonUpdated: false, eventJsonUpdated: false,
      metadataIndexStatus: 'error',
      elapsedMs: Date.now() - startMs,
      addedKeywords: [], unknownKeywords: [], conflicts: [], errors: [err.message],
      filesScanned: 0, filesUpdated: 0,
      error: err.message,
    };
  } finally {
    _activeSyncs.delete(eventFolderPath);
  }
}

function _makeOkResult(doc, eventPath, scannedFiles, scannedXmp, updatedFiles,
  externalAdded, unknownFound, skippedConflicts, removedInExt,
  syncTs, startMs, addedKeywords, unknownKeywords, conflicts) {
  return {
    ok: true, success: true,
    eventName:  doc.eventName || '',
    eventId:    doc.eventId   || null,
    eventPath,
    scannedFiles, scannedXmp, updatedFiles,
    externalKeywordsAdded:  externalAdded,
    unknownKeywordsFound:   unknownFound,
    skippedConflicts,
    removedInExternalTool:  removedInExt,
    eventMetadataJsonUpdated: true,
    eventJsonUpdated:         true,
    metadataIndexStatus:      'synced',
    elapsedMs:   Date.now() - startMs,
    addedKeywords,
    unknownKeywords,
    conflicts,
    errors: [],
    // Backward-compatible fields
    filesScanned: scannedFiles,
    filesUpdated: updatedFiles,
  };
}

// ── Public: sync status ───────────────────────────────────────────────────────

async function getSyncStatus(eventFolderPath) {
  const isRunning = _activeSyncs.has(eventFolderPath);
  let lastSync = null;
  try {
    const raw = await fsp.readFile(path.join(eventFolderPath, 'event.json'), 'utf8');
    const doc = JSON.parse(raw);
    lastSync = doc.lastMetadataSync || null;
  } catch { /* ignore */ }
  return { status: isRunning ? 'running' : 'idle', lastSync };
}

// ── Public: Bridge TXT keyword import ─────────────────────────────────────────

async function updateRegistryFromBridgeTxt(filePath, userDataPath, applyChanges) {
  try {
    const raw   = await fsp.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);

    await _loadRegistry(userDataPath);

    const parsed = _parseBridgeTxt(lines);
    const idCollisions = _detectCollisions(parsed);

    const existingById    = new Map();
    const existingByLabel = new Map();
    for (const kw of (_registry ? _registry.keywords : [])) {
      if (kw.id)    existingById.set(kw.id, kw);
      if (kw.label) existingByLabel.set(kw.label.toLowerCase(), kw);
    }

    const newKeywords             = [];
    let   unchangedCount          = 0;
    const possibleMoves           = [];
    const possibleSpellingUpdates = [];

    for (const kw of parsed) {
      const labelKey   = kw.label.toLowerCase();
      const idMatch    = kw.id ? existingById.get(kw.id) : null;
      const labelMatch = existingByLabel.get(labelKey);

      if (idMatch) {
        if (idMatch.label.toLowerCase() === labelKey) {
          unchangedCount++;
        } else {
          possibleSpellingUpdates.push({
            existingLabel:  idMatch.label,
            existingId:     idMatch.id,
            existingPath:   _pathStr(idMatch.path),
            candidateLabel: kw.label,
            candidatePath:  _pathStr(kw.path),
            parentId:       kw.parentId || null,
            parentPath:     kw.path ? _pathStr(kw.path.slice(0, -1)) : null,
            reason:         'same-id-different-label',
          });
        }
      } else if (labelMatch) {
        const existingPathStr = labelMatch.path ? _pathStr(labelMatch.path) : null;
        const newPathStr      = _pathStr(kw.path);
        if (existingPathStr && existingPathStr !== newPathStr) {
          possibleMoves.push({ incoming: kw, existing: labelMatch });
        } else {
          unchangedCount++;
        }
      } else {
        if (kw.parentId) {
          const sibling = (_registry ? _registry.keywords : []).find(
            k => k.parentId === kw.parentId && _looksLikeSpellingUpdate(kw.label, k.label)
          );
          if (sibling) {
            possibleSpellingUpdates.push({
              existingLabel:  sibling.label,
              existingId:     sibling.id,
              existingPath:   _pathStr(sibling.path),
              candidateLabel: kw.label,
              candidatePath:  _pathStr(kw.path),
              parentId:       kw.parentId || null,
              parentPath:     kw.path ? _pathStr(kw.path.slice(0, -1)) : null,
              reason:         'same-parent-similar-label',
            });
            continue;
          }
        }
        newKeywords.push(kw);
      }
    }

    if (applyChanges && idCollisions.length > 0) {
      return { ok: false, newKeywords: [], unchangedCount: 0, possibleMoves: [], possibleSpellingUpdates: [], idCollisions, error: 'ID collisions detected — resolve before applying.' };
    }

    if (applyChanges && newKeywords.length > 0) {
      const overridePath = path.join(userDataPath, 'keywords.override.json');
      let overrideDoc = { version: 1, keywords: [] };
      try {
        const raw2 = await fsp.readFile(overridePath, 'utf8');
        overrideDoc = JSON.parse(raw2);
      } catch { /* first-time creation */ }

      const now = new Date().toISOString();
      for (const kw of newKeywords) {
        overrideDoc.keywords.push({ ...kw, importedAt: now, updatedAt: now, source: 'bridge-txt-import' });
      }

      const tmp = overridePath + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(overrideDoc, null, 2), 'utf-8');
      await fsp.rename(tmp, overridePath);

      _invalidateRegistry();
      log(`[metadataSyncService] Added ${newKeywords.length} keywords from Bridge TXT`);
    }

    return { ok: true, newKeywords, unchangedCount, possibleMoves, possibleSpellingUpdates, idCollisions };

  } catch (err) {
    return { ok: false, newKeywords: [], unchangedCount: 0, possibleMoves: [], possibleSpellingUpdates: [], idCollisions: [], error: err.message };
  }
}

function _parseBridgeTxt(lines) {
  const result = [];
  const stack  = [];

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;

    let depth = 0;
    while (depth < line.length && line[depth] === '\t') depth++;
    const label = line.slice(depth).trim();
    if (!label) continue;

    stack.length = depth;
    stack[depth] = label;

    if (depth === 0) continue;

    const pathArray  = stack.slice(0, depth + 1);
    const groupLabel = stack[0] || '';
    const category   = _inferCategory(groupLabel);
    const id         = _generateKeywordId(pathArray, category);
    const parentId   = _generateKeywordId(pathArray.slice(0, -1), category) || null;

    result.push({
      id,
      label,
      category,
      root:         _CANONICAL_ROOT[category] || category,
      path:         [...pathArray],
      parentId,
      depth,
      aliases:      [],
      labelHistory: [],
      status:       'active',
      source:       'bridge-import',
      groupLabel,
    });
  }

  return result;
}

function _inferCategory(groupLabel) {
  const g = (groupLabel || '').toLowerCase();
  if (g.includes('event'))      return 'event';
  if (g.includes('location'))   return 'location';
  if (g.includes('city'))       return 'city';
  if (g.includes('country'))    return 'country';
  if (g.includes('people'))     return 'people';
  if (g.includes('action') || g.includes('position')) return 'action';
  if (g.includes('attire') || g.includes('access'))   return 'attire';
  if (g.includes('camera') || g.includes('angle'))    return 'cameraAngle';
  if (g.includes('transport'))  return 'transport';
  return 'misc';
}

// ── Public: registry helpers ───────────────────────────────────────────────────

async function getKeywordsByCategory(category, userDataPath) {
  const reg = await _loadRegistry(userDataPath);
  return (reg.keywords || []).filter(k => k.category === category && k.status !== 'deprecated');
}

async function loadRegistryFull(userDataPath) {
  return _loadRegistry(userDataPath);
}

async function repairOverrideIds(userDataPath) {
  const overridePath = path.join(userDataPath, 'keywords.override.json');
  let overrideDoc;
  try {
    const raw = await fsp.readFile(overridePath, 'utf8');
    overrideDoc = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'keywords.override.json not found or unreadable' };
  }

  const keywords = overrideDoc.keywords || [];
  if (keywords.length === 0) return { ok: true, repairedCount: 0 };

  const idRemap = new Map();
  const now = new Date().toISOString();

  const repaired = keywords.map(kw => {
    if (!kw.path || !Array.isArray(kw.path)) return kw;
    const category  = kw.category || _inferCategory(kw.path[0] || '');
    const newId     = _generateKeywordId(kw.path, category);
    const newParent = kw.path.length > 1
      ? _generateKeywordId(kw.path.slice(0, -1), category)
      : null;
    if (newId && newId !== kw.id) idRemap.set(kw.id, newId);
    return { ...kw, id: newId || kw.id, parentId: newParent || kw.parentId || null, updatedAt: now };
  });

  const fixed = repaired.map(kw => {
    if (kw.parentId && idRemap.has(kw.parentId)) return { ...kw, parentId: idRemap.get(kw.parentId) };
    return kw;
  });

  const byId = new Map();
  for (const kw of fixed) byId.set(kw.id, kw);
  overrideDoc.keywords = Array.from(byId.values());

  const tmp = overridePath + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(overrideDoc, null, 2), 'utf-8');
  await fsp.rename(tmp, overridePath);

  _invalidateRegistry();
  log(`[metadataSyncService] repairOverrideIds: ${idRemap.size} IDs regenerated`);
  return { ok: true, repairedCount: idRemap.size };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  scanPendingEvents,
  syncEventMetadata,
  getSyncStatus,
  updateRegistryFromBridgeTxt,
  repairOverrideIds,
  getKeywordsByCategory,
  loadRegistryFull,
};
