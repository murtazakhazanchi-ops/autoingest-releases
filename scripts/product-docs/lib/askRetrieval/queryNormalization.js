'use strict';
// Ask AutoIngest — deterministic retrieval foundation. Query normalization
// (Stage 1, Section 10).
//
// AUDIT FINDING: the existing production tokenizer, lib/textKeywords.js's
// keywordsFrom(), already performs the normalization this module needs to
// centralize -- case-folding (toLowerCase), whitespace/punctuation
// splitting (split on anything not [a-z0-9]), boilerplate-marker stripping
// (stripBoilerplate), a short deliberately-curated stopword list, and a
// bare-numeric-token filter. It is already the single source of truth for
// both featureIndex.js's and searchIndex.js's own tokenization (see that
// file's own header) -- reused here, not reimplemented, so retrieval's
// query-side tokenization and the corpus's own document-side tokenization
// can never silently drift apart into two different rules.
//
// What this module adds: a SINGLE, documented entry point
// (normalizeQuery()) that every retrieval channel (lexical, BM25) calls for
// query-side tokenization, so there is exactly one normalization decision
// point for retrieval, not one per channel that could each individually
// evolve.
//
// Known, disclosed limitations (not fixed here, per Section 10's own "do
// not turn normalization into semantic interpretation" instruction):
// - Unicode: keywordsFrom()'s split pattern (`[^a-z0-9]+`) treats any
//   non-ASCII letter as a separator, not as a normalizable character --
//   e.g. "café" tokenizes as "caf". AutoIngest's canonical documentation
//   corpus is English/ASCII throughout (verified: no accented-character
//   feature/workflow titles exist in the current Knowledge Base), so this
//   has not been observed to cause a real recall miss -- flagged as a
//   known boundary condition, not fixed speculatively for a case with no
//   corpus evidence.
// - Morphology: no stemming/lemmatization is performed (candidateRecall.js's
//   own light-stem helper, used by a DIFFERENT, C14-era recall channel not
//   part of this Stage 1 boundary, is not reused here -- kept out
//   deliberately, since Section 10 explicitly warns against "a giant
//   synonym system," and stemming decisions belong to a channel's own
//   scoring design, not to a shared normalization step every channel is
//   forced through identically).
// - Hyphenation: a hyphen is a separator like any other non-alphanumeric
//   character (e.g. "Photographer-Folder" tokenizes as "photographer"
//   "folder") -- deterministic and already the corpus's own convention
//   throughout (record titles are tokenized the identical way on the
//   document side), so query and document sides never disagree.

const { keywordsFrom } = require('../textKeywords');

// Normalizes a raw query string into its token list, using the SAME rule
// the corpus's own documents are tokenized with. Never throws on
// non-string input -- coerces defensively, since a retrieval boundary is a
// system edge (Stage 1, Section 4's own "candidate discovery, not
// intelligence" framing implies it must be robust to whatever a caller
// hands it, not just well-formed benchmark strings).
function normalizeQuery(rawQuery) {
  if (typeof rawQuery !== 'string') return [];
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];
  return keywordsFrom(trimmed);
}

module.exports = { normalizeQuery };
