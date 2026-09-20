'use strict';

// ASK AUTOINGEST — CHECKPOINT 12, PHASE 12. EXPERIMENTAL. NEW, POST-FREEZE
// blind qualification set, 80 conversations. Built and run exactly ONCE
// against the frozen engineC12/validatorC12/knowledgeAccessC12 -- no
// tuning against this set is permitted (see FREEZE_RECORD.txt).
//
// Wording is original to this file -- checked against every prior set
// (frozen19, generalization14, blindSet, finalBlind25, finalBlindC7-11,
// devSetC12, stochasticSetC12) to avoid verbatim/near-verbatim reuse.
//
// Topic coverage deliberately leans into features never used as a primary
// subject in devSetC12/stochasticSetC12 (the immediately-prior test sets):
// File Browser & Media Grid/List (AI-FEAT-013), Thumbnail Generation &
// Caching (AI-FEAT-014), Preview Focus/Selection Separation (AI-FEAT-016),
// Grouping System (AI-FEAT-017), Metadata Management Modal (AI-FEAT-034),
// Metadata Reapply/Sync (AI-FEAT-037), Transfer Background/Minimize
// Operation (AI-FEAT-041), Archive Root Configuration Resolution
// (AI-FEAT-042), Local-First Background Archive Sync (AI-FEAT-044), Event
// Creation (AI-FEAT-009), Event Management/Editing (AI-FEAT-010), Source
// Detection (AI-FEAT-011), Source Selection (AI-FEAT-012), Activity Log
// (AI-FEAT-027), Import Source Attribution (AI-FEAT-028), plus the
// Planned-status roadmap features for genuine unsupported-capability
// coverage: Global Search (AI-FEAT-053), Archive Browser (AI-FEAT-051),
// Archive Repair (AI-FEAT-052), Integrity Verification Archive-Wide
// (AI-FEAT-054), Archive Analytics (AI-FEAT-055), AI Archive Intelligence
// (AI-FEAT-056), Event Maintenance (AI-FEAT-050) -- all confirmed
// Status: Planned by direct read of their canonical feature files, not
// assumed. Every asserted fact below (e.g. AI-FEAT-041's explicit
// Event-Import exclusion, AI-FEAT-016's click-vs-selection distinction,
// AI-FEAT-042's four-root precedence, AI-FEAT-044's multi-operator
// throughput rationale, AI-FEAT-009's {HijriDate}_{Label} Collection
// naming) was verified against the real docs/product/features/*.md file
// before being used as the basis for a question, not invented.

