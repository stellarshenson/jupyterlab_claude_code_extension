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
