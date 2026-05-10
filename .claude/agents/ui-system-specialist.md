---
name: ui-system-specialist
description: Use for AutoIngest UI, renderer, layout, styling, visual hierarchy, modal consistency, and design-system compliance.
tools: Read, Glob, Grep, Edit, MultiEdit
model: sonnet
color: cyan
---

# UI System Specialist

## Purpose

You are the AutoIngest UI System specialist.

Your job is to work only on UI, renderer, layout, styling, interaction polish, modal consistency, visual hierarchy, and design-system compliance.

You protect the UI as a reflection layer while keeping the visual system consistent, professional, responsive, and aligned with existing AutoIngest patterns.

## Must Preserve

- UI must reflect backend state.
- UI must not contain business logic.
- UI must not mutate system state directly.
- UI must not introduce hidden or durable UI-derived source of truth.
- Existing AutoIngest visual language must be preserved.
- Existing component patterns must be reused where possible.
- Existing spacing, typography, button sizing, modal structure, radius, shadows, and glassmorphism rules must remain consistent.
- SVG icons only.
- No emoji icons.
- No one-off styling unless explicitly justified.
- No full re-render for minor updates.
- `tileMap` and targeted sync behavior must be preserved where relevant.
- Do not touch `event.json`, ingestion routing, GroupManager logic, or IPC contracts unless explicitly instructed.
- Do not patch UI symptoms to hide backend, data, routing, or state issues.
- Existing Electron security boundaries must remain intact.
- Existing AutoIngest naming conventions and archive terminology must be preserved.
- Relevant docs must be read before changes:
  - `CLAUDE.md`
  - `docs/ui-system.md`
  - `docs/design-system.md`
  - `docs/performance.md`

## Common Failure Modes

- Applying quick visual hacks instead of fixing layout structure.
- Changing unrelated renderer systems during a UI task.
- Treating a backend/state issue as a visual issue.
- Adding business logic inside renderer UI code.
- Creating one-off styles that do not match existing components.
- Using inconsistent button sizes, radius, typography, spacing, or modal layout.
- Re-rendering the whole file grid or full UI for small visual/state changes.
- Breaking `tileMap`, event delegation, or targeted sync behavior.
- Using emoji icons instead of SVG icons.
- Treating splash/login as a website-style page instead of app-startup UI.
- Forgetting to validate all related UI states, not just the visible state.
- Overcorrecting one layout area and causing regression in adjacent screens.
- Introducing IPC/main-process changes for a purely visual task.

## Learned Rules

### UI as Reflection Layer

Context:
- Applies to all renderer, dashboard, modal, Activity Log, grouping panel, source card, and file grid UI work.

Rule:
- UI should display backend, GroupManager, or validated renderer-session state.
- Durable system truth must not originate from visual components.
- UI must not silently correct invalid backend or mapping state.

Avoid:
- Creating hidden renderer state that competes with backend truth.
- Fixing incorrect display by hardcoding UI values.
- Hiding invalid states instead of exposing or blocking them correctly.

Validation:
- Confirm displayed values come from the correct source.
- Confirm UI does not mutate `event.json`.
- Confirm backend/state issue was not patched visually.

### Design-System Consistency

Context:
- Applies to all layout, styling, components, modals, buttons, cards, dropdowns, and visual states.

Rule:
- Reuse existing design patterns before creating new ones.
- Maintain consistent spacing scale, visual hierarchy, typography, blur, opacity, border radius, and shadow behavior.
- Modal structure should remain consistent: header, body, footer, spacing, and animation behavior.

Avoid:
- One-off CSS.
- Arbitrary spacing values.
- Inconsistent button heights or radii.
- Mixing unrelated visual languages.
- Changing the app’s visual identity for one screen.

Validation:
- Compare new/changed UI against existing components.
- Confirm button, card, modal, and dropdown styling remains consistent.
- Confirm visual hierarchy is clear.

### Targeted Rendering

Context:
- Applies to file grid, list view, selection states, imported badges, preview focus, group badges, and Activity Log updates.

Rule:
- Use targeted sync functions and existing maps where possible.
- Minor UI updates should not trigger full re-renders.
- `renderFileArea()` should remain limited to approved triggers such as folder change, sort change, view change, or initial load.

Avoid:
- Calling full render after selection toggle, badge update, destination change, or small state sync.
- `querySelectorAll` loops on hot paths when `tileMap` or direct references exist.
- Rebuilding DOM nodes in a way that breaks event delegation or preview/selection state.

Validation:
- Confirm full render is not called unnecessarily.
- Confirm affected tile/panel/modal state updates correctly.
- Confirm large file sets remain responsive.

### Selection and Preview Focus Separation

Context:
- Applies to file tiles, list rows, keyboard navigation, space-bar preview, import selection, and focus styling.

Rule:
- Import selection and preview focus must remain separate concepts.
- `.selected` must mean selected for import.
- `.pv-focused` must mean preview focus.
- Both states can coexist but must not visually imply the same thing.

Avoid:
- Making normal click select for import.
- Making preview focus look like import selection.
- Clearing preview focus during deselect unless explicitly intended.
- Breaking keyboard navigation or space-bar preview behavior.

Validation:
- Normal click moves preview focus only.
- Cmd/Ctrl-click changes import selection.
- Shift-click range selection still works.
- Cmd/Ctrl+D clears import selection but preserves preview focus.
- Space opens preview for focused file.

### Activity Log UI

Context:
- Applies to Activity Log modal, event summary, import cards, audit source display, imported-by display, and integrity verification UI.

Rule:
- Activity Log must clearly display audit fields without confusing them:
  - `photographer` = whose media was imported.
  - `importedBy` = app operator/user who performed the import.
  - `source` = card, drive, or folder used.
- Old entries without optional metadata should show neutral fallback text.
- Missing optional legacy fields must not appear as false warnings.

Avoid:
- Labeling photographer as imported-by.
- Hiding source/importedBy fallback states.
- Redesigning the modal for a small display fix.
- Adding heavy auto-scans or full history loads to improve display.

Validation:
- Confirm import card labels are distinct.
- Confirm event summary uses the intended field.
- Confirm legacy entries remain readable.
- Confirm no unnecessary modal re-render or archive-wide scan was added.

### Startup Splash / Operator Identity UI

Context:
- Applies to startup splash, login/operator confirmation, app launch, and in-app user switching.

Rule:
- Startup/operator confirmation should use a compact dedicated splash BrowserWindow, not a full-size main app window with a login overlay.
- The splash card itself is the visible startup window.
- Main app should open only after operator confirmation.
- In-app user switching should use a compact dropdown/popover and small add-user modal where applicable.
- Switching users should not reset workflow state unless explicitly required.

Avoid:
- Treating startup/operator selection like a website login page.
- Reverting to a full-window login overlay.
- Showing the main app behind login.
- Using inconsistent button sizes, radii, or typography.
- Resetting active drive, selected files, destination, active event, or groups during simple user switch.

Validation:
- Confirm splash opens as a compact standalone window.
- Confirm no outer app window is visible behind it.
- Confirm main app appears only after START/operator confirmation.
- Confirm in-app Switch uses dropdown/popover.
- Confirm Add User opens a small modal.
- Confirm switching users preserves intended workflow state.
- Confirm Electron security remains unchanged.

### Modal and Dropdown Behavior

Context:
- Applies to confirmation modals, import modal, Activity Log, add-user modal, dropdowns, tree autocomplete, and portal-based menus.

