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
//
// Phase C6.2 — trigger matching widened from exact ordered substring to
// ALSO accept full-token-set containment (see triggerMatches below).
// FORENSIC FINDING that motivated this: real operator paraphrases
// routinely reorder or rephrase a trigger's own words -- "transfer gets
// interrupted" does not contain the literal substring "interrupted
// transfer" even though it is obviously the same concept. The exact-
// substring check (unchanged, tried first, cheapest) still wins when it
// matches; the token-set check is the fallback, and is deliberately
// restricted to MULTI-WORD triggers only (single-word triggers keep
// substring-only matching) — a lone shared word is much weaker evidence
// than every word of a real multi-word phrase appearing somewhere in the
// question, and single-word triggers are exactly the shape most likely to
// false-positive if loosened (the same class of risk already documented
// and guarded against in lib/query.js's own identity-mention tier).

const CONCEPT_CLUSTERS = [
  {
    // Part 3 Phase 4.2 (Decision 1) — 'two operators' added to triggers
    // below. Recall improvement (audit R15), not a correctness fix — this
    // cluster only widens candidate-query discovery via a hint, never a
    // hard override; per DEC-020's own hint-vs-raw-boundary-precedence rule
    // a hint can never override a curated boundary, so this addition
    // carries none of the risk profile the hard-override boundary audit
    // above concerns itself with. Verified corpus-wide before being added
    // (see the Phase 4.2 report) rather than assumed safe.
    id: 'team-collaboration',
    domain: 'Online Registry & Teamwork',
    triggers: [
      'several users', 'multiple people', 'multiple users', 'multiple operators',
      'two laptops', 'two computers', 'two devices', 'two operators', 'work together',
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
      // Phase C6.2 additions — same discipline as the rest of this cluster.
      'who else is working right now', 'see who is working right now',
      'shows a device as online', 'still showing a device as online',
      'device as online even though',
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
  // Added 2026-08-14 per a product-owner clarification: the Registry's
  // PRIMARY purpose is distributed event coordination (separated operators
  // discovering and adopting a shared event identity without a common
  // NAS/archive connection), not merely presence. A forensic trace of
  // main.js/realtimeOperationsService.js/eventCreator.js confirmed this is
  // a real, substantially-implemented capability (see AI-WF-006's own new
  // "Event Discovery & Coordination" section) — this cluster exists to
  // route natural operator questions about it there.
  {
    id: 'team-event-coordination',
    domain: 'Online Registry & Teamwork',
    triggers: [
      'what is the online registry for', 'why do we need team live', 'why does team live exist',
      'what is team live for', 'purpose of the online registry', 'purpose of team live',
      'how will the office know', 'how will they know i created', 'how will they know about',
      'already created this event', 'do i need to create it again', 'someone already created',
      'event created by another', 'get an event created by', 'duplicate an online event',
      'duplicate a registry event', 'adopt an online event', 'adopt a registry event',
      'not connected to the same nas', 'not on the same nas', 'without a shared nas',
      "aren't connected to the same nas", 'use the same event name', 'same event name across',
      'different locations use the same event', 'prevent us from creating differently named',
      'differently named versions of the same event', 'creating duplicate events',
      'see what event another', 'what event is', 'just an online-user list',
      'just a list of who is online', 'more than just a user list',
      'collaborate without access to the main archive', 'without access to the main archive root',
      'reconnect to the archive', 'when we reconnect to the archive',
      'working in the field', 'field and created an event',
      // Phase C6.2 additions — same discipline as the rest of this cluster
      // (widening recall for the ALREADY-evidenced AI-WF-006 "Event
      // Discovery & Coordination" capability, never inventing a new claim).
      'made this event on their', 'made this event on', 'get it onto mine',
      'onto mine without redoing', 'different locations end up using',
      'end up using the exact same event',
    ],
    hints: ['team live online registry event coordination discovery shared identity adopt prepare'],
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
    // Phase C6.2 REGRESSION FINDING: 'metadata wrong' and 'fix metadata'
    // narrowed to their fuller original phrasing. Both reduce to just two
    // individually-common tokens ({metadata, wrong} / {fix, metadata})
    // that can coincidentally co-occur in an unrelated sentence under the
    // new token-set fallback (e.g. "What went WRONG with... METADATA
    // verification?" — a real regression this fix resolves) — same risk
    // class as the boundary-cluster finding above, just in a regular
    // concept cluster instead. 'missing metadata'/'metadata is missing'/
    // 'repair metadata'/'no metadata' are unaffected: each already
    // contains 'metadata' adjacent to a genuinely metadata-specific word,
    // not a generic one.
    triggers: ['missing metadata', 'metadata is missing', 'fix the metadata', 'repair metadata', 'metadata came out wrong', 'no metadata'],
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

  // ────────────────────────────────────────────────────────────────────
  // Phase C6.2 — new clusters. Every trigger below is grounded in the
  // target record's own canonical summary text (verified against
  // lib/build.js's assembled searchIndex before writing, per this
  // checkpoint's Section I discipline) — never copied from an acceptance
  // or evaluation question, and never from the frozen external holdout
  // (not consulted). Hints reuse each record's own real vocabulary.
  // ────────────────────────────────────────────────────────────────────
  {
    // AI-FEAT-011's own summary: "Detects connected storage devices
    // eligible for import: polls for drives, filters by DCIM presence,
    // and recognizes Sony camera folder conventions."
    id: 'source-detection',
    domain: 'Import',
    triggers: [
      'not showing up', "doesn't notice", 'does not notice', 'notice the drive',
      'detect the drive', 'detect the card', 'plugged in', 'connected devices',
      'recognize the folder', 'recognize this source', 'sony camera folder',
    ],
    hints: ['source detection drives dcim sony private'],
  },
  {
    // AI-FEAT-012's own summary: "Activating a source for import, whether
    // a local folder, external drive, or memory card."
    id: 'source-selection',
    domain: 'Import',
    triggers: [
      'pick a folder', 'choose a folder', 'select a folder', 'choose a local drive',
      'pick a source', 'choose a source', 'select a source', 'activate a source',
    ],
    hints: ['source selection local folder external drive'],
  },
  {
    // AI-FEAT-019's own summary: "Processes grouped files and copies them
    // into the archive structure." Covers RAW/JPEG/video-handling
    // paraphrases — no record specifically singles out RAW vs JPEG, so
    // this correctly routes to the general copy-engine record rather than
    // inventing a format-specific one.
    id: 'raw-jpeg-video-handling',
    domain: 'Import',
    triggers: [
      'raw files', 'raw file', 'jpeg files', 'camera-native', 'camera native',
      'video clips', 'video files', 'treated differently', 'special handling',
      'copied any differently',
    ],
    hints: ['import pipeline copy engine processes grouped files'],
  },
  {
    // AI-FEAT-017's own summary: "Assigns selected files into logical
    // groups mapped to sub-events."
    id: 'grouping',
    domain: 'Import',
    triggers: [
      'split them apart', 'separate one photographer', "separate a photographer",
      // 'sub-event' alone REMOVED (found during C6.1-corpus regression
      // testing): too generic on its own — it's also core vocabulary for
      // event-component-routing (a DIFFERENT concept about where the
      // resulting folder ends up, not how files get assigned to groups in
      // the first place) and collided with it on a real regression case.
      'sort files into groups', 'sort files into their sub-event',
      'assign files to groups', 'logical groups', 'undo a group', 'group assignment',
    ],
    hints: ['grouping system assigns files logical groups sub-events'],
  },
  {
    // AI-FEAT-022's own summary: "Resolves the photographer-level folder
    // within an event's directory structure."
    id: 'photographer-routing',
    domain: 'Import',
    triggers: [
      "photographer's folder", 'photographer folder', "photographer's name folder",
      'which photographer', 'photographer-level folder',
    ],
    hints: ['photographer folder sequencing'],
  },
  {
    // AI-FEAT-018's own summary: "Derives archive folder paths purely
    // from event.json... Single-component events route to
    // Collection/Event/Photographer/."
    id: 'event-component-routing',
    domain: 'Import',
    triggers: [
      'folder path', 'end up at', 'own folder inside the archive',
      'folder structure', 'component gets its own folder',
    ],
    hints: ['event component import routing folder paths'],
  },
  {
    // AI-FEAT-020's own classification: Duplicate Detection is its own
    // top-level implemented feature.
    id: 'duplicate-detection',
    domain: 'Import',
    triggers: [
      'same photo copied in twice', 'copied in twice', 'duplicate photo',
      'catch it if the exact same', 'same file exists at the destination',
      'copied in by accident',
    ],
    hints: ['duplicate detection'],
  },
  {
    // AI-FEAT-025's own summary: "Two distinct, real, hash-based
    // verification mechanisms... Named Checksum-Based specifically..."
    id: 'checksum-verification',
    domain: 'Archive Management',
    triggers: [
      'file hash', 'made it across intact', "wasn't corrupted", 'was not corrupted',
      'file actually safe', 'not damaged', 'confirm nothing is missing or broken',
      'confirm nothing got damaged',
    ],
    hints: ['checksum-based file verification hash'],
  },
  {
    // AI-FEAT-028's own summary: "Each audit entry in imports[] records
    // source: {type, label, path} identifying which memory card, external
    // drive, or local folder was used."
    id: 'source-attribution',
    domain: 'Import',
    // 'which memory card' narrowed (found during full regression testing:
    // after 'which' was added to GENERIC_DOMAIN_WORDS — see that list's
    // own comment — this trigger collapsed to just {memory, card}, far too
    // generic; it fired on ANY plain import question mentioning a memory
    // card, not only genuine attribution/tracing questions).
    triggers: [
      'which memory card was used', 'which drive a given photo', 'trace a photo back',
      'originally came from', 'record of which card',
    ],
    hints: ['import source attribution which card drive folder'],
  },
  {
    // AI-FEAT-014's own summary domain: thumbnail generation/caching;
    // AI-FEAT-015: media preview.
    id: 'thumbnails-preview',
    domain: 'Media',
    triggers: [
      'look at the photos before', 'preview images', 'small preview',
      'preview before they get copied', 'thumbnail',
    ],
    hints: ['thumbnail generation caching media preview'],
  },
  {
    // AI-FEAT-013's own title/domain: File Browser & Media Grid/List Viewing.
    id: 'file-browser',
    domain: 'Media',
    triggers: [
      'grid instead of a list', 'browse through everything', 'media grid',
      'look through everything already in a folder',
    ],
    hints: ['file browser media grid list viewing'],
  },
  {
    // AI-FEAT-021's own domain: no-overwrite/atomic-transaction guarantee
    // during import.
    id: 'atomic-import-safety',
    domain: 'Import',
    triggers: [
      'crashes in the middle of copying', 'half an import', 'crash during import',
      'partial import', 'interrupted mid-import',
    ],
    hints: ['atomic import transaction crash recovery'],
  },
  {
    // AI-FEAT-029's own summary: "The single shared engine and resolver
    // that every metadata writer in the app consumes."
    id: 'metadata-writing',
    domain: 'Metadata',
    triggers: [
      'keyword tags', 'tags that end up baked into', 'shared engine responsible for writing tags',
      'where do those actually come from', 'metadata gets written',
    ],
    hints: ['metadata writing engine shared resolver'],
  },
  {
    // AI-FEAT-032's own summary: "Read-only, post-hoc verification for
    // files that landed via copy-only paths... where the copy step itself
    // never checked metadata correctness."
    id: 'metadata-verification',
    domain: 'Metadata',
    triggers: [
      'tags actually got written correctly', 'confidence that the tags',
      'metadata correctness', 'post-hoc verification',
    ],
    hints: ['metadata verification read-only post-hoc'],
  },
  {
    // AI-FEAT-034's own title: Metadata Management Modal — the operator
    // UI surface for reviewing metadata issues.
    id: 'metadata-management-ui',
    domain: 'Metadata',
    triggers: [
      'review metadata problems', 'where in the app do i go to review metadata',
      'metadata management',
    ],
    hints: ['metadata management modal'],
  },
  {
    // AI-WF-002/AI-FEAT-009's own summary language: Collection -> Event ->
    // Components; "Establishes the event context."
    id: 'event-create-extended',
    domain: 'Events',
    triggers: [
      'brand new shoot', 'brand-new archival record', 'first screen for beginning',
      'fresh archive entry', 'establish an event',
    ],
    hints: ['create new event collection components'],
  },
  {
    // AI-FEAT-010's own summary: "Selecting an existing event, editing it
    // safely." Distinct from Event Creation.
    id: 'event-edit-extended',
    domain: 'Events',
    triggers: [
      'got the location wrong', 'correct it after the fact', 'fix the details on a shoot',
      'field is wrong', 'correcting it', 'tidy up an event',
    ],
    hints: ['event management editing selecting existing event'],
  },
  {
    // AI-WF-003/AI-FEAT-023's own summary: "Simple, destination-based
    // copying without setting up an event first."
    id: 'quick-import-extended',
    domain: 'Import',
    triggers: [
      'dump a handful of files', 'without building out a whole event',
      'faster path than the full import wizard', 'lightweight copy mode',
      'skips the usual event setup',
    ],
    hints: ['quick import destination-based copying without event setup'],
  },
  {
    // AI-FEAT-002's own summary: "Operator identity for AutoIngest... a
    // dedicated splash screen for login/profile selection."
    id: 'login-operator',
    domain: 'Application',
    triggers: [
      'which person is currently doing', 'operator profile', 'switch which operator',
      'who is currently doing the importing', 'active profile',
    ],
    hints: ['login operator identity profile selection'],
  },
  {
    // AI-FEAT-005's own domain: application settings/configuration store.
    id: 'settings-persistence',
    domain: 'Application',
    triggers: [
      'preferences carry over', 'remember my settings', 'settings between sessions',
    ],
    hints: ['application settings configuration store'],
  },
  {
    // AI-FEAT-042's own summary: "Configuration and automatic resolution
    // of AutoIngest's four storage roots."
    id: 'archive-root-config',
    domain: 'Archive Management',
    triggers: [
      'which server or nas', 'permanent archive', 'working drive i use day-to-day',
      'storage roots', 'permanent office server',
    ],
    hints: ['archive root configuration resolution storage roots'],
  },
  {
    // AI-FEAT-043's own summary: "Four read-only reporting and audit
    // surfaces giving operators visibility into archive health."
    id: 'archive-health',
    domain: 'Archive Management',
    triggers: [
      'checks the archive for missing', 'overall picture of how healthy',
      'confirm nothing is missing after', 'archive health', 'consistency report',
    ],
    hints: ['archive health reporting consistency completeness diagnostics'],
  },
  {
    // AI-FEAT-049's own summary: "Planned archive-maintenance capability
    // — the next roadmap milestone after the completed AI-RM-001."
    id: 'archive-maintenance-extended',
    domain: 'Archive Management',
    triggers: [
      'bigger cleanup pass', 'beyond fixing metadata', 'planned for the whole archive',
    ],
    hints: ['archive maintenance planned roadmap milestone'],
  },
  {
    // AI-FEAT-053's own domain: natural-language search across the
    // archive/knowledge base.
    id: 'global-search',
    domain: 'Application',
    triggers: [
      'plain-language question', 'search across the whole archive',
      'look something up across every event', 'single box where i can look something up',
    ],
    hints: ['global search plain language query'],
  },
  {
    // AI-FEAT-051's own domain: planned full-archive browsing.
    id: 'archive-browser',
    domain: 'Archive Management',
    triggers: [
      'browse through everything already sitting in the archive', 'proper viewer',
      'browse already-archived material',
    ],
    hints: ['archive browser full-archive browsing planned'],
  },
  {
    // AI-WF-009/AI-FEAT-039's own summary: "Consolidates content from a
    // Transfer Drive into the Main Archive Root."
    id: 'transfer-import',
    domain: 'Transfer & Backup',
    triggers: [
      'physically arrives at the office', 'merging content from a portable drive',
      'consolidate content from a transfer drive', 'merge back into the main archive',
    ],
    hints: ['transfer import consolidates main archive root'],
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
  // Merge-readiness pass — "Team Live" is the actual operator-facing UI
  // toggle name for this feature (AI-WF-006: "Team Live must be enabled
  // first"), not just internal documentation shorthand for "Online
  // Registry"/"relay". Operator acceptance testing (asking naturally,
  // not in developer/documentation vocabulary) found several Registry
  // boundary questions phrased with "Team Live" instead of "registry"/
  // "relay" fell through to a generic strong match instead of the correct
  // boundary. Added "team live" phrasing alongside the existing
  // registry/relay phrasing wherever it was missing — widening recall for
  // the SAME already-evidenced exclusions, never a new one.
  {
    id: 'registry-media-storage',
    boundaryId: 'registry-media-storage',
    triggers: [
      'does the registry store', 'registry store my photo', 'registry hold my photo',
      'see my photos over the network', 'relay store my photo', 'relay transmit my photo',
      'photos pass through the relay', 'photos go through the relay', 'upload to the registry',
      'uploaded somewhere', 'being uploaded', 'photos uploaded to the relay',
      'photos get sent through', 'photos sent through', 'through the team live server',
      'sent through the team live', 'send my photos', 'photos through team live',
      'copy their photos to me', 'copy photos to me', 'send me their photos',
      'copy the photos', 'copy the photographs', 'sync the photos',
      'automatically sync the photos', 'sync photos too',
    ],
  },
  {
    id: 'registry-source-of-truth',
    boundaryId: 'registry-not-source-of-truth',
    triggers: [
      'registry replace the archive', 'replace the archive as', 'registry the source of truth',
      'registry become the source of truth', 'source of truth instead of the archive',
      'registry replaces event.json', 'registry replace event.json',
      'basically my archive', 'registry basically', 'team live basically',
      'is the registry my archive', 'is team live my archive',
      'registry replace the nas', 'registry replace my nas', 'replace the nas',
      'sharing the same storage', 'share the same storage', 'same physical storage',
      'shared physical storage',
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
      'get warned if', 'warned if my', 'tell me about conflicts', 'conflicts with other operators',
      'conflicts with another operator', 'know about a conflict',
    ],
  },
  {
    id: 'registry-activity-scope',
    boundaryId: 'registry-activity-scope',
    // Part 3 Phase 4.2 (Decision 1) — 'qmz sorting isn't showing up' and
    // 'metadata audit isn't showing up' added below. Recall improvement
    // (audit R16), deliberately kept anchored to 'qmz'/'metadata audit'
    // context rather than a bare 'isn't showing up in the activity feed'
    // phrase — Import/Transfer activity legitimately DOES publish per this
    // same boundary's own definition, so an unanchored phrase would
    // incorrectly block a genuine "why isn't my import showing up" question
    // instead of only the QMZ/metadata-audit cases this boundary actually
    // excludes. Verified corpus-wide before being added, not assumed safe.
    triggers: [
      'show up as activity', 'visible to other operators', 'see qmz activity',
      'see metadata activity', 'audit activity show up', 'qmz sorting show up',
      "qmz sorting isn't showing up", "metadata audit isn't showing up",
    ],
  },
  {
    id: 'registry-presence-not-activity',
    boundaryId: 'registry-presence-not-activity',
    triggers: [
      'are they editing my files', 'does presence mean', 'presence mean they',
      'presence mean someone', 'stop me from also working', 'stop you from also working',
      'actively working on my files', 'actively working on', 'are they actively',
      'block me from working on the same', 'prevent me from working on the same',
    ],
  },
];

// Domain-generic words excluded from the token-set fallback ONLY (never
// from the exact-substring check above it, which stays untouched). Found
// necessary during full 165-question regression testing — three separate,
// real regressions traced to the same shape of defect: a multi-word
// trigger reduces, after tokenizing, to just two individually-ubiquitous
// words that coincidentally co-occur in an unrelated question:
//   - 'update autoingest' -> {update, autoingest} matched "Will AutoIngest
//     overwrite my archive if I run an update?" (autoingest is the
//     product's own name — appears in nearly every question regardless
//     of topic).
//   - 'metadata wrong' -> {metadata, wrong} matched "What went WRONG with
//     the same-size skip and METADATA verification?" (fixed by making
//     that specific trigger more contextual instead — logged here as the
//     general-word list only covers cross-cluster-wide generic terms).
//   - 'what event is' -> {what, event} matched "What is Event Management
//     and Editing?" ('event' is core, near-universal AutoIngest
//     vocabulary; 'what' is a bare question word with zero topic signal
//     on its own).
// This list is deliberately small and reserved for words this specific,
// concrete evidence showed are unsafe as a 2-token fuzzy-match signal —
// not a general stopword list, and every exact-substring trigger using
// these words is completely unaffected.
const GENERIC_DOMAIN_WORDS = new Set(['autoingest', 'app', 'application', 'what', 'event', 'who', 'which']);

function tokenize(s) {
  return String(s).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
}

// See this file's own header comment (Phase C6.2) for the full rationale.
function triggerMatches(questionLower, trigger) {
  if (questionLower.includes(trigger)) return true;
  const tTokens = tokenize(trigger).filter((t) => !GENERIC_DOMAIN_WORDS.has(t));
  if (tTokens.length < 2) return false;
  const qTokens = new Set(tokenize(questionLower));
  return tTokens.every((t) => qTokens.has(t));
}

function findConcept(questionLower) {
  for (const c of CONCEPT_CLUSTERS) {
    for (const t of c.triggers) {
      if (triggerMatches(questionLower, t)) return c;
    }
  }
  return null;
}

// Phase C6.2 — returns EVERY matching cluster, not just the first. FORENSIC
// FINDING: a real question can genuinely, legitimately match more than one
// cluster's triggers at once (e.g. "portable drive" is real vocabulary
// shared between transfer-export and transfer-import contexts) — with only
// the first-array-order match's hint injected, the correct concept could
// silently lose to whichever cluster merely happened to be declared
// earlier in CONCEPT_CLUSTERS, an authoring-order coincidence with no
// relevance signal behind it. Returning all matches and letting every
// hint compete through the SAME unmodified lib/query.js ranker (exactly
// as a single hint already did) fixes this without inventing a second
// ranking mechanism — the scorer, not cluster order, decides which
// concept's hint actually wins.
function findAllConcepts(questionLower) {
  const matched = [];
  for (const c of CONCEPT_CLUSTERS) {
    for (const t of c.triggers) {
      if (triggerMatches(questionLower, t)) {
        matched.push(c);
        break;
      }
    }
  }
  return matched;
}

// Returns a matched boundary-widening trigger's underlying boundaryId (from
// lib/statusResolution.js's KNOWN_BOUNDARIES), or null. Deliberately
// separate from findConcept — this function's only job is widening
// recognition of an ALREADY-evidenced exclusion, never inventing one.
// Phase C6.2 REGRESSION FINDING: deliberately stays on exact-substring
// matching ONLY (questionLower.includes(t)) — does NOT use triggerMatches'
// token-set fallback, unlike findConcept above. Found during regression
// testing: several existing boundary triggers (e.g. 'is the registry my
// archive') reduce, after short-word filtering, to just two individually
// generic content words ({registry, archive}) that co-occur in almost
// any reasonable question comparing the two — fuzzy-matched a real
// question ("How does archive locking differ from the Online Registry?")
// into a false NOT_SUPPORTED exclusion, converting a correct AVAILABLE
// answer into an incorrect denial. A boundary is a safety-critical
// exclusion; a false positive here is far more costly than in an ordinary
// concept hint (which only adds a candidate query, never denies a
// capability), so boundaries keep the stricter, pre-C6.2 matching
// discipline. Regular concept clusters are unaffected by this reversion.
function findBoundaryConcept(questionLower) {
  for (const c of BOUNDARY_CONCEPT_CLUSTERS) {
    for (const t of c.triggers) {
      if (questionLower.includes(t)) return c.boundaryId;
    }
  }
  return null;
}

module.exports = { CONCEPT_CLUSTERS, BOUNDARY_CONCEPT_CLUSTERS, findConcept, findAllConcepts, findBoundaryConcept, triggerMatches };
