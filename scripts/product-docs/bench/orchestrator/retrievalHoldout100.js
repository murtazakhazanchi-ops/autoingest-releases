'use strict';
// Ask AutoIngest — Stage 1 deterministic retrieval foundation, Section 19.
// INDEPENDENT retrieval holdout, authored AFTER the production retrieval
// module (lib/askRetrieval/) was frozen and after retrieval250 (the
// development benchmark used throughout implementation) was last consulted
// for tuning. Every query below is new -- none overlaps retrieval250's own
// 252 queries -- and every `expect` id was manually verified directly
// against the real canonical Knowledge Base summaries pulled from
// build.assemble() output (see bench/results/retrieval-stage1-holdout100.json
// for the run this benchmark produced; this file itself is run ONCE and
// not tuned afterward, per Section 19's explicit instruction).
//
// Style tags (same convention as retrieval250.js): 'direct' (title/near-
// title words present), 'paraphrase' (natural rephrasing, no title
// words), 'indirect' (deliberately hard, operator-voice, minimal keyword
// overlap), 'cross-feature' (deliberately worded to be confusable between
// two or more real, canonically-documented-as-distinct concepts), 'thin'
// (targets one of the 8 canonical Planned/no-architecture-finalized
// records), 'no-answer' (nothing in the KB should satisfy this).
// `containsTitle` is computed mechanically by the scoring script, not
// self-reported, exactly as retrieval250 does it.
//
// Coverage target (Section 19's own required minimums, over the ~100
// scored -- i.e. non-"no-answer" -- queries): >=30% without canonical
// title, >=30% paraphrase/indirect, >=10% difficult cross-feature
// wording, >=10% thin/roadmap knowledge, exactly 10 deliberate no-answer
// queries. Categories may overlap (a query can be both 'indirect' and
// 'thin', for example).

