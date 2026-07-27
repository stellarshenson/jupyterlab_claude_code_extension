declare const __dirname: string;
declare function require(name: string): any;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs: { readFileSync: (p: string, enc: string) => string } = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path: { join: (...args: string[]) => string } = require('path');

import type { ISession } from '../types';
// Executed, not grepped - src/colour.ts is JupyterLab-free by design so the
// tint logic can actually be run under jest.
import { claudeTabColourId, colourForTerminal } from '../colour';

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
  color: null,
  bg_id: null,
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

    it('current row exposes aria-current and a plain lowercase "current" label', () => {
      const popup = (widgetSrc.match(
        /private _showBranchPopup[\s\S]*?\n  \}/
      ) ?? [''])[0];
      // Programmatic active state for assistive tech (visual cues are the
      // brand left-bar, tint and the plain word) - UX review finding.
      expect(popup).toMatch(/setAttribute\('aria-current', 'true'\)/);
      // The marker is plain text "current" - the boxed uppercase chip is gone.
      expect(popup).toMatch(/badge\.textContent = 'current'/);
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

    it('delete removes selected sessions immediately, no confirmation dialog', () => {
      const popup = (widgetSrc.match(
        /private _showBranchPopup[\s\S]*?\n  \}/
      ) ?? [''])[0];
      // The per-row delete must NOT stack a second Lumino dialog on the popup
      // (it renders detached) - confirmation is reserved for cleanup / remove.
      expect(popup).not.toMatch(/title: 'Delete Sessions'/);
      const delHandler = (popup.match(
        /deleteBtn\.addEventListener\('click'[\s\S]*?\n    \}\);/
      ) ?? [''])[0];
      expect(delHandler).toMatch(/this\._deleteBranches\(\[\.\.\.selected\]\)/);
      expect(delHandler).not.toMatch(/showDialog/);
    });

    it('manage sessions popup is a table with an accented pinned current row', () => {
      const popup = (widgetSrc.match(
        /private _showBranchPopup[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(popup).toMatch(/title: 'Manage Sessions'/);
      expect(popup).toMatch(/branchHeader/);
      expect(popup).toMatch(/branchHeaderCount/);
      expect(popup).toMatch(/branchSelectCell/);
      const css: string = fs.readFileSync(
        path.join(__dirname, '..', '..', 'style', 'base.css'),
        'utf-8'
      );
      const cur = (css.match(
        /\.jp-ClaudeSessionsPanel-branchRow\.jp-mod-current \{[\s\S]*?\}/
      ) ?? [''])[0];
      expect(cur).toMatch(/position: sticky/);
      expect(cur).toMatch(/border-left: 3px solid var\(--jp-brand-color1\)/);
      const del = (css.match(
        /\.jp-ClaudeSessionsPanel-branchDelete \{[\s\S]*?\}/
      ) ?? [''])[0];
      expect(del).toMatch(/--jp-error-color1/);
    });

    it('popup delete is accessible and gives feedback without a prompt', () => {
      const popup = (widgetSrc.match(
        /private _showBranchPopup[\s\S]*?\n  \}/
      ) ?? [''])[0];
      // per-checkbox accessible name + polite live region for the result
      expect(popup).toMatch(/`Select \$\{this\._branchDisplayName/);
      expect(popup).toMatch(/aria-live', 'polite'/);
      // the delete handler announces "N moved to trash" and keeps focus
      const delHandler = (popup.match(
        /deleteBtn\.addEventListener\('click'[\s\S]*?\n    \}\);/
      ) ?? [''])[0];
      expect(delHandler).toMatch(/moved to trash/);
      expect(delHandler).toMatch(/selectAll\.focus\(\)/);
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

    it('section list caps clamp 5-10 rows and the body scrolls as safety valve (DEF-12)', () => {
      const css: string = fs.readFileSync(
        path.join(__dirname, '..', '..', 'style', 'base.css'),
        'utf-8'
      );
      // A bare-vh cap fell below a 2-row section's own height in short
      // windows and made it self-scroll. The section itself carries no cap.
      const section = (css.match(
        /\.jp-ClaudeSessionsPanel-section \{[\s\S]*?\}/
      ) ?? [''])[0];
      expect(section).not.toMatch(/vh/);
      expect(section).not.toMatch(/max-height/);
      // Favourites/Recent lists cap at 10 rows, yield to 33vh mid-band,
      // and never drop below a 5-row floor - endpoints derived from the
      // row height custom property so a density change moves them with
      // the rows.
      const cap = (css.match(
        /\.jp-ClaudeSessionsPanel-section \.jp-ClaudeSessionsPanel-list \{[\s\S]*?\}/
      ) ?? [''])[0];
      expect(cap).toMatch(/max-height: clamp\(/);
      expect(cap).toMatch(/calc\(5 \* var\(--ccs-row-height\)\)/);
      expect(cap).toMatch(/33vh/);
      expect(cap).toMatch(/calc\(10 \* var\(--ccs-row-height\)\)/);
      const row = (css.match(/\.jp-ClaudeSessionsPanel-row \{[\s\S]*?\}/) ?? [
        ''
      ])[0];
      expect(row).toMatch(/height: var\(--ccs-row-height\)/);
      // The body is the safety valve: it scrolls instead of clipping when
      // the sections' minimum sizes cannot fit the window.
      const body = (css.match(/\.jp-ClaudeSessionsPanel-body \{[\s\S]*?\}/) ?? [
        ''
      ])[0];
      expect(body).toMatch(/overflow: hidden auto/);
      expect(body).not.toMatch(/overflow: hidden;/);
      // Collapsed `all` cannot be squashed (flex 1 0 auto); an expanded
      // `all` (:has a list) shrinks only to a header+3-rows floor so it
      // can never collapse to nothing.
      const allBase = (css.match(
        /\.jp-ClaudeSessionsPanel-section\[data-section='all'\] \{[\s\S]*?\}/
      ) ?? [''])[0];
      expect(allBase).toMatch(/flex: 1 0 auto/);
      const allFloor = (css.match(
        /\.jp-ClaudeSessionsPanel-section\[data-section='all'\]:has\([\s\S]*?\) \{[\s\S]*?\}/
      ) ?? [''])[0];
      expect(allFloor).toMatch(/flex-shrink: 1/);
      expect(allFloor).toMatch(
        /min-height: calc\(24px \+ 3 \* var\(--ccs-row-height\)\)/
      );
      // The body scroller keeps its place across re-renders.
      expect(widgetSrc).toMatch(/const bodyScroll = this\._bodyEl\.scrollTop/);
      expect(widgetSrc).toMatch(/this\._bodyEl\.scrollTop = bodyScroll/);
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
      // The name is forced at launch (claude -n <name>) so it sticks.
      expect(branch).toMatch(/name: title/);
    });

    it('branch session does not post-hoc stamp a title (claude -n owns it)', () => {
      // The obsolete sessions/set-title poll and its false "could not be
      // applied" warning were removed once -n took over naming (DEF-1).
      expect(widgetSrc).not.toMatch(/_stampForkTitle/);
      expect(widgetSrc).not.toMatch(/sessions\/set-title/);
      expect(widgetSrc).not.toMatch(/could not be applied/);
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

    it('Copy Session ID command copies the active session id', () => {
      const cmd = (widgetSrc.match(
        /addCommand\('claude-code-sessions:copy-session-id'[\s\S]*?\}\);/
      ) ?? [''])[0];
      expect(cmd).toMatch(/label: 'Copy Session ID'/);
      expect(cmd).toMatch(/this\._activeSession\?\.session_id/);
      expect(cmd).toMatch(/Clipboard\.copyToSystem\(id\)/);
    });

    it('Copy Session ID sits in the context menu next to Copy Path', () => {
      expect(widgetSrc).toMatch(
        /copy-path'[\s\S]*?claude-code-sessions:copy-session-id/
      );
    });

    it('popup rows carry a copy button that copies without switching', () => {
      const helper = (widgetSrc.match(
        /private _branchCopyButton[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(helper).toMatch(/branchCopy/);
      expect(helper).toMatch(/copyIcon\.element/);
      // type='button' so the button never acts as a form submit.
      expect(helper).toMatch(/btn\.type = 'button'/);
      expect(helper).toMatch(/stopPropagation/);
      expect(helper).toMatch(/Clipboard\.copyToSystem\(sessionId\)/);
      // Wired into the current row and every branch row.
      expect(widgetSrc).toMatch(/this\._branchCopyButton\(current\)/);
      expect(widgetSrc).toMatch(/this\._branchCopyButton\(b\.session_id\)/);
    });

    it('refresh raises the panel veil; the background poll stays silent', () => {
      const refresh = (widgetSrc.match(
        /refresh\(\): void \{[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(refresh).toMatch(/this\._setLoading\(true\)/);
      expect(refresh).toMatch(/this\._setLoading\(false\)/);
      const poll = (widgetSrc.match(/private _startPolling[\s\S]*?\n  \}/) ?? [
        ''
      ])[0];
      expect(poll).not.toMatch(/_setLoading/);
    });

    it('refresh veil is built on the root so _render never wipes it', () => {
      expect(widgetSrc).toMatch(/jp-ClaudeSessionsPanel-loading/);
      expect(widgetSrc).toMatch(/root\.appendChild\(loading\)/);
      // Starts hidden and is toggled via the `hidden` attribute.
      expect(widgetSrc).toMatch(/loading\.hidden = true/);
      const css: string = fs.readFileSync(
        path.join(__dirname, '..', '..', 'style', 'base.css'),
        'utf-8'
      );
      // The veil rule MUST be gated on :not([hidden]); a bare
      // `.loading { display: flex }` author rule beats the UA
      // `[hidden] { display: none }` and pins the veil permanently on.
      const veil = (css.match(
        /\.jp-ClaudeSessionsPanel-loading:not\(\[hidden\]\) \{[\s\S]*?\}/
      ) ?? [''])[0];
      expect(veil).toMatch(/position: absolute/);
      expect(veil).toMatch(/inset: 0/);
      expect(veil).toMatch(/display: flex/);
    });
  });

  /**
   * Contract for conversation-aware terminal reuse and the Open Branched
   * Conversation feature. Reuse must refuse to focus a terminal running a
   * DIFFERENT or UNKNOWN conversation (the switch-then-click bug, DEF-4): a
   * terminal is reused only on a POSITIVE conversation-id match. The backend
   * reads each terminal's true session id from the running claude's own
   * `~/.claude/sessions/<pid>.json`, so a terminal the user opened with a bare
   * `claude` / `-c` is identifiable too - reuse is not limited to extension
   * launches that carry an id in argv.
   */
  /**
   * Tab colour (DEF-11). A terminal's tint is the colour of the conversation
   * it RUNS, which the backend reads from that conversation's own JSONL.
   * Resolving the tint through the project row is the bug: a row carries only
   * the project's representative conversation, and the representative flips to
   * any newer JSONL - a daemon `--fork-session` worker writes one - which
   * cleared the tint of every terminal not on the current representative.
   */
  describe('terminal tab colour', () => {
    // These EXECUTE the shipped code (src/colour.ts) rather than grepping its
    // text: the tint regressed twice (DEF-10, DEF-11) behind a green suite
    // that ran none of it.
    const rows = [
      session({ project_path: '/w', session_id: 'ws', color: 'blue' }),
      session({ project_path: '/w/proj', session_id: 'rep', color: 'green' })
    ];

    it('takes the running conversation colour, not the row (DEF-11)', () => {
      // The row's representative is 'rep'/green - a daemon fork that stole the
      // slot. The terminal runs 'mine', whose own colour is orange. Resolving
      // via the rows found no match and CLEARED the tint; it must not.
      expect(
        colourForTerminal(
          { sessionId: 'mine', color: 'orange', cwds: ['/w/proj'] },
          rows
        )
      ).toBe('orange');
    });

    it('a conversation with no colour of its own clears', () => {
      expect(
        colourForTerminal(
          { sessionId: 'mine', color: null, cwds: ['/w'] },
          rows
        )
      ).toBeNull();
    });

    it('falls back to cwd only when the conversation is unreadable', () => {
      expect(
        colourForTerminal(
          { sessionId: null, color: null, cwds: ['/w/proj'] },
          rows
        )
      ).toBe('green');
    });

    it('cwd fallback prefers the nested project over its parent', () => {
      expect(
        colourForTerminal(
          { sessionId: null, color: null, cwds: ['/w/proj/deep'] },
          rows
        )
      ).toBe('green');
      expect(
        colourForTerminal(
          { sessionId: null, color: null, cwds: ['/w/other'] },
          rows
        )
      ).toBe('blue');
    });

    it('cwd fallback does not match a sibling on a shared prefix', () => {
      // '/w/proj-extra' must not match '/w/proj' - the boundary is a real '/'.
      expect(
        colourForTerminal(
          { sessionId: null, color: null, cwds: ['/w/proj-extra'] },
          [
            session({
              project_path: '/w/proj',
              session_id: 'r',
              color: 'green'
            })
          ]
        )
      ).toBeNull();
    });

    it('maps Claude colours to tab ids and drops unknown ones', () => {
      expect(claudeTabColourId('orange')).toBe('peach');
      expect(claudeTabColourId('green')).toBe('mint');
      expect(claudeTabColourId('chartreuse')).toBeNull();
      expect(claudeTabColourId(null)).toBeNull();
    });
  });

  describe('conversation-aware reuse + open-branch contract', () => {
    const findTerm = (widgetSrc.match(
      /private async _findTerminalForSession[\s\S]*?\n  \}/
    ) ?? [''])[0];
    const doResume = (widgetSrc.match(
      /private async _doResumeInTerminal[\s\S]*?\n  \}/
    ) ?? [''])[0];
    const resume = (widgetSrc.match(
      /private async _resumeInTerminal[\s\S]*?\n  \}/
    ) ?? [''])[0];
    const openBranch = (widgetSrc.match(
      /private async _openBranch[\s\S]*?\n  \}/
    ) ?? [''])[0];
    const newSession = (widgetSrc.match(
      /private async _newSession[\s\S]*?\n  \}/
    ) ?? [''])[0];
    const watch = (widgetSrc.match(/private _watchForBranch[\s\S]*?\n  \}/) ?? [
      ''
    ])[0];

    it('terminal-cwd response carries the running conversation id', () => {
      const iface = (widgetSrc.match(
        /interface ITerminalCwdResponse \{[\s\S]*?\}/
      ) ?? [''])[0];
      expect(iface).toMatch(/session_id\?: string \| null/);
    });

    it('_findTerminalForSession keys on the session id alone (no cwd param)', () => {
      expect(findTerm).toMatch(
        /_findTerminalForSession\(\s*wantedSessionId: string \| undefined\s*\)/
      );
      // A missing wanted id short-circuits so null never matches null.
      expect(findTerm).toMatch(
        /if \(!this\._terminalTracker \|\| !wantedSessionId\)/
      );
      // Reuse is identity-only now - it must NOT gate on the terminal's cwd
      // (a claude cd'd into a subdir, or a recreated project dir, must still
      // be reused once its conversation is positively known).
      expect(findTerm).not.toMatch(/cwds/);
      expect(findTerm).not.toMatch(/=== target/);
    });

    it('reuse requires a positive conversation-id match (no lenient unknown reuse)', () => {
      expect(findTerm).toMatch(
        /const runningId = data\?\.session_id \?\? null/
      );
      // The ONLY reuse condition: the observed running id equals the wanted
      // id. An unknown (null) running id never equals a truthy wanted id, so a
      // terminal whose conversation cannot be read is never reused (DEF-4).
      expect(findTerm).toMatch(
        /if \(runningId === wantedSessionId\) \{\s*return \{ widget, runningId \};/
      );
      // The old lenient/strict machinery is gone.
      expect(findTerm).not.toMatch(/unknownConversation/);
      expect(findTerm).not.toMatch(/strict/);
    });

    it('microcache reuse is gated purely on the conversation id', () => {
      expect(doResume).toMatch(/cached\.sessionId === session\.session_id/);
      expect(doResume).not.toMatch(/unknownConversation/);
      expect(doResume).not.toMatch(/strict/);
    });

    it('microcache is tagged with the OBSERVED running id', () => {
      expect(doResume).toMatch(
        /widget: found\.widget,\s*sessionId: found\.runningId \?\? undefined/
      );
      expect(findTerm).toMatch(/return \{ widget, runningId \}/);
    });

    it('in-flight launches are keyed per conversation, not per project', () => {
      expect(resume).toMatch(
        /const key = `\$\{session\.project_path\}\\n\$\{session\.session_id \?\? ''\}`/
      );
      expect(resume).toMatch(/this\._pendingByPath\.(get|set)\(key/);
    });

    it('a new session launches with an explicit --session-id so it is identifiable', () => {
      // DEF-4: a bare `claude` reports no id and would be wrongly reused;
      // launching with a frontend id makes the terminal positively matchable.
      expect(newSession).toMatch(/const newId = UUID\.uuid4\(\)/);
      expect(newSession).toMatch(/new_session_id: newId/);
      expect(newSession).toMatch(/sessionId: newId/);
    });

    it('_openBranch reuses only a terminal running that conversation', () => {
      expect(openBranch).toMatch(
        /this\._resumeInTerminal\(\{ \.\.\.active, session_id: sessionId \}\)/
      );
      expect(openBranch).not.toMatch(/strict/);
    });

    it('open-branch command and submenu are wired up', () => {
      expect(widgetSrc).toMatch(/'claude-code-sessions:open-branch'/);
      expect(widgetSrc).toMatch(
        /this\._openBranchSubmenu\.title\.label = 'Open Branched Conversation'/
      );
      // Top 5 branches populate the open submenu, each via the open command.
      const populate = (widgetSrc.match(
        /this\._openBranchSubmenu\.clearItems[\s\S]*?switch-branch-more'\s*\}\);/
      ) ?? [''])[0];
      expect(populate).toMatch(/data\.branches\.slice\(0, 5\)/);
      expect(populate).toMatch(/command: 'claude-code-sessions:open-branch'/);
      // The context menu shows the open submenu when the row has branches.
      const rebuild = (widgetSrc.match(
        /private _rebuildContextMenu[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(rebuild).toMatch(/submenu: this\._openBranchSubmenu/);
    });

    it('popup rows carry an Open button that launches the branch', () => {
      const popup = (widgetSrc.match(
        /private _showBranchPopup[\s\S]*?\n  \}\n/
      ) ?? [''])[0];
      expect(popup).toMatch(/jp-ClaudeSessionsPanel-branchOpen/);
      expect(popup).toMatch(/void this\._openBranch\(sessionId\)/);
      // Open appears on both the current row and each branch row.
      expect(popup).toMatch(/openButton\(current\)/);
      expect(popup).toMatch(/openButton\(b\.session_id\)/);
    });

    it('a new branch is watched for and surfaces fast, not on the slow poll', () => {
      expect(watch).toMatch(/data\.current === forkId/);
      expect(watch).toMatch(/b\.session_id === forkId/);
      expect(watch).toMatch(/await this\._fetch\(\)/);
      expect(watch).toMatch(/BRANCH_WATCH_MAX_ATTEMPTS/);
      // Fork launch arms the watcher.
      const fork = (widgetSrc.match(
        /private async _branchSession[\s\S]*?\n  \}/
      ) ?? [''])[0];
      expect(fork).toMatch(
        /this\._watchForBranch\(session\.encoded_path, forkId\)/
      );
      expect(widgetSrc).toMatch(/BRANCH_WATCH_INTERVAL_MS = 2_000/);
    });

    it('the Open button is styled in base.css', () => {
      const css: string = fs.readFileSync(
        path.join(__dirname, '..', '..', 'style', 'base.css'),
        'utf-8'
      );
      expect(css).toMatch(/\.jp-ClaudeSessionsPanel-branchOpen \{/);
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

/**
 * Background-agent contract (DEF-13).
 *
 * A conversation held by a live background agent is attached to, not resumed.
 * Every open just names its conversation and the server picks the verb at
 * launch, so no surface can pick a wrong one; `bg_id` is display state, and
 * these pin that split.
 */
describe('background agent attach contract (DEF-13)', () => {
  const widgetSrc: string = fs.readFileSync(
    path.join(__dirname, '..', 'widget.ts'),
    'utf-8'
  );
  const typesSrc: string = fs.readFileSync(
    path.join(__dirname, '..', 'types.ts'),
    'utf-8'
  );

  it('types bg_id on rows', () => {
    // Rows carry it; branches deliberately do not - see list_branches.
    expect(typesSrc).toMatch(/bg_id: string \| null;/);
  });

  it('names the conversation and leaves the verb to the server', () => {
    const launch = (widgetSrc.match(
      /const launched = await requestAPI<ILaunchTerminalResponse>[\s\S]*?\n        \);/
    ) ?? [''])[0];
    expect(launch).toMatch(/session_id: session\.session_id/);
    // A background agent can take or release a conversation inside the 30s
    // poll window, so a verb chosen from `bg_id` here would be stale - the
    // server decides at launch. `bg_id` must not reach the request at all.
    expect(launch).not.toMatch(/attach_id/);
    expect(launch).not.toMatch(/bg_id/);
  });

  it('marks an agent-owned row and names the agent in the row tooltip', () => {
    const row = (widgetSrc.match(
      /private _renderRow\([\s\S]*?\n    return row;/
    ) ?? [''])[0];
    expect(row).toMatch(/if \(session\.bg_id\)/);
    expect(row).toMatch(/jp-ClaudeSessionsPanel-bgBadge/);
    // The chip must NOT set its own title: a child title shadows the row's,
    // hiding the path and session id behind a two-character chip.
    const chip = (row.match(/bgBadge'[\s\S]*?appendChild\(bg\)/) ?? [''])[0];
    expect(chip).not.toMatch(/\.title =/);
    const tooltip = (widgetSrc.match(
      /private _buildRowTooltip[\s\S]*?\n  \}/
    ) ?? [''])[0];
    expect(tooltip).toMatch(/Background agent: \$\{s\.bg_id\}/);
  });

  it('renames the open item and disables skip-permissions for an agent row', () => {
    const resume = (widgetSrc.match(
      /'claude-code-sessions:resume',[\s\S]*?\n    \}\);/
    ) ?? [''])[0];
    expect(resume).toMatch(
      /label: \(\) =>[\s\S]*?bg_id \? 'Attach to Background Agent' : 'Resume'/
    );
    const dangerous = (widgetSrc.match(
      /'claude-code-sessions:resume-dangerous',[\s\S]*?\n    \}\);/
    ) ?? [''])[0];
    expect(dangerous).toMatch(
      /isEnabled: \(\) => !this\._activeSession\?\.bg_id/
    );
  });

  it('styles the bg badge in base.css', () => {
    const css: string = fs.readFileSync(
      path.join(__dirname, '..', '..', 'style', 'base.css'),
      'utf-8'
    );
    expect(css).toMatch(/\.jp-ClaudeSessionsPanel-bgBadge \{/);
  });
});
