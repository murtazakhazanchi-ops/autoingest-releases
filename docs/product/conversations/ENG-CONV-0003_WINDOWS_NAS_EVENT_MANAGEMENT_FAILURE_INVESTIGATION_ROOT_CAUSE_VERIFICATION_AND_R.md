# ENG-CONV-0003 — Windows/NAS Event Management Failure — Investigation, Root Cause, Verification, and Repository Stabilization

## Identity

| Field | Value |
|---|---|
| Conversation ID | ENG-CONV-0003 |
| Title | Windows/NAS Event Management Failure — Investigation, Root Cause, Verification, and Repository Stabilization |
| Status | Implemented |
| Conversation type | mixed |
| Source tool | chatgpt |
| Source format | ecp |
| Date started | 2026-08-08T00:00:00Z |
| Date completed | 2026-08-11T00:00:00Z |
| Participants/roles | Evidence pending — not present in imported packet |
| Import date | 2026-08-11T10:57:25.977Z |
| Import session | imp-1786445845869-21e91f |
| Provenance classification | Imported packet — no secret pattern detected |
| Redaction status | Applied — automatic secret-pattern scan (no matches) |
| Integrity checksum | 91f44727c5f4678bc079e603c113db8a7eb49a976d91d64b05555b764e3a5672 |

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
| Secondary feature IDs | AI-FEAT-031, AI-FEAT-042, AI-FEAT-054 |
| Roadmap milestone IDs | None |
| Related bugs | BUG-011, BUG-012, BUG-013, BUG-014 |
| Related decisions | DEC-016 |
| Related postmortems | None |
| Related memory capsules | AI-MEM-0003 |
| Related releases | None |
| Related conversations | ENG-CONV-0002 |
| Related technical docs | None |
| Related source files | None |
| Related tests | None |

## Original Request

- **Why this discussion happened**: Diagnose and resolve a Windows tester's field reports (Existing Events missing, collections intermittently disappearing, Create Event action missing) against the real archive/NAS environment, using real Windows RC evidence rather than speculative patching; confirm the true root cause with proof the regression test fails without the fix; verify on real hardware; determine whether the same defect class existed elsewhere in the repository; and reach a documented, low-risk v0.9.11 release-readiness state without publishing a release during diagnosis.
- **User goal**: Diagnose and resolve a Windows tester's field reports (Existing Events missing, collections intermittently disappearing, Create Event action missing) against the real archive/NAS environment, using real Windows RC evidence rather than speculative patching; confirm the true root cause with proof the regression test fails without the fix; verify on real hardware; determine whether the same defect class existed elsewhere in the repository; and reach a documented, low-risk v0.9.11 release-readiness state without publishing a release during diagnosis.
- **Explicit requirements**: 
  - The stable v* tag path must remain untouched during diagnosis; only dedicated Windows RC/tester artifacts may be used.
  - No public stable release may be created during diagnosis, and no tester build may trigger a normal client auto-update.
  - A discrepancy between diagnostic counters (37 IPC objects vs. 36 Existing Events) must be audited and explained, never assumed to be a second bug.
  - A regression test must be proven to fail when the fix is removed, not merely proven to pass after the fix — early fixtures that passed for the wrong reason must be caught and corrected.
  - BUG-012 and BUG-014 must not be upgraded to hardware-verified status based solely on BUG-011's successful tester screenshot — each bug's status must reflect only the evidence actually exercised for that bug.
  - User-facing release notes must describe outcomes, not the forensic investigation; internal L1-L7 identifiers stay engineering-history terminology.
  - No archive/event.json migration may be introduced — any fix must normalize at read/runtime only.
  - Do not create a duplicate canonical decision record merely because the conversation discusses decisions — check for an existing match first.
  - Check this packet for duplication/continuation against ENG-CONV-0001 and every later Engineering Conversation record before treating it as a new, distinct record.
- **Constraints**: 
  - Working Root and Main Archive Root were the same Windows/NAS archive on the tester's machine.
  - Local macOS reproduction repeatedly passed even when the real Windows/NAS environment failed — several rounds of hypotheses could not be confirmed or refuted without real tester hardware evidence.
  - Tester identity and unrelated personal information must not be preserved in the engineering record; only technically relevant paths and evidence should be retained.
  - Canonical BUG records, feature contracts, architectural decisions, and runtime documentation remain authoritative over this conversation record — this packet is historical evidence only, not a runtime contract.

