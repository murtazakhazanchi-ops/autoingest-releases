'use strict';

// ASK AUTOINGEST — CHECKPOINT 12, PHASE 8. EXPERIMENTAL. Adversarial
// development set, 56 conversations, intentionally harder than Checkpoint
// 11's dev set. Wording distinct from every prior set. Category tags for
// scoring; categories overlap by design (an adversarial conversation may
// also be an indirect-identification one, etc).

module.exports = [
  // === INDIRECT IDENTIFICATION / TERMINOLOGY (15+), many different features ===
  { id: 'IND01', cat: 'indirect', turns: ["What's the thing that stops me from accidentally importing the same photo twice?"] },
  { id: 'IND02', cat: 'indirect', turns: ['What were those two called again -- the ones for sending an event out and bringing it back in?'] },
  { id: 'IND03', cat: 'indirect', turns: ['What is Transfer Export?', 'And the one before that in the process -- what handles picking the source drive?'] },
  { id: 'IND04', cat: 'indirect', turns: ["What's its opposite -- the thing that brings content back in after Transfer Export sent it out?"] },
  { id: 'IND05', cat: 'indirect', turns: ['What do we call the screen where I see overall system status when I first open the app?'] },
  { id: 'IND06', cat: 'indirect', turns: ["What's the report for checking whether the whole archive is structurally sound?"] },
  { id: 'IND07', cat: 'indirect', turns: ["I forgot the name, but it's the thing that lets me quickly grab a few photos without setting up a full event."] },
  { id: 'IND08', cat: 'indirect', turns: ['What handles figuring out whose folder a photo belongs in?'] },
  { id: 'IND09', cat: 'indirect', turns: ['What keeps everyone from stepping on each other when two people import into the same folder?'] },
  { id: 'IND10', cat: 'indirect', turns: ['What checks that metadata actually landed correctly after a transfer-drive import?'] },
  { id: 'IND11', cat: 'indirect', turns: ['What is the thing that watches for new drives being plugged in?'] },
  { id: 'IND12', cat: 'indirect', turns: ['What lets me see if a planned backup update would actually change anything, before running it?'] },
  { id: 'IND13', cat: 'indirect', turns: ['What controls which words show up as tag suggestions?'] },
  { id: 'IND14', cat: 'indirect', turns: ['What is the mechanism that guarantees an import never gets left half-finished?'] },
  { id: 'IND15', cat: 'indirect', turns: ["What's the workflow for organizing the special Qadam/Majlis/Ziyafat event photos into order?"] },
  { id: 'IND16', cat: 'indirect', turns: ['What removes the originals from my card once they are safely archived?'] },

  // === THIN / EMPTY / UNKNOWN KNOWLEDGE (10+) ===
  { id: 'THIN01', cat: 'thin', turns: ['What is the exact step-by-step procedure for the Sort QMZ Photographs workflow?'] },
  { id: 'THIN02', cat: 'thin', turns: ['What is the precise internal algorithm Photographer-Folder Resolution uses to match names?'] },
  { id: 'THIN03', cat: 'thin', turns: ['What is the exact recovery procedure for the archive lock error workflow?'] },
  { id: 'THIN04', cat: 'thin', turns: ['How exactly does Archive Folder Adoption decide the destination path?'] },
  { id: 'THIN05', cat: 'thin', turns: ['What is the detailed operator workflow for Import or Update From a Transfer Drive?'] },
  { id: 'THIN06', cat: 'thin', turns: ['What are the precise steps to Use Quick Import for a Small Batch?'] },
  { id: 'THIN07', cat: 'thin', turns: ['How long does a typical Checksum-Based File Verification take on a 50GB batch?'] },
  { id: 'THIN08', cat: 'thin', turns: ['Is there a maximum number of keywords the Keyword Registry can store?'] },
  { id: 'THIN09', cat: 'thin', turns: ['What is the exact retry limit before Source Detection gives up polling a device?'] },
  { id: 'THIN10', cat: 'thin', turns: ['What specific error codes does Archive Diagnostics report for a corrupted event.json?'] },
  { id: 'THIN11', cat: 'thin', turns: ['What is the exact folder-naming regex Archive Folder Adoption checks against?'] },

  // === MULTI-TURN FOLLOW-UP / CONTEXT (10+) ===
  { id: 'MULTI01', cat: 'multi', turns: ['What is Duplicate Detection?', 'Does it work the same way during Quick Import?'] },
  { id: 'MULTI02', cat: 'multi', turns: ['What is Source Cleanup?', 'What has to happen before it deletes anything?', 'And if that check fails, what happens?'] },
  { id: 'MULTI03', cat: 'multi', turns: ['What is the Dashboard?', 'Does it update live, or do I need to refresh it?'] },
  { id: 'MULTI04', cat: 'multi', turns: ['What is Archive Health Reporting?', "Let's talk about something else -- what is Login?", 'Going back to the health reports -- which one checks for stale locks?'] },
  { id: 'MULTI05', cat: 'multi', turns: ['Can a Transfer Export resume after a crash?', 'What about a Transfer Import?'] },
  { id: 'MULTI06', cat: 'multi', turns: ['What is Metadata Verification?', 'Why does it only apply to some files and not all of them?'] },
  { id: 'MULTI07', cat: 'multi', turns: ['What is the Activity Log?', 'Yes, tell me more about the live team view.'] },
  { id: 'MULTI08', cat: 'multi', turns: ['What is Checksum-Based File Verification?', 'Is that the same thing as Audit Integrity Verification?'] },
  { id: 'MULTI09', cat: 'multi', turns: ['What is Quick Import?', 'Perfect, that answers my question.'] },
  { id: 'MULTI10', cat: 'multi', turns: ['What is Application Auto-Update?', 'How is that different from a Preview build?'] },
  { id: 'MULTI11', cat: 'multi', turns: ['What is Archive Lock Handling?', 'What happens if two operators hit that at the same time?'] },

  // === GENUINE AMBIGUITY (5+) ===
  { id: 'AMBIG01', cat: 'ambiguous', turns: ["It's stuck."] },
  { id: 'AMBIG02', cat: 'ambiguous', turns: ['This looks wrong.'] },
  { id: 'AMBIG03', cat: 'ambiguous', turns: ['Can I turn that off?'] },
  { id: 'AMBIG04', cat: 'ambiguous', turns: ['How do I fix it?'] },
  { id: 'AMBIG05', cat: 'ambiguous', turns: ['Is that normal?'] },

  // === UNSUPPORTED / NOT-ESTABLISHED (5+) ===
  { id: 'UNSUP01', cat: 'unsupported', turns: ['Can AutoIngest auto-crop photos to a standard aspect ratio?'] },
  { id: 'UNSUP02', cat: 'unsupported', turns: ['Is there a mobile app version of AutoIngest?'] },
  { id: 'UNSUP03', cat: 'unsupported', turns: ['Can I schedule an import to run automatically overnight?'] },
  { id: 'UNSUP04', cat: 'unsupported', turns: ['Does AutoIngest support two-factor authentication for operator profiles?'] },
  { id: 'UNSUP05', cat: 'unsupported', turns: ['Can I export directly to a cloud storage bucket instead of a physical drive?'] },

  // === CONVERSATION-ONLY (5+) ===
  { id: 'CONV01', cat: 'conversation', turns: ['Good morning.'] },
  { id: 'CONV02', cat: 'conversation', turns: ['Thanks for all your help today.'] },
  { id: 'CONV03', cat: 'conversation', turns: ['What is Quick Import?', 'Cool, got it.'] },
  { id: 'CONV04', cat: 'conversation', turns: ['You explain things pretty clearly.'] },
  { id: 'CONV05', cat: 'conversation', turns: ['What is Transfer Export?', 'Nice, thank you.'] },

  // === ADVERSARIAL: plausible-but-wrong terminology from the user ===
  { id: 'ADV01', cat: 'adversarial', turns: ['How do I use the Sync Manager to push my event to a drive?'] },
  { id: 'ADV02', cat: 'adversarial', turns: ['Where do I find the Backup Wizard?'] },
  { id: 'ADV03', cat: 'adversarial', turns: ['How do I open the Permissions Panel to add a second operator?'] },

  // === ADVERSARIAL: operator confidently misnames a real feature ===
  { id: 'ADV04', cat: 'adversarial', turns: ["I'm using the Photo Sync feature to move files to the transfer drive, but it stopped -- how do I resume it?"] },
  { id: 'ADV05', cat: 'adversarial', turns: ['My Duplicate Checker keeps flagging files that are not actually duplicates -- how do I turn off the checksum comparison?'] },

  // === ADVERSARIAL: two similar features, must disambiguate ===
  { id: 'ADV06', cat: 'adversarial', turns: ['Is Archive Maintenance the same thing as Event Maintenance, or different?'] },
  { id: 'ADV07', cat: 'adversarial', turns: ['Whats the difference between Audit Integrity Verification and Checksum-Based File Verification?'] },
  { id: 'ADV08', cat: 'adversarial', turns: ['Is Backup Update Scanning part of Transfer Export, or a separate thing entirely?'] },

  // === ADVERSARIAL: technical term from one feature applied to another ===
  { id: 'ADV09', cat: 'adversarial', turns: ['Does Quick Import use the same batch-checkpoint resume mechanism that Transfer Export uses?'] },
  { id: 'ADV10', cat: 'adversarial', turns: ['Does Duplicate Detection use the same SHA-256 hashing that Checksum-Based File Verification does?'] },

  // === ADVERSARIAL: question presupposes a nonexistent capability ===
  { id: 'ADV11', cat: 'adversarial', turns: ['When I use the Bulk Rename tool during Transfer Export, does it also update the event.json?'] },
  { id: 'ADV12', cat: 'adversarial', turns: ['How do I configure the auto-tagging AI to only tag people it has seen before?'] },
  { id: 'ADV13', cat: 'adversarial', turns: ['In the Multi-User Dashboard, can I see every operator\'s activity at once?'] },
];
