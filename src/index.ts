import {
  ILabShell,
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITerminalTracker } from '@jupyterlab/terminal';

import { requestAPI } from './request';
import { IStatusResponse } from './types';
import { ClaudeCodeSessionsWidget } from './widget';

const PLUGIN_ID = 'jupyterlab_claude_code_extension:plugin';
const WIDGET_ID = 'jupyterlab-claude-code-extension';

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description:
    'Side panel listing Claude Code sessions per project folder, with remote-control indicator, favorites, and one-click resume in a terminal.',
  autoStart: true,
  requires: [ILabShell],
  optional: [
    ILayoutRestorer,
    ISettingRegistry,
    ITerminalTracker,
    IDefaultFileBrowser
  ],
  activate: async (
    app: JupyterFrontEnd,
    labShell: ILabShell,
    restorer: ILayoutRestorer | null,
    settingRegistry: ISettingRegistry | null,
    terminalTracker: ITerminalTracker | null,
    fileBrowser: IDefaultFileBrowser | null
  ) => {
    const settings = app.serviceManager.serverSettings;

    let status: IStatusResponse;
    try {
      status = await requestAPI<IStatusResponse>('status', settings);
    } catch (err) {
      console.error(
        '[jupyterlab_claude_code_extension] status check failed; panel will not be registered.',
        err
      );
      return;
    }

    if (!status.enabled) {
      console.info(
        '[jupyterlab_claude_code_extension] `claude` binary not found on PATH; panel disabled.'
      );
      return;
    }

    const widget = new ClaudeCodeSessionsWidget(
      app,
      status.root_dir || '',
      terminalTracker,
      fileBrowser
    );

    // Read the sidebar setting before docking so we add the widget to the
    // user's preferred side on first paint. Default to left.
    let currentSidebar: 'left' | 'right' = 'left';

    if (settingRegistry) {
      try {
        const settings = await settingRegistry.load(PLUGIN_ID);
        const initialSidebar = settings.get('sidebar').composite as string;
        if (initialSidebar === 'left' || initialSidebar === 'right') {
          currentSidebar = initialSidebar;
        }
        labShell.add(widget, currentSidebar, { rank: 600 });

        const apply = (): void => {
          const mode = settings.get('presentationMode').composite as string;
          // 'folder' was the previous name for this mode; any value other
          // than 'path' is treated as 'name', so a saved 'folder' still maps
          // to the name mode.
          widget.setPresentationMode(mode === 'path' ? 'path' : 'name');
          const limit = settings.get('recentLimit').composite as number;
          if (typeof limit === 'number') {
            widget.setRecentLimit(limit);
          }
          const dangerous = settings.get('dangerouslySkipPermissions')
            .composite as boolean;
          widget.setDangerouslySkipPermissions(!!dangerous);
          const sidebar = settings.get('sidebar').composite as string;
          if (
            (sidebar === 'left' || sidebar === 'right') &&
            sidebar !== currentSidebar
          ) {
            currentSidebar = sidebar;
            // Lumino re-parents the widget cleanly when add() is called
            // against a different area.
            labShell.add(widget, sidebar, { rank: 600 });
          }
        };
        apply();
        settings.changed.connect(apply);
      } catch (err) {
        console.warn(
          '[jupyterlab_claude_code_extension] failed to load settings; using defaults',
          err
        );
        labShell.add(widget, currentSidebar, { rank: 600 });
      }
    } else {
      labShell.add(widget, currentSidebar, { rank: 600 });
    }

    // Register with the layout restorer so JL remembers whether the panel
    // was active/visible across browser reloads and restarts.
    if (restorer) {
      restorer.add(widget, WIDGET_ID);
    }

    app.commands.addCommand('claude-code-sessions:refresh', {
      label: 'Refresh Claude Code Sessions',
      execute: () => widget.refresh()
    });

    console.log(
      '[jupyterlab_claude_code_extension] panel registered (claude:',
      status.claude_path,
      ')'
    );
  }
};

export default plugin;
