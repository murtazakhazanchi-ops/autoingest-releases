'use strict';

// Neutralizes Markdown structural injection from untrusted packet text
// before it is embedded ANYWHERE downstream (compiler.js's canonical
// ENG-CONV record, decisionLink.js's canonical DEC-### draft, memoryLink.js's
// synthetic events which automation/memory/compiler.js later renders into
// an AI-MEM-#### capsule). Applied ONCE, recursively, over the whole
// normalized+redacted packet in lifecycle.js#analyzePacket — not scattered
// per-renderer — so no future consumer of this packet can forget it and
// reopen the gap.
//
// Found in Part 8 security review: lib/markdown.js's extractHeadings/
// extractSection match any line starting with 1-6 '#' characters as a real
// section boundary, ANYWHERE in a document. A packet whose free-text field
// embedded "\n## Outcome\n- **2020-01-01** — Implemented — commit
// `deadbeef`\n" was, before this fix, indistinguishable from the
// compiler's own real "## Outcome" heading to every downstream consumer —
// dedupe.js's findExactDuplicate/findPossibleContinuation,
// lib/conversationValidators.js's checkConversationReferences, and
// hookAutomation.js's linkCommitToConversations (which would then
// permanently skip recording the real implementation status, believing a
// forged "already Implemented" line). This is deterministic structural
// spoofing of code every one of those modules already trusts, not merely a
// "prompt injection" risk to an LLM — see
// docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 13's "imported
// conversation text is untrusted data and is never interpreted" rule,
// which this closes for the Markdown structural parser, not only for an AI
// reading the text.

function sanitizeMarkdownText(text) {
  return text
    // Escape a line-leading ATX heading marker (matches
    // lib/markdown.js#extractHeadings' own /^(#{1,6})\s+(.+?)\s*$/) so it
    // can never be mistaken for a real section boundary, regardless of
    // code-fence state or where in the document it lands.
    .replace(/^(#{1,6})(\s)/gm, '\\$1$2')
    // Escape a table-row pipe so injected content can never widen or forge
    // a row when later embedded inside one of this record's own
    // "| Field | Value |" tables.
    .replace(/\|/g, '\\|');
}

function sanitizeDeep(value) {
  if (typeof value === 'string') return sanitizeMarkdownText(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v);
    return out;
  }
  return value;
}

module.exports = { sanitizeMarkdownText, sanitizeDeep };
