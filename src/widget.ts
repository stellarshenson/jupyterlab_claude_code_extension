import { JupyterFrontEnd } from '@jupyterlab/application';
import {
  Clipboard,
  Dialog,
  InputDialog,
  Notification,
  showDialog
} from '@jupyterlab/apputils';
import { ServerConnection } from '@jupyterlab/services';
import { IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { ITerminalTracker } from '@jupyterlab/terminal';
import { folderIcon, terminalIcon } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { UUID } from '@lumino/coreutils';
import { Menu, Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';

import { requestAPI } from './request';
import {
  addIcon,
  branchIcon,
  claudeIcon,
  filterIcon,
  refreshIcon,
  removeIcon,
  shieldIcon,
  starFilledIcon
} from './icons';
import {
  IBranch,
  IBranchesResponse,
  IDeleteBranchesResponse,
  IFavouriteResponse,
  ILaunchTerminalResponse,
  ICleanupResponse,
  IRemoveResponse,
  ISession,
  ISessionsListResponse,
  ISwitchResponse
} from './types';

const POLL_INTERVAL_MS = 30_000;
const DEFAULT_RECENT_LIMIT = 10;
const EXPANDED_STORAGE_KEY = 'jupyterlab_claude_code_extension:expanded';

type SectionKey = 'favourites' | 'recent' | 'all';

export type PresentationMode = 'folder' | 'path';

const DEFAULT_PRESENTATION_MODE: PresentationMode = 'folder';

const SECTION_LABELS: Record<SectionKey, string> = {
  favourites: 'Favorites',
  recent: 'Recent',
  all: 'All'
};

const DEFAULT_EXPANDED: Record<SectionKey, boolean> = {
  favourites: true,
  recent: true,
  all: true
};

function loadExpanded(): Record<SectionKey, boolean> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_EXPANDED };
    }
    const parsed = JSON.parse(raw);
    return {
      favourites:
        typeof parsed?.favourites === 'boolean'
          ? parsed.favourites
          : DEFAULT_EXPANDED.favourites,
      recent:
        typeof parsed?.recent === 'boolean'
          ? parsed.recent
          : DEFAULT_EXPANDED.recent,
      all: typeof parsed?.all === 'boolean' ? parsed.all : DEFAULT_EXPANDED.all
    };
  } catch (_err) {
    return { ...DEFAULT_EXPANDED };
  }
}

function saveExpanded(state: Record<SectionKey, boolean>): void {
  try {
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(state));
  } catch (_err) {
    // localStorage unavailable (private mode, quota) - ignore
  }
}

interface ITerminalCwdResponse {
  terminal_name: string;
  cwds: string[];
  has_claude: boolean;
}

// Drop any pre-v0.6.18 localStorage entries from previous schemes - they
// were unreliable and we now interrogate JL's terminal manager directly.
try {
  window.localStorage.removeItem('jupyterlab_claude_code_extension:terminals');
} catch (_err) {
  // ignore
}

export class ClaudeCodeSessionsWidget extends Widget {
  constructor(
    app: JupyterFrontEnd,
    rootDir: string,
    terminalTracker: ITerminalTracker | null = null,
    fileBrowser: IDefaultFileBrowser | null = null
  ) {
    super();
    this._app = app;
    this._serverSettings = app.serviceManager.serverSettings;
    this._rootDir = rootDir.replace(/\/+$/, '');
    this._terminalTracker = terminalTracker;
    this._fileBrowser = fileBrowser;

    this.id = 'jupyterlab-claude-code-extension';
    this.title.icon = claudeIcon;
    this.title.caption = 'Claude Code Sessions';
    this.addClass('jp-ClaudeSessionsPanel');

    this._buildShell();
    this._setupContextMenu();
  }

  refresh(): void {
    this._showLoading();
    this._setRefreshSpinning(true);
    // `_fetch` is filesystem-fast, so without a floor the refresh icon would
    // spin for a single frame and read as "nothing happened". Hold the
    // spinner for at least ~500 ms so the click visibly registers.
    const minSpin = new Promise<void>(resolve =>
      window.setTimeout(resolve, 500)
    );
    Promise.all([
      this._fetch().catch(err => this._showError(err)),
      minSpin
    ]).finally(() => this._setRefreshSpinning(false));
  }

  /** Choose how rows are labelled: by session name, folder name, or path. */
  setPresentationMode(mode: PresentationMode): void {
    if (this._presentationMode === mode) {
      return;
    }
    this._presentationMode = mode;
    this._render();
  }

  /** Set how many rows the Recent section displays. */
  setRecentLimit(n: number): void {
    const clamped = Math.max(1, Math.min(100, Math.floor(n)));
    if (this._recentLimit === clamped) {
      return;
    }
    this._recentLimit = clamped;
    this._render();
  }

  /** Toggle the --dangerously-skip-permissions flag on launched sessions. */
  setDangerouslySkipPermissions(on: boolean): void {
    this._dangerouslySkip = !!on;
  }

  protected onAfterShow(_msg: Message): void {
    this.refresh();
    this._startPolling();
  }

  protected onBeforeHide(_msg: Message): void {
    this._stopPolling();
  }

  protected onCloseRequest(msg: Message): void {
    this._stopPolling();
    super.onCloseRequest(msg);
  }

  // ------------------------------------------------------------------ shell

  private _buildShell(): void {
    const root = this.node;
    root.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'jp-ClaudeSessionsPanel-header';

    const title = document.createElement('span');
    title.className = 'jp-ClaudeSessionsPanel-title';
    title.textContent = 'Claude Code Sessions';
    header.appendChild(title);

    const newBtn = document.createElement('button');
    newBtn.className = 'jp-ClaudeSessionsPanel-iconButton';
    newBtn.title = 'New Claude session in the current folder';
    addIcon.element({ container: newBtn });
    newBtn.addEventListener('click', () => {
      // Drop the menu just below the button, left-aligned with it.
      const rect = newBtn.getBoundingClientRect();
      this._newSessionMenu.open(rect.left, rect.bottom);
    });
    header.appendChild(newBtn);

    const filterBtn = document.createElement('button');
    filterBtn.className = 'jp-ClaudeSessionsPanel-iconButton';
    filterBtn.title = 'Filter sessions';
    filterIcon.element({ container: filterBtn });
    filterBtn.addEventListener('click', () => this._toggleFilterBar());
    header.appendChild(filterBtn);
    this._filterBtn = filterBtn;

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'jp-ClaudeSessionsPanel-iconButton';
    refreshBtn.title = 'Refresh';
    refreshIcon.element({ container: refreshBtn });
    refreshBtn.addEventListener('click', () => this.refresh());
    header.appendChild(refreshBtn);
    this._refreshBtn = refreshBtn;

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'jp-ClaudeSessionsPanel-search';
    search.placeholder = 'Filter sessions...';
    search.spellcheck = false;
    // Hidden by default; the filter-icon button reveals it. Lumino's
    // ``hidden`` attribute toggles ``display: none`` via the user-agent
    // stylesheet so no extra CSS rule is needed.
    search.hidden = true;
    search.addEventListener('input', () => {
      this._filter = search.value;
      this._render();
    });
    this._searchEl = search;

    const body = document.createElement('div');
    body.className = 'jp-ClaudeSessionsPanel-body';

    root.appendChild(header);
    root.appendChild(search);
    root.appendChild(body);

    this._bodyEl = body;
  }

