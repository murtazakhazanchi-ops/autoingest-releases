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

  // Build a fast-lookup map: normalized label → keyword entry
  const byLabel = new Map();
  for (const kw of allKeywords) {
    if (kw.label) byLabel.set(kw.label.toLowerCase().trim(), kw);
  }

  _registry = { groups, keywords: allKeywords, byLabel };
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
    const raw = await fsp.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);

    await _loadRegistry(userDataPath);

    const parsed = _parseBridgeTxt(lines);
    const existing = _registry ? new Set(_registry.keywords.map(k => k.label.toLowerCase())) : new Set();

    const newKeywords    = [];
    let   unchangedCount = 0;
    const possibleMoves  = [];

    for (const kw of parsed) {
      const key = kw.label.toLowerCase();
      if (existing.has(key)) {
        unchangedCount++;
      } else {
        // Check if a keyword with same label exists under a different path (possible rename)
        const duplicate = _registry?.keywords.find(
          k => k.label.toLowerCase() === key && k.path !== kw.path
        );
        if (duplicate) {
          possibleMoves.push({ incoming: kw, existing: duplicate });
        } else {
          newKeywords.push(kw);
        }
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
        overrideDoc.keywords.push({ ...kw, addedAt: now, source: 'bridge-txt-import' });
      }

      const tmp = overridePath + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(overrideDoc, null, 2), 'utf-8');
      await fsp.rename(tmp, overridePath);

      // Invalidate registry cache so next load picks up new keywords
      _invalidateRegistry();
      log(`[metadataSyncService] Added ${newKeywords.length} keywords from Bridge TXT`);
    }

    return { ok: true, newKeywords, unchangedCount, possibleMoves };

  } catch (err) {
    return { ok: false, newKeywords: [], unchangedCount: 0, possibleMoves: [], error: err.message };
  }
}

/**
 * Parses Bridge keyword export TXT (tab-indented hierarchy).
 * Returns flat array of { label, path, category, groupLabel }.
 */
function _parseBridgeTxt(lines) {
  const result = [];
  const stack  = [];  // tracks current hierarchy path

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;

    // Count leading tabs to determine depth
    let depth = 0;
    while (depth < line.length && line[depth] === '\t') depth++;
    const label = line.slice(depth).trim();
    if (!label) continue;

    // Trim stack to current depth
    stack.length = depth;
    stack[depth] = label;

    const kwPath     = stack.slice(0, depth + 1).join(' > ');
    const groupLabel = stack[0] || '';
    const category   = _inferCategory(groupLabel);

    result.push({ label, path: kwPath, groupLabel, category });
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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  scanPendingEvents,
  syncEventMetadata,
  getSyncStatus,
  updateRegistryFromBridgeTxt,
};
