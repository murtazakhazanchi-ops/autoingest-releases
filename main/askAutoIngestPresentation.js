'use strict';

// main/askAutoIngestPresentation.js — Phase C4. Pure, Electron-independent
// presentation-shaping logic for the Ask AutoIngest product surface,
// deliberately split out of main/askAutoIngest.js (which requires
// 'electron' at module load time, like every other main/*.js file, and so
// cannot be required under plain `node`). This file requires nothing but
// the already-existing, unmodified product-docs sanitization utilities --
// it can be unit-tested with zero Electron and zero model, which is how
// test/askAutoIngestPresentation.test.js proves Part G's requirement
// ("Add explicit tests for this") that raw internal IDs never reach the
// primary answer.

const path = require('path');
const PRODUCT_DOCS = path.join(__dirname, '..', 'scripts', 'product-docs');
const { sanitizeIdsInProse, displayNameFor, splitCapabilityFromProvenance } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'evidencePackage.js'));
const { describeAuthorityOutcome } = require(path.join(PRODUCT_DOCS, 'lib', 'answerWithAuthority.js'));

const QUERY_STATUS_LABELS = {
  AVAILABLE: 'Available',
  PARTIALLY_AVAILABLE: 'Partially available',
  PLANNED: 'Planned',
  NOT_SUPPORTED: 'Not supported',
  UNKNOWN: 'Uncertain',
};

// Part H generic wording -- used only when the reason for uncertainty is a
// genuine semantic non-confirmation (judge ran on a READY model and
// returned INSUFFICIENT_EVIDENCE/CONTRADICTS/LOW-confidence, etc.). The
// model-unavailable-specific wording comes from answerWithAuthority.js's
// own describeAuthorityOutcome() -- not duplicated as a second literal
// here, so the two can never drift out of sync.
const GENERIC_UNCERTAIN_MESSAGE = 'AutoIngest found related documentation, but it does not establish this capability clearly enough to confirm it.';

const MODEL_STATE_LABELS = {
  NOT_DOWNLOADED: 'Local capability verification model is not installed.',
  DOWNLOADING: 'Downloading local AI model…',
  VERIFYING: 'Verifying local AI model…',
  READY: 'Local AI model is ready.',
  LOADING: 'Loading local AI model…',
  LOADED: 'Local AI model is active.',
  ERROR: 'The local AI model could not be verified.',
};

