import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { requestAPI } from './request';

/**
 * Initialization data for the jupyterlab_claude_code_extension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_claude_code_extension:plugin',
  description: 'Jupyterlab extension to help with ai assisted coding with Claude Code. It implements a tool panel (like jupyterlab_trash_mgmt_extension) with recent, all and favourite claude code sessions, it also shows if a session is currently enabled for remote control; It also allows to remove sessions (using context menu); When sesison is clicked - opens claude code in terminal in that folder and continues',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension jupyterlab_claude_code_extension is activated!');

    requestAPI<any>('hello', app.serviceManager.serverSettings)
      .then(data => {
        console.log(data);
      })
      .catch(reason => {
        console.error(
          `The jupyterlab_claude_code_extension server extension appears to be missing.\n${reason}`
        );
      });
  }
};

export default plugin;