## Initial Understanding

- **Inferred requirements**: Evidence pending — not present in imported packet — not distinguished from explicit requirements by this importer's adapters; see Original Request
- **Evidence-pending items**: 
  - Tester screenshots and the real event.json referenced in this conversation were described but not attached to this import.
  - v0.9.11 release relationship — no canonical release record exists yet to link against; not yet tagged or published at the time of this import.
- **Uncertainties / questions raised at the start**: 
  - A formal consolidated BUG-011-014 acceptance pass had not yet been completed at the time this packet was prepared.
  - BUG-012's specific real-Windows "create new event, then reopen and verify it appears" acceptance step remained pending.
  - BUG-014's specific real-Windows Create Event footer-transition acceptance remained pending, since earlier tester sessions had been blocked by BUG-011 before reaching that step.
  - Whether v0.9.11 should link to this conversation record once tagged/published — no canonical release record exists yet to link against.

## Initial Proposal

- **First proposed direction**: Decompose the tester's three principal symptoms (existing events missing / new events not appearing, collections intermittently disappearing, Create Event action missing) into four independently tracked defects rather than assuming one shared root cause.
- **Expected behavior**: Existing Events populates reliably, newly-created events appear without extra navigation, a collection sharing its archive root with Working Root never incorrectly disappears, and the Create Event primary action is always present on a valid, submittable form.
- **Expected architecture**: Evidence pending — not present in imported packet
- **Acceptance criteria**: Each fix confirmed on real Windows/NAS tester hardware where the tester's session actually reaches that code path, not assumed from a related fix's success.

## Discussion Evolution

- **Revision 1**
  - Trigger: Local macOS reproduction repeatedly passing while the real Windows/NAS environment continued to fail
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Continue refining local, macOS-based hypotheses and speculative patches for BUG-011's event-discovery failure.
  - Revised approach: Deliberately shift toward improving observability on the real Windows machine — progressively add scan IDs, per-entry markers, heartbeat state, synchronous-stage markers, and IPC boundary markers — until the actual failing stage could be identified from real evidence rather than further speculation.
  - Rationale: Continuing to patch unconfirmed theories against an environment that could not reproduce the failure risked accumulating unproven changes without closing the investigation.
  - Disposition: accepted
- **Revision 2**
  - Trigger: Real Windows app.log finally captured the literal exception: TypeError: b.sequence.localeCompare is not a function, thrown from master:scanEvents during resolved.sort()
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Assumed the failure occurred during event discovery/enumeration itself (filesystem read, Dirent type reporting, NAS latency, or IPC serialization).
  - Revised approach: Recognized the scanner had already enumerated directories, found and read event.json, parsed, normalized, and validated events, and constructed resolved records — the crash happened afterward, while sorting the completed resolved array, so the main-process handler threw before ever returning the completed response to the renderer.
  - Rationale: The user-visible symptom ("events were not discovered") described where the workflow visibly stopped, not where the defect actually originated.
  - Disposition: accepted
- **Revision 3**
  - Trigger: Tracing the sequence field's producers
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Treated sequence as a value with one canonical runtime type throughout the codebase.
  - Revised approach: Identified two legitimate producers with different runtime types: parseEventName() always returns a zero-padded string when a folder name parses; the eventJson.sequence fallback (used when a folder name fails to parse) could be a number, since Create/Edit Event persists it as one. A resolved array could therefore mix string and numeric sequence values, and the sort comparator's localeCompare() call threw the moment a numeric value became the receiver.
  - Rationale: This was the confirmed root cause, evidenced directly by the real tester app.log's captured exception.
  - Disposition: accepted
- **Revision 4**
  - Trigger: Early regression fixtures reproducing the failure only sometimes
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Trust a fixture that appeared to reproduce the bug once it was written.
  - Revised approach: Require explicit proof that each fixture fails when the fix is reverted and passes when it is restored — several early fixtures were found to pass even pre-fix (for the wrong reason, e.g. never actually exercising the mixed-type comparison) and were rejected until a fixture that genuinely failed pre-fix was constructed.
  - Rationale: A test that merely passes after a fix is insufficient evidence for a subtle, input-order-dependent comparator bug.
  - Disposition: accepted
