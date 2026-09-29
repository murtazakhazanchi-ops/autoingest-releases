import { CommandAction } from '@logitech/plugin-sdk';
import { autoIngestClient } from '../sharedClient.js';

/**
 * Groups › — intentional placeholder, not a faked page system.
 *
 * plugin-sdk 0.1.1 has no true plugin-controlled pages/folders/dynamic
 * action sets on the device — the only "folder" concept in the SDK is
 * Action.groupName, a flat label for organizing entries in Options+'s own
 * Action Picker UI, not something that changes what the physical LCD keys
 * show at runtime (confirmed by inspecting the full wire protocol — see
 * docs/mxLogitechPlugin.md's SDK capability matrix). Faking a page switch
 * by reassigning keys client-side would misrepresent what's actually
 * happening and contradicts the architecture.
 *
 * This action exists so the 9th keypad slot has a real, self-documenting
 * identity in the Action Picker (rather than silently looking unassigned/
 * broken) while the actual Groups page waits on either newer SDK support
 * or a C# SDK evaluation (Phase 3C+ scope).
 */
export class GroupsPagePlaceholderAction extends CommandAction {
  name = 'groups_page_placeholder';
  displayName = 'Groups';
  description = 'Placeholder — a dedicated Groups page needs SDK page/folder support not available in plugin-sdk 0.1.1 (see docs/mxLogitechPlugin.md)';

  onKeyDown(): void {
    autoIngestClient.logMessage(
      'info',
      'groups_page_placeholder: pressed — no device-side page system in plugin-sdk 0.1.1, intentionally inert for Phase 3B',
    );
  }
}
