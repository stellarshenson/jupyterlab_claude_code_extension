declare const __dirname: string;
declare function require(name: string): any;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs: { readFileSync: (p: string, enc: string) => string } = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path: { join: (...args: string[]) => string } = require('path');

import type { ISession } from '../types';

const session = (over: Partial<ISession> = {}): ISession => ({
  project_path: '/p',
  encoded_path: '-p',
  session_id: 'sid',
  name: 'P',
  name_source: 'basename',
  summary: '',
  first_prompt: '',
  message_count: 0,
  created: null,
  modified: null,
  file_mtime: 0,
  git_branch: null,
  remote_control: false,
  favourite: false,
  extra_sessions: 0,
  ...over
});

describe('session sorting', () => {
  it('orders by file_mtime descending', () => {
    const items = [
      session({ project_path: 'a', file_mtime: 1 }),
      session({ project_path: 'b', file_mtime: 3 }),
      session({ project_path: 'c', file_mtime: 2 })
    ];
    const sorted = [...items].sort((a, b) => b.file_mtime - a.file_mtime);
    expect(sorted.map(s => s.project_path)).toEqual(['b', 'c', 'a']);
  });

  it('orders alphabetically by display name', () => {
    const items = [
      session({ name: 'Charlie' }),
      session({ name: 'alpha' }),
      session({ name: 'Beta' })
    ];
    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted.map(s => s.name)).toEqual(['alpha', 'Beta', 'Charlie']);
  });

  it('filters favourites only', () => {
    const items = [
      session({ project_path: 'a', favourite: true }),
      session({ project_path: 'b', favourite: false }),
      session({ project_path: 'c', favourite: true })
    ];
    const favs = items.filter(s => s.favourite).map(s => s.project_path);
    expect(favs).toEqual(['a', 'c']);
  });

  it('caps recent at the configured limit', () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      session({ project_path: `p${i}`, file_mtime: i })
    );
    const recent = [...items]
      .sort((a, b) => b.file_mtime - a.file_mtime)
      .slice(0, 10);
    expect(recent).toHaveLength(10);
    expect(recent[0].project_path).toBe('p24');
    expect(recent[9].project_path).toBe('p15');
  });
});

/**
 * Regression guard for 1.1.13 -> 1.1.14: the launch-spinner Dialog is
 * constructed with ``buttons: []`` so ``Dialog.resolve()`` has no button
 * to "click" and silently no-ops, leaving the modal stuck over the
 * panel. The dismiss call in ``_doResumeInTerminal``'s ``finally`` MUST
 * be ``spinner.dispose()``. These are source-level invariants - cheap,
 * deterministic, and exactly the contract that broke in 1.1.13.
 */
