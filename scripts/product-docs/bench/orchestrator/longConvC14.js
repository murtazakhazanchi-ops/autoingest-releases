'use strict';
// ASK AUTOINGEST — CHECKPOINT 14, PHASE 13. contextSize=16384 qualification:
// 10 deliberately long, realistic conversations, each constructed to include
// several of: a long troubleshooting chain, a topic change, a return to an
// earlier subject, several knowledge reads, relational follow-ups, a
// clarification exchange, and a roadmap question appearing later in the
// conversation -- used to measure context overflow, history truncation,
// lost conversational references, lost grounding, latency, and RSS at
// contextSize=16384. Different primary subjects from RB58/RB44/RB27/QI05.
module.exports = [
  { id: 'LONG01', turns: [
    'A photographer says their import seems to have failed halfway through. Where would I even start looking?',
    'Okay, and if the Atomic Import Transaction rolled back, would any partial files be left behind on disk?',
    'Got it. Separately -- while I have you, what does Import Source Attribution actually record for each file?',
    'Does that tie back into the Activity Log at all, or is it a totally separate record?',
    'Back to the failed import -- would Duplicate Detection have flagged anything before the rollback happened, or does that only run later?',
    'What is currently planned or in progress for the import pipeline, if anything?',
    'One more thing -- does Checksum-Based File Verification run as part of that same import, or only when explicitly requested?',
  ] },
  { id: 'LONG02', turns: [
    'What does Archive Health Reporting actually check?',
    'Does it run automatically, or does an operator have to trigger it?',
    'Switching topics for a second -- how does the app decide which release channel a given install is on?',
    'Is that connected to the Application Auto-Update system, or a separate mechanism?',
    'Going back to Archive Health Reporting -- if it finds a problem, does Archive Repair fix it automatically, or does an operator still have to act?',
    'Sorry, quick clarification -- when you say "operator has to act," do you mean through a specific button, or just generally?',
    'What is the current roadmap status for archive maintenance features overall?',
  ] },
  { id: 'LONG03', turns: [
    'Walk me through what happens the first time someone imports from a brand new memory card.',
    'Does Source Detection actually identify the camera model, or just that a drive got connected?',
    'What about Grouping -- does that happen automatically, or does the operator have to group photos manually?',
    'Let me ask something unrelated -- is there a way to see who else is currently online in the app?',
    'Does that presence feature affect archive locking in any documented way?',
    'Coming back to the import flow -- after grouping, does Photographer-Folder Resolution decide the destination automatically from there?',
    'What is left to build in the import pipeline area, roadmap-wise?',
  ] },
  { id: 'LONG04', turns: [
    'What does the Metadata Durable Queue actually protect against?',
    'If the app crashes mid-write, does the queue resume automatically on the next launch, or does someone have to trigger it?',
    'New topic -- what does the Keyword Registry actually store?',
    'Can an operator invent a brand-new keyword on the spot, or does it have to already exist in the registry?',
    'Back to the durable queue -- does Metadata Audit & Repair share that same queue, or does it have its own?',
    'Just to be clear, are the writing engine and the audit/repair feature the same thing under two names?',
    'What is the roadmap status for the metadata system overall right now?',
  ] },
  { id: 'LONG05', turns: [
    'What does Archive Root Configuration & Resolution actually do?',
    'How does it decide which folder is the real, authoritative archive root if there are multiple candidates?',
    'Switching gears -- what does Local-First Background Archive Sync actually sync, and to where?',
    'Is that the same mechanism as Backup Update Scanning, or something different?',
    'Going back to archive root resolution -- what happens if the configured root becomes unavailable, like a disconnected NAS?',
    'Does Archive Folder Adoption come into play in that situation at all?',
    'What is currently planned for archive-root-related work on the roadmap?',
  ] },
  { id: 'LONG06', turns: [
    'What is Transfer Export actually for?',
    'Does it copy files, or move them off the source?',
    'Different question -- does QMZ Sequencing Workspace have anything to do with transfers at all?',
    'What does QMZ actually stand for or represent in this app?',
    'Back to transfers -- once a Transfer Export finishes, does Transfer Import automatically know about it, or does someone have to point it at the drive?',
    'Quick clarification -- when you say "point it at the drive," do you mean physically connect it, or select it in the UI?',
    'Is there anything currently in progress for the transfer/export area?',
  ] },
  { id: 'LONG07', turns: [
    'What does Realtime Team Presence actually show an operator?',
    'Does it update live, or does someone have to refresh to see who is online?',
    'New subject -- what does Global Search actually search across?',
    'Does it search file contents, or just metadata and titles?',
    'Coming back to presence -- if two people are both viewing the same event at once, does the app warn either of them?',
    'Does that connect to Archive Lock Handling in any documented way?',
    'What is the roadmap status for team-collaboration features generally?',
  ] },
  { id: 'LONG08', turns: [
    'What does Audit Integrity Verification actually count?',
    'Is that the same thing as Checksum-Based File Verification, or a different check entirely?',
    'Unrelated question for a second -- what does Dashboard Metadata Health actually show on the dashboard?',
    'Is that tile automatically kept up to date, or does it need a manual refresh?',
    'Back to audit integrity -- if it finds a count mismatch, does it tell the operator which specific files are missing?',
    'And just to confirm, does that feature ever delete or move files on its own?',
    'Is there anything currently planned to expand the integrity-verification features?',
  ] },
  { id: 'LONG09', turns: [
    'What does Event Management & Editing actually let an operator change after an event already exists?',
    'Can the event type or location be edited after files have already been imported into it?',
    'Switching topics -- what is Event Maintenance, and how is it different from Event Management & Editing?',
    'Does Event Maintenance run on a schedule, or only when triggered manually?',
    'Back to editing -- if an operator changes the location after import, does that trigger any kind of metadata reapply?',
    'Does that connect to Metadata Reapply / Sync specifically, or is it a separate mechanism?',
    'What is the current roadmap status for event-management features?',
  ] },
  { id: 'LONG10', turns: [
    'What does the Design System & UI Consistency Framework actually govern?',
    'Is that something operators interact with directly, or purely an internal engineering concern?',
    'Different topic -- what does Archive Analytics actually report on?',
    'Does it pull its numbers from Archive Health Reporting, or compute its own independently?',
    'Going back to the design system -- does it affect performance at all, or is it purely visual?',
    'One more clarification -- when a new feature is built, is following the design system mandatory or just a guideline?',
    'What is planned next on the roadmap for the UI/design-system area, if anything?',
  ] },
];