- **Revision 5**
  - Trigger: Diagnostics reporting 37 IPC objects while the UI displayed 36 Existing Events
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Could have been assumed to be a second, separate counting bug.
  - Revised approach: Audited the discrepancy directly and found one specific folder (01-QMZ, no event.json, non-conforming name) intentionally classified as an Unrecognised Folder rather than a resolved Existing Event — 36 resolved events + 1 unrecognised folder = 37 IPC objects, by design.
  - Rationale: The scanner intentionally returns both resolved events and unparseable/unrecognised folders in one payload; the UI correctly renders only the resolved subset as "Existing Events".
  - Disposition: accepted — no code change required
- **Revision 6**
  - Trigger: Recognizing BUG-011's root cause was a canonical-representation/producer-boundary defect
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Treat BUG-011 as fully resolved once its own fix and regression test were verified.
  - Revised approach: Explicitly asked whether the same class of defect (multiple producers emitting different runtime types for a value a consumer assumes is one canonical type) existed elsewhere in the repository, launching a bounded repository-wide Canonical Representation Audit — explicitly scoped to representation consistency, not general refactoring.
  - Rationale: A single-site fix without a systemic check risked leaving the identical defect class dormant elsewhere before a stable release.
  - Disposition: accepted
- **Revision 7**
  - Trigger: The audit's seven findings (L1 HIGH, L2-L7 MEDIUM/LOW/investigated)
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Release once BUG-011's fix was confirmed on real hardware.
  - Revised approach: Decided not to release immediately; instead handle all seven bounded audit findings in one consolidated stabilization pass — explicitly no features, no redesign, no broad refactor, fix only what the audit already identified, then freeze for stable release.
  - Rationale: L1 (path containment) was HIGH severity and structurally the same risk class as BUG-013's already-shipped, already-proven defect.
  - Disposition: accepted

## Alternatives

- **Proposal**: A mismatch between the event's own Hijri date and the collection's Hijri date filters the event out of discovery.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Ruled out through reproduction — events with differing Hijri dates than their collection still passed discovery.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: Multi-component event structure is mishandled by discovery.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Two-component and three-component events both passed local discovery with zero drops.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: imports[].source.path (Windows local drive paths such as E:\...) is read or validated by discovery and fails.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: The imports data does not participate in the relevant validation/discovery gate.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: A separate Current Device filtering gate hides events.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: No separate Current Device rejection gate existed in the path initially suspected.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: The real event.json shape fails validation.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: The real event structure passed normalization and validation locally, using the actual supplied event.json verbatim.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: The first RC's {ok, events} IPC response-shape migration broke a consumer.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Audited; no forgotten consumer explained the failure.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: The renderer silently collapses a full event count down to zero.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Eventually ruled out — the renderer was not receiving a completed scan response at all in the failing scenario, not receiving and then dropping a completed one.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: Dirent.isDirectory() misreports directory type on Windows/network filesystems (a known class of issue).
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Investigated seriously and a stat() fallback was added as safe hardening, but not confirmed as the root cause; Node's own modern Dirent handling reduced confidence that the classic UNKNOWN-type issue explained the field failure.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: UNC path resolution explains the remaining BUG-011 failure.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Important for BUG-013, but did not explain the remaining BUG-011 failure once collection discovery itself was already functioning correctly.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: SMB/NAS latency causes the scan to stall despite the NAS being demonstrably slow for some operations.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Sequential stat/realpath/read operations were instrumented; the evidence did not ultimately support NAS latency as the BUG-011 root cause.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: A stat()/realpath() call stalls mid-scan.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Per-entry instrumentation and heartbeat diagnostics were introduced to locate a potential stuck filesystem await; later evidence showed the problem occurred elsewhere, after the per-entry loop completed.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: A synchronous post-read processing stage (JSON parsing, normalization, validation, event-name parsing, record construction, sorting, diagnostic aggregation) is slow enough to explain the block.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Local timing tests showed these operations were normally sub-millisecond or very small, even under stress.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: IPC serialization / structured-clone incompatibility on the returned event payload causes the failure.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: The returned payload was audited as plain structured-clone-safe data, small enough that payload size was not plausible as a cause; a 52-event IPC reproduction passed locally.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: The 37-vs-36 diagnostic discrepancy is a separate counting bug.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Audited directly and explained as intentional classification — one Unrecognised Folder correctly included in the full IPC payload but correctly excluded from the Existing Events subset.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