module.exports = [
  // ===================== Application Platform =====================
  { id: 'H001', q: 'Can the renderer process reach Node.js APIs directly?', expect: ['AI-FEAT-001'], style: 'indirect' },
  { id: 'H002', q: 'Which screen shows up briefly before the main window while the app decides who is logged in?', expect: ['AI-FEAT-002'], style: 'indirect' },
  { id: 'H003', q: 'Is the source-mode toggle (Event vs Quick) on the very first screen after login?', expect: ['AI-FEAT-003'], style: 'paraphrase' },
  { id: 'H004', q: 'What single file is the ultimate source of truth for a given event\'s structure and import history?', expect: ['AI-FEAT-004'], style: 'indirect' },
  { id: 'H005', q: 'Where do general app preferences live that are not scoped to any particular event?', expect: ['AI-FEAT-005'], style: 'paraphrase' },
  { id: 'H006', q: 'How often does the app poll GitHub Releases for a newer build after it has already checked once at launch?', expect: ['AI-FEAT-006'], style: 'indirect' },
  { id: 'H007', q: 'Is any anonymous crash or usage data ever sent off this machine, and can it be turned off?', expect: ['AI-FEAT-007'], style: 'paraphrase' },
  { id: 'H008', q: 'Do all the modals and buttons across different screens share one consistent visual language?', expect: ['AI-FEAT-008'], style: 'paraphrase' },

  // ===================== Event Management =====================
  { id: 'H009', q: 'What wizard walks an operator through Collection, EventType, Location, City, and Country before an event exists?', expect: ['AI-FEAT-009'], style: 'indirect' },
  { id: 'H010', q: 'If I made a mistake in an event\'s details, can I fix it after the event already exists, without deleting it?', expect: ['AI-FEAT-010'], style: 'indirect' },

  // ===================== Source Acquisition =====================
  { id: 'H011', q: 'How does the software tell a Sony camera\'s memory card apart from a generic USB drive by folder layout?', expect: ['AI-FEAT-011'], style: 'indirect' },
  { id: 'H012', q: 'Once a drive is detected, what lets the operator actually pick it as the thing to import from?', expect: ['AI-FEAT-012'], style: 'cross-feature' },

  // ===================== Media Browsing =====================
  { id: 'H013', q: 'Before importing, can files be seen split into RAW, Images, and Video sections with a grid/list switch?', expect: ['AI-FEAT-013'], style: 'paraphrase' },
  { id: 'H014', q: 'Are there two separate caching pipelines, one for still images and a different one for extracting video frames?', expect: ['AI-FEAT-014'], style: 'paraphrase' },
  { id: 'H015', q: 'What happens when I hit the space bar on a highlighted file in the browsing grid?', expect: ['AI-FEAT-015'], style: 'indirect' },
  { id: 'H016', q: 'If I click a file just to preview it, does that also mark it as selected for import?', expect: ['AI-FEAT-016'], style: 'cross-feature' },

  // ===================== Grouping and Routing =====================
  { id: 'H017', q: 'How are individual files assigned into the sub-events they belong to before import runs?', expect: ['AI-FEAT-017'], style: 'indirect' },
  { id: 'H018', q: 'For an event with more than one photographer/component, how is the destination archive path actually computed?', expect: ['AI-FEAT-018'], style: 'indirect' },

  // ===================== Import and Archive Writing =====================
  { id: 'H019', q: 'What actually performs the file copy from source into the archive folder structure once grouping is done?', expect: ['AI-FEAT-019'], style: 'indirect' },
  { id: 'H020', q: 'If the exact same file is imported twice, does it get skipped, or renamed as a second copy?', expect: ['AI-FEAT-020'], style: 'paraphrase' },
  { id: 'H021', q: 'Is the event.json update for a completed import written in a single all-or-nothing step, or could it be left half-written?', expect: ['AI-FEAT-021'], style: 'indirect' },
  { id: 'H022', q: 'Within an event\'s folder tree, what determines the specific sub-folder a given photographer\'s files land in?', expect: ['AI-FEAT-022'], style: 'cross-feature' },
  { id: 'H023', q: 'Is there a way to copy files to a destination without first setting up a full event?', expect: ['AI-FEAT-023'], style: 'paraphrase' },
  { id: 'H024', q: 'After a successful, fully-verified import, can the originals be removed from the memory card automatically?', expect: ['AI-FEAT-024'], style: 'paraphrase' },
  { id: 'H025', q: 'What guarantees that a copied file on the archive side is byte-identical to the source, using hashing?', expect: ['AI-FEAT-025'], style: 'cross-feature' },
  { id: 'H026', q: 'Is there a button that just compares expected vs. actual file counts for an event, without hashing anything?', expect: ['AI-FEAT-026'], style: 'cross-feature' },
  { id: 'H027', q: 'Where can I see a chronological history of every import that has ever happened for a given event?', expect: ['AI-FEAT-027'], style: 'indirect' },
  { id: 'H028', q: 'For a past import, how would I find out which specific memory card or folder the files came from?', expect: ['AI-FEAT-028'], style: 'cross-feature' },

  // ===================== Metadata =====================
  { id: 'H029', q: 'Is there one shared code path that every metadata-writing feature (Standard Import, QMZ, Reapply, Repair) goes through?', expect: ['AI-FEAT-029'], style: 'indirect' },
  { id: 'H030', q: 'If the app is force-killed mid-way through writing a batch of metadata, is that batch lost or recoverable on relaunch?', expect: ['AI-FEAT-030'], style: 'indirect' },
  { id: 'H031', q: 'Is an event\'s metadata-completion status stored as a flag that could go stale, or recomputed fresh every time?', expect: ['AI-FEAT-031'], style: 'indirect' },
  { id: 'H032', q: 'For files that were only ever copied (never had metadata written at copy time), is there a read-only check for correctness after the fact?', expect: ['AI-FEAT-032'], style: 'cross-feature' },
  { id: 'H033', q: 'Is there an archive-wide scan that can find and fix drifted metadata across many events, not just one?', expect: ['AI-FEAT-033'], style: 'cross-feature' },
  { id: 'H034', q: 'Were three separate metadata screens merged into a single tabbed dialog at some point?', expect: ['AI-FEAT-034'], style: 'paraphrase' },
  { id: 'H035', q: 'Does the dashboard tile for metadata reflect the real, derived state of the archive rather than a hardcoded status?', expect: ['AI-FEAT-035'], style: 'paraphrase' },
  { id: 'H036', q: 'Where do the controlled lists of valid keywords, cities, event types, and photographer names come from?', expect: ['AI-FEAT-036'], style: 'indirect' },
  { id: 'H037', q: 'If I correct an event\'s City or Country after files are already imported, do the already-imported files get their metadata synced too?', expect: ['AI-FEAT-037'], style: 'indirect' },

  // ===================== Transfer and Backup =====================
  { id: 'H038', q: 'How would a photographer physically move a set of finished events from a field NAS to the main office server using a portable drive?', expect: ['AI-FEAT-038'], style: 'indirect' },
  { id: 'H039', q: 'Bringing files from a transfer drive into the main office archive without creating duplicates if it\'s already been done once — what handles that?', expect: ['AI-FEAT-039'], style: 'indirect' },
  { id: 'H040', q: 'Is there a transfer mode that scans a drive for what changed since last time, and strictly never overwrites or renames anything?', expect: ['AI-FEAT-040'], style: 'cross-feature' },
  { id: 'H041', q: 'Can a transfer export or import keep running in the background instead of blocking the whole app with a modal?', expect: ['AI-FEAT-041'], style: 'paraphrase' },

  // ===================== Archive Operations =====================
  { id: 'H042', q: 'What automatically figures out which of the app\'s several storage roots (NAS, SSD, office server, transfer drive) is currently in play?', expect: ['AI-FEAT-042'], style: 'indirect' },
  { id: 'H043', q: 'Are there read-only dashboards that report on archive completeness and consistency without changing anything?', expect: ['AI-FEAT-043'], style: 'paraphrase' },
  { id: 'H044', q: 'If I import locally to my laptop SSD first, what quietly moves those files over to the shared archive later?', expect: ['AI-FEAT-044'], style: 'indirect' },
  { id: 'H045', q: 'What prevents two people from importing into the very same event folder for the same photographer at the same time?', expect: ['AI-FEAT-045'], style: 'cross-feature' },
  { id: 'H046', q: 'If a folder was created by hand outside the app but I want AutoIngest to start tracking it as a real event, is that possible?', expect: ['AI-FEAT-046'], style: 'indirect' },

  // ===================== Special Workflows =====================
  { id: 'H047', q: 'What does "QMZ" stand for, and what kind of numbered sequence codes does its sequencing workspace produce?', expect: ['AI-FEAT-047'], style: 'direct' },
  { id: 'H048', q: 'Is there a live view of which teammates are currently online and what event/slot each of them is working in?', expect: ['AI-FEAT-048'], style: 'cross-feature' },

  // ===================== Planned / thin roadmap records =====================
  { id: 'H049', q: 'What comes right after Metadata Audit & Repair on the archive-maintenance roadmap, even though it has no finalized design yet?', expect: ['AI-FEAT-049'], style: 'thin' },
  { id: 'H050', q: 'Is there a planned capability for maintaining a single event over time, separate from whole-archive maintenance?', expect: ['AI-FEAT-050'], style: 'thin' },
  { id: 'H051', q: 'Has a browsing UI for the entire archive (not just one event at a time) been designed yet, or is it still just a roadmap placeholder?', expect: ['AI-FEAT-051'], style: 'thin' },
  { id: 'H052', q: 'What unfinalized roadmap item would eventually let the diagnostics layer not just report problems but actually fix them automatically?', expect: ['AI-FEAT-052'], style: 'thin' },
  { id: 'H053', q: 'Is "Ask the Archive" natural-language photo search a real shipped feature, or a future vision with no architecture decided?', expect: ['AI-FEAT-053'], style: 'thin' },
  { id: 'H054', q: 'Beyond the single-import checksum that already exists, is there a planned scheduled integrity check across the whole archive?', expect: ['AI-FEAT-054'], style: 'thin' },
  { id: 'H055', q: 'Is there a roadmap item for archive-wide analytics/reporting, positioned right before the AI intelligence milestone?', expect: ['AI-FEAT-055'], style: 'thin' },
  { id: 'H056', q: 'What is the single furthest-out, least-scoped item at the very end of the entire feature roadmap?', expect: ['AI-FEAT-056'], style: 'thin' },

  // ===================== Release / Knowledge =====================
  { id: 'H057', q: 'Are there three separate, isolated release tracks — one for internal engineering, one for opt-in testers, and one for everyone else?', expect: ['AI-FEAT-057'], style: 'paraphrase' },
  { id: 'H058', q: 'Is there a deterministic, offline documentation search system this help feature is built on top of, rather than a hosted AI service?', expect: ['AI-FEAT-058'], style: 'indirect' },

  // ===================== Workflows =====================
  { id: 'H059', q: 'What is the end-to-end process for getting photos off a camera card and into the right place in the archive?', expect: ['AI-WF-001'], style: 'indirect' },
  { id: 'H060', q: 'Before any files can be routed anywhere, what has to be set up first — Collection, Event, and Components?', expect: ['AI-WF-002'], style: 'indirect' },
  { id: 'H061', q: 'What is the simplest way to copy a handful of files to a destination without first building out an event structure?', expect: ['AI-WF-003'], style: 'indirect' },
  { id: 'H062', q: 'If metadata drifted across the archive, what is the process to find and fix it without touching the original imported copies?', expect: ['AI-WF-004'], style: 'indirect' },
  { id: 'H063', q: 'What is the process for physically moving finished events onto a portable drive, or checking what has changed on one already in use?', expect: ['AI-WF-005'], style: 'cross-feature' },
  { id: 'H064', q: 'How would a photographer working from a different physical site, with no shared NAS access, know whether a teammate is already active on the same event?', expect: ['AI-WF-006'], style: 'indirect' },
  { id: 'H065', q: 'What is the process for turning a batch of QMZ event photos into the 01Q/02M-style numbered sequence codes?', expect: ['AI-WF-007'], style: 'direct' },
  { id: 'H066', q: 'If a photographer-folder import lock looks stuck, what is the recovery process, and how is it different from the Online Registry\'s own coordination mechanism?', expect: ['AI-WF-008'], style: 'cross-feature' },
  { id: 'H067', q: 'What is the process for bringing a transfer drive\'s contents into the main office archive and matching them to existing events rather than duplicating?', expect: ['AI-WF-009'], style: 'indirect' },

  // ===================== Additional paraphrase/indirect coverage (breadth pass) =====================
  { id: 'H068', q: 'Does the app run any part of its own UI as plain HTML with unrestricted access to the filesystem?', expect: ['AI-FEAT-001'], style: 'indirect' },
  { id: 'H069', q: 'Can more than one saved operator profile exist, and does the app remember which one was last used?', expect: ['AI-FEAT-002'], style: 'indirect' },
  { id: 'H070', q: 'Is the dashboard allowed to show a number that isn\'t actually backed by event.json or real system state?', expect: ['AI-FEAT-003'], style: 'indirect' },
  { id: 'H071', q: 'If two different parts of the UI both need to know an event\'s import status, do they read from two different sources or one?', expect: ['AI-FEAT-004'], style: 'indirect' },
  { id: 'H072', q: 'Does changing a general app preference affect just the currently open event, or every event going forward?', expect: ['AI-FEAT-005'], style: 'indirect' },
  { id: 'H073', q: 'Can the app install a downloaded update on its own, without the operator clicking anything?', expect: ['AI-FEAT-006'], style: 'indirect' },
  { id: 'H074', q: 'Which other internal system does the telemetry pipeline feed data to, if any?', expect: ['AI-FEAT-007'], style: 'indirect' },
  { id: 'H075', q: 'Are icons throughout the app raster images (PNG/JPG) or vector-based?', expect: ['AI-FEAT-008'], style: 'indirect' },
  { id: 'H076', q: 'Does the Event Creator show a preview of the final folder structure before the event is actually created?', expect: ['AI-FEAT-009'], style: 'indirect' },
  { id: 'H077', q: 'Does editing an existing event share the exact same UI module as creating a brand-new one?', expect: ['AI-FEAT-010'], style: 'cross-feature' },
  { id: 'H078', q: 'What two folder markers does the app look for to recognize photo vs. video content on a Sony-style card?', expect: ['AI-FEAT-011'], style: 'indirect' },
  { id: 'H079', q: 'Were "Local Folder Source Selection" and "External Drive Source Selection" ever tracked as two separate registry entries before being merged?', expect: ['AI-FEAT-012'], style: 'indirect' },
  { id: 'H080', q: 'Does the pre-import file browser reflect grouping state from a shared manager, or maintain its own separate copy?', expect: ['AI-FEAT-013'], style: 'indirect' },
  { id: 'H081', q: 'Does the video thumbnail pipeline overlay any visual indicator showing it\'s a playable clip?', expect: ['AI-FEAT-014'], style: 'indirect' },
  { id: 'H082', q: 'For a RAW file, does the full-screen preview show the actual raw pixel data or an extracted preview image?', expect: ['AI-FEAT-015'], style: 'indirect' },
  { id: 'H083', q: 'Is there a separate variable tracking "the last thing clicked" from the set of files checked for import?', expect: ['AI-FEAT-016'], style: 'indirect' },
  { id: 'H084', q: 'If the active event changes, does the file-to-subevent grouping state get wiped and start over?', expect: ['AI-FEAT-017'], style: 'indirect' },
  { id: 'H085', q: 'Is the destination folder path for an import computed live during the copy, or derived entirely beforehand from event.json?', expect: ['AI-FEAT-018'], style: 'indirect' },
  { id: 'H086', q: 'Is there ever a case where importing the same file twice results in the original archive copy being overwritten?', expect: ['AI-FEAT-019'], style: 'indirect' },
  { id: 'H087', q: 'What is the exact main-process module responsible for copying grouped files into the archive?', expect: ['AI-FEAT-019'], style: 'indirect' },
  { id: 'H088', q: 'Can a Quick Import batch later show up under Metadata Audit & Repair\'s coverage?', expect: ['AI-FEAT-023'], style: 'cross-feature' },
  { id: 'H089', q: 'How many distinct validation steps must pass before a source file is allowed to be deleted after import?', expect: ['AI-FEAT-024'], style: 'indirect' },
  { id: 'H090', q: 'Do the import-batch checksum and the Local-First sync-job checksum use the same underlying hashing function?', expect: ['AI-FEAT-025'], style: 'indirect' },
  { id: 'H091', q: 'What color status indicator appears in the Activity Log when an issue is detected during a count-based verification?', expect: ['AI-FEAT-026'], style: 'indirect' },
  { id: 'H092', q: 'Does the Activity Log group entries by session, or strictly by calendar date?', expect: ['AI-FEAT-027'], style: 'indirect' },
  { id: 'H093', q: 'Is source attribution recorded per-file, or once for the whole import batch?', expect: ['AI-FEAT-028'], style: 'indirect' },
  { id: 'H094', q: 'Does crash-recovery resume use its own separate metadata-writing code, or the same engine as a fresh import?', expect: ['AI-FEAT-029'], style: 'cross-feature' },
  { id: 'H095', q: 'Under which userData subfolder does the metadata queue persist batches to survive a crash?', expect: ['AI-FEAT-030'], style: 'indirect' },
  { id: 'H096', q: 'Could an event\'s metadata-completion state ever be left stale because a callback failed to update it?', expect: ['AI-FEAT-031'], style: 'indirect' },
  { id: 'H097', q: 'Does Metadata Verification ever write or repair anything itself, or only report on correctness?', expect: ['AI-FEAT-032'], style: 'indirect' },
  { id: 'H098', q: 'Can an archive-wide metadata audit be paused partway through and resumed later, or must it always run start to finish?', expect: ['AI-FEAT-033'], style: 'indirect' },
  { id: 'H099', q: 'Is the metadata modal\'s consolidation into a single tabbed dialog described as a functional bug fix or a UX/design decision?', expect: ['AI-FEAT-034'], style: 'indirect' },
  { id: 'H100', q: 'Before it became a "truthful Health card," was the dashboard\'s metadata tile just a simple status indicator?', expect: ['AI-FEAT-035'], style: 'indirect' },
  { id: 'H101', q: 'Does the keyword registry cover photographer names in addition to keywords, cities, and event types?', expect: ['AI-FEAT-036'], style: 'indirect' },
  { id: 'H102', q: 'What specifically triggers a need to re-sync metadata across files that were already imported?', expect: ['AI-FEAT-037'], style: 'indirect' },
  { id: 'H103', q: 'Does Transfer Export mutate anything on the Active Archive Root it\'s exporting from, or only write to the destination drive?', expect: ['AI-FEAT-038'], style: 'indirect' },
  { id: 'H104', q: 'If the same transfer drive is imported a second time, are the files duplicated in the Main Archive Root?', expect: ['AI-FEAT-039'], style: 'indirect' },
  { id: 'H105', q: 'Does the app ever create renamed "_1"/"_2" copies during a backup-update-mode scan?', expect: ['AI-FEAT-040'], style: 'indirect' },
  { id: 'H106', q: 'Is background/minimize operation available for a standard Event Import, or only for Transfer Export/Import?', expect: ['AI-FEAT-041'], style: 'indirect' },
  { id: 'H107', q: 'How many distinct storage roots does the archive-root resolution system distinguish between?', expect: ['AI-FEAT-042'], style: 'indirect' },
  { id: 'H108', q: 'Does any of the four archive health reporting surfaces mutate file or service state as a side effect of running?', expect: ['AI-FEAT-043'], style: 'indirect' },
  { id: 'H109', q: 'Is Local-First background sync something the operator manually triggers each time, or does it run automatically in the background?', expect: ['AI-FEAT-044'], style: 'indirect' },
  { id: 'H110', q: 'Are archive write locks scoped per event, or specifically per photographer-folder within an event?', expect: ['AI-FEAT-045'], style: 'indirect' },
  { id: 'H111', q: 'If an adopted archive folder needs to be un-adopted, is that reversible by deleting the event.json AutoIngest wrote?', expect: ['AI-FEAT-046'], style: 'indirect' },
  { id: 'H112', q: 'Does the QMZ sequencing workspace share its state file with standard Event Import, or keep a completely separate one?', expect: ['AI-FEAT-047'], style: 'cross-feature' },
  { id: 'H113', q: 'Is the realtime presence system described as authoritative for locking, or explicitly advisory-only?', expect: ['AI-FEAT-048'], style: 'indirect' },

  // ===================== Additional thin/roadmap coverage (second pass per Planned record) =====================
  { id: 'H124', q: 'Does this feature document invent a scope or architecture for archive maintenance that hasn\'t actually been decided yet?', expect: ['AI-FEAT-049'], style: 'thin' },
  { id: 'H125', q: 'Per explicit product-owner clarification, how does the planned event-level maintenance item relate to the planned archive-wide one?', expect: ['AI-FEAT-050'], style: 'thin' },
  { id: 'H126', q: 'Where does full-archive browsing sit in the roadmap relative to Archive Maintenance and Global Search — before, between, or after both?', expect: ['AI-FEAT-051'], style: 'thin' },
  { id: 'H127', q: 'Does today\'s diagnostics layer already do broad automated repair, or does it only report problems while repair itself remains unbuilt?', expect: ['AI-FEAT-052'], style: 'thin' },
  { id: 'H128', q: 'Is there a still-unbuilt "Ask the Archive" concept meant to parallel Ask AutoIngest, but applied to finding photos instead of documentation?', expect: ['AI-FEAT-053'], style: 'thin' },
  { id: 'H129', q: 'How is the not-yet-built scheduled whole-archive integrity check explicitly scoped differently from the single-import checksum that already ships?', expect: ['AI-FEAT-054'], style: 'thin' },
  { id: 'H130', q: 'Which planned analytics milestone sits between Archive Repair and AI Archive Intelligence on the roadmap, with no design finalized yet?', expect: ['AI-FEAT-055'], style: 'thin' },
  { id: 'H131', q: 'Of every item in the entire feature roadmap, which one is described as the furthest out and least scoped?', expect: ['AI-FEAT-056'], style: 'thin' },

  // ===================== Deliberate no-answer / unknown-capability queries =====================
  { id: 'H114', q: 'Can AutoIngest automatically translate photo captions into other languages?', expect: [], style: 'no-answer' },
  { id: 'H115', q: 'Does AutoIngest offer built-in cloud storage backup to a third-party service like Dropbox or Google Drive?', expect: [], style: 'no-answer' },
  { id: 'H116', q: 'Is there a built-in facial recognition system that automatically tags people in photos?', expect: [], style: 'no-answer' },
  { id: 'H117', q: 'Can operators video-call each other directly from within AutoIngest?', expect: [], style: 'no-answer' },
  { id: 'H118', q: 'Does AutoIngest support printing physical photo albums directly from the archive?', expect: [], style: 'no-answer' },
  { id: 'H119', q: 'Is there a mobile phone app version of AutoIngest for iOS or Android?', expect: [], style: 'no-answer' },
  { id: 'H120', q: 'Can AutoIngest automatically generate a highlight reel video from a set of imported photos?', expect: [], style: 'no-answer' },
  { id: 'H121', q: 'Does AutoIngest have a built-in invoicing or client-billing module for photographers?', expect: [], style: 'no-answer' },
  { id: 'H122', q: 'Can AutoIngest edit or retouch photos (crop, color-correct, remove blemishes) directly within the app?', expect: [], style: 'no-answer' },
  { id: 'H123', q: 'Does AutoIngest support blockchain-based verification of photo authenticity?', expect: [], style: 'no-answer' },
];
