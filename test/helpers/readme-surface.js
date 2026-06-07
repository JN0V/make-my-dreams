// test/helpers/readme-surface.js — the "README documentation surface".
//
// Since v0.21.a the Documentalist (`mmdream document`) condenses the README by
// MOVING surplus sections LOSSLESSLY into linked siblings: the long-form `## Usage`
// → docs/readme-usage.md, the `## History` narrative → docs/readme-history.md, and
// the changelog → CHANGELOG.md (ADR-060). Nothing TRUE is lost — it just lives in a
// linked file now. So a docs-anchor test that asks "does the README document X?"
// must read the README PLUS its extracted siblings (the surface a reader reaches by
// following the README's own "See [Usage](…)" links), not only the condensed
// landing doc. This helper returns that combined surface.
//
// Pure read, never throws on a missing sibling (a repo that has not been condensed
// yet simply has its full content inline in README.md — the siblings are absent and
// contribute nothing, so the helper degrades to "just README.md").

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// The README + every sibling the v0.21.a conciseness MOVE can extract from it.
const SURFACE_FILES = [
  'README.md',
  'docs/readme-usage.md',
  'docs/readme-history.md',
  'CHANGELOG.md',
];

/**
 * The combined README documentation surface (README + its extracted siblings).
 * Missing siblings are skipped (back-compat with an un-condensed README).
 *
 * @param {string} [root] repo root (defaults to the MMD repo root)
 * @returns {string} the concatenated text of every present surface file
 */
export function readReadmeSurface(root = ROOT) {
  const parts = [];
  for (const rel of SURFACE_FILES) {
    try {
      parts.push(readFileSync(path.join(root, rel), 'utf8'));
    } catch {
      // Sibling absent (README not condensed yet) — skip, never throw.
    }
  }
  return parts.join('\n');
}

export { SURFACE_FILES };
