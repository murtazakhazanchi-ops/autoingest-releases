# AI-FEAT-001 — Timeline

> Generated artifact — strictly extracted/reformatted from [features/AI-FEAT-001_ELECTRON_APPLICATION_SHELL_SECURITY_MODEL.md](../features/AI-FEAT-001_ELECTRON_APPLICATION_SHELL_SECURITY_MODEL.md)'s own Evolution / Implementation Journal, header table, Known Bugs, and Decisions sections. No new facts. Regenerate with `node scripts/product-docs/cli.js build`.

**Feature**: Electron Application Shell & Security Model

| Date | Event type | Summary | Related IDs | Confidence | Evidence source |
|---|---|---|---|---|---|
| Evidence pending | evidence pending | Theme-detection inline `<script>` moved to `renderer/theme-init.js` (`docs/history.md` v0.8.6) specifically to satisfy `script-src 'self'` — a CSP-compliance fix to this feature's contract, not a new capability. | — | undated | features/AI-FEAT-001_ELECTRON_APPLICATION_SHELL_SECURITY_MODEL.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | `renderer` code accessing `process.platform`/`process.env` directly was a known failure mode under this sandbox model (`docs/failure-patterns.md` #15) — fixed by exposing platform via `contextBridge` and consuming `window.api.platform` instead. This is a durable constraint of this feature, not a one-off bug. | — | undated | features/AI-FEAT-001_ELECTRON_APPLICATION_SHELL_SECURITY_MODEL.md § Evolution / Implementation Journal |

