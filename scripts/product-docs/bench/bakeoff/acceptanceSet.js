'use strict';

// ASK AUTOINGEST — CONVERSATIONAL MODEL BAKE-OFF ACCEPTANCE SET
// Product Owner checkpoint, 2026-08-24. Benchmark-only file, not shipped,
// not wired into production. Every question is either taken directly from
// the existing, already-verified corpora (lib/knowledgeTestCorpus.js,
// lib/knowledgeTestCorpusV2.js) or from real, already-tested conversational
// scenarios in scripts/product-docs/test/conversationalAsk.test.js — no
// invented/hand-written answers, only real questions against the real
// AutoIngest knowledge base. Each case is a SEQUENCE of one or more user
// turns; a multi-turn case counts as ONE case in the acceptance-set size,
// per the checkpoint's own counting convention.
//
// `expect` per case (used for programmatic scoring, not model-specific
// tuning -- the same expectations apply to every candidate model):
//   status: expected capabilityStatus of the FINAL turn's answer, or null
//     if the case is expected to end in a clarification, or 'ANY' if the
//     deterministic layer's own answer is itself indeterminate/not the
//     point of the case (e.g. UNRELATED).
//   expectClarificationAtTurn: boolean array, one per turn, true if that
//     turn is expected to resolve to a clarification rather than a final
//     answer.
//   expectStepsRelevant: true if the final answer should meaningfully use
//     real steps (checked via lexical overlap with the evidence's own
//     ACTION atoms, not exact match).
//   expectTopicChange: true only for the dedicated TOPIC_CHANGE cases.

