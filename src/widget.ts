import { JupyterFrontEnd } from '@jupyterlab/application';
import { Dialog, showDialog } from '@jupyterlab/apputils';
import { ServerConnection } from '@jupyterlab/services';
import { ITerminalTracker } from '@jupyterlab/terminal';
import { CommandRegistry } from '@lumino/commands';
import { Menu, Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';

import { requestAPI } from './request';
import {
  claudeIcon,
  refreshIcon,
  removeIcon,
  shieldIcon,
  starFilledIcon
} from './icons';
import {
  IFavouriteResponse,
  ILaunchTerminalResponse,
  IRemoveResponse,
  ISession,
  ISessionsListResponse
} from './types';

const POLL_INTERVAL_MS = 10_000;
const DEFAULT_RECENT_LIMIT = 10;
const EXPANDED_STORAGE_KEY = 'jupyterlab_claude_code_extension:expanded';

type SectionKey = 'favourites' | 'recent' | 'all';

const SECTION_LABELS: Record<SectionKey, string> = {
  favourites: 'Favourites',
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
    terminalTracker: ITerminalTracker | null = null
  ) {
    super();
    this._app = app;
    this._serverSettings = app.serviceManager.serverSettings;
    this._rootDir = rootDir.replace(/\/+$/, '');
    this._terminalTracker = terminalTracker;

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
    this._fetch()
      .catch(err => this._showError(err))
      .finally(() => this._setRefreshSpinning(false));
  }

  /** Toggle whether explicit ``/rename`` names are honoured. */
  setResolveSessionNames(on: boolean): void {
    if (this._resolveNames === on) {
      return;
    }
    this._resolveNames = on;
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
    search.addEventListener('input', () => {
      this._filter = search.value;
      this._render();
    });

    const body = document.createElement('div');
    body.className = 'jp-ClaudeSessionsPanel-body';

    const status = document.createElement('div');
    status.className = 'jp-ClaudeSessionsPanel-status';

    root.appendChild(header);
    root.appendChild(search);
    root.appendChild(body);
    root.appendChild(status);

    this._bodyEl = body;
    this._statusEl = status;
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
    this._statusEl.textContent = this._sessions === null ? 'Loading...' : '';
  }

  private _showError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this._statusEl.textContent = `Error: ${message}`;
  }

  // ------------------------------------------------------------------ data

  private async _fetch(): Promise<void> {
    const data = await requestAPI<ISessionsListResponse>(
      'sessions',
      this._serverSettings
    );
    this._sessions = data.sessions ?? [];
    this._statusEl.textContent = '';
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
          this._app.shell.activateById(cached.id);
          return;
        }
        this._app.shell.activateById(cached.id);
        return;
      }

      // 2. Walk every live terminal widget JL knows about.
      const found = await this._findTerminalForCwd(session.project_path);
      if (found) {
        this._terminalsByPath.set(session.project_path, found);
        this._wireTerminalDisposal(session.project_path, found);
        if (forceDangerous) {
          await this._showCloseExistingDialog();
          this._app.shell.activateById(found.id);
          return;
        }
        this._app.shell.activateById(found.id);
        return;
      }

      // 3. No matching terminal - spawn a new one with `claude --resume <id>`
      // as the pty's only process (no shell). Server-side endpoint calls
      // terminal_manager.create(shell_command=[claude, --resume, sid], cwd=...)
      // and returns the terminal name; we then attach JL's standard widget
      // via terminal:open. When claude exits, the tab closes.
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
      }
    } catch (err) {
      this._showError(err);
    }
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

  /** Apply the resolve-names setting + path-segment disambiguation. */
  private _displayName(s: ISession): string {
    if (!this._resolveNames) {
      return this._basename(s.project_path) || s.encoded_path;
    }
    return s.name || this._basename(s.project_path) || s.encoded_path;
  }

  private _basename(p: string): string {
    if (!p) {
      return '';
    }
    const parts = p.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  /** Walk path tails until every name in a colliding group is unique. */
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
      while (depth <= max) {
        const tails = segs.map(s => s.slice(-depth).join('/'));
        if (new Set(tails).size === tails.length) {
          group.forEach((r, i) => out.set(r.project_path, tails[i]));
          break;
        }
        depth += 1;
      }
      if (!out.has(group[0].project_path)) {
        // Fallback to absolute path
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
          key === 'favourites' ? 'No favourites yet.' : 'Empty.';
        list.appendChild(empty);
      } else {
        for (const item of items) {
          list.appendChild(this._renderRow(item));
        }
      }
      section.appendChild(list);
    }

    this._bodyEl.appendChild(section);
  }

  private _renderRow(session: ISession): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'jp-ClaudeSessionsPanel-row';
    row.title = this._buildRowTooltip(session);

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
    row.appendChild(name);

    if (session.favourite) {
      const star = document.createElement('span');
      star.className = 'jp-ClaudeSessionsPanel-favStar';
      star.title = 'Favourite';
      starFilledIcon.element({ container: star });
      row.appendChild(star);
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
      this._contextMenu.open(e.clientX, e.clientY);
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
    if (s.git_branch) {
      lines.push(`Branch: ${s.git_branch}`);
    }
    if (s.remote_control) {
      lines.push('Remote control: active');
    }
    if (s.first_prompt) {
      const trimmed =
        s.first_prompt.length > 100
          ? `${s.first_prompt.slice(0, 100)}...`
          : s.first_prompt;
      lines.push(`First prompt: ${trimmed}`);
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

  private _formatRelativeTime(epochMs: number): string {
    if (!epochMs) {
      return 'unknown';
    }
    const diff = Date.now() - epochMs;
    if (diff < 60_000) {
      return 'just now';
    }
    if (diff < 3_600_000) {
      return `${Math.floor(diff / 60_000)}m ago`;
    }
    if (diff < 86_400_000) {
      return `${Math.floor(diff / 3_600_000)}h ago`;
    }
    if (diff < 30 * 86_400_000) {
      return `${Math.floor(diff / 86_400_000)}d ago`;
    }
    return new Date(epochMs).toLocaleDateString();
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
          ? 'Remove from Favourites'
          : 'Add to Favourites',
      execute: () => {
        if (this._activeSession) {
          void this._toggleFavourite(this._activeSession);
        }
      }
    });

    this._commands.addCommand('claude-code-sessions:resume', {
      label: 'Resume in Terminal',
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

    this._commands.addCommand('claude-code-sessions:remove', {
      label: 'Remove from Claude',
      icon: removeIcon,
      execute: () => {
        if (this._activeSession) {
          void this._remove(this._activeSession);
        }
      }
    });

    this._contextMenu = new Menu({ commands: this._commands });
    this._contextMenu.addClass('jp-ClaudeSessionsContextMenu');
    this._contextMenu.addItem({ command: 'claude-code-sessions:resume' });
    this._contextMenu.addItem({
      command: 'claude-code-sessions:resume-dangerous'
    });
    this._contextMenu.addItem({
      command: 'claude-code-sessions:toggle-favourite'
    });
    this._contextMenu.addItem({ type: 'separator' });
    this._contextMenu.addItem({ command: 'claude-code-sessions:remove' });

    this._contextMenu.aboutToClose.connect(() => {
      // Only clear the visual highlight - DO NOT null _activeSession.
      // Lumino fires aboutToClose BEFORE the activated item's command runs,
      // so the command callback still needs to read _activeSession. The
      // field is overwritten on the next contextmenu open.
      this._setActiveRow(null);
    });
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
  private _statusEl!: HTMLDivElement;
  private _refreshBtn: HTMLButtonElement | null = null;
  private _sessions: ISession[] | null = null;
  private _expanded: Record<SectionKey, boolean> = loadExpanded();
  private _commands!: CommandRegistry;
  private _contextMenu!: Menu;
  private _activeSession: ISession | null = null;
  private _activeRowEl: HTMLElement | null = null;
  private _pollHandle: number | null = null;
  private readonly _removingPaths: Set<string> = new Set();
  private readonly _terminalTracker: ITerminalTracker | null;
  private readonly _terminalsByPath: Map<string, any> = new Map();
  private readonly _pendingByPath: Map<string, Promise<void>> = new Map();
  private readonly _rootDir: string;
  private _resolveNames: boolean = true;
  private _recentLimit: number = DEFAULT_RECENT_LIMIT;
  private _dangerouslySkip: boolean = false;
  private _displayNames: Map<string, string> = new Map();
  private _filter: string = '';
}
