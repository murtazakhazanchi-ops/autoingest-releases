'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation,
// Sections 9-10 (relational knowledge + relationship authority).
// Productionized from Checkpoint 13/14's `check_relationship` (the C14
// version, which added directional MEANING strings and reference
// resolution -- superseding C13's own earlier, plainer version).
//
// Section 9 relationship-type classification (audited, not assumed --
// matches Checkpoint 14 Phase 3's own classification exactly):
//   DIRECTIONAL:  uses, writesTo, readsFrom, precedesInWorkflow
//   SYMMETRIC:    distinctFrom
//   GENERIC/UNKNOWN (no direction asserted): relatedTo, and any future
//     unclassified type -- the safe default for an unaudited type is
//     "assert no direction", never "assume directional".
//
// Section 10 authority states: SUPPORTED, CONTRADICTED, UNKNOWN, and (new
// in Stage 2, not present in the C13/C14 prototype -- see the CONFLICT
// finding below) CONFLICT. UNKNOWN is first-class: absence of a
// relationship edge means NOT ESTABLISHED, never a negative assertion.

const { findAllByFeatureId } = require('../knowledgeModel/index');
const { resolveThenSanitize, titleForFeatureId } = require('./leakBoundary');

const DIRECTIONAL_TYPES = new Set(['uses', 'writesTo', 'readsFrom', 'precedesInWorkflow']);
const SYMMETRIC_TYPES = new Set(['distinctFrom']);
// Subset of DIRECTIONAL_TYPES with genuine, inherent temporal asymmetry --
// see resolveRelationship()'s own header comment for why CONFLICT
// detection is scoped to this subset, not all of DIRECTIONAL_TYPES.
const PROCEDURAL_ORDERING_TYPES = new Set(['precedesInWorkflow']);
// relatedTo (and any future unclassified type) falls through as generic/
// non-directional by default.

