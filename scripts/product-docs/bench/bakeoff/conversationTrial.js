'use strict';

// ASK AUTOINGEST — NATURAL CONVERSATION MODEL ACCEPTANCE TRIAL
// Product Owner checkpoint, 2026-08-25. Benchmark-only. 19 COMPLETE,
// multi-turn operator conversations, covering every category the
// checkpoint specifies (A-P). Every user turn is either drawn directly
// from the existing verified corpora/tests, or is a natural paraphrase of
// a real, already-corpus-grounded scenario -- no invented AutoIngest
// behavior. The assistant's turns are never scripted; every candidate
// model generates its own, through the exact same, real, unmodified C8
// pipeline (conversationalAsk.js) the model-bake-off harness already uses.
//
// Turn sequences are FIXED (not adaptive to what the assistant says) --
// this is a deliberate simplification: several of these exact scenarios
// were already verified, in this same session, against the real
// deterministic/semantic layers (see conversationalAsk.test.js's own
// worked examples) to reliably produce the clarification path the
// second/third scripted turn is written to resolve. If a model instead
// resolves a turn CONFIDENTLY where the script expected a clarification
// (or vice versa), the next scripted user message still lands as a
// plausible, naturalistic continuation (an operator adding detail
// proactively, or restating themselves) -- and how gracefully the model
// handles that mismatch is itself part of what this trial is judging.

const CONVERSATIONS = [
  { id: 'A_simple_explanation', category: 'A', turns: ['What is QMZ?'] },
  { id: 'B_simple_howto', category: 'B', turns: ['How do I sort QMZ photos?'] },
  { id: 'C_natural_troubleshooting', category: 'C', turns: ['My transfer stopped halfway.', 'Transfer Export.', 'Yes, the NAS disconnected.'] },
  { id: 'D_freeform_clarification', category: 'D', turns: ['I was copying an event to a portable drive and the NAS disappeared.'] },
  { id: 'E_operator_doesnt_know', category: 'E', turns: ['My transfer stopped.', "I'm not sure. I was just copying yesterday's event."] },
  { id: 'F_followup_no_repeat', category: 'F', turns: ['How do I create a Transfer Export?', 'And if it stops halfway?'] },
  { id: 'G_followup_after_answer', category: 'G', turns: ['How do I recover from a stale archive lock error?', 'What should I do after that?'] },
  { id: 'H_topic_change', category: 'H', turns: ['How do I create a Transfer Export?', 'Actually, how do I sort QMZ photos?'] },
  { id: 'I_user_corrects', category: 'I', turns: ['Does AutoIngest back up automatically?', 'Sorry, I meant cloud backup specifically -- like Google Drive or Dropbox, not local copies.'] },
  { id: 'J_dont_understand', category: 'J', turns: ['What is QMZ?', "I don't understand what that means."] },
  { id: 'K_concise_question', category: 'K', turns: ['Can AutoIngest do face recognition?'] },
  { id: 'L_roadmap', category: 'L', turns: ["What's coming next?"] },
  { id: 'M_why_question', category: 'M', turns: ['Why is QMZ separate from normal Event Import?'] },
  { id: 'N_technical_question', category: 'N', turns: ['Where does QMZ store its sequencing state?'] },
  { id: 'O_unsupported_feature', category: 'O', turns: ['Does AutoIngest automatically tag people in photos using AI?'] },
  { id: 'P1_messy_shorthand', category: 'P', turns: ['yo qmz thing not working right, sequence #s messed up'] },
  { id: 'P2_messy_grammar', category: 'P', turns: ['import from sd card how'] },
  { id: 'P3_messy_vague', category: 'P', turns: ['it stopped again ugh, same drive as last time'] },
  { id: 'P4_messy_casual', category: 'P', turns: ['can i resume the export or do i gotta start over'] },
];

module.exports = { CONVERSATIONS };
