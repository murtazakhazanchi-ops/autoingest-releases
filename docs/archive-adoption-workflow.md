# Archive Folder Adoption — Operator Workflow

Manual folder adoption lets you register an existing archive folder (one that already contains media) as a proper AutoIngest event by writing a `event.json` into it. No files are moved, renamed, or deleted.

---

## When to use adoption

Use adoption when:
- A folder exists in the archive with media but was created outside AutoIngest (manual copy, legacy import, etc.)
- The folder name already follows the expected naming convention (Hijri date, sequence, event tokens)
- You want AutoIngest to track it, allow new imports into it, and include it in event listings

Do **not** use adoption to fix events that already have `event.json` — edit them in Event Creator instead.

---

## Workflow

### Step 1 — Scan for candidates

Open **Archive Tools → Adopt Folders**. Click **Preview Adoptions**. AutoIngest scans the active archive root and lists all folders that have no `event.json`.

Each candidate shows:
- **Folder name** and inferred Hijri date / sequence
- **Collection** it belongs to
- **Readiness** badge: Ready / Needs review / Blocked
- **Reason** — why it was flagged

### Step 2 — Review the candidate

Click **Details** on any candidate. The detail panel shows:

- **Location** — root type, collection, full folder path
- **Inferred fields** — date, sequence, event tokens, photographer folders, `_Selected` presence
- **Adoption Plan Preview** — what `event.json` would contain; what would be created, preserved, and not done

Review inferred fields. If sequence or Hijri date shows "Not detected", those will need to be filled in manually after adoption.

### Step 3 — Run dry-run validation

In the detail panel, click **Run Dry-run Validation**. This runs all 16 adoption checks against the folder without writing anything.

The verdict will be one of:
- **Adoption possible** — safe to proceed
- **Needs review** — warnings exist; review before adopting
- **Blocked** — one or more hard blockers prevent adoption (fix and re-run)

The dry-run also shows **Fields needing review** (date or sequence that couldn't be parsed), and the **Proposed event.json outline**.

### Step 4 — Adopt

When the dry-run verdict is **Adoption possible** and readiness is **Ready**, the **Adopt Folder** button appears.

1. Click **Adopt Folder**
2. Read the confirmation text, then click **Confirm Adoption**

AutoIngest writes `event.json` into the folder. The file contains:
- `status: "created"`
- `components: []` (no components yet — this is expected)
- An `adoption` block recording the source folder, collection, and timestamp
- Inferred Hijri date and sequence from the dry-run

No media files are moved. No folders are renamed.

### Step 5 — Complete the event in Event Creator

After adoption the event is in **created** status with no defined components. It will appear in event listings and can be opened in Event Creator.

Open the event in Event Creator and:
1. Confirm or correct Hijri date and sequence number
2. Add event types (tags)
3. Set location and city
4. Add one or more components (photographer names / roles)
5. Save

> **Structure warning:** If you save the event with 2 or more components, AutoIngest will show a structure confirmation. This is expected — the event was adopted with 0 components and is now being defined as multi-component. Confirm to proceed; no existing media is reorganized automatically.

### Step 6 — Import

Once the event is saved with components, new imports targeting this folder will follow the standard multi-component routing. Existing media already in the folder is not affected.

---

## Readiness classifications

| Badge | Meaning |
|---|---|
| **Ready** | All checks pass; dry-run can proceed |
| **Needs review** | Soft warnings (e.g. unrecognised sub-folders); adoption may still be possible |
| **Blocked** | Hard blockers present; adoption cannot proceed until resolved |
| **Not adoptable** | Folder shape is incompatible with the adoption model |

---

## What adoption does not do

- Does **not** move, copy, rename, or delete any media files
- Does **not** rename the folder itself
- Does **not** reorganize photographer sub-folders
- Does **not** touch `_Selected` or any output folder
- Does **not** backfill metadata or create a thumbnail index

---

## Reversing an adoption

Adoption can be undone manually by deleting the `event.json` file that was created. The folder returns to an adoptable state on the next scan. Any imports that were routed into the folder after adoption remain in place.

---

## Related documentation

- Technical contract and validation rules: `docs/archive-adoption-contract.md`
- Event data model: `docs/data-model.md`
- Import routing: `docs/ingestion-flow.md`
