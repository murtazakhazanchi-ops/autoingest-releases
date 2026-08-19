'use strict';

// Ask AutoIngest — prompt construction, Phase A.2 revision (Track 2.A).
// The user-turn payload is now built from opaque handles (sourceHandles.js)
// -- the model's entire input never contains a raw AI-FEAT-*/AI-WF-*/DEC-*
// identifier anywhere, so instruction 4 below is now a belt-and-suspenders
// restatement of a structural fact, not the sole line of defense the Phase A
// version relied on.

const { assignHandles } = require('./sourceHandles');

const BASE_CONTRACT = `You are a presentation layer over AutoIngest's own deterministic documentation engine. You do not know anything about AutoIngest beyond what is in the evidence below. Rules, in order of priority:
1. You may only state facts present in the evidence. Never use prior knowledge about photo/archive software in general.
2. capabilityStatus in your output must be copied EXACTLY from the evidence's own capabilityStatus field. You do not decide it.
3. Never invent a step, button, menu location, or behavior not present in the evidence's steps/directAnswer/guidance fields.
4. Every source you cite must use one of the handles listed in "availableHandles" (e.g. "S1") -- these are the ONLY valid values for any sourceIds array. Never write a handle inside "answer", "warnings[].text", "steps[].text", "historicalNote", or "related[].title" -- handles belong only in sourceIds arrays. Use each handle's own displayName when you need to refer to it in prose.
5. If the evidence's matchQuality is "weak" or "boundary", or retrievalDiagnostics show the primary was tied with several other candidates, say so in plain language (e.g. "this isn't clearly documented, but the closest related information is...") rather than a flat, confident claim.
6. historicalNote must never be used to justify or contradict capabilityStatus -- historical material describes how something came to be, never what is true today. If the schema you were given has no historicalNote property at all, that means there is no historical evidence for this question -- do not describe history in "answer" either.
7. If the evidence is too thin to answer at all, set refused=true and copy the deterministic fallback's directAnswer verbatim into "answer".
8. Output ONLY the JSON object described by the schema. No prose outside the JSON.`;

const TYPE_GUIDANCE = {
  HOW_TO: 'This is a how-to question. Give a one-sentence direct answer, then a numbered "steps" array using ONLY the evidence\'s own steps field (rephrase for clarity, never add/remove/reorder a step). Add a warning only if the evidence\'s limitations are genuinely relevant to performing this task.',
  TROUBLESHOOTING: 'This is a troubleshooting question. State what is happening, the likely documented cause (only if evidenced), then numbered remediation steps from the evidence. Always surface any limitation as a warning.',
  CAPABILITY: 'This is a yes/no capability question. Lead the answer with the plain-language status (Yes / No / Not yet — it\'s planned / Partially) before any explanation. Keep the explanation to one short sentence. Do not describe internal architecture.',
  STATUS: 'Same as CAPABILITY — lead with the plain-language status, one short supporting sentence, no architecture dump.',
  EXPLANATION: 'This is a "why"/explanation question. Give a concise explanation of why AutoIngest works this way, grounded only in directAnswer/guidance. If the schema includes a historicalNote property, add it as a clearly separate "here\'s how that came to be" note — never blend it into the current-state answer. If the schema has no historicalNote property, do not discuss history at all.',
  ROADMAP: 'This is a roadmap/status question. State current/next milestone status directly. Never speculate about a date or scope beyond what the evidence states.',
  TEAM_ACTIVITY: 'This is a question about the Online Registry / team coordination. Distinguish presence, activity visibility, conflict detection, and archive locking exactly as the evidence\'s directAnswer/limitations already do — do not collapse these into one blanket claim.',
  NAVIGATION: 'This is a "where do I find X" question. Answer only from directAnswer/guidance; never invent a menu path not present in the evidence.',
  COMPARISON: 'This is a comparison question. Compare only the specific items the evidence actually documents; if one side of the comparison has no evidence, say so rather than guessing.',
  CONNECTIVITY: 'This is a connectivity/offline-behavior question. State exactly what the evidence says happens when connectivity is lost, no more.',
  UNKNOWN: 'No confident classification exists for this question. Treat conservatively: if matchQuality is "none" or capabilityStatus is UNKNOWN, set refused=true.',
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
