'use strict';

// services/qwenOrchestrator/repetitionDetector.js — Ask AutoIngest Stage 4,
// Section 21 (structural repetition backstop). Generalizes the C14
// repetition-containment lesson: detect PATHOLOGICAL output repetition
// structurally (a sentence/paragraph looping, a cyclic block, runaway
// near-identical content), never via a blacklist of known bad phrases,
// and never rejecting normal rhetorical repetition (a short word or
// phrase legitimately reused a few times in a longer answer).
//
// Pure functions, fully testable without a model -- every input here is
// a plain string.

// A sentence is "pathologically repeated" only when it recurs at least
// this many times AND is long enough that the recurrence is unlikely to
// be a legitimate short reused phrase ("Note that", "AutoIngest supports
// this" as a natural transition, etc.).
const MIN_REPEAT_COUNT = 3;
const MIN_REPEATED_SENTENCE_CHARS = 24;

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeSentence(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Finding 1: the same sentence (normalized) appears MIN_REPEAT_COUNT+
// times and is long enough to not be an incidental short transition.
function findRepeatedSentences(text) {
  const sentences = splitSentences(text);
  const counts = new Map();
  for (const s of sentences) {
    const norm = normalizeSentence(s);
    if (norm.length < MIN_REPEATED_SENTENCE_CHARS) continue;
    counts.set(norm, (counts.get(norm) || 0) + 1);
  }
  const offenders = [];
  for (const [norm, count] of counts) {
    if (count >= MIN_REPEAT_COUNT) offenders.push({ sentence: norm, count });
  }
  return offenders;
}

// Finding 2: a cyclic block -- a contiguous run of N sentences that
// repeats immediately after itself at least once (A B C A B C ...),
// structurally distinct from finding 1 (a single sentence looping) and
// from ordinary paragraph structure (which does not repeat blocks).
function findCyclicBlock(text, { minBlockLen = 2, maxBlockLen = 6 } = {}) {
  const sentences = splitSentences(text).map(normalizeSentence);
  if (sentences.length < minBlockLen * 2) return null;
  for (let blockLen = minBlockLen; blockLen <= maxBlockLen && blockLen * 2 <= sentences.length; blockLen++) {
    for (let start = 0; start + blockLen * 2 <= sentences.length; start++) {
      const a = sentences.slice(start, start + blockLen).join('|');
      const b = sentences.slice(start + blockLen, start + blockLen * 2).join('|');
      if (a === b && a.length >= MIN_REPEATED_SENTENCE_CHARS) {
        return { blockLen, startIndex: start, block: a };
      }
    }
  }
  return null;
}

// Finding 3: runaway near-identical content -- the same short n-gram
// (word sequence) appears far more often than plausible prose would
// produce, even without forming clean sentence boundaries (guards
// against a model emitting fragments without terminal punctuation).
const NGRAM_SIZE = 8;
const NGRAM_REPEAT_THRESHOLD = 5;
function findRunawayNgram(text) {
  const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < NGRAM_SIZE * NGRAM_REPEAT_THRESHOLD) return null;
  const counts = new Map();
  for (let i = 0; i + NGRAM_SIZE <= words.length; i++) {
    const gram = words.slice(i, i + NGRAM_SIZE).join(' ');
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  for (const [gram, count] of counts) {
    if (count >= NGRAM_REPEAT_THRESHOLD) return { ngram: gram, count };
  }
  return null;
}

// detectPathologicalRepetition(text) -> { pathological: boolean, findings: [...] }
// Never throws, never inspects meaning -- purely structural.
function detectPathologicalRepetition(text) {
  const findings = [];
  const repeatedSentences = findRepeatedSentences(text);
  if (repeatedSentences.length) findings.push({ type: 'repeated_sentence', detail: repeatedSentences });
  const cyclicBlock = findCyclicBlock(text);
  if (cyclicBlock) findings.push({ type: 'cyclic_block', detail: cyclicBlock });
  const runawayNgram = findRunawayNgram(text);
  if (runawayNgram) findings.push({ type: 'runaway_ngram', detail: runawayNgram });
  return { pathological: findings.length > 0, findings };
}

module.exports = { detectPathologicalRepetition, findRepeatedSentences, findCyclicBlock, findRunawayNgram };
