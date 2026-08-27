'use strict';

// ASK AUTOINGEST — CANDIDATE C KNOWLEDGE MODEL, aggregate index. Experimental
// only. Combines every record source (Tier 1 forensic-verified clusters +
// Tier 2 registry-reshaped generated records + the hand-authored
// not-supported-boundary and roadmap records) into one flat array plus
// lookup maps, and validates every record against schema.js's own
// assertValidRecord before anything else in this experiment can use it --
// a build-time integrity gate, not a runtime one.

const { assertValidRecord } = require('./schema');

const SOURCES = [
  require('./records/notSupportedBoundaries').RECORDS,
  require('./records/roadmap').RECORDS,
  require('./records/sourceAndImport').RECORDS,
  require('./records/metadata').RECORDS,
  require('./records/transferAndArchive').RECORDS,
  require('./records/specialAndPlatform').RECORDS,
  require('./records/registryReshaped.generated').RECORDS,
];

const KNOWLEDGE_MODEL = SOURCES.flat();

const errors = KNOWLEDGE_MODEL.flatMap(assertValidRecord);
if (errors.length) {
  throw new Error(`Knowledge Model failed validation:\n${errors.join('\n')}`);
}

const byId = new Map(KNOWLEDGE_MODEL.map((r) => [r.id, r]));

// A featureId legitimately maps to MULTIPLE records when different records
// cover different facets of the same feature (e.g. QMZ's core record plus
// a dedicated troubleshooting record for a specific symptom; Login's core
// workflow record plus the separately-authored NOT_SUPPORTED
// multi-user-roles boundary record) -- this is dimensional decomposition
// working as intended, not a build error. Retrieval merges all of a
// featureId's records' matching dimensions rather than picking just one
// (see retrieval/conceptualRetrieve.js).
const byFeatureId = new Map();
for (const r of KNOWLEDGE_MODEL) {
  if (!r.featureId) continue;
  const list = byFeatureId.get(r.featureId) || [];
  list.push(r);
  byFeatureId.set(r.featureId, list);
}

const byMatchKey = new Map();
for (const r of KNOWLEDGE_MODEL) {
  for (const k of r.matchKeys || []) byMatchKey.set(k, r);
}

function findAllByFeatureId(featureId) {
  return byFeatureId.get(featureId) || [];
}

function findByFeatureId(featureId) {
  const list = byFeatureId.get(featureId);
  return list && list.length ? list[0] : null;
}

function findByBoundaryId(boundaryId) {
  return byMatchKey.get(boundaryId) || null;
}

function findById(id) {
  return byId.get(id) || null;
}

module.exports = {
  KNOWLEDGE_MODEL, findByFeatureId, findAllByFeatureId, findByBoundaryId, findById,
  stats: {
    total: KNOWLEDGE_MODEL.length,
    forensicVerified: KNOWLEDGE_MODEL.filter((r) => r.extractionTier === 'forensic-verified').length,
    registryReshaped: KNOWLEDGE_MODEL.filter((r) => r.extractionTier === 'registry-reshaped').length,
  },
};