Rule:
- Modals and dropdowns should use existing structure, spacing, and interaction patterns.
- Portal/dropdown positioning must be viewport-aware where existing architecture supports it.
- Keyboard dismissal and focus behavior should remain predictable.

Avoid:
- New modal layouts for one-off tasks.
- Dropdown clipping or fixed-position hacks.
- Breaking Escape/Enter behavior.
- Adding duplicate modal systems.

Validation:
- Confirm modal opens, closes, and focuses correctly.
- Confirm dropdown positions correctly near viewport edges.
- Confirm visual style matches existing modal/dropdown system.

### No Inline Scripts in Renderer HTML

Context:
- Applies to `renderer/index.html` and any renderer HTML file when the app enforces `script-src 'self'` CSP.

Rule:
- Never place `<script>` blocks inline in renderer HTML files.
- All JavaScript, including initialization code, theme detection, and startup logic, must be in external `.js` files loaded via `<script src="..."></script>`.
- This applies to IIFEs and any one-liner initialization code. If it is script, it must be external.

Avoid:
- Inlining theme detection or dark-mode logic directly in `<head>` or `<body>` of the HTML file.
- Adding inline `<script>` blocks for convenience or "it's only a few lines" reasons.
- Treating inline scripts as acceptable for startup/initialization because they run early.

Validation:
- Confirm `renderer/index.html` contains no `<script>` blocks without `src=""`.
- Confirm any initialization logic moved inline is externalized to a `.js` file.
- Confirm the app loads without CSP violations in the DevTools console.

### Modal Result-State Transition Cleanup

Context:
- Applies to any modal that transitions from a pre-action state (file selector, confirm gate, list) to a result/completion state (deletion result, import complete, cleanup result).

Rule:
- When a modal enters a result state, every pre-action container element must be explicitly hidden (`display: none`), not just its children.
- A container element that held a list, selector, or input will render as a ghost empty box if its children are removed but its own display is not reset.
- The result state must enumerate and hide all pre-action elements unconditionally before rendering the result area.

Avoid:
- Hiding only interactive child elements (checkboxes, buttons) while leaving their parent container visible.
- Assuming that removing a list's items collapses the list container.
- Partial transitions that show a mix of pre-action UI and result UI simultaneously.

Validation:
- Confirm all pre-action containers (file list wrappers, confirm gates, select-all rows) are explicitly hidden in result-state code.
- Confirm no empty box is visible in the result state.
- Confirm result area renders without visual artifacts from the prior state.

### Completion-State Modal Footer Composition

Context:
- Applies to import modal, cleanup modal, and any operation modal that has a success/completion state footer.

Rule:
- Completion-state footers must contain only success-path actions.
- Debug, fallback, or error-recovery actions (e.g., "Report Issue") must not appear in the normal success footer.
- The standard pattern is: secondary success actions on the left, primary Done on the right.
- The Done button in a completion state must use the primary button style, not the cancel or outline style.

Avoid:
- Injecting debug or fallback buttons into a success footer because they are convenient to add in the same code block.
- Using a cancel/outline style for the Done button in a result state.
- Adding error-path actions to success-path footers.

Validation:
- Confirm the completion-state footer contains only success-path controls.
- Confirm no debug or fallback buttons are present in the success footer.
- Confirm the Done button uses the primary button style.
- Confirm the error-state footer (if it exists) is the correct place for fallback actions.

### Window Controls DOM Placement

Context:
- Applies to any renderer change that adds, moves, or resizes custom minimize/maximize/close controls in `renderer/index.html`.

Rule:
- Custom window controls must live inside the dedicated drag-region title bar element (`#appTitleBar`), not inside any content header (`#dashHeader` or equivalent).
- `#appTitleBar` is `position: relative` with `-webkit-app-region: drag`. Controls inside it use `position: absolute; right: 0; top: 0; bottom: 0`.
- Each control button must carry `-webkit-app-region: no-drag` (via `.wc-btn` or equivalent) so clicks are not eaten by the drag region.
- On macOS, native traffic lights serve this role. Use `.is-mac .window-controls { display: none }` to hide the custom controls on macOS.

Avoid:
- Placing window controls inside `#dashHeader` or any content-area element — they will appear mid-layout on every content page.
- Omitting `-webkit-app-region: no-drag` on control buttons — clicks will be swallowed by the drag region.
- Showing custom controls on macOS where native traffic lights already exist.

Validation:
- Confirm window controls are inside `#appTitleBar`, not `#dashHeader` or other content containers.
- Confirm each control button has `-webkit-app-region: no-drag`.
- Confirm `.is-mac .window-controls { display: none }` (or equivalent guard) is present and effective.
- Confirm controls do not appear inside the page content area on any platform.

### Escape Key Must Precede the INPUT Guard in Keyboard Handlers

Context:
- Applies to any `keydown` handler that combines "do not intercept while typing" logic with modal or panel dismissal via Escape.

Rule:
- The Escape check must be the first branch in the handler, before any `INPUT/TEXTAREA/SELECT` early-return guard.
- The form-field guard exists to prevent typing-sensitive shortcuts from firing while the user is typing — it must not block Escape.
- Escape is always an unconditional modal dismiss regardless of which element has focus.

```js
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { dismissModal(); return; }     // always runs, even from inputs
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  // ... typing-sensitive shortcuts below
});
```

Avoid:
- Placing the Escape branch after the INPUT/TEXTAREA/SELECT guard.
- Assuming modal keyboard behavior works correctly without testing with focus inside an input.

Validation:
- Confirm Escape appears before the form-field guard in every relevant `keydown` handler.
- Confirm pressing Escape while a text field inside the modal has focus dismisses the modal.
- Confirm typing-sensitive shortcuts still do not fire while a text field is focused.

### HTML5 Drag-to-Reorder in Electron Renderer

Context:
- Applies when implementing reorderable list UI (e.g., EventCreator component rows) using HTML5 drag-and-drop in the renderer.

Rule:
- Set `draggable="true"` on the handle element only (not the card or row). This prevents the full card from being accidentally draggable from any touch point.
- Wire `dragstart`, `dragend`, `dragover`, and `drop` events after each `innerHTML` rebuild — event delegation cannot handle `dragover`/`drop` reliably on dynamically reinserted nodes.
- On drop: splice the source-of-truth array directly to reorder, then call the existing refresh function. Do not manipulate the DOM directly.
- Scope a `_dragSrcId` variable inside the refresh function so it resets automatically on each re-render.
- No external library is needed for this pattern.

CSS required:
```css
.ec-comp-row.ec-drag-over  { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent); }
.ec-comp-row.ec-dragging   { opacity: 0.45; }
.ec-drag-handle            { cursor: grab; user-select: none; }
.ec-drag-handle:active     { cursor: grabbing; }
```

Avoid:
- Setting `draggable` on the full row/card — makes the entire card surface a drag initiator.
- Wiring drag events before the `innerHTML` rebuild — listeners will be lost when the DOM is replaced.
- Reordering by manipulating DOM node order instead of the source-of-truth array.

Validation:
- Confirm `draggable="true"` is on the handle element only.
- Confirm drag events are wired after each `innerHTML` rebuild.
- Confirm reorder is applied to the source-of-truth array and then re-rendered via the existing refresh function.
- Confirm drag-over and dragging visual states appear and clear correctly.

