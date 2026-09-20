'use strict';

// ASK AUTOINGEST — CHECKPOINT 10: FIND THE ONE AUTOINGEST BRAIN. EXPERIMENTAL.
//
// Reuses validatorC9.js's structural checks UNMODIFIED (handle-leak,
// internal-id-leak, literal-tool-call-syntax-leak, capability-grounding,
// invalid-handle-derived-conclusion, process-narration) -- none of that
// logic is model-specific, all of it stays correct for any candidate.
//
// The ONE piece that IS model-specific -- protocol/control-token
// containment -- must be rebuilt per chat-wrapper family, exactly as
// Checkpoint 7 did for Gemma4ChatWrapper. validatorC9.js's own
// containProtocolArtifacts is Gemma4-specific (traced from
// Gemma4ChatWrapper's real vocabulary) and would be WRONG for the Qwen
// family's own different control tokens -- reusing it here would silently
// fail to strip a real Qwen-family leak. This file replaces it with a
// version traced directly from node-llama-cpp 3.20.0's own installed
// QwenChatWrapper.js source (not assumed, not copied from documentation),
// covering BOTH its "3" (Qwen3/Hermes-4) and "3.5" (Qwen3.5) function-call
// token shapes, which genuinely differ:
//
//   variation "3"   call: "<tool_call>\n{\"name\": \"...\"" ... "}\n</tool_call>"
//   variation "3.5" call: "<tool_call>\n<function=...>\n<parameter=params>\n...
//                          \n</parameter>\n</function>\n</tool_call>"
//   both:            result: "\n<tool_response>\n...\n</tool_response>"
//   both:            thought: "<think>\n...\n</think>"
//   both:            "<|im_end|>", "<|im_start|>user", "<|im_start|>assistant"

const {
  validateFinalAnswer, checkStructuralLeak, checkCapabilityGrounding,
  checkInvalidHandleConclusion, checkProcessNarration, detectStructuralLeak,
} = require('./validatorC9');

// Whole-segment removal first (content + delimiters), same discipline
// Checkpoint 7 established for Gemma4's <|channel>thought segment -- a
// leaked thought's REASONING CONTENT must never reach the operator either,
// not just its delimiters.
const THOUGHT_SEGMENT_RE = /<think>\n?[\s\S]*?\n?<\/think>/g;

const PROTOCOL_TOKEN_PATTERNS = [
  // variation "3" / Hermes-4 function-call shape
  /<tool_call>\n?\{"name":\s*"/g,
  /"\}\n?<\/tool_call>/g,
  // variation "3.5" function-call shape
  /<tool_call>\n?<function=/g,
  /<\/parameter>\n?<\/function>\n?<\/tool_call>/g,
  /<parameter=params>\n?/g,
  // shared: tool-result segment, thought delimiters (already whole-segment
  // stripped above, kept here too as a defensive bare-token catch for a
  // PARTIAL/malformed emission that the whole-segment regex didn't match)
  /<tool_response>\n?/g,
  /\n?<\/tool_response>/g,
  /<think>\n?/g,
  /\n?<\/think>/g,
  // ChatML structural tokens
  /<\|im_end\|>/g,
  /<\|im_start\|>user/g,
  /<\|im_start\|>assistant/g,
  /<\|im_start\|>/g,
  // narrow generic catch-all for any other ChatML-shaped control token this
  // family might use that isn't individually listed above -- mirrors
  // Checkpoint 7's own generic Gemma4 catch-all, same rationale.
  /<\|[a-zA-Z_][a-zA-Z0-9_]*\|>/g,
];

function containProtocolArtifacts(text) {
  let t = String(text || '');
  let stripped = false;
  if (THOUGHT_SEGMENT_RE.test(t)) stripped = true;
  THOUGHT_SEGMENT_RE.lastIndex = 0;
  t = t.replace(THOUGHT_SEGMENT_RE, '');
  for (const re of PROTOCOL_TOKEN_PATTERNS) {
    if (re.test(t)) stripped = true;
    re.lastIndex = 0;
    t = t.replace(re, '');
  }
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: t, stripped };
}

module.exports = {
  validateFinalAnswer, checkStructuralLeak, checkCapabilityGrounding,
  checkInvalidHandleConclusion, checkProcessNarration, detectStructuralLeak,
  containProtocolArtifacts,
};
