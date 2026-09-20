'use strict';

/**
 * eventMetadataIntent.js — the archive-side, durable record of operator metadata intent.
 *
 * event.json carries two per-file intent records, both keyed by DESTINATION-relative path
 * (never an absolute source/card path — the card is gone by the time anything reads this):
 *
 *   tagRefinements  Tier 0  [{ eventTypes:string[], additionalKeywords:string[], relPaths:string[] }]
 *   metadataGroups  Tier 1  [{ metadataTags:string[], relPaths:string[] }]   (legacy MetaPicker)
 *
 * This module is the ONLY place that reads, merges, remaps or re-buckets them. It is pure
 * (no fs, no electron) so every rule is unit-testable. Precedence is NOT decided here — the
 * records are attached to resolver evidence by eventEvidenceReconstruction and
 * metadataExpectationService remains the single authority for precedence.
 *
 * INVARIANT (non-negotiable): absent ≠ explicit-empty.
 *   no record for a file                          → Default pipeline behavior
 *   { eventTypes:[], additionalKeywords:[] }      → explicit "No Tags"
 *   metadataTags:[]                               → explicit "no event keyword"
 * Presence is therefore decided ONLY by `Map.get(key) === undefined` / `Map.has`, never by
 * truthiness, `.length`, `||`, or filtering — including through merge and re-bucketing.
 *
 * FAIL CLOSED: malformed or conflicting records are never reinterpreted as Default. They are
 * surfaced as integrity errors (see integrityErrorFor) and preserved verbatim by every merge.
 */

const path = require('path');

const isStr = v => typeof v === 'string';
const isStrArr = v => Array.isArray(v) && v.every(isStr);
const clone = v => JSON.parse(JSON.stringify(v));

// ── Canonical destination identity ────────────────────────────────────────────────────

/**
 * Canonical event-relative key. Pure string logic (no path.sep) so a Windows-written record
 * resolves identically on POSIX and vice-versa.
 *   • NFC-normalized (macOS may hand back NFD names)
 *   • `\` → `/`, duplicate separators collapsed, `.` segments dropped
 *   • absolute-looking input, `..` segments, or an empty result → null (never an identity)
 * Case is preserved: matching is exact by design (no filesystem-case guessing).
 * @param {*} input
 * @returns {string|null}
 */
function relKey(input) {
  if (!isStr(input)) return null;
  const t = input.normalize('NFC').replace(/\\/g, '/');
  if (t.startsWith('/') || /^[A-Za-z]:/.test(t)) return null;
  const out = [];
  for (const seg of t.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null;
    out.push(seg);
  }
  return out.length ? out.join('/') : null;
}

/** relKey of a file, relative to its event folder, on the current platform. */
function fileRelKey(eventFolderPath, filePath) {
  if (!isStr(eventFolderPath) || !isStr(filePath)) return null;
  return relKey(path.relative(eventFolderPath, filePath));
}

// ── Record specs (Tier 0 / Tier 1 differ only in the payload they carry) ───────────────

const TR_SPEC = {
  field: 'tagRefinements',
  reasonPrefix: 'tag-refinement-record',
  validate: b => isStrArr(b.eventTypes) && isStrArr(b.additionalKeywords),
  valueOf: b => ({ eventTypes: [...b.eventTypes], additionalKeywords: [...b.additionalKeywords] }),
  equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  bucketId: v => JSON.stringify([v.eventTypes, v.additionalKeywords]),
  makeBucket: (v, relPaths) => ({ eventTypes: [...v.eventTypes], additionalKeywords: [...v.additionalKeywords], relPaths }),
  validValue: v => !!v && typeof v === 'object' && isStrArr(v.eventTypes) && isStrArr(v.additionalKeywords),
  cloneValue: v => ({ eventTypes: [...v.eventTypes], additionalKeywords: [...v.additionalKeywords] }),
};
const MG_SPEC = {
  field: 'metadataGroups',
  reasonPrefix: 'metadata-group-record',
  validate: b => isStrArr(b.metadataTags),
  valueOf: b => [...b.metadataTags],
  equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  bucketId: v => JSON.stringify(v),
  makeBucket: (v, relPaths) => ({ metadataTags: [...v], relPaths }),
  validValue: v => isStrArr(v),
  cloneValue: v => [...v],
};

// ── Parser ────────────────────────────────────────────────────────────────────────────

/**
 * Parses one persisted field into per-key records + everything that must be preserved
 * verbatim or reported. Never throws.
 */
function parseBuckets(raw, spec) {
  const st = {
    records: new Map(),          // key → value              (valid, unambiguous)
    conflicts: new Map(),        // key → reason             (malformed / conflicting)
    variants: new Map(),         // key → [bucket]           (verbatim conflict evidence, one relPath each)
    preserve: [],                // buckets carried verbatim (unattributable / unusable-path entries)
    fieldError: null,            // whole field untrustworthy
    diagnostics: [],
  };
  if (raw === undefined || raw === null) return st;              // absent field ⇒ no records
  if (!Array.isArray(raw)) { st.fieldError = `${spec.reasonPrefix}-field-malformed`; return st; }

  const addVariant = (key, bucket) => {
    if (!st.variants.has(key)) st.variants.set(key, []);
    st.variants.get(key).push(bucket);
  };

  raw.forEach((b, idx) => {
    if (!b || typeof b !== 'object' || !Array.isArray(b.relPaths)) {
      st.fieldError = st.fieldError || `${spec.reasonPrefix}-bucket-unattributable`;
      st.preserve.push(b);
      return;
    }
    const valueOk = spec.validate(b);
    const unusable = [];
    const keys = [];
    for (const rp of b.relPaths) {
      const k = relKey(rp);
      if (k === null) unusable.push(rp); else keys.push(k);
    }
    if (unusable.length) {
      st.diagnostics.push({ kind: 'unusable-path', bucket: idx, count: unusable.length });
      st.preserve.push({ ...clone(b), relPaths: unusable });       // junk paths can't be attributed; never dropped
    }
    for (const key of keys) {
      if (!valueOk) {
        st.conflicts.set(key, `${spec.reasonPrefix}-malformed`);
        if (st.records.has(key)) { addVariant(key, spec.makeBucket(st.records.get(key), [key])); st.records.delete(key); }
        addVariant(key, { ...clone(b), relPaths: [key] });
        continue;
      }
      const value = spec.valueOf(b);
      if (st.conflicts.has(key)) { addVariant(key, spec.makeBucket(value, [key])); continue; }
      if (st.records.has(key)) {
        if (spec.equal(st.records.get(key), value)) { st.diagnostics.push({ kind: 'duplicate-identical', key }); continue; }
        st.conflicts.set(key, `${spec.reasonPrefix}-conflict`);
        addVariant(key, spec.makeBucket(st.records.get(key), [key]));
        addVariant(key, spec.makeBucket(value, [key]));
        st.records.delete(key);
        continue;
      }
      st.records.set(key, value);
    }
  });
  return st;
}

const _cache = new WeakMap();

/**
 * Per-event index, built ONCE per event document (O(records)) and reused for every file
 * (O(1) lookups). Cached by document identity, invalidated if either field is reassigned.
 * @returns {{
 *   refinements: Map<string,{eventTypes:string[],additionalKeywords:string[]}>,
 *   metaTags: Map<string,string[]>,
 *   conflicts: Map<string,string>, fieldErrors: {tagRefinements?:string, metadataGroups?:string},
 *   diagnostics: object[],
 * }}
 */
function getIntent(eventJson) {
  if (!eventJson || typeof eventJson !== 'object') return _empty();
  const hit = _cache.get(eventJson);
  if (hit && hit.tr === eventJson.tagRefinements && hit.mg === eventJson.metadataGroups) return hit.intent;
  const tr = parseBuckets(eventJson.tagRefinements, TR_SPEC);
  const mg = parseBuckets(eventJson.metadataGroups, MG_SPEC);
  const conflicts = new Map();
  for (const [k, r] of tr.conflicts) conflicts.set(k, r);
  for (const [k, r] of mg.conflicts) if (!conflicts.has(k)) conflicts.set(k, r);
  const fieldErrors = {};
  if (tr.fieldError) fieldErrors.tagRefinements = tr.fieldError;
  if (mg.fieldError) fieldErrors.metadataGroups = mg.fieldError;
  const intent = { refinements: tr.records, metaTags: mg.records, conflicts, fieldErrors, diagnostics: [...tr.diagnostics, ...mg.diagnostics] };
  _cache.set(eventJson, { tr: eventJson.tagRefinements, mg: eventJson.metadataGroups, intent });
  return intent;
}
function _empty() { return { refinements: new Map(), metaTags: new Map(), conflicts: new Map(), fieldErrors: {}, diagnostics: [] }; }

/** Integrity error for a file's key (or null). A non-null value means: DO NOT GUESS. */
function integrityErrorFor(intent, key) {
  if (intent.fieldErrors.tagRefinements) return intent.fieldErrors.tagRefinements;
  if (intent.fieldErrors.metadataGroups) return intent.fieldErrors.metadataGroups;
  if (key !== null && intent.conflicts.has(key)) return intent.conflicts.get(key);
  return null;
}