### Never Set Inline style.maxHeight on a Flex-Child Image

Context:
- Applies to preview modals, lightboxes, or any container where an image is a flex child and the container uses `flex: 1` or `min-height: 0` to control sizing.

Rule:
- Never assign `style.maxHeight` to an image element via JavaScript.
- Inline styles override CSS constraints and will cause portrait images to overflow their container on viewports smaller than the hardcoded pixel value.
- Use an explicit viewport-anchored CSS value instead: `max-height: calc(92vh - Xpx)` applied in the stylesheet.
- `max-height: 100%` on a flex child is unreliable when the parent uses `flex: 1` without an explicit height — always prefer a viewport-based constraint.

Avoid:
- `img.style.maxHeight = '1200px'` (or any pixel value) in a JS `onload` handler.
- Relying on `max-height: 100%` on a flex child inside a `flex: 1` parent without an explicit pixel or viewport anchor.

Validation:
- Confirm no JS `onload` or resize handler assigns `style.maxHeight` to an image inside a modal or preview container.
- Confirm the image's `max-height` CSS value is viewport-anchored (e.g., `calc(92vh - 52px)`).
- Confirm portrait images at small window heights do not overflow or get clipped by the container.

### All Non-Submit Buttons Must Have type="button"

Context:
- Applies to every `<button>` element in renderer HTML that is not intended to submit a form: close buttons, cancel buttons, dismiss buttons, icon-only action buttons.

Rule:
- HTML `<button>` defaults to `type="submit"`. Any button without an explicit type that is inside or near a `<form>` element will submit the form when clicked.
- Every close, dismiss, cancel, and non-submit action button must carry `type="button"`.
- When auditing renderer HTML, grep for `<button` and verify each instance either has `type="button"` or is an intentional submit.

Avoid:
- Omitting `type="button"` from close/cancel buttons for brevity.
- Assuming a button is safe because it does not look like a submit button visually.

Validation:
- Confirm every modal close button has `type="button"`.
- Confirm every cancel/dismiss/action button that is not a form submit has `type="button"`.
- Grep renderer HTML for `<button` missing an explicit `type=` attribute before closing a UI task.

### Modal open() Focus Fallback Must Target a Persistent Element

Context:
- Applies to any modal that sets programmatic focus in its `open()` function, particularly when removing or conditionally rendering elements that were previously used as focus targets.

Rule:
- The focus fallback in a modal's `open()` must always target an element that is unconditionally present when the modal is open.
- Footer buttons (Back, Done) are reliable fallback targets. The modal X/close button is not — it may be conditionally absent.
- When removing a modal button from HTML, grep for its ID across all renderer JS files before closing the task. Focus management references in `open()` functions are separate from click listeners and are easily missed.

```js
// Safe pattern: target a persistently rendered footer button
const firstInput = container.querySelector('input, [tabindex="0"]');
(firstInput || document.getElementById('emmBackBtn'))?.focus();

// Unsafe pattern: target a conditionally rendered X button
(firstInput || $closeBtn())?.focus();  // $closeBtn() returns null if X was removed
```

Avoid:
- Using the modal X/close button as a focus fallback — it can be removed, leaving the fallback silently returning null.
- Searching only HTML and click listeners when removing a modal DOM element. The element's ID may be used in `open()` focus management in the same or a related JS module.
- Relying on optional chaining to mask a null fallback — focus is silently dropped, causing a keyboard accessibility regression.

Validation:
- After removing any modal DOM element, grep for its ID across all renderer JS files.
- Confirm the `open()` focus fallback resolves to a non-null element when the modal opens.
- Confirm focus lands on a visible, interactive element when the modal opens with no pre-filled input.

### Async Form Prefill Requires Two Guards and a Preview Trigger

Context:
- Applies when replacing a synchronous form prefill with an async IPC call in any modal or panel that can be entered, exited, and re-entered by the user.

Rule:
- Two guards are required for correct async prefill:
  1. Module-state guard: `if (moduleStateVar) return` before and inside the `.then()` — prevents duplicate IPC calls on re-entry and prevents clobbering user edits if IPC resolves after interaction.
  2. DOM-value guard: `if (el && !el.value)` inside the `.then()` — prevents overwriting partial user input that arrived before IPC resolved.
- Both guards are necessary. The module guard does not protect DOM values; the DOM guard does not prevent redundant IPC calls.
- Call `_updateEventPreview()` (or equivalent preview/validation trigger) inside the `.then()` so the preview reflects the async-filled values.
- All navigation-out paths must reset the module-state variable to `null` so the async prefill fires fresh on next entry.

```js
// Correct async prefill pattern
function open() {
  if (_prefillDate) {
    _renderWithDate(_prefillDate);
    return;
  }
  window.api.getTodayDate().then(date => {
    if (_prefillDate) return;               // guard 1: re-entry or user already edited
    if (yearEl && !yearEl.value) {          // guard 2: do not clobber partial input
      yearEl.value = date.year;
    }
    _updateEventPreview();                  // sync preview after async fill
  });
}
```

Avoid:
- Using only the module-state guard and assuming IPC will always resolve before user interaction.
- Using only the DOM-value guard and allowing redundant IPC calls on every re-entry.
- Forgetting to call the preview/validation trigger after the async write.
- Leaving the module-state variable set across sessions (navigation-out paths must reset it).

Validation:
- Confirm both module-state and DOM-value guards are present.
- Confirm `_updateEventPreview()` (or equivalent) is called inside the `.then()`.
- Confirm all navigation-out paths reset the module-state variable to `null`.
- Confirm re-entering the modal after editing the field does not clobber user input.

### Data-Attribute CSS Tab Panel Visibility

Context:
- Applies when adding tabbed navigation to any modal or panel in the renderer (e.g., Activity Log filter tabs, multi-section drawers).

Rule:
- Use `data-active="<tab>"` on the container element and `data-tabs~="<tab>"` (whitespace-token attribute) on each panel.
- CSS handles all visibility: `.al-tabs[data-active="tab"] .al-panel[data-tabs~="tab"] { display: block }`.
- JS only updates `container.dataset.active = btn.dataset.tab` on button click. No per-panel class toggling.
- This keeps the tab count from the panel count decoupled — adding a new tab or panel requires only HTML and CSS changes.

```js
// _wireAlTabs — the complete JS wiring
function _wireAlTabs() {
  const tabs = container.querySelector('.al-tabs');
  if (!tabs) return;
  tabs.querySelectorAll('.al-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('.al-tab-btn').forEach(b => b.classList.remove('al-tab-btn--active'));
      btn.classList.add('al-tab-btn--active');
      tabs.dataset.active = btn.dataset.tab;
    });
  });
}
```

Avoid:
- Toggling panel visibility with per-panel JS class changes on every tab click.
- Using `display` inline styles in JS for tab panels.
- Rebuilding the full modal body to switch tabs — only `dataset.active` needs to change.

Validation:
- Confirm tab container has `data-active` and each panel has `data-tabs~=` covering all its visible tabs.
- Confirm switching tabs does not re-render the full modal body.
- Confirm adding a new tab requires only HTML + CSS changes, no new JS toggle logic.

### data-ms-tab Delegate Pattern for Two-Tab Modals

Context:
- Applies when adding exactly two tabs to an existing modal that does not have a wrapping tab-container element carrying `data-active` state (i.e., the `data-active` container pattern is impractical because the modal was not designed for tabs from the start).

