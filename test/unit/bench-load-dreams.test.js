// test/unit/bench-load-dreams.test.js
// @unit — schema validation + happy path on the real bench/dreams corpus.
//
// Per SPEC_V02B AC-2: tag @unit for the schema parser. The integration test
// covers "load all 5 dreams cleanly".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseDreamFile, loadDreams } from '../../lib/bench/load-dreams.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const BENCH_DREAMS = path.join(REPO_ROOT, 'bench', 'dreams');

function makeTmpDreams() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-dreams-'));
  return dir;
}

const VALID_FRONTMATTER = `---
id: sample-dream
audience: kid
complexity: simple
dream: "do a thing"
reality_check_min_assertions: 2
---

# body ignored
`;

test('@unit parseDreamFile: happy path returns typed object', () => {
  const d = parseDreamFile(VALID_FRONTMATTER, 'sample-dream');
  assert.equal(d.id, 'sample-dream');
  assert.equal(d.audience, 'kid');
  assert.equal(d.complexity, 'simple');
  assert.equal(d.dream, 'do a thing');
  assert.equal(d.reality_check_min_assertions, 2);
});

test('@unit parseDreamFile: rejects missing front-matter', () => {
  assert.throws(
    () => parseDreamFile('no front matter here', 'x'),
    /missing front-matter/,
  );
});

test('@unit parseDreamFile: rejects unterminated front-matter', () => {
  assert.throws(
    () => parseDreamFile('---\nid: x\n', 'x'),
    /not closed/,
  );
});

test('@unit parseDreamFile: rejects basename mismatch (L-007 generalization)', () => {
  // Drives the same invariant as L-007: never trust an in-file id; verify it
  // against an external source of truth (here, the filename).
  assert.throws(
    () => parseDreamFile(VALID_FRONTMATTER, 'a-different-basename'),
    /must equal basename/,
  );
});

test('@unit parseDreamFile: rejects unknown audience', () => {
  const raw = VALID_FRONTMATTER.replace('audience: kid', 'audience: grandparent');
  assert.throws(
    () => parseDreamFile(raw, 'sample-dream'),
    /audience must be one of/,
  );
});

test('@unit parseDreamFile: rejects unknown complexity', () => {
  const raw = VALID_FRONTMATTER.replace('complexity: simple', 'complexity: hard');
  assert.throws(
    () => parseDreamFile(raw, 'sample-dream'),
    /complexity must be one of/,
  );
});

test('@unit parseDreamFile: rejects non-integer reality_check_min_assertions', () => {
  const raw = VALID_FRONTMATTER.replace(
    'reality_check_min_assertions: 2',
    'reality_check_min_assertions: zero',
  );
  assert.throws(
    () => parseDreamFile(raw, 'sample-dream'),
    /reality_check_min_assertions must be an integer/,
  );
});

test('@unit parseDreamFile: rejects negative reality_check_min_assertions', () => {
  const raw = VALID_FRONTMATTER.replace(
    'reality_check_min_assertions: 2',
    'reality_check_min_assertions: 0',
  );
  assert.throws(
    () => parseDreamFile(raw, 'sample-dream'),
    /reality_check_min_assertions must be an integer/,
  );
});

test('@unit parseDreamFile: rejects missing required key', () => {
  const raw = VALID_FRONTMATTER.replace('dream: "do a thing"\n', '');
  assert.throws(
    () => parseDreamFile(raw, 'sample-dream'),
    /missing required front-matter key 'dream'/,
  );
});

test('@unit loadDreams: real bench/dreams/ corpus has exactly 5 dreams (AC-2)', async () => {
  const ds = await loadDreams({ dreamsDir: BENCH_DREAMS });
  assert.equal(ds.length, 5);
  const ids = ds.map((d) => d.id);
  // L-005 / L-007 — ids are the SAME source as the spec; we read them from
  // the corpus rather than hardcoding magic strings. We still assert exact
  // membership of the AC-2 canonical set to guard against rename drift.
  assert.deepEqual(
    ids.sort(),
    [
      'kid-01-drawing-camera-overlay',
      'kid-02-drum-pads',
      'kid-03-story-dice',
      'pro-01-csv-viewer',
      'pro-02-markdown-preview',
    ].sort(),
  );
});

test('@unit loadDreams: --dreams filter returns only matching ids', async () => {
  const ds = await loadDreams({
    dreamsDir: BENCH_DREAMS,
    ids: ['kid-01-drawing-camera-overlay', 'pro-01-csv-viewer'],
  });
  assert.equal(ds.length, 2);
  assert.equal(ds[0].id, 'kid-01-drawing-camera-overlay');
  assert.equal(ds[1].id, 'pro-01-csv-viewer');
});

test('@unit loadDreams: filter with unknown id throws (security: never silently skip)', async () => {
  await assert.rejects(
    () => loadDreams({ dreamsDir: BENCH_DREAMS, ids: ['nonexistent'] }),
    /requested ids not found/,
  );
});

test('@unit loadDreams: SCHEMA.md is ignored, not parsed', async () => {
  const tmp = makeTmpDreams();
  try {
    writeFileSync(
      path.join(tmp, 'SCHEMA.md'),
      '# this is not a dream file and should be ignored',
    );
    writeFileSync(path.join(tmp, 'real-dream.md'), VALID_FRONTMATTER.replace(
      'id: sample-dream',
      'id: real-dream',
    ));
    const ds = await loadDreams({ dreamsDir: tmp });
    assert.equal(ds.length, 1);
    assert.equal(ds[0].id, 'real-dream');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit loadDreams: rejects when dreamsDir is missing', async () => {
  await assert.rejects(
    () => loadDreams({ dreamsDir: '/does/not/exist/anywhere' }),
    /cannot read/,
  );
});
