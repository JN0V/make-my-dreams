// @integration test for lib/documentalist/inventory.js against the REAL MMD
// repo (SPEC_V07A AC-1, the "@integration — real inventory on MMD non-empty"
// half). Wires the actual node:fs + git tag list the subcommand uses and
// asserts the inventory is non-empty and internally consistent — without
// pinning brittle exact counts (those drift every slice; we assert structure +
// presence of known anchors instead).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gatherInventory } from '../../lib/documentalist/inventory.js';
import { parseLessons } from '../../lib/composer/parse-lessons.js';
import { SUBCOMMANDS } from '../../lib/argv-parser.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function realInventory() {
  return gatherInventory({
    readFile: (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8'),
    readDir: (rel) => readdirSync(path.join(REPO_ROOT, rel)),
    listTags: () => {
      try {
        return execFileSync('git', ['tag', '--list'], {
          cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000,
        }).split('\n').map((s) => s.trim()).filter(Boolean);
      } catch {
        return [];
      }
    },
    parseLessons,
    subcommands: [...SUBCOMMANDS],
  });
}

test('@integration inventory: real MMD repo yields a non-empty, consistent surface', () => {
  const inv = realInventory();

  // Subcommands include the document-* family.
  assert.ok(inv.subcommands.includes('discover'));
  assert.ok(inv.subcommands.includes('document-readme'));

  // ADRs: a healthy number, each with a number, ADR-001 present with its title.
  assert.ok(inv.adrs.length >= 30, `expected >= 30 ADRs, got ${inv.adrs.length}`);
  const adr1 = inv.adrs.find((a) => a.number === 1);
  assert.ok(adr1, 'ADR-001 should be present');
  assert.match(adr1.title, /gstack/i);

  // lib modules include known anchors.
  for (const m of ['documentalist', 'conductor', 'discover', 'dream-catcher']) {
    assert.ok(inv.libModules.includes(m), `lib module ${m} missing`);
  }

  // SPEC sprawl is real (many root SPEC files).
  assert.ok(inv.specCount >= 20, `expected SPEC sprawl >= 20, got ${inv.specCount}`);

  // Active lessons counted via the real parser.
  assert.ok(typeof inv.lessonCount === 'number' && inv.lessonCount > 0);

  // MAKE_MY_DREAMS.md is over the 200-line cap (the headline doc-health smell).
  const mmd = inv.docLineCounts.find((d) => d.doc === 'MAKE_MY_DREAMS.md');
  assert.ok(mmd, 'MAKE_MY_DREAMS.md should be among the key docs');
  assert.equal(mmd.overCap, true);
  assert.ok(mmd.lines > 200);

  // Tags present and within the known range.
  assert.ok(inv.tags.length > 0);
  assert.ok(inv.tags.some((t) => /^v0\./.test(t)));
});