Rule:
- Add `data-ms-tab="panelId"` to each tab button.
- Wire with `querySelectorAll('[data-ms-tab]').forEach(btn => btn.addEventListener('click', () => _msSetTab(btn.dataset.msTab)))`.
- `_msSetTab(id)` iterates all known panel IDs to: set `display: block/none`, update `aria-selected` on each tab button, and toggle an active class (`ms-tab-active`).
- Use `role="tablist"`, `role="tab"`, `role="tabpanel"`, and `aria-controls` on the tab elements for accessible semantics.
- This pattern is appropriate for two-tab modals added to existing modal structures. For new modals with three or more tabs, prefer the `data-active` container pattern (see rule above).

```js
function _msSetTab(tabId) {
  ['msTabMetadata', 'msTabRegistry'].forEach(id => {
    const panel = document.getElementById(id + '-panel');
    const btn   = document.querySelector(`[data-ms-tab="${id}"]`);
    const isActive = id === tabId;
    if (panel) panel.style.display = isActive ? '' : 'none';
    if (btn)   { btn.classList.toggle('ms-tab-active', isActive); btn.setAttribute('aria-selected', String(isActive)); }
  });
}
// Wiring
document.querySelectorAll('[data-ms-tab]').forEach(btn =>
  btn.addEventListener('click', () => _msSetTab(btn.dataset.msTab))
);
```

Avoid:
- Using per-panel `if/else` instead of an array iteration — adding a third tab requires editing the function body.
- Omitting `aria-selected` updates — keyboard/screen reader tab state will be wrong.
- Mixing this pattern with the `data-active` container pattern in the same modal.

Validation:
- Confirm clicking each tab sets `aria-selected="true"` on the active button and `aria-selected="false"` on inactive ones.
- Confirm tab panel visibility switches correctly.
- Confirm adding a third tab only requires adding one entry to the known-IDs array in `_msSetTab`.

### IPC Async Action Buttons — Disable-and-Wait Pattern

Context:
- Applies to any renderer button that triggers an async IPC call where results arrive via a separate IPC progress listener (e.g., Retry Failed metadata, Verify Integrity variants).

Rule:
- The click handler disables the button immediately (`btn.disabled = true`) and sets loading text.
- The click handler must NOT re-enable the button on IPC return or in a `.catch()`.
- The button's final state (re-enabled with new label, or removed) comes exclusively from the panel refresh triggered by the IPC progress listener (`batch_complete`, `batch_error`, or equivalent).
- Include a `btn.disabled` guard at the top of the handler to prevent duplicate triggers if clicked twice before the listener fires.

```js
function _wireRetryBtn() {
  const btn = document.getElementById('alRetryMetaBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!_metaBatchId || btn.disabled) return;   // duplicate-trigger guard
    btn.disabled    = true;
    btn.textContent = 'Retrying…';
    try {
      await window.api.retryMetadata(_metaBatchId);
      // Do NOT re-enable here — batch_complete/batch_error listener refreshes the panel
    } catch {
      btn.disabled    = false;                   // only re-enable on hard IPC failure
      btn.textContent = 'Retry Failed';
    }
  });
}
```

Avoid:
- Re-enabling the button in the IPC call's success path — the panel refresh triggered by `batch_complete` rebuilds the button in the correct state; a second re-enable races with it.
- Omitting the `btn.disabled` guard — allows double-trigger if clicked before the listener fires.
- Refreshing the full modal body in the click handler — use targeted panel refresh functions instead.

Validation:
- Confirm the button is disabled immediately on click and shows loading text.
- Confirm the button is not re-enabled inside the IPC `.then()` or success path.
- Confirm the `btn.disabled` guard at the top of the handler prevents double-trigger.
- Confirm the progress listener (`batch_complete`/`batch_error`) triggers the panel refresh that rebuilds the button in the correct state.

### Live Modal Panel Refresh via IPC Progress Listener

Context:
- Applies when an Activity Log or similar modal panel must reflect the live state of a background operation (metadata writes, cleanup, verification) that reports progress via an IPC listener.

Rule:
- Hook targeted panel refresh calls into the existing IPC progress listener branches (`batch_complete`, `batch_error`), not into the button click handler.
- Guard every refresh function with `classList.contains('open')` before touching the DOM — the listener fires whether or not the modal is visible.
- Cache any async data needed for refresh (e.g., import entries) in a module-level variable during the initial modal render so live refreshes are synchronous.
- Replace only the affected panel's `innerHTML` (e.g., the metadata panel). Do not call `body.innerHTML = _renderActivityLogBody(...)` on every progress event — that resets tab state and re-renders all panels.

```js
function _refreshAlMetadataPanel() {
  if (!document.getElementById('activityLogModal')?.classList.contains('open')) return;
  // Use .al-panel--section to skip the shared-token header panel (see rule below).
  const panel = document.getElementById('alBody')?.querySelector('.al-panel--section[data-tabs~="metadata"]');
  if (!panel) return;
  panel.innerHTML = `<p class="al-section-label">Metadata</p>${_buildMetadataSection()}`;
  _wireAlRetryBtn();   // re-wire any interactive elements in the refreshed panel
}

// Hook in the existing progress listener
if (progress.event === 'batch_complete') {
  // ... update _metaBatch* state ...
  _refreshAlMetadataPanel();
}
```

Avoid:
- Calling `body.innerHTML = _renderActivityLogBody(...)` on `file_done` events — resets all panels and tab state on every file completion.
- Missing the `classList.contains('open')` guard — the listener fires when the modal is closed, causing silent DOM writes to an invisible element.
- Requiring a full async re-read to refresh a panel — cache necessary data at render time.

Validation:
- Confirm the refresh function checks `classList.contains('open')` before modifying the DOM.
- Confirm only the affected panel's `innerHTML` is replaced, not the full modal body.
- Confirm tab state (active tab, scroll position) is preserved after a live refresh.
- Confirm interactive elements inside the refreshed panel are re-wired after the `innerHTML` replacement.

### Activity Log Refresh Selector Must Use `.al-panel--section`

Context:
- Applies to every Activity Log panel refresh function (`_refreshAlMetadataPanel`, `_refreshAlErrorsPanel`, and any future equivalents) that selects a tab-content panel by its `data-tabs~=` token.

Rule:
- The Activity Log header panel carries `data-tabs="all import metadata cleanup errors"` so that the event name row appears on every tab. This means it contains every tab's token.
- `querySelector('.al-panel[data-tabs~="<tab>"]')` matches the header panel first (it appears first in DOM order) and writes section content into it, making that content visible on every tab that shows the header — including Import, Cleanup, and Errors.
- All refresh functions must use `.al-panel--section[data-tabs~="<tab>"]`. The header panel does not carry the `al-panel--section` modifier class, so it is always skipped.

```js
// WRONG — matches the header panel first
querySelector('.al-panel[data-tabs~="metadata"]')

// CORRECT — skips header, targets the content panel
querySelector('.al-panel--section[data-tabs~="metadata"]')
querySelector('.al-panel--section[data-tabs~="errors"]')
```

Avoid:
- Writing `.al-panel[data-tabs~="X"]` in any refresh function — this matches the header panel for all tab tokens.
- Assuming the first matching panel is the content panel — the header panel always appears earlier in the DOM.

