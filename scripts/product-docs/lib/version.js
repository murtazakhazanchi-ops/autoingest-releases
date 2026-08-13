'use strict';

// Documentation-system version. Distinct from package.json's application version —
// bump only when the shape of docs/product/generated/* output changes in a way
// consumers (humans or agents) need to know about. See docs/product/README.md.
// 1.1.0 — Part 7 adds a new generated artifact (ownership-manifest.json/
// OWNERSHIP_MANIFEST.md) and new automation-state directories
// (.autoingest-docs/decision-candidates/); additive only, no existing
// generated file's shape changed — a minor bump, not major.
// 1.2.0 — Part 8 adds new generated artifacts (conversation-index.json/
// .jsonl, CONVERSATION_INDEX.md, CONVERSATION_TIMELINE.md,
// unimplemented-conversation-requirements.json/.md), a new search-index.jsonl
// entity_type ("engineering_conversation"), new dependency-graph.json
// relationship types (conversation_about_feature and siblings), and a new
// manifest.json entity_counts key (engineering_conversations). Additive
// only — no existing field was renamed or removed — a minor bump, not major.
// 1.3.0 — Stage 1 Knowledge Engine (AI-FEAT-058) adds a new generated
// artifact (knowledge-index.json, a portal-oriented projection of
// feature-index.json + roadmap-dashboard.json) and a new manifest.json
// entity_counts key (knowledge_records). Additive only — no existing field
// renamed or removed — a minor bump, not major.
const DOCSYS_VERSION = '1.3.0';

// Schema version for the generated JSON artifacts (feature-index, authority-index,
// subsystem-locator, dependency-graph, roadmap-dashboard, documentation-health,
// change-report, manifest, ownership-manifest, conversation-index, knowledge-index).
// Bump when a generated file's field shape changes.
const SCHEMA_VERSION = '1.3.0';

// Bump when lib/ parsing or generation logic changes in a way that could change
// output even though DOCSYS_VERSION/SCHEMA_VERSION didn't move.
const GENERATOR_VERSION = '1.3.0';

module.exports = { DOCSYS_VERSION, SCHEMA_VERSION, GENERATOR_VERSION };
