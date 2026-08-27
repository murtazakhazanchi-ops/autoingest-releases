'use strict';

// Candidate C Knowledge Model — Roadmap record. Experimental only. Reshaped
// from docs/product/02_MASTER_ROADMAP.md's own "Current position" summary
// and the AI-RM-002 table, verbatim facts only.

const { STATUS, EXTRACTION_TIERS } = require('../schema');

const RECORDS = [
  {
    id: 'KM-roadmap-status',
    featureId: null,
    title: 'AutoIngest Roadmap — What Is Coming Next',
    aliases: ["what's next", 'roadmap', 'coming next', 'planned next'],
    purpose: 'Tells an operator what AutoIngest has already shipped in its ordered archive-capability roadmap and what is scheduled next.',
    operatorWorkflow: [],
    preconditions: [],
    actions: [],
    behavior: 'The ordered archive-capability roadmap (AI-RM-001 through AI-RM-009) is 1 of 9 milestones complete. AI-RM-001 (Metadata Audit & Repair) is Completed. The next milestone is AI-RM-002 (Archive Maintenance), whose active implementation has Not started (scope itself is not yet defined — "Evidence pending" for objective/deliverables/acceptance criteria). AI-RM-003 (Event Maintenance) follows AI-RM-002 and depends on it; also not started. Two separate, parallel tracks outside this sequence are already complete: AI-RM-010 (Multi-Channel Release & Update System) and AI-RM-011 (Knowledge & Onboarding Portal, Stage 1+2).',
    recovery: null,
    relationships: [
      { type: 'precedesInWorkflow', targetId: 'AI-FEAT-049', note: 'AI-RM-002 (Archive Maintenance) is the next milestone; AI-FEAT-049 is its only included feature.' },
    ],
    limitations: ['AI-RM-002\'s objective, deliverables, and acceptance criteria are explicitly "Evidence pending" — scope has not yet been defined, only its position in sequence.'],
    status: STATUS.PLANNED,
    technicalDetail: null,
    provenance: [
      { claim: 'roadmap position and milestone status', source: 'docs/product/02_MASTER_ROADMAP.md "Current position" summary and AI-RM-002 table', type: 'doc', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.REGISTRY_RESHAPED,
  },
];

module.exports = { RECORDS };
