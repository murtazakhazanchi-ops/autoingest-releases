'use strict';

// ASK AUTOINGEST — CANDIDATE C EVIDENCE ROUTER. Experimental only.
//
// The one seam where Candidate C differs from Candidate B: instead of
// always building evidence from evidencePackage.js's FACT/ACTION/LIMITATION
// atom extraction (Candidate B's serializeExperimentalEvidence, unchanged),
// this router first asks the Knowledge Model's conceptual retrieval
// (knowledgeModel/retrieval/conceptualRetrieve.js) for a dimension-selected
// evidence block. If the Knowledge Model has no record for whatever the C8
// authority layer resolved (an AI-WF-* Workflow-record match, or any
// remaining gap in coverage), this falls back to Candidate B's own
// evidence-shaping path unchanged -- a disclosed degrade, never a silent
// empty-evidence turn.

const { classifyQuestion } = require('../../lib/questionClassifier');
const { conceptualRetrieve } = require('../knowledgeModel/retrieval/conceptualRetrieve');
const { serializeExperimentalEvidence } = require('../bakeoff/experimentalEvidence');

// `pkg` is the evidence-package thunk result from candidateC/orchestrator.js
// -- a normal evidencePackage.js pkg augmented with three inert extra
// fields (__kmAnswer, __kmUserMessage, __kmQueryText) that only this
// function reads. See orchestrator.js's own header comment for why the
// side-channel exists instead of changing trySynthesize()/evidencePackage.js.
function buildKnowledgeModelEvidence(pkg) {
  const { __kmAnswer: answer, __kmUserMessage: userMessage } = pkg;
  const questionType = classifyQuestion(userMessage);
  const km = conceptualRetrieve({ answer, questionType, userText: userMessage });
  if (km) {
    return { evidenceBlock: km.evidenceBlock, source: 'knowledge-model', kmRecordId: km.kmRecordId, extractionTier: km.extractionTier, dimensionsUsed: km.dimensionsUsed, technicalGateOpen: km.technicalGateOpen, questionType };
  }
  const evidenceBlock = serializeExperimentalEvidence(pkg);
  return { evidenceBlock, source: 'fallback-c8-evidence', kmRecordId: null, extractionTier: null, dimensionsUsed: null, technicalGateOpen: null, questionType };
}

module.exports = { buildKnowledgeModelEvidence };