## User Feedback

- **Feedback summary**: Existing events did not appear in Event Management even though the corresponding event folders physically existed; new events created during the session could also fail to appear afterward.
- **Target area**: Event Management — event discovery / existing-event scan cache
- **Impact**: Evidence pending — not present in imported packet
- **Resulting change**: Evidence pending — not present in imported packet
- **Final disposition**: accepted, root-caused as BUG-011 (discovery) and BUG-012 (cache invalidation)

- **Feedback summary**: A collection that physically existed could disappear from AutoIngest, prompting the operator to create a collection that already existed on disk, when Working Root and Main Archive Root pointed to the same archive/NAS location.
- **Target area**: Event Management — archive-root containment logic
- **Impact**: Evidence pending — not present in imported packet
- **Resulting change**: Evidence pending — not present in imported packet
- **Final disposition**: accepted, root-caused as BUG-013

- **Feedback summary**: On a fully populated Create Event form, the primary Create Event action could disappear from the modal footer, making the form unsubmittable.
- **Target area**: Event Management — modal footer mode
- **Impact**: Evidence pending — not present in imported packet
- **Resulting change**: Evidence pending — not present in imported packet
- **Final disposition**: accepted, root-caused as BUG-014

- **Feedback summary**: Diagnostics reported a full IPC event array length of 37 while the UI displayed only 36 Existing Events.
- **Target area**: Event Management — event discovery diagnostics
- **Impact**: Evidence pending — not present in imported packet
- **Resulting change**: Evidence pending — not present in imported packet
- **Final disposition**: investigated and explained as intentional classification (one Unrecognised Folder included in the IPC payload but correctly excluded from Existing Events) — not a bug, no code change required

- **Feedback summary**: A representative real event.json from the affected archive was supplied, including a numeric sequence field, to ground the investigation in real data rather than synthetic assumptions.
- **Target area**: BUG-011 investigation evidence
- **Impact**: Evidence pending — not present in imported packet
- **Resulting change**: Evidence pending — not present in imported packet
- **Final disposition**: accepted — this real event.json's numeric sequence field later proved central to the confirmed root cause

- **Feedback summary**: A screenshot confirming Existing Events (36) after installing the fixed RC was supplied as the first decisive real-hardware confirmation of BUG-011's core fix.
- **Target area**: BUG-011 verification
- **Impact**: Evidence pending — not present in imported packet
- **Resulting change**: Evidence pending — not present in imported packet
- **Final disposition**: accepted as real-hardware confirmation of BUG-011's core defect only — explicitly not extended to BUG-012/BUG-014, whose own acceptance steps the tester's session had not yet reached

## Engineering Decisions

- **Accepted**: 
  - Normalize the sequence field to a canonical zero-padded string at the point it is first computed, before it can reach a string-only sort comparator in a mismatched state.
  - Keep the stable v* release path completely untouched during the entire investigation; use only dedicated Windows RC/tester artifacts for diagnostic builds.
  - Require a regression test to be proven to fail when the fix is reverted, not merely to pass after the fix, before accepting it as evidence.
  - Run a bounded, repository-wide Canonical Representation Audit after BUG-011's root cause was confirmed, explicitly scoped to representation-boundary consistency, not general refactoring.
  - Close all seven audit findings (L1 HIGH, L2-L7 MEDIUM/LOW, with L4 investigated-and-documented) in one consolidated stabilization pass before merging to main and preparing a stable release, rather than deferring them.
  - Reduce temporary high-volume forensic diagnostic instrumentation before stable release, while retaining low-volume, durable, field-support-value diagnostics (scan summary, unexpected-rejection assertions, concurrent-scan detection, IPC error-path logging).
  - Do not upgrade BUG-012 or BUG-014 to hardware-verified status based solely on BUG-011's successful tester verification — each bug's status must reflect only the evidence actually exercised for that specific bug.
  - Frame v0.9.11's user-facing release notes around outcomes, not the forensic investigation; keep internal L1-L7 identifiers as engineering-history terminology only.
  - Close the ChatGPT-side engineering conversation documentation before tagging or publishing v0.9.11.
