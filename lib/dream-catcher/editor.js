// lib/dream-catcher/editor.js — best-effort "$EDITOR on the scope" helper.
//
// SRP (constitution §I.S): owns ONLY the temp-file round-trip that opens the
// current scope in the user's $EDITOR and reads the result back. Kept out of
// cli-driver.js so the driver stays pure over its injected io/elicit (and so the
// driver's unit tests never spawn a real editor — they exercise the single-line
// replacement fallback, which fires whenever $EDITOR is unset).
//
// Best-effort (SPEC_V03B §1, §4 out-of-scope: "a rich in-terminal scope editor"):
// ANY failure — editor missing, non-zero exit, unreadable temp file — returns
// `null` so the caller cleanly degrades to the single-line prompt. Never throws.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Open `initial` in `$EDITOR` via a temp file and return the edited text.
 *
 * Synchronous on purpose: a terminal editor takes over the TTY, so the dialogue
 * must block until the editor exits — exactly what spawnSync with stdio:'inherit'
 * gives us. This runs only when the caller has already confirmed $EDITOR is set
 * AND the process is interactive, so blocking is correct, not a hazard.
 *
 * @param {{editor: string, initial: string}} args
 * @returns {string|null} the edited text, or null on any failure (best-effort).
 */
export function openScopeInEditor({ editor, initial }) {
  if (typeof editor !== 'string' || editor.trim().length === 0) return null;
  let dir = null;
  try {
    dir = mkdtempSync(path.join(tmpdir(), 'mmd-scope-'));
    const file = path.join(dir, 'scope.md');
    writeFileSync(file, typeof initial === 'string' ? initial : '', 'utf8');

    // Split EDITOR into command + args (e.g. "code --wait", "vim"). shell:false
    // (constitution §V/A03) — never interpolate user text into a shell.
    const parts = editor.trim().split(/\s+/);
    const cmd = parts[0];
    const args = [...parts.slice(1), file];
    const result = spawnSync(cmd, args, { stdio: 'inherit' });
    if (result.error || (typeof result.status === 'number' && result.status !== 0)) {
      return null;
    }
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; a leftover temp dir is harmless.
      }
    }
  }
}
