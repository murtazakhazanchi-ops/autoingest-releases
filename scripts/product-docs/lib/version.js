'use strict';

// Documentation-system version. Distinct from package.json's application version —
// bump only when the shape of docs/product/generated/* output changes in a way
// consumers (humans or agents) need to know about. See docs/product/README.md.
// 1.1.0 — Part 7 adds a new generated artifact (ownership-manifest.json/
// OWNERSHIP_MANIFEST.md) and new automation-state directories
// (.autoingest-docs/decision-candidates/); additive only, no existing
// generated file's shape changed — a minor bump, not major.
const DOCSYS_VERSION = '1.1.0';

// Schema version for the generated JSON artifacts (feature-index, authority-index,
// subsystem-locator, dependency-graph, roadmap-dashboard, documentation-health,
// change-report, manifest, ownership-manifest). Bump when a generated file's
// field shape changes.
const SCHEMA_VERSION = '1.1.0';

// Bump when lib/ parsing or generation logic changes in a way that could change
// output even though DOCSYS_VERSION/SCHEMA_VERSION didn't move.
const GENERATOR_VERSION = '1.1.0';

module.exports = { DOCSYS_VERSION, SCHEMA_VERSION, GENERATOR_VERSION };