// One general sentence per (type, direction) pair -- filled in with real
// titles for the actual subject/object, never invented content beyond what
// the stored edge + its own type already assert.
function describeEdge(type, direction, subjectTitle, objectTitle) {
  const s = subjectTitle || 'the subject';
  const o = objectTitle || 'the object';
  if (DIRECTIONAL_TYPES.has(type)) {
    // direction 'subject->object' means the edge was stored ON the
    // subject's own record, pointing at the object.
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
  return `${s} and ${o} are related, but the specific nature or direction of the connection is not documented beyond that -- do not assume which one contains, precedes, or depends on the other from this alone.`;
}

function identifiersFor(featureId) {
  const records = findAllByFeatureId(featureId);
  const ids = new Set([featureId]);
  for (const r of records) ids.add(r.id);
  return ids;
}

// Deterministic cross-reference: does ANY relationship edge connect these
// two subjects, in either direction, across any of either subject's own
// Knowledge Model records? A lookup over already-existing data, never a
// new judgment.
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

  // Stage 2, Section 10 finding (corrected after testing against real
  // corpus data -- see DEC-023): an EARLIER version of this function
  // treated any distinctFrom edge co-occurring with a positive edge as a
  // CONFLICT. Testing against the real Knowledge Model found 15 such pairs
  // (e.g. Source Detection/Source Selection: precedesInWorkflow AND
  // distinctFrom for the same pair) that are NOT contradictions -- this
  // corpus's own authoring convention uses distinctFrom to mean "distinct
  // mechanism/identity, do not conflate", which is fully compatible with a
  // real directional/procedural relationship also existing (two things can
  // be sequentially related AND conceptually distinct at once). Reverted
  // to matching the corpus's actual semantics: distinctFrom alone means
  // CONTRADICTED (do not describe them as the same/interchangeable),
  // regardless of a co-occurring positive edge.
  //
  // The genuinely meaningful CONFLICT case, found by the SAME real-data
  // testing pass, then ITSELF narrowed after a second round of testing: an
  // initial version checked all four DIRECTIONAL_TYPES symmetrically, and
  // found not only the genuine Transfer Export/Import contradiction below
  // but also two "uses" pairs (Import Pipeline/Duplicate Detection,
  // Metadata Durable Queue/Metadata Audit & Repair) where BOTH sides'
  // "uses" edges turned out, on inspection of their own note text, to
  // describe genuinely shared/mutually-embedded logic or a redundant
  // double-documentation of the same real fact -- not a contradiction.
  // Real software components CAN legitimately use/write-to/read-from each
  // other bidirectionally (mutual coupling, shared embedded functions);
  // only WORKFLOW ORDERING has genuine, inherent temporal asymmetry (if A
  // happens before B, B cannot also happen before A). CONFLICT detection
  // is therefore scoped to `precedesInWorkflow` alone, not every
  // DIRECTIONAL_TYPES member -- confirmed against real data: KM-transfer-
  // export and KM-transfer-import each carry their own precedesInWorkflow
  // edge pointing at the other, and Import's own edge's note text ("Import
  // reads what Export wrote") contradicts what its own edge direction
  // literally encodes -- a real, pre-existing Knowledge Model authoring
  // defect this check surfaces rather than silently resolves. The two
  // "uses" pairs are instead surfaced separately, as a softer, non-
  // authority-affecting "bidirectional same-type edge" finding in the
  // corpus audit (Section 22) -- worth a maintainer's attention for
  // redundancy/consistency review, but never asserted here as unreliable
  // or contradictory data the way a genuine CONFLICT is.
  const directionalSameTypeConflicts = [];
  for (const t of PROCEDURAL_ORDERING_TYPES) {
    const subjectSide = matches.some((m) => m.direction === 'subject->object' && m.type === t);
    const objectSide = matches.some((m) => m.direction === 'object->subject' && m.type === t);
    if (subjectSide && objectSide) directionalSameTypeConflicts.push(t);
  }
  if (directionalSameTypeConflicts.length) {
    return {
      status: 'CONFLICT',
      edges: matches,
      note: `AutoIngest's knowledge documents a CONFLICTING same-type relationship for these two subjects: both subjects' own records assert a "${directionalSameTypeConflicts.join('", "')}" edge pointing at the other, which is directionally impossible if both are accurate. Do not resolve this conflict yourself or assume either direction -- state plainly that AutoIngest's own documentation disagrees with itself on the ordering/direction here.`,
    };
  }
  if (negative.length) {
    return {
      status: 'CONTRADICTED',
      edges: matches,
      note: 'AutoIngest\'s knowledge explicitly documents these as DISTINCT/separate. Do not describe them as the same, connected, or sharing a mechanism/interface.',
    };
  }
  const directional = matches.filter((m) => DIRECTIONAL_TYPES.has(m.type));
  const note = directional.length
    ? 'AutoIngest\'s knowledge documents a directional connection between these two subjects -- read each edge\'s own "meaning" field for the exact, evidenced direction (which one comes first / uses / writes to / reads from the other). Do not state a direction beyond what an edge\'s own meaning field says.'
    : 'AutoIngest\'s knowledge documents that these two subjects are connected, but only as a generic, non-directional link -- it does NOT establish which one comes first, contains the other, or depends on the other. This is not necessarily the full picture: a more specific fact may be documented in each subject\'s own purpose/behavior text even when the structured relationship is only generic. Never state a direction that neither this tool nor that prose actually establishes.';
  return { status: 'SUPPORTED', edges: matches, note };
}

// check_relationship(subjectHandle, objectHandle, handleSession) -- the
// public entry point. Handle resolution failure is a PROTOCOL error,
// structurally distinct from every relationship-authority state above (see
// Section 13's own "invalid handles rejected safely" requirement).
function checkRelationship(subjectHandle, objectHandle, handleSession) {
  const subjectId = handleSession.resolve(subjectHandle);
  const objectId = handleSession.resolve(objectHandle);
  if (!subjectId || !objectId) {
    return {
      error: 'invalid_handle',
      note: 'One or both handles were not issued by a previous search in this session. This is a protocol error, not evidence about the relationship -- search again for the missing subject first.',
    };
  }
  if (subjectId === objectId) {
    return { status: 'SUPPORTED', edges: [], note: 'Both handles refer to the same subject.' };
  }
  return resolveRelationship(subjectId, objectId);
}

module.exports = {
  resolveRelationship, checkRelationship, describeEdge,
  DIRECTIONAL_TYPES, SYMMETRIC_TYPES, PROCEDURAL_ORDERING_TYPES, identifiersFor,
};
