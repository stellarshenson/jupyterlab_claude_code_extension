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

    it('confirms before removing and aborts when not accepted', () => {
      expect(cleanup).toMatch(
        /showDialog\(\{\s*title: 'Clean Up Parallel Sessions'/
      );
      expect(cleanup).toMatch(/Dialog\.warnButton\(\{ label: 'Remove' \}\)/);
      expect(cleanup).toMatch(/if \(!confirm\.button\.accept\) \{\s*return;/);
    });

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

    it('shows a branch icon + count badge only when the project has branches', () => {
      const renderRow = (widgetSrc.match(
        /private _renderRow[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(renderRow).toMatch(
        /session\.extra_sessions > 0[\s\S]*?jp-ClaudeSessionsPanel-branchBadge/
      );
      expect(renderRow).toMatch(/branchIcon\.element/);
      expect(renderRow).toMatch(/String\(session\.extra_sessions \+ 1\)/);
    });

    it('rebuilds submenu items from a fresh branches fetch on open', () => {
      expect(openMenu).toMatch(/sessions\/branches\?encoded_path=/);
      expect(openMenu).toMatch(/_branchSubmenu\.clearItems\(\)/);
      expect(openMenu).toMatch(/_rebuildContextMenu\(hasBranches\)/);
    });

    it('caps the inline submenu at 5 most recent', () => {
      expect(openMenu).toMatch(/\.slice\(0, 5\)/);
    });

    it('always adds the Manage Sessions entry, no >5 gate', () => {
      // The popup is the management hub - it must be reachable even for
      // projects with 2-5 conversations, so the entry is unconditional.
      expect(openMenu).toMatch(/switch-branch-more/);
      expect(openMenu).not.toMatch(/branches\.length > 5/);
      expect(widgetSrc).toMatch(/`Manage Sessions\.\.\. \(\$\{/);
    });

    it('titles the submenu Switch and Manage Sessions with the count', () => {
      expect(openMenu).toMatch(
        /title\.label = `Switch and Manage Sessions \(\$\{data\.branches\.length\}\)`/
      );
    });

    it('branch entries render name plus short id via _branchDisplayName', () => {
      const display = (widgetSrc.match(
        /private _branchDisplayName[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(display).toMatch(/session_id\.slice\(0, 8\)/);
      expect(display).toMatch(/`\$\{b\.label\} \(\$\{shortId\}\)`/);
      expect(widgetSrc).toMatch(
        /label: `\$\{this\._branchDisplayName\(b\)\} - \$\{this\._formatRelativeTime\(b\.file_mtime\)\}`/
      );
      expect(widgetSrc).toMatch(
        /label\.textContent = this\._branchDisplayName\(b\)/
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

    it('popup leads with the current row, badged and without checkbox', () => {
      const popup = (widgetSrc.match(
        /private _showBranchPopup[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(popup).toMatch(/jp-mod-current/);
      expect(popup).toMatch(/branchCurrentBadge/);
      // The current row is appended before any checkbox is created.
      const currentIdx = popup.indexOf('jp-mod-current');
      const checkboxIdx = popup.indexOf("check.type = 'checkbox'");
      expect(currentIdx).toBeGreaterThan(-1);
      expect(checkboxIdx).toBeGreaterThan(currentIdx);
    });

    it('checkbox is its own click zone and selection gates row switch', () => {
      const popup = (widgetSrc.match(
        /private _showBranchPopup[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(popup).toMatch(/stopPropagation\(\)/);
      // Selection mode: row click toggles while anything is selected.
      expect(popup).toMatch(
        /if \(selected\.size > 0\) \{[\s\S]*?return;[\s\S]*?dialog\.dispose\(\)/
      );
    });

    it('select-all toggles the visible (filtered) rows only', () => {
      const popup = (widgetSrc.match(
        /private _showBranchPopup[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(popup).toMatch(
        /selectAll\.addEventListener\('change'[\s\S]*?visibleMatches\(\)/
      );
    });

    it('delete opens a confirmation dialog and only deletes on accept', () => {
      const popup = (widgetSrc.match(
        /private _showBranchPopup[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(popup).toMatch(/showDialog\(\{\s*title: 'Delete Sessions'/);
      expect(popup).toMatch(/Dialog\.warnButton\(\{ label: 'Delete' \}\)/);
      expect(popup).toMatch(
        /if \(!confirm\.button\.accept\) \{\s*return;[\s\S]*?_deleteBranches/
      );
    });

    it('delete posts to delete-branches and resyncs the panel', () => {
      const del = (widgetSrc.match(
        /private async _deleteBranches[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(del).toMatch(/sessions\/delete-branches/);
      expect(del).toMatch(/finally[\s\S]*?await this\._fetch\(\)/);
    });

    it('rows carry age emphasis classes at the 60s and 7d thresholds', () => {
      expect(widgetSrc).toMatch(/age < 60_000[\s\S]*?jp-mod-recentlyActive/);
      expect(widgetSrc).toMatch(/age > 7 \* 86_400_000[\s\S]*?jp-mod-stale/);
      const css: string = fs.readFileSync(
        path.join(__dirname, '..', '..', 'style', 'base.css'),
        'utf-8'
      );
      expect(css).toMatch(/jp-mod-recentlyActive[\s\S]*?--jp-brand-color1/);
      expect(css).toMatch(/jp-mod-stale \{\s*opacity/);
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

    it('shows last activity on session rows via the shared formatter', () => {
      expect(widgetSrc).toMatch(
        /jp-ClaudeSessionsPanel-rowTime[\s\S]*?_formatRelativeTime\(session\.file_mtime\)/
      );
    });

    it('formats relative time as now / m / h / d ago, no date fallback', () => {
      const fmt = (widgetSrc.match(
        /private _formatRelativeTime[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(fmt).toMatch(/return 'now'/);
      expect(fmt).toMatch(/m ago/);
      expect(fmt).toMatch(/h ago/);
      expect(fmt).toMatch(/d ago/);
      expect(fmt).not.toMatch(/toLocaleDateString/);
    });

    it('warns when the resolved current differs from the requested branch', () => {
      expect(switchBranch).toMatch(
        /result\.current !== result\.requested[\s\S]*?Notification\.warning/
      );
    });

    it('renders the favourite star before the time column', () => {
      const renderRow = (widgetSrc.match(
        /private _renderRow[\s\S]*?\n  \}/
      ) ?? [''])[0];
      const starAt = renderRow.indexOf('jp-ClaudeSessionsPanel-favStar');
      const timeAt = renderRow.indexOf('jp-ClaudeSessionsPanel-rowTime');
      expect(starAt).toBeGreaterThan(-1);
      expect(timeAt).toBeGreaterThan(-1);
      expect(starAt).toBeLessThan(timeAt);
    });

    it('time labels form fixed-width right-aligned columns', () => {
      const css: string = fs.readFileSync(
        path.join(__dirname, '..', '..', 'style', 'base.css'),
        'utf-8'
      );
      const rowTime = (css.match(
        /\.jp-ClaudeSessionsPanel-rowTime \{[\s\S]*?\}/
      ) ?? [''])[0];
      expect(rowTime).toMatch(/width: 4em/);
      expect(rowTime).toMatch(/white-space: nowrap/);
      expect(rowTime).toMatch(/text-align: right/);
      const branchTime = (css.match(
        /\.jp-ClaudeSessionsPanel-branchTime \{[\s\S]*?\}/
      ) ?? [''])[0];
      expect(branchTime).toMatch(/width: 4em/);
      expect(branchTime).toMatch(/white-space: nowrap/);
      // Stars line up vertically across the entire panel: every row keeps
      // the time slot (empty without an mtime) and every section reserves
      // the scrollbar gutter.
      expect(widgetSrc).toMatch(/time\.textContent = session\.file_mtime\s*\?/);
      const list = (css.match(/\.jp-ClaudeSessionsPanel-list \{[\s\S]*?\}/) ?? [
        ''
      ])[0];
      expect(list).toMatch(/scrollbar-gutter: stable/);
      expect(branchTime).toMatch(/text-align: right/);
    });

    it('now label shares the recently-active emphasis colour', () => {
      const css: string = fs.readFileSync(
        path.join(__dirname, '..', '..', 'style', 'base.css'),
        'utf-8'
      );
      expect(css).toMatch(
        /jp-mod-recentlyActive[\s\S]{0,200}?jp-ClaudeSessionsPanel-rowTime[\s\S]{0,80}?--jp-brand-color1/
      );
    });

    it('branch session is a submenu with normal and skip-permissions entries', () => {
      expect(widgetSrc).toMatch(/claude-code-sessions:branch-session'/);
      expect(widgetSrc).toMatch(
        /claude-code-sessions:branch-session-dangerous/
      );
      expect(widgetSrc).toMatch(
        /_branchSessionMenu\.title\.label = 'Branch Session'/
      );
      expect(widgetSrc).toMatch(
        /label: 'Skip Permissions',\s*icon: shieldIcon/
      );
      expect(widgetSrc).toMatch(/submenu: this\._branchSessionMenu/);
      // No ellipsis on the branch-session labels.
      expect(widgetSrc).not.toMatch(/Branch Session\.\.\./);
    });

    it('branch session asks for a name and launches a known fork id', () => {
      const branch = (widgetSrc.match(
        /private async _branchSession[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(branch).toMatch(/InputDialog\.getText/);
      expect(branch).toMatch(/UUID\.uuid4\(\)/);
      expect(branch).toMatch(/fork_session_id: forkId/);
      expect(branch).toMatch(/session_id: session\.session_id/);
      expect(branch).toMatch(/_stampForkTitle/);
    });

    it('fork title stamping retries on 404 until the JSONL appears', () => {
      const stamp = (widgetSrc.match(
        /private async _stampForkTitle[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(stamp).toMatch(/sessions\/set-title/);
      expect(stamp).toMatch(/status === 404/);
      expect(stamp).toMatch(/await this\._fetch\(\)/);
      expect(stamp).toMatch(/Notification\.warning/);
    });

    it('live dot is softened with reduced opacity', () => {
      const css: string = fs.readFileSync(
        path.join(__dirname, '..', '..', 'style', 'base.css'),
        'utf-8'
      );
      const dot = (css.match(/\.jp-ClaudeSessionsPanel-dot \{[\s\S]*?\}/) ?? [
        ''
      ])[0];
      expect(dot).toMatch(/--jp-success-color1/);
      expect(dot).toMatch(/opacity: 0\.75/);
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