module.exports = [
  // === QI: INDIRECT IDENTIFICATION (26) -- no direct feature name; must retrieve ===
  { id: 'QI01', cat: 'indirect', turns: ['What splits my browsed files into RAW, image, and video sections before I even start importing?'] },
  { id: 'QI02', cat: 'indirect', turns: ["Is there something that remembers a thumbnail so it doesn't have to redraw it every time I scroll past the same folder again?"] },
  { id: 'QI03', cat: 'indirect', turns: ['If I just click a photo once to look at it bigger, does that also mark it to be imported?'] },
  { id: 'QI04', cat: 'indirect', turns: ["What actually builds the sub-event and photographer folders once I've sorted my selected files into groups?"] },
  { id: 'QI05', cat: 'indirect', turns: ['Is there one place that pulls together all the different metadata tools instead of opening several separate windows?'] },
  { id: 'QI06', cat: 'indirect', turns: ["What notices that my event's location changed after import and offers to fix the metadata on the files that already went out?"] },
  { id: 'QI07', cat: 'indirect', turns: ['Can I keep an export running in the background while I go do something else in the app?'] },
  { id: 'QI08', cat: 'indirect', turns: ["What figures out which physical location gets written to when the main office server isn't reachable?"] },
  { id: 'QI09', cat: 'indirect', turns: ['What quietly finishes moving my import from my laptop up to the real archive after I already copied it locally?'] },
  { id: 'QI10', cat: 'indirect', turns: ['What lets me browse through a card of photos by roughly what time they were shot, instead of by folder?'] },
  { id: 'QI11', cat: 'indirect', turns: ['Is there a way to tell at a glance which thumbnails are videos versus photos without opening them?'] },
  { id: 'QI12', cat: 'indirect', turns: ['What keeps me from accidentally adding a file to my import selection just because I clicked on it to look closer?'] },
  { id: 'QI13', cat: 'indirect', turns: ["What writes the folder structure automatically once I've assigned my files to groups, so I'm not making folders by hand?"] },
  { id: 'QI14', cat: 'indirect', turns: ["What handles making sure several operators writing to the same server at once doesn't slow everyone to a crawl?"] },
  { id: 'QI15', cat: 'indirect', turns: ['Where do I go to correct the metadata on files already sitting in the archive, without re-importing them?'] },
  { id: 'QI16', cat: 'indirect', turns: ['What decides whether to use the office server automatically, or fall back to something else if it drops off the network mid-session?'] },
  { id: 'QI17', cat: 'indirect', turns: ['Does starting a brand-new event require me to build the folder layout myself, or is that generated for me?'] },
  { id: 'QI18', cat: 'indirect', turns: ["What's the tool for going back and fixing an event's basic details after it's already been created?"] },
  { id: 'QI19', cat: 'indirect', turns: ['Is there something that automatically tells a real camera card apart from a regular USB drive when I plug something in?'] },
  { id: 'QI20', cat: 'indirect', turns: ['What handles picking which folder or drive actually gets scanned when more than one is connected at once?'] },
  { id: 'QI21', cat: 'indirect', turns: ["What's the record that shows what's happened recently in the app, like a running history of actions?"] },
  { id: 'QI22', cat: 'indirect', turns: ['What keeps track of which physical card or drive a given photo actually came from?'] },
  { id: 'QI23', cat: 'indirect', turns: ["If two operators separately create what's basically the same event, is there anything keeping their naming from drifting apart?"] },
  { id: 'QI24', cat: 'indirect', turns: ["What actually generates the collection and event names, so operators aren't typing them by hand?"] },
  { id: 'QI25', cat: 'indirect', turns: ["Is there a view that shows just the video files separately when I'm sorting through a big mixed card?"] },
  { id: 'QI26', cat: 'indirect', turns: ["Does the metadata tools window lose track of one tool's changes when I switch over to a different tab inside it?"] },

  // === QT: TECHNICAL / PRECISE-DETAIL (10) -- specific mechanism/field/rule ===
  { id: 'QT01', cat: 'technical', turns: ['Does the video thumbnail pipeline decode the whole clip on the fly, or does it cache an extracted frame?'] },
  { id: 'QT02', cat: 'technical', turns: ['Between a plain click and a Cmd/Ctrl-click on a file in the browser, which one actually changes my import selection?'] },
  { id: 'QT03', cat: 'technical', turns: ['Does the Metadata Management Modal have its own backend logic, or is it just showing me data owned by other features?'] },
  { id: 'QT04', cat: 'technical', turns: ["When Metadata Reapply detects a change, does it just tell me, or does it show exactly which folders and fields would be affected first?"] },
  { id: 'QT05', cat: 'technical', turns: ['Can I run a normal Event Import in the background the same way I can minimize a Transfer Export?'] },
  { id: 'QT06', cat: 'technical', turns: ['If the Main Archive Root and my currently-chosen Active Archive Root end up pointing to the same place, does the app still treat that as a manual override?'] },
  { id: 'QT07', cat: 'technical', turns: ["On startup, if my last active event's saved path belongs to a NAS that's currently offline, does the app fall back to my local staging copy first?"] },
  { id: 'QT08', cat: 'technical', turns: ['Is Local-First Background Sync mainly there so I can keep working while offline, or is there a different main reason it exists?'] },
  { id: 'QT09', cat: 'technical', turns: ['Does Grouping change what actually gets saved in event.json right away, or is it just a temporary working view until I finish?'] },
  { id: 'QT10', cat: 'technical', turns: ['Is the Collection name on a new event whatever I type in, or does it follow a specific generated pattern?'] },

  // === QM: MULTI-TURN / FOLLOW-UP CONTEXT (18) ===
  { id: 'QM01', cat: 'multi', turns: ['What is the File Browser?', 'Can I switch that grid over to a list instead?'] },
  { id: 'QM02', cat: 'multi', turns: ['What is Thumbnail Generation?', 'Does it regenerate every time I come back to the same folder?'] },
  { id: 'QM03', cat: 'multi', turns: ['What is the Metadata Management Modal?', "Does switching tabs inside it lose my place in the others?"] },
  { id: 'QM04', cat: 'multi', turns: ['What is Metadata Reapply?', 'What does the preview actually show me before it changes anything?'] },
  { id: 'QM05', cat: 'multi', turns: ['Can I run a Transfer Export in the background?', 'What about a regular Event Import?'] },
  { id: 'QM06', cat: 'multi', turns: ['What is Archive Root Configuration?', 'What happens if the Main Archive Root goes offline while I\'m mid-session?'] },
  { id: 'QM07', cat: 'multi', turns: ['What is Local-First Background Sync?', 'Why does that exist instead of just importing straight to the archive?'] },
  { id: 'QM08', cat: 'multi', turns: ['What is the Event Creator?', 'Does it let me reorder the components after I\'ve already added them?'] },
  { id: 'QM09', cat: 'multi', turns: ['What is Grouping?', 'Does that update event.json right away, or only once I finish?'] },
  { id: 'QM10', cat: 'multi', turns: ['What is Preview Focus?', 'So a single click never adds something to my import selection?'] },
  { id: 'QM11', cat: 'multi', turns: ['What is Source Detection?', "And a drive that isn't a camera at all -- does it just get ignored?"] },
  { id: 'QM12', cat: 'multi', turns: ['What is Event Management?', 'Can I rename an event after it\'s already been created?'] },
  { id: 'QM13', cat: 'multi', turns: ['What is the Activity Log?', 'Does it show what other operators did, or only my own actions?'] },
  { id: 'QM14', cat: 'multi', turns: ['What is Import Source Attribution?', 'Does that survive if I later move the files into a different folder?'] },
  { id: 'QM15', cat: 'multi', turns: ['What is Source Selection?', 'What happens if two drives are plugged in at the same time?'] },
  { id: 'QM16', cat: 'multi', turns: ["My import from the memory card is taking forever to even show up.", "It's a big card, over a thousand files on it."] },
  { id: 'QM17', cat: 'multi', turns: ['Does AutoIngest have Global Search yet?', 'Ok -- so how do I actually find one specific photo across the whole archive today?'] },
  { id: 'QM18', cat: 'multi', turns: ['Is there an Archive Browser I can use to navigate the whole archive?', "Thanks -- so what's actually available today for looking back through past events, then?"] },

  // === QA: GENUINE AMBIGUITY (9) -- real close pairs + bare fragments ===
  { id: 'QA01', cat: 'ambiguous', turns: ['Is Metadata Reapply the same thing as the Metadata Management Modal, or is that something separate?'] },
  { id: 'QA02', cat: 'ambiguous', turns: ["Is Archive Root Configuration the same as Local-First Background Sync, since they're both about where my files end up?"] },
  { id: 'QA03', cat: 'ambiguous', turns: ['Are Source Detection and Source Selection the same step, or two different things?'] },
  { id: 'QA04', cat: 'ambiguous', turns: ["When people say 'background sync' around here, do they mean the Transfer Export minimize feature, or the local-to-archive sync?"] },
  { id: 'QA05', cat: 'ambiguous', turns: ["Is Event Creation the same tool as Event Management, or is there a different one I use to edit an event that already exists?"] },
  { id: 'QA06', cat: 'ambiguous', turns: ["It won't do anything."] },
  { id: 'QA07', cat: 'ambiguous', turns: ['Something seems off here.'] },
  { id: 'QA08', cat: 'ambiguous', turns: ['Is there a way to shut that off?'] },
  { id: 'QA09', cat: 'ambiguous', turns: ['Is this how it\'s supposed to work?'] },

  // === QU: UNSUPPORTED / NOT-ESTABLISHED (9) -- verified against real Status fields ===
  { id: 'QU01', cat: 'unsupported', turns: ["Can I search across the entire archive using a plain-language description, like 'photos of the reception at night'?"] },
  { id: 'QU02', cat: 'unsupported', turns: ['Is there an Archive Browser view where I can navigate the whole archive independent of whatever event is currently open?'] },
  { id: 'QU03', cat: 'unsupported', turns: ["Does AutoIngest have a way to actually repair corrupted files it finds in the archive, not just detect them?"] },
  { id: 'QU04', cat: 'unsupported', turns: ['Can I run an integrity check across the entire archive at once, rather than one event at a time?'] },
  { id: 'QU05', cat: 'unsupported', turns: ['Is there an analytics dashboard that shows trends about the archive over time, like storage growth?'] },
  { id: 'QU06', cat: 'unsupported', turns: ['Does AutoIngest use AI to automatically find or organize content across the archive for me?'] },
  { id: 'QU07', cat: 'unsupported', turns: ['Can I flag an event as needing maintenance and have AutoIngest queue that work up for later?'] },
  { id: 'QU08', cat: 'unsupported', turns: ['Can AutoIngest send a push notification to my phone when a large import finishes?'] },
  { id: 'QU09', cat: 'unsupported', turns: ['Does the app automatically pick out and flag any noticeably blurry shots after they come in?'] },

  // === QC: CONVERSATION-ONLY (4) ===
  { id: 'QC01', cat: 'conversation', turns: ["Morning! How's everything running today?"] },
  { id: 'QC02', cat: 'conversation', turns: ['Appreciate the help, that clears it up.'] },
  { id: 'QC03', cat: 'conversation', turns: ['What is the File Browser?', "Great, that's exactly what I needed to know."] },
  { id: 'QC04', cat: 'conversation', turns: ["You're pretty easy to talk to."] },

  // === QX: NEW ADVERSARIAL PATTERNS (4), fresh subjects only ===
  // (a) invites inventing a plausible-but-fake sub-component/mode name
  { id: 'QX01', cat: 'adversarial', turns: ["What are the different tabs or modes inside the Metadata Management Modal?"] },
  // (b) operator confidently uses a close-but-wrong name for a real feature
  { id: 'QX02', cat: 'adversarial', turns: ["Isn't there something called the 'Local Cache Sync' that copies my import up to the real archive later?"] },
  // (c) technical/UI term legitimately belonging to one feature applied to a different, similar one
  { id: 'QX03', cat: 'adversarial', turns: ['Does Metadata Reapply use the same tabbed modal interface that the Metadata Management Modal does, or is it a separate window?'] },
  // (d) presupposes a plausible-for-archival-software capability the docs may not establish
  { id: 'QX04', cat: 'adversarial', turns: ['When Local-First Sync finishes copying up to the archive, does it automatically delete the local staging copy to free up disk space?'] },
];
