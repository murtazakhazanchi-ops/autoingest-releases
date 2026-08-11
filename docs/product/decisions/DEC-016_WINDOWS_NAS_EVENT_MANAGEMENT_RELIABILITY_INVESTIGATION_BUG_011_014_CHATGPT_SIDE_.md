# DEC-016 — Windows/NAS Event Management Reliability Investigation (BUG-011–014) — ChatGPT-side engineering history

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-009, AI-FEAT-010, AI-FEAT-005, AI-FEAT-039, AI-FEAT-022, AI-FEAT-029 |
| Status | Draft — auto-drafted from an imported Engineering Conversation Packet, pending review |
| Date | 2026-08-11 |
| Evidence status | Auto-drafted by Part 8 conversation decision linkage from ENG-CONV-0002; source packet's own recorded evidence cleared the two-alternatives-plus-accepted-solution bar |

## Context

Diagnose and resolve real-Windows/NAS tester reports that Event Management's Existing Events list was failing to populate, newly-created events were not appearing on reopen, previously-selected collections intermittently disappeared, and the Create Event primary action was sometimes missing — using real Windows RC tester builds and app.log evidence rather than assumption — and determine whether the same defect class existed elsewhere in the repository before the next stable release.

## Options Considered

1. **Malformed or missing event.json explains the missing events.** — rejected: The tester supplied a real event.json from the failing archive; live reproduction using that exact file verbatim, plus additional synthetic events, discovered correctly with zero drops.
2. **A mismatch between the event's own Hijri date and the collection's Hijri date filters the event out.** — rejected: No such filter exists in the discovery code path, confirmed both by direct code reading and empirically with a differing-date fixture.
3. **Multi-component/multi-city event structure is mishandled by discovery.** — rejected: A 3-component/3-city synthetic event, and the real 2-component QMZ event, both discovered with 0 drops.
4. **imports[].source.path (Windows local drive paths) is read or validated by discovery and fails.** — rejected: Confirmed imports[] is stripped before this code path even runs.
5. **A 'Current Device' UI filter separate from the raw scan hides events.** — rejected: Traced the full render path and confirmed the Existing Events list is populated purely from the live master:scanEvents result with no additional gate.
6. **The first RC's {ok, events} shape change silently broke a consumer, causing a renderer-side count collapse.** — rejected: Re-audited every consumer of master:scanEvents/scanMasterEvents codebase-wide; both existing consumers already correctly handle the shape.
7. **UNC path resolution of masterPath is malformed on Windows, causing the scan to target the wrong path.** — rejected: Logged and diffed the exact masterPath and nasRoot strings from real tester evidence; not the cause of this specific symptom (distinct from BUG-013's own separate UNC path-comparison finding).
8. **Dirent.isDirectory() misreports directory type on Windows/SMB network mounts (a known Node/libuv bug class).** — rejected: Confirmed via direct source research that Node 20.16.0 (bundled by this project's Electron 30.5.1) already contains an internal fallback for the well-documented UNKNOWN-dirent-type variant, well after the relevant 2020 upstream fix — evidence was mixed, not confirmed as sufficient on its own; defensive hardening was added regardless as a safe, zero-cost improvement.
9. **SMB/NAS latency causes the scan to stall or time out mid-loop.** — rejected: A 10-second heartbeat timer, unaffected by async I/O delays, never fired during the observed silence — ruling out slow-but-eventually-completing async I/O as the mechanism.
10. **A synchronous helper called after the per-entry read (JSON.parse, normalizeEventJson, isValidEventJson, parseEventName, the sort comparator, JSON.stringify diagnostics) is slow enough to explain a multi-second block.** — rejected: Every candidate was individually timed with process.hrtime.bigint(), including under artificial stress (a 5,000-entry inflated imports[] array, the longest real folder name available); none showed any capacity to explain a multi-second block.
11. **IPC serialization / structured-clone incompatibility on the returned events payload causes the failure.** — rejected: Static audit proved every returned field traces back to a JS primitive or JSON.parse() output (which cannot contain a Dirent, Stats, Buffer, Error, Date, function, Promise, BigInt, or Symbol); empirical A/B/C/D IPC round-trip experiments against a 52-event payload (the closest reproduction of the real failing collection's size) all passed cleanly.

## Decision

Normalize event.sequence to the canonical zero-padded string representation at the single point it is first computed inside master:scanEvents, before it reaches resolved.sort()'s comparator.; Keep the stable v* release path completely untouched during the entire investigation; use only the dedicated Windows-tester workflow_dispatch build path for diagnostic RC artifacts.; Run a Repository-wide Canonical Representation Audit after confirming BUG-011's root cause, to check for the same mixed-runtime-type defect class elsewhere.; Close all seven audit findings (L1 HIGH, L2–L7 MEDIUM/LOW) in one consolidated stabilization pass before merging to main and preparing a stable release, rather than deferring any of them.; Merge the stabilization branch into main via a reviewed PR only after all four bugs' documentation accurately reflected only the tester evidence actually exercised — never upgrading a bug's status to hardware-verified beyond what the tester's session actually reached.

## Consequences

Evidence pending — not present in imported packet

## Reconciliation Note

None recorded.

## Review Note

Auto-drafted from an imported conversation (ENG-CONV-0002) — a human or a future agent session should confirm this Status should move to Accepted (or Rejected/Deferred) before this record is relied on as settled. This draft was never triggered by a git hook — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10.
