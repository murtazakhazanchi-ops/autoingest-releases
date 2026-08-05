'use strict';

const { extractBulletList } = require('./markdown');
const { extractIds } = require('./ids');

const DATED_BULLET_RE = /^\*\*(\d{4}-\d{2}-\d{2}(?:\s*(?:through|→|-)\s*\d{4}-\d{2}-\d{2})?)\*\*\s*(?:—|-)\s*(.+)$/;

function classify(text) {
  const t = text.toLowerCase();
  if (/refactor|redesign|consolidat/.test(t)) return 'redesign';
  if (/crash|recover|durable|reliab|correctness/.test(t)) return 'reliability improvement';
  if (/performance|speed|memory|oom/.test(t)) return 'performance improvement';
  if (/ui|modal|layout|polish|spacing/.test(t)) return 'UI/UX revision';
  if (/bug|fix|silent|drop|failure/.test(t)) return 'major bug fix';
  if (/extract|separate|split into/.test(t)) return 'architectural extraction';
  if (/deprecat|supersede/.test(t)) return 'deprecation/supersession';
  if (/expand|add|new field/.test(t)) return 'feature expansion';
  return 'other dated milestone';
}

// Strictly extracts and reformats evidence already present in the feature's
// own canonical Evolution / Implementation Journal, Known Bugs, and Decisions
// sections — see docs/product/CLAUDE.md §11 (Historical Preservation) and
// §6 (Evidence Standards). No new facts, no invented dates.
function buildFeatureTimeline(featureId, feat, parsed) {
  const entries = [];

  const journalItems = extractBulletList(feat.evolutionJournal);
  for (const item of journalItems) {
    const m = DATED_BULLET_RE.exec(item);
    if (m) {
      entries.push({
        date: m[1],
        event_type: classify(m[2]),
        summary: m[2].trim(),
        evidence_source: `${feat.filePath} § Evolution / Implementation Journal`,
        related_ids: extractIds(item, 'bug').concat(extractIds(item, 'decision'), extractIds(item, 'feature')),
        commit_or_tag: null,
        confidence: 'verified',
      });
    } else {
      entries.push({
        date: null,
        event_type: 'evidence pending',
        summary: item.trim(),
        evidence_source: `${feat.filePath} § Evolution / Implementation Journal`,
        related_ids: [],
        commit_or_tag: null,
        confidence: 'undated',
      });
    }
  }

  const header = feat.header;
  if (header['First-known implementation'] && !/evidence pending/i.test(header['First-known implementation'])) {
    entries.push({
      date: header['First-known implementation'],
      event_type: 'initial implementation',
      summary: `First-known implementation of ${feat.name}`,
      evidence_source: `${feat.filePath} header table: First-known implementation`,
      related_ids: [],
      commit_or_tag: null,
      confidence: 'verified',
    });
  }
  if (header['Latest major update'] && !/evidence pending/i.test(header['Latest major update'])) {
    entries.push({
      date: header['Latest major update'],
      event_type: 'other dated milestone',
      summary: `Latest major update recorded for ${feat.name}`,
      evidence_source: `${feat.filePath} header table: Latest major update`,
      related_ids: [],
      commit_or_tag: null,
      confidence: 'verified',
    });
  }

  for (const bugId of extractIds(String(feat.lifecycle['Related bugs'] || ''), 'bug')) {
    const bug = parsed.bugs.get(bugId);
    if (!bug) continue;
    const fixed = bug.header['Fixed'];
    if (fixed && !/not yet fixed/i.test(fixed)) {
      entries.push({
        date: /\d{4}-\d{2}-\d{2}/.test(fixed) ? fixed : null,
        event_type: 'major bug fix',
        summary: `${bugId} — ${bug.name}`,
        evidence_source: `${bug.filePath} header table: Fixed`,
        related_ids: [bugId],
        commit_or_tag: null,
        confidence: /\d{4}-\d{2}-\d{2}/.test(fixed) ? 'verified' : 'undated',
      });
    }
  }

  for (const decId of extractIds(String(feat.lifecycle['Related decisions'] || ''), 'decision')) {
    const dec = parsed.decisions.get(decId);
    if (!dec) continue;
    const date = dec.header['Date'];
    entries.push({
      date: date && /\d{4}-\d{2}-\d{2}/.test(date) ? date : null,
      event_type: 'redesign',
      summary: `${decId} — ${dec.name}`,
      evidence_source: `${dec.filePath} header table: Date`,
      related_ids: [decId],
      commit_or_tag: null,
      confidence: date && /\d{4}-\d{2}-\d{2}/.test(date) ? 'verified' : 'undated',
    });
  }

  entries.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

  return {
    feature_id: featureId,
    name: feat.name,
    canonical_document: feat.filePath,
    entries,
    evidence_note: entries.length
      ? null
      : 'No verified chronology exists in the canonical feature file — see its own Evolution / Implementation Journal section for the authoritative record.',
  };
}

module.exports = { buildFeatureTimeline, classify };
