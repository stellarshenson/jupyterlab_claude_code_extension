import {
  ILabShell,
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
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
    'Side panel listing Claude Code sessions per project folder, with remote-control indicator, favourites, and one-click resume in a terminal.',
  autoStart: true,
  requires: [ILabShell],
  optional: [ILayoutRestorer, ISettingRegistry, ITerminalTracker],
  activate: async (
    app: JupyterFrontEnd,
    labShell: ILabShell,
    restorer: ILayoutRestorer | null,
    settingRegistry: ISettingRegistry | null,
    terminalTracker: ITerminalTracker | null
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
      terminalTracker
    );
    labShell.add(widget, 'left', { rank: 600 });

    if (settingRegistry) {
      try {
        const settings = await settingRegistry.load(PLUGIN_ID);
        const apply = (): void => {
          const resolve = settings.get('resolveSessionNames')
            .composite as boolean;
          widget.setResolveSessionNames(resolve !== false);
        };
        apply();
        settings.changed.connect(apply);
      } catch (err) {
        console.warn(
          '[jupyterlab_claude_code_extension] failed to load settings; using defaults',
          err
        );
      }
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
