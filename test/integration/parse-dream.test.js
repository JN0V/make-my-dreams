// Tests for lib/parse-dream.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { slugify, initStateFiles, nextAvailableSlug, STOPWORDS } from '../../lib/parse-dream.js';

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-parse-'));
}

test('slugify strips stopwords from the fil-rouge dream', () => {
  const s = slugify('a drawing app that overlays an image on the camera feed');
  assert.equal(s, 'drawing-app-overlays-image-camera-feed');
});

test('slugify produces deterministic slug for the test dream', () => {
  assert.equal(slugify('a tiny test app that shows hello world'), 'tiny-test-app-shows-hello-world');
});

test('slugify normalizes whitespace, case, punctuation', () => {
  assert.equal(slugify('  Hello, WORLD!! '), 'hello-world');
});

test('slugify on empty input throws TypeError', () => {
  assert.throws(() => slugify(''), /empty|dream/i);
});

test('slugify truncates >300-char input to ≤64 chars', () => {
  const long = 'word '.repeat(80);
  const s = slugify(long);
  assert.ok(s.length <= 64, `slug length ${s.length} should be ≤ 64`);
});

test('slugify defuses path traversal input', () => {
  const s = slugify('../../etc/passwd');
  assert.equal(s, 'etc-passwd');
  assert.ok(!s.includes('/'));
  assert.ok(!s.includes('..'));
});

test('slugify on emoji-only throws TypeError', () => {
  assert.throws(() => slugify('🚀🌟'), TypeError);
});

test('slugify on CJK-only throws TypeError', () => {
  assert.throws(() => slugify('日本語'), TypeError);
});

test('slugify on mixed CJK + ASCII keeps ASCII', () => {
  assert.equal(slugify('hello 日本 world'), 'hello-world');
});

test('slugify flattens French diacritics to ASCII', () => {
  assert.equal(slugify('Café littéraire'), 'cafe-litteraire');
});

test('STOPWORDS is exported and contains common articles', () => {
  assert.ok(STOPWORDS.includes('a'));
  assert.ok(STOPWORDS.includes('the'));
  assert.ok(STOPWORDS.includes('that'));
});

test('initStateFiles writes vision.md + slice.md and ensures dirs, but NOT status.json', async () => {
  const tmp = makeTmp();
  try {
    const demoDir = path.join(tmp, 'demo', 'tiny-test-app-shows-hello-world');
    // Caller is required to ensureLayout first per spec §4.6.2; mirror that.
    const { ensureLayout } = await import('../../lib/state.js');
    await ensureLayout(demoDir);
    await initStateFiles(demoDir, 'a tiny test app that shows hello world', 'tiny-test-app-shows-hello-world');
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'shared', 'vision.md')), 'vision.md missing');
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'shared', 'slice.md')), 'slice.md missing');
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'shared')));
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'local', 'runs')));
    assert.equal(existsSync(path.join(demoDir, '.mmd', 'shared', 'status.json')), false,
      'status.json must be lazy — initStateFiles must NOT pre-write it');
    const vision = readFileSync(path.join(demoDir, '.mmd', 'shared', 'vision.md'), 'utf8');
    assert.match(vision, /a tiny test app that shows hello world/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('nextAvailableSlug probes -2, -3, ... and returns first ENOENT', async () => {
  const tmp = makeTmp();
  try {
    const demoRoot = path.join(tmp, 'demo');
    mkdirSync(path.join(demoRoot, 'foo'), { recursive: true });
    mkdirSync(path.join(demoRoot, 'foo-2'), { recursive: true });
    const next = await nextAvailableSlug('foo', demoRoot);
    assert.equal(next, 'foo-3');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