// Markdown-link flattening -- a UI-only concern, not shared with
// sanitizeIdsInProse() (which exists to keep raw IDs out of the LLM's own
// input, not to flatten markdown). The Ask AutoIngest surface renders
// every prose field via plain `textContent` (Part D: "one question -> one
// answer", no markdown renderer), so a canonical-doc citation shaped like
// "[DEC-011](../decisions/DEC-011_QMZ_...md)" -- real source prose,
// verified against docs/product/decisions/README.md -- would otherwise
// show the operator raw markdown syntax AND leak "DEC-011" a second time
// from inside the URL path itself, past sanitizeIdsInProse()'s own
// PROSE_ID_RE, since that regex's trailing \b does not match before the
// "_" in "DEC-011_QMZ...md" (an underscore is a word character). Applied
// BEFORE sanitizeIdsInProse() so the surviving link-text token (itself
// often a bare ID, e.g. "DEC-011") still gets converted to its real
// display name by the existing utility, unmodified, immediately after.
function flattenMarkdownLinks(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

// Sanitizes every user-facing prose field of an answerQuestionWithAuthority()
// result for the Ask AutoIngest UI (Part F/G) -- reuses the EXISTING
// sanitizeIdsInProse()/displayNameFor() utilities from
// lib/askSynthesis/evidencePackage.js verbatim (already proven, already
// tested, already used to keep raw IDs out of the LLM's own input) rather
// than reimplementing ID stripping a second time, plus this file's own
// flattenMarkdownLinks() (above) for the UI-specific plain-text concern.
// Never mutates the input answer object -- returns an entirely new
// envelope. Raw IDs are deliberately PRESERVED (not stripped) inside
// `technicalDetails`, per Part F item 7.
function sanitizeForUI(text, ctx) {
  return sanitizeIdsInProse(flattenMarkdownLinks(text), ctx);
}

function shapeAnswerForUI(answer, ctx) {
  const statusCode = answer.capabilityStatus;
  const authority = answer.authority || null;
  const isAuthorityDowngrade = !!(authority && authority.required && authority.finalCapabilityStatus === 'UNKNOWN');

  // C8 corrective checkpoint (2026-08-24), Defect 2 forensic finding: this
  // function is the ONLY place raw answer.directAnswer becomes operator-
  // visible text, on EVERY path -- synthesized, deterministic-only
  // (offline/no model), and post-refusal/failed-validation fallback alike
  // (trySynthesize()'s catch-all returns the untouched `answer` object,
  // which flows here unchanged). evidencePackage.js's own capability/
  // provenance split (splitCapabilityFromProvenance(), used to build what
  // reaches Phi) was NEVER applied here -- so a record whose canonical
  // "## Summary" carries a "**Why this exists** (repository evidence
  // pending, captured during the Product-Owner Purpose Capture
  // interview...)" narrative reached the operator's screen verbatim
  // (IDs stripped, but the provenance/citation commentary intact)
  // whenever synthesis was unavailable, refused, or failed validation --
  // independent of and unfixed by any prompt/guard work done at the
  // synthesis layer, since that layer is never reached on this path. Split
  // applied here, universally, keeps this operator-safe on every path: a
  // synthesized answer (Phi's own natural-language prose) never contains
  // the literal "**Why this exists**" marker, so the split is a safe no-op
  // for that case (capability = the whole text, provenance = null).
  const { capability: directAnswerCapability } = splitCapabilityFromProvenance(answer.directAnswer);
  let directAnswer = sanitizeForUI(directAnswerCapability, ctx);
  let uncertaintyMessage = null;
  if (isAuthorityDowngrade) {
    // Part H: the operator-facing text for an authority DOWNGRADE is the
    // Product-Owner-specified copy, not C1's own internal UNVERIFIED_HEDGE
    // sentence (written for a decorator-level fallback, not this specific
    // UI). C1's own `answer.directAnswer` field is read here only to
    // decide the branch; it is never displayed verbatim in this case, and
    // lib/capabilityAuthority.js itself is untouched.
    uncertaintyMessage = describeAuthorityOutcome(authority) || GENERIC_UNCERTAIN_MESSAGE;
    directAnswer = uncertaintyMessage;
  }

  const guidanceParts = [answer.guidance, answer.expectedResult, answer.whereToGo]
    .filter((t) => typeof t === 'string' && t.trim())
    .map((t) => sanitizeForUI(t, ctx));

  const steps = Array.isArray(answer.steps) ? answer.steps.map((s) => sanitizeForUI(s, ctx)) : [];
  const limitations = Array.isArray(answer.limitations) ? answer.limitations.map((l) => sanitizeForUI(l, ctx)) : [];
  const relatedCapabilities = Array.isArray(answer.relatedCapabilities)
    ? answer.relatedCapabilities.map((id) => ({ id, title: displayNameFor(id, ctx) || id }))
    : [];
  const sources = Array.isArray(answer.sources)
    ? answer.sources.map((s) => ({ id: s.id, title: s.title || displayNameFor(s.id, ctx) || s.id, path: s.path || null, role: s.role || null, evidenceQualification: s.evidenceQualification || null }))
    : [];

  return {
    query: answer.query,
    classification: answer.classification,
    // knowledgeEngine.js's ROADMAP branch is the one place in the whole
    // deterministic engine that sets capabilityStatus to a non-QUERY_STATUS
    // value (QUESTION_TYPES.ROADMAP, a classification name, not a real
    // capability status -- "what's coming next" has no
    // available/partially-available/planned/not-supported/uncertain
    // concept). Fixed HERE, in presentation only -- knowledgeEngine.js
    // itself is untouched, per this checkpoint's explicit boundary. A
    // status this layer doesn't recognize is never shown as a raw enum
    // (Part F); the badge is simply omitted (code/label null) rather than
    // inventing a 6th fabricated label.
    status: QUERY_STATUS_LABELS[statusCode] ? { code: statusCode, label: QUERY_STATUS_LABELS[statusCode] } : { code: null, label: null },
    directAnswer,
    uncertaintyMessage,
    guidance: guidanceParts.length ? guidanceParts.join(' ') : null,
    steps,
    limitations,
    relatedCapabilities,
    technicalDetails: {
      sources,
      // Phase C5 — diagnostic-only (Section Q: "do not clutter the main
      // answer with AI diagnostics"). Never affects directAnswer/steps/
      // limitations above, which are already the final text (synthesized
      // or deterministic) by the time this function runs.
      synthesis: answer.synthesis ? { applied: answer.synthesis.applied, reason: answer.synthesis.reason } : { applied: false, reason: null },
      authority: authority ? {
        required: authority.required,
        ran: authority.ran,
        deterministicCapabilityStatus: authority.deterministicCapabilityStatus,
        finalCapabilityStatus: authority.finalCapabilityStatus,
        authoritySource: authority.authoritySource,
        judgment: authority.judgment,
        confidence: authority.confidence,
        evidenceHandles: authority.evidenceHandles,
        fallbackReason: authority.fallbackReason,
        modelState: authority.modelState || null,
      } : null,
    },
  };
}

function shapeModelStatus(rawStatus, extra) {
  return {
    status: rawStatus.status,
    label: MODEL_STATE_LABELS[rawStatus.status] || rawStatus.status,
    detail: rawStatus.detail || {},
    ...extra,
  };
}

// Phase C8 — shapes an askConversational() response for the renderer.
// Reuses shapeAnswerForUI() verbatim for the 'final' case (identical
// sanitization/ID-stripping contract to the one-shot path -- no second
// implementation of that discipline). The 'clarification' case is new:
// `choices` are already plain, human-readable candidate TITLES (never raw
// record ids -- see clarificationDecision.js's own candidate shape and
// conversationalAsk.js's response.choices, which maps `.title` only), but
// still run through the same sanitizeForUI() pass as every other operator-
// facing string here, for defense in depth.
function shapeConversationalResponse(response, ctx) {
  if (response.kind === 'clarification') {
    return {
      kind: 'clarification',
      text: sanitizeForUI(response.text, ctx),
      choices: (response.choices || []).map((c) => sanitizeForUI(c, ctx)),
    };
  }
  return {
    kind: 'final',
    answer: shapeAnswerForUI(response.answer, ctx),
    topicChanged: !!response.topicChanged,
    hedged: !!response.hedged,
  };
}

module.exports = { shapeAnswerForUI, shapeModelStatus, shapeConversationalResponse, QUERY_STATUS_LABELS, MODEL_STATE_LABELS, GENERIC_UNCERTAIN_MESSAGE };
