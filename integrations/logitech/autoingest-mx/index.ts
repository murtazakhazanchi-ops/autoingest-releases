import { PluginSDK, LoggerLevel } from '@logitech/plugin-sdk';
import { autoIngestClient } from './src/sharedClient.js';
import { ToggleSelectionAction } from './src/actions/toggleSelectionAction.js';
import { NavigateFilesAction } from './src/actions/navigateFilesAction.js';
import { PreviewAction } from './src/actions/previewAction.js';

console.log('[autoingest-mx] plugin loaded');

const pluginSDK = new PluginSDK({ logLevel: LoggerLevel.INFO });

// Register plugin actions — Phase 3A hardware mapping (see
// docs/mxLogitechPlugin.md): main dial = Navigate Files, one LCD key each
// for Toggle Selection and (optional) Preview. No group/QMZ/import/archive
// actions yet.
pluginSDK.registerAction(new ToggleSelectionAction());
pluginSDK.registerAction(new NavigateFilesAction());
pluginSDK.registerAction(new PreviewAction());

await pluginSDK.connect();

// Independent of the Logi Plugin Service connection above: this is the
// plugin's OWN connection to AutoIngest's Phase 2 control transport.
// Reconnects automatically (discovery + backoff) whenever AutoIngest isn't
// running yet, restarts, or reloads its renderer — never hammers the
// descriptor file or the socket (see src/autoIngestClient.ts).
void autoIngestClient.connect();
