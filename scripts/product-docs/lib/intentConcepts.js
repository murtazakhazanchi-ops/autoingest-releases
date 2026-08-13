'use strict';

// Stage 2 — the concept/synonym canonicalization layer (AI-FEAT-058's
// Phase 3-approved "Intent" record type). Deliberately small, curated,
// inspectable, and tested — NOT a giant per-question lookup table, and NOT
// embeddings. Each cluster maps a family of real paraphrases to one or more
// short "search hints" — plain text runs through the SAME lib/query.js
// ranker unchanged, just as additional candidate queries alongside the raw
// question, so semantically-equivalent phrasings converge on the same
// records even when their literal words don't overlap with a target
// record's own keywords. See docs/product/decisions/DEC-020_*.md.
//
// A cluster's `hints` are plain strings run through runQuery exactly like a
// real question would be — they are not magic, just curated alternate
// phrasings closer to the target records' own vocabulary. `unsupportedHint`
// marks clusters that exist specifically to route a paraphrase family
// toward an existing lib/statusResolution.js KNOWN_BOUNDARIES entry (see
// intentConcepts.boundaryHints below) rather than toward a capability.

const CONCEPT_CLUSTERS = [
  {
    id: 'team-collaboration',
    domain: 'Online Registry & Teamwork',
    triggers: [
      'several users', 'multiple people', 'multiple users', 'multiple operators',
      'two laptops', 'two computers', 'two devices', 'work together',
      'collaborative', 'work at the same time', 'simultaneously', 'same archive at once',
      'coordinate with', 'coordination between', 'work as a team', 'team work',
    ],
    hints: ['team live online registry teamwork presence', 'who else is online'],
  },
  {
    id: 'team-presence',
    domain: 'Online Registry & Teamwork',
    triggers: [
      'who else is online', 'who is online', 'see other operators', 'see who is connected',
      'which computers are connected', 'is anyone else online', 'who is active',
    ],
    hints: ['team live online registry presence device online'],
  },
  {
    id: 'team-progress',
    domain: 'Online Registry & Teamwork',
    triggers: [
      'see another operator', 'see what another', 'importing into this event',
      'another computer importing', 'someone else importing', 'shared import progress',
      'is already working on', 'progress stopped updating',
    ],
    hints: ['team live activity progress import sync device'],
  },
  {
    id: 'team-connectivity',
    domain: 'Online Registry & Teamwork',
    triggers: [
      'registry offline', 'registry down', 'without internet', 'no internet',
      'reconnect', 'connection dropped', 'server unavailable', 'registry unavailable',
      'still showing online', 'shows offline',
    ],
    hints: ['team live online registry offline reconnect degraded'],
  },
  // 'team-authority' was REMOVED here during Phase 20 (Stage 2 eval corpus
  // expansion) testing — a real, found-and-fixed defect, not a refactor.
  // It existed to recognize Registry-authority questions ("does the
  // registry store [my photos]", "registry replace the archive", "registry
  // the source of truth") but its hints boosted confidence toward AVAILABLE
  // exactly backwards: every one of those questions has an already-evidenced
  // NEGATIVE answer (see statusResolution.js's registry-media-storage and
  // registry-not-source-of-truth boundaries, added in the same fix). The
  // same trigger phrases now live in BOUNDARY_CONCEPT_CLUSTERS below,
  // correctly routing to a NOT_SUPPORTED boundary citation instead of
  // inflating an AVAILABLE match.
  {
    id: 'import-general',
    domain: 'Import',
    triggers: [
      'import photos', 'import photographs', 'import from sd card', 'import from a card',
      'import from folder', 'bring in photos', 'copy photos in',
    ],
    hints: ['import photographs memory card folder event'],
  },
  {
    id: 'import-video',
    domain: 'Import',
    triggers: ['import video', 'import videos', 'video files'],
    // Deliberately NO hints: no canonical record confirms video-format
    // support specifically (only config/app.config.js, a non-canonical
    // technical file — a real, already-disclosed Stage 1 documentation
    // gap). An earlier hint here ("import event component routing")
    // artificially boosted confidence toward AI-FEAT-018, a routing
    // capability with no real video-specific evidence — found and reverted
    // during Stage 2's own testing. The concept is still recognized (for
    // future authoring), it just adds no candidate query, so this
    // correctly falls back to the honest, weak, hedged tied match Stage 1
    // already established as the right answer here.
    hints: [],
  },
  {
    id: 'event-create',
    domain: 'Events',
    triggers: ['create an event', 'create a new event', 'set up an event', 'start an event', 'new event'],
    hints: ['create new event'],
  },
  {
    id: 'event-edit',
    domain: 'Events',
    triggers: ['edit an event', 'edit event', 'change event details', 'find an event', 'find my event'],
    hints: ['event management editing'],
  },
  {
    id: 'metadata-repair',
    domain: 'Metadata',
    triggers: ['missing metadata', 'metadata is missing', 'fix metadata', 'repair metadata', 'metadata wrong', 'no metadata'],
    hints: ['metadata audit repair'],
  },
  {
    id: 'qmz',
    domain: 'QMZ',
    triggers: ['qmz', 'qadam', 'majlis', 'ziyafat', 'sort qmz'],
    hints: ['qmz sequencing workspace'],
  },
  {
    id: 'transfer-export',
    domain: 'Transfer & Backup',
    triggers: ['export the archive', 'transfer drive', 'portable drive', 'export data'],
    hints: ['transfer export'],
  },
  {
    id: 'backup-update',
    domain: 'Transfer & Backup',
    triggers: ['update backup', 'scan for new data', 'sync backup', 'backup update'],
    hints: ['backup update scanning'],
  },
  {
    id: 'transfer-resume',
    domain: 'Transfer & Backup',
    triggers: ['interrupted transfer', 'resume transfer', 'transfer stopped', 'transfer halfway'],
    // Targets AI-WF-005 (the Workflow that actually discusses this exact
    // scenario, including BUG-005's resume-state history) rather than
    // AI-FEAT-041 (Background/Minimize — real, but not specifically about
    // resuming after an interruption). Reworked during Stage 2's own
    // testing after the original hint pulled toward the less relevant
    // record; "resume"/"interrupted" aren't literal keywords on AI-WF-005
    // (they live in its Expected Result section, which keyword extraction
    // doesn't draw from — see lib/workflowIndex.js), so this hint uses
    // words that genuinely are indexed there instead of inventing a match.
    hints: ['transfer sync scan compare conflict'],
  },
  {
    id: 'archive-lock',
    domain: 'Archive Management',
    triggers: ['archive is locked', 'locked event', "can't import", 'stale lock', 'lock error'],
    hints: ['archive lock handling stale lock recovery'],
  },
  {
    id: 'roadmap-status',
    domain: 'Roadmap / Status',
    triggers: [
      "what's next", 'whats next', 'coming next', 'coming soon', 'planned features',
      'what is planned', 'roadmap', 'recent changes', 'what changed',
    ],
    hints: ['roadmap dashboard status'],
  },
  {
    id: 'update-channel',
    domain: 'Application',
    triggers: ['update autoingest', 'new version', 'stable release', 'preview release', 'switch channel'],
    hints: ['multi channel release update system application auto-update'],
  },
];