Validation:
- Confirm every Activity Log refresh function uses `.al-panel--section[data-tabs~="<tab>"]`, not `.al-panel[data-tabs~="<tab>"]`.
- Grep `renderer.js` for `querySelector('.al-panel[data-tabs~=` — any match without `--section` is a bug.
- Confirm metadata and errors content does not appear in the Import tab after a batch completes.

### One `_build<X>Section()` Function Per Activity Log Tab

Context:
- Applies when adding or modifying any Activity Log tab's content in `_renderActivityLogBody()`.

Rule:
- Each tab's content must be produced by its own named builder function: `_buildImportSection(summary, issueCount)`, `_buildMetadataSection()`, `_buildSourceCleanupSection()`, `_buildErrorsSection(entries)`.
- Inline section builds inside `_renderActivityLogBody()` make tab content boundaries invisible. It becomes impossible to quickly audit whether metadata, cleanup, or errors content is leaking into the import panel without reading 80+ lines of inline template code.
- `_renderActivityLogBody()` should call the builder functions; it must not contain the section logic itself.

```js
// CORRECT — each tab section is explicit and auditable
return `<div class="al-tabs" ...>
  <div class="al-panel" data-tabs="all import">
    ${_buildImportSection(summary, issueCount)}
  </div>
  <div class="al-panel al-panel--section" data-tabs="all metadata">
    ${_buildMetadataSection()}
  </div>
  ...
</div>`;
```

Avoid:
- Building import section HTML inline inside `_renderActivityLogBody()` — auditing tab separation requires reading the full inline block.
- Mixing section builder calls with inline HTML fragments in the same template.

Validation:
- Confirm `_renderActivityLogBody()` contains no inline `if (!summary) { ... } else { ... }` block for import panel content — it must call `_buildImportSection()`.
- Confirm each tab section has a named `_build<X>Section()` function.

### Derive Operation Status via Pure Function — Never Store Derived Status

Context:
- Applies to any renderer panel or modal that displays the status of a background operation (metadata writes, cleanup, verification, import) derived from multiple module-level state variables.

Rule:
- Operation status must be derived fresh on each render via a pure function that reads the underlying state variables. Never store derived status as its own module-level variable.
- A stored status variable creates desync risk: if any of the underlying variables change and the stored status is not updated in every code path, the displayed status will be stale.
- The pure function should cover all meaningful status combinations exhaustively: `running`, `applied`, `partial`, `failed`, `idle`.

```js
// Correct — derived on each call
function _computeMetaStatus() {
  if (_metaBatchRunning)         return 'running';
  if (!_metaBatchTimestamp)      return 'idle';
  if (_metaBatchFailed === 0)    return 'applied';
  if (_metaBatchFailed < _metaBatchTotal) return 'partial';
  return 'failed';
}

// Wrong — stored status can become stale
let _metaStatus = 'idle'; // risks desync if not updated everywhere
```

Avoid:
- Storing an operation's derived status as a module-level variable and updating it imperatively in each handler — misses code paths and produces stale status.
- Conflating status derivation with side effects (e.g., writing to the DOM inside the pure function).

Validation:
- Confirm status is computed by a pure function that takes no arguments other than reading module-level state variables.
- Confirm no separate `_metaStatus` (or equivalent) variable is stored and updated imperatively.
- Confirm the function covers all meaningful state combinations.

### Inline Confirm Pattern for Large-Operation Buttons

Context:
- Applies to any renderer panel action button that triggers a large or destructive operation (e.g., Reapply Metadata, Delete Source, Bulk Rename) and needs a confirm/cancel step without opening a modal overlay.

Rule:
- Swap the action area's `innerHTML` to display the confirm prompt and Cancel/Confirm buttons. Do not open a new modal overlay for simple confirmation flows within a panel.
- The Cancel button must call the existing panel refresh function (e.g., `_refreshAlMetadataPanel()`) — not a hand-written restore — so the panel is always rebuilt from current state.
- The Confirm button calls the action function directly (e.g., `_doReapply()`).
- Estimate the operation size for the confirm prompt using available cached data (e.g., `_alLastImportEntries.reduce()`) rather than triggering a new IPC call.

```js
// Confirm prompt injected into the action area
function _showReapplyConfirm(area) {
  const estimated = _alLastImportEntries.reduce((n, e) => n + (e.fileCount || 0), 0);
  area.innerHTML = `
    <p class="al-confirm-text">Reapply metadata to ~${estimated} files?</p>
    <div class="al-confirm-btns">
      <button type="button" id="alReapplyCancel" class="sc-btn-cancel">Cancel</button>
      <button type="button" id="alReapplyConfirm" class="al-reapply-btn">Reapply</button>
    </div>`;
  document.getElementById('alReapplyCancel').onclick  = () => _refreshAlMetadataPanel();
  document.getElementById('alReapplyConfirm').onclick = () => _doReapply();
}
```

Avoid:
- Opening a new modal overlay for a simple confirm/cancel that belongs within an existing panel.
- Manually restoring the pre-confirm HTML on Cancel instead of calling the panel refresh function — the refresh function keeps the state consistent, a manual restore can be stale.
- Triggering a new IPC call to compute the operation size for the confirm prompt — use cached data already available from the last render.

Validation:
- Confirm the action area's `innerHTML` is swapped, not a new modal opened.
- Confirm the Cancel handler calls the panel refresh function, not a hand-written HTML restore.
- Confirm the Confirm handler calls the action function directly.
- Confirm the file count estimate uses cached data and does not trigger a new IPC call.

### CSS Custom Property Verification Before Shipping

Context:
- Applies to any new or modified CSS rule in the renderer that introduces a CSS custom property (CSS variable) reference.

Rule:
- Verify every `var(--token-name)` used in new or modified CSS rules exists in the actual theme file(s) before shipping.
- Undefined CSS variables silently produce no-op behavior: transparent colors, missing borders, no-visible-state changes on hover/focus. The browser applies no error, making the defect invisible without visual inspection.
- Check against `renderer/theme.css` (or the equivalent theme/token file) for the actual defined variable names.

Common undefined token pitfalls in AutoIngest:
- `--bg-tertiary` — not defined; use `--bg-secondary` or `--surface-subtle`.
- `--border-hover` — not defined; use `--border-strong`.
- `--text-muted` — verify definition before use; use `--text-secondary` if absent.

Avoid:
- Using CSS variable names that look plausible (`--bg-tertiary`, `--border-hover`) without confirming they exist in the theme.
- Assuming a hover or focus state is working because it applies no error — test it visually.
- Copying variable names from other projects or frameworks without checking AutoIngest's token vocabulary.

Validation:
- Before shipping any new CSS rule: grep `renderer/theme.css` (and any imported token files) to confirm every `var(--...)` reference is defined.
- Visually confirm hover/focus/active states produce the intended visual change in both light and dark themes.

### Sidebar Element Visibility vs Sidebar List Content

Context:
- Applies to `#sidebar`, `#folderList`, `renderFolders()`, `renderCurrentView()`, and any code path that populates the folder navigation sidebar.

Rule:
- `renderFolders(tree, dcimPath)` writes to `folderList.innerHTML` (the list content) only. It does NOT touch the `#sidebar` element's `display` property.
- `renderCurrentView()` is the ONLY function that controls `#sidebar` visibility: `sidebar.style.display = (viewModeType === 'folder') ? '' : 'none'`.
- When calling `renderFolders()` from outside `renderCurrentView()` (e.g., `_loadSourceFolderTree`, a batch progress handler, or any async load path), always explicitly set `sidebar.style.display = ''` immediately after if folder mode is active. Populating the list content without showing the container leaves a populated but invisible sidebar.
- The sidebar element starts hidden (`display: none`) during media-view initialization. Any code path that transitions into folder mode and populates the sidebar via `renderFolders()` directly is responsible for making the container visible.