// ── Re-bucketing (stable, explicit-empty preserving) ───────────────────────────────────

function _rebucket(spec, records, st) {
  const byId = new Map();
  for (const key of [...records.keys()].sort()) {
    const v = records.get(key);
    const id = spec.bucketId(v);
    if (!byId.has(id)) byId.set(id, { v, keys: [] });
    byId.get(id).keys.push(key);
  }
  const out = [...byId.values()].map(({ v, keys }) => spec.makeBucket(v, keys));   // explicit-empty buckets are kept
  for (const variants of st.variants.values()) for (const b of variants) out.push(clone(b));
  for (const b of st.preserve) out.push(clone(b));
  return out;
}

// ── Merge (multi-import) ──────────────────────────────────────────────────────────────

/**
 * Per-destination-key merge. `delta` is Map<key, value|undefined>:
 *   value      → this key's intent is now `value` (an explicit-empty value IS a record)
 *   undefined  → this key is now Default → its previous record is removed
 * Keys not in `delta` are preserved untouched, including conflicting/malformed evidence.
 * Returns { value, changed }. `value === undefined` with changed=true means "field now empty"
 * (writers drop the key, keeping the schema's "absent when none").
 */
function _merge(spec, existingRaw, delta) {
  if (!delta || delta.size === 0) return { value: existingRaw, changed: false };
  const st = parseBuckets(existingRaw, spec);
  if (existingRaw !== undefined && existingRaw !== null && !Array.isArray(existingRaw)) {
    return { value: existingRaw, changed: false, skipped: st.fieldError };   // never rewrite a field we cannot parse
  }
  let effective = false;
  const records = new Map(st.records);
  for (const [key, val] of delta) {
    if (st.conflicts.has(key)) { st.conflicts.delete(key); st.variants.delete(key); effective = true; }   // this import supersedes corrupt evidence
    const had = records.has(key);
    if (val === undefined) {
      if (had) { records.delete(key); effective = true; }
    } else if (!had || !spec.equal(records.get(key), val)) {
      records.set(key, spec.cloneValue(val));
      effective = true;
    }
  }
  if (!effective) return { value: existingRaw, changed: false };
  const out = _rebucket(spec, records, st);
  return { value: out.length ? out : undefined, changed: true };
}
const mergeTagRefinements = (existingRaw, delta) => _merge(TR_SPEC, existingRaw, delta);
const mergeMetadataGroups = (existingRaw, delta) => _merge(MG_SPEC, existingRaw, delta);

/**
 * What the CURRENT import decided, per destination key, mirroring what the resolver applied.
 * Includes copied AND same-size-skipped files (a skip still carries this import's intent).
 * @returns {{ refinements: Map, metaTags: Map, invalid: number }}
 */
function buildImportIntentDelta({ eventFolderPath, groups, copiedFiles, skippedFiles }) {
  const refinements = new Map();
  const metaTags = new Map();
  let invalid = 0;
  if (!Array.isArray(groups)) return { refinements, metaTags, invalid };

  const srcToGroup = new Map();
  for (const g of groups) {
    if (!g) continue;
    for (const f of (g.files ? [...g.files] : [])) srcToGroup.set(path.normalize(f), g);
  }
  const refMaps = new Map();
  const refMapFor = g => {
    if (!refMaps.has(g)) {
      const m = new Map();
      const src = g.fileTagRefinements;
      if (src && typeof src === 'object') for (const [k, v] of Object.entries(src)) m.set(path.normalize(k), v);
      refMaps.set(g, m);
    }
    return refMaps.get(g);
  };

  for (const f of [...(copiedFiles || []), ...(skippedFiles || [])]) {
    const key = fileRelKey(eventFolderPath, f && f.dest);
    if (key === null || !isStr(f.src)) continue;
    const srcNorm = path.normalize(f.src);
    const g = srcToGroup.get(srcNorm);
    let ref;
    if (g) {
      const raw = refMapFor(g).get(srcNorm);
      if (raw !== undefined) {
        if (!TR_SPEC.validValue(raw)) { invalid++; continue; }                 // malformed payload: touch nothing for this key
        ref = TR_SPEC.cloneValue(raw);
      }
    }
    refinements.set(key, ref);                                                  // undefined ⇒ Default ⇒ removes any old record
    metaTags.set(key, g && Array.isArray(g.metadataTags) ? [...g.metadataTags] : undefined);
  }
  return { refinements, metaTags, invalid };
}

// ── Key remapping (renames) ───────────────────────────────────────────────────────────

