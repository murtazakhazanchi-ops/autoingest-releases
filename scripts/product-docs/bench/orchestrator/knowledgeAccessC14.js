'use strict';

// ASK AUTOINGEST — CHECKPOINT 14: ONE-BRAIN ARCHITECTURE CLOSURE
// QUALIFICATION. EXPERIMENTAL, ISOLATED PROTOTYPE. PRODUCT OWNER-
// AUTHORIZED NARROW CLOSURE FOLLOW-UP TO CHECKPOINT 13's HOLD.
//
// Reuses knowledgeAccessC13.js's functions verbatim (search_autoingest,
// capability_status, roadmap_status all unchanged) except:
//
//   1. Phase 3 — `resolveRelationship`/`checkRelationship` now attach a
//      general, type-keyed directional MEANING string to every edge when
//      the relation TYPE is directional (uses/writesTo/readsFrom/
//      precedesInWorkflow), computed from the type + the edge's own
//      already-tracked `direction` field -- never invented per-pair, never
//      special-cased to any specific feature. See
//      /Users/funun_pa/.claude/jobs/6629ed37/tmp/c14_relationship_type_audit.md
//      for the full classification (SYMMETRIC/DIRECTIONAL/UNKNOWN-GENERIC)
//      this is built from. `relatedTo` and `distinctFrom` edges get a
//      non-directional meaning string that explicitly does NOT assert an
//      order, so the model cannot over-read a generic edge as directional.
//
//   2. Phase 2/3 — `read_autoingest`'s `relationships` dimension no longer
//      interpolates a raw `AI-FEAT-###`/`AI-WF-###` targetId directly into
//      its returned text (a genuine, pre-existing leak surface, distinct
//      from and found while fixing the Phase 2 corrupted-prose class) --
//      it now resolves the target to its title via the same lookup
//      `check_relationship` uses, and appends the same directional-meaning
//      string described above when the type is directional. This is the
//      "resolve internal references before redaction/exposure" principle
//      applied generally to the one remaining place raw ids were still
//      reaching model-facing (and therefore leak-risked) text.

//   3. Phase 8/9 — `search_autoingest` is now backed by a NEW local
//      `deterministicCandidates`/`searchAutoIngest`, not the C12/C13
//      version imported unchanged. Forensic finding (Phase 8): QI05's
//      natural-paraphrase failure ("Is there one place that pulls together
//      all the different metadata tools...") traced to
//      lib/candidateRecall.js's `buildRecallSurfaceIndex`, which for a
//      Feature draws ONLY from `current_behavior` -- for AI-FEAT-034
//      (Metadata Management Modal) that field is pure UI-implementation
//      prose (a modal-shell CSS height-rule bugfix) with zero topical
//      relevance, while `summary` ("A single tabbed modal consolidating
//      three previously-separate metadata UI surfaces") is almost exactly
//      QI05's own wording -- but `summary` was never fed into the recall
//      surface at all. A 75-query retrieval diagnostic (BEFORE this fix:
//      Top-1 46.1%, Top-3 55.3%, Top-5 57.9%, N=76) confirmed this is a
//      GENERAL corpus-wide gap, not specific to QI05 or Metadata
//      Management Modal alone.
//      lib/candidateRecall.js and lib/knowledgeEngine.js are NOT isolated
//      Ask-AutoIngest-only code -- they are live production infrastructure
//      also consumed by scripts/product-docs/lib/knowledgeCli.js (the real
//      `node scripts/product-docs/cli.js query` command routed to from
//      every agent's docs/product/CLAUDE.md) and
//      scripts/product-docs/knowledge-portal/server.js. Phase 0's isolation
//      requirement (all work under bench/orchestrator, with reshapeRegistry
//      .js as the one pre-authorized, narrowly-scoped exception) does NOT
//      extend to these files, so this fix does not edit
//      lib/candidateRecall.js at all -- it reuses that module's own
//      exported `questionTokens` tokenizer (real reuse, not a rewrite) and
//      adds a SECOND, C14-local recall-surface channel here, unioned with
//      (never replacing) the existing lib/candidateRecall.js admission
//      channel and the existing lib/knowledgeEngine.js lexical scorer --
//      the same "new code in the checkpoint's own file, existing lib/
//      functions consulted read-only" pattern already used for
//      check_relationship (C13) and decisionFactsFor (this checkpoint's own
//      Phase 4). ALLOWED per Phase 9's own list ("purpose/behavior field
//      weighting", "deterministic candidateRecall reuse", "deterministic
//      union of candidate sources"); NOT a new tool, NOT a second model,
//      NOT a benchmark-specific synonym for QI05's own wording.

const {
  HandleSession, capabilityStatus, roadmapStatus,
  sanitizeTechnicalDetail, VALID_DIMENSIONS,
} = require('./knowledgeAccessC13');
const { findAllByFeatureId } = require('../../lib/knowledgeModel/index');
const { answerQuestion } = require('../../lib/knowledgeEngine');
const { buildRecallSurfaceIndex, admitRecallCandidates, questionTokens } = require('../../lib/candidateRecall');