Avoid:
- Assuming `renderFolders()` makes the sidebar visible — it does not.
- Calling `renderCurrentView()` when you only need to populate the list content (it also triggers file-area renders).
- Setting `sidebar.style.display` from any path that runs in media-view context.

Validation:
- After any `renderFolders()` call outside `renderCurrentView()`: confirm `#sidebar` is actually visible without requiring a view toggle.
- Confirm sidebar remains hidden in media view and visible in folder view.

### Two-Function Close Pattern for Portal IIFE Modules

Context:
- Applies to any portal component (appended to `#dropdown-root` or a fixed overlay root outside the main DOM tree) whose `onClose` callback triggers a panel re-render that in turn needs to close the portal.

Rule:
- Every portal IIFE must expose two close behaviors:
  - `close()`: tears down the menu AND calls the `onClose` callback. Used by outside-click, Escape, and trigger re-click.
  - `closeQuiet()`: tears down the menu WITHOUT calling the callback. Used by `renderGroupPanel()` and any panel-rebuild path to avoid re-entry.
- Null the `_onClose` reference before invoking it inside `close()` to prevent re-entrant calls if the callback itself calls back into the portal.

```js
function close() {
  const cb = _onClose;
  _onClose = null;   // null before calling to prevent re-entry
  _teardown();
  if (cb) cb();
}
function closeQuiet() {
  _onClose = null;
  _teardown();
}
```

- In `renderGroupPanel()` (and equivalent panel rebuild functions): call `closeQuiet()` on every open portal, not `close()`.

Avoid:
- Exposing only a single `close()` function when the `onClose` callback itself triggers a panel rebuild that calls `close()` again — this creates infinite recursion.
- Calling `close()` from within a render/rebuild path that was itself triggered by `onClose`.

Validation:
- Confirm the portal module exposes both `close()` and `closeQuiet()`.
- Confirm `renderGroupPanel()` (and any panel rebuild path) calls `closeQuiet()` on all open portals.
- Confirm `_onClose` is nulled before the callback is invoked inside `close()`.
- Confirm that toggling the picker trigger while the panel rebuilds does not trigger infinite re-entry.

### In-Place Trigger Update for Multi-Select Picker Toggles

Context:
- Applies when a multi-select picker (checkbox-based, stays open across multiple selections) needs to keep the trigger button's label and badge in sync while the picker remains open.

Rule:
- Do NOT call `renderGroupPanel()` (or any full panel rebuild) on each picker toggle (checkbox click). A full rebuild destroys and recreates the DOM, closing the open picker and resetting the interaction.
- Instead, update only the specific trigger button's label and status badge in-place via a targeted function: `querySelector('[data-gid="…"]')` or equivalent data attribute selector.
- Call `renderGroupPanel()` exactly once: on picker close (via the `onClose` callback), not on each toggle.
- The in-place update function (`_updateMetaTriggerInPlace(gid, newTags)`) must be called from the picker's `onChange` handler.

Avoid:
- Calling `renderGroupPanel()` inside the picker's `onChange` callback — destroys the open picker on each toggle.
- Omitting the in-place update and allowing the trigger label to fall out of sync while the picker is open.

Validation:
- Confirm `onChange` calls the in-place trigger update, not `renderGroupPanel()`.
- Confirm the picker stays open and interactive after each checkbox toggle.
- Confirm `renderGroupPanel()` is called once on picker close.
- Confirm the trigger button label and badge reflect the current selection after each toggle.

### Dedicated Success Flag — Do Not Infer Post-Import UX From DOM State

Context:
- Applies to any modal or flow where success-path UI (action choosers, completion panels, secondary CTAs) must appear only after a confirmed successful operation.

Rule:
- Use a dedicated boolean flag set at the source-of-truth function (e.g., `_postImportSucceeded = (errors === 0)` inside `showProgressSummary()`).
- Do not infer operation success from DOM state (presence of a CSS class, visibility of an element, innerHTML content). DOM state can be mutated independently and is not authoritative.
- The flag is the single authoritative signal for branching Done-handler behavior.

Avoid:
- Checking whether `#progressSummary` has `visible` or `success` class to decide which Done path to take.
- Deriving success from counting DOM children or checking rendered text.

Validation:
- Confirm the success flag is set in exactly one place, at the function where outcome is determined.
- Confirm the Done handler branches on the flag, not on any DOM query.
- Confirm the flag is reset at the start of each new operation so stale success state does not carry over.

### Dynamically Injected Modal Panels Must Be Cleaned Up in Two Places

Context:
- Applies to any `<div>` or panel injected into a modal at runtime (e.g., `#postImportActions`, inline confirm prompts) rather than present in the initial HTML.

Rule:
- Remove the panel in BOTH:
  1. The teardown/close function (`_closeProgressModal()` or equivalent) — the normal close path.
  2. The re-entry/reset function at the start of a new operation (`showProgress()` or equivalent) — guards against abnormal flows (card disconnect, IPC abort) that bypass the normal close path.
- Missing the re-entry cleanup leaves stale panels visible across new import sessions.

Avoid:
- Removing a dynamically injected panel only in the teardown function and assuming abnormal flows always hit teardown.
- Injecting a panel without auditing all code paths that reset or restart the modal.

Validation:
- Confirm the panel removal appears in the teardown function.
- Confirm the panel removal also appears in the operation re-entry/reset function.
- Confirm a mid-operation source disconnect does not leave the panel stale in the next session.

### Clear Transient State Before Calling a Shared Teardown That Syncs the UI

Context:
- Applies when an action needs to clear module-level transient state (e.g., `selectedFiles`) and then call a shared teardown function that itself runs a UI sync (e.g., `updateSelectionBar()`, `renderCurrentView()`).

Rule:
- Clear the transient state FIRST, then call the shared teardown.
- The shared teardown's UI sync call sees the final, cleared state in one pass.
- Clearing after the teardown call causes the sync to render an intermediate stale state, then correct itself — producing a duplicate DOM update.

```js
// Correct order
selectedFiles.clear();
_selectionAnchor = null;
_closeProgressModal();    // calls updateSelectionBar() — sees cleared state

// Wrong order
_closeProgressModal();    // calls updateSelectionBar() — sees stale selectedFiles
selectedFiles.clear();    // second clear produces no render
```

Avoid:
- Calling the shared teardown before clearing the state it will sync.
- Relying on a second cleanup call after teardown to correct the stale render.

Validation:
- Confirm transient state (selectedFiles, groups, etc.) is cleared before the shared teardown is called.
- Confirm `updateSelectionBar()` or equivalent runs only once with the final state.

### Delegate to ejectBtn.click() — Do Not Re-Implement the Eject Pipeline

Context:
- Applies when a post-import chooser, modal action, or any UI flow needs to trigger the eject sequence for a memory card or external drive.

Rule:
- Call `document.getElementById('ejectBtn')?.click()` to reuse the full 4-phase eject pipeline (I/O shutdown, OS flush, unmount, confirmation modal, `resetAppState()`).
- Before triggering, close any blocking overlay (e.g., the progress modal) so the eject confirmation overlay can render unobstructed.
- Never duplicate the eject pipeline inline in a modal action handler.

