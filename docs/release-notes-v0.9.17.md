# AutoIngest v0.9.17 — QMZ Photographer Attribution and Sequencing Fixes

**Release date:** 2026-11-07
**Build type:** Stable release
**Base:** v0.9.16
**Source commit:** `43737fc440338f46f72cb87f6b7a6ca2210e7bb1` (identical to `v0.9.17-rc.1`)

---

## Overview

v0.9.17 is a correctness release fixing two related QMZ bugs: photographer metadata being corrupted during routine processing, and the Photographer Folder Sequence dialog misidentifying QMZ sequence/holding folders as photographers. Both traced to the same root cause — path-resolution logic that assumed the first folder below an event/component root is always the photographer, which breaks for any event using QMZ sequencing. See [BUG-021](product/bugs/BUG-021_QMZ_SEQUENCE_CONTAINER_MISDETECTED_AS_PHOTOGRAPHER.md) for the full investigation and fix.

---

## 1. QMZ Sequences and Holding Folders Are Now Treated as Containers

QMZ sequence folders (e.g. `01Q`, `02M`) and holding folders (`_Unsequenced`, `Enroute`) are recognized as containers, never as the photographer. Photographer Folder Sequencing now operates on the real, nested photographer folders inside them:

- The "Sequence Photographer Folders" dialog lists the real photographer folders found inside each QMZ sequence/holding folder, not the container itself.
- Applying PC ordering renames only the photographer folders — the sequence/holding container's own name is never touched.
- This applies at every nesting depth QMZ uses: single-component events (photographer directly inside the sequence folder) and multi-component events (photographer inside a sequence folder inside a component folder).

## 2. Routine Metadata Processing Preserves Existing Attribution

QMZ auto-queue, reassignment, moves, reapply, retries, and resume are **routine processing, not an authorized photographer-name change.** They now unconditionally preserve whatever Creator/Artist/By-line is already on a file, even when the folder a file currently sits in resolves to a different photographer:

- Existing attribution is read (sidecar and, for RAW files, the file's own embedded tags) before any write; a read failure is never treated as "absent" and never authorizes an overwrite.
- A genuinely absent attribution is only ever populated from a verified photographer association — never from a sequence/container name.
- Metadata Audit flags suspected corruption (a Creator value that looks like a sequence code) and attribution conflicts (Creator/Artist/By-line disagreeing with each other) as visible warnings in the Audit results list. **Audit never rewrites anything itself** — it reports.
- **Existing damaged attribution is not automatically repaired.** A preview-only repair-plan tool (`scripts/qmz-attribution-repair-plan.js`) proposes corrections for operator review; applying a correction is a separate, explicit, human-approved step, not something this release does automatically. The underlying correction primitive (`applyExplicitAttributionCorrection`) is currently an internal helper, not a completed user-facing approval workflow.

### Known limitation

The "a RAW file's own embedded attribution is unreadable" warning path has automated test coverage but was not reproduced in a live app session — constructing a RAW file that is genuinely unreadable by ExifTool (rather than just missing tags) wasn't practical to do safely against disposable fixtures in this pass. Treat this specific sub-case as unit-verified, not visually confirmed.

---

## Release Artifacts (Stable)

| Artifact | SHA-256 |
|---|---|
| `AutoIngest-Setup-0.9.17.exe` (Windows) | `b2e7cb05a29001b7a6aebff2d650efcfcd707d984872897464a9d19270ad3d01` |
| `AutoIngest-0.9.17-arm64.dmg` (macOS arm64) | `d8a48af4e9ab64e2adfb2f27a2e4ddfb5ab0a61212e2b5224868eb866c48fe61` |
| `AutoIngest-0.9.17-arm64-mac.zip` (macOS arm64) | `80983f9d947f35e9616db7856df1407aefbdcfef193c5ed328f64ba2488ef748` |
| `AutoIngest-0.9.17.dmg` (macOS x64) | `e4ada3bf2099e9ada1d3f1fe6b7beaf414bfd334a1c6ee62aa8f9f0cc816ecfd` |
| `AutoIngest-0.9.17-mac.zip` (macOS x64) | `c150a7e7bffa85c61424e177a6f37ddd779114283f1002d9ca6e4b3f88dfe0ff` |

**macOS builds in this release are unsigned (ad-hoc signed), not notarized.** No Apple Developer signing credentials are provisioned for this project yet (D3, deferred — see `release.yml`'s `allow_unsigned_mac` mechanism). macOS's Gatekeeper will refuse to open these builds by default; after downloading, go to **System Settings → Privacy & Security → Open Anyway** (or right-click the app → Open) to run them. The Windows build is unaffected and installs normally. This was an explicit, one-release decision, not a silent gap — see Release Engineering Notes below.

---

## Release Engineering Notes (internal)

- **Promotion path.** The fix was validated as `v0.9.17-rc.1` (prerelease, built with `allow_unsigned_mac=true`) from branch `release/v0.9.17-rc.1`, then promoted to Stable from the same source commit (`43737fc`) with zero drift beyond the version bump (`31e203d`). The Stable gate auto-discovered `v0.9.17-rc.1` and ran with no override.
- **macOS signing gap is pre-existing, not introduced by this release.** This repository's GitHub Actions secrets contain no macOS code-signing or notarization credentials (`CSC_LINK`, `CSC_KEY_PASSWORD`, or Apple API/notarization keys), and no valid "Developer ID Application" identity exists in the local signing environment either (0 valid identities, only ad-hoc/self-signed certificates). The Stable CI path's `build-mac` job has no bypass for this (by design — only the RC path accepts `allow_unsigned_mac`) and failed at its credential-verification step for this tag, exactly as it did for `v0.9.16`. macOS artifacts for this release were built locally from the exact tagged commit (`npm run dist:mac`, ad-hoc signed, matching this repo's documented DEC-017 local-build default) and uploaded to the GitHub Release directly, with explicit authorization to ship them unsigned for this release.
- **`latest-mac.yml` fix.** The local multi-arch build script runs two separate `electron-builder` invocations (arm64, then x64), each of which writes its own `latest-mac.yml` — the second invocation silently overwrote the first, leaving the x64-only entries in the file actually produced by the build. This was caught and corrected by hand-merging in the arm64 `dmg`/`zip` entries (sha512 independently computed and cross-checked against electron-builder's own x64 output to confirm the method) before uploading, so Apple Silicon installations can still resolve an update. This merge step is a one-off correction for this release, not a change to the build script itself.
- **Version bump.** `package.json` / `package-lock.json` were bumped to `0.9.17` in `31e203d` on `stable/0.9`, since Stable artifacts take their version from `package.json`, consistent with prior releases.