  /** Show / hide the filter input. Hiding also clears the active filter
   * so the user does not end up with an "invisible" filter narrowing
   * the rows the next time they open the panel.
   */
  private _toggleFilterBar(): void {
    if (!this._searchEl) {
      return;
    }
    const show = this._searchEl.hidden;
    this._searchEl.hidden = !show;
    if (this._filterBtn) {
      this._filterBtn.classList.toggle('jp-mod-active', show);
    }
    if (show) {
      this._searchEl.focus();
    } else if (this._filter) {
      this._filter = '';
      this._searchEl.value = '';
      this._render();
    }
  }

  /** Normalise strings for filter comparison: NFD-decompose, strip combining
   * diacritic marks, lowercase, and collapse separators (`-`, `_`, `.`, `/`,
   * whitespace) entirely. So "foo-bar", "foo_bar", "foo bar", "Foo Bar" all
   * compare equal as "foobar".
   */
  private _normalize(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[\s\-_./]+/g, '');
  }

  /** Fuzzy match at a 95% threshold: substring on normalised strings,
   * with up to 5% Levenshtein tolerance. For short queries the budget
   * still rounds to zero so behaviour is substring-only there - the
   * relaxation only kicks in for queries long enough that 5% reaches a
   * full edit (10+ chars).
   */
  private _fuzzyMatch(haystack: string, needle: string): boolean {
    if (!needle) {
      return true;
    }
    const h = this._normalize(haystack);
    const n = this._normalize(needle);
    if (!n) {
      return true;
    }
    if (h.includes(n)) {
      return true;
    }
    const tol = Math.round(n.length * 0.05);
    if (tol === 0) {
      return false;
    }
    for (let len = n.length - tol; len <= n.length + tol; len += 1) {
      if (len <= 0) {
        continue;
      }
      for (let i = 0; i + len <= h.length; i += 1) {
        if (this._levenshtein(h.slice(i, i + len), n) <= tol) {
          return true;
        }
      }
    }
    return false;
  }

  private _levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) {
      return n;
    }
    if (n === 0) {
      return m;
    }
    const dp: number[] = new Array(n + 1);
    for (let j = 0; j <= n; j += 1) {
      dp[j] = j;
    }
    for (let i = 1; i <= m; i += 1) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j += 1) {
        const tmp = dp[j];
        dp[j] =
          a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[n];
  }

  private _matchesFilter(s: ISession): boolean {
    const q = this._filter.trim();
    if (!q) {
      return true;
    }
    return (
      this._fuzzyMatch(s.name, q) ||
      this._fuzzyMatch(s.project_path, q) ||
      this._fuzzyMatch(this._lookupName(s), q)
    );
  }

  private _showLoading(): void {
    // No visual indicator - the spinning refresh button conveys loading state.
  }

  private _showError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[jupyterlab_claude_code_extension]', message);
  }

  // ------------------------------------------------------------------ data

  private async _fetch(): Promise<void> {
    // `cache: 'no-store'` so the manual refresh button (and the post-launch
    // refresh) always re-read the server's view of ~/.claude rather than a
    // possibly-stale browser-cached response.
    const data = await requestAPI<ISessionsListResponse>(
      'sessions',
      this._serverSettings,
      { cache: 'no-store' }
    );
    this._sessions = data.sessions ?? [];
    this._render();
  }

  private async _toggleFavourite(session: ISession): Promise<void> {
    const next = !session.favourite;
    // Optimistic update
    session.favourite = next;
    this._render();
    try {
      await requestAPI<IFavouriteResponse>(
        'sessions/favourite',
        this._serverSettings,
        {
          method: 'POST',
          body: JSON.stringify({
            project_path: session.project_path,
            favourite: next
          })
        }
      );
    } catch (err) {
      // Roll back on failure
      session.favourite = !next;
      this._render();
      this._showError(err);
    }
  }

  private async _remove(session: ISession): Promise<void> {
    this._removingPaths.add(session.encoded_path);
    this._render();
    try {
      await requestAPI<IRemoveResponse>(
        'sessions/remove',
        this._serverSettings,
        {
          method: 'POST',
          body: JSON.stringify({ encoded_path: session.encoded_path })
        }
      );
      // Drop locally and re-render; a full refresh will follow on next poll
      this._sessions = (this._sessions ?? []).filter(
        s => s.encoded_path !== session.encoded_path
      );
    } catch (err) {
      this._showError(err);
    } finally {
      this._removingPaths.delete(session.encoded_path);
      this._render();
    }
  }

  private async _cleanupParallel(session: ISession): Promise<void> {
    const body = new Widget();
    body.node.className = 'jp-ClaudeSessionsPanel-cleanupBody';

    const message = document.createElement('div');
    message.className = 'jp-ClaudeSessionsPanel-cleanupMessage';
    const count = session.extra_sessions;
    message.textContent = `Removing ${count} parallel session${
      count === 1 ? '' : 's'
    }...`;
    body.node.appendChild(message);

    // No `value` attribute -> indeterminate (animated) while the request is
    // in flight; set to max on completion so the bar reads as finished.
    const bar = document.createElement('progress');
    bar.className = 'jp-ClaudeSessionsPanel-cleanupProgress';
    bar.max = 1;
    body.node.appendChild(bar);

    const dialog = new Dialog<unknown>({
      title: 'Clean Up Parallel Sessions',
      body,
      buttons: [Dialog.okButton({ label: 'Close' })]
    });
    // Hide the Close button while work is in progress; restore it once the
    // outcome (success or error) is shown so the user dismisses the popup.
    const footer = dialog.node.querySelector(
      '.jp-Dialog-footer'
    ) as HTMLElement | null;
    if (footer) {
      footer.style.display = 'none';
    }
    void dialog.launch();

    try {
      const data = await requestAPI<ICleanupResponse>(
        'sessions/cleanup',
        this._serverSettings,
        {
          method: 'POST',
          body: JSON.stringify({ encoded_path: session.encoded_path })
        }
      );
      bar.value = 1;
      message.textContent = `Removed ${data.removed_count} parallel session${
        data.removed_count === 1 ? '' : 's'
      }.`;
      // Refresh so the row's extra_sessions count (and menu label) update
      await this._fetch();
    } catch (err) {
      bar.remove();
      message.classList.add('jp-ClaudeSessionsPanel-cleanupError');
      message.textContent = `Cleanup failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
      this._showError(err);
    } finally {
      if (footer) {
        footer.style.display = '';
      }
    }
  }

  // -------------------------------------------------------------- terminal

  private async _resumeInTerminal(
    session: ISession,
    forceDangerous: boolean = false
  ): Promise<void> {
    // Coalesce concurrent clicks on the same row - subsequent clicks attach
    // to the in-flight promise instead of creating their own terminal.
    const inFlight = this._pendingByPath.get(session.project_path);
    if (inFlight) {
      return inFlight;
    }
    const promise = this._doResumeInTerminal(session, forceDangerous).finally(
      () => {
        this._pendingByPath.delete(session.project_path);
      }
    );
    this._pendingByPath.set(session.project_path, promise);
    return promise;
  }

  private async _doResumeInTerminal(
    session: ISession,
    forceDangerous: boolean
  ): Promise<void> {
    try {
      // Always prefer reusing an open terminal for this project. The
      // skip-permissions flag can only be applied to a fresh pty, never
      // retroactively. So if the user wants dangerous mode but an open
      // terminal already exists, show a modal asking them to close it
      // first - we won't auto-close, won't silently reuse the wrong mode.

      // 1. In-memory microcache.
      const cached = this._terminalsByPath.get(session.project_path);
      if (cached && !cached.isDisposed) {
        if (forceDangerous) {
          await this._showCloseExistingDialog();
        }
        this._focusTerminal(cached);
        return;
      }

      // 2. Walk every live terminal widget JL knows about.
      const found = await this._findTerminalForCwd(session.project_path);
      if (found) {
        this._terminalsByPath.set(session.project_path, found);
        this._wireTerminalDisposal(session.project_path, found);
        if (forceDangerous) {
          await this._showCloseExistingDialog();
        }
        this._focusTerminal(found);
        return;
      }

      // 3. No matching terminal - spawn a new one with `claude --resume <id>`
      // as the pty's only process (no shell). Server-side endpoint calls
      // terminal_manager.create(shell_command=[claude, --resume, sid], cwd=...)
      // and returns the terminal name; we then attach JL's standard widget
      // via terminal:open. When claude exits, the tab closes. The launch
      // RPC + the WebSocket-resize waiter on the server can take a few
      // seconds, so show a modal spinner for visual feedback.
      const spinner = this._showLaunchSpinner();
      try {
        const launched = await requestAPI<ILaunchTerminalResponse>(
          'launch-terminal',
          this._serverSettings,
          {
            method: 'POST',
            body: JSON.stringify({
              project_path: session.project_path,
              session_id: session.session_id,
              dangerously_skip_permissions:
                forceDangerous || this._dangerouslySkip
            })
          }
        );
        const widget: any = await this._app.commands.execute('terminal:open', {
          name: launched.terminal_name
        });
        if (widget?.id) {
          this._terminalsByPath.set(session.project_path, widget);
          this._wireTerminalDisposal(session.project_path, widget);
          this._focusTerminal(widget);
        }
      } finally {
        spinner.dispose();
      }
    } catch (err) {
      this._showError(err);
    } finally {
      // Reuse or fresh launch, either way the picture changed (a session may
      // now be remote-controlled, a row may have appeared). Pull fresh state.
      void this._fetch().catch(() => {
        /* a poll tick will retry; nothing actionable here */
      });
    }
  }

  /** Absolute path of the file browser's current folder; falls back to the
   * server root when no file browser is available. */
  private _currentFolder(): string {
    const rel = (this._fileBrowser?.model?.path ?? '').replace(/^\/+/, '');
    return rel ? `${this._rootDir}/${rel}` : this._rootDir;
  }

  /** Start a brand-new claude session in the file browser's current folder.
   * Same launch path as resuming (claude is the pty's only process via the
   * launch-terminal endpoint) - just without --resume, and always a fresh
   * terminal since there is no existing session to reuse.
   */
  private async _newSession(forceDangerous: boolean): Promise<void> {
    const projectPath = this._currentFolder();
    if (!projectPath) {
      return;
    }
    const spinner = this._showLaunchSpinner();
    try {
      const launched = await requestAPI<ILaunchTerminalResponse>(
        'launch-terminal',
        this._serverSettings,
        {
          method: 'POST',
          body: JSON.stringify({
            project_path: projectPath,
            dangerously_skip_permissions:
              forceDangerous || this._dangerouslySkip
          })
        }
      );
      const widget: any = await this._app.commands.execute('terminal:open', {
        name: launched.terminal_name
      });
      if (widget?.id) {
        this._terminalsByPath.set(projectPath, widget);
        this._wireTerminalDisposal(projectPath, widget);
        this._focusTerminal(widget);
      }
    } catch (err) {
      this._showError(err);
    } finally {
      spinner.dispose();
      // The new session creates a project dir under ~/.claude - refresh so
      // its row (and remote-control state) appears without waiting a poll.
      void this._fetch().catch(() => {
        /* a poll tick will retry; nothing actionable here */
      });
    }
  }

  /**
   * Bring a terminal tab to the front AND hand it keyboard focus, so the
   * user can start typing without an extra click. `activateById` only
   * reveals the tab; the xterm inside doesn't always grab DOM focus,
   * especially when the click originated in this sidebar. We defer the
   * `term.focus()` to the next frame so the widget is attached and visible
   * first.
   */
  private _focusTerminal(widget: any): void {
    if (!widget || widget.isDisposed) {
      return;
    }
    this._app.shell.activateById(widget.id);
    requestAnimationFrame(() => {
      try {
        widget.content?.term?.focus?.();
      } catch (_err) {
        /* terminal may have been disposed in the meantime - ignore */
      }
    });
  }

  private async _findTerminalForCwd(projectPath: string): Promise<any | null> {
    if (!this._terminalTracker) {
      return null;
    }
    const candidates: any[] = [];
    this._terminalTracker.forEach((widget: any) => {
      if (widget && !widget.isDisposed) {
        candidates.push(widget);
      }
    });
    const target = projectPath.replace(/\/+$/, '');
    for (const widget of candidates) {
      const sessName: string | undefined = widget?.content?.session?.name;
      if (typeof sessName !== 'string' || !sessName) {
        continue;
      }
      try {
        const data = await requestAPI<ITerminalCwdResponse>(
          `terminal-cwd/${encodeURIComponent(sessName)}`,
          this._serverSettings
        );
        // Only reuse terminals that actually have claude running. Otherwise
        // a plain bash opened at the project cwd would be matched and
        // activated, swallowing the resume click without spawning claude.
        if (!data?.has_claude) {
          continue;
        }
        const cwds = Array.isArray(data?.cwds) ? data.cwds : [];
        for (const cwd of cwds) {
          if ((cwd || '').replace(/\/+$/, '') === target) {
            return widget;
          }
        }
      } catch (_err) {
        // Backend may report 404 for terminals that disappeared between
        // tracker enumeration and fetch - skip and continue.
      }
    }
    return null;
  }

  private async _showCloseExistingDialog(): Promise<void> {
    await showDialog({
      title: 'Existing Claude session is running',
      body:
        'A terminal for this project is already open. To launch with ' +
        '--dangerously-skip-permissions, close that terminal first then ' +
        'click "Resume (Skip Permissions)" again.',
      buttons: [Dialog.okButton({ label: 'OK' })]
    });
  }

  /** Show a modal with a spinner while the terminal is being launched. The
   * caller must dismiss it via ``.dispose()`` once the work is done - the
   * dialog has no buttons so ``.resolve()`` would be a no-op.
   */
  private _showLaunchSpinner(): Dialog<unknown> {
    const body = new Widget();
    body.node.className = 'jp-ClaudeSessionsPanel-launchOverlay';

    const spinner = document.createElement('div');
    spinner.className =
      'jp-claude-sessions-panel-spinner jp-ClaudeSessionsPanel-launchSpinner';
    body.node.appendChild(spinner);

    const dialog = new Dialog<unknown>({
      title: 'Opening Claude Code session',
      body,
      buttons: []
    });
    // launch() returns a Promise we don't await - we resolve programmatically
    // when the spawn completes (or errors).
    void dialog.launch();
    return dialog;
  }

  private _wireTerminalDisposal(projectPath: string, widget: any): void {
    if (!widget?.disposed?.connect) {
      return;
    }
    widget.disposed.connect(() => {
      if (this._terminalsByPath.get(projectPath) === widget) {
        this._terminalsByPath.delete(projectPath);
      }
    });
  }

  // -------------------------------------------------------------- rendering

  /** Apply the presentation-mode setting (basename collisions for folder
   * mode are resolved separately in ``_disambiguate``). */
  private _displayName(s: ISession): string {
    const folder = this._basename(s.project_path) || s.encoded_path;
    if (this._presentationMode === 'path') {
      return this._displayPath(s.project_path) || folder;
    }
    // Honour the session name Claude records (e.g. a `/rename`); fall back
    // to the folder basename when the backend reports no session name.
    if (s.name_source === 'session' && s.name) {
      return s.name;
    }
    return folder;
  }

  private _basename(p: string): string {
    if (!p) {
      return '';
    }
    const parts = p.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  /** Walk path tails until every name in a colliding group is unique.
   * Folder-mode labels are folder basenames, so two different projects can
   * end up with the same label (e.g. two `datascience` folders under
   * different parents); we extend each colliding label with as much of its
   * parent path as it takes to make it unique. */
  private _disambiguate(rows: ISession[]): Map<string, string> {
    const out = new Map<string, string>();
    const groups = new Map<string, ISession[]>();
    for (const r of rows) {
      const n = this._displayName(r);
      groups.set(n, (groups.get(n) ?? []).concat(r));
    }
    for (const [name, group] of groups.entries()) {
      if (group.length === 1) {
        out.set(group[0].project_path, name);
        continue;
      }
      const segs = group.map(r => r.project_path.split('/').filter(Boolean));
      const max = Math.max(...segs.map(s => s.length));
      let depth = 1;
      let resolved = false;
      while (depth <= max) {
        const tails = segs.map(s => s.slice(-depth).join('/'));
        if (new Set(tails).size === tails.length) {
          group.forEach((r, i) => out.set(r.project_path, tails[i]));
          resolved = true;
          break;
        }
        depth += 1;
      }
      if (!resolved) {
        // Identical project_path values across rows shouldn't happen
        // (list_sessions dedups by path) but if it ever does, fall back to
        // the absolute path so rows stay distinguishable.
        group.forEach(r => out.set(r.project_path, r.project_path));
      }
    }
    return out;
  }

  private _render(): void {
    const sessions = this._sessions ?? [];

    // Capture scrollTop per section so polling refreshes don't reset the
    // user's place inside the All list.
    const scrolls = new Map<string, number>();
    this._bodyEl
      .querySelectorAll<HTMLElement>('.jp-ClaudeSessionsPanel-section')
      .forEach(sect => {
        const key = sect.dataset.section;
        const list = sect.querySelector<HTMLElement>(
          '.jp-ClaudeSessionsPanel-list'
        );
        if (key && list) {
          scrolls.set(key, list.scrollTop);
        }
      });

    this._bodyEl.innerHTML = '';

    if (sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jp-ClaudeSessionsPanel-empty';
      empty.textContent = 'No Claude Code sessions found.';
      this._bodyEl.appendChild(empty);
      return;
    }

    // Compute disambiguated display names once per render (against the
    // full set so suffixes stay stable when filtering narrows the view).
    this._displayNames = this._disambiguate(sessions);

    const filtered = sessions.filter(s => this._matchesFilter(s));
    const favourites = filtered.filter(s => s.favourite);
    const recent = [...filtered]
      .sort((a, b) => b.file_mtime - a.file_mtime)
      .slice(0, this._recentLimit);
    const all = [...filtered].sort((a, b) =>
      this._lookupName(a).localeCompare(this._lookupName(b))
    );

    if (favourites.length > 0) {
      this._renderSection('favourites', favourites);
    }
    this._renderSection('recent', recent);
    this._renderSection('all', all);

    // Restore scroll positions
    this._bodyEl
      .querySelectorAll<HTMLElement>('.jp-ClaudeSessionsPanel-section')
      .forEach(sect => {
        const key = sect.dataset.section;
        const list = sect.querySelector<HTMLElement>(
          '.jp-ClaudeSessionsPanel-list'
        );
        const saved = key ? scrolls.get(key) : undefined;
        if (list && saved !== undefined) {
          list.scrollTop = saved;
        }
      });
  }

  private _renderSection(key: SectionKey, items: ISession[]): void {
    const section = document.createElement('div');
    section.className = 'jp-ClaudeSessionsPanel-section';
    section.dataset.section = key;
    const expanded = this._expanded[key];

    const header = document.createElement('button');
    header.className = 'jp-ClaudeSessionsPanel-sectionHeader';
    header.setAttribute('aria-expanded', String(expanded));

    const caret = document.createElement('span');
    caret.className = 'jp-ClaudeSessionsPanel-caret';
    caret.textContent = expanded ? '▾' : '▸';
    header.appendChild(caret);

    const label = document.createElement('span');
    label.className = 'jp-ClaudeSessionsPanel-sectionLabel';
    label.textContent = `${SECTION_LABELS[key]} (${items.length})`;
    header.appendChild(label);

    header.addEventListener('click', () => {
      this._expanded[key] = !this._expanded[key];
      saveExpanded(this._expanded);
      this._render();
    });
    section.appendChild(header);

    if (expanded) {
      const list = document.createElement('div');
      list.className = 'jp-ClaudeSessionsPanel-list';
      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'jp-ClaudeSessionsPanel-emptySection';
        empty.textContent =
          key === 'favourites' ? 'No favorites yet.' : 'Empty.';
        list.appendChild(empty);
      } else {
        for (const item of items) {
          list.appendChild(this._renderRow(item, key));
        }
      }
      section.appendChild(list);
    }

    this._bodyEl.appendChild(section);
  }

  private _renderRow(
    session: ISession,
    sectionKey: SectionKey
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'jp-ClaudeSessionsPanel-row';
    row.title = this._buildRowTooltip(session);

    // Age emphasis: active within the last minute reads bright, idle for
    // over a week dims; the state decays/promotes on the next refresh.
    if (session.file_mtime) {
      const age = Date.now() - session.file_mtime;
      if (age < 60_000) {
        row.classList.add('jp-mod-recentlyActive');
      } else if (age > 7 * 86_400_000) {
        row.classList.add('jp-mod-stale');
      }
    }

    const removing = this._removingPaths.has(session.encoded_path);
    if (removing) {
      row.classList.add('jp-mod-busy');
    }

    if (removing) {
      const spinner = document.createElement('span');
      spinner.className = 'jp-ClaudeSessionsPanel-spinner';
      spinner.title = 'Removing...';
      row.appendChild(spinner);
    } else if (session.remote_control) {
      const dot = document.createElement('span');
      dot.className = 'jp-ClaudeSessionsPanel-dot';
      dot.title = 'Remote control session is active';
      row.appendChild(dot);
    } else {
      const dotPlaceholder = document.createElement('span');
      dotPlaceholder.className = 'jp-ClaudeSessionsPanel-dotPlaceholder';
      row.appendChild(dotPlaceholder);
    }

    const name = document.createElement('span');
    name.className = 'jp-ClaudeSessionsPanel-name';
    name.textContent = this._lookupName(session);
    // Branch icon + total conversation count - only when the project has
    // branches. Lives inside the name span so it hugs the label text
    // instead of being flexed to the row's right edge.
    if (session.extra_sessions > 0) {
      const badge = document.createElement('span');
      badge.className = 'jp-ClaudeSessionsPanel-branchBadge';
      const icon = document.createElement('span');
      icon.className = 'jp-ClaudeSessionsPanel-branchBadgeIcon';
      branchIcon.element({ container: icon });
      badge.appendChild(icon);
      badge.appendChild(
        document.createTextNode(String(session.extra_sessions + 1))
      );
      name.appendChild(badge);
    }
    row.appendChild(name);

    // No star in the Favorites section - every row there is a favorite
    // by definition; stars are an indicator only useful in Recent/All.
    // Star sits before the time so the fixed-width time column stays the
    // rightmost alignment anchor across all rows.
    if (session.favourite && sectionKey !== 'favourites') {
      const star = document.createElement('span');
      star.className = 'jp-ClaudeSessionsPanel-favStar';
      star.title = 'Favorite';
      starFilledIcon.element({ container: star });
      row.appendChild(star);
    }

    if (session.file_mtime) {
      const time = document.createElement('span');
      time.className = 'jp-ClaudeSessionsPanel-rowTime';
      time.textContent = this._formatRelativeTime(session.file_mtime);
      row.appendChild(time);
    }

    row.addEventListener('click', () => {
      if (removing) {
        return;
      }
      void this._resumeInTerminal(session);
    });
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (removing) {
        return;
      }
      this._activeSession = session;
      this._setActiveRow(row);
      void this._openContextMenu(session, e.clientX, e.clientY);
    });

    return row;
  }

  private _lookupName(s: ISession): string {
    return this._displayNames.get(s.project_path) ?? this._displayName(s);
  }

  private _buildRowTooltip(s: ISession): string {
    const lines: string[] = [this._lookupName(s)];
    lines.push(`Path: ${this._displayPath(s.project_path)}`);
    if (s.file_mtime) {
      lines.push(`Last activity: ${this._formatRelativeTime(s.file_mtime)}`);
    }
    if (s.message_count) {
      lines.push(`Messages: ${s.message_count}`);
    }
    if (s.extra_sessions > 0) {
      lines.push(`Conversations: ${s.extra_sessions + 1}`);
    }
    if (s.git_branch) {
      lines.push(`Branch: ${s.git_branch}`);
    }
    if (s.remote_control) {
      lines.push('Remote control: active');
    }
    if (s.session_id) {
      lines.push(`Session id: ${s.session_id}`);
    }
    return lines.join('\n');
  }

  private _displayPath(absolute: string): string {
    if (!this._rootDir) {
      return absolute;
    }
    if (absolute === this._rootDir) {
      return '.';
    }
    if (absolute.startsWith(this._rootDir + '/')) {
      return absolute.slice(this._rootDir.length + 1);
    }
    return absolute;
  }

  /** Path relative to the JupyterLab server root (``''`` for the root
   * itself), or ``null`` when the folder lies outside the root - in which
   * case the file browser has no way to address it. */
  private _pathUnderRoot(absolute: string): string | null {
    if (!this._rootDir) {
      return null;
    }
    if (absolute === this._rootDir) {
      return '';
    }
    if (absolute.startsWith(this._rootDir + '/')) {
      return absolute.slice(this._rootDir.length + 1);
    }
    return null;
  }

  private _formatRelativeTime(epochMs: number): string {
    if (!epochMs) {
      return 'unknown';
    }
    const diff = Date.now() - epochMs;
    if (diff < 60_000) {
      return 'now';
    }
    if (diff < 3_600_000) {
      return `${Math.floor(diff / 60_000)}m ago`;
    }
    if (diff < 86_400_000) {
      return `${Math.floor(diff / 3_600_000)}h ago`;
    }
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  /** Branch entry display: conversation name plus short session id in
   * brackets; branches share the project path so only the name and id
   * distinguish them. Skips the suffix when the label already is the
   * short id (the backend's last-resort fallback). */
  private _branchDisplayName(b: IBranch): string {
    const shortId = b.session_id.slice(0, 8);
    return b.label === shortId ? b.label : `${b.label} (${shortId})`;
  }

  private _setRefreshSpinning(on: boolean): void {
    if (!this._refreshBtn) {
      return;
    }
    this._refreshBtn.classList.toggle('jp-mod-spinning', on);
  }

  private _setActiveRow(row: HTMLElement | null): void {
    if (this._activeRowEl && this._activeRowEl !== row) {
      this._activeRowEl.classList.remove('jp-mod-active');
    }
    this._activeRowEl = row;
    if (row) {
      row.classList.add('jp-mod-active');
    }
  }

  // -------------------------------------------------------------- ctx menu

  private _setupContextMenu(): void {
    this._commands = new CommandRegistry();

    this._commands.addCommand('claude-code-sessions:toggle-favourite', {
      label: () =>
        this._activeSession?.favourite
          ? 'Remove from Favorites'
          : 'Add to Favorites',
      execute: () => {
        if (this._activeSession) {
          void this._toggleFavourite(this._activeSession);
        }
      }
    });

    this._commands.addCommand('claude-code-sessions:resume', {
      label: 'Resume',
      execute: () => {
        if (this._activeSession) {
          void this._resumeInTerminal(this._activeSession);
        }
      }
    });

    this._commands.addCommand('claude-code-sessions:resume-dangerous', {
      label: 'Resume (Skip Permissions)',
      icon: shieldIcon,
      execute: () => {
        if (this._activeSession) {
          void this._resumeInTerminal(this._activeSession, true);
        }
      }
    });

    this._commands.addCommand('claude-code-sessions:open-terminal', {
      label: 'Open Terminal',
      icon: terminalIcon,
      execute: () => {
        if (!this._activeSession) {
          return;
        }
        // JupyterLab's built-in command - spawns a fresh pty with the user's
        // shell at the given cwd. The cwd argument is interpreted by the
        // server as a path *relative to the contents manager root*, not an
        // absolute filesystem path - so we translate via _pathUnderRoot,
        // matching the Show in File Browser handling. No claude, no waiter
        // wrapper, no reuse; for when the user wants a plain shell at the
        // project folder.
        const rel = this._pathUnderRoot(this._activeSession.project_path);
        if (rel === null) {
          Notification.warning(
            'Folder is outside the JupyterLab root - cannot open a terminal there.',
            { autoClose: 4000 }
          );
          return;
        }
        void this._app.commands.execute('terminal:create-new', { cwd: rel });
      }
    });

    this._commands.addCommand('claude-code-sessions:show-in-filebrowser', {
      label: 'Show in File Browser',
      icon: folderIcon,
      execute: () => {
        if (!this._activeSession) {
          return;
        }
        const rel = this._pathUnderRoot(this._activeSession.project_path);
        if (rel === null) {
          // The file browser can only navigate within the JupyterLab server
          // root; a project folder outside it has no addressable path there.
          Notification.warning(
            'Folder is outside the JupyterLab root - the file browser cannot show it.',
            { autoClose: 4000 }
          );
          return;
        }
        // JL's built-in command navigates the default file browser to the
        // path and reveals the browser panel.
        void this._app.commands.execute('filebrowser:go-to-path', {
          path: rel
        });
      }
    });

    this._commands.addCommand('claude-code-sessions:copy-path', {
      label: 'Copy Path',
      execute: () => {
        if (!this._activeSession) {
          return;
        }
        const path = this._activeSession.project_path;
        Clipboard.copyToSystem(path);
      }
    });

    this._commands.addCommand('claude-code-sessions:cleanup-parallel', {
      label: () =>
        `Clean Up Parallel Sessions (${this._activeSession?.extra_sessions ?? 0})`,
      isVisible: () => (this._activeSession?.extra_sessions ?? 0) > 0,
      execute: () => {
        if (this._activeSession) {
          void this._cleanupParallel(this._activeSession);
        }
      }
    });

    this._commands.addCommand('claude-code-sessions:switch-branch', {
      label: args => String(args.label ?? ''),
      execute: args => {
        const sessionId = String(args.session_id ?? '');
        if (sessionId) {
          void this._switchBranch(sessionId);
        }
      }
    });

    this._commands.addCommand('claude-code-sessions:switch-branch-more', {
      label: () => `Manage Sessions... (${this._lastBranches.length})`,
      execute: () => {
        void this._showBranchPopup(
          this._lastBranches,
          this._lastBranchesCurrent
        );
      }
    });

    this._commands.addCommand('claude-code-sessions:branch-session', {
      label: 'Branch Session...',
      icon: branchIcon,
      execute: () => void this._branchSession(false)
    });

    this._commands.addCommand('claude-code-sessions:branch-session-dangerous', {
      label: 'Branch Session (Skip Permissions)...',
      icon: shieldIcon,
      execute: () => void this._branchSession(true)
    });

    this._commands.addCommand('claude-code-sessions:remove', {
      label: 'Remove from Claude',
      icon: removeIcon,
      execute: () => {
        if (this._activeSession) {
          void this._remove(this._activeSession);
        }
      }
    });

    this._commands.addCommand('claude-code-sessions:new-session', {
      label: 'New Claude Session',
      execute: () => void this._newSession(false)
    });

    this._commands.addCommand('claude-code-sessions:new-session-dangerous', {
      label: 'New Claude Session (Skip Permissions)',
      icon: shieldIcon,
      execute: () => void this._newSession(true)
    });

    // Dropdown for the header's plus button - same command registry and
    // styling as the row context menu.
    this._newSessionMenu = new Menu({ commands: this._commands });
    this._newSessionMenu.addClass('jp-ClaudeSessionsContextMenu');
    this._newSessionMenu.addItem({
      command: 'claude-code-sessions:new-session'
    });
    this._newSessionMenu.addItem({
      command: 'claude-code-sessions:new-session-dangerous'
    });

    // Submenu listing the project's other conversations ("branches") -
    // items are rebuilt on every context-menu open from a fresh
    // sessions/branches fetch.
    this._branchSubmenu = new Menu({ commands: this._commands });
    this._branchSubmenu.addClass('jp-ClaudeSessionsContextMenu');
    this._branchSubmenu.title.label = 'Switch and Manage Sessions';

    this._contextMenu = new Menu({ commands: this._commands });
    this._contextMenu.addClass('jp-ClaudeSessionsContextMenu');
    this._rebuildContextMenu(false);

    this._contextMenu.aboutToClose.connect(() => {
      // Only clear the visual highlight - DO NOT null _activeSession.
      // Lumino fires aboutToClose BEFORE the activated item's command runs,
      // so the command callback still needs to read _activeSession. The
      // field is overwritten on the next contextmenu open.
      this._setActiveRow(null);
    });
  }

  /** Rebuild the context menu's items. Lumino submenu-type items have no
   * ``isVisible`` hook, so the menu is rebuilt per open and the branch
   * submenu inserted only when the row actually has branches. */
  private _rebuildContextMenu(withBranches: boolean): void {
    this._contextMenu.clearItems();
    this._contextMenu.addItem({ command: 'claude-code-sessions:resume' });
    this._contextMenu.addItem({
      command: 'claude-code-sessions:resume-dangerous'
    });
    this._contextMenu.addItem({
      command: 'claude-code-sessions:open-terminal'
    });
    this._contextMenu.addItem({
      command: 'claude-code-sessions:show-in-filebrowser'
    });
    this._contextMenu.addItem({
      command: 'claude-code-sessions:toggle-favourite'
    });
    this._contextMenu.addItem({ command: 'claude-code-sessions:copy-path' });
    this._contextMenu.addItem({ type: 'separator' });
    if (withBranches) {
      this._contextMenu.addItem({
        type: 'submenu',
        submenu: this._branchSubmenu
      });
    }
    this._contextMenu.addItem({
      command: 'claude-code-sessions:branch-session'
    });
    this._contextMenu.addItem({
      command: 'claude-code-sessions:branch-session-dangerous'
    });
    this._contextMenu.addItem({
      command: 'claude-code-sessions:cleanup-parallel'
    });
    this._contextMenu.addItem({ command: 'claude-code-sessions:remove' });
  }

  /** Open the row context menu, populating the branch submenu first when
   * the project has more than one conversation. On a fetch failure the
   * menu opens without the submenu. */
  private async _openContextMenu(
    session: ISession,
    x: number,
    y: number
  ): Promise<void> {
    let hasBranches = false;
    if (session.extra_sessions > 0) {
      try {
        const data = await requestAPI<IBranchesResponse>(
          `sessions/branches?encoded_path=${encodeURIComponent(session.encoded_path)}`,
          this._serverSettings,
          { cache: 'no-store' }
        );
        this._lastBranches = data.branches;
        this._lastBranchesCurrent = data.current;
        this._branchSubmenu.clearItems();
        this._branchSubmenu.title.label = `Switch and Manage Sessions (${data.branches.length})`;
        // The submenu shows only the 5 most recent inline (fewest clicks
        // for often-used sessions); the full list plus management lives
        // behind the always-present "Manage Sessions..." popup.
        for (const b of data.branches.slice(0, 5)) {
          this._branchSubmenu.addItem({
            command: 'claude-code-sessions:switch-branch',
            args: {
              session_id: b.session_id,
              label: `${this._branchDisplayName(b)} - ${this._formatRelativeTime(b.file_mtime)}`
            }
          });
        }
        this._branchSubmenu.addItem({ type: 'separator' });
        this._branchSubmenu.addItem({
          command: 'claude-code-sessions:switch-branch-more'
        });
        hasBranches = data.branches.length > 0;
      } catch {
        hasBranches = false;
      }
    }
    this._rebuildContextMenu(hasBranches);
    this._contextMenu.open(x, y);
  }

  /** Popup with the project's full branch list - browse, filter, switch
   * and manage. Clicking an entry switches while nothing is selected;
   * checkbox selection (one, many, or select-all) arms a two-step Delete
   * button that removes the chosen sessions. The current conversation is
   * shown first, badged and untouchable. */
  private _showBranchPopup(branches: IBranch[], current: string): void {
    // Local working copy so deletions can refresh the list in place.
    let items = [...branches];
    const selected = new Set<string>();
    let confirmArmed = false;

    const body = document.createElement('div');
    body.className = 'jp-ClaudeSessionsPanel-branchPopup';

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Filter sessions...';
    search.className = 'jp-ClaudeSessionsPanel-branchSearch';
    body.appendChild(search);

    const selectAllBar = document.createElement('label');
    selectAllBar.className = 'jp-ClaudeSessionsPanel-branchSelectAll';
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAllBar.appendChild(selectAll);
    selectAllBar.appendChild(document.createTextNode('Select all'));
    body.appendChild(selectAllBar);

    const list = document.createElement('div');
    list.className = 'jp-ClaudeSessionsPanel-branchList';
    body.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'jp-ClaudeSessionsPanel-branchFooter';
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'jp-ClaudeSessionsPanel-branchDelete';
    footer.appendChild(deleteBtn);
    body.appendChild(footer);

    const bodyWidget = new Widget({ node: body });
    const dialog = new Dialog({
      title: 'Switch and Manage Sessions',
      body: bodyWidget,
      buttons: [Dialog.cancelButton()]
    });

    const visibleMatches = (): IBranch[] => {
      const needle = search.value.trim().toLowerCase();
      return items.filter(
        b =>
          !needle ||
          b.label.toLowerCase().includes(needle) ||
          b.session_id.toLowerCase().includes(needle)
      );
    };

    // Any selection change disarms a pending confirm.
    const updateControls = () => {
      confirmArmed = false;
      deleteBtn.disabled = selected.size === 0;
      deleteBtn.textContent = `Delete (${selected.size})`;
      deleteBtn.classList.remove('jp-mod-confirm');
      const visible = visibleMatches();
      const visibleSelected = visible.filter(b =>
        selected.has(b.session_id)
      ).length;
      selectAll.checked =
        visible.length > 0 && visibleSelected === visible.length;
      selectAll.indeterminate =
        visibleSelected > 0 && visibleSelected < visible.length;
    };

    const render = () => {
      list.replaceChildren();

      // The current conversation leads the list - badged, unselectable,
      // undeletable; only the extras below it are manageable.
      const currentRow = document.createElement('div');
      currentRow.className = 'jp-ClaudeSessionsPanel-branchRow jp-mod-current';
      currentRow.title = `Session id: ${current}`;
      const currentLabel = document.createElement('span');
      currentLabel.className = 'jp-ClaudeSessionsPanel-branchLabel';
      const currentName = this._activeSession
        ? this._lookupName(this._activeSession)
        : current.slice(0, 8);
      currentLabel.textContent = `${currentName} (${current.slice(0, 8)})`;
      currentRow.appendChild(currentLabel);
      const badge = document.createElement('span');
      badge.className = 'jp-ClaudeSessionsPanel-branchCurrentBadge';
      badge.textContent = 'current';
      currentRow.appendChild(badge);
      list.appendChild(currentRow);

      const matches = visibleMatches();
      if (matches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'jp-ClaudeSessionsPanel-emptySection';
        empty.textContent = items.length
          ? 'No matching sessions.'
          : 'No other conversations.';
        list.appendChild(empty);
        return;
      }
      for (const b of matches) {
        const row = document.createElement('div');
        row.className = 'jp-ClaudeSessionsPanel-branchRow';
        row.title = `Session id: ${b.session_id}`;

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = selected.has(b.session_id);
        // The checkbox is its own click zone - ticking must not switch.
        check.addEventListener('click', e => {
          e.stopPropagation();
          if (check.checked) {
            selected.add(b.session_id);
          } else {
            selected.delete(b.session_id);
          }
          updateControls();
        });
        row.appendChild(check);

        const label = document.createElement('span');
        label.className = 'jp-ClaudeSessionsPanel-branchLabel';
        label.textContent = this._branchDisplayName(b);
        row.appendChild(label);

        const time = document.createElement('span');
        time.className = 'jp-ClaudeSessionsPanel-branchTime';
        time.textContent = this._formatRelativeTime(b.file_mtime);
        row.appendChild(time);

        row.addEventListener('click', () => {
          // Selection mode: while anything is ticked, row clicks toggle
          // selection - no accidental switch mid-selection.
          if (selected.size > 0) {
            if (selected.has(b.session_id)) {
              selected.delete(b.session_id);
            } else {
              selected.add(b.session_id);
            }
            check.checked = selected.has(b.session_id);
            updateControls();
            return;
          }
          dialog.dispose();
          void this._switchBranch(b.session_id);
        });
        list.appendChild(row);
      }
    };

    selectAll.addEventListener('change', () => {
      // Select-all acts on the visible (filtered) rows only.
      const visible = visibleMatches();
      if (selectAll.checked) {
        visible.forEach(b => selected.add(b.session_id));
      } else {
        visible.forEach(b => selected.delete(b.session_id));
      }
      render();
      updateControls();
    });

    deleteBtn.addEventListener('click', () => {
      if (selected.size === 0) {
        return;
      }
      if (!confirmArmed) {
        // Two-step delete: first click arms, second click executes.
        confirmArmed = true;
        deleteBtn.textContent = `Confirm delete (${selected.size})`;
        deleteBtn.classList.add('jp-mod-confirm');
        return;
      }
      void this._deleteBranches([...selected]).then(deleted => {
        if (deleted === null) {
          return;
        }
        items = items.filter(b => !selected.has(b.session_id));
        selected.clear();
        this._lastBranches = items;
        render();
        updateControls();
      });
    });

    search.addEventListener('input', () => {
      render();
      updateControls();
    });
    render();
    updateControls();

    void dialog.launch();
    search.focus();
  }

  /** Delete the given branch sessions of the active row's project.
   * Returns the removed count, or null on failure (after notifying).
   * Always resyncs the panel so the row's conversation count drops. */
  private async _deleteBranches(sessionIds: string[]): Promise<number | null> {
    const session = this._activeSession;
    if (!session) {
      return null;
    }
    try {
      const result = await requestAPI<IDeleteBranchesResponse>(
        'sessions/delete-branches',
        this._serverSettings,
        {
          method: 'POST',
          body: JSON.stringify({
            encoded_path: session.encoded_path,
            session_ids: sessionIds
          })
        }
      );
      return result.removed_count;
    } catch (err) {
      Notification.error(`Delete failed: ${String(err)}`, {
        autoClose: 4000
      });
      return null;
    } finally {
      await this._fetch();
    }
  }

  /** Fork the active row's current conversation into a new named branch.
   *
   * Asks for a name, then launches a terminal running
   * ``claude --resume <current> --fork-session --session-id <new uuid>`` -
   * the uuid is generated here so the forked JSONL is known up front. Once
   * claude materialises the file (polled via sessions/set-title) the chosen
   * name is stamped as a custom-title record. The fork is the newest JSONL,
   * so the recency resolution makes it the row's current conversation
   * without an explicit switch.
   */
  private async _branchSession(forceDangerous: boolean): Promise<void> {
    const session = this._activeSession;
    if (!session) {
      return;
    }
    const named = await InputDialog.getText({
      title: 'Branch Session',
      label: 'Name for the new session',
      placeholder: this._lookupName(session)
    });
    if (!named.button.accept || !named.value || !named.value.trim()) {
      return;
    }
    const title = named.value.trim();
    const forkId = UUID.uuid4();
    const spinner = this._showLaunchSpinner();
    try {
      const launched = await requestAPI<ILaunchTerminalResponse>(
        'launch-terminal',
        this._serverSettings,
        {
          method: 'POST',
          body: JSON.stringify({
            project_path: session.project_path,
            session_id: session.session_id,
            fork_session_id: forkId,
            dangerously_skip_permissions:
              forceDangerous || this._dangerouslySkip
          })
        }
      );
      const widget: any = await this._app.commands.execute('terminal:open', {
        name: launched.terminal_name
      });
      if (widget?.id) {
        this._terminalsByPath.set(session.project_path, widget);
        this._wireTerminalDisposal(session.project_path, widget);
        this._focusTerminal(widget);
      }
    } catch (err) {
      this._showError(err);
      return;
    } finally {
      spinner.dispose();
    }
    // Stamp the name in the background once the forked JSONL appears -
    // claude writes it on its first record, typically within seconds.
    void this._stampForkTitle(session.encoded_path, forkId, title);
  }

  /** Retry sessions/set-title until the forked JSONL exists (404 while it
   * does not), then refresh so the row shows the named fork as current. */
  private async _stampForkTitle(
    encodedPath: string,
    sessionId: string,
    title: string
  ): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await requestAPI<{ ok: boolean }>(
          'sessions/set-title',
          this._serverSettings,
          {
            method: 'POST',
            body: JSON.stringify({
              encoded_path: encodedPath,
              session_id: sessionId,
              title
            })
          }
        );
        await this._fetch();
        return;
      } catch (err) {
        const notYet =
          err instanceof ServerConnection.ResponseError &&
          err.response.status === 404;
        if (!notYet) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    Notification.warning(
      `Branched session started, but the name "${title}" could not be applied - use /rename in the session.`,
      { autoClose: 6000 }
    );
  }

  /** Switch the active row's project to another conversation branch.
   * The backend touches the branch JSONL's mtime; a refresh then shows
   * the selected conversation as the row's current one. */
  private async _switchBranch(sessionId: string): Promise<void> {
    const session = this._activeSession;
    if (!session) {
      return;
    }
    try {
      const result = await requestAPI<ISwitchResponse>(
        'sessions/switch',
        this._serverSettings,
        {
          method: 'POST',
          body: JSON.stringify({
            encoded_path: session.encoded_path,
            session_id: sessionId
          })
        }
      );
      if (result.current !== result.requested) {
        // The branch's recorded cwd is inconsistent with the project dir,
        // so the recency resolution cannot make it current.
        Notification.warning(
          'Branch cannot become current - its recorded folder does not match the project.',
          { autoClose: 4000 }
        );
      }
    } catch (err) {
      const notFound =
        err instanceof ServerConnection.ResponseError &&
        err.response.status === 404;
      Notification.error(
        notFound
          ? 'Branch no longer exists - the session list has been refreshed.'
          : `Branch switch failed: ${err}`,
        { autoClose: 4000 }
      );
    } finally {
      await this._fetch();
    }
  }

  // --------------------------------------------------------------- polling

  private _startPolling(): void {
    if (this._pollHandle !== null) {
      return;
    }
    this._pollHandle = window.setInterval(() => {
      // Don't reshuffle rows while the user is interacting with the context menu
      if (this._contextMenu.isAttached) {
        return;
      }
      this._fetch().catch(err => this._showError(err));
    }, POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this._pollHandle !== null) {
      window.clearInterval(this._pollHandle);
      this._pollHandle = null;
    }
  }

  private readonly _app: JupyterFrontEnd;
  private readonly _serverSettings: ServerConnection.ISettings;
  private _bodyEl!: HTMLDivElement;
  private _refreshBtn: HTMLButtonElement | null = null;
  private _filterBtn: HTMLButtonElement | null = null;
  private _searchEl: HTMLInputElement | null = null;
  private _sessions: ISession[] | null = null;
  private _expanded: Record<SectionKey, boolean> = loadExpanded();
  private _commands!: CommandRegistry;
  private _contextMenu!: Menu;
  private _branchSubmenu!: Menu;
  private _lastBranches: IBranch[] = [];
  private _lastBranchesCurrent = '';
  private _newSessionMenu!: Menu;
  private _activeSession: ISession | null = null;
  private _activeRowEl: HTMLElement | null = null;
  private _pollHandle: number | null = null;
  private readonly _removingPaths: Set<string> = new Set();
  private readonly _terminalTracker: ITerminalTracker | null;
  private readonly _fileBrowser: IDefaultFileBrowser | null;
  private readonly _terminalsByPath: Map<string, any> = new Map();
  private readonly _pendingByPath: Map<string, Promise<void>> = new Map();
  private readonly _rootDir: string;
  private _presentationMode: PresentationMode = DEFAULT_PRESENTATION_MODE;
  private _recentLimit: number = DEFAULT_RECENT_LIMIT;
  private _dangerouslySkip: boolean = false;
  private _displayNames: Map<string, string> = new Map();
  private _filter: string = '';
}
