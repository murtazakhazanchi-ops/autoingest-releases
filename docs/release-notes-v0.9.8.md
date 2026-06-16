# AutoIngest v0.9.8 — Archive Root Detection & Event Restore Fix

Release date: 2026-06-16
Build type: Internal tester build

---

## Fixed

### Archive — NAS root detection on startup event restore
- The last active event is no longer restored from a stale local-staging copy when a valid, online archive root holds the event.
- When the stored event path belongs to a root that is now offline (for example, a saved Main Archive Root on an unreachable volume), startup restore now re-resolves the same collection/event under the currently active archive root (the online NAS) **before** falling back to local staging.
- A reachable archive (NAS) always wins over a stale local-staging copy; staging remains the fallback only when no archive root has the event.
- On a successful re-resolution, the corrected archive path is persisted so subsequent launches restore directly without re-resolving.
- Event scan/select after restore now reads from the resolved archive root rather than a stale local-staging path.

### Archive Locations — offline Main Archive Root mismatch
- When the saved Main Archive Root is offline but the active archive root is an online, valid AutoIngest archive, the Archive Locations panel now surfaces the mismatch.
- A new **"Adopt active root as Main Archive Root"** action lets the user promote the online active root to Main Archive Root. The change is staged and committed with Save (reusing the existing setMainArchiveRoot flow).
- The adopt affordance is hidden again when the Main Archive Root is cleared.

---

## Notes

- No changes to import/copy logic, transaction ingest, or event.json persistence contracts.
- Electron security model is unchanged (contextIsolation, sandbox, nodeIntegration).
- Main Archive Root validation (path + `archive-root.json` marker) and active-root auto-resolution are unchanged; this build only corrects startup event restoration and adds the offline-mismatch adopt affordance.
