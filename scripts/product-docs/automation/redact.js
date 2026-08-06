'use strict';

// Best-effort credential/token redaction applied to any free-text field
// before it is written to the audit log or a packet snapshot. This is a
// safety net, not a guarantee — evidence text should never contain secrets
// in the first place — but per the SECURITY section ("redact obvious
// credentials/tokens"), untrusted commit messages, session summaries, and
// test output are all in scope here.
const PATTERNS = [
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI/Anthropic-style secret keys
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"]?[A-Za-z0-9/+_.-]{12,}['"]?/gi,
];

function redactText(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

// Recursively redacts every string value in a plain JSON-shaped object/array.
function redactDeep(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}

module.exports = { redactText, redactDeep };
