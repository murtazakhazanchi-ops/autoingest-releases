'use strict';

/**
 * metadataSyncService.js — Bridge/XMP → event.json metadata sync engine.
 *
 * Core principle: event.json is the source of truth.
 * Bridge/XMP is an external input layer only.
 *
 * This service:
 *   1. Scans event folders to find those without a lastMetadataSync timestamp.
 *   2. Reads XMP sidecar keywords via exiftool for each archived file.
 *   3. Classifies keywords: auto (AutoIngest-written), external (Bridge-added),
 *      unknown (not in registry), or identity (event/location — protected).
 *   4. Detects drift: AutoIngest-written keywords missing from XMP.
 *   5. Writes the result back to event.json atomically.
 *
 * Safety rules enforced here:
 *   - Never overwrite event type, location, city, country, creator, or Hijri date.
 *   - Never delete auto-written keywords from event.json.
 *   - Idempotent: running twice must not duplicate keywords.
 *   - Concurrent sync to the same event is blocked (per-event lock).
 */

const path = require('path');
const fsp  = require('fs').promises;
const { log } = require('../services/logger');
const { readFileTags } = require('./exifService');

// ── Paths ─────────────────────────────────────────────────────────────────────

const REGISTRY_PATH = path.join(__dirname, '..', 'data', 'keywords.registry.json');

// ── Per-event concurrency lock ─────────────────────────────────────────────────
// Prevents two sync jobs from writing the same event.json simultaneously.
const _activeSyncs = new Map();  // eventFolderPath → 'running' | 'queued'

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
// Bridge keywords in these categories are never used to overwrite identity fields.
const IDENTITY_CATEGORIES = new Set(['event', 'location', 'city', 'country']);

// ── Canonical root mapping (category → stable ID prefix) ─────────────────────
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
// Numbers like 51, 53 are meaningful reference identifiers and are preserved intact.
function _stripOrderingPrefix(label) {
  const m = (label || '').match(/^(\d{1,2})\s(.+)$/);
  if (m && parseInt(m[1], 10) <= 20) return m[2];
  return label;
}

