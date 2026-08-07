'use strict';

// Vendor-format -> normalized ECP adapters. Every adapter treats its input
// as INERT TEXT/DATA ONLY — never evaluated, never executed, never
// interpreted as an instruction to this importer or any other tool (see
// docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 13). No adapter here
// claims a real vendor API integration; each is a structural transform over
// a file the user has already exported/pasted — see
// docs/product/conversations/README.md for the documented, honest scope of
// each.
//
// Only two real parsers exist: `ecp` (the packet already matches the
// schema) and generic `json`/`markdown` best-effort extraction. Claude
// Code/Claude/Codex/Gemini "adapter profiles" are documentation
// (scripts/product-docs/automation/conversation/README.md), not separate
// code paths — every one of them is expected to hand this importer either a
// native ECP packet or generic JSON/Markdown, per the Part 8 policy's
// tool-neutral design (§ 6).

const { ECP_VERSION, validateEcp, normalizeEcp } = require('./ecp');
const { parseJsonBounded } = require('./fileLoader');

const MAX_EXTRACTED_TEXT_CHARS = 4000; // bounds how much raw text a generic adapter folds into a single field

function truncate(text, max = MAX_EXTRACTED_TEXT_CHARS) {
  if (!text) return text;
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// format: 'ecp' — the file already claims to be an ECP packet.
function parseEcpFormat(raw) {
  const parsed = parseJsonBounded(raw);
  const { valid, errors } = validateEcp(parsed);
  if (!valid) {
    throw new Error(`Import JSON failed ECP schema validation: ${errors.join('; ')}`);
  }
  return normalizeEcp(parsed);
}

// format: 'json' — generic JSON, not a native ECP. Best-effort maps common
// field names (title/summary/goal/messages) into the ECP shape; anything
// unrecognized is left absent, never guessed. Requires at minimum a title
// or a summary/goal-shaped field — otherwise rejected outright (never
// coerced into a plausible-looking packet from nothing).
function parseGenericJson(raw, { projectName }) {
  const parsed = parseJsonBounded(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Generic JSON import must have an object at its root.');
  }
  const title = parsed.title || parsed.conversation_title || parsed.name || null;
  const goal = parsed.summary || parsed.user_goal || parsed.goal || parsed.description || null;
  if (!title && !goal) {
    throw new Error('Generic JSON import has neither a recognizable title nor a summary/goal field — rejected rather than guess-parsed.');
  }
  const draft = {
    ecp_version: ECP_VERSION,
    project: projectName,
    source_tool: SOURCE_TOOL_FROM_HINT(parsed.source_tool) || 'json',
    source_type: 'engineering_conversation',
    conversation_title: title || truncate(String(goal), 120),
    user_goal: goal ? String(goal) : '',
    source_conversation_id: parsed.id || parsed.conversation_id || null,
    explicit_requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [],
    open_questions: Array.isArray(parsed.open_questions) ? parsed.open_questions : [],
    redaction_status: 'pending',
  };
  return normalizeEcp(draft);
}

const KNOWN_SOURCE_TOOLS = new Set(require('./ecp').SOURCE_TOOLS);
function SOURCE_TOOL_FROM_HINT(hint) {
  if (typeof hint === 'string' && KNOWN_SOURCE_TOOLS.has(hint)) return hint;
  return null;
}

// format: 'markdown' — generic Markdown notes (a human meeting note, a
// pasted design doc, a Markdown export from an unsupported tool). Never
// executed as Markdown/HTML; parsed as plain text only. Title = first H1/H2
// heading if present, else the first non-empty line. user_goal = the first
// paragraph. The remaining body becomes a single, size-bounded
// source_evidence entry — used for later human/agent review, never
// expanded into fabricated structured fields the source text doesn't
// actually state.
function parseMarkdown(raw, { projectName }) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Import Markdown file is empty.');
  const lines = trimmed.split('\n');
  const headingLine = lines.find((l) => /^#{1,2}\s+/.test(l));
  const title = headingLine ? headingLine.replace(/^#{1,2}\s+/, '').trim() : lines[0].trim();
  const bodyAfterTitle = headingLine ? lines.slice(lines.indexOf(headingLine) + 1).join('\n').trim() : lines.slice(1).join('\n').trim();
  const firstParagraph = (bodyAfterTitle.split(/\n\s*\n/)[0] || '').trim();
  const draft = {
    ecp_version: ECP_VERSION,
    project: projectName,
    source_tool: 'markdown-notes',
    source_type: 'engineering_conversation',
    conversation_title: truncate(title, 200),
    user_goal: truncate(firstParagraph, 1000),
    source_evidence: [truncate(bodyAfterTitle, MAX_EXTRACTED_TEXT_CHARS)],
    redaction_status: 'pending',
  };
  return normalizeEcp(draft);
}

function parseByFormat(format, raw, opts) {
  switch (format) {
    case 'ecp': return parseEcpFormat(raw);
    case 'json': return parseGenericJson(raw, opts);
    case 'markdown': return parseMarkdown(raw, opts);
    default: throw new Error(`Unsupported import format "${format}"`);
  }
}

module.exports = { parseByFormat, parseEcpFormat, parseGenericJson, parseMarkdown, truncate };
