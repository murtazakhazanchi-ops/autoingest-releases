# ENG-CONV-0002 — Windows/NAS Event Management Reliability Investigation (BUG-011–014) — ChatGPT-side engineering history

## Identity

| Field | Value |
|---|---|
| Conversation ID | ENG-CONV-0002 |
| Title | Windows/NAS Event Management Reliability Investigation (BUG-011–014) — ChatGPT-side engineering history |
| Status | Imported |
| Conversation type | mixed |
| Source tool | chatgpt |
| Source format | ecp |
| Date started | Evidence pending — not present in imported packet |
| Date completed | Evidence pending — not present in imported packet |
| Participants/roles | Evidence pending — not present in imported packet |
| Import date | 2026-08-11T10:35:56.196Z |
| Import session | imp-1786444556102-286050 |
| Provenance classification | Imported packet — no secret pattern detected |
| Redaction status | Applied — automatic secret-pattern scan (no matches) |
| Integrity checksum | 7d044e7498c795e80deec3d7e66745f2279f67094c5e92d6b13d217f2598a492 |

## Repository Context

| Field | Value |
|---|---|
| Repository | AutoIngest |
| Branch | fix/windows-event-management-rc |
| Base commit | Evidence pending — not present in imported packet |
| Head/final commit | e6fe5483404f5332f700a73723c37d04225eae1c |
| Implementation state at time of discussion | Evidence pending — not present in imported packet |

## Relationships

| Field | Value |
|---|---|
| Primary feature IDs | AI-FEAT-009, AI-FEAT-010, AI-FEAT-005, AI-FEAT-039, AI-FEAT-022, AI-FEAT-029 |
| Secondary feature IDs | None |
| Roadmap milestone IDs | None |
| Related bugs | BUG-011, BUG-012, BUG-013, BUG-014 |
| Related decisions | None |
| Related postmortems | None |
| Related memory capsules | AI-MEM-0003 |
| Related releases | None |
| Related conversations | None |
| Related technical docs | None |
| Related source files | None |
| Related tests | None |

## Original Request

- **Why this discussion happened**: Diagnose and resolve real-Windows/NAS tester reports that Event Management's Existing Events list was failing to populate, newly-created events were not appearing on reopen, previously-selected collections intermittently disappeared, and the Create Event primary action was sometimes missing — using real Windows RC tester builds and app.log evidence rather than assumption — and determine whether the same defect class existed elsewhere in the repository before the next stable release.
- **User goal**: Diagnose and resolve real-Windows/NAS tester reports that Event Management's Existing Events list was failing to populate, newly-created events were not appearing on reopen, previously-selected collections intermittently disappeared, and the Create Event primary action was sometimes missing — using real Windows RC tester builds and app.log evidence rather than assumption — and determine whether the same defect class existed elsewhere in the repository before the next stable release.
- **Explicit requirements**: 
  - Every hypothesis must be confirmed or rejected using real evidence (code inspection, local reproduction, or real Windows/NAS tester app.log/screenshots) — not assumption.
  - The stable v* release path must remain untouched during the investigation; only the dedicated Windows-tester workflow_dispatch build path may be used for diagnostic RC artifacts.
  - No public stable release may be created during the investigation.
  - Any accepted fix must be proven by a regression test verified to fail before the fix and pass after it.
  - A discrepancy between diagnostic counters (e.g. IPC array length vs. rendered UI count) must be explicitly investigated and explained, never assumed to be a second bug.
- **Constraints**: 
  - Windows/NAS-specific filesystem and network-mount behavior could not be reproduced on the macOS development environment used for this investigation — required either real tester hardware evidence or documented environment-limitation reasoning.
  - Working Root and Main Archive Root were the same Windows/NAS archive on the tester's machine, which was relevant context for BUG-013's path-containment investigation.

## Initial Understanding

- **Inferred requirements**: Evidence pending — not present in imported packet — not distinguished from explicit requirements by this importer's adapters; see Original Request
- **Evidence-pending items**: 
  - Exact ChatGPT conversation start/completion timestamps.
  - Raw app.log files and tester screenshots referenced in this conversation (described in the packet but not attached to this import).