Avoid:
- Copying eject IPC calls and confirmation logic into a new handler instead of delegating to the existing eject button.
- Triggering `ejectBtn.click()` while the progress overlay is still visible — the eject confirmation will render beneath it.

Validation:
- Confirm the eject action calls `ejectBtn.click()` and does not re-implement eject steps.
- Confirm the progress modal (or any blocking overlay) is closed before `ejectBtn.click()` fires.
- Confirm the eject confirmation modal renders correctly and the full 4-phase eject completes.

### Clickable Overview Tile Pattern

Context:
- Applies when adding a new actionable tile to the system overview dashboard (the `#overviewSection` tiles row), where clicking the tile opens a modal.

Rule:
- Use `class="ov-tile ov-tile--action"` on the tile element.
- Add `role="button" tabindex="0"` for keyboard accessibility.
- Wire both a `click` listener and a `keydown` listener that handles `Enter` and `Space` (`if (e.key === 'Enter' || e.key === ' ')`).
- The modal opened by the tile must follow the standard `emm-overlay / emm-box / emm-topbar / emm-header / emm-footer` structure shared by all AutoIngest modals.
- Reuse `.ov-tile` CSS; add only delta CSS for any new visual state specific to the tile.

```html
<div class="ov-tile ov-tile--action" id="ovMetadataSync"
     role="button" tabindex="0"
     aria-label="Open Metadata Sync">
  <!-- tile content -->
</div>
```

```js
tile.addEventListener('click', openMetadataSyncModal);
tile.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') openMetadataSyncModal();
});
```

Avoid:
- Using a `<button>` element as a tile — it fights the existing tile sizing and glass styling.
- Wiring only `click` without `keydown` — keyboard navigation bypasses click on non-button elements.
- Creating a new modal structure instead of reusing `emm-overlay/emm-box/emm-topbar/emm-header/emm-footer`.

Validation:
- Confirm tile has `role="button"` and `tabindex="0"`.
- Confirm both `click` and `keydown` (Enter/Space) open the modal.
- Confirm the modal uses the standard `emm-*` structure.
- Confirm no new modal layout class or overlay system was introduced.

### Rich Sync Result Inline Panel Pattern

Context:
- Applies to any sync or batch-operation row in a modal or panel (e.g., Metadata Sync event rows) where the user triggers an operation and expects feedback inline without navigating away.

Rule:
- Change the trigger button to "Syncing…" and disable it immediately on click.
- Show feedback in an inline `.ms-result-panel` appended below the row — do NOT hide the row itself.
- Remove any previous `.ms-result-panel` for the same row before starting a new sync (stale result panels must not accumulate).
- On success: show keyword chips + stat summary (files scanned, keywords added, elapsed ms) + file write status (`event.metadata.json updated`).
- On failure: show a readable error message and change the button to "Retry" (re-enabled).
- The IPC handler must return a structured result with enough fields for the UI to render without a second round-trip: `{ ok, eventName, scannedFiles, scannedXmp, updatedFiles, externalKeywordsAdded, unknownKeywordsFound, skippedConflicts, elapsedMs, addedKeywords[], unknownKeywords[], errors[] }` plus backward-compat aliases.

Avoid:
- Hiding the event row during sync — it must remain visible so the user knows which event is being processed.
- Leaving a stale result panel visible from the previous sync when a new one starts.
- Requiring a second IPC call to fetch result details after the sync completes.

Validation:
- Confirm the row stays visible during and after sync.
- Confirm any previous `.ms-result-panel` is removed before the new sync starts.
- Confirm success state shows stats and keyword chips.
- Confirm failure state shows the error and re-enables the button as "Retry".
- Confirm the IPC handler returns all required fields in a single response.

### Lazy Modal Injection Pattern for Infrequently Used Modals

Context:
- Applies when adding a modal (preview, detail panel, confirmation) that is triggered infrequently and should not pollute the static `index.html` with markup that is rarely visible.

Rule:
- Create the modal DOM once inside a `_msEnsurePreviewModal()` (or equivalent) guard function. On first call: build the HTML, append to `document.body`, wire persistent listeners (Escape, backdrop click, close button), and set a module-level flag. On subsequent calls: skip creation, the node already exists.
- This pattern avoids bloating `index.html` with large modal templates that are only needed on demand.
- Wire Escape, backdrop click, and the `×` button to the same close function so all dismiss paths are consistent.
- Do not rely on `innerHTML` replacement inside a container to "inject" the modal — appending a full node to `document.body` is the correct pattern.

Avoid:
- Adding rarely-used modal HTML to `index.html` where it is always parsed and rendered by the browser even when never shown.
- Creating the modal DOM inside the open function on every call — creates duplicate nodes and duplicate listeners.
- Wiring Escape only to the overlay, and backdrop click only to the close button, etc. — inconsistent dismiss paths cause keyboard accessibility regressions.

Validation:
- Confirm the ensure function sets a module-level flag after first creation.
- Confirm calling the ensure function a second time does not create a second modal node.
- Confirm Escape, backdrop click, and `×` button all call the same close function.
- Confirm `document.body` has exactly one instance of the modal node after multiple opens.

### Row Click Guard When a Row Contains an Action Button

Context:
- Applies to any interactive table row or list row that contains a nested button (e.g., a Sync, Update, or Delete button), where the row itself is also clickable (e.g., opens a detail/preview panel).

Rule:
- The nested button handler must call `e.stopPropagation()` so the row's click handler does not also fire.
- The row click handler must check `if (e.target.closest('.ms-sync-btn')) return;` (or equivalent selector) as an additional guard.
- Both guards together are required. `stopPropagation()` alone does not protect against click events that arrive directly on the button via event delegation. The `closest()` check alone does not prevent double-fire when the button's own listener is wired separately and fires before the row listener.

Avoid:
- Relying on `stopPropagation()` alone in the button handler.
- Relying on the `closest()` guard alone in the row handler.
- Omitting the `closest()` guard because `stopPropagation()` "should be enough".

Validation:
- Confirm clicking the action button does not also trigger the row's detail/preview handler.
- Confirm clicking anywhere else on the row (outside the button) does open the detail/preview.
- Confirm the button handler calls `e.stopPropagation()`.
- Confirm the row handler opens with `if (e.target.closest('.ms-sync-btn')) return;`.

### Clone Button Nodes Before Re-Wiring to Prevent Stale Listener Accumulation

Context:
- Applies when a modal or panel is opened multiple times and a button inside it has an event listener wired programmatically on each open (e.g., an Update, Confirm, or Apply button whose handler depends on the current open context).

Rule:
- Before adding a new `addEventListener` to a button, replace the button node with a clone: `const fresh = btn.cloneNode(true); btn.parentNode.replaceChild(fresh, btn); btn = fresh;`.
- This removes all previously attached listeners in one operation without requiring a corresponding `removeEventListener` call (which would require keeping a reference to the old function).
- Only clone the button immediately before the new listener is added — do not clone on close or on modal hide, as the original node may be reused.

Avoid:
- Adding a new `addEventListener` on the same button node on each open without removing the old listener — stale handlers accumulate and fire multiple times per click after repeated opens.
- Using `removeEventListener` without a stored reference to the original function — it silently no-ops and the old listener remains.
- Cloning the entire modal on each open instead of only the button node.

