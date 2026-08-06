'use strict';

// Minimal section-aware Markdown editing helpers. Deliberately narrow:
// these only ever APPEND within an existing section boundary or insert a
// new top-level entry immediately after a known anchor line — they never
// rewrite a whole file, never remove a line, and are idempotent (calling
// twice with the same content is a no-op the second time) so that a
// deterministic repeated `automation finalize` never duplicates an entry.

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Exact-line containment, NOT raw substring — `content.includes(x)` was
// found in code review to silently treat a genuinely different entry as a
// duplicate whenever its full text happens to be a textual prefix of an
// already-present line (e.g. "## 2026-08-05 — Fix login" is a substring of
// an existing "## 2026-08-05 — Fix login flow" heading). Splitting into
// lines and comparing trimmed equality closes that gap.
function containsExactLine(content, line) {
  const target = line.trim();
  return content.split('\n').some((l) => l.trim() === target);
}

// Finds the [start, end) character range of the BODY of a `## <heading>`
// section (the text after the heading line, up to the next `## ` heading
// or end of file). Returns null if the heading isn't found.
function findSectionBody(content, headingText) {
  const headingRe = new RegExp(`^##\\s+${escapeRegex(headingText)}\\s*$`, 'm');
  const m = headingRe.exec(content);
  if (!m) return null;
  const bodyStart = m.index + m[0].length;
  const rest = content.slice(bodyStart);
  const nextHeading = /^##\s+/m.exec(rest);
  const bodyEnd = nextHeading ? bodyStart + nextHeading.index : content.length;
  return { bodyStart, bodyEnd };
}

// Appends `line` (a single Markdown list-item line, e.g. "- 2026-08-05 — ...")
// to the end of an existing section's body, preserving everything else
// byte-for-byte. No-op (returns unchanged content) if the exact line
// already exists anywhere in that section body.
function appendLineToSection(content, headingText, line) {
  const range = findSectionBody(content, headingText);
  if (!range) {
    throw new Error(`Section "## ${headingText}" not found — cannot append`);
  }
  const body = content.slice(range.bodyStart, range.bodyEnd);
  if (containsExactLine(body, line)) return content; // idempotent
  const trimmedBody = body.replace(/\s+$/, '');
  const newBody = trimmedBody.length > 0
    ? `${trimmedBody}\n${line}\n\n`
    : `\n${line}\n\n`;
  return content.slice(0, range.bodyStart) + newBody + content.slice(range.bodyEnd);
}

// Inserts a full new `## ...` entry block immediately after the first
// standalone `---` line in the file (the changelog's documented anchor —
// see docs/product/10_CHANGELOG.md's own "Append newest first" convention).
// No-op if a heading with the exact same first line already exists anywhere
// in the file (idempotent against a repeated finalize).
function insertAfterFirstRule(content, entryBlock) {
  const headingLine = entryBlock.split('\n')[0];
  if (containsExactLine(content, headingLine)) return content; // idempotent
  const ruleRe = /^---\s*$/m;
  const m = ruleRe.exec(content);
  if (!m) throw new Error('No standalone "---" anchor line found to insert after');
  const insertAt = m.index + m[0].length;
  const before = content.slice(0, insertAt);
  const after = content.slice(insertAt);
  return `${before}\n\n${entryBlock.replace(/\s+$/, '')}\n\n---${after.replace(/^\n*/, '\n\n')}`;
}

module.exports = { findSectionBody, appendLineToSection, insertAfterFirstRule };
