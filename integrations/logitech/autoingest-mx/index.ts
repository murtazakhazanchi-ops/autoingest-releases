import { PluginSDK, LoggerLevel } from '@logitech/plugin-sdk';
import { autoIngestClient } from './src/sharedClient.js';
import { ToggleSelectionAction } from './src/actions/toggleSelectionAction.js';
import { NavigateFilesAction } from './src/actions/navigateFilesAction.js';
import { PreviewAction } from './src/actions/previewAction.js';
import { SelectAllAction } from './src/actions/selectAllAction.js';
import { ClearSelectionAction } from './src/actions/clearSelectionAction.js';
import { UnassignGroupAction } from './src/actions/unassignGroupAction.js';
import { AssignG1Action } from './src/actions/assignG1Action.js';
import { AssignG2Action } from './src/actions/assignG2Action.js';
import { AssignG3Action } from './src/actions/assignG3Action.js';
import { GroupsPagePlaceholderAction } from './src/actions/groupsPagePlaceholderAction.js';

console.log('[autoingest-mx] plugin loaded');

const pluginSDK = new PluginSDK({ logLevel: LoggerLevel.INFO });

// Register plugin actions — Phase 3B Browse page hardware mapping (see
// docs/mxLogitechPlugin.md):
//
//   ┌──────────────┬──────────────┬──────────────┐
//   │    SELECT    │  SELECT ALL  │    CLEAR     │
//   ├──────────────┼──────────────┼──────────────┤
//   │   PREVIEW    │      G1      │      G2      │
//   ├──────────────┼──────────────┼──────────────┤
//   │      G3      │   UNASSIGN   │   GROUPS ›   │
//   └──────────────┴──────────────┴──────────────┘
//   Main dial: clockwise -> Navigate Files (next), counter-clockwise -> previous.
//
// Still no QMZ/import/archive actions. GROUPS › is an intentional inert
// placeholder (no device-side page system exists in plugin-sdk 0.1.1 — see
// groupsPagePlaceholderAction.ts).
pluginSDK.registerAction(new ToggleSelectionAction());
pluginSDK.registerAction(new SelectAllAction());
pluginSDK.registerAction(new ClearSelectionAction());
pluginSDK.registerAction(new PreviewAction());
pluginSDK.registerAction(new AssignG1Action());
pluginSDK.registerAction(new AssignG2Action());
pluginSDK.registerAction(new AssignG3Action());
pluginSDK.registerAction(new UnassignGroupAction());
pluginSDK.registerAction(new GroupsPagePlaceholderAction());
pluginSDK.registerAction(new NavigateFilesAction());

await pluginSDK.connect();

// Independent of the Logi Plugin Service connection above: this is the
// plugin's OWN connection to AutoIngest's Phase 2 control transport.
// Reconnects automatically (discovery + backoff) whenever AutoIngest isn't
// running yet, restarts, or reloads its renderer — never hammers the
// descriptor file or the socket (see src/autoIngestClient.ts).
void autoIngestClient.connect();