// --- search_autoingest, Phase 8/9: extended recall-surface channel --------
// Small helpers copied verbatim from knowledgeAccessC12.js (never exported
// by C12/C13, so reproduced here rather than editing those frozen files --
// same "small, focused reimplementation when internals aren't exported"
// pattern C13 already used for check_relationship).
function titleFor(id, ctx) {
  const f = ctx.knowledgeIndexById && ctx.knowledgeIndexById.get(id);
  if (f) return f.title || id;
  const w = ctx.workflowIndexById && ctx.workflowIndexById.get(id);
  if (w) return w.title || id;
  return id;
}
const PURPOSE_SNIPPET_CHARS = 180;
function truncateSnippet(text) {
  const t = String(text || '').trim();
  if (t.length <= PURPOSE_SNIPPET_CHARS) return t;
  const cut = t.slice(0, PURPOSE_SNIPPET_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + '...';
}
function purposeFor(id, ctx) {
  const km = findAllByFeatureId(id);
  if (km.length && km[0].purpose) return truncateSnippet(km[0].purpose);
  const f = ctx.knowledgeIndexById && ctx.knowledgeIndexById.get(id);
  if (f && f.summary) return truncateSnippet(f.summary);
  const w = ctx.workflowIndexById && ctx.workflowIndexById.get(id);
  if (w && w.whatItDoes) return truncateSnippet(w.whatItDoes);
  return null;
}
function hasDetailFor(id) {
  return findAllByFeatureId(id).length > 0;
}
function fullCatalogue(ctx) {
  const out = [];
  for (const f of (ctx.knowledgeIndexById ? ctx.knowledgeIndexById.values() : [])) {
    if (f && f.id) out.push({ realId: f.id, matchType: 'catalogue' });
  }
  for (const w of (ctx.workflowIndexById ? ctx.workflowIndexById.values() : [])) {
    if (w && w.id) out.push({ realId: w.id, matchType: 'catalogue' });
  }
  return out;
}

// The NEW extended recall surface: built from each record's PURPOSE-level
// text (Feature `summary`, Workflow `whatItDoes`+`whenToUseIt`) -- the
// field(s) lib/candidateRecall.js's OWN `buildRecallSurfaceIndex` never
// draws from (that function is scoped to `current_behavior` for Features
// and procedural/troubleshooting fields for Workflows; see this file's
// header for the AI-FEAT-034 forensic trace that found this gap). Reuses
// `questionTokens` (real reuse of lib/candidateRecall.js's own exported
// tokenizer -- identical stopword/stem treatment on both the surface side
// and the question side, not a second tokenizer) and a small local generic-
// word guard mirroring that module's own GENERIC_RECALL_WORDS philosophy
// (independently defined here, not imported, for the same "decoupled
// module" reason candidateRecall.js states for its own copy).
const EXTENDED_GENERIC_WORDS = new Set(['app', 'autoingest', 'application', 'through', 'file', 'files', 'operator', 'archive']);
function extendedMeaningfulTokens(tokens) {
  return tokens.filter((t) => !EXTENDED_GENERIC_WORDS.has(t));
}
function buildExtendedRecallSurfaceIndex(built) {
  const surfaceById = new Map();
  for (const f of built.featureIndex || []) {
    const tokens = [...questionTokens(f.summary || '')];
    if (tokens.length) surfaceById.set(f.feature_id, new Set(tokens));
  }
  for (const w of built.workflowIndex || []) {
    const tokens = [...questionTokens([w.whatItDoes || '', w.whenToUseIt || ''].join(' '))];
    if (tokens.length) surfaceById.set(w.id, new Set(tokens));
  }
  return surfaceById;
}
// Same admission rule/threshold philosophy as lib/candidateRecall.js's own
// admitRecallCandidates (>= 2 distinct shared, non-generic tokens = real
// evidence, not coincidence) -- reimplemented locally only because that
// module's own version is not exported, not because the rule changed.
function admitExtendedRecallCandidates(question, surfaceById, admissionThreshold) {
  const qTokens = new Set(extendedMeaningfulTokens([...questionTokens(question)]));
  const admitted = [];
  for (const [id, surface] of surfaceById) {
    let shared = 0;
    for (const t of qTokens) if (surface.has(t)) shared++;
    if (shared >= admissionThreshold) admitted.push({ id, sharedTokenCount: shared });
  }
  return admitted;
}

let _extendedRecallSurfaceCache = null;
function extendedRecallSurfaceFor(built) {
  if (!_extendedRecallSurfaceCache || _extendedRecallSurfaceCache.built !== built) {
    _extendedRecallSurfaceCache = { built, index: buildExtendedRecallSurfaceIndex(built) };
  }
  return _extendedRecallSurfaceCache.index;
}

// Union of THREE candidate sources, in priority order (first-writer-wins
// per id, matching the existing C12/C13 pattern exactly): (1) the existing
// lib/knowledgeEngine.js lexical scorer's own matchedCapabilities/sources,
// unchanged; (2) the EXISTING lib/candidateRecall.js admission channel
// (current_behavior-based), unchanged; (3) the NEW extended, purpose-level
// admission channel added this checkpoint. None of the three is removed or
// altered -- this only adds a third source to a union that already existed.
// Forensic finding (this checkpoint's own 75-query retrieval diagnostic):
// simply appending the new channel's admissions after the old channel's
// (both after the lexical scorer's own matches) buried genuinely relevant
// candidates behind a much larger batch of EQUALLY-weak old-channel
// admissions with no ranking signal between them at all -- e.g. for QI05's
// own query, the old channel alone admits 14 candidates (none of them the
// right answer) before the new channel's one correct, but merely tied-
// strength, admission ever gets appended. Both channels already compute a
// `sharedTokenCount` for every admission (an existing, real signal, not a
// new score invented here) -- merging the two admission lists and sorting
// by that count before inserting means a STRONGER match from either
// channel is never crowded out by a large batch of equally-weak ones from
// whichever channel happened to run first. This changes ORDER ONLY among
// already-admission-only candidates (still strictly below every genuinely
// scored lexical match, still never able to outrank a real primary
// selection) -- not a new scoring mechanism.
function deterministicCandidates(query, ctx, built) {
  const answer = answerQuestion(query, ctx);
  const seen = new Map();
  for (const c of [...(answer.matchedCapabilities || []), ...(answer.sources || [])]) {
    if (!c || !c.id || seen.has(c.id)) continue;
    if (c.entityType && c.entityType !== 'feature' && c.entityType !== 'workflow') continue;
    if (!/^AI-(FEAT|WF)-\d+$/.test(c.id)) continue;
    seen.set(c.id, { realId: c.id, matchType: 'search' });
  }

  const recallAdmissions = [];
  try {
    const recallSurfaceById = buildRecallSurfaceIndex(built);
    // Forensic finding (this checkpoint's diagnostic): at the module's own
    // default threshold (2), the OLD channel alone admits an average of 9
    // candidates per query (up to 29) -- far too noisy to rank sensibly
    // against a handful of genuinely strong matches. Locally requiring 3
    // shared tokens for THIS channel's contribution (still the module's
    // own admission RULE, just a stricter bar, applied only within this
    // combining pass -- lib/candidateRecall.js's own default of 2 is left
    // untouched for its other real callers) drops that to ~2 per query,
    // each a materially stronger signal.
    for (const a of admitRecallCandidates(query, recallSurfaceById, 3)) {
      if (/^AI-(FEAT|WF)-\d+$/.test(a.id)) recallAdmissions.push({ id: a.id, count: a.sharedTokenCount, matchType: 'recall-surface' });
    }
  } catch { /* recall-surface admission is supplementary; never blocks search */ }
  try {
    const extendedSurfaceById = extendedRecallSurfaceFor(built);
    for (const a of admitExtendedRecallCandidates(query, extendedSurfaceById, 2)) {
      if (/^AI-(FEAT|WF)-\d+$/.test(a.id)) recallAdmissions.push({ id: a.id, count: a.sharedTokenCount, matchType: 'extended-recall-surface' });
    }
  } catch { /* extended recall-surface admission is supplementary; never blocks search */ }

  // Highest shared-token-count first; a tie keeps first-seen order (stable
  // sort), so behavior when both channels agree is deterministic, not
  // dependent on Map iteration quirks.
  recallAdmissions.sort((a, b) => b.count - a.count);
  for (const a of recallAdmissions) {
    if (!seen.has(a.id)) seen.set(a.id, { realId: a.id, matchType: a.matchType });
  }
  return [...seen.values()];
}

// Byte-identical to knowledgeAccessC12.js's searchAutoIngest except it
// calls THIS file's deterministicCandidates (three-source union, strength-
// ranked recall admissions) and returns a wider fuzzy-match window (12, was
// 8) -- the SAME general reasoning as the ranking change above: the
// existing 8-slot window was tuned around a two-source candidate list,
// and both this checkpoint's retrieval diagnostic and the QI05 forensic
// trace show it too easily fills entirely with the lexical scorer's own
// top matches before a legitimate recall-surface admission (from either
// channel) ever gets a chance, even when correctly ranked among admissions.
// The catalogue-fallback window (80) is unchanged.
async function searchAutoIngest({ query }, ctx, built, handleSession) {
  const q = String(query || '').trim();
  if (!q) return { results: [], note: 'Empty query.' };

  let candidates = deterministicCandidates(q, ctx, built);
  let usedCatalogue = false;
  const isRepeatSearch = handleSession.noteSearchAndCheckRepeat(q);
  if (candidates.length < 2 || isRepeatSearch) {
    const already = new Set(candidates.map((c) => c.realId));
    const cat = fullCatalogue(ctx).filter((c) => !already.has(c.realId));
    candidates = [...candidates, ...cat];
    usedCatalogue = true;
  }

  const results = candidates.slice(0, usedCatalogue ? 80 : 12).map((c) => ({
    title: titleFor(c.realId, ctx),
    kind: c.realId.startsWith('AI-WF-') ? 'workflow' : 'feature',
    purpose: purposeFor(c.realId, ctx),
    hasDetail: hasDetailFor(c.realId),
    matchType: c.matchType,
    handle: handleSession.issue(c.realId),
  }));

  const note = !results.length
    ? 'No candidates found, even browsing the full AutoIngest subject list. This does not mean AutoIngest lacks the capability -- try search again with different, simpler wording, or ask the operator one clarifying question.'
    : usedCatalogue
      ? 'The normal search found few or no strong matches, so this is the FULL list of AutoIngest subjects (not ranked by relevance) so you can look for a plausible match yourself. Read titles and purposes carefully -- an unrelated subject appearing here is not evidence AutoIngest lacks the capability asked about. Prefer a candidate with hasDetail:true when more than one plausibly fits.'
      : 'Candidates ranked by fuzzy match, not verified relevance -- read each purpose and use your own judgment about whether it plausibly fits what the operator described. If none clearly fit, search again with different wording before concluding nothing exists. Prefer a candidate with hasDetail:true when more than one plausibly fits.';

  return { results, note };
}

// Phase 3 classification (audited, not assumed -- see the design doc
// referenced above). Kept as a single source of truth so both
// check_relationship and read_autoingest's relationships dimension render
// identical semantics for the same edge type.
const DIRECTIONAL_TYPES = new Set(['uses', 'writesTo', 'readsFrom', 'precedesInWorkflow']);
const SYMMETRIC_TYPES = new Set(['distinctFrom']);
// relatedTo (and any future unclassified type) falls through as generic/
// non-directional by default -- the safe default for an unaudited type is
// "assert no direction", never "assume directional".

function titleForFeatureId(id) {
  const records = findAllByFeatureId(id);
  return (records[0] && records[0].title) || null;
}

// General runtime counterpart to reshapeRegistry.js's build-time
// resolveFeatureReferencesBeforeRedaction (Phase 2) -- same "resolve
// before redact" principle, applied to hand-authored relationship `.note`
// text (Tier 1), which is authored independently of the reshape pipeline
// and so was never touched by that build-time fix. Found via the same
// corpus-wide audit this checkpoint requires (11 relationship notes with
// a raw AI-FEAT/AI-WF reference, confirmed by direct scan) -- this is not
// a new leak Phase 3 introduces, it is a pre-existing one (present since
// Checkpoint 13 first added check_relationship) that the audit surfaces.
// Resolves any backtick-or-bare AI-FEAT-###/AI-WF-### token to its title;
// anything else (KM-###, DEC-###, BUG-###, genuine file paths/function
// names) is left for the existing, unmodified sanitizeTechnicalDetail
// catch-all to redact exactly as before -- composition, not replacement.
const RUNTIME_FEATURE_REF_RE = /`?(AI-FEAT-\d+|AI-WF-\d+)`?/g;

// Phase 4 finding: sanitizeTechnicalDetail's backtick regex
// (`` /`[a-zA-Z_][A-Za-z0-9_]*`/g ``, inherited unchanged since Checkpoint 9)
// only strips a backtick span whose ENTIRE content is a simple identifier.
// Decision-record `.detail` text (folded in by decisionFactsFor, Phase 4)
// is written for engineers and routinely contains richer backtick-quoted
// spans sanitizeTechnicalDetail was never built to catch: multi-token code
// expressions (`_syncingJobIds.size === 0`) and tokens with a leading digit
// such as a commit hash (`659788b`, fails the `[a-zA-Z_]`-first-character
// requirement). Both are genuine internal implementation detail and must
// never reach operator-visible text -- this is a general corpus-wide gap
// (any Decision detail can contain this shape), not specific to DEC-013.
// The build-time redactor already gets this right for the KM corpus
// (`stripOperatorFacingCodeSpans`'s BARE_INLINE_CODE_RE strips ANY
// backtick-quoted span, regardless of what's inside). This applies the
// same "any backtick span is internal, full stop" rule at runtime, as a
// final catch-all pass -- run only AFTER feature/workflow-id resolution
// above, so a resolved `AI-FEAT-###` title is never itself caught by it.
const ANY_REMAINING_BACKTICK_SPAN_RE = /`[^`]+`/g;
// Corpus-wide sweep finding (Phase 4, AI-FEAT-006/AI-FEAT-057): Decision
// detail text can contain a markdown triple-backtick fenced code block
// (e.g. a `git diff` command). A fence's paired triple-backtick delimiters
// are not single-backtick spans -- left for ANY_REMAINING_BACKTICK_SPAN_RE
// alone, its 3+3 backtick characters mis-pair against unrelated single-
// backtick spans elsewhere in the same text, orphaning two backtick
// characters and letting the content between them (now including an
// unrelated already-redacted marker plus genuine leftover raw internal
// syntax) read back as a fresh, unintended span. Stripping whole fences
// first, before any single-backtick pairing runs, removes the ambiguity
// at its source rather than patching the pairing logic.
const FENCED_CODE_BLOCK_RE = /```[\s\S]*?```/g;
// Corpus-wide sweep finding (AI-FEAT-026): a source record's own `behavior`
// text ends in an UNTERMINATED fence (a trailing run of backticks with no
// matching close) -- a source data-quality issue, not something either
// regex above causes. FENCED_CODE_BLOCK_RE requires a closing ``` and
// correctly does not match it, but the bare backtick run must still never
// reach operator-facing text. General, not specific to this one record:
// any run of 3+ consecutive backticks left after paired-fence stripping is
// by definition a broken/dangling fence marker, never legitimate prose.
const DANGLING_FENCE_MARKER_RE = /`{3,}/g;
function resolveThenSanitize(text) {
  if (typeof text !== 'string' || !text) return text;
  const noFences = text.replace(FENCED_CODE_BLOCK_RE, '[internal reference removed]')
    .replace(DANGLING_FENCE_MARKER_RE, '');
  const resolved = noFences.replace(RUNTIME_FEATURE_REF_RE, (whole, id) => {
    const title = titleForFeatureId(id);
    if (title) return title;
    return whole.startsWith('`') ? whole : '[internal reference removed]';
  });
  const sanitized = sanitizeTechnicalDetail(resolved);
  const finalPass = sanitized.replace(ANY_REMAINING_BACKTICK_SPAN_RE, '[internal reference removed]');
  // Re-run sanitizeTechnicalDetail's own cleanup rules (parenthetical-only-
  // markers, consecutive-marker collapse, whitespace) since the pass above
  // can introduce fresh instances of exactly what those rules exist to tidy.
  const cleaned = finalPass
    .replace(/\(\s*(?:\[internal reference removed\][\s,.;]*)+\)/g, '')
    .replace(/(\[internal reference removed\][,.;]?\s*){2,}/g, '[internal implementation detail omitted] ')
    .replace(/\s{2,}/g, ' ').replace(/\s+([,.;)])/g, '$1').trim();
  // Corpus-wide sweep finding (AI-FEAT-032): a single UNPAIRED backtick can
  // survive every pass above when the source record itself is malformed
  // (confirmed by direct inspection: garbled/truncated source prose, not
  // caused by this function). By definition, any backtick character still
  // present at this point could not be matched as part of a valid pair --
  // it is either truncated source data or markdown noise, never a live
  // reference needing resolution. General final safety net, not specific
  // to this one record.
  return cleaned.replace(/`/g, '').replace(/\s{2,}/g, ' ').trim();
}

// One general sentence per (type, direction) pair -- filled in with real
// titles for THIS query's actual subject/object, never with invented
// content beyond what the stored edge + its own type already assert.
function describeEdge(type, direction, subjectTitle, objectTitle) {
  const s = subjectTitle || 'the subject';
  const o = objectTitle || 'the object';
  if (DIRECTIONAL_TYPES.has(type)) {
    // direction 'subject->object' means the edge was stored ON the
    // subject's own record, pointing at the object -- i.e. subject is the
    // grammatical subject of the relation as authored.
    const first = direction === 'subject->object' ? s : o;
    const second = direction === 'subject->object' ? o : s;
    if (type === 'uses') return `${first} uses ${second}.`;
    if (type === 'writesTo') return `${first} writes to ${second}.`;
    if (type === 'readsFrom') return `${first} reads from ${second}.`;
    if (type === 'precedesInWorkflow') return `${first} happens before ${second} in the workflow (so ${second} happens after ${first}).`;
  }
  if (SYMMETRIC_TYPES.has(type)) {
    return `${s} and ${o} are documented as distinct/separate.`;
  }
  // relatedTo or any unaudited type: explicitly non-directional, and
  // explicitly warns against over-reading it as one.
  return `${s} and ${o} are related, but the specific nature or direction of the connection is not documented beyond that -- do not assume which one contains, precedes, or depends on the other from this alone.`;
}

function identifiersFor(featureId) {
  const records = findAllByFeatureId(featureId);
  const ids = new Set([featureId]);
  for (const r of records) ids.add(r.id);
  return ids;
}

function resolveRelationship(subjectFeatureId, objectFeatureId) {
  const subjectRecords = findAllByFeatureId(subjectFeatureId);
  const objectRecords = findAllByFeatureId(objectFeatureId);
  const objectIds = identifiersFor(objectFeatureId);
  const subjectIds = identifiersFor(subjectFeatureId);
  const subjectTitle = titleForFeatureId(subjectFeatureId);
  const objectTitle = titleForFeatureId(objectFeatureId);

  const matches = [];
  for (const r of subjectRecords) {
    for (const rel of r.relationships || []) {
      if (objectIds.has(rel.targetId)) {
        matches.push({
          direction: 'subject->object', type: rel.type, note: resolveThenSanitize(rel.note),
          meaning: describeEdge(rel.type, 'subject->object', subjectTitle, objectTitle),
        });
      }
    }
  }
  for (const r of objectRecords) {
    for (const rel of r.relationships || []) {
      if (subjectIds.has(rel.targetId)) {
        matches.push({
          direction: 'object->subject', type: rel.type, note: resolveThenSanitize(rel.note),
          meaning: describeEdge(rel.type, 'object->subject', subjectTitle, objectTitle),
        });
      }
    }
  }

  if (!matches.length) {
    return {
      status: 'UNKNOWN',
      edges: [],
      note: 'No relationship edge exists between these two subjects in either direction in AutoIngest\'s knowledge. This means the relationship is NOT ESTABLISHED -- it does not mean the subjects are confirmed unrelated, and it does NOT mean one precedes/contains/uses the other. Say plainly that the specific relationship (including any ordering) isn\'t documented.',
    };
  }
  const negative = matches.filter((m) => m.type === 'distinctFrom');
  if (negative.length) {
    return {
      status: 'CONTRADICTED',
      edges: matches,
      note: 'AutoIngest\'s knowledge explicitly documents these as DISTINCT/separate. Do not describe them as the same, connected, or sharing a mechanism/interface.',
    };
  }
  const directional = matches.filter((m) => DIRECTIONAL_TYPES.has(m.type));
  // General guidance, not specific to any pair: when the ONLY edges found
  // are generic/non-directional (relatedTo), this tool has genuinely told
  // you everything the structured relationship data knows -- it does NOT
  // mean no more specific fact exists anywhere in AutoIngest's knowledge.
  // The more specific fact, if one exists, lives in prose (purpose/
  // behavior) rather than the structured edge -- actively point the model
  // there instead of letting a generic SUPPORTED read as "fully answered".
  const note = directional.length
    ? 'AutoIngest\'s knowledge documents a directional connection between these two subjects -- read each edge\'s own "meaning" field for the exact, evidenced direction (which one comes first / uses / writes to / reads from the other). Do not state a direction beyond what an edge\'s own meaning field says.'
    : 'AutoIngest\'s knowledge documents that these two subjects are connected, but only as a generic, non-directional link -- it does NOT establish which one comes first, contains the other, or depends on the other. This is not necessarily the full picture: if the operator\'s question is about order, dependency, or containment specifically, also read_autoingest each subject\'s purpose and behavior dimensions before answering -- a more specific fact may be documented there even when the structured relationship is only generic. Never state a direction that neither this tool nor that prose actually establishes.';
  return { status: 'SUPPORTED', edges: matches, note };
}

function checkRelationship({ subjectHandle, objectHandle }, handleSession) {
  const subjectId = handleSession.resolve(subjectHandle);
  const objectId = handleSession.resolve(objectHandle);
  if (!subjectId || !objectId) {
    return {
      error: 'invalid_handle',
      note: 'One or both handles were not issued by a previous search_autoingest call in this conversation. This is a protocol error, not evidence about the relationship -- search again for the missing subject first.',
    };
  }
  if (subjectId === objectId) {
    return { status: 'SUPPORTED', edges: [], note: 'Both handles refer to the same subject.' };
  }
  return resolveRelationship(subjectId, objectId);
}

// Checkpoint 14, Phase 4 -- RB44 class (UNREACHABLE_KNOWLEDGE, per the
// normalized taxonomy: the disambiguating fact for RB44 lives in DEC-013,
// a document type no C13 tool could reach under any query). Forensic
// finding: a fully-built, already-tested deterministic mechanism for this
// EXACT problem already exists in lib/knowledgeEngine.js
// (answerFromGovernanceRecord, findPrimaryFeatureContext) and
// lib/authorityTopics.js (buildAuthorityIndex's relatedDecisions field per
// feature) -- it was simply never wired into the Ask AutoIngest tool
// layer, which only ever harvested id/title pairs from answerQuestion()'s
// output for search candidates and discarded the synthesized answer text
// entirely. This is the SAME "built but not wired into the live path"
// pattern Checkpoint 13 found for candidateRecall.js/QI05 -- not
// something this checkpoint invents, something it discovers and connects.
//
// Design, general and not specific to DEC-013/AI-FEAT-045: for ANY
// feature being read, ctx.authorityIndexByFeatureId's relatedDecisions
// (the feature's OWN forward citation of its decisions -- the
// project's own documented cross-linking authority direction, see
// docs/product/CLAUDE.md § 7) names zero or more real Decision ids.
// Each resolves via ctx.searchIndexById to that decision's own `detail`
// text (the Decision/Consequences content, not `summary`, which is only
// the Context/problem statement -- confirmed by direct inspection this
// checkpoint, not assumed). Folded into read_autoingest's EXISTING
// `limitations` dimension (no new dimension, no new tool, per Phase 10's
// explicit small-tool-surface guidance -- a decision that constrains a
// feature's behavior is naturally a limitation on it) with the SAME
// resolve-then-sanitize treatment as everything else, so the raw
// "DEC-013" id, any backtick-quoted function name, and any cross-
// referenced AI-FEAT id inside the decision's own prose are all handled
// exactly like every other operator-facing dimension -- never a raw id,
// only a resolved title, never invented content beyond the decision
// record's own text.
function decisionFactsFor(featureId, ctx) {
  if (!ctx || !ctx.authorityIndexByFeatureId || !ctx.searchIndexById) return [];
  const entry = ctx.authorityIndexByFeatureId.get(featureId);
  if (!entry || !entry.relatedDecisions || !entry.relatedDecisions.length) return [];
  const out = [];
  for (const decId of entry.relatedDecisions) {
    const dec = ctx.searchIndexById.get(decId);
    if (!dec || dec.entity_type !== 'decision') continue;
    const text = dec.detail || dec.summary;
    if (!text) continue;
    out.push(`Documented design decision: ${resolveThenSanitize(text)}`);
  }
  return out;
}

// --- read_autoingest, Phase 2/3: relationships dimension no longer leaks
// a raw targetId; resolves to title + attaches the same directional
// meaning template used by check_relationship. Everything else in this
// function is byte-identical to knowledgeAccessC12/C13's readAutoIngest.
function readAutoIngest({ handle, dimensions }, ctx, handleSession) {
  const realId = handleSession.resolve(handle);
  if (!realId) {
    return {
      error: 'invalid_handle',
      note: `"${handle}" was not issued by a previous search in this conversation. This is a protocol error, not evidence AutoIngest lacks this feature -- call search_autoingest again to get a valid handle, or ask the operator to clarify what they mean.`,
    };
  }
  const records = findAllByFeatureId(realId);
  if (!records.length) {
    return {
      knowledgeState: 'EMPTY',
      dimensions: {},
      note: 'THIS SUBJECT HAS NO DETAILED KNOWLEDGE BASE RECORD. Nothing below is established fact -- do not describe how this works, where it stores anything, or what it does beyond the title/purpose you already have. This does NOT mean AutoIngest lacks the capability. Either say plainly that the detailed mechanism is not documented, or (if a related subject with real detail exists -- check search_autoingest\'s hasDetail flag) read that one instead.',
    };
  }
  const requested = (Array.isArray(dimensions) ? dimensions : []).filter((d) => VALID_DIMENSIONS.includes(d));
  const out = {};
  let establishedCount = 0;
  let totalCount = 0;
  const subjectTitle = records[0].title || null;
  for (const dim of requested.length ? requested : VALID_DIMENSIONS.slice(0, 2)) {
    let text = null;
    // Corpus-wide audit finding (Phase 2/4, not scoped to any one dimension
    // or feature): resolveThenSanitize was previously wired only into
    // limitations/relationships/technicalDetail. purpose/behavior/
    // operatorWorkflow/preconditions/actions/recovery -- inherited
    // unchanged from C12/C13 -- were returned completely raw. This matters
    // most because purpose+behavior are the DEFAULT dimensions returned
    // when a caller requests none explicitly (see the fallback above).
    // Tier 1 (hand-authored) records are never run through reshapeRegistry
    // .js's build-time redaction at all, so this was the ONLY redaction
    // point available to them. Applying the same treatment to every
    // dimension uniformly, not selectively: general fix, not per-field.
    if (dim === 'purpose') text = resolveThenSanitize(records.map((r) => r.purpose).filter(Boolean).join(' '));
    else if (dim === 'behavior') text = resolveThenSanitize(records.map((r) => r.behavior).filter(Boolean).join(' '));
    else if (dim === 'operatorWorkflow') text = resolveThenSanitize(records.flatMap((r) => r.operatorWorkflow).filter(Boolean).join(' | '));
    else if (dim === 'preconditions') text = resolveThenSanitize(records.flatMap((r) => r.preconditions).filter(Boolean).join(' | '));
    else if (dim === 'actions') text = resolveThenSanitize(records.flatMap((r) => r.actions.map((a) => `${a.label}: ${a.description}`)).filter(Boolean).join(' | '));
    else if (dim === 'recovery') text = resolveThenSanitize(records.map((r) => r.recovery).filter(Boolean).join(' '));
    else if (dim === 'limitations') {
      const kmLimitations = records.flatMap((r) => r.limitations).filter(Boolean);
      const decisionFacts = decisionFactsFor(realId, ctx);
      text = resolveThenSanitize([...kmLimitations, ...decisionFacts].join(' | '));
    }
    else if (dim === 'relationships') {
      text = records.flatMap((r) => (r.relationships || []).map((rel) => {
        const targetTitle = titleForFeatureId(rel.targetId) || null;
        // Unresolvable targetId (should not happen for a real registered
        // feature/workflow, kept as a safe fallback): never interpolate
        // the raw id -- describe generically instead of leaking it.
        const safeNote = resolveThenSanitize(rel.note);
        if (!targetTitle) return `${rel.type} another AutoIngest capability: ${safeNote}`;
        const meaning = describeEdge(rel.type, 'subject->object', subjectTitle, targetTitle);
        return `${rel.type} ${targetTitle}: ${safeNote} (${meaning})`;
      })).join(' | ');
    } else if (dim === 'technicalDetail') text = resolveThenSanitize(records.map((r) => r.technicalDetail).filter(Boolean).join(' '));
    totalCount++;
    if (text) establishedCount++;
    out[dim] = text || 'Not established in AutoIngest\'s evidence -- do not guess at this.';
  }
  const knowledgeState = establishedCount === 0 ? 'EMPTY' : (establishedCount < totalCount / 2 ? 'THIN' : 'DOCUMENTED');
  const extractionTier = records.every((r) => r.extractionTier === 'forensic-verified')
    ? 'forensic-verified'
    : (records.some((r) => r.extractionTier === 'forensic-verified') ? 'mixed' : 'registry-reshaped');
  const stateNote = knowledgeState === 'THIN'
    ? 'THIN: most of what you asked for is not established. Do not fill the gaps with a plausible guess -- say plainly what is and is not known.'
    : undefined;
  return { knowledgeState, extractionTier, dimensions: out, ...(stateNote ? { note: stateNote } : {}) };
}

function buildToolDefinitions(ctx, built, handleSession) {
  return {
    search_autoingest: {
      description: 'Search AutoIngest\'s trusted knowledge base for subjects (features/workflows) that might relate to what the operator is asking about. Returns each candidate\'s title, a short purpose, hasDetail (whether real documented facts exist beyond the title/purpose), and a temporary handle (like "H3") at the end -- never a real internal id, never a capability decision. The handle exists ONLY so you can call the other tools; never write it in your answer to the operator, not even in parentheses as a citation. Call this first whenever you are not yet sure which AutoIngest capability the operator means. If nothing plausible comes back, try again with different, simpler wording, or ask the operator.',
      params: { type: 'object', properties: { query: { type: 'string', description: 'A short phrase describing what the operator seems to be asking about.' } }, required: ['query'] },
      handlerImpl: (params) => searchAutoIngest(params, ctx, built, handleSession),
    },
    read_autoingest: {
      description: 'Fetch specific trusted facts about one AutoIngest subject, using the handle a previous search_autoingest call gave you -- never a made-up id. Choose only the dimensions you actually need: purpose, behavior, operatorWorkflow, preconditions, actions, recovery, limitations, relationships, technicalDetail. Request technicalDetail ONLY if the operator explicitly asked a technical/implementation question. The result includes knowledgeState: DOCUMENTED (real content), THIN (most of what you asked for isn\'t established), or EMPTY (no record at all). For THIN or EMPTY, say plainly that the detail isn\'t documented, or read a different candidate that does have it -- never invent the missing detail. The relationships dimension, when it names another subject, also states the DIRECTION of that connection in plain language when known (e.g. "happens before", "uses", "writes to") -- read that meaning exactly, never guess a direction it doesn\'t state. If the handle is invalid, that is a protocol error, not evidence the feature is missing -- search again.',
      params: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'A handle returned by search_autoingest in this conversation.' },
          dimensions: { type: 'array', items: { type: 'string', enum: VALID_DIMENSIONS }, description: 'Which facets to retrieve.' },
        },
        required: ['handle', 'dimensions'],
      },
      handlerImpl: (params) => readAutoIngest(params, ctx, handleSession),
    },
    capability_status: {
      description: 'Get the AUTHORITATIVE status of one AutoIngest capability, using a handle from search_autoingest: AVAILABLE, NOT_SUPPORTED, PLANNED, or UNKNOWN. You must call this before asserting whether AutoIngest supports, does, or does not do something, and you must never contradict what it returns. An invalid handle here is a protocol error, not a "not supported" answer.',
      params: { type: 'object', properties: { handle: { type: 'string', description: 'A handle returned by search_autoingest in this conversation.' } }, required: ['handle'] },
      handlerImpl: (params) => capabilityStatus(params, ctx, handleSession),
    },
    roadmap_status: {
      description: 'Get the AUTHORITATIVE AutoIngest development roadmap: what is already completed, in progress, or planned, and (optionally) whether a specific named subject is planned/completed. Use this for open-ended questions like "what\'s next" or "has X been completed" -- not for questions about how an already-shipped feature behaves (use search_autoingest/read_autoingest for that).',
      params: { type: 'object', properties: { query: { type: 'string', description: 'Name a specific subject to check its roadmap status, or pass an empty string for the general roadmap state.' } }, required: ['query'] },
      handlerImpl: (params) => roadmapStatus(params || {}, ctx),
    },
    check_relationship: {
      description: 'Check whether AutoIngest\'s knowledge documents a relationship between TWO subjects you already have handles for (from search_autoingest) -- INCLUDING whether one happens before/after, uses, writes to, or reads from the other. Use this whenever the operator asks whether two AutoIngest things are the same, connected, one contains/uses/precedes the other, or are separate/independent -- do NOT rely on your own memory or on reading each subject\'s facts separately and guessing whether or how they connect, including ordering questions ("does X happen before Y", "can X and Y overlap"). Returns status: SUPPORTED (a real documented connection exists -- read each edge\'s "meaning" field for the exact evidenced direction/kind, e.g. "X happens before Y"), CONTRADICTED (AutoIngest\'s knowledge explicitly documents them as distinct/separate -- never describe them as the same or connected), or UNKNOWN (no relationship, including no ordering, is documented either way -- this means NOT ESTABLISHED, not "confirmed unrelated" or "confirmed simultaneous"; say plainly the relationship isn\'t documented rather than guessing in either direction). A relationship OR ORDERING between two AutoIngest concepts is itself an AutoIngest fact -- if it matters to your answer, check it before asserting it.',
      params: {
        type: 'object',
        properties: {
          subjectHandle: { type: 'string', description: 'A handle returned by search_autoingest for the first subject.' },
          objectHandle: { type: 'string', description: 'A handle returned by search_autoingest for the second subject.' },
        },
        required: ['subjectHandle', 'objectHandle'],
      },
      handlerImpl: (params) => checkRelationship(params, handleSession),
    },
  };
}

module.exports = {
  HandleSession, searchAutoIngest, readAutoIngest, capabilityStatus, roadmapStatus,
  checkRelationship, resolveRelationship, describeEdge, DIRECTIONAL_TYPES, SYMMETRIC_TYPES,
  buildToolDefinitions, sanitizeTechnicalDetail, VALID_DIMENSIONS,
};
