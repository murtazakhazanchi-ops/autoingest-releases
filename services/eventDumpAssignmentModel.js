/**
 * eventDumpAssignmentModel.js — dividing one card's photos between several events by capture time
 * (AI-FEAT-064 EQI-2, Multi-Event Quick Assignment). Pure: no Electron, no filesystem.
 *
 * Optional: the default Event Dump import (every new photo of the chosen date → one event) is
 * unchanged and never goes through this model.
 *
 * Rules
 *   - An ASSET is one shot: a RAW/JPEG pair (same folder + stem, linked by resolvePairs) or a single
 *     file. Every rule below applies to the whole asset, so a pair is never split between events.
 *   - Times are the camera's own wall clock as written (Q2 captureDateEvidence) — compared as naive
 *     seconds, never converted between time zones.
 *   - A time range is half-open: start <= captureTime < end. An end at or before the start means the
 *     range runs past midnight into the next day (max 24 hours). A photo on a shared boundary
 *     belongs to the later range only.
 *   - Ranges are the operator's instruction; nothing is assigned from a time gap. Gap suggestions
 *     are offered as possible boundaries only and never assign an event.
 *   - An asset inside two ranges that point at different events (or one at no event) is a CONFLICT:
 *     it is assigned nowhere and the import is blocked until the operator resolves it.
 *   - An asset without a reliable time (no capture date, or a video whose time zone is unknown) is
 *     never assigned by a range. Low-confidence times may be assigned one by one by the operator;
 *     undated files stay on the card (as in EQI-1).
 *   - A per-photo choice by the operator (manual correction) wins over ranges.
 *   - Already-imported files (the global import index) are never planned again.
 */

'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const DAY_S = 86400;
/** The override value that deliberately keeps a photo out of every event. */
const UNASSIGNED = '__unassigned__';
const GAP_OPTIONS_MIN = Object.freeze([30, 60, 90, 120]);

const pad2 = (n) => String(n).padStart(2, '0');

function isDate(d) {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
}
const isTime = (t) => typeof t === 'string' && TIME_RE.test(t);

/** Naive wall-clock seconds (no time zone): the same scale for every camera time on the card. */
function wallSeconds(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi, s = 0] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d) / 1000 + h * 3600 + mi * 60 + s;
}

/** Inverse of wallSeconds. */
function wallParts(sec) {
  const t = new Date(sec * 1000);
  return {
    date: `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`,
    time: `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}:${pad2(t.getUTCSeconds())}`,
  };
}

/** 'HH:MM' when the seconds are zero, else 'HH:MM:SS'. */
const shortTime = (time) => (time.length === 8 && time.endsWith(':00') ? time.slice(0, 5) : time);

/**
 * @param {{ date: string, start: string, end: string }} r
 * @returns {{ start: number, end: number, nextDay: boolean }} seconds; end exclusive
 */
function rangeInterval(r) {
  const start = wallSeconds(r.date, r.start);
  let end = wallSeconds(r.date, r.end);
  const nextDay = end <= start;
  if (nextDay) end += DAY_S;
  return { start, end, nextDay };
}

/** @returns {string|null} why a range is not valid, or null */
function rangeProblem(r) {
  if (!r || typeof r !== 'object') return 'invalid';
  if (!isDate(r.date)) return 'invalid-date';
  if (!isTime(r.start) || !isTime(r.end)) return 'invalid-time';
  return null;
}

