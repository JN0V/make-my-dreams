// lib/readme-sync/build-changelog.js — pure builder for README.md's mechanical
// "Changelog" block (SPEC_V03D AC-3).
//
// SRP (universal.md §I.S): turn the project's git tags + their annotation
// subjects into a newest-first markdown changelog. This adds an authoritative
// source the README never had: the **tag annotations** themselves (each `mmd
// ship` writes a one-line release summary into the annotated tag). The git
// runner is INJECTED, so the builder is pure and the AC-3 unit test drives it
// with a fake runGit that never spawns git.
//
// Honesty (universal.md §VI): a lightweight (non-annotated) tag renders an
// explicit `(no annotation)` note rather than fabricating a summary or crashing;
// an empty tag list renders an explicit "no tags yet" line; a failing git call
// renders an explicit `(unavailable: …)` line. We sort by `version:refname`
// descending (newest first) deterministically — git's own semver-ish ordering.

import { gitField } from '../handover/build-state-block.js';

// A single field separator we control. We ask git to emit a literal TAB (%09)
// between the short ref name and the annotation subject, then split on the FIRST
// tab so a subject that itself contains tabs is preserved intact.
const FORMAT = '%(refname:short)%09%(contents:subject)';

/**
 * Build the mechanical Changelog block markdown.
 *
 * @param {{
 *   runGit: (args: string[], cwd: string) => Promise<object>,
 *   repoRoot: string,
 * }} opts
 * @returns {Promise<string>} the markdown block (no surrounding markers/newlines)
 */
export async function buildChangelog(opts) {
  const { runGit, repoRoot } = opts || {};

  const field = await gitField(
    runGit,
    ['for-each-ref', '--sort=-version:refname', `--format=${FORMAT}`, 'refs/tags'],
    repoRoot,
  );

  if (!field.ok) {
    return `_(changelog unavailable: ${field.reason})_`;
  }
  if (field.value.length === 0) {
    return '_No tags yet — the changelog populates as releases are tagged._';
  }

  const lines = field.value.split('\n').filter((l) => l.length > 0).map((line) => {
    const tabIdx = line.indexOf('\t');
    const tag = (tabIdx === -1 ? line : line.slice(0, tabIdx)).trim();
    const subject = tabIdx === -1 ? '' : line.slice(tabIdx + 1).trim();
    // A lightweight tag has no annotation object → empty subject. Be explicit
    // rather than render a blank or invented line (§VI honesty).
    const summary = subject.length > 0 ? subject : '_(no annotation)_';
    return `- **${tag}** — ${summary}`;
  });

  return lines.join('\n');
}
