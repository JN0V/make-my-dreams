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
//
// Distinguishing annotated from lightweight matters: `%(contents:subject)` on a
// LIGHTWEIGHT tag falls back to the *pointed commit's* subject (not empty), which
// would silently masquerade as an annotation. So we ALSO read `%(objecttype)` —
// it is `tag` for an annotated tag (a real tag object with a message) and
// `commit` for a lightweight one — and only treat the subject as an annotation
// when the ref is a genuine tag object.

import { gitField } from '../handover/build-state-block.js';

// Three TAB-separated (%09) fields we control: short ref name, the ref's object
// type, and the annotation subject. We split on the first two tabs so a subject
// that itself contains tabs is preserved intact.
const FORMAT = '%(refname:short)%09%(objecttype)%09%(contents:subject)';

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
    // Split into exactly three fields on the first two tabs; the subject (which
    // may itself contain tabs) is everything after the second tab.
    const firstTab = line.indexOf('\t');
    const secondTab = firstTab === -1 ? -1 : line.indexOf('\t', firstTab + 1);
    const tag = (firstTab === -1 ? line : line.slice(0, firstTab)).trim();
    const objectType = firstTab === -1 || secondTab === -1
      ? ''
      : line.slice(firstTab + 1, secondTab).trim();
    const subject = secondTab === -1 ? '' : line.slice(secondTab + 1).trim();
    // Only a genuine annotated tag (objecttype === 'tag') with a non-empty
    // subject is a real annotation. A lightweight tag (objecttype === 'commit')
    // is explicitly marked rather than borrowing the commit's subject (§VI).
    const annotated = objectType === 'tag' && subject.length > 0;
    const summary = annotated ? subject : '_(no annotation)_';
    return `- **${tag}** — ${summary}`;
  });

  return lines.join('\n');
}
