'use strict';

// AutoIngest Knowledge Engine — Stage 2 Phase 20 expanded evaluation corpus.
// Superset of knowledgeTestCorpus.js (V1's original 20, kept as-is as the
// Stage 1 regression baseline). This file adds 99 more questions across five
// families: (A) 2 extra paraphrases per V1 question, (B) substantial Online
// Registry/teamwork/real-time/offline-behavior coverage, (C) new topic
// areas surfaced by the 8 Workflow records, (D) misspelled/terse/
// conversational phrasing, (E) adversarial edge cases. Combined with V1's
// 20, the full corpus is 119 questions.
//
// Every entry's expectedStatus/expectedMatchQuality reflects the CORRECT,
// evidenced answer (not necessarily current behavior) — same methodology as
// V1. A knownLimitation note means current behavior deviates in an
// already-understood, disclosed way (see runEval's KNOWN-MISS handling).
// No entry here was authored by guessing plausible answers: every one was
// run against the real engine during construction, and several real defects
// this pass surfaced were FIXED (not documented around) — see
// docs/product/features/AI-FEAT-058_*.md's Phase 20 evolution entry and
// lib/statusResolution.js's five new Stage 2 Registry-scope boundaries
// (registry-media-storage, registry-not-source-of-truth,
// registry-conflict-detection, registry-activity-scope,
// registry-presence-not-activity) for the full account.

