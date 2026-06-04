// lib/documentalist/ux-text-surface.js — the Documentalist's "UX-text surface"
// builder (SPEC_V018A AC-2).
//
// SRP (universal.md §I.S): ONE job — collect the USER-FACING text strings that
// live OUTSIDE the markdown truth docs, so the conformance checks (dangling refs,
// deprecated-surface, version-pinned promises) reach the places a stale claim
// actually hides. Today that is:
//   1. shell scripts' printf/echo output (install-mmd.sh + siblings) — exactly
//      where the stale `/bmad-adv-auto-dev` "try this" recommendation lived.
//   2. the CLI --help / USAGE text (from bin/mmd.js).
// Returns `{path, text}` pairs (the shape the conformance checks consume).
//
// DETERMINISTIC + PURE-ish (SPEC §4): the only I/O is the injected `readFile`
// (and an optional `execSync` seam for a live --help). No claude, no guessing —
// the surface is exactly computable. NEVER THROWS (error-handling §III): an
// unreadable file / odd input degrades to "skip that source", never a crash.
//
// PRECISION-FIRST (SPEC §5.3): we extract the QUOTED string content of a
// printf/echo (the text a user actually sees), not the raw shell line — so shell
// syntax (`${NC}`, `%s`, redirections) doesn't masquerade as a doc claim.

// A `printf "..."` / `echo "..."` (or single-quoted) statement. We capture the
// FIRST quoted argument's content — the format/echo string the user sees. Bash
// `printf`/`echo` may carry flags (`echo -e`) before the string; the lazy
// `[^"']*?` skips them. Both quote styles are handled by two passes.
const PRINTF_ECHO_DQ = /\b(?:printf|echo)\b[^"\n]*"([^"]*)"/g;
const PRINTF_ECHO_SQ = /\b(?:printf|echo)\b[^'\n]*'([^']*)'/g;

/**
 * Extract the user-visible text of a shell script's printf/echo calls, one line
 * per emitted string (line-numbered to the SOURCE line so a finding points back
 * at the real location). Pure, never throws.
 *
 * @param {string} scriptText the full shell-script text
 * @returns {string} a newline-joined block of the emitted strings, positioned at
 *   their original line numbers (blank lines fill the gaps so line N of the
 *   output corresponds to line N of the script — conformance reports the right
 *   :line).
 */
export function extractShellUxText(scriptText) {
  if (typeof scriptText !== 'string' || scriptText.length === 0) return '';
  const srcLines = scriptText.split('\n');
  const out = new Array(srcLines.length).fill('');
  for (let i = 0; i < srcLines.length; i += 1) {
    const line = srcLines[i];
    const pieces = [];
    for (const re of [PRINTF_ECHO_DQ, PRINTF_ECHO_SQ]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        if (typeof m[1] === 'string' && m[1].length > 0) pieces.push(m[1]);
      }
    }
    if (pieces.length > 0) out[i] = pieces.join(' ');
  }
  return out.join('\n');
}

// The USAGE block in bin/mmd.js is a `const USAGE = \`...\`;` template literal.
// We extract its content statically (deterministic, no subprocess) so a stale
// recommendation in the --help text is reachable by the conformance checks.
const USAGE_TEMPLATE = /const\s+USAGE\s*=\s*`([\s\S]*?)`/;

/**
 * Extract the CLI --help / USAGE text from bin/mmd.js, statically (no subprocess).
 * Returns the template-literal content, or '' when not found. Pure, never throws.
 *
 * @param {string} binText the full bin/mmd.js text
 * @returns {string}
 */
export function extractUsageText(binText) {
  if (typeof binText !== 'string') return '';
  const m = USAGE_TEMPLATE.exec(binText);
  return m && typeof m[1] === 'string' ? m[1] : '';
}

/**
 * Build the UX-text surface (AC-2): the user-facing strings beyond markdown —
 * shell-script printf/echo output + the CLI --help/USAGE text. Each entry is a
 * `{path, text}` pair the conformance checks consume.
 *
 * DETERMINISTIC + NEVER THROWS: each source degrades independently (an unreadable
 * script / bin is simply skipped — honest, never a fabricated entry). The
 * `execSync` seam is accepted for forward-compat (a future live `--help`) but is
 * NOT used by default — the USAGE text is read statically from bin/mmd.js so the
 * scan stays subprocess-free and reproducible.
 *
 * @param {{
 *   repoRoot?: string,
 *   readFile: (relPath: string) => string,     // injected reader (throws on absent → caught)
 *   scripts?: string[],                         // shell scripts to scan (default install-mmd.sh + install.sh)
 *   binPath?: string,                           // the CLI entry (default bin/mmd.js)
 *   execSync?: function,                        // optional live-help seam (unused by default)
 * }} args
 * @returns {Array<{ path: string, text: string }>}
 */
export function buildUxTextSurface(args) {
  const a = args && typeof args === 'object' ? args : {};
  const readFile = typeof a.readFile === 'function' ? a.readFile : null;
  if (!readFile) return []; // no reader → nothing to scan (honest, never throws).

  const scripts = Array.isArray(a.scripts) ? a.scripts : ['install-mmd.sh', 'install.sh'];
  const binPath = typeof a.binPath === 'string' ? a.binPath : 'bin/mmd.js';

  const surface = [];

  for (const script of scripts) {
    let raw;
    try {
      raw = readFile(script);
    } catch {
      continue; // absent/unreadable → skip
    }
    const text = extractShellUxText(raw);
    if (text.trim().length > 0) surface.push({ path: script, text });
  }

  let binRaw;
  try {
    binRaw = readFile(binPath);
  } catch {
    binRaw = null;
  }
  if (typeof binRaw === 'string') {
    const usage = extractUsageText(binRaw);
    if (usage.trim().length > 0) surface.push({ path: `${binPath} --help`, text: usage });
  }

  return surface;
}