describe('launch spinner dismiss contract', () => {
  const widgetSrc: string = fs.readFileSync(
    path.join(__dirname, '..', 'widget.ts'),
    'utf-8'
  );

  /**
   * Contract for the cleanup-parallel popup: the dialog opens with the
   * Close button hidden while the POST is in flight (footer display
   * 'none'), shows an indeterminate <progress> bar, then on completion
   * fills the bar and reports success - or drops the bar and shows the
   * error - and restores the footer so the user can dismiss.
   */
  describe('cleanup popup contract', () => {
    const cleanup = (widgetSrc.match(
      /private async _cleanupParallel[\s\S]*?\n  \}/
    ) ?? [''])[0];

    it('creates a progress element in the dialog body', () => {
      expect(cleanup).toMatch(/createElement\('progress'\)/);
    });

    it('hides the footer during the request and restores it in finally', () => {
      expect(cleanup).toMatch(/footer\.style\.display = 'none'/);
      expect(cleanup).toMatch(/finally[\s\S]*?footer\.style\.display = ''/);
    });

    it('fills the bar and reports the removed count on success', () => {
      expect(cleanup).toMatch(/bar\.value = 1/);
      expect(cleanup).toMatch(/Removed \$\{data\.removed_count\}/);
    });

    it('shows an error message styled with the error class on failure', () => {
      expect(cleanup).toMatch(/catch[\s\S]*?bar\.remove\(\)/);
      expect(cleanup).toMatch(/jp-ClaudeSessionsPanel-cleanupError/);
      expect(cleanup).toMatch(/Cleanup failed: /);
    });

    it('refreshes the session list after a successful cleanup', () => {
      const successBlock = (cleanup.match(/try[\s\S]*?catch/) ?? [''])[0];
      expect(successBlock).toMatch(/await this\._fetch\(\)/);
    });
  });

  /**
   * Contract for branch switching: the context menu is rebuilt on every
   * open (Lumino submenu items have no isVisible hook), the branch
   * submenu is repopulated from a fresh sessions/branches fetch, the
   * row name carries the conversation count only when branches exist,
   * and _switchBranch always resyncs the list - including after a 404
   * for a branch that vanished between menu display and click.
   */
  describe('branch switching contract', () => {
    const openMenu = (widgetSrc.match(
      /private async _openContextMenu[\s\S]*?\n  \}/
    ) ?? [''])[0];
    const switchBranch = (widgetSrc.match(
      /private async _switchBranch[\s\S]*?\n  \}/
    ) ?? [''])[0];

    it('shows the conversation count only when the project has branches', () => {
      expect(widgetSrc).toMatch(
        /session\.extra_sessions > 0\s*\?\s*`\$\{this\._lookupName\(session\)\} \(\$\{session\.extra_sessions \+ 1\}\)`/
      );
    });

    it('rebuilds submenu items from a fresh branches fetch on open', () => {
      expect(openMenu).toMatch(/sessions\/branches\?encoded_path=/);
      expect(openMenu).toMatch(/_branchSubmenu\.clearItems\(\)/);
      expect(openMenu).toMatch(/_rebuildContextMenu\(hasBranches\)/);
    });

    it('caps the submenu at 5 and adds More... beyond that', () => {
      expect(openMenu).toMatch(/\.slice\(0, 5\)/);
      expect(openMenu).toMatch(
        /branches\.length > 5[\s\S]*?switch-branch-more/
      );
    });

    it('More... popup filters by label or session id and switches on click', () => {
      const popup = (widgetSrc.match(
        /private _showBranchPopup[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(popup).toMatch(/createElement\('input'\)/);
      expect(popup).toMatch(/label\.toLowerCase\(\)\.includes\(needle\)/);
      expect(popup).toMatch(/session_id\.toLowerCase\(\)\.includes\(needle\)/);
      expect(popup).toMatch(
        /dialog\.dispose\(\);\s*void this\._switchBranch\(b\.session_id\)/
      );
    });

    it('opens the menu without the submenu when the fetch fails', () => {
      expect(openMenu).toMatch(/catch[\s\S]*?hasBranches = false/);
    });

    it('resyncs the session list after every switch attempt', () => {
      expect(switchBranch).toMatch(/finally[\s\S]*?await this\._fetch\(\)/);
    });

    it('reports a removed branch distinctly via the 404 status', () => {
      expect(switchBranch).toMatch(/status === 404/);
      expect(switchBranch).toMatch(/Branch no longer exists/);
    });

    it('warns when the resolved current differs from the requested branch', () => {
      expect(switchBranch).toMatch(
        /result\.current !== result\.requested[\s\S]*?Notification\.warning/
      );
    });
  });

  it('_doResumeInTerminal dismisses spinner via dispose(), not resolve()', () => {
    expect(widgetSrc).toMatch(/spinner\.dispose\(\)/);
    expect(widgetSrc).not.toMatch(/spinner\.resolve\(\)/);
  });

  it('_showLaunchSpinner constructs Dialog with buttons:[]', () => {
    // The empty buttons array is the reason resolve() no-ops; if this
    // ever becomes non-empty, the dismiss call can revisit resolve().
    expect(widgetSrc).toMatch(/_showLaunchSpinner[\s\S]*?buttons:\s*\[\]/);
  });
});