- **Rejected**: 
  - A mismatch between the event's own Hijri date and the collection's Hijri date filters the event out of discovery.
  - Multi-component event structure is mishandled by discovery.
  - imports[].source.path (Windows local drive paths such as E:\...) is read or validated by discovery and fails.
  - A separate Current Device filtering gate hides events.
  - The real event.json shape fails validation.
  - The first RC's {ok, events} IPC response-shape migration broke a consumer.
  - The renderer silently collapses a full event count down to zero.
  - Dirent.isDirectory() misreports directory type on Windows/network filesystems (a known class of issue).
  - UNC path resolution explains the remaining BUG-011 failure.
  - SMB/NAS latency causes the scan to stall despite the NAS being demonstrably slow for some operations.
  - A stat()/realpath() call stalls mid-scan.
  - A synchronous post-read processing stage (JSON parsing, normalization, validation, event-name parsing, record construction, sorting, diagnostic aggregation) is slow enough to explain the block.
  - IPC serialization / structured-clone incompatibility on the returned event payload causes the failure.
  - The 37-vs-36 diagnostic discrepancy is a separate counting bug.
- **Deferred**: 
  - A formal consolidated BUG-011-014 acceptance pass had not yet been completed at release-readiness time.
  - BUG-012's specific real-Windows "create new event, then reopen and verify it appears" acceptance step remained pending.
  - BUG-014's specific real-Windows Create Event footer-transition acceptance remained pending, since earlier tester sessions had been blocked by BUG-011 before reaching that step.
- **Undecided**: 
  - A formal consolidated BUG-011-014 acceptance pass had not yet been completed at the time this packet was prepared.
  - BUG-012's specific real-Windows "create new event, then reopen and verify it appears" acceptance step remained pending.
  - BUG-014's specific real-Windows Create Event footer-transition acceptance remained pending, since earlier tester sessions had been blocked by BUG-011 before reaching that step.
  - Whether v0.9.11 should link to this conversation record once tagged/published — no canonical release record exists yet to link against.
- **Decision-intelligence linkage**: linked (DEC-016) — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10 for how this is decided.

## Bug / Investigation Evidence

- **Symptoms**: Event Management showed no usable existing events even though the corresponding event folders physically existed in the archive; newly-created events could also fail to appear afterward.
- **Hypotheses**: Event-date vs. collection-date mismatch filter.,Multi-component event structure mishandling.,imports[].source.path being read/validated by discovery.,Current Device filtering.,Real event.json shape failing validation.,IPC response-shape regression from the first RC's {ok, events} migration.,Renderer count collapse.,Dirent.isDirectory() misreporting on Windows/network filesystems.,UNC path resolution.,SMB/NAS latency.,stat()/realpath() stall.,Synchronous post-read processing stage being too slow.,IPC serialization / structured-clone incompatibility.
- **Evidence**: A representative real event.json from the affected archive, including a numeric sequence field, used verbatim in local reproduction.,Real Windows app.log progressively instrumented with scan IDs, per-entry markers, heartbeat state, synchronous-stage markers, and IPC boundary markers.,Real Windows app.log finally capturing the literal exception: TypeError: b.sequence.localeCompare is not a function, thrown from master:scanEvents during resolved.sort().,Post-fix tester screenshot showing Existing Events (36) after installing the fixed RC.
- **Root cause**: The sequence field had two legitimate producers with different runtime types: parseEventName() returns a zero-padded string when a folder name parses; the eventJson.sequence fallback (used when a folder name fails to parse) could be a number, since Create/Edit Event persists it as one. A resolved array could mix string and numeric sequence values, and the sort comparator's localeCompare() call threw once a numeric value became the receiver — aborting the entire scan after discovery, reading, parsing, normalization, and validation had already succeeded for every entry.
- **Proposed fixes**: Normalize sequence to a canonical zero-padded string at the point it is first computed, before downstream comparison.
- **Accepted fix**: sequence is normalized to a zero-padded string immediately after computation in master:scanEvents (commit a0dd38edb9c4e08cd0fbb2afcdd3ced0ee1138bd), before it can reach the sort comparator in a mismatched state. No event.json migration was required — the normalization occurs at read/runtime only. The regression test was explicitly reverted and confirmed to fail without the fix, then restored and confirmed to pass, after multiple earlier fixtures were rejected for passing even pre-fix.
- **Rejected fixes**: A stat()-based Dirent recovery patch was added as safe, unrelated hardening but was not adopted as addressing the confirmed root cause.
- **Linked existing bug**: None — conversation alone is not sufficient to declare a defect fixed; see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10

