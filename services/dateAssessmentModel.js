/**
 * dateAssessmentModel.js — classifies a card's files by capture date (AI-FEAT-061 Q2).
 * Pure: no Electron, no filesystem, no clock (callers pass "today").
 *
 * A record is { path, name, type: 'photo'|'raw'|'video', size, evidence } where evidence
 * comes from captureDateEvidence.captureEvidence(). Paths stay in the main process: the
 * summary built here for the companion popup carries counts and dates only.
 *
 * Selection (DEC-029 decision 4):
 *   { date }              — one capture calendar date (default: today, local time)
 *   { date, untilTime }   — that date plus the next day's early hours up to untilTime,
 *                           for a shoot that continues past midnight
 * Every file is counted exactly once: selected · earlier · later · uncertain.
 */

'use strict';

const path = require('path');

/** End times offered for "continues past midnight" (next calendar day, exclusive). */
const AFTER_MIDNIGHT_OPTIONS = Object.freeze(['01:00', '02:00', '03:00', '04:00', '05:00', '06:00']);
/** RAW and JPEG of one shot are written together; more apart than this is not the same shot. */
const PAIR_TIME_TOLERANCE_S = 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function _seconds(time) {
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/** Absolute seconds of a wall-clock date+time (for comparing two written times). */
function _wallSeconds(ev) {
  const [y, m, d] = ev.date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 1000 + _seconds(ev.time);
}

function _pairKey(record) {
  if (record.type !== 'photo' && record.type !== 'raw') return null;
  const { dir, name } = path.parse(record.path);
  return `${dir}${path.sep}${name}`.toLowerCase();
}

/**
 * Links RAW/JPEG files of one shot (same folder + same file stem) and reconciles their
 * dates: members that agree keep their dates and an undated member takes the pair's
 * best-evidenced date; members that disagree make the whole pair uncertain.
 * @param {Array<object>} records
 * @returns {Array<object>} new records with `pairKey` (null when not part of a pair)
 */
function resolvePairs(records) {
  const groups = new Map();
  for (const r of records) {
    const key = _pairKey(r);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const resolved = new Map();
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const dated = members.filter(m => m.evidence.status === 'dated');
    const times = dated.map(m => _wallSeconds(m.evidence));
    const consistent = dated.length > 0 &&
      new Set(dated.map(m => m.evidence.date)).size === 1 &&
      Math.max(...times) - Math.min(...times) <= PAIR_TIME_TOLERANCE_S;
    const conflicting = dated.length > 1 && !consistent;
    const best = consistent
      ? dated.reduce((a, b) => (CONFIDENCE_RANK[b.evidence.confidence] > CONFIDENCE_RANK[a.evidence.confidence] ? b : a))
      : null;
    for (const m of members) {
      let evidence = m.evidence;
      if (conflicting) {
        evidence = {
          status: 'uncertain', date: null, time: null, offset: null, source: null, confidence: null,
          reason: 'pair-inconsistent',
          candidates: dated.map(o => ({ source: o.name, date: o.evidence.date })),
        };
      } else if (best && m.evidence.status !== 'dated') {
        evidence = { ...best.evidence, source: `pair:${best.name}`, inheritedFromPair: true };
      }
      resolved.set(m, { ...m, pairKey: key, evidence });
    }
  }
  return records.map(r => resolved.get(r) || { ...r, pairKey: null });
}

/**
 * @param {unknown} selection  untrusted
 * @param {string} today  'YYYY-MM-DD'
 * @returns {{ date: string, untilTime: string|null }}
 */
function normalizeSelection(selection, today) {
  const date = selection && typeof selection.date === 'string' && DATE_RE.test(selection.date) ? selection.date : today;
  const untilTime = selection && AFTER_MIDNIGHT_OPTIONS.includes(selection.untilTime) ? selection.untilTime : null;
  return { date, untilTime };
}

/** @returns {'selected'|'earlier'|'later'|'uncertain'} */
function classify(evidence, selection) {
  if (!evidence || evidence.status !== 'dated') return 'uncertain';
  const { date, untilTime } = selection;
  if (evidence.date === date) return 'selected';
  if (untilTime && evidence.date === addDays(date, 1) && _seconds(evidence.time) < _seconds(`${untilTime}:00`)) return 'selected';
  return evidence.date < date ? 'earlier' : 'later';
}

/** Paths of the files a selection covers (main process only). */
function filesForSelection(records, selection) {
  return records.filter(r => classify(r.evidence, selection) === 'selected').map(r => r.path);
}

/**
 * Path-free summary for the companion popup.
 * @param {Array<object>} records  output of resolvePairs()
 * @param {{ today: string, selection?: object }} opts
 */
function summarize(records, { today, selection }) {
  const sel = normalizeSelection(selection, today);
  const counts = { selected: 0, earlier: 0, later: 0, uncertain: 0, total: records.length };
  const selectedBreakdown = { photo: 0, raw: 0, video: 0, pairs: 0, lowConfidence: 0 };
  const uncertainReasons = {};
  const perDate = new Map();
  const selectedPairs = new Map();
  const earlierDates = new Set();
  const laterDates = new Set();
  let afterToday = 0;

  for (const r of records) {
    const ev = r.evidence;
    if (ev.status === 'dated') {
      perDate.set(ev.date, (perDate.get(ev.date) || 0) + 1);
      if (ev.date > today) afterToday++;
    } else {
      uncertainReasons[ev.reason] = (uncertainReasons[ev.reason] || 0) + 1;
    }
    const bucket = classify(ev, sel);
    counts[bucket]++;
    if (bucket === 'earlier') earlierDates.add(ev.date);
    if (bucket === 'later') laterDates.add(ev.date);
    if (bucket !== 'selected') continue;
    selectedBreakdown[r.type] = (selectedBreakdown[r.type] || 0) + 1;
    if (ev.confidence === 'low') selectedBreakdown.lowConfidence++;
    if (r.pairKey) selectedPairs.set(r.pairKey, (selectedPairs.get(r.pairKey) || 0) + 1);
  }
  selectedBreakdown.pairs = [...selectedPairs.values()].filter(n => n > 1).length;

  const relation = (d) => (d === today ? 'today' : d < today ? 'earlier' : 'later');
  const optionDates = new Set([...perDate.keys(), today, sel.date]);
  const options = [...optionDates].sort().reverse().map(d => ({ date: d, count: perDate.get(d) || 0, relation: relation(d) }));

  // Camera clock possibly wrong: nothing from today, but files on other dates.
  let suggestion = null;
  if (!perDate.get(today) && perDate.size > 0) {
    const [date, count] = [...perDate.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0];
    if (date !== sel.date) suggestion = { date, count };
  }

  return {
    today,
    selection: sel,
    counts,
    selectedBreakdown,
    earlierDateCount: earlierDates.size,
    laterDateCount: laterDates.size,
    uncertainReasons,
    afterTodayCount: afterToday,
    options,
    suggestion,
    afterMidnightOptions: AFTER_MIDNIGHT_OPTIONS,
  };
}

module.exports = {
  AFTER_MIDNIGHT_OPTIONS,
  PAIR_TIME_TOLERANCE_S,
  addDays,
  resolvePairs,
  normalizeSelection,
  classify,
  filesForSelection,
  summarize,
};
