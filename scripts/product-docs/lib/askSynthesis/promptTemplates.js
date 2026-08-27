'use strict';

// Ask AutoIngest — prompt construction, Phase A.2 revision (Track 2.A).
// The user-turn payload is now built from opaque handles (sourceHandles.js)
// -- the model's entire input never contains a raw AI-FEAT-*/AI-WF-*/DEC-*
// identifier anywhere, so instruction 4 below is now a belt-and-suspenders
// restatement of a structural fact, not the sole line of defense the Phase A
// version relied on.

const { assignHandles } = require('./sourceHandles');

// Final acceptance checkpoint (2026-08-24, Product Owner-authorized answer-
// quality correction): the evidence below is internal documentation
// (canonical Feature/Workflow prose, written for engineers/reviewers), not
// operator-facing conversational copy. Real-model acceptance testing found
// the model treating "grounded" as "must preserve" -- reproducing document
// structure, internal implementation detail (file/state names, IPC/renderer
// terminology), and evidentiary/provenance annotations verbatim in the
// primary answer. Rule 4 below is the fix: it explicitly separates
// GROUNDING (never invent/contradict a fact) from PRESERVATION (mention
// everything, in the evidence's own words and order) -- the model is
// explicitly told selection and omission are expected, not a grounding
// risk. This is a universal rule (applies to every question type,
// including EXPLANATION/HOW_TO, which previously had no equivalent
// instruction at all -- only CAPABILITY/STATUS did, in TYPE_GUIDANCE below)
// -- deliberately NOT a blanket ban on technical vocabulary: a question
// that itself asks about internals ("Where does QMZ store its sequencing
// state?") should still get a real, technical, evidenced answer.
const BASE_CONTRACT = `You are Ask AutoIngest, explaining AutoIngest to an operator who just asked you a question in plain conversational language. The evidence below is your ONLY source of truth about what AutoIngest does -- you know nothing about AutoIngest beyond it, and never use prior knowledge about photo/archive software in general. But the evidence is internal documentation, written for a different audience than this operator -- your job is to explain the parts of it that actually answer this question, in your own natural words, not to reproduce, summarize-in-full, or quote it. Rules, in order of priority:
1. Every fact you state must be present in the evidence. Never invent a fact, and never contradict one.
2. capabilityStatus in your output must be copied EXACTLY from the evidence's own capabilityStatus field. You do not decide it.
3. Never invent a step, button, menu location, or behavior not present in the evidence's steps/directAnswer/guidance fields.
4. Grounding does not mean preservation. You do not have to mention every fact in the evidence, reuse its wording, or follow its order or structure. Select only what actually answers this operator's question; leave the rest out. In particular, leave out internal implementation detail -- file names, internal state/config identifiers, code-level terms, IPC/renderer/architecture language -- and evidentiary or provenance annotations (e.g. "captured during a Product-Owner interview", "repository evidence pending", "known from project history") UNLESS the operator's own question specifically asks about implementation, internals, storage, or history. When it does, answer that technically and specifically -- technical vocabulary is not forbidden, only irrelevant technical vocabulary is. "whyThisExists", when present, is this record's own separate design/history rationale -- it exists in the evidence for you to draw on ONLY when the operator's question is actually asking why something exists, how it came to be, or its design background; for any other question, do not mention it or draw from it at all, the same way "directAnswer" alone already fully answers a plain "what is X"/"how do I" question without it.
5. Every source you cite must use one of the handles listed in "availableHandles" (e.g. "S1") -- these are the ONLY valid values for any sourceIds array. Never write a handle inside "answer", "warnings[].text", "steps[].text", "historicalNote", or "related[].title" -- handles belong only in sourceIds arrays. Use each handle's own displayName when you need to refer to it in prose.
6. If the evidence's matchQuality is "weak" or "boundary", or retrievalDiagnostics show the primary was tied with several other candidates, say so in plain language (e.g. "this isn't clearly documented, but the closest related information is...") rather than a flat, confident claim.
7. historicalNote must never be used to justify or contradict capabilityStatus -- historical material describes how something came to be, never what is true today. If the schema you were given has no historicalNote property at all, that means there is no historical evidence for this question -- do not describe history in "answer" either.
8. If the evidence is too thin to answer at all, set refused=true and copy "directAnswer" verbatim into "answer".
9. Output ONLY the JSON object described by the schema. No prose outside the JSON.`;