- **Symptoms**: A newly-created event remained invisible in Event Management because the existing-event scan cache was stale.
- **Hypotheses**: The renderer's cached event scan was never invalidated after a successful event-creation write.
- **Evidence**: Live reproduction confirming the newly-created event only appeared after an unrelated action happened to reset the cache.
- **Root cause**: Event creation successfully persisted the event to disk but did not invalidate the renderer's cached event scan.
- **Proposed fixes**: Invalidate the event scan cache once persistence succeeds.
- **Accepted fix**: The event scan cache is invalidated at the exact point a new event is known to have been persisted.
- **Rejected fixes**: 
- **Linked existing bug**: BUG-012

- **Symptoms**: A collection that physically existed could disappear from AutoIngest's available collections, prompting the operator to create a collection that already existed on disk, when Working Root and Main Archive Root were the same archive/NAS location.
- **Hypotheses**: Session archive-root containment logic used literal prefix comparison equivalent to somePath.startsWith(root + '/'), which happened to work with POSIX separators but was invalid for genuine Windows/UNC path representations.
- **Evidence**: Windows-shaped path fixtures proving the literal prefix logic could incorrectly remove the active/session collection state.,Subsequent real Windows/NAS confirmation that the affected collection remained discoverable/selectable after the fix.
- **Root cause**: The literal '/' prefix-concatenation containment check was invalid for genuine backslash-separated Windows/UNC paths, causing incorrect removal of the active collection/session collection state.
- **Proposed fixes**: A canonical path containment helper, verified against Windows-shaped path fixtures and then against real Windows/NAS behavior.
- **Accepted fix**: A canonical path containment helper replaced the literal prefix check at both call sites.
- **Rejected fixes**: 
- **Linked existing bug**: None — conversation alone is not sufficient to declare a defect fixed; see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10

- **Symptoms**: On a fully populated Create Event form, the primary Create Event action could disappear from the modal footer, making the form unsubmittable.
- **Hypotheses**: The docked Event Management footer depended on an internal mode set only by particular navigation callers; a reachable path could render the Event form directly while leaving the footer in a previous, stale mode.
- **Evidence**: Live reproduction confirming the form itself rendered fully and correctly while the footer's primary action was governed by unrelated prior-screen state.
- **Root cause**: The Event form did not derive or correct its own footer mode; it depended on whichever screen last set the mode, which could be wrong depending on the navigation path used to reach the form.
- **Proposed fixes**: Make the Event form derive and correct the appropriate footer mode itself, regardless of which navigation path reached it.
- **Accepted fix**: The Event form now derives the correct footer mode from actual state and corrects EventMgmt's mode itself if it doesn't already match.
- **Rejected fixes**: 
- **Linked existing bug**: BUG-014

## Visual Evidence

None recorded — this importer does not yet accept binary image attachments; see docs/product/conversations/README.md.

## Open Questions

- **Unresolved**: 
  - A formal consolidated BUG-011-014 acceptance pass had not yet been completed at the time this packet was prepared.
  - BUG-012's specific real-Windows "create new event, then reopen and verify it appears" acceptance step remained pending.
  - BUG-014's specific real-Windows Create Event footer-transition acceptance remained pending, since earlier tester sessions had been blocked by BUG-011 before reaching that step.
  - Whether v0.9.11 should link to this conversation record once tagged/published — no canonical release record exists yet to link against.