- **Uncertainties / questions raised at the start**: 
  - Formal 'Verified' status for BUG-011, BUG-012, and BUG-014 still awaits a consolidated real-hardware acceptance pass covering steps the tester's session did not reach (new-event creation flow for BUG-012, footer-mode transitions for BUG-014).
  - L4's original app.log evidence (a mixed-separator string seen in an import-transaction-rollback failure message) was traced to a different, already-correct code path and remains formally unexplained — the L4 finding closed in the stabilization pass is a distinct, newly-discovered pattern, not a confirmed match for that original evidence.

## Initial Proposal

- **First proposed direction**: Decompose the tester's combined symptom report into four separately trackable defects (BUG-011 event discovery, BUG-012 cache invalidation, BUG-013 UNC path containment, BUG-014 footer mode) rather than one large investigation.
- **Expected behavior**: Existing Events populates correctly, new events appear on reopen without reselecting the collection, previously-selected collections remain selectable across restarts, and the Create Event primary action is always present on a valid form.
- **Expected architecture**: Evidence pending — not present in imported packet
- **Acceptance criteria**: Confirmed on real Windows/NAS tester hardware for each bug, not only local reproduction.

## Discussion Evolution

- **Revision 1**
  - Trigger: Real Windows RC verification
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Assumed transient fsp.readdir() failures collapsing into an empty-events shape explained the tester's zero-events report.
  - Revised approach: Reopened the investigation; the fix held but did not explain the tester's actual symptom, so a second, still-undiagnosed defect was pursued.
  - Rationale: 2026-08-08 real-hardware RC verification showed collection discovery succeeded (BUG-013's fix held) but event discovery inside the correctly-selected collection still failed, ruling out the original hypothesis as the primary explanation.
  - Disposition: accepted
- **Revision 2**
  - Trigger: Direct research of Node.js/libuv source at the pinned Electron/Node version
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Suspected Dirent.isDirectory() misreporting on Windows/SMB network mounts (a documented Node/libuv bug class) was the root cause.
  - Revised approach: Confirmed Node 20.16.0 (bundled by this project's Electron 30.5.1) already contains an internal lstat() fallback for the UNKNOWN-dirent-type variant since a 2020 upstream fix; defensive hardening was added regardless but not treated as the confirmed root cause.
  - Rationale: Evidence was mixed — the narrower classic mechanism was very likely already mitigated by the runtime itself.
  - Disposition: accepted (hardening only, not adopted as root-cause fix)
- **Revision 3**
  - Trigger: Real tester app.log showed the per-entry scan loop completing (all entries reaching READ_EVENT_JSON_OK) with no further log lines
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Suspected async filesystem/NAS latency or a stalled per-entry operation inside the scan loop.
  - Revised approach: Shifted investigation to the IPC return/serialization boundary — whether master:scanEvents resolves its own promise and whether the returned payload structured-clones safely.
  - Rationale: A 10-second heartbeat timer (unaffected by async I/O delays) never fired during the observed silence, meaning the JS main thread itself was not returning to the event loop — ruling out slow-but-eventually-completing async I/O as the mechanism.
  - Disposition: accepted
- **Revision 4**
  - Trigger: IPC-boundary instrumentation shipped to a real Windows tester build captured the actual thrown exception
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: IPC boundary/structured-clone serialization suspected as the remaining explanation after all filesystem-stage hypotheses were ruled out.
  - Revised approach: Root cause identified as a mixed sequence runtime type (string vs. number) crashing resolved.sort()'s localeCompare call inside master:scanEvents, after filesystem discovery and event.json parsing had already succeeded for every entry.
  - Rationale: The real tester app.log captured the literal exception "TypeError: b.sequence.localeCompare is not a function", thrown from POST_LOOP_START → SORT_START, across 3 separate scan attempts, all identical.
  - Disposition: accepted
- **Revision 5**
  - Trigger: Recognizing BUG-011 was fundamentally a canonical-representation/type-boundary defect, not a filesystem or IPC defect
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Treat BUG-011 as a one-off, isolated fix scoped to master:scanEvents.
  - Revised approach: Explicitly asked whether the same bug class (a value with more than one legal runtime representation reaching an unguarded comparator/consumer) existed elsewhere in the repository, triggering a Repository-wide Canonical Representation Audit.
  - Rationale: A single-site fix without a systemic check risked leaving the identical defect class dormant elsewhere in the codebase before a stable release.
  - Disposition: accepted
- **Revision 6**
  - Trigger: The audit's results (L1 HIGH, L2–L7 latent findings)
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Release once BUG-011's fix was confirmed on real hardware.
  - Revised approach: Explicitly decided to close all seven audit findings (L1–L7) in one consolidated stabilization pass before the stable release, rather than deferring them.
  - Rationale: L1 in particular (path-containment case-sensitivity) was rated HIGH severity and structurally similar in kind to BUG-013's already-shipped defect.
  - Disposition: accepted

## Alternatives

- **Proposal**: Malformed or missing event.json explains the missing events.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: The tester supplied a real event.json from the failing archive; live reproduction using that exact file verbatim, plus additional synthetic events, discovered correctly with zero drops.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: A mismatch between the event's own Hijri date and the collection's Hijri date filters the event out.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: No such filter exists in the discovery code path, confirmed both by direct code reading and empirically with a differing-date fixture.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: Multi-component/multi-city event structure is mishandled by discovery.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: A 3-component/3-city synthetic event, and the real 2-component QMZ event, both discovered with 0 drops.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: imports[].source.path (Windows local drive paths) is read or validated by discovery and fails.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Confirmed imports[] is stripped before this code path even runs.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: A 'Current Device' UI filter separate from the raw scan hides events.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Traced the full render path and confirmed the Existing Events list is populated purely from the live master:scanEvents result with no additional gate.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: The first RC's {ok, events} shape change silently broke a consumer, causing a renderer-side count collapse.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Re-audited every consumer of master:scanEvents/scanMasterEvents codebase-wide; both existing consumers already correctly handle the shape.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: UNC path resolution of masterPath is malformed on Windows, causing the scan to target the wrong path.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Logged and diffed the exact masterPath and nasRoot strings from real tester evidence; not the cause of this specific symptom (distinct from BUG-013's own separate UNC path-comparison finding).
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: Dirent.isDirectory() misreports directory type on Windows/SMB network mounts (a known Node/libuv bug class).
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Confirmed via direct source research that Node 20.16.0 (bundled by this project's Electron 30.5.1) already contains an internal fallback for the well-documented UNKNOWN-dirent-type variant, well after the relevant 2020 upstream fix — evidence was mixed, not confirmed as sufficient on its own; defensive hardening was added regardless as a safe, zero-cost improvement.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: SMB/NAS latency causes the scan to stall or time out mid-loop.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: A 10-second heartbeat timer, unaffected by async I/O delays, never fired during the observed silence — ruling out slow-but-eventually-completing async I/O as the mechanism.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: A synchronous helper called after the per-entry read (JSON.parse, normalizeEventJson, isValidEventJson, parseEventName, the sort comparator, JSON.stringify diagnostics) is slow enough to explain a multi-second block.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Every candidate was individually timed with process.hrtime.bigint(), including under artificial stress (a 5,000-entry inflated imports[] array, the longest real folder name available); none showed any capacity to explain a multi-second block.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: IPC serialization / structured-clone incompatibility on the returned events payload causes the failure.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Static audit proved every returned field traces back to a JS primitive or JSON.parse() output (which cannot contain a Dirent, Stats, Buffer, Error, Date, function, Promise, BigInt, or Symbol); empirical A/B/C/D IPC round-trip experiments against a 52-event payload (the closest reproduction of the real failing collection's size) all passed cleanly.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

## User Feedback

- **Feedback summary**: Existing Events showed zero/no events despite real events existing on disk.
- **Target area**: Event Management — Existing Events list
- **Impact**: Evidence pending — not present in imported packet
- **Resulting change**: Evidence pending — not present in imported packet
- **Final disposition**: accepted, root-caused as BUG-011

- **Feedback summary**: Newly-created events were not appearing after creation.
- **Target area**: Event Management — event list cache
- **Impact**: Evidence pending — not present in imported packet
- **Resulting change**: Evidence pending — not present in imported packet
- **Final disposition**: accepted, root-caused as BUG-012

- **Feedback summary**: Previously-selected collections intermittently disappeared, falling back to Create Collection.
- **Target area**: Event Management — session archive root path comparison
- **Impact**: Evidence pending — not present in imported packet
- **Resulting change**: Evidence pending — not present in imported packet
- **Final disposition**: accepted, root-caused as BUG-013

- **Feedback summary**: The Create Event primary action button was sometimes completely missing from a valid form.
- **Target area**: Event Management — modal footer mode
- **Impact**: Evidence pending — not present in imported packet
- **Resulting change**: Evidence pending — not present in imported packet
- **Final disposition**: accepted, root-caused as BUG-014

- **Feedback summary**: Diagnostics reported an IPC array length of 37 while the UI displayed only 36 Existing Events.
- **Target area**: Event Management — event discovery diagnostics
- **Impact**: Evidence pending — not present in imported packet
- **Resulting change**: Evidence pending — not present in imported packet
- **Final disposition**: investigated and explained as expected behavior (one unparseable/unrecognised folder correctly excluded from Existing Events but included in the raw IPC payload) — not a bug

## Engineering Decisions

- **Accepted**: 
  - Normalize event.sequence to the canonical zero-padded string representation at the single point it is first computed inside master:scanEvents, before it reaches resolved.sort()'s comparator.
  - Keep the stable v* release path completely untouched during the entire investigation; use only the dedicated Windows-tester workflow_dispatch build path for diagnostic RC artifacts.
  - Run a Repository-wide Canonical Representation Audit after confirming BUG-011's root cause, to check for the same mixed-runtime-type defect class elsewhere.
  - Close all seven audit findings (L1 HIGH, L2–L7 MEDIUM/LOW) in one consolidated stabilization pass before merging to main and preparing a stable release, rather than deferring any of them.
  - Merge the stabilization branch into main via a reviewed PR only after all four bugs' documentation accurately reflected only the tester evidence actually exercised — never upgrading a bug's status to hardware-verified beyond what the tester's session actually reached.
- **Rejected**: 
  - Malformed or missing event.json explains the missing events.
  - A mismatch between the event's own Hijri date and the collection's Hijri date filters the event out.
  - Multi-component/multi-city event structure is mishandled by discovery.
  - imports[].source.path (Windows local drive paths) is read or validated by discovery and fails.
  - A 'Current Device' UI filter separate from the raw scan hides events.
  - The first RC's {ok, events} shape change silently broke a consumer, causing a renderer-side count collapse.
  - UNC path resolution of masterPath is malformed on Windows, causing the scan to target the wrong path.
  - Dirent.isDirectory() misreports directory type on Windows/SMB network mounts (a known Node/libuv bug class).
  - SMB/NAS latency causes the scan to stall or time out mid-loop.
  - A synchronous helper called after the per-entry read (JSON.parse, normalizeEventJson, isValidEventJson, parseEventName, the sort comparator, JSON.stringify diagnostics) is slow enough to explain a multi-second block.
  - IPC serialization / structured-clone incompatibility on the returned events payload causes the failure.
- **Deferred**: Formal 'Verified' status for BUG-011, BUG-012, and BUG-014 awaits a consolidated real-hardware acceptance pass covering steps the tester's session did not reach (new-event creation flow for BUG-012, footer-mode transitions for BUG-014).
- **Undecided**: 
  - Formal 'Verified' status for BUG-011, BUG-012, and BUG-014 still awaits a consolidated real-hardware acceptance pass covering steps the tester's session did not reach (new-event creation flow for BUG-012, footer-mode transitions for BUG-014).
  - L4's original app.log evidence (a mixed-separator string seen in an import-transaction-rollback failure message) was traced to a different, already-correct code path and remains formally unexplained — the L4 finding closed in the stabilization pass is a distinct, newly-discovered pattern, not a confirmed match for that original evidence.
- **Decision-intelligence linkage**: draft (DEC-016) — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10 for how this is decided.

## Bug / Investigation Evidence

- **Symptoms**: Event Management showed 'Existing Events (0)' / 'No resolvable events yet.' for a collection that physically contained valid, event.json-backed events on the NAS archive.
- **Hypotheses**: Transient NAS/SMB readdir failure collapsed into an empty-events shape.,Malformed/missing event.json.,Event date vs. collection date mismatch filter.,Multi-component/multi-city event structure mishandling.,imports[].source.path being read/validated by discovery.,A separate 'Current Device' UI filter.,A consumer-side shape mismatch after the first RC's {ok, events} change.,UNC path resolution of masterPath.,Dirent.isDirectory() misreporting on Windows/SMB.,SMB/NAS latency causing a scan stall.,A slow synchronous helper in the per-entry loop.,IPC serialization/structured-clone incompatibility.
- **Evidence**: Real tester app.log across 8 scan attempts confirming fsp.readdir() itself succeeded with 52–54 raw entries.,Real tester app.log showing zero RECORD/EVENT_DISCOVERY_SUMMARY lines across all 8 attempts.,Per-entry-instrumented diagnostic build's app.log showing every entry reaching READ_EVENT_JSON_OK with total silence afterward and no heartbeat.,IPC-boundary instrumentation's app.log capturing the literal exception across 3 scan attempts: TypeError: b.sequence.localeCompare is not a function, at POST_LOOP_START → SORT_START.,Post-fix real tester app.log and screenshot showing Existing Events (36), SCAN_PROMISE_RESOLVED ok=true events=37, no crash.
- **Root cause**: master:scanEvents computed event.sequence from two producers with different runtime types (a zero-padded string from parseEventName() when a folder name parses, a number read from eventJson.sequence on disk when it doesn't); resolved.sort()'s localeCompare comparator threw when a mismatched pair was compared, aborting the entire event-discovery request after filesystem discovery and event.json parsing had already succeeded for every entry.
- **Proposed fixes**: Normalize sequence to a canonical zero-padded string at the single point it is first computed, reusing the sibling _scanNasArchive function's already-correct pattern for the identical value.
- **Accepted fix**: Normalize sequence to a zero-padded string immediately after it is computed in master:scanEvents, before it can reach the sort comparator in a mismatched state. The regression test was explicitly verified to fail before the fix (git stash reproduces exit 1) and pass after it.
- **Rejected fixes**: A stat()-based Dirent recovery patch was considered as a possible fix but not adopted as addressing the confirmed root cause (added anyway as unrelated, zero-cost defensive hardening).
- **Linked existing bug**: None — conversation alone is not sufficient to declare a defect fixed; see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10

- **Symptoms**: After successfully creating a new event, reopening Event Management for the same collection did not show the newly-created event in the Existing Events list.
- **Hypotheses**: The event list was rendered from a stale in-memory cache never invalidated on the write path.
- **Evidence**: Live reproduction: created a second event through the real UI/IPC flow, closed and reopened Event Management, confirmed only after the fix that both events appear.
- **Root cause**: renderer/eventCreator.js cached the last disk scan result in a module-level _scannedEvents variable and only re-scanned when it was null; the event-creation success path never reset it to null.
- **Proposed fixes**: Invalidate _scannedEvents at the exact point a new event is known to have been persisted.
- **Accepted fix**: _tryCreateEvent() now sets _scannedEvents = null immediately after the event has been persisted, forcing the next entry into the event list to re-scan from disk.
- **Rejected fixes**: 
- **Linked existing bug**: BUG-012

- **Symptoms**: A previously-selected/existing collection intermittently disappeared from Event Management at startup or after saving Archive Locations, falling back to Create Collection even though the collection physically existed.
- **Hypotheses**: Windows/UNC path prefix comparison used a literal string concatenation (startsWith(root + '/')) that could never match a genuinely-nested backslash-separated path.
- **Evidence**: path.win32-shaped fixture unit tests reproducing the tester's exact reported path shape, proving the old expression returns false for a genuinely-nested path on that shape.,Real tester RC verification report explicitly confirming the named collection was discovered and remained selectable across the session.
- **Root cause**: setSessionArchiveRoot() tested collection membership with a literal '/' concatenation; on Windows, real archive paths use backslash separators, so the check always concluded 'no longer belongs to this root' for every collection, wiping the active/session collection state.
- **Proposed fixes**: A single normalizing helper (isPathUnderRoot()) that normalizes both paths to forward slashes and strips trailing separators before comparison.
- **Accepted fix**: Added renderer/pathUtils.js's isPathUnderRoot(), used at both call sites in setSessionArchiveRoot() instead of the raw startsWith(root + '/') expression; case-insensitivity applied only when either path is Windows/UNC-shaped, never for POSIX-shaped paths, after a code-review-driven refinement.
- **Rejected fixes**: An unconditional case-insensitive comparison was proposed first, then rejected after code review flagged it as a correctness gap for case-sensitive filesystems (Local Staging on Linux or case-sensitive-formatted APFS).
- **Linked existing bug**: None — conversation alone is not sufficient to declare a defect fixed; see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10

- **Symptoms**: On a fully valid, populated Create New Event form, the primary Create/Continue action was completely missing from the modal footer — only Back remained.
- **Hypotheses**: Dead/superseded inline button markup left over from an earlier UI iteration.,The docked modal footer's visibility, driven entirely by EventMgmt's _mode, was left at whatever the previous screen set it to when _renderEventForm() was reached directly, skipping the event list where mode is normally set.
- **Evidence**: Live E2E test covering the normal '+ Create New Event' flow (footer correct) and a second scenario (creating a second, brand-new collection after already having scanned a different one in the same session) asserting the footer is never left showing only Back.
- **Root cause**: _renderEventForm() never set or derived the EventMgmt footer mode itself; when it was reached directly (bypassing the event list), the footer mode was left at whatever a prior screen had set, which could render with no primary action.
- **Proposed fixes**: Derive the correct mode from actual state (repair/edit/create) inside _renderEventForm() itself, rather than relying on every caller to set it correctly first.
- **Accepted fix**: _renderEventForm() now derives the correct mode from state and calls EventMgmt.setMode() itself if the current mode doesn't already match, making the footer self-correcting regardless of which navigation path reached the form.
- **Rejected fixes**: Removing/reactivating the dead inline #ecEventContinue button was considered and ruled out as unrelated — confirmed superseded/dead UI, not the cause.
- **Linked existing bug**: BUG-014

## Visual Evidence

None recorded — this importer does not yet accept binary image attachments; see docs/product/conversations/README.md.

## Open Questions

- **Unresolved**: 
  - Formal 'Verified' status for BUG-011, BUG-012, and BUG-014 still awaits a consolidated real-hardware acceptance pass covering steps the tester's session did not reach (new-event creation flow for BUG-012, footer-mode transitions for BUG-014).
  - L4's original app.log evidence (a mixed-separator string seen in an import-transaction-rollback failure message) was traced to a different, already-correct code path and remains formally unexplained — the L4 finding closed in the stabilization pass is a distinct, newly-discovered pattern, not a confirmed match for that original evidence.
- **Deferred**: Formal 'Verified' status for BUG-011, BUG-012, and BUG-014 awaits a consolidated real-hardware acceptance pass covering steps the tester's session did not reach (new-event creation flow for BUG-012, footer-mode transitions for BUG-014).
- **Evidence pending**: 
  - Exact ChatGPT conversation start/completion timestamps.
  - Raw app.log files and tester screenshots referenced in this conversation (described in the packet but not attached to this import).

## Implementation Handoff

- **Work requested**: Fix BUG-011's root cause (mixed sequence type) with a normalization fix and a regression test proven to fail before and pass after.
- **Expected feature IDs**: AI-FEAT-009, AI-FEAT-010
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: test/bug011SequenceTypeMismatch.test.js
- **Explicit non-goals**: Evidence pending — not present in imported packet

- **Work requested**: Run a Repository-wide Canonical Representation Audit for the same defect class after BUG-011's root cause was confirmed.
- **Expected feature IDs**: None
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: Repository-wide exploration beyond the audit's own documented findings.

- **Work requested**: Close all seven audit findings (L1–L7) in one consolidated stabilization pass before merging to main.
- **Expected feature IDs**: AI-FEAT-009, AI-FEAT-010, AI-FEAT-005, AI-FEAT-039, AI-FEAT-022, AI-FEAT-029
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: Evidence pending — not present in imported packet

- **Work requested**: Merge the stabilization branch into main and prepare (but do not publish) a v0.9.11 stable release once BUG-011–014 documentation accurately reflects only the tester evidence actually exercised.
- **Expected feature IDs**: None
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: Evidence pending — not present in imported packet

## Outcome

- **2026-08-11** — Imported. Canonicalized from a "ecp"-format packet claiming source_tool "chatgpt".

## Provenance

- **Source file**: .autoingest-docs/conversations/inbox/eng-conv-windows-event-mgmt.json
- **Packet checksum**: 7d044e7498c795e80deec3d7e66745f2279f67094c5e92d6b13d217f2598a492
- **Importer**: ecp
- **Source tool (as claimed by the packet)**: chatgpt — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 13 (a claim, not proof)
- **Source conversation metadata**: Evidence pending — not present in imported packet
- **Transformation method**: ecp adapter (scripts/product-docs/automation/conversation/adapters.js)
- **Fields unavailable from source**: None — packet was complete for this adapter
- **Evidence classifications**: Imported packet — no secret pattern detected
- **Evidence-pending items**: Identity, Repository Context, Initial Understanding, Initial Proposal, Discussion Evolution, Alternatives, User Feedback, Implementation Handoff