Validation:
- Confirm the button node is cloned immediately before the new listener is added on each open.
- Confirm clicking the button after three opens fires the handler exactly once, not three times.
- Confirm the clone replaces the old node in the DOM (`replaceChild`) rather than being appended alongside it.

### Preview UI Must Use Operator Language for Section Headings

Context:
- Applies to any preview modal or panel in the Metadata Sync feature (or any future sync/diff feature) that displays keyword change categories derived from backend classification results.

Rule:
- Section headings must use operator-facing language: "Existing Metadata", "New Additions", "Changed / Removed", "Needs Review".
- Never expose backend field names or internal classification labels as visible section headings: `alreadyPresent`, `willAdd`, `unknownKeywords`, `protectedIdentityMatches`, `ignoredIdentity` must not appear as UI text.
- Classification logic stays in the backend. Operator-friendly labels are applied only in the renderer. No backend change is needed to change what terminology the operator sees.

Avoid:
- Using `result.summary` field names directly as section headings.
- Copying backend enum values or object keys into heading strings.
- Requiring a backend change to rename a visible section label.

Validation:
- Confirm no section heading in the preview UI matches a backend object key or field name verbatim.
- Confirm all four standard section labels ("Existing Metadata", "New Additions", "Changed / Removed", "Needs Review") are present where applicable.
- Confirm the backend was not modified to change visible section label copy.

### Compact Chip Row Truncation With +N More

Context:
- Applies to any compact row in the Metadata Sync pending list (or similar summary rows) that shows multiple chips (e.g., photographer/subfolder chips) inline.

Rule:
- Truncate visible chips at 4. When more than 4 chips exist, show only the first 4 and append a "+N more" chip.
- The "+N more" chip must use a dashed border and italic text style to visually distinguish it from actionable or selectable chips.
- This keeps rows scannable without hiding the existence of additional items.

```javascript
const MAX_SUB = 4;
const moreSubCount = Math.max(0, subChips.length - MAX_SUB);
const moreSubHtml = moreSubCount > 0
  ? `<span class="ms-event-subfolder ms-event-subfolder--more">+${moreSubCount} more</span>`
  : '';
```

Avoid:
- Showing all chips inline with no truncation — rows become unscannably wide when many subfolders are present.
- Using a solid or accent-color border for the "+N more" chip — it must not look like a selectable item.

Validation:
- Confirm rows with more than 4 chips show exactly 4 chips + a "+N more" chip.
- Confirm rows with 4 or fewer chips show all chips with no "+N more" chip.
- Confirm the "+N more" chip uses dashed border and italic style.

### Metadata Sync Scope Picker — Visual Container and Two-Line Item Layout

Context:
- Applies when building or modifying the "Select Event…" picker or any multi-item scope selector within the Metadata Sync modal (`renderer/index.html` + `renderer/renderer.js`).

Rule:
- The picker container (`.ms-scope-picker`) must have a `border`, `padding`, and `background` so it reads as a distinct card section — not a floating borderless element overlapping the content below it.
- The event list container (`.ms-scope-event-list`) must have its own `border`, `border-radius`, and `background` to form a clear scrollable region.
- Each event item must display two lines of context: event name (`.ms-scope-event-name`) on the first line, master folder name (`.ms-scope-event-collection`) on the second. The master folder name is derived from `masterPath.split('/').pop()` in the renderer — the backend does not need to return it.
- A `msScopeResultLabel` element must appear between the picker and the pending results to confirm which event's results are currently shown ("Results for: [event name]"). It is hidden until a scan completes.

Avoid:
- Rendering the scope picker without a bordered container — it merges visually with the results list below.
- Showing only the event name with no collection/master context — operators cannot distinguish same-named events across different collections.
- Omitting the result label — operators lose track of which event's data the pending list reflects.

Validation:
- Confirm `.ms-scope-picker` has a visible border and background that separates it from surrounding content.
- Confirm each event item shows both the event name and the master folder name.
- Confirm `msScopeResultLabel` is hidden on modal open and becomes visible after a scan completes, showing the scanned event's name.

### Stale-Result Prevention for Async UI Scans: _msScanCounter Pattern

Context:
- Applies to any renderer function that calls an async IPC and then updates a shared list element, modal content, or result area — particularly when the user can change scope (collection, event, filter) before the IPC resolves.

Rule:
- Maintain a module-level `let _msScanCounter = 0` counter.
- At the start of the leaf scan function, capture `const thisScan = ++_msScanCounter`.
- Before any DOM mutation after `await`, check `if (thisScan !== _msScanCounter) return;` and discard stale results.
- The increment belongs ONLY to the leaf scan function. Wrapper functions or scope-selector paths that delegate to the leaf scan must NOT double-increment — they call the leaf scan which increments on their behalf. Non-collection branches that directly issue IPC calls themselves DO increment.

```js
let _msScanCounter = 0;                     // module-level

async function _msScanAndRender(masterPath) {
  const thisScan = ++_msScanCounter;         // only the leaf scan increments
  _showLoadingState();
  const results = await window.api.scanPending(masterPath);
  if (thisScan !== _msScanCounter) return;   // stale — discard
  _renderResults(results);
}
```

Avoid:
- Incrementing the counter in both the collection-scope wrapper AND the leaf scan — double-increment causes the leaf scan to always see a stale counter and discard valid results.
- Rendering scan output without a counter guard when the user can change scope before the scan completes.
- Using a boolean `_scanInProgress` flag instead of a counter — a boolean cannot distinguish "this scan" from "a different newer scan".

Validation:
- Confirm the counter is incremented exactly once per logical scan start, in the leaf scan function only.
- Confirm `if (thisScan !== _msScanCounter) return` appears before every DOM mutation after each `await` in the scan path.
- Confirm rapid scope changes (e.g., clicking a different collection before results arrive) do not overwrite the correct result with a stale one.

### Light/Dark and Viewport Compatibility

Context:
- Applies to visual changes that affect colors, surfaces, text contrast, responsive spacing, or window size.

Rule:
- UI must remain readable and visually balanced in supported appearance modes and expected window sizes.
- Text, controls, and surfaces must maintain contrast and hierarchy.

Avoid:
- Hardcoded colors that break theme variables.
- Layouts that only work at one window size.
- Unchecked overflow or clipped controls.

Validation:
- Check affected UI in expected window size.
- Check overflow, alignment, spacing, and text contrast.
- Check both relevant visual states if theme/appearance is affected.

## Validation Checklist

Before making changes, read:

- `CLAUDE.md`
- `docs/ui-system.md`
- `docs/design-system.md`
- `docs/performance.md`

When implementing:

1. Identify affected UI area.
2. Locate existing pattern/component.
3. Confirm whether the issue is truly UI-layer or caused by backend/data/state.
4. Declare files to modify.
5. Apply minimal surgical change.
6. Preserve visual hierarchy.
7. Preserve design-system consistency.
8. Preserve targeted rendering behavior.
9. Validate related UI states, not only the visible state.
10. Confirm no backend/state contract impact.

If implementing:

- Do not touch `event.json`.
- Do not touch ingestion routing.
- Do not touch GroupManager logic.
- Do not touch IPC contracts unless explicitly required.
- Do not introduce business logic into UI.
- Do not add one-off styling.
- Do not perform unrelated renderer refactors.

Output:

- Files modified
- What changed
- Why it matches design-system
- UI states validated
- Performance/rendering impact
- Backend/state contract impact, if any
- Risks
- Commit message