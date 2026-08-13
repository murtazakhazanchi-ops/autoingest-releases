# BUG-015 — Windows Runner Default PowerShell Shell Mangles electron-builder Dot-Notation CLI Overrides

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-057 (Multi-Channel Release & Update System) |
| Status | Fixed |
| Severity | High |
| Discovered | 2026-08-13 (during the Part 9 live RC pilot, v0.9.12-rc.1 workflow run) |
| Fixed | 2026-08-13 (commit `66469f5`) |
| Evidence status | Verified from the real GitHub Actions run logs (run `31665802774`, job `rc-build-windows`) and confirmed fixed by a second real run (`31666203213`) publishing correctly |

## Symptom

The `rc-build-windows` job in `.github/workflows/release.yml` failed at its "Build and publish Windows RC" step with:

```
⨯ ENOENT: no such file or directory, open 'D:\a\autoingest-releases\autoingest-releases\.publish.releaseType=prerelease'
```

electron-builder was attempting to open a literal file named `.publish.releaseType=prerelease` as a config file, when no such file exists — the step was only ever supposed to pass CLI *overrides*, never a config file path.

## Root Cause

The step ran `npm run dist:win -- -p always -c.publish.channel=rc -c.publish.releaseType=prerelease` with no explicit `shell:` set. `windows-2022` GitHub Actions runners default to `pwsh` (PowerShell) for steps without an explicit shell — every *other* runner OS (Linux, macOS) defaults to `bash`. PowerShell's argument tokenization splits `-c.publish.channel=rc` differently than bash: instead of passing it through as a single token, it reaches electron-builder's CLI parser as two separate tokens (`-c` and `.publish.channel=rc`). electron-builder's `-c` flag (short form of `--config`) accepts *either* a bare boolean-style override (`-c.<path>=<value>`, single token, no space) *or* a config file path (`-c <path>`, two tokens) — with two separate `-c <value>` pairs on the line, the parser resolved `-c` to "config file path" mode and took the *last* value (`.publish.releaseType=prerelease`) as a literal file to load, which doesn't exist.

This exact argument syntax (`-c.publish.channel=rc -c.publish.releaseType=prerelease`) was verified locally during Part 9's original implementation via `npx electron-builder --help` — but that verification happened on macOS (bash), and was never exercised through a Windows runner's default shell until this live pilot. The existing Stable `build-windows` job never hit this because it has never passed a `-c.foo=bar`-style override — it only ever passes `-p always` (no dot, no ambiguity). This made it a genuinely new code path with no prior Windows-shell coverage.

## Investigation Log

- 2026-08-13 — `rc-build-mac` succeeded in the same workflow run; `rc-build-windows` failed. Since both steps pass the identical CLI string, the platform-runner difference (not the argument string itself) was the first suspect.
- 2026-08-13 — Pulled the full step log via `gh run view <id> --job=<id> --log`. Found every other step in the `rc-build-windows` job (`Set ephemeral RC version`, `Release gate (RC)`, `Create service account key`) already declares `shell: bash` explicitly — only the failing "Build and publish Windows RC" step omitted it. Confirmed this was the only structural difference between the working and failing steps.
- 2026-08-13 — Added `shell: bash` to the one step, pushed, re-ran as `v0.9.12-rc.2`. Both `rc-build-windows` and `rc-build-mac` succeeded; verified via `gh release view` and the published `rc.yml`/`rc-mac.yml` that both platforms' assets and channel metadata were correct.

## Fix

Added `shell: bash` to the "Build and publish Windows RC" step in the `rc-build-windows` job, `.github/workflows/release.yml` (commit `66469f5`) — a one-line change, matching the shell every other step in that same job already used.

## Prevention / Reusable Lesson

**Any GitHub Actions step that passes a `-c.<key>=<value>`-style (dot-containing) CLI argument to electron-builder — or any other CLI tool with similar dot-notation override syntax — on a Windows (`windows-*`) runner must set `shell: bash` explicitly.** Do not rely on the platform default; `pwsh` and `bash` tokenize such arguments differently, and the failure mode (a config parser silently trying to load a literal file) does not obviously point back to a shell-parsing issue from the error message alone.

This is currently a *closed* instance, not an open class: verified (during code review of the fix) that no other step in `.github/workflows/release.yml` passes a dot-containing CLI override on a Windows runner without `shell: bash` already set. If a future change adds a new `-c.foo=bar`-style override to `build-windows` (Stable) or `development-build` (currently safe, since they only pass `-p always`/`-p never`), it must add `shell: bash` to that step at the same time, or this bug will resurface silently.

## Related

- [AI-FEAT-057](../features/AI-FEAT-057_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM.md) — the feature this pipeline belongs to; its Evolution section records the live-pilot discovery of this bug.
- [PM-002](../postmortems/PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md) — a different release-pipeline incident (version/tag drift, not a shell/CLI-parsing issue), but the same general lesson applies: a release pipeline's untested branch is a real risk until it's actually exercised once, end to end, on every target platform.
