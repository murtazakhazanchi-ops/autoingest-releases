'use strict';

// ASK AUTOINGEST — CHECKPOINT 11, PHASE 11. EXPERIMENTAL. The ONE new
// blind acceptance set for this checkpoint, 42 conversations, written in
// full and hashed BEFORE running against the frozen implementation -- no
// tuning after freeze. Does not reuse wording from devSetC11.js,
// groundingDiagnosticC11.js, Checkpoint 10's finalBlindC10.js, or any
// earlier historical set. At least 25% (11+/42) ask about a subject
// entirely by indirect description, never naming the feature/workflow.
// Roughly a third of the set deliberately covers subjects NEVER involved
// in any Checkpoint 10 failure (Source Detection, Checksum Verification,
// Audit Integrity Verification, Login/Operator Identity, Keyword
// Registry, Metadata Verification, Activity Log, Design System, Source
// Cleanup, Atomic Import Transaction, Photographer-Folder Resolution,
// Metadata Event-State Derivation) -- to test genuine generalization, not
// just whether the two named C10 patterns got patched.

module.exports = [
  // --- indirect (no exact name in the question) ---
  { id: 'X01_indirect', turns: ['What figures out which drive or folder I plugged in before I start an import?'] },
  { id: 'X02_indirect', turns: ['What double-checks that a file actually copied correctly, byte for byte?'] },
  { id: 'X03_indirect', turns: ['What keeps a running log of everything AutoIngest has done recently?'] },
  { id: 'X04_indirect', turns: ["What figures out whose photos these are when there's no explicit photographer field?"] },
  { id: 'X05_indirect', turns: ['What deletes the originals off my memory card once everything is safely copied?'] },
  { id: 'X06_indirect', turns: ['What keeps the visual look of buttons and panels consistent across the app?'] },
  { id: 'X07_indirect', turns: ["What's the thing that makes sure an import either fully finishes or fully rolls back, never half-done?"] },
  { id: 'X08_indirect', turns: ['What checks whether a batch of files actually got the right count copied over?'] },
  { id: 'X09_indirect', turns: ['What lets me know which profile I was logged in as when I did an import last week?'] },
  { id: 'X10_indirect', turns: ['What controls the list of keywords available when tagging photos?'] },
  { id: 'X11_indirect', turns: ["What double checks a file's metadata actually matches after the fact?"] },
  { id: 'X12_indirect', turns: ['What decides whether a folder someone already made by hand can be pulled into the archive as-is?'] },
  { id: 'X13_indirect', turns: ['What tells me if the whole archive is internally consistent, not just one event?'] },
  { id: 'X14_indirect', turns: ['What lets a photographer be recognized correctly even if their folder name is a little off?'] },

  // --- exact naming, features NOT involved in any Checkpoint 10 failure ---
  { id: 'Y01_login', turns: ['How does AutoIngest know which operator is currently working?'] },
  { id: 'Y02_source_detection', turns: ['How does Source Detection recognize a DCIM folder versus a plain one?'] },
  { id: 'Y03_dashboard', turns: ['What does the Dashboard show about overall system status?'] },
  { id: 'Y04_autoupdate', turns: ['How does Application Auto-Update decide when to install a new version?'] },
  { id: 'Y05_source_cleanup', turns: ['What has to be true before Source Cleanup will delete anything from the original card?'] },
  { id: 'Y06_atomic_transaction', turns: ['What happens if the app is killed in the middle of an Atomic Import Transaction?'] },
  { id: 'Y07_checksum_verification', turns: ['Is Checksum-Based File Verification something I trigger myself, or automatic?'] },
  { id: 'Y08_audit_integrity', turns: ['What does Audit Integrity Verification actually count?'] },
  { id: 'Y09_keyword_registry', turns: ['Where do the keyword suggestions during tagging come from?'] },
  { id: 'Y10_metadata_verification', turns: ['What does Metadata Verification check for after files land?'] },
  { id: 'Y11_activity_log', turns: ['What kind of events show up in the Activity Log?'] },
  { id: 'Y12_photographer_resolution', turns: ['How does Photographer-Folder Resolution figure out the right folder?'] },
  { id: 'Y13_import_source_attribution', turns: ['Does AutoIngest remember which physical drive a photo originally came from?'] },
  { id: 'Y14_metadata_event_state', turns: ['How does AutoIngest decide whether an event still needs metadata work?'] },

  // --- capability / behavior questions on the same "new" subjects ---
  { id: 'Z01_capability', turns: ['Can I undo a Source Cleanup deletion after the fact?'] },
  { id: 'Z02_capability', turns: ['Does Checksum-Based File Verification run automatically after every import?'] },
  { id: 'Z03_capability', turns: ['Can two different operator profiles be active on the same machine at once?'] },
  { id: 'Z04_capability', turns: ['Is there a limit to how many keywords the registry can hold?'] },
  { id: 'Z05_capability', turns: ['Does the Activity Log ever get cleared out automatically?'] },

  // --- multi-turn: naming then technical/behavior, topic changes, pronouns ---
  { id: 'M01_multiturn', turns: ['What is Audit Integrity Verification?', 'Does it read every file, or just count them?'] },
  { id: 'M02_multiturn', turns: ['What is Source Detection?', 'And does it work the same way for a Sony camera as a generic USB drive?'] },
  { id: 'M03_multiturn_topic_change', turns: ['How does Login work in AutoIngest?', 'Switching topics -- what does the Keyword Registry actually store?'] },
  { id: 'M04_multiturn_pronoun', turns: ['What is Checksum-Based File Verification?', 'How long does it usually take on a big batch?'] },
  { id: 'M05_multiturn_return', turns: ['What is Source Cleanup?', 'What is the Activity Log?', "Going back to the first thing -- does it ever delete a file it shouldn't?"] },
  { id: 'M06_multiturn_yesno', turns: ['Does Metadata Verification catch files that were copied but never got their metadata written?', 'Yes, tell me more.'] },

  // --- conversation-only (no search needed) ---
  { id: 'C01_conversation_only', turns: ['What is the Dashboard?', 'Thanks, makes sense.'] },
  { id: 'C02_conversation_only', turns: ['Nice to chat with you.'] },
  { id: 'C03_conversation_only', turns: ['What is Photographer-Folder Resolution?', 'Why does it need to do that at all?'] },
  { id: 'C04_conversation_only', turns: ['What is Audit Integrity Verification?', 'Can you say that more plainly?'] },

  // --- ambiguous / genuinely unclear ---
  { id: 'A01_ambiguous', turns: ["It's not working."] },
  { id: 'A02_ambiguous', turns: ['Can you check on something for me?'] },

  // --- unknown / undocumented concepts (should investigate honestly, not fabricate) ---
  { id: 'U01_unknown', turns: ['Can AutoIngest detect blurry photos and flag them automatically?'] },
  { id: 'U02_unknown', turns: ['Is there a way to batch-rename files during import based on a pattern?'] },
  { id: 'U03_unknown', turns: ['Does the Keyword Registry support multiple languages?'] },

  // --- naming precision on already-known-tricky subjects (regression check, not new-only) ---
  { id: 'R01_regression_check', turns: ['What are the sub-reports under Archive Health Reporting called?'] },
  { id: 'R02_regression_check', turns: ['What are the two features for sending an event to a drive and pulling it back?'] },
  { id: 'R03_regression_check', turns: ['What is QMZ short for?'] },
  { id: 'R04_regression_check', turns: ["What's coming up next on the roadmap?"] },
  { id: 'R05_regression_check', turns: ['Where does the QMZ workflow keep its sequencing state?'] },

  // --- multi-turn recovery/troubleshooting on a "new" subject ---
  { id: 'T01_troubleshooting', turns: ['My checksum verification keeps failing on the same file.', 'It says the hash mismatches every time I run it.'] },
  { id: 'T02_troubleshooting', turns: ['The activity log seems to be missing entries from yesterday.'] },
];
