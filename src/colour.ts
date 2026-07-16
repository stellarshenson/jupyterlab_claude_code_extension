// Pure colour resolution for Claude terminal tabs. Kept free of JupyterLab
// imports so it is directly executable under jest - the tint regressed twice
// (DEF-10, DEF-11) behind a green suite that never ran this logic.
import type { ISession } from './types';

// Claude's per-session colour (`/color`, or auto-assigned) maps to a
// jupyterlab_colourful_tab_extension colour id. That extension owns the tab
// CSS and colour vocabulary; we only feed it the colour. Absent or
// unrecognised resolves to null (clear tint).
const CLAUDE_TAB_COLOUR_ID: Record<string, string> = {
  red: 'rose',
  orange: 'peach',
  yellow: 'lemon',
  green: 'mint',
  blue: 'sky',
  purple: 'lavender'
};

export function claudeTabColourId(
  color: string | null | undefined
): string | null {
  return (color && CLAUDE_TAB_COLOUR_ID[color]) || null;
}

/** What a terminal is running, as resolved by the `terminal-cwd` probe. */
export interface ITerminalColourInfo {
  // Conversation the terminal runs, or null when it cannot be read.
  sessionId: string | null;
  // That conversation's OWN colour, read from its own JSONL by the backend.
  color: string | null;
  cwds: string[];
}

/** A terminal takes its OWN conversation's colour. Never resolve colour via
 * the project row: a row carries only the representative conversation, which
 * flips to any newer JSONL (a daemon `--fork-session` writes one), so
 * row-matching cleared every non-representative terminal's tint (DEF-11). cwd
 * fallback only when the conversation is unreadable - longest path wins, so a
 * nested project beats its parent. Null clears. */
export function colourForTerminal(
  info: ITerminalColourInfo,
  sessions: ISession[]
): string | null {
  if (info.sessionId) {
    return info.color ?? null;
  }
  let best: ISession | undefined;
  let bestLen = -1;
  for (const raw of info.cwds) {
    const cwd = raw.replace(/\/+$/, '');
    for (const s of sessions) {
      const p = s.project_path.replace(/\/+$/, '');
      if ((cwd === p || cwd.startsWith(p + '/')) && p.length > bestLen) {
        best = s;
        bestLen = p.length;
      }
    }
  }
  return best ? (best.color ?? null) : null;
}
