'use strict';

// ASK AUTOINGEST — CHECKPOINT 8. FROZEN AGENT-RELIABILITY PROBE.
// 20 scenarios, each targeting one specific agent-execution behavior named
// in the checkpoint brief. Run identically, unmodified, against every
// candidate model before any candidate proceeds to full acceptance.

module.exports = [
  // 1. must call one tool
  { id: 'R01_one_tool', probe: 'must call one tool', turns: ['What does Archive Health Reporting do?'] },
  // 2. must call two tools (search then status)
  { id: 'R02_two_tools', probe: 'must call two tools', turns: ['Is Duplicate Detection actually available right now?'] },
  // 3. must search, inspect candidate, then answer
  { id: 'R03_search_inspect_answer', probe: 'search, inspect, answer', turns: ['How does an operator recover from a stale archive lock?'] },
  // 4. must search, find ambiguity, then clarify
  { id: 'R04_ambiguous_clarify', probe: 'ambiguity -> clarify', turns: ['my thing broke'] },
  // 5. clarification reply "yes"
  { id: 'R05_reply_yes', probe: 'clarification reply yes', turns: ['I have an import problem.', 'Is it a duplicate file warning?', 'yes'] },
  // 6. clarification reply "no"
  { id: 'R06_reply_no', probe: 'clarification reply no', turns: ['I have an import problem.', 'Is it a duplicate file warning?', 'no'] },
  // 7. pronoun follow-up
  { id: 'R07_pronoun_followup', probe: 'pronoun follow-up', turns: ['What is Source Cleanup?', 'When does it run?'] },
  // 8. topic change
  { id: 'R08_topic_change', probe: 'topic change', turns: ['How do I export a transfer drive?', 'actually, different question -- can two operators import at once?'] },
  // 9. roadmap lookup
  { id: 'R09_roadmap', probe: 'roadmap lookup', turns: ['What is planned right after Archive Maintenance?'] },
  // 10. unsupported capability
  { id: 'R10_unsupported', probe: 'unsupported capability', turns: ['Can AutoIngest text me a report every night?'] },
  // 11. technical lookup
  { id: 'R11_technical', probe: 'technical lookup', turns: ['What file does QMZ use to store its sequence codes?'] },
  // 12. tool result returns UNKNOWN
  { id: 'R12_unknown_status', probe: 'status returns UNKNOWN', turns: ['Does AutoIngest support drone photo import?'] },
  // 13. search returns competing candidates
  { id: 'R13_competing_candidates', probe: 'competing candidates', turns: ['How does AutoIngest keep track of who imported what?'] },
  // 14. first search is weak, requires re-search
  { id: 'R14_weak_first_search', probe: 'weak search -> re-search', turns: ['does it catch photos I already brought in before'] },
  // 15. answer requires using previously retrieved knowledge (no new tool call)
  { id: 'R15_reuse_prior_knowledge', probe: 'reuse prior retrieved knowledge', turns: ['What is Checksum-Based File Verification?', 'Is that automatic?'] },
  // 16. model must not ask permission to continue
  { id: 'R16_no_permission_asking', probe: 'must not ask permission', turns: ['What are the exact steps to recover from a stale archive lock error?'] },
  // 17. model must not say "I'll check" and stop
  { id: 'R17_no_bare_stall', probe: 'must not stall', turns: ['My transfer stopped halfway.', 'Transfer Export.', 'Yes, the NAS disconnected.'] },
  // 18. model must not emit empty answer after a tool
  { id: 'R18_no_empty_after_tool', probe: 'no empty answer after tool call', turns: ['What triggers a checksum verification during Transfer Export, and is it automatic?'] },
  // 19. tool call arguments must be valid
  { id: 'R19_valid_tool_args', probe: 'valid tool-call arguments', turns: ['Compare Backup Update Scanning and Archive Health Reporting for me.'] },
  // 20. model-control syntax must never appear in visible output
  { id: 'R20_no_protocol_leak', probe: 'no protocol leak in visible output', turns: ['What does Photographer-Folder Resolution do, and can I undo what it does?'] },
];
