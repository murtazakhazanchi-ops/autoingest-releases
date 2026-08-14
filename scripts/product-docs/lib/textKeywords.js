'use strict';

// Shared tokenizer, used by both featureIndex.js and searchIndex.js so a
// feature's own search_keywords and every other entity type's keywords are
// derived by the exact same rule — single source of truth, per the Part 2
// Remediation Design Report's "no second manually curated tokenization"
// principle. Extracted from searchIndex.js during Part 2 Decision 2's
// implementation (Summary text needed the same stopword-aware tokenizer
// featureIndex.js didn't previously have access to).
//
// Stage 2 finding (preserved from the original searchIndex.js comment):
// workflow records (much richer prose than a feature's name/category)
// exposed a real defect — a 3-word stopword collision ("how", "between",
// "and") let AI-WF-006 (Online Registry) confidently win "How do I switch
// between Stable and Preview versions?", a question about update channels
// with zero real topical relevance. keywordsFrom() previously only filtered
// by length (>2 chars), which passes almost every common English connector
// word. This list is deliberately short — generic, high-frequency words
// only, never a domain term — filtering more aggressively risks removing
// real signal for a problem this list already solves.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'have', 'had',
  'was', 'were', 'been', 'this', 'that', 'these', 'those', 'from', 'into', 'onto',
  'with', 'without', 'how', 'what', 'when', 'where', 'which', 'who', 'whom', 'why',
  'does', 'did', 'doing', 'done', 'own', 'now', 'only', 'than', 'then', 'them', 'they',
  'their', 'there', 'here', 'its', 'his', 'her', 'she', 'him', 'out', 'off', 'over',
  'under', 'again', 'further', 'once', 'about', 'above', 'below', 'between', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'nor', 'too', 'very', 'just',
  'per', 'via', 'see', 'set', 'get', 'yet', 'any', 'also', 'may', 'must', 'shall',
  'should', 'would', 'could', 'will', 'never', 'always', 'while', 'because', 'before',
  'after', 'during', 'same', 'still', 'even', 'one', 'two', 'first', 'second', 'new',
  // Part 2 remediation (Decision 2 implementation) — added empirically, via a
  // document-frequency scan of the real search index after Summary/Symptom/
  // Context text was first included, following the exact same discipline
  // already used for the original list above (widen deliberately, measure,
  // fix the specific offender) rather than guessing which words might
  // collide. 'autoingest' is the product's own name — the same class of
  // problem AI-FEAT-058's Stage 1 evolution journal already records fixing
  // once for a record TITLE; here it recurs at the corpus-wide level because
  // nearly every Summary sentence describes what "AutoIngest" does. 'docs'
  // and 'product' are citation-path fragments (from "docs/product/..."
  // references inlined in Part 1's evidence citations), not topical content.
  // 'feat' is a tokenization artifact of "AI-FEAT-###" cross-references
  // splitting on the hyphen (the "AI"/digits fragments are already dropped
  // by the length>2 filter; "feat" alone survives and is never a real
  // standalone English/domain word).
  'autoingest', 'docs', 'product', 'feat',
  // 'using' — generic connector word, same class as the already-stopworded
  // 'via'/'with'; found via a specific false-positive collision ("Can
  // AutoIngest auto-generate photo captions using AI?" wrongly, confidently
  // matching AI-FEAT-006 Auto-Update via "auto"+"using" — "auto" is a
  // legitimate, low-frequency keyword fragment of that feature's own name,
  // left as-is; "using" is the generic half of the coincidence and is safe
  // to remove without losing real signal anywhere).
  'using',
  // Found via test/knowledge.test.js's mandatory hallucination-guard suite
  // (not the tolerant V2 corpus) after the 'using' fix: two more real
  // grounding failures. (1) A pure-gibberish query ("xyzzy plugh unrelated
  // made up capability qqqqq") confidently resolved to PLANNED via a
  // 3-word tie on 'capability'+'made'+'unrelated' against AI-FEAT-049/050 —
  // none of those three words describe archive/event maintenance; they are
  // generic connective vocabulary this corpus's own narrative prose happens
  // to use often (grep confirms: "this capability", "no evidence this is
  // related/unrelated", "a change was made"), not domain signal. (2) "Can I
  // schedule AutoIngest to run automatic nightly backups at a set time?"
  // confidently affirmed AI-FEAT-025 (Checksum-Based File Verification) —
  // a feature with zero real relationship to scheduling or backups — via
  // 'automatic'+'run'+'time', the same class of generic filler. All five
  // are low document-frequency (1.6%-4.6%) but, unlike 'auto' (kept above),
  // none is a fragment of any real feature's own name or a domain term —
  // they are ordinary English connector/filler words, the same class as the
  // already-stopworded 'get'/'set'/'via'/'with'/'using'. Re-verified against
  // the full V2 corpus and the full test suite after adding these, per
  // established project discipline (widen deliberately, then measure the
  // whole corpus, not just the target case).
  'capability', 'made', 'unrelated', 'automatic', 'run', 'time',
]);

// Part 2 remediation — Decision 2 already explicitly approved excluding
// "Evidence pending... boilerplate" from the searchable surface. These exact
// phrases are the project's own canonical definition of that boilerplate
// (see featureIndex.js's EVIDENCE_MARKERS, originally used only for counting
// documentation gaps) — reused here, not redefined, so the two concepts
// ("what counts as an evidence-provenance marker") can never drift apart.
// Stripped before tokenizing because the marker's OWN vocabulary ("known",
// "project", "history", "evidence", "pending", "repository", "captured")
// is meta-commentary about where a claim came from, not the claim's topic —
// found via the same document-frequency scan: several of these words each
// appeared in 30+ records (8-11% of the whole corpus) purely because the
// approved evidence-tagging convention repeats the same sentence structure
// across every Part 1-touched record.
const EVIDENCE_MARKERS = [
  'Evidence pending',
  'Not yet documented as fact',
  'Known from project history; repository evidence pending',
];

function stripBoilerplate(text) {
  let out = String(text);
  for (const marker of EVIDENCE_MARKERS) {
    const re = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, ' ');
  }
  return out;
}

function keywordsFrom(...texts) {
  const words = new Set();
  for (const t of texts) {
    if (!t) continue;
    const cleaned = stripBoilerplate(t);
    for (const w of cleaned.toLowerCase().split(/[^a-z0-9]+/)) {
      // Part 2 remediation — a purely-numeric token (a bare year like
      // "2026" from a citation date, a version fragment, etc.) is never
      // meaningful search signal on its own; excluding by shape rather than
      // adding each new year to STOPWORDS by hand avoids the same drift
      // this whole decision is trying to eliminate elsewhere.
      if (/^\d+$/.test(w)) continue;
      if (w.length > 2 && !STOPWORDS.has(w)) words.add(w);
    }
  }
  return Array.from(words).sort();
}

module.exports = { STOPWORDS, EVIDENCE_MARKERS, stripBoilerplate, keywordsFrom };
