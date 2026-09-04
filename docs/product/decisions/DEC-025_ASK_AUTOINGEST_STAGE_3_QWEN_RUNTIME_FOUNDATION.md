# DEC-025 — Ask AutoIngest Stage 3: Qwen Runtime Isolation Boundary, Cancellation Strategy, and Honest Acquisition State

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-058 / AI-RM-011 |
| Status | Accepted |
| Date | 2026-09-04 |
| Evidence status | Verified from code (`services/qwenRuntime/*.js`) and this module's own test suite (`test/qwenRuntime*.test.js`, 56 tests, 0 failures) — plus a direct `grep`-audit of the module tree confirming the isolation claims below are mechanically true, not merely documented |

## Context

The Product Owner authorized "Stage 3: Qwen Runtime + Model Lifecycle Foundation" — productionizing the single learned AI runtime (Qwen3.5-4B-Instruct Q4_K_M, the exact Checkpoint 12/14 qualification artifact) as its own isolated module, explicitly forbidding any Knowledge Base integration, conversational orchestrator, IPC, or UI work (that is Stage 4+ territory). Three real architectural choices had to be made and justified before writing the lifecycle code, and one further finding was honestly disclosed rather than worked around.

## Options Considered — Runtime Process Boundary

**1. Load node-llama-cpp directly in Electron's main process.**
- Rejected: a native-addon crash (a real, disclosed risk for this exact runtime — see the cancellation finding below) would kill the entire application, not just the AI feature. This is the same reasoning `services/localJudge/runtime.js` (Gemma's own, already-production coordinator) already established for the existing local-judge runtime; Qwen inherits it rather than re-deriving it from scratch.

**2. Load node-llama-cpp in a Node.js `worker_threads` Worker.**
- Rejected: worker threads share the parent process's memory space. A native (non-JS) crash inside the addon is not isolated by `worker_threads` the way it is by a genuinely separate OS process — it can still bring down the host process. This would not actually solve the problem Option 1 was rejected for.

**3. Load node-llama-cpp inside an Electron `utilityProcess` (chosen).**
- A `utilityProcess` is a genuinely separate OS process with its own memory space and its own crash domain, while still integrating with Electron's app lifecycle and offering structured `parentPort` messaging — exactly the isolation boundary Options 1/2 lack, and exactly the boundary Gemma's own runtime already uses in production. Reusing an already-proven pattern (not inventing a new one) for a second model runtime with the same risk profile.

## Options Considered — Cancellation Strategy

**1. Wire an `AbortSignal` into node-llama-cpp's `session.prompt()` via its own `signal`/`stopOnAbortSignal` option, so a cancelled request genuinely interrupts the native generation.**
- Rejected, based on real prior evidence, not speculation: this exact approach was tried against Gemma's runtime (predecessor of the current node-llama-cpp line this project depends on) and reverted after a reproduction matrix found it turns an intermittent native crash (an occasional SIGABRT inside `model.dispose()`) into an almost-100%-reproducible crash with a *different*, more severe signature — SIGBUS/EXC_BAD_ACCESS inside `context.dispose()` itself, immediately after an actively-interrupted generation. This is a genuine upstream synchronization gap between node-llama-cpp's abort-signal early-stop path and native (Metal) context teardown, not a defect in this project's own integration code.

**2. Never wire an `AbortSignal` into the child's generation call; the parent instead stops *waiting* on cancellation and silently discards the eventual late result (chosen).**
- The child keeps generating for the now-abandoned request in the background; its result finds no entry in the parent's `_pending` map (already deleted on cancel) and is discarded as a safe no-op. The caller sees an immediate `INFERENCE_CANCELLED` rejection; the next queued request is never blocked by the abandoned generation, since the FIFO queue only waits for the *cancelling* promise to settle, which happens immediately. This reproduces Gemma's own hard-won mitigation exactly (`services/localJudge/runtimeWorker.js`'s own documented header), rather than re-discovering the same crash independently for a second model.

Both choices — process boundary and cancellation strategy — are directly reused *design patterns* from the already-production-proven Gemma runtime, not shared code: `services/qwenRuntime/*` never `require()`s `services/localJudge/*` (verified: zero such references anywhere in the new module tree, confirmed by `grep`), and `services/localJudge/*` is not modified by this stage.

## Decision — Context Size, Chat Wrapper, and Acquisition Honesty

3. **`CONTEXT_SIZE = 24576`** is pinned as an explicit constant in `services/qwenRuntime/modelManifest.js` and passed explicitly to every `createContext()` call in the isolated child (`runtimeWorker.js`) — never left to node-llama-cpp's own implicit default, which is exactly the anti-pattern the existing Gemma worker has (no explicit `contextSize` argument today). 24576 is the Checkpoint 14 qualified production-candidate context size, not a newly-chosen value.
4. **`QwenChatWrapper({ variation: '3.5', thoughts: 'discourage' })`** is the exact, real, qualified Checkpoint 12/14 configuration — verified directly against the installed `node-llama-cpp@3.20.0` package's own `QwenChatWrapper.d.ts`, not assumed from memory. `thoughts: 'discourage'` means chain-of-thought reasoning content is never exposed by this runtime.
5. **No download source is configured for the qualified Qwen artifact.** `DOWNLOAD_SOURCE_STATE = 'NOT_CONFIGURED'` and `DOWNLOAD_URL = ''` are real, tested, first-class states (`modelManager.getDownloadAvailability()`, and `download()` itself refuses with a typed `DOWNLOAD_NOT_CONFIGURED` error) — never a fabricated or guessed URL standing in for a real one. The exact qualified artifact (2,740,937,888 bytes, SHA-256 `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`) was confirmed absent from this development machine by an exhaustive filesystem search before this decision was written down, not assumed present.
6. **Verification-cache invalidation is stricter than a size/hash check alone**: a sidecar (`<filename>.verified.json`) is trusted as READY only when its recorded SHA-256/size match the pinned identity **and** the on-disk file's own current size **and** mtime, **and** the sidecar's own `manifestVersion` matches the current manifest. Any one of these drifting (external tampering, a rewrite-in-place, or a future pinned-identity change) invalidates the cache — proven by dedicated tests, not merely asserted (`test/qwenRuntimeModelManager.test.js`'s mtime-tamper and manifestVersion-mismatch cases).

## Consequences

- `services/qwenRuntime/runtime.js` (the parent-side coordinator) never itself `require()`s `node-llama-cpp` — confirmed by direct `grep`: the only actual `await import('node-llama-cpp')` call in the entire new module tree is inside `runtimeWorker.js`, which only ever executes inside the isolated child process. The main process's own crash domain is mechanically kept clear of the native addon, not just documented as such.
- A caller (Stage 4+) that wants genuine mid-generation interruption does not get it from this runtime — cancellation is "stop waiting," not "stop generating." This is an accepted, disclosed limitation carried forward from Gemma's own runtime, not resolved by this stage. A future revisit should re-check node-llama-cpp's own release notes for an upstream fix before retrying signal-based interruption.
- Until a real, byte-verified download source is resolved and explicitly approved (mirroring the existing `main/askAutoIngest.js` `PRODUCTION_DOWNLOAD_SOURCE_APPROVED` gate pattern for Gemma), the only way to make this runtime `READY` is to place the exact qualified artifact at the resolved path manually and call `verify()` — an intentional, disclosed gap, not an oversight.

## Reconciliation Note

None recorded — this stage introduces no new production callers and modifies no existing production file, so there is no existing technical-doc claim to reconcile against.
