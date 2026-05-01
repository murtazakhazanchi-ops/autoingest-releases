# System Architecture

## App Overview
Electron (Node.js) desktop app for macOS and Windows.

Purpose:
- Import media from memory cards
- Structure into archive hierarchy
- Support multi-photographer workflows

---

## File Structure

electron-app-v24/
- config/ → media extension source of truth
- data/ → controlled vocabularies
- main/ → Electron backend
- renderer/ → UI layer
- scripts/ → utilities
- services/ → production services (telemetry, alias management)

userData (runtime):
- importIndex.json
- override lists
- alias files

---

## IPC Channels (representative subset)

- drives:get / drives:updated / drives:allUpdated
- files:get
- import:commitTransaction / import:progress
- dest:getDefault
- lists:get / add / match / learnAlias
- dir:ensure / rename / find
- event:appendImports / event:read / event:write
- master:scanEvents
- settings:get / settings:set / settings:verifyLastEvent

Note: the full channel set is defined in main/main.js and exposed via main/preload.js.

---

## window.api

Exposes:
- drive access
- file operations
- list management
- directory helpers
- import logging

---

## Drive Detection

- Uses drivelist
- Polls every 5 seconds
- Filters by DCIM presence

---

## Default Destination

- Default import destination is configurable
- Must not be hardcoded in logic
- Should be defined via configuration or user selection

Used for:
- initial import target
- fallback when no destination is specified