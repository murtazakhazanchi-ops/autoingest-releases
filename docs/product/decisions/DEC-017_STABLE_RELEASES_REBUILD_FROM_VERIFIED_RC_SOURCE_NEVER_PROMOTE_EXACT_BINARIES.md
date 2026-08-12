# DEC-017 — Stable Releases Rebuild From Verified-RC Source; Never Promote Exact Binaries

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-057 / AI-RM-010 |
| Status | Accepted |
| Date | 2026-08-12 |
| Evidence status | Verified from `package.json`'s `build` config and `electron-builder`/`electron-updater`'s installed source (`node_modules/app-builder-lib`, `node_modules/electron-updater`, `node_modules/electron-publish` — the `createRelease()` omitting `target_commitish` specifically lives in `electron-publish`, a separate installed package `app-builder-lib` calls into, not `app-builder-lib` itself) |

## Context

Part 9's RC promotion requirement calls for "ideal provenance: commit SHA → RC build → QA verification → approval → Stable release," and explicitly asks whether the exact built RC artifact can be safely promoted to Stable or whether a rebuild is required. This needed a real investigation, not an assumption — the answer determines whether Stable publication re-uses RC binaries or rebuilds from source.

## Options Considered

1. **Exact-binary promotion** — take the already-built, already-tester-verified RC artifact (the literal `.exe`/`.dmg`/`.zip` bytes) and re-upload it under the Stable tag/release, changing only the GitHub-side release metadata (tag, `prerelease` flag). Appealing because it guarantees the Stable binary is byte-identical to what QA actually tested — zero risk of a rebuild introducing any difference.
2. **Rebuild from the exact same source commit, version string only changed** — take the RC's own source tree (the exact commit it was built from), change nothing except `package.json`'s version field (`X.Y.Z-rc.N` → `X.Y.Z`), and build fresh Windows/macOS artifacts through the normal Stable pipeline.

## Decision

**Option 2 — rebuild from the verified RC's exact source commit, changing only the version string.** Option 1 is not safe for this project and was rejected.

Reasoning, verified rather than assumed: the app's own version string is embedded inside the shipped artifact in multiple places electron-builder controls at build time — the asar-bundled `package.json` (which is exactly what `electron-updater`'s `AppUpdater.currentVersion` reads at runtime via `ElectronAppAdapter.js`'s `app.getVersion()`), the Windows NSIS/EXE version resource, and macOS's `Info.plist`. Re-uploading the literal RC bytes under a Stable tag would leave the *running app* still reporting itself as `X.Y.Z-rc.N` forever — silently breaking `allowPrerelease`'s own version-based default (`hasPrereleaseComponents(currentVersion)`, `AppUpdater.js`) for that install, and misleading support/telemetry about what version a user is actually running. electron-builder has no supported operation for "take this already-built artifact and relabel its internal version metadata in place" — building is the only place that metadata is written.

Signing was investigated as a *second* potential blocker and ruled out: this repository has no code-signing configured for either platform today (`identity: null`, `hardenedRuntime: false` on macOS; no `certificateFile`/`forceCodeSigning` on Windows — confirmed from `package.json`'s `build.mac`/`build.win`). If signing were configured, promotion would additionally require either re-signing the artifact post-hoc (fragile, effectively unsupported by electron-builder as a first-class operation) or accepting a rebuild anyway — but in this repository, version metadata is the *only* real blocker, and it is a hard one regardless of signing posture.

Since the source *code* under test doesn't change between RC and Stable in this model (only the version string), this is not "rebuilding from scratch and hoping it matches" — it is provably the same source QA verified, confirmed by a release gate rather than trusted:

```
git diff <verifiedRcCommit> <stableCommit> -- . ':!package.json' ':!package-lock.json'
```

must be empty. `releaseIntelligence.checkChannelReleaseGate({channel:'stable', verifiedRcCommit, ...})` enforces this and blocks Stable publication on any non-empty diff unless an explicit `--override-drift-check "<reason>"` is supplied (never a silent skip).

## Consequences

- Stable publication always requires a real build step from source — there is no "just re-tag the RC's artifacts" shortcut, even when doing so would save CI time.
- The release gate's drift check gives this guarantee teeth: a Stable release whose source has diverged from its cited verified-RC commit is blocked by default, not merely discouraged by process documentation.
- A Stable release with no preceding RC (e.g. an emergency hotfix) is still possible, but must pass `--override-drift-check` with an explicit, recorded reason — the override itself becomes part of the release's own audit trail rather than an invisible exception.
- If this project ever adds real code signing for either platform, this decision's reasoning should be re-verified — signing may introduce an *additional* reason rebuild-from-source is required (or, depending on the signing tool, might not) — but it does not currently drive the decision.

## Reconciliation Note

[DEC-018](DEC-018_PART_9_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM_DESIGN_AND_IMPLEMENTATION.md) (auto-drafted from the Part 9 design-session conversation, ENG-CONV-0004) restates this decision's own promotion-model conclusion at summary level alongside four other, broader Part 9 decisions this record does not cover. This record remains the authoritative, detailed source for the promotion-model reasoning specifically — see DEC-018's own Reconciliation Note.