/** keyFn(key) → new key, or undefined/same to leave the key alone. */
function _remap(spec, raw, keyFn) {
  const st = parseBuckets(raw, spec);
  if (raw === undefined || raw === null || !Array.isArray(raw)) return { value: raw, changed: false };
  let changed = false;
  const mapKey = k => { const n = keyFn(k); if (n !== undefined && n !== null && n !== k) { changed = true; return n; } return k; };

  const records = new Map();
  const conflicts = new Map();
  const variants = new Map();
  const addVariant = (k, b) => { if (!variants.has(k)) variants.set(k, []); variants.get(k).push(b); };

  for (const [k, v] of st.records) {
    const nk = mapKey(k);
    if (conflicts.has(nk)) { addVariant(nk, spec.makeBucket(v, [nk])); continue; }
    if (records.has(nk)) {
      if (spec.equal(records.get(nk), v)) continue;
      conflicts.set(nk, `${spec.reasonPrefix}-conflict`);
      addVariant(nk, spec.makeBucket(records.get(nk), [nk])); addVariant(nk, spec.makeBucket(v, [nk]));
      records.delete(nk); continue;
    }
    records.set(nk, v);
  }
  for (const [k, list] of st.variants) {
    const nk = mapKey(k);
    conflicts.set(nk, st.conflicts.get(k));
    if (records.has(nk)) { addVariant(nk, spec.makeBucket(records.get(nk), [nk])); records.delete(nk); }
    for (const b of list) addVariant(nk, { ...b, relPaths: [nk] });
  }
  if (!changed) return { value: raw, changed: false };
  const out = _rebucket(spec, records, { variants, preserve: st.preserve });
  return { value: out.length ? out : undefined, changed: true };
}
const remapTagRefinements = (raw, keyFn) => _remap(TR_SPEC, raw, keyFn);
const remapMetadataGroups = (raw, keyFn) => _remap(MG_SPEC, raw, keyFn);

/** [{fromRel,toRel}] exact file pairs (already canonical or not — both sides are relKey'd). */
function exactPairRemapper(pairs) {
  const m = new Map();
  for (const p of pairs || []) { const f = relKey(p.fromRel), t = relKey(p.toRel); if (f !== null && t !== null) m.set(f, t); }
  return k => m.get(k);
}
/** [{fromPrefix,toPrefix}] directory renames — keys under `fromPrefix/` move under `toPrefix/`. No fuzzy matching. */
function prefixRemapper(pairs) {
  const list = [];
  for (const p of pairs || []) { const f = relKey(p.fromPrefix), t = relKey(p.toPrefix); if (f !== null && t !== null && f !== t) list.push([f + '/', t + '/']); }
  return k => { for (const [f, t] of list) if (k.startsWith(f)) return t + k.slice(f.length); return undefined; };
}

// ── Local First scoped merge ──────────────────────────────────────────────────────────

/**
 * Archive-side merge for a Local First sync. Staging is authoritative ONLY for files this sync
 * job actually copied (`pairs`, staging-relative → archive-relative, conflict renames already
 * reflected in toRel). Everything else stays exactly as the archive has it: staging entries for
 * files that were not copied are ignored, and can never erase archive-side intent.
 * @returns {{ tagRefinements:{value,changed}, metadataGroups:{value,changed}, notes:string[] }}
 */
function syncMergeIntent(archiveDoc, stagingDoc, pairs) {
  const notes = [];
  const result = {};
  for (const spec of [TR_SPEC, MG_SPEC]) {
    const st = parseBuckets(stagingDoc && stagingDoc[spec.field], spec);
    const delta = new Map();
    if (st.fieldError) {
      notes.push(`staging ${spec.field} untrustworthy (${st.fieldError}) — archive left untouched`);
    } else {
      for (const p of pairs || []) {
        const from = relKey(p.fromRel), to = relKey(p.toRel);
        if (from === null || to === null) continue;
        if (st.conflicts.has(from)) { notes.push(`staging ${spec.field} conflict for ${from} — archive left untouched`); continue; }
        delta.set(to, st.records.get(from));                                    // record or undefined(Default)
      }
    }
    result[spec.field] = _merge(spec, archiveDoc && archiveDoc[spec.field], delta);
  }
  return { tagRefinements: result.tagRefinements, metadataGroups: result.metadataGroups, notes };
}

module.exports = {
  relKey, fileRelKey,
  getIntent, integrityErrorFor,
  mergeTagRefinements, mergeMetadataGroups,
  buildImportIntentDelta,
  remapTagRefinements, remapMetadataGroups, exactPairRemapper, prefixRemapper,
  syncMergeIntent,
  // exposed for tests
  _parseTagRefinements: raw => parseBuckets(raw, TR_SPEC),
  _parseMetadataGroups: raw => parseBuckets(raw, MG_SPEC),
};