const CASES = [
  // ---- DIRECT / DEFINITION ----
  { id: 'D01', category: 'DIRECT', turns: ['What is QMZ?'], expect: { status: 'AVAILABLE', expectClarificationAtTurn: [false] } },
  { id: 'D02', category: 'DIRECT', turns: ['What is Source Selection?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'D03', category: 'DIRECT', turns: ['What is Transfer Export?'], expect: { status: 'AVAILABLE', expectClarificationAtTurn: [false] } },
  { id: 'D04', category: 'DIRECT', turns: ['What is Source Detection?'], expect: { status: 'AVAILABLE', expectClarificationAtTurn: [false] } },
  { id: 'D05', category: 'DIRECT', turns: ["What does 'Collection' mean in AutoIngest?"], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'D06', category: 'DIRECT', turns: ['What is Duplicate Detection?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'D07', category: 'DIRECT', turns: ['What is Archive Folder Adoption?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'D08', category: 'DIRECT', turns: ['What is the Grouping System?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },

  // ---- HOW_TO ----
  { id: 'H01', category: 'HOW_TO', turns: ['How do I sort QMZ photos?'], expect: { status: 'AVAILABLE', expectClarificationAtTurn: [false], expectStepsRelevant: true } },
  { id: 'H02', category: 'HOW_TO', turns: ['How do I import photographs from an SD card?'], expect: { status: 'AVAILABLE', expectClarificationAtTurn: [false], expectStepsRelevant: true } },
  { id: 'H03', category: 'HOW_TO', turns: ['How do I create a new event?'], expect: { status: 'AVAILABLE', expectClarificationAtTurn: [false], expectStepsRelevant: true } },
  { id: 'H04', category: 'HOW_TO', turns: ['Can missing metadata be fixed?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'H05', category: 'HOW_TO', turns: ['How do I recover from a stale archive lock error?'], expect: { status: 'AVAILABLE', expectClarificationAtTurn: [false], expectStepsRelevant: true } },
  { id: 'H06', category: 'HOW_TO', turns: ['How do I update an existing transfer drive instead of doing a fresh export?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },

  // ---- TROUBLESHOOTING ----
  { id: 'T01', category: 'TROUBLESHOOTING', turns: ['My source drive disappeared partway through the import.'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'T02', category: 'TROUBLESHOOTING', turns: ["It didn't copy everything."], expect: { status: 'ANY', expectClarificationAtTurn: [null] } },
  { id: 'T03', category: 'TROUBLESHOOTING', turns: ['Photographer information is missing after import.'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'T04', category: 'TROUBLESHOOTING', turns: ['Metadata repair keeps failing, what do I do?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'T05', category: 'TROUBLESHOOTING', turns: ['Archive lock error, how do I recover?'], expect: { status: 'AVAILABLE', expectClarificationAtTurn: [false], expectStepsRelevant: true } },

  // ---- AMBIGUOUS (single-turn, expect clarification) ----
  { id: 'A01', category: 'AMBIGUOUS', turns: ['My transfer stopped.'], expect: { status: null, expectClarificationAtTurn: [true] } },
  // A02/A04/A05: verified directly (answerQuestion()) to have matchQuality
  // 'none' -- genuinely no corpus evidence, not multiple real ambiguous
  // candidates. Per the C8 architecture's own tested discipline ("with NO
  // semantic evidence available at all... degrades to the pre-C8 safe
  // default (CLEAR) rather than inventing an uncorroborated ambiguity
  // signal" -- conversationalAsk.test.js), the CORRECT behavior here is an
  // honest "not enough evidence" answer, never a clarification -- a
  // clarification would mean inventing candidates that don't exist.
  { id: 'A02', category: 'AMBIGUOUS', turns: ['The drive disappeared.'], expect: { status: 'UNKNOWN', expectClarificationAtTurn: [false] } },
  { id: 'A03', category: 'AMBIGUOUS', turns: ["My files aren't showing."], expect: { status: null, expectClarificationAtTurn: [null] } },
  { id: 'A04', category: 'AMBIGUOUS', turns: ['Something went wrong.'], expect: { status: 'UNKNOWN', expectClarificationAtTurn: [false] } },
  { id: 'A05', category: 'AMBIGUOUS', turns: ["I can't continue."], expect: { status: 'UNKNOWN', expectClarificationAtTurn: [false] } },

  // ---- MULTI-TURN (real, previously-tested scenarios) ----
  {
    id: 'M01', category: 'MULTI_TURN',
    turns: ['My transfer stopped halfway.', 'Transfer Export.', 'The NAS disconnected.'],
    expect: { status: 'AVAILABLE', expectClarificationAtTurn: [true, null, false] },
  },
  {
    id: 'M02', category: 'MULTI_TURN',
    turns: ['What is QMZ?', 'My transfer stopped halfway.'],
    expect: { status: null, expectClarificationAtTurn: [false, true], expectTopicChange: true },
  },
  {
    id: 'M03', category: 'FREE_FORM_FOLLOWUP',
    turns: ['My transfer stopped halfway.', "it's the one where I hand a drive off to someone else, not the one bringing a drive back in"],
    expect: { status: 'ANY', expectClarificationAtTurn: [true, null] },
  },
  {
    id: 'M04', category: 'NOT_SURE',
    turns: ['My transfer stopped halfway.', "I'm not sure."],
    expect: { status: 'ANY', expectClarificationAtTurn: [true, false] },
  },

  // ---- TOPIC CHANGE ----
  {
    id: 'C01', category: 'TOPIC_CHANGE',
    turns: ['How do I import photographs from an SD card?', 'Actually, does AutoIngest support face recognition?'],
    expect: { status: 'NOT_SUPPORTED', expectClarificationAtTurn: [false, false], expectTopicChange: false },
  },
  {
    id: 'C02', category: 'TOPIC_CHANGE',
    turns: ['How do I recover from a stale archive lock error?', "What's coming next for AutoIngest?"],
    expect: { status: 'ROADMAP', expectClarificationAtTurn: [false, false] },
  },

  // ---- FOLLOW-UP (simple continuation, non-ambiguous) ----
  {
    id: 'F01', category: 'FOLLOW_UP',
    turns: ['How do I recover from a stale archive lock error?', 'Can I resume it afterward?'],
    expect: { status: 'ANY', expectClarificationAtTurn: [false, null] },
  },
  {
    id: 'F02', category: 'FOLLOW_UP',
    turns: ['My transfer stopped halfway.', 'Transfer Export.', 'What should I do next?'],
    expect: { status: 'ANY', expectClarificationAtTurn: [true, null, null] },
  },

  // ---- CAPABILITY / STATUS ----
  { id: 'S01', category: 'CAPABILITY', turns: ['Does AutoIngest support face recognition?'], expect: { status: 'NOT_SUPPORTED', expectClarificationAtTurn: [false] } },
  { id: 'S02', category: 'CAPABILITY', turns: ['Can I back up to the cloud?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'S03', category: 'CAPABILITY', turns: ['Does the archive get backed up automatically?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'S04', category: 'CAPABILITY', turns: ['Does AutoIngest support telemetry?'], expect: { status: 'ANY', expectClarificationAtTurn: [null] } },
  { id: 'S05', category: 'CAPABILITY', turns: ['Is there a Linux version?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'S06', category: 'CAPABILITY', turns: ['Can different people log in with their own roles?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },

  // ---- ROADMAP ----
  { id: 'R01', category: 'ROADMAP', turns: ["What's coming next for AutoIngest?"], expect: { status: 'ROADMAP', expectClarificationAtTurn: [false] } },
  { id: 'R02', category: 'ROADMAP', turns: ['Is Archive Maintenance available yet?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },

  // ---- WHY / EXPLANATION ----
  { id: 'W01', category: 'EXPLANATION', turns: ['Why is QMZ separate from normal Event Import?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'W02', category: 'EXPLANATION', turns: ['Why does Transfer Import exist?'], expect: { status: 'AVAILABLE', expectClarificationAtTurn: [false] } },

  // ---- TECHNICAL (legitimate technical question) ----
  { id: 'X01', category: 'TECHNICAL', turns: ['Where does QMZ store its sequencing state?'], expect: { status: 'AVAILABLE', expectClarificationAtTurn: [false] } },
  { id: 'X02', category: 'TECHNICAL', turns: ['What file format does AutoIngest use to store event data?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },

  // ---- INCORRECT ASSUMPTION (question assumes a capability AutoIngest lacks) ----
  { id: 'I01', category: 'INCORRECT_ASSUMPTION', turns: ['How do I turn off face recognition in AutoIngest?'], expect: { status: 'NOT_SUPPORTED', expectClarificationAtTurn: [false] } },
  { id: 'I02', category: 'INCORRECT_ASSUMPTION', turns: ['How do I set up automatic cloud syncing for my archive?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },

  // ---- UNRELATED ----
  { id: 'U01', category: 'UNRELATED', turns: ["What's the weather like today?"], expect: { status: 'ANY', expectClarificationAtTurn: [null] } },
  { id: 'U02', category: 'UNRELATED', turns: ['Can you help me write a Python script to sort a list?'], expect: { status: 'ANY', expectClarificationAtTurn: [null] } },

  // ---- Additional DIRECT / HOW_TO / TROUBLESHOOTING coverage (clear the 50-case minimum) ----
  { id: 'D09', category: 'DIRECT', turns: ['What is Archive Lock Handling & Stale-Lock Recovery?'], expect: { status: 'AVAILABLE', expectClarificationAtTurn: [false] } },
  { id: 'H07', category: 'HOW_TO', turns: ['How do I use Quick Import for a small batch?'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
  { id: 'T06', category: 'TROUBLESHOOTING', turns: ['QMZ sequence numbers look wrong after sorting.'], expect: { status: 'ANY', expectClarificationAtTurn: [false] } },
];

module.exports = { CASES };