function _generateKeywordId(pathSegments, category) {
  if (!pathSegments || pathSegments.length === 0) return '';
  const root  = _CANONICAL_ROOT[category] || _slugify(pathSegments[0]);
  const parts = [root];
  for (let i = 1; i < pathSegments.length; i++) {
    const slug = _slugify(_stripOrderingPrefix(pathSegments[i]));
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

  // Build fast-lookup maps: by normalized label and by stable ID
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
 * has an mtime strictly after sinceMs. Avoids reading file content.
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

// ── Subject-keyword reader ─────────────────────────────────────────────────────

async function _readKeywordsFromSidecar(xmpPath) {
  try {
    const tags = await readFileTags(xmpPath);
    // exiftool-vendored returns Subject as array or single string
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

// ── Event.json metadata writer (atomic) ───────────────────────────────────────

async function _writeFileSyncResults(eventFolderPath, fileSyncMap) {
  const jsonPath = path.join(eventFolderPath, 'event.json');
  let doc;
  try {
    const raw = await fsp.readFile(jsonPath, 'utf8');
    doc = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Cannot read event.json: ${err.message}`);
  }

  if (!doc || typeof doc !== 'object') throw new Error('event.json is invalid');

  // Merge per-file sync results into the existing fileMeta section.
  // fileMeta is keyed by relative path from eventFolderPath.
  if (!doc.fileMeta || typeof doc.fileMeta !== 'object') doc.fileMeta = {};

  for (const [relPath, syncResult] of Object.entries(fileSyncMap)) {
    const existing = doc.fileMeta[relPath] || {};
    const merged   = _mergeSyncResult(existing, syncResult);
    doc.fileMeta[relPath] = merged;
  }

  doc.lastMetadataSync = new Date().toISOString();
  delete doc.lastMetadataSyncError;  // clear any prior error state on success
  doc.updatedAt = Date.now();

  const tmp = jsonPath + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf-8');
    await fsp.rename(tmp, jsonPath);
  } catch (err) {
    try { await fsp.unlink(tmp); } catch {}
    throw new Error(`Atomic write failed: ${err.message}`);
  }
}

function _mergeSyncResult(existing, incoming) {
  // autoKeywords: preserve existing — never delete AutoIngest-written keywords
  const autoKeywords = existing.autoKeywords
    ? [...existing.autoKeywords]
    : (incoming.autoKeywords || []);

  // externalKeywords: merge by label — idempotent, no duplicates
  const existingExternal = Array.isArray(existing.externalKeywords)
    ? existing.externalKeywords
    : [];
  const existingLabels = new Set(existingExternal.map(k => k.label.toLowerCase()));
  const newExternal = (incoming.externalKeywords || []).filter(
    k => !existingLabels.has(k.label.toLowerCase())
  );
  const externalKeywords = [...existingExternal, ...newExternal];

  // unknownKeywords: merge by label — idempotent
  const existingUnknown = Array.isArray(existing.unknownKeywords) ? existing.unknownKeywords : [];
  const existingUnkLabels = new Set(existingUnknown.map(k => (k.label || k).toLowerCase()));
  const newUnknown = (incoming.unknownKeywords || []).filter(
    k => !existingUnkLabels.has((k.label || k).toLowerCase())
  );
  const unknownKeywords = [...existingUnknown, ...newUnknown];

  // effectiveKeywords: auto + external labels, deduplicated
  const effectiveSet = new Set([
    ...autoKeywords.map(k => (typeof k === 'string' ? k : k.label)),
    ...externalKeywords.map(k => k.label),
  ]);
  const effectiveKeywords = [...effectiveSet];

  // metadataDrift: preserve existing + add new detected drift
  const existingDrift = existing.metadataDrift || {};
  const removedInExternal = _mergeRemoved(
    existingDrift.removedInExternalTool || [],
    incoming.metadataDrift?.removedInExternalTool || []
  );
  const skippedConflicts = _mergeRemoved(
    existingDrift.skippedConflicts || [],
    incoming.metadataDrift?.skippedConflicts || []
  );

  return {
    ...existing,
    autoKeywords,
    externalKeywords,
    unknownKeywords,
    effectiveKeywords,
    metadataDrift: { removedInExternal, skippedConflicts },
  };
}

function _mergeRemoved(existing, incoming) {
  const labels = new Set(existing.map(k => (k.label || k).toLowerCase()));
  const added = incoming.filter(k => !labels.has((k.label || k).toLowerCase()));
  return [...existing, ...added];
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

    // Identity categories: check for conflict with existing AutoIngest identity
    if (IDENTITY_CATEGORIES.has(category)) {
      const identityValue = eventIdentity[category];
      if (identityValue && identityValue.toLowerCase() !== label.toLowerCase()) {
        skippedConflicts.push({ label, category, reason: 'conflicts with AutoIngest identity', detectedAt: now });
      }
      // If it matches existing identity, skip as duplicate (no value adding it twice)
      continue;
    }

    const appliedAs = APPLIED_AS_MAP[category] || 'descriptiveContext';
    externalKeywords.push({
      label,
      category,
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
        category: typeof kw === 'object' ? (kw.category || '') : '',
        scope:     typeof kw === 'object' ? (kw.scope || 'file') : 'file',
        source:    'bridge-manual',
        detectedAt: now,
        status:    'pendingReview',
        reason:    'AutoIngest-written keyword missing from external metadata',
      });
    }
  }
  return removed;
}

// ── Public: scan pending events ───────────────────────────────────────────────

/**
 * Returns events in masterPath that need metadata sync.
 * Three cases:
 *   'never-synced'  — no lastMetadataSync timestamp
 *   'sync-error'    — no lastMetadataSync and lastMetadataSyncError is present
 *   'xmp-changed'   — has lastMetadataSync but at least one XMP sidecar was
 *                     modified after that timestamp
 *
 * Reads event.json for each event; XMP mtime check is stat-only, early-exit.
 *
 * @param {string} masterPath
 * @returns {Promise<Array<{folderName, eventFolderPath, eventName, pendingReason, lastSyncError}>>}
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

      // A persisted sync error takes priority — surface it regardless of lastMetadataSync
      if (doc.lastMetadataSyncError) {
        pending.push({
          folderName,
          eventFolderPath,
          eventName:     doc.eventName || folderName,
          pendingReason: 'sync-error',
          lastSyncError: doc.lastMetadataSyncError.message || null,
        });
        continue;
      }

      if (!doc.lastMetadataSync) {
        pending.push({
          folderName, eventFolderPath,
          eventName:     doc.eventName || folderName,
          pendingReason: 'never-synced',
          lastSyncError: null,
        });
        continue;
      }

      // Synced before, no error — check if any XMP was modified after the last sync
      const lastSyncMs = new Date(doc.lastMetadataSync).getTime();
      if (isNaN(lastSyncMs)) {
        pending.push({
          folderName, eventFolderPath,
          eventName:     doc.eventName || folderName,
          pendingReason: 'never-synced',
          lastSyncError: null,
        });
        continue;
      }

      const hasChanged = await _hasXmpModifiedAfter(eventFolderPath, lastSyncMs, 0);
      if (hasChanged) {
        pending.push({
          folderName,
          eventFolderPath,
          eventName:     doc.eventName || folderName,
          pendingReason: 'xmp-changed',
          lastSyncError: null,
        });
      }
      // No XMP changed → event is up to date, omit from pending

    } catch {
      // No event.json or unreadable — skip
    }
  }

  return pending;
}

// ── Public: sync one event ─────────────────────────────────────────────────────

/**
 * Scans all XMP sidecars in eventFolderPath, reads keywords, classifies them
 * against the registry, and updates event.json atomically.
 *
 * @param {string} eventFolderPath
 * @param {string} userDataPath  — for loading the keyword override registry
 * @returns {Promise<{ok:boolean, filesScanned:number, filesUpdated:number, error?:string}>}
 */
async function syncEventMetadata(eventFolderPath, userDataPath) {
  if (!eventFolderPath || typeof eventFolderPath !== 'string') {
    return { ok: false, error: 'Invalid event folder path' };
  }

  // Concurrency guard — reject if already running for this event
  if (_activeSyncs.has(eventFolderPath)) {
    return { ok: false, error: 'Sync already running for this event' };
  }
  _activeSyncs.set(eventFolderPath, 'running');

  try {
    // Load registry (lazy-cached)
    await _loadRegistry(userDataPath);

    // Read event.json for identity context
    const jsonPath = path.join(eventFolderPath, 'event.json');
    let doc;
    try {
      const raw = await fsp.readFile(jsonPath, 'utf8');
      doc = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: `Cannot read event.json: ${err.message}` };
    }

    // Build identity map from event.json components
    const components   = Array.isArray(doc.components) ? doc.components : [];
    const eventIdentity = {};
    for (const comp of components) {
      if (comp.eventTypes?.length === 1) eventIdentity.event    = comp.eventTypes[0];
      if (comp.location)                  eventIdentity.location = comp.location;
      if (comp.city?.label)              eventIdentity.city     = comp.city.label;
      if (comp.country)                  eventIdentity.country  = comp.country;
    }

    // Scan all XMP sidecars in the event folder
    const sidecars = await _scanXmpSidecars(eventFolderPath);
    if (sidecars.length === 0) {
      // No sidecars yet — still mark as synced so it doesn't show as pending forever
      await _writeFileSyncResults(eventFolderPath, {});
      return { ok: true, filesScanned: 0, filesUpdated: 0 };
    }

    const fileSyncMap = {};
    let filesUpdated  = 0;

    for (const sidecarPath of sidecars) {
      const foundKeywords = await _readKeywordsFromSidecar(sidecarPath);
      if (foundKeywords.length === 0) continue;

      const foundSet = new Set(foundKeywords.map(k => k.toLowerCase()));

      // Existing auto keywords for this file (from event.json fileMeta if present)
      const relPath = path.relative(eventFolderPath, sidecarPath);
      const existingMeta    = doc.fileMeta?.[relPath] || {};
      const existingAutoKws = Array.isArray(existingMeta.autoKeywords)
        ? existingMeta.autoKeywords
        : [];

      const { externalKeywords, unknownKeywords, skippedConflicts } =
        _classifyKeywords(foundKeywords, new Set(existingAutoKws.map(k => (typeof k === 'string' ? k : k.label).toLowerCase())), eventIdentity);

      const removedInExternalTool = _detectRemovedAutoKeywords(existingAutoKws, foundSet);

      if (externalKeywords.length > 0 || unknownKeywords.length > 0 || removedInExternalTool.length > 0) {
        fileSyncMap[relPath] = {
          externalKeywords,
          unknownKeywords,
          metadataDrift: { removedInExternalTool, skippedConflicts },
        };
        filesUpdated++;
      }
    }

    await _writeFileSyncResults(eventFolderPath, fileSyncMap);

    log(`[metadataSyncService] Synced ${eventFolderPath}: ${sidecars.length} files scanned, ${filesUpdated} updated`);
    return { ok: true, filesScanned: sidecars.length, filesUpdated };

  } catch (err) {
    log(`[metadataSyncService] Sync failed for ${eventFolderPath}: ${err.message}`);
    // Best-effort: persist the error so the next scan can classify this event as 'sync-error'
    try {
      const jsonPath = path.join(eventFolderPath, 'event.json');
      const raw      = await fsp.readFile(jsonPath, 'utf8');
      const errDoc   = JSON.parse(raw);
      errDoc.lastMetadataSyncError = { message: err.message, at: new Date().toISOString() };
      errDoc.updatedAt = Date.now();
      const tmp = jsonPath + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(errDoc, null, 2), 'utf-8');
      await fsp.rename(tmp, jsonPath);
    } catch { /* if we can't record the error, proceed anyway */ }
    return { ok: false, error: err.message };
  } finally {
    _activeSyncs.delete(eventFolderPath);
  }
}

// ── Public: sync status ───────────────────────────────────────────────────────

/**
 * Returns the current sync status for an event folder.
 * @param {string} eventFolderPath
 * @returns {{ status: 'running' | 'idle', lastSync: string|null }}
 */
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

/**
 * Parses an Adobe Bridge keyword export TXT file (hierarchical indent format).
 * Returns { newKeywords, unchangedCount, possibleMoves } for preview.
 * When applyChanges = true, saves new keywords to userData/keywords.override.json.
 *
 * Bridge TXT format:
 *   Group Label\n
 *   \tKeyword Label\n
 *   \t\tChild Label\n
 *
 * @param {string} filePath       — path to the Bridge .txt export
 * @param {string} userDataPath   — app.getPath('userData')
 * @param {boolean} applyChanges  — false = preview only; true = save additions
 * @returns {Promise<{ok:boolean, newKeywords:object[], unchangedCount:number, possibleMoves:object[], error?:string}>}
 */
async function updateRegistryFromBridgeTxt(filePath, userDataPath, applyChanges) {
  try {
    const raw   = await fsp.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);

    await _loadRegistry(userDataPath);

    const parsed = _parseBridgeTxt(lines);

    // Build lookup maps from the currently loaded registry
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
          unchangedCount++;  // same path, same label — truly unchanged
        } else {
          // Same path structure (ID), different label → possible spelling/name update
          possibleSpellingUpdates.push({ incoming: kw, existing: idMatch });
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
        // No ID or label match — check for sibling spelling update under same parent
        if (kw.parentId) {
          const sibling = (_registry ? _registry.keywords : []).find(
            k => k.parentId === kw.parentId && _looksLikeSpellingUpdate(kw.label, k.label)
          );
          if (sibling) {
            possibleSpellingUpdates.push({ incoming: kw, existing: sibling });
            continue;
          }
        }
        newKeywords.push(kw);
      }
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

    return { ok: true, newKeywords, unchangedCount, possibleMoves, possibleSpellingUpdates };

  } catch (err) {
    return { ok: false, newKeywords: [], unchangedCount: 0, possibleMoves: [], possibleSpellingUpdates: [], error: err.message };
  }
}

/**
 * Parses Bridge keyword export TXT (tab-indented hierarchy).
 * Returns flat array of keyword entries with stable IDs, category/root,
 * path array, parentId, and depth — ready for the registry entry shape.
 * Depth-0 entries (group headers) are skipped; they live in registry.groups.
 */
function _parseBridgeTxt(lines) {
  const result = [];
  const stack  = [];  // current hierarchy path labels

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;

    let depth = 0;
    while (depth < line.length && line[depth] === '\t') depth++;
    const label = line.slice(depth).trim();
    if (!label) continue;

    // Update stack at this depth
    stack.length = depth;
    stack[depth] = label;

    // Depth 0 = group header; already represented in registry.groups, not a keyword itself
    if (depth === 0) continue;

    const pathArray  = stack.slice(0, depth + 1);
    const groupLabel = stack[0] || '';
    const category   = _inferCategory(groupLabel);
    const id         = _generateKeywordId(pathArray, category);
    // depth 1 items: parent is the root group (e.g. "event", "people")
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

/**
 * Returns all active keywords for a given category.
 * Supports future category-filtered views for Event Creator dropdowns,
 * Additional Keywords, search, etc. — without any migration in this phase.
 */
async function getKeywordsByCategory(category, userDataPath) {
  const reg = await _loadRegistry(userDataPath);
  return (reg.keywords || []).filter(k => k.category === category && k.status !== 'deprecated');
}

/**
 * Returns the fully-loaded registry object { groups, keywords, byLabel, byId }.
 * For renderer-side registry diagnostics and status display.
 */
async function loadRegistryFull(userDataPath) {
  return _loadRegistry(userDataPath);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  scanPendingEvents,
  syncEventMetadata,
  getSyncStatus,
  updateRegistryFromBridgeTxt,
  getKeywordsByCategory,
  loadRegistryFull,
};