const CONF_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Groups card records into assets (RAW/JPEG pairs travel together), chronologically.
 * Undated records are counted, never returned as assignable assets.
 * @param {Array<object>} records  cardAssessmentService job.records (resolvePairs output)
 * @param {{ isImported: (name: string, size: number) => boolean, cameraOf?: (index: number) => string|null }} deps
 * @returns {{ assets: object[], undated: { assets: number, files: number } }}
 *   assets[]: { id, files: [{ index, path, name, size, type, imported }], type, date, time, sec,
 *               reliable, camera, imported, newFiles, label }
 *   (paths stay in the main process; see publicAsset for the popup's view)
 */
function buildAssets(records, { isImported, cameraOf = () => null }) {
  const groups = new Map();
  const order = [];
  (records || []).forEach((r, index) => {
    const key = r.pairKey ? `p|${r.pairKey}` : `f|${index}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push({ r, index });
  });
  const assets = [];
  const undated = { assets: 0, files: 0 };
  for (const key of order) {
    const members = groups.get(key);
    const dated = members.filter(m => m.r.evidence && m.r.evidence.status === 'dated');
    if (dated.length !== members.length || dated.length === 0) {
      undated.assets++;
      undated.files += members.length;
      continue;
    }
    // resolvePairs makes pair members agree on the date; the asset's time is its earliest member's.
    const secs = dated.map(m => wallSeconds(m.r.evidence.date, m.r.evidence.time));
    const first = dated[secs.indexOf(Math.min(...secs))];
    const reliable = dated.every(m => m.r.evidence.confidence !== 'low');
    const files = members.map(m => ({
      index: m.index, path: m.r.path, name: m.r.name, size: m.r.size, type: m.r.type,
      imported: !!isImported(m.r.name, m.r.size),
    }));
    const types = new Set(files.map(f => f.type));
    const type = types.size > 1 ? 'pair' : files[0].type;
    const shown = files.find(f => f.type === 'photo') || files[0];
    const best = dated.reduce((a, b) => (CONF_RANK[b.r.evidence.confidence] > CONF_RANK[a.r.evidence.confidence] ? b : a));
    assets.push({
      id: null,
      files,
      type,
      date: first.r.evidence.date,
      time: first.r.evidence.time,
      sec: Math.min(...secs),
      reliable,
      confidence: best.r.evidence.confidence,
      camera: cameraOf(first.index) || null,
      imported: files.every(f => f.imported),
      newFiles: files.filter(f => !f.imported).length,
      label: shown.name,
      thumbPath: shown.path,
    });
  }
  assets.sort((a, b) => a.sec - b.sec || a.label.localeCompare(b.label));
  // Opaque, session-scoped ids: stable for one assessment of one card (the controller drops
  // per-photo choices when the assessment changes).
  assets.forEach((a, i) => { a.id = `a${i + 1}`; });
  return { assets, undated };
}

/**
 * Which event each asset goes to.
 * @param {object[]} assets  buildAssets().assets
 * @param {Array<{ id: string, date: string, start: string, end: string, eventId: string|null }>} ranges
 * @param {Map<string, string>} overrides  assetId → eventId | UNASSIGNED (the operator's per-photo choice)
 * @returns {{ byAsset: Map<string, { eventId: string|null, via: 'manual'|'range'|null, conflict: string[]|null, rangeId: string|null, needsChoice: boolean }>,
 *            overlaps: Array<{ a: string, b: string, sameEvent: boolean }> }}
 */
function assign(assets, ranges, overrides = new Map()) {
  const valid = (ranges || []).filter(r => !rangeProblem(r)).map(r => ({ ...r, ...rangeInterval(r) }));
  const byAsset = new Map();
  for (const a of assets) {
    if (overrides.has(a.id)) {
      const v = overrides.get(a.id);
      byAsset.set(a.id, { eventId: v === UNASSIGNED ? null : v, via: 'manual', conflict: null, rangeId: null, needsChoice: false });
      continue;
    }
    if (!a.reliable) {
      byAsset.set(a.id, { eventId: null, via: null, conflict: null, rangeId: null, needsChoice: true });
      continue;
    }
    const hits = valid.filter(r => r.start <= a.sec && a.sec < r.end);
    const targets = new Set(hits.map(r => r.eventId || null));
    if (hits.length === 0) byAsset.set(a.id, { eventId: null, via: null, conflict: null, rangeId: null, needsChoice: false });
    else if (targets.size > 1) byAsset.set(a.id, { eventId: null, via: null, conflict: hits.map(r => r.id), rangeId: null, needsChoice: false });
    else byAsset.set(a.id, { eventId: hits[0].eventId || null, via: 'range', conflict: null, rangeId: hits[0].id, needsChoice: false });
  }
  const overlaps = [];
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i], b = valid[j];
      if (a.start < b.end && b.start < a.end) overlaps.push({ a: a.id, b: b.id, sameEvent: !!a.eventId && a.eventId === b.eventId });
    }
  }
  return { byAsset, overlaps };
}

/**
 * Counts for the panel: per range, per event, unassigned, conflicts (files counted are NEW files only).
 * @returns {{ ranges: Map<string, {assets:number, files:number, conflicts:number}>, events: Map<string, {assets:number, files:number}>,
 *            unassigned: {assets:number, files:number, needsChoice:number, inRangeNoEvent:number, byDate: Object<string, number>},
 *            conflicts: {assets:number, files:number}, imported: {assets:number, files:number} }}
 */
function summarize(assets, assignment, ranges) {
  const out = {
    ranges: new Map((ranges || []).map(r => [r.id, { assets: 0, files: 0, conflicts: 0 }])),
    events: new Map(),
    unassigned: { assets: 0, files: 0, needsChoice: 0, inRangeNoEvent: 0, byDate: {} },
    conflicts: { assets: 0, files: 0 },
    imported: { assets: 0, files: 0 },
  };
  for (const a of assets) {
    const importedFiles = a.files.length - a.newFiles;
    if (importedFiles) { out.imported.files += importedFiles; if (a.imported) out.imported.assets++; }
    if (a.imported) continue;
    const s = assignment.byAsset.get(a.id);
    if (s.conflict) {
      out.conflicts.assets++; out.conflicts.files += a.newFiles;
      for (const id of s.conflict) if (out.ranges.has(id)) out.ranges.get(id).conflicts++;
      continue;
    }
    if (s.rangeId && out.ranges.has(s.rangeId)) { const r = out.ranges.get(s.rangeId); r.assets++; r.files += a.newFiles; }
    if (s.eventId) {
      if (!out.events.has(s.eventId)) out.events.set(s.eventId, { assets: 0, files: 0 });
      const e = out.events.get(s.eventId); e.assets++; e.files += a.newFiles;
    } else {
      out.unassigned.assets++; out.unassigned.files += a.newFiles;
      if (s.needsChoice) out.unassigned.needsChoice++;
      if (s.rangeId) out.unassigned.inRangeNoEvent++;
      out.unassigned.byDate[a.date] = (out.unassigned.byDate[a.date] || 0) + 1;
    }
  }
  return out;
}

/**
 * Possible boundaries: a pause of at least `minutes` between two consecutive new photos of `date`.
 * Never an event assignment. A gap already divided by a range edge, or dismissed, is not offered.
 * @returns {Array<{ key: string, beforeId: string, atId: string, sec: number, time: string, gapMinutes: number }>}
 */
function gapSuggestions(assets, { date, minutes, ranges = [], dismissed = new Set() }) {
  if (!GAP_OPTIONS_MIN.includes(minutes)) return [];
  const list = assets.filter(a => !a.imported && a.reliable && a.date === date);
  const edges = [];
  for (const r of ranges) {
    if (rangeProblem(r)) continue;
    const iv = rangeInterval(r);
    edges.push(iv.start, iv.end);
  }
  const out = [];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1], next = list[i];
    const gap = next.sec - prev.sec;
    if (gap < minutes * 60) continue;
    const key = `gap-${next.id}`;
    if (dismissed.has(key)) continue;
    if (edges.some(e => e > prev.sec && e <= next.sec)) continue;   // already a boundary there
    out.push({ key, beforeId: prev.id, atId: next.id, sec: next.sec, time: next.time, gapMinutes: Math.round(gap / 60) });
  }
  return out;
}

const _rangeAt = (r, startSec, endSec) => {
  const s = wallParts(startSec), e = wallParts(endSec);
  return { ...r, date: s.date, start: s.time, end: e.time };
};

/**
 * Split Here: the range holding `sec` becomes [start, sec) and [sec, end). The first part keeps
 * its event; the second starts with no event (the operator assigns it).
 * @returns {{ ok: true, ranges: object[], newId: string } | { ok: false, reason: string }}
 */
function splitAt(ranges, rangeId, sec, newId) {
  const i = ranges.findIndex(r => r.id === rangeId);
  if (i < 0) return { ok: false, reason: 'unknown-range' };
  const iv = rangeInterval(ranges[i]);
  if (!(iv.start < sec && sec < iv.end)) return { ok: false, reason: 'not-inside-range' };
  const first = _rangeAt(ranges[i], iv.start, sec);
  const second = { ..._rangeAt(ranges[i], sec, iv.end), id: newId, eventId: null };
  return { ok: true, ranges: [...ranges.slice(0, i), first, second, ...ranges.slice(i + 1)], newId };
}

/**
 * A new range starting at a photo that no range covers: until the next range starts, or one second
 * after the last photo of that run (never past 24 hours).
 */
function rangeFrom(assets, ranges, sec, newId) {
  const covered = (t) => ranges.some(r => { if (rangeProblem(r)) return false; const iv = rangeInterval(r); return iv.start <= t && t < iv.end; });
  if (covered(sec)) return { ok: false, reason: 'already-in-range' };
  const starts = ranges.filter(r => !rangeProblem(r)).map(r => rangeInterval(r).start).filter(s => s > sec);
  const limit = Math.min(sec + DAY_S - 1, ...starts);
  const run = assets.filter(a => a.reliable && a.sec >= sec && a.sec < limit).map(a => a.sec);
  const end = Math.min(limit, Math.max(sec, ...run) + 1);
  return { ok: true, range: _rangeAt({ id: newId, eventId: null }, sec, end) };
}

/**
 * Moves one edge of a range to the neighbouring photo: start ◀ includes the previous photo, start ▶
 * excludes the first one; end ▶ includes the next photo, end ◀ excludes the last one. A range that
 * shares that boundary exactly moves with it, so adjacent ranges stay adjacent.
 * @param {number[]} secs  sorted capture seconds of the card's photos
 */
function nudge(ranges, rangeId, edge, dir, secs) {
  const i = ranges.findIndex(r => r.id === rangeId);
  if (i < 0) return { ok: false, reason: 'unknown-range' };
  if (!['start', 'end'].includes(edge) || ![-1, 1].includes(dir)) return { ok: false, reason: 'invalid' };
  const iv = rangeInterval(ranges[i]);
  let target = null;
  if (edge === 'start') {
    if (dir < 0) target = [...secs].reverse().find(s => s < iv.start);
    else { const firstIn = secs.find(s => s >= iv.start); target = firstIn == null ? null : secs.find(s => s > firstIn); }
  } else if (dir > 0) {
    const nextOut = secs.find(s => s >= iv.end);
    target = nextOut == null ? null : nextOut + 1;
  } else {
    target = [...secs].reverse().find(s => s < iv.end);
  }
  if (target == null) return { ok: false, reason: 'no-photo' };
  const start = edge === 'start' ? target : iv.start;
  const end = edge === 'end' ? target : iv.end;
  if (end <= start || end - start > DAY_S) return { ok: false, reason: 'empty-range' };
  const old = edge === 'start' ? iv.start : iv.end;
  const next = ranges.map((r, j) => {
    if (j === i) return _rangeAt(r, start, end);
    if (rangeProblem(r)) return r;
    const o = rangeInterval(r);
    if (edge === 'start' && o.end === old && o.start < target) return _rangeAt(r, o.start, target);
    if (edge === 'end' && o.start === old && target < o.end) return _rangeAt(r, target, o.end);
    return r;
  });
  return { ok: true, ranges: next };
}

/**
 * The import plan: one batch per (event, photographer), files = the asset's NEW files only.
 * @param {(asset: object) => string|null} photographerFor
 * @returns {{ batches: Array<{ eventId: string, photographer: string, assetIds: string[], files: string[], firstSec: number }>,
 *            missingPhotographer: number }}
 */
function buildBatches(assets, assignment, photographerFor) {
  const batches = new Map();
  const seen = new Set();
  let missingPhotographer = 0;
  for (const a of assets) {
    if (a.imported) continue;
    const s = assignment.byAsset.get(a.id);
    if (!s || !s.eventId || s.conflict) continue;
    const ph = photographerFor(a);
    if (!ph) { missingPhotographer++; continue; }
    const key = `${s.eventId}\u0000${ph}`;
    if (!batches.has(key)) batches.set(key, { eventId: s.eventId, photographer: ph, assetIds: [], files: [], firstSec: a.sec });
    const b = batches.get(key);
    b.assetIds.push(a.id);
    for (const f of a.files) {
      if (f.imported) continue;
      if (seen.has(f.path)) throw new Error('eventDumpAssignmentModel: a file was planned twice');
      seen.add(f.path);
      b.files.push(f.path);
    }
  }
  return { batches: [...batches.values()].sort((x, y) => x.firstSec - y.firstSec), missingPhotographer };
}

/** The popup's view of one asset — names and times only, never a path. */
function publicAsset(a, s) {
  return {
    id: a.id, label: a.label, type: a.type, date: a.date, time: shortTime(a.time), sec: a.sec,
    reliable: a.reliable, imported: a.imported, files: a.files.length, newFiles: a.newFiles,
    camera: a.camera,
    eventId: s ? s.eventId : null, via: s ? s.via : null, conflict: !!(s && s.conflict), needsChoice: !!(s && s.needsChoice),
  };
}

module.exports = {
  UNASSIGNED, GAP_OPTIONS_MIN, DAY_S,
  isDate, isTime, wallSeconds, wallParts, shortTime, rangeInterval, rangeProblem,
  buildAssets, assign, summarize, gapSuggestions, splitAt, rangeFrom, nudge, buildBatches, publicAsset,
};