// A small number of clusters exist purely to widen recall for an ALREADY
// evidenced lib/statusResolution.js KNOWN_BOUNDARIES entry — never to add a
// new unevidenced exclusion. Extending a boundary's keyword coverage this
// way was recommended (not required) by the PR #5 forensic review; kept
// deliberately narrow, and every phrase here maps to a citation that
// already existed in Stage 1's KNOWN_BOUNDARIES table.
const BOUNDARY_CONCEPT_CLUSTERS = [
  {
    id: 'cloud-storage',
    boundaryId: 'cloud-storage',
    triggers: ['google drive', 'dropbox', 'cloud storage', 'cloud backup', 'onedrive', 'icloud', 'upload my archive', 'back up to the cloud', 'backup to the cloud'],
  },
  {
    id: 'team-multi-role',
    boundaryId: 'multi-user-roles',
    triggers: ['multiple people log in', 'different roles', 'separate accounts', 'user roles', 'role-based', 'people log in with their own roles', 'different people log in', 'multiple user accounts', 'multiple accounts'],
  },
  // Stage 2, Phase 20 — four Registry authority/scope boundary-widening
  // clusters, added alongside their statusResolution.js KNOWN_BOUNDARIES
  // entries after the expanded eval corpus found several natural Registry
  // questions confidently (sometimes "strong") mis-answered AVAILABLE.
  // Every trigger phrase here widens recall for an ALREADY-evidenced
  // exclusion — never invents a new one (same discipline as cloud-storage
  // and team-multi-role above).
  {
    id: 'registry-media-storage',
    boundaryId: 'registry-media-storage',
    triggers: [
      'does the registry store', 'registry store my photo', 'registry hold my photo',
      'see my photos over the network', 'relay store my photo', 'relay transmit my photo',
      'photos pass through the relay', 'photos go through the relay', 'upload to the registry',
      'uploaded somewhere', 'being uploaded', 'photos uploaded to the relay',
    ],
  },
  {
    id: 'registry-source-of-truth',
    boundaryId: 'registry-not-source-of-truth',
    triggers: [
      'registry replace the archive', 'replace the archive as', 'registry the source of truth',
      'registry become the source of truth', 'source of truth instead of the archive',
      'registry replaces event.json', 'registry replace event.json',
    ],
  },
  {
    id: 'registry-conflict',
    boundaryId: 'registry-conflict-detection',
    triggers: [
      'will there be a conflict', 'conflict warning', 'conflict detection', 'conflict:warning',
      'warn me if someone else', 'warn if two people', 'warns about editing the same',
      'flag a conflict', 'detect a conflict', 'without a warning', 'warn us about conflict',
      'warn about conflict', 'registry warn', 'warn us if', 'warn if we',
    ],
  },
  {
    id: 'registry-activity-scope',
    boundaryId: 'registry-activity-scope',
    triggers: [
      'show up as activity', 'visible to other operators', 'see qmz activity',
      'see metadata activity', 'audit activity show up', 'qmz sorting show up',
    ],
  },
  {
    id: 'registry-presence-not-activity',
    boundaryId: 'registry-presence-not-activity',
    triggers: [
      'are they editing my files', 'does presence mean', 'presence mean they',
      'presence mean someone', 'stop me from also working', 'stop you from also working',
      'block me from working on the same', 'prevent me from working on the same',
    ],
  },
];

function findConcept(questionLower) {
  for (const c of CONCEPT_CLUSTERS) {
    for (const t of c.triggers) {
      if (questionLower.includes(t)) return c;
    }
  }
  return null;
}

// Returns a matched boundary-widening trigger's underlying boundaryId (from
// lib/statusResolution.js's KNOWN_BOUNDARIES), or null. Deliberately
// separate from findConcept — this function's only job is widening
// recognition of an ALREADY-evidenced exclusion, never inventing one.
function findBoundaryConcept(questionLower) {
  for (const c of BOUNDARY_CONCEPT_CLUSTERS) {
    for (const t of c.triggers) {
      if (questionLower.includes(t)) return c.boundaryId;
    }
  }
  return null;
}

module.exports = { CONCEPT_CLUSTERS, BOUNDARY_CONCEPT_CLUSTERS, findConcept, findBoundaryConcept };