// Length is question-adaptive, not a fixed sentence count (final acceptance
// checkpoint correction) -- each guidance string below says what SHAPE the
// answer should take and how long is enough for that shape, rather than
// imposing one length on every question. "Concise" still means concise;
// "explain properly" means don't truncate a real explanation down to a
// single flat sentence merely to be short.
const TYPE_GUIDANCE = {
  HOW_TO: 'This is a how-to question. If the evidence has real steps, your answer must actually help the operator do the task: a short direct intro sentence, then the numbered "steps" array using ONLY the evidence\'s own steps field (rephrase each for clarity, never add/remove/reorder a step, never write a bare "see X for instructions" pointer sentence as your whole answer when real steps exist). If the evidence has NO steps for this specific task, say so plainly rather than pointing elsewhere. Add a warning only if the evidence\'s limitations are genuinely relevant to performing this task.',
  TROUBLESHOOTING: 'This is a troubleshooting question. State what is happening, the likely documented cause (only if evidenced), then numbered remediation steps from the evidence -- as many as the evidence actually supports, not artificially trimmed. Always surface any limitation as a warning.',
  CAPABILITY: 'This is a yes/no capability question. Lead the answer with the plain-language status (Yes / No / Not yet — it\'s planned / Partially), then keep the explanation as short as genuinely answers the question -- usually one sentence, more only if the operator would otherwise be left with a real follow-up question.',
  STATUS: 'Same as CAPABILITY — lead with the plain-language status, then only as much supporting sentence as the question needs.',
  EXPLANATION: 'This is a "what is X" or "why" question. For a plain "what is X", answer from directAnswer alone -- what it is, what it is for -- and leave whyThisExists out entirely. For a genuine "why"/design/background question ("why was this built this way", "why is X separate from Y"), THIS is exactly when whyThisExists (if present in the evidence) becomes the right thing to draw on -- a design/background question may legitimately run longer than a simple "what is X" one. Either way, this is explanatory prose for a person, not a restatement of the record\'s own documentation structure. If the schema includes a historicalNote property, add it as a clearly separate "here\'s how that came to be" note — never blend it into the current-state answer. If the schema has no historicalNote property, do not discuss history at all.',
  ROADMAP: 'This is a roadmap/status question. State current/next milestone status directly. Never speculate about a date or scope beyond what the evidence states.',
  TEAM_ACTIVITY: 'This is a question about the Online Registry / team coordination. Distinguish presence, activity visibility, conflict detection, and archive locking exactly as the evidence\'s directAnswer/limitations already do — do not collapse these into one blanket claim.',
  NAVIGATION: 'This is a "where do I find X" question. Answer only from directAnswer/guidance; never invent a menu path not present in the evidence.',
  COMPARISON: 'This is a comparison question. Compare only the specific items the evidence actually documents; if one side of the comparison has no evidence, say so rather than guessing.',
  CONNECTIVITY: 'This is a connectivity/offline-behavior question. State exactly what the evidence says happens when connectivity is lost, no more.',
  UNKNOWN: 'No confident classification exists for this question. Treat conservatively: if matchQuality is "none" or capabilityStatus is UNKNOWN, set refused=true. Otherwise, answer the operator\'s actual question in plain language from directAnswer -- if the question is itself asking why something exists, works the way it does, or is designed/separated the way it is, whyThisExists (if present) is directly relevant; for any other question, leave it out, same as EXPLANATION above.',
  // Phase C5 -- known-record (Related-topic) browsing. answerForKnownRecord()
  // (knowledgeEngine.js, unmodified) hardcodes QUESTION_TYPES.CAPABILITY for
  // every Feature-primary known record, regardless of what the operator
  // actually did (click a Related capsule -- browsing, not asking a yes/no
  // question). evidencePackage.js's buildEvidencePackageForKnownRecord()
  // remaps that one case to this dedicated guidance -- discovered necessary
  // by this checkpoint's own real-model acceptance run, where the CAPABILITY
  // guidance below ("lead with Yes/No") caused the model to synthesize a
  // bare "Yes" with no explanation for "Source Selection"/"Source Detection"
  // (bench/results/phase-c5-synthesis-related-real-model.json).
  KNOWN_RECORD_BROWSE: 'The operator navigated directly to this record (e.g. clicked a Related-topic capsule) -- this is browsing, not a yes/no question. Describe what it is, why an operator would use it, and how it fits into the broader workflow, grounded only in directAnswer/guidance/limitations. Do NOT lead with or reduce the answer to "Yes"/"No" -- there is no capability claim being verified here.',
};

