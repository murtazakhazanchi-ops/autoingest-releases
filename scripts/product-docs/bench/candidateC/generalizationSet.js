'use strict';

// ASK AUTOINGEST — CANDIDATE C GENERALIZATION SET (Product Owner checkpoint,
// 2026-08-25 continuation, Section 12). Experimental, exploratory only --
// NOT the frozen 19-conversation acceptance benchmark (bakeoff/
// conversationTrial.js, untouched, still the acceptance-scoring basis for
// A/B/C). This file is written and frozen BEFORE this run's own frozen-19
// Candidate C results are read/scored (the frozen-19 run was already
// launched and is completing in the background as this file is written --
// no frozen-19 transcript has been read yet) -- so nothing here could have
// been shaped by seeing Candidate C succeed or fail on anything.
//
// Deliberately covers AutoIngest areas and phrasings NOT used verbatim in
// the frozen 19 (different features where the frozen set repeats a feature,
// different phrasing throughout), across every shape Section 12 asks for:
// simple explanation, how-to, troubleshooting, interruption/recovery, vague
// shorthand, follow-up pronouns, topic change, operator correction,
// explicitly technical, unsupported capability, roadmap question, and
// "don't understand, re-explain simpler."
//
// Scored separately from the acceptance benchmark, labeled exploratory, and
// never averaged into the A/B/C acceptance rate.

const GENERALIZATION_CONVERSATIONS = [
  { id: 'G01_simple_explanation', shape: 'simple explanation', turns: ['What is Archive Folder Adoption?'] },
  { id: 'G02_how_to', shape: 'how-to', turns: ['How do I fix incorrect metadata after import?'] },
  { id: 'G03_troubleshooting', shape: 'troubleshooting', turns: ['My metadata repair keeps failing.'] },
  { id: 'G04_interruption_recovery', shape: 'interruption/recovery', turns: ['If my import gets interrupted partway through, do I need to start the whole event over?'] },
  { id: 'G05_vague_shorthand', shape: 'vague shorthand', turns: ["grouping thing wont let me import, says something about sub-events"] },
  { id: 'G06_followup_pronoun', shape: 'follow-up pronouns', turns: ['What is Duplicate Detection?', 'Does it work the same way for Quick Import?'] },
  { id: 'G07_topic_change', shape: 'topic change', turns: ['How do I recover from a stale archive lock error?', "Actually, can other people see what I'm working on right now?"] },
  { id: 'G08_operator_correction', shape: 'operator correction', turns: ['Can I back up automatically to a NAS?', 'No, I mean can I use something like Google Drive or Dropbox instead.'] },
  { id: 'G09_explicitly_technical', shape: 'explicitly technical', turns: ["Where does AutoIngest store the operator's active profile pointer?"] },
  { id: 'G10_unsupported_capability', shape: 'unsupported capability', turns: ['Can AutoIngest auto-tag the people in my photos using AI?'] },
  { id: 'G11_roadmap', shape: 'roadmap question', turns: ['Is the Archive Browser available yet?'] },
  { id: 'G12_interruption_recovery_variant', shape: 'interruption/recovery (different feature than the frozen set\'s own resume question)', turns: ['Can I resume a Transfer Import if the connection drops partway through?'] },
  { id: 'G13_dont_understand', shape: "don't understand / re-explain simpler", turns: ['What is Backup Update Scanning?', "I don't get it, can you explain it more simply?"] },
  { id: 'G14_multiturn_drift', shape: 'multi-turn topic drift within one workflow', turns: ['How do I import photos from a memory card?', 'What about duplicate files -- does it warn me?'] },
];

module.exports = { GENERALIZATION_CONVERSATIONS };