- **Deferred**: 
  - A formal consolidated BUG-011-014 acceptance pass had not yet been completed at release-readiness time.
  - BUG-012's specific real-Windows "create new event, then reopen and verify it appears" acceptance step remained pending.
  - BUG-014's specific real-Windows Create Event footer-transition acceptance remained pending, since earlier tester sessions had been blocked by BUG-011 before reaching that step.
- **Evidence pending**: 
  - Tester screenshots and the real event.json referenced in this conversation were described but not attached to this import.
  - v0.9.11 release relationship — no canonical release record exists yet to link against; not yet tagged or published at the time of this import.

## Implementation Handoff

- **Work requested**: Fix BUG-011's confirmed root cause (mixed sequence runtime type) with a normalization fix, proven by a regression test that fails without the fix and passes with it.
- **Expected feature IDs**: AI-FEAT-009, AI-FEAT-010
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: Evidence pending — not present in imported packet

- **Work requested**: Run a bounded, repository-wide Canonical Representation Audit for the same defect class after BUG-011's root cause was confirmed.
- **Expected feature IDs**: None
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: General refactoring or redesign beyond the audit's own documented findings.

- **Work requested**: Close all seven audit findings (L1 HIGH path containment, L2 checkpoint numeric fields, L3 photographer sequence, L4 mixed-separator finding investigated/documented, L5 exifService _context, L6 seqPrefix duplication, L7 normalize() naming collision) in one consolidated stabilization pass before merging to main.
- **Expected feature IDs**: AI-FEAT-009, AI-FEAT-010, AI-FEAT-005, AI-FEAT-039, AI-FEAT-022, AI-FEAT-029
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: Evidence pending — not present in imported packet

- **Work requested**: Review and reduce temporary high-volume forensic diagnostic instrumentation before stable release, retaining only durable, low-volume, field-support-value diagnostics.
- **Expected feature IDs**: AI-FEAT-009, AI-FEAT-010
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: Evidence pending — not present in imported packet

- **Work requested**: Merge the stabilization branch into main and reach a documented v0.9.11 release-readiness state, with no archive/event.json migration and no public release published during diagnosis.
- **Expected feature IDs**: None
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: Evidence pending — not present in imported packet

- **Work requested**: Close the ChatGPT-side engineering conversation documentation loop through the existing Part 8 import pipeline before v0.9.11 is tagged or published.
- **Expected feature IDs**: None
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: Evidence pending — not present in imported packet

## Outcome

- **2026-08-11** — Imported. Canonicalized from a "ecp"-format packet claiming source_tool "chatgpt".
- **2026-08-11** — v0.9.11 published. The first `v0.9.11` tag was pushed while `package.json` still read `0.9.10`, causing `electron-builder` to build and silently skip-publish `0.9.10`-named artifacts against the already-published `v0.9.10` release — see [PM-002](../postmortems/PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md) for the full incident record. The empty release/tag were removed, the application version was corrected, and `v0.9.11` was re-tagged and republished successfully (12 assets, correct updater metadata, `v0.9.10` unaffected throughout). This is a release-process incident, not an Event Management defect — it does not change BUG-011 through BUG-014's own statuses.
- **2026-08-12** — Implemented — commit `dfb91805` (post-commit reconciliation; changed file(s) resolved to AI-FEAT-005, AI-FEAT-022, AI-FEAT-029, AI-FEAT-039).

## Provenance

- **Source file**: .autoingest-docs/conversations/inbox/eng-conv-windows-event-mgmt-v2.json
- **Packet checksum**: 91f44727c5f4678bc079e603c113db8a7eb49a976d91d64b05555b764e3a5672
- **Importer**: ecp
- **Source tool (as claimed by the packet)**: chatgpt — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 13 (a claim, not proof)
- **Source conversation metadata**: chatgpt-autoingest-windows-event-management-2026-08
- **Transformation method**: ecp adapter (scripts/product-docs/automation/conversation/adapters.js)
- **Fields unavailable from source**: None — packet was complete for this adapter
- **Evidence classifications**: Imported packet — no secret pattern detected
- **Evidence-pending items**: Identity, Repository Context, Initial Understanding, Initial Proposal, Discussion Evolution, Alternatives, User Feedback, Implementation Handoff
