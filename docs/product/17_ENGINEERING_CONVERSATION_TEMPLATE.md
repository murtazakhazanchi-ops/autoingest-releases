# Engineering Conversation Template

Copy this structure for every `docs/product/conversations/ENG-CONV-####_NAME.md` file. Delete this comment block when instantiating. Keep every section — write "Evidence pending — not present in imported packet" rather than deleting a section that has nothing to report, per [18_ENGINEERING_CONVERSATION_POLICY.md](18_ENGINEERING_CONVERSATION_POLICY.md) § 6 (Reality Boundary).

An Engineering Conversation record is historical evidence, not a technical contract — see that policy document's § 3 (Authority Model) before citing one as a reason to change current behavior.

---

```markdown
# ENG-CONV-#### — <Conversation Title>

## Identity

| Field | Value |
|---|---|
| Conversation ID | ENG-CONV-#### |
| Title | <short, specific — names the engineering discussion, not just the feature> |
| Status | <current value only — always regenerable from the Outcome section's append log; see Outcome> |
| Conversation type | design / bug-investigation / requirements / review / mixed |
| Source tool | chatgpt / claude-code / claude / codex / gemini / human-meeting / engineering-review / email / markdown-notes / json / manual-import / unknown |
| Source format | ecp / markdown / json |
| Date started | <date or "Evidence pending"> |
| Date completed | <date or "Evidence pending"> |
| Participants/roles | <if applicable, or "Not recorded"> |
| Import date | <date> |
| Import session | <session/run ID> |
| Provenance classification | <what is actually verifiable about this packet's origin — see policy § 13; never a claim the packet cannot support> |
| Redaction status | Applied — automatic secret-pattern scan / Applied — manual redaction also performed / Not applicable |
| Integrity checksum | <sha256 of the normalized ECP packet> |

## Repository Context

| Field | Value |
|---|---|
| Repository | <name, or "Evidence pending"> |
| Branch | <branch name or "Evidence pending"> |
| Base commit | <short hash or "Evidence pending"> |
| Head/final commit | <short hash or "Evidence pending"> |
| Implementation state at time of discussion | <brief note, or "Evidence pending"> |

## Relationships

| Field | Value |
|---|---|
| Primary feature IDs | AI-FEAT-###, ... or None |
| Secondary feature IDs | AI-FEAT-###, ... or None |
| Roadmap milestone IDs | AI-RM-### or None |
| Related bugs | BUG-###, ... or None |
| Related decisions | DEC-###, ... or None |
| Related postmortems | PM-### or None |
| Related memory capsules | AI-MEM-####, ... or None |
| Related releases | <version(s)> or None |
| Related conversations | ENG-CONV-####, ... or None |
| Related technical docs | docs/x.md, docs/y.md or None |
| Related source files | <paths> or None |
| Related tests | <paths> or None |

## Original Request

- **Why this discussion happened**: <problem being solved, or "Evidence pending">
- **User goal**: <what the user asked for, in the user's own framing where recoverable>
- **Explicit requirements**: <requirements the packet states outright — never merged with inferred ones below>
- **Constraints**: <stated constraints, or "None recorded">

## Initial Understanding

- **Inferred requirements**: <requirements reasonably implied but not stated outright — kept visibly separate from Explicit requirements above>
- **Evidence-pending items**: <anything the packet doesn't clearly establish>
- **Uncertainties / questions raised at the start**: ...

## Initial Proposal

- **First proposed direction**: ...
- **Expected behavior**: ...
- **Expected architecture**: ...
- **Acceptance criteria**: ...

## Discussion Evolution

Append-only, chronological. One entry per meaningful revision — not one per message. Never delete a prior entry; a later entry may mark an earlier one superseded, but the earlier entry's text stays intact.

- **Revision N** (<date or sequence marker>)
  - Trigger: <what prompted the revision>
  - Feedback: <what was said, or "None — self-initiated">
  - Previous approach: <what the discussion held before>
  - Revised approach: <what changed>
  - Rationale: <why>
  - Disposition: accepted / rejected / superseded / deferred

## Alternatives

For each alternative genuinely proposed (repeat this block), or "None recorded" if the packet names none:

- **Proposal**: ...
- **Advantages**: ...
- **Disadvantages**: ...
- **Risks**: ...
- **Accepted or rejected**: ...
- **Reason**: ...
- **Evidence source**: <which part of the imported packet supports this>

## User Feedback

For each distinct piece of feedback (repeat this block), or "None recorded":

- **Feedback summary**: ...
- **Target area**: ...
- **Impact**: ...
- **Resulting change**: ...
- **Final disposition**: accepted / partially accepted / rejected

## Engineering Decisions

A ledger of decision-shaped statements from this conversation — kept separate from Alternatives (which records the reasoning) and never automatically converted into a canonical `DEC-###` record merely because a statement appears here (see [18_ENGINEERING_CONVERSATION_POLICY.md](18_ENGINEERING_CONVERSATION_POLICY.md) § 10).

- **Accepted**: <list, or "None">
- **Rejected**: <list, or "None">
- **Deferred**: <list, or "None">
- **Undecided**: <list, or "None">

## Bug / Investigation Evidence

Only if this conversation discussed a defect; otherwise "Not applicable — no bug discussed."

- **Symptoms**: ...
- **Hypotheses**: ...
- **Evidence**: ...
- **Root cause**: ... or "Evidence pending"
- **Proposed fixes**: ...
- **Accepted fix**: ...
- **Rejected fixes**: ...

## Visual Evidence

For each screenshot/image referenced in the imported packet (repeat this block), or "None recorded":

- **Asset reference**: <as named in the packet, or an allocated asset ID if committed under `docs/product/conversations/assets/ENG-CONV-####/`>
- **Description**: ...
- **Provenance**: <how this image was captured/attached, per the source packet>

## Open Questions

- **Unresolved**: ...
- **Deferred**: ...
- **Evidence pending**: ...

## Implementation Handoff

- **Work requested**: ...
- **Expected feature IDs**: ...
- **Expected roadmap IDs**: ...
- **Implementation constraints**: ...
- **Expected tests**: ...
- **Explicit non-goals**: ...

## Outcome

Append-only lifecycle log — the authoritative history of this record's Status. The Identity table's Status field is a cache of the latest entry here, never edited independently of it. "Implemented" is set only from repository evidence (a linked commit or Evidence Packet), never inferred from the conversation text alone.

- **<date>** — Imported. <import note>
- **<date>** — <transition, e.g. "Linked to AI-FEAT-###" / "Implementation Pending" / "Implemented — commit <hash>" / "Deferred" / "Rejected" / "Superseded by ENG-CONV-####" / "Archived">. <evidence for this transition>

## Provenance

- **Source file**: <original imported filename/reference>
- **Packet checksum**: <matches Identity's Integrity checksum>
- **Importer**: <format/adapter used>
- **Source tool (as claimed by the packet)**: <value — see policy § 13 on why this is a claim, not proof>
- **Source conversation metadata**: <source_conversation_id, timestamps, etc., or "Not provided">
- **Transformation method**: <adapter used to normalize into ECP>
- **Fields unavailable from source**: <list — an honest accounting, not a guess>
- **Evidence classifications**: <per-section classification if useful, or a summary statement>
- **Evidence-pending items**: <list every field in this record marked "Evidence pending", so a reader can see the honesty boundary at a glance>
```