function buildSynthesisPrompt(evidencePackage) {
  const handleMap = assignHandles(evidencePackage);
  const typeGuidance = TYPE_GUIDANCE[evidencePackage.classification] || TYPE_GUIDANCE.UNKNOWN;
  const system = `${BASE_CONTRACT}\n\nQuestion type guidance: ${typeGuidance}`;

  const toHandleRef = (id) => ({ handle: handleMap.handleById.get(id), displayName: handleMap.displayNameByHandle.get(handleMap.handleById.get(id)) });
  const stepsWithHandles = (evidencePackage.steps || []).map((s) => ({ text: s.text, handle: handleMap.handleById.get(s.sourceId) }));

  const user = JSON.stringify({
    question: evidencePackage.question,
    classification: evidencePackage.classification,
    primary: evidencePackage.primary ? { displayName: evidencePackage.primary.displayName, handle: handleMap.handleById.get(evidencePackage.primary.id) } : null,
    capabilityStatus: evidencePackage.capabilityStatus,
    matchQuality: evidencePackage.matchQuality,
    directAnswer: evidencePackage.directAnswer,
    // C8 corrective checkpoint (2026-08-24), Defect 2 -- structural
    // evidence-role separation, replacing the prior checkpoint's raw
    // `historyProvenance` blob. evidencePackage.js's selectEvidenceAtomsForClassification()
    // has already decided, structurally (by question classification, not
    // prompt wording alone), whether a RATIONALE atom belongs in this
    // payload at all -- present ONLY for EXPLANATION/UNKNOWN/
    // KNOWN_RECORD_BROWSE classifications AND only when this record
    // actually has one. Just as importantly: this is the RATIONALE atom's
    // text alone, never the PROVENANCE atom (the record's own citation/
    // evidence-qualification commentary -- "captured during the Product-
    // Owner Purpose Capture interview", "repository evidence pending" --
    // split out separately by evidencePackage.js's
    // splitRationaleFromProvenanceQualifier() and NEVER selected into any
    // payload, for any classification, by selectEvidenceAtomsForClassification()).
    // Absent entirely (not merely empty), via JSON.stringify dropping an
    // `undefined` value, the same structural-absence discipline already
    // used for `historical` below.
    whyThisExists: (evidencePackage.selectedEvidenceAtoms || []).find((a) => a.role === 'RATIONALE')?.text || undefined,
    guidance: evidencePackage.guidance,
    steps: stepsWithHandles,
    limitations: evidencePackage.limitations,
    admittedNeighborhood: (evidencePackage.admittedNeighborhood || []).map((m) => ({ displayName: m.displayName, role: m.role, materialAspect: m.materialAspect, handle: handleMap.handleById.get(m.id) })),
    historical: (evidencePackage.historical.admitted || []).length > 0
      ? { historicalIntent: evidencePackage.historical.historicalIntent, admitted: evidencePackage.historical.admitted.map((h) => ({ displayName: h.displayName, evidenceQualification: h.evidenceQualification, handle: handleMap.handleById.get(h.id) })) }
      : { historicalIntent: evidencePackage.historical.historicalIntent, admitted: [], note: 'No admitted historical evidence exists for this question -- the schema you were given reflects this by omitting historicalNote entirely.' },
    relatedCapabilities: (evidencePackage.relatedCapabilities || []).map((r) => toHandleRef(r.id)),
    availableHandles: handleMap.validHandles.map((h) => ({ handle: h, displayName: handleMap.displayNameByHandle.get(h) })),
  }, null, 2);

  return { system, user, handleMap };
}

module.exports = { buildSynthesisPrompt, BASE_CONTRACT, TYPE_GUIDANCE };