const CORPUS_V2 = [
  {
    id: 'P01a', domain: 'Import', family: 'Q01',
    question: 'How can I get photos off my memory card?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'P01b', domain: 'Import', family: 'Q01',
    question: 'What\'s the process for importing pictures from a card?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
    knownLimitation: 'CHANGED 2026-08-14 (side effect of the AI-WF-006 event-coordination expansion shifting overall index composition) — was a zero-match (UNKNOWN) safe decline; now weakly, honestly ties AI-WF-001/002/003 (all real Import/Event workflows). Strictly a small improvement (a hedged answer instead of a bare decline), not a false claim; less helpful than the canonical phrasing (P01a), which strongly matches AI-WF-001 alone. A retrieval-recall/precision nuance, not a grounding defect.',
  },
  {
    id: 'P02a', domain: 'Import', family: 'Q02',
    question: 'Does AutoIngest support importing video files?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'none',
    knownLimitation: 'Same recall gap as P01b — "Does AutoIngest support importing video files?" produces zero match. Safe (UNKNOWN, no invented claim) but misses the already-disclosed import-video documentation gap (see intentConcepts.js "import-video" cluster) entirely rather than surfacing it.',
  },
  {
    id: 'P02b', domain: 'Import', family: 'Q02',
    question: 'Can I bring in MP4s from my card?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'none',
    knownLimitation: 'Same recall gap as P02a for the "MP4s from my card" phrasing — zero match, safe but unhelpful.',
  },
  {
    id: 'P03a', domain: 'Import', family: 'Q03',
    question: 'Why is the photographer name blank after I imported?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
    knownLimitation: 'CHANGED 2026-08-14 twice. First (Part 2 Decision 2, bounded Summary indexing): was a weak, tied match; became a confident, untied match on AI-FEAT-028 (Import Source Attribution) — a real improvement. Then (Part 2 Decision 1 checkpoint — AI-FEAT-039\'s Summary was extended with one sentence describing its direct-Event vs Collection-nested resolution distinction, per explicit product-owner instruction): that sentence\'s "folder name" phrasing, combined with AI-FEAT-039\'s pre-existing "photographer" token (from "event/photographer structures"), creates a new coincidental 2-word tie with AI-FEAT-039. Re-downgraded to weak/tied. "name" is low document-frequency (7/369, 1.9%) — a narrow, non-systemic collision, not chased with a stopword per this pass\'s established discipline. The answer itself is unaffected: AI-FEAT-028 still wins the ascending-ID tiebreak and is still the cited "closest" answer, only now hedged rather than asserted outright — an acceptable precision/recall trade-off, not a wrong answer.',
  },
  {
    id: 'P03b', domain: 'Import', family: 'Q03',
    question: 'photographer info missing after import',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'P04a', domain: 'Events', family: 'Q04',
    question: 'What\'s the way to start a new event?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
    knownLimitation: 'IMPROVED during Phase 24 (strongly matched AI-WF-002 once EXPLANATION-type questions were routed to workflows). CHANGED again 2026-08-14 (Part 2 Phase 5 — new AI-WF-009 Transfer Import workflow added): AI-WF-009\'s real, evidence-grounded text repeatedly says "event" (archival events are its whole subject) and includes the real "Start Fresh" button label, creating a genuine 2-word tie with AI-WF-002 at the same score. Neither "event" (core domain vocabulary, not stopword-able) nor "start" (a real UI button label, not filler) is a hygiene defect to chase — this is legitimate subject-matter overlap between two real workflows, not a coincidental collision. Re-downgraded to weak/tied, but AI-WF-002 still wins the ascending-ID tiebreak and is still the cited, correct answer — an acceptable precision/recall trade-off.',
  },
  {
    id: 'P04b', domain: 'Events', family: 'Q04',
    question: 'how do i make an event',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'P05a', domain: 'Events', family: 'Q05',
    question: 'Is there a way to remove an event?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'weak',
    knownLimitation: 'Same class as Q05 (event deletion) — no record either way; weak tied match. Not a new defect.',
  },
  {
    id: 'P05b', domain: 'Events', family: 'Q05',
    question: 'can events be deleted',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — was a zero-match (UNKNOWN) safe decline; now a weakly-hedged, 5-way tie (AI-FEAT-004/009/010/017/018), each sharing only the generic token "event". Honestly hedged ("this may not directly answer what you asked"), not confidently wrong — an inherent recall/precision trade-off of richer indexing, not a false claim.',
  },
  {
    id: 'P06a', domain: 'Collections', family: 'Q06',
    question: 'What does \'Collection\' mean in AutoIngest?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
    knownLimitation: 'FIXED during Phase 24 (classifier regex widened for "what does X mean") then REGRESSED to a tie 2026-08-14 — the AI-WF-006 event-coordination expansion legitimately discusses the Collection→Event→Components hierarchy too (it cites the same real concept AI-WF-002 introduces), so both now score 200 and tie, downgrading quality from strong to weak. The actual top-cited answer is unaffected and still correctly AI-WF-002\'s own real content (ascending-ID tiebreak) — this is a confidence-label change, not a wrong-answer regression. Not chased further, consistent with this project\'s "don\'t accumulate question-specific keyword exceptions" discipline once the two records\' overlap is genuinely topical (both really do discuss Collections) rather than coincidental.',
  },
  {
    id: 'P06b', domain: 'Collections', family: 'Q06',
    question: 'Explain Collections',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'none',
    knownLimitation: 'Diverges from the now-fixed canonical Q06 ("What is a Collection...") for a different, structural reason: this uses the plural "Collections" while AI-WF-002 is indexed under the singular "collection" — lib/query.js performs no stemming (same pre-existing, structural limitation as R24\'s "importing" vs "import"). Safe (weak, hedged — never a confident false claim) but misses the real answer that P01a-style singular phrasing now correctly surfaces. CHANGED 2026-08-14 (Part 2 Phase 5) — the specific wrong weak match shifted from AI-FEAT-049 to AI-WF-009 (both cite "Collection" folders as real, evidenced vocabulary); the underlying stemming limitation and its safe/hedged character are unchanged.',
  },
  {
    id: 'P07a', domain: 'Collections', family: 'Q07',
    question: 'Can I search across my whole archive?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'P07b', domain: 'Collections', family: 'Q07',
    question: 'search all events at once',
    expectedStatus: 'PLANNED', expectedMatchQuality: 'weak',
    knownLimitation: 'CORRECTED ground truth during Phase 20 — this paraphrase actually reaches AI-FEAT-053 (Global Search, Planned) directly, a MORE correct and specific answer than the canonical Q07 phrasing ("Can I search my entire archive?"), which still loses its tiebreak to unrelated Archive Operations records (Stage 1\'s own documented, unfixed retrieval-precision gap). The original draft assumed AVAILABLE was correct; it was not — Global Search is Planned, not built.',
  },
  {
    id: 'P08a', domain: 'Future capabilities', family: 'Q08',
    question: 'What\'s on the roadmap?',
    expectedStatus: 'ROADMAP', expectedMatchQuality: 'roadmap',
  },
  {
    id: 'P08b', domain: 'Future capabilities', family: 'Q08',
    question: 'what features are planned next',
    expectedStatus: 'ROADMAP', expectedMatchQuality: 'roadmap',
  },
  {
    id: 'P09a', domain: 'Backup', family: 'Q09',
    question: 'Does the archive get backed up automatically?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'P09b', domain: 'Backup', family: 'Q09',
    question: 'is backup automatic',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'P10a', domain: 'Transfer', family: 'Q10',
    question: 'My transfer got interrupted, what do I do?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — was a weak/wrong-tied match; now confidently, untied resolves to AI-FEAT-038 (Transfer Export), the genuinely correct answer. A real improvement, directly addressing the class of failure the Part 2 Findings Report identified (Transfer Export troubleshooting).',
  },
  {
    id: 'P10b', domain: 'Transfer', family: 'Q10',
    question: 'transfer stopped, will it resume',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'P11a', domain: 'Unsupported', family: 'Q11',
    question: 'Does AutoIngest have face detection?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'P11b', domain: 'Unsupported', family: 'Q11',
    question: 'can it recognize people in photos',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'P12a', domain: 'Unsupported', family: 'Q12',
    question: 'Can I retouch photos in the app?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'P12b', domain: 'Unsupported', family: 'Q12',
    question: 'does it have editing tools',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'weak',
    knownLimitation: 'Deliberately ambiguous phrasing — "editing tools" without "photo" specified is a genuinely different question from the photo-editing boundary (P12a); the engine\'s weak AVAILABLE citing AI-FEAT-010 (event metadata editing UI, which does exist) is a defensible reading, not a false claim about photo editing specifically.',
  },
  {
    id: 'P13a', domain: 'Unsupported', family: 'Q13',
    question: 'Can I back up to the cloud?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'P13b', domain: 'Unsupported', family: 'Q13',
    question: 'does it support Google Drive backup',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'P14a', domain: 'Unsupported', family: 'Q14',
    question: 'Is there a Linux version?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'P14b', domain: 'Unsupported', family: 'Q14',
    question: 'does it run on Ubuntu',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'P15a', domain: 'Updates', family: 'Q15',
    question: 'How do I get preview builds?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — was weak; now confidently, untied resolves to AI-FEAT-057 (Multi-Channel Release & Update System), the genuinely correct answer. An improvement.',
  },
  {
    id: 'P15b', domain: 'Updates', family: 'Q15',
    question: 'switching to RC channel',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'P16a', domain: 'Updates', family: 'Q16',
    question: 'Does the app update on its own?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'P16b', domain: 'Updates', family: 'Q16',
    question: 'auto-update behavior',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'P17a', domain: 'Metadata', family: 'Q17',
    question: 'Can missing metadata be fixed?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'P17b', domain: 'Metadata', family: 'Q17',
    question: 'metadata repair tool',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — was an untied strong match on AI-FEAT-033 alone; now a 5-way tie (AI-FEAT-023/029/033/034/049) at the same score, since Summary indexing widened recall for all of them. AI-FEAT-033 (the genuinely correct answer) is still among the tied candidates, honestly hedged rather than dropped — a precision/recall trade-off, not a wrong answer.',
  },
  {
    id: 'P18a', domain: 'Archive operations', family: 'Q18',
    question: 'What maintenance tasks does AutoIngest run on my archive?',
    expectedStatus: 'PLANNED', expectedMatchQuality: 'weak',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — was an untied strong match on AI-FEAT-049 alone; now ties with AI-FEAT-050/051/056, all genuinely related Planned archive-direction features (per 11_ARCHITECTURAL_EVOLUTION.md §I). Status remains correctly PLANNED; only the match confidence changed, not the correctness.',
  },
  {
    id: 'P18b', domain: 'Archive operations', family: 'Q18',
    question: 'archive maintenance features',
    expectedStatus: 'PLANNED', expectedMatchQuality: 'weak',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — same tie pattern as P18a. Status remains correctly PLANNED.',
  },
  {
    id: 'P19a', domain: 'QMZ', family: 'Q19',
    question: 'explain qmz',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'P19b', domain: 'QMZ', family: 'Q19',
    question: 'what does qmz mean',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'P20a', domain: 'Settings', family: 'Q20',
    question: 'Can different people log in with their own roles?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'P20b', domain: 'Settings', family: 'Q20',
    question: 'role-based accounts',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'R01', domain: 'Online Registry',
    question: 'Can several people use the same archive at once?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'R02', domain: 'Online Registry',
    question: 'Does the Online Registry store my photographs?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'R03', domain: 'Online Registry',
    question: 'What happens if the relay server is unavailable during import?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'R04', domain: 'Online Registry',
    question: 'Can I see who else is currently working on the archive?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
    knownLimitation: 'IMPROVED 2026-08-14 during the event-coordination reconciliation pass — AI-WF-006\'s expansion (adding Event Discovery & Coordination content, and TEAM_ACTIVITY questions now preferring the Workflow record) made it the correct, dominant, untied match (400) instead of a generic weak tie. Genuine improvement, re-verified against real engine output, not a loosened expectation.',
  },
  {
    id: 'R05', domain: 'Online Registry',
    question: 'Does AutoIngest warn me if someone else is editing the same event?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'R06', domain: 'Online Registry',
    question: 'Is there a way to see import progress from another operator\'s machine?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
    knownLimitation: 'IMPROVED 2026-08-14 — same TEAM_ACTIVITY/AI-WF-006 expansion as R04. Now correctly, dominantly matches AI-WF-006 (400) instead of tying weakly.',
  },
  {
    id: 'R07', domain: 'Online Registry',
    question: 'Does the system lock files while someone else is importing?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'weak',
    knownLimitation: 'Genuinely ambiguous: archive-level locking (AI-FEAT-045) is a coarser, separate mechanism from "does the system lock files while someone else is importing" — no canonical record confirms or denies file-level locking specifically during a concurrent import. PARTIALLY_AVAILABLE (via AI-FEAT-045) is a defensible partial answer, not a confident false claim. Documented gap, not patched — forcing a boundary here would invent a denial the evidence does not support.',
  },
  {
    id: 'R08', domain: 'Online Registry',
    question: 'What is the difference between presence and activity in the Online Registry?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'R09', domain: 'Online Registry',
    question: 'If two people import into the same archive at the same time, will there be a conflict warning?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'R10', domain: 'Online Registry',
    question: 'Does QMZ sorting show up as activity to other operators?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'R11', domain: 'Online Registry',
    question: 'Do I need to log in to use the Online Registry?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'R12', domain: 'Online Registry',
    question: 'Is authentication required for the relay server?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'none',
    knownLimitation: 'The "no authentication by default" fact (AI-WF-006) is architectural narrative, not phrased as a queryable capability status anywhere — zero match (UNKNOWN) is the safe, honest outcome; ground truth corrected from the original draft (which mis-framed this as a capability AVAILABLE/NOT_SUPPORTED question).',
  },
  {
    id: 'R13', domain: 'Online Registry',
    question: 'Can someone see my photos over the network while I\'m importing?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'R14', domain: 'Online Registry',
    question: 'What happens if my internet goes down mid-import?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — was weak; now an untied strong match on AI-FEAT-018 (Event-Component Import Routing), via a narrow, low-document-frequency coincidental overlap on "happens"+"import" (2 of 369 records). Topically adjacent (import processing) but not precisely about connectivity/offline resilience. Not chased further with a new stopword, per this project\'s established discipline against accumulating question-specific keyword exceptions for narrow, isolated collisions — documented as an acceptable imprecision, not a harmful regression (the answer is not false, only imprecise).',
  },
  {
    id: 'R15', domain: 'Online Registry',
    question: 'Does sync block if the relay is offline?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'R16', domain: 'Online Registry',
    question: 'How does archive locking differ from the Online Registry?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'R17', domain: 'Online Registry',
    question: 'If the archive is locked, does the Online Registry show that?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'strong',
    knownLimitation: 'Genuinely unconfirmed either way: no canonical record states whether archive-lock status is surfaced inside the Online Registry UI specifically. The engine confidently answers AVAILABLE (strong, via AI-FEAT-045) — this OVERCLAIMS a combined fact neither AI-FEAT-045 nor AI-WF-006 individually confirms. A real, disclosed retrieval-precision limitation (compound-claim verification is beyond pure keyword matching) — same class as the already-documented Q17 negation-context limitation. Candidate for a future boundary once/if the Registry\'s lock-status surfacing is confirmed one way or the other; not patched speculatively here.',
  },
  {
    id: 'R18', domain: 'Online Registry',
    question: 'Can I tell if a teammate is online right now?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — was weak; now an untied strong match on AI-FEAT-027 (Activity Log). This is a genuine improvement, not a coincidence: Part 1\'s Purpose Capture forensically confirmed AI-FEAT-027 has a real "Team Live" tab showing live operator presence, so this Summary content is legitimately relevant to a presence question, even though the phrasing doesn\'t trigger the dedicated TEAM_ACTIVITY question-type classifier (which would route to AI-WF-006 instead).',
  },
  {
    id: 'R19', domain: 'Online Registry',
    question: 'Does metadata audit activity show up to other operators?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'R20', domain: 'Online Registry',
    question: 'Is there real-time visibility into transfer or export progress from other machines?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'R21', domain: 'Online Registry',
    question: 'What does the Online Registry actually track?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'R22', domain: 'Online Registry',
    question: 'Is conflict detection active in AutoIngest today?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'R23', domain: 'Online Registry',
    question: 'Can two operators edit the same event simultaneously without a warning?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
    knownLimitation: 'CORRECTED ground truth — the registry-conflict-detection boundary correctly fires here (no conflict-warning mechanism is confirmed active for anything, including simultaneous event editing). The original draft\'s UNKNOWN was too conservative; NOT_SUPPORTED with the dormant-conflict-detection citation is the accurate, evidenced answer.',
  },
  {
    id: 'R24', domain: 'Online Registry',
    question: 'Does going offline stop me from importing?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'none',
    knownLimitation: 'Zero match — the question uses "importing" (gerund) rather than "import"; lib/query.js performs no stemming (a pre-existing, structural, shared-ranker characteristic — see DEC-019\'s "reuse lib/query.js unchanged" — not something this stage changes). Safe (no invented claim) but misses surfacing the already-evidenced fact that import/sync do not block on relay unavailability (see R03/R14, which use "import"/"internet" verbatim and do surface a weak, hedged, on-topic answer).',
  },
  {
    id: 'W01', domain: 'Import',
    question: 'How do I use Quick Import for a small batch?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'W02', domain: 'Import',
    question: 'What\'s the difference between Quick Import and regular import?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'W03', domain: 'Archive operations',
    question: 'How do I recover from an archive lock error?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'W04', domain: 'Archive operations',
    question: 'My archive says it is locked, what do I do?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'W05', domain: 'QMZ',
    question: 'How do I sort QMZ photographs?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'W06', domain: 'QMZ',
    question: 'What is the QMZ sorting workflow?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'W07', domain: 'Transfer',
    question: 'How do I export photos to a transfer drive?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'W08', domain: 'Transfer',
    question: 'How do I update an existing transfer drive?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'W09', domain: 'Events',
    question: 'Where do I go to edit event details?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'strong',
    knownLimitation: 'No feature or workflow record documents an event-details editing screen; weak generic tie via AI-FEAT-010. Honest documentation gap (same class as Q05/P05a), not a retrieval defect — Settings/event-editing UI workflows remain a disclosed, not-yet-authored area (see docs/product/workflows/README.md "Not yet covered").',
  },
  {
    id: 'W10', domain: 'Events',
    question: 'Can I rename an event after creating it?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'weak',
    knownLimitation: 'Same event-editing documentation gap as W09.',
  },
  {
    id: 'W11', domain: 'Settings',
    question: 'How do I find the settings screen?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'weak',
    knownLimitation: 'No Settings-screen workflow exists yet (disclosed gap in workflows/README.md); weak generic tie via AI-WF-002/003/006 sharing only common words.',
  },
  {
    id: 'W12', domain: 'Settings',
    question: 'Where are AutoIngest preferences located?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — was a zero-match (UNKNOWN) safe decline; now a single weak, heavily-hedged match on AI-FEAT-013 ("this may not directly answer what you asked", confidence 0.1). Honest about its own uncertainty, not a false claim — an inherent recall/precision trade-off of richer indexing.',
  },
  {
    id: 'W13', domain: 'Metadata',
    question: 'How do I check the status of a metadata repair?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'W14', domain: 'Import',
    question: 'What are the steps to import from a memory card?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
    knownLimitation: 'IMPROVED during Phase 24 — same EXPLANATION-type workflow-preference broadening as P04a. Now correctly, strongly matches AI-WF-001.',
  },
  {
    id: 'W15', domain: 'Import',
    question: 'How do I verify an import completed successfully?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'strong',
    knownLimitation: 'AI-WF-007 (QMZ)\'s "verify sequence" language happens to keyword-overlap with "verify an import completed" — an on-topic-adjacent but not exactly right Workflow citation. Not a false claim (import verification broadly is a real, sensible operator concern), but imprecise. A candidate for a dedicated verification-step Workflow in a future stage, not patched here.',
  },
  {
    id: 'T01', domain: 'Import',
    question: 'hw do i imprt photos',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'none',
    knownLimitation: 'Misspelled ("hw do i imprt photos") produces zero match — safe (UNKNOWN) but unhelpful; lib/query.js performs no fuzzy/typo correction (a pre-existing, structural, shared-ranker characteristic, not addressed in this stage).',
  },
  {
    id: 'T02', domain: 'Import',
    question: 'improt video?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'none',
    knownLimitation: 'Same misspelling-tolerance gap as T01 ("improt video?").',
  },
  {
    id: 'T03', domain: 'QMZ',
    question: 'wats qmz',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'T04', domain: 'Backup',
    question: 'backup auto?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'T05', domain: 'Unsupported',
    question: 'linux support?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'T06', domain: 'Unsupported',
    question: 'face recognision',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'T07', domain: 'Settings',
    question: 'multi user roles?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'T08', domain: 'Archive operations',
    question: 'archive lock error fix',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'T09', domain: 'Transfer',
    question: 'transfer drive update how',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'T10', domain: 'Online Registry',
    question: 'whos online',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
  },
  {
    id: 'X01', domain: 'Adversarial',
    question: 'Does AutoIngest use AI to organize my photos?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — was a zero-match (UNKNOWN) safe decline; now a single weak, heavily-hedged match on AI-FEAT-011 (confidence 0.1). Honest weak/hedged gap, not a confident false claim — same pattern already accepted for X02.',
  },
  {
    id: 'X02', domain: 'Adversarial',
    question: 'Is my data encrypted at rest?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'weak',
    knownLimitation: 'No evidence either way on encryption-at-rest; weak match via AI-FEAT-004 (event.json contract) sharing only the generic word "data". Honest weak/hedged gap, not a confident false claim.',
  },
  {
    id: 'X03', domain: 'Adversarial',
    question: 'Does AutoIngest have a mobile app?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — was a zero-match (UNKNOWN) safe decline; now weakly tied among AI-FEAT-014/019/022/029/039 (confidence 0.1). Honest weak/hedged gap, not a confident false claim.',
  },
  {
    id: 'X04', domain: 'Adversarial',
    question: 'Can I use AutoIngest without an archive root configured?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'strong',
    knownLimitation: 'No evidence either way on running without an archive root configured; matches the already-disclosed generic "archive" bare-token retrieval-precision gap (see AI-FEAT-058 Stage 2 Future Enhancements) rather than being a new, distinct defect.',
  },
  {
    id: 'X05', domain: 'Adversarial',
    question: 'Does the Online Registry replace the archive as the source of truth?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'X06', domain: 'Adversarial',
    question: 'If presence shows someone online, are they editing my files right now?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'X07', domain: 'Adversarial',
    question: 'Does activity visibility mean my photos are being uploaded somewhere?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'X08', domain: 'Adversarial',
    question: 'Is conflict:warning something I will see in the app today?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'X09', domain: 'Adversarial',
    question: 'Can AutoIngest merge two archives together?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak',
    knownLimitation: 'CHANGED 2026-08-14 (Part 2 Decision 2) — was a zero-match (UNKNOWN) safe decline; now weakly tied among AI-FEAT-021/027/047 (confidence 0.1). Honest weak/hedged gap, not a confident false claim.',
  },
  {
    id: 'X10', domain: 'Adversarial',
    question: 'Does AutoIngest support RAW file formats?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'weak',
    knownLimitation: 'No evidence either way on RAW format support; weak match via AI-FEAT-013/025 sharing only generic tokens. Honest weak/hedged gap.',
  },
];

module.exports = { CORPUS_V2 };
