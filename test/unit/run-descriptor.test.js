// @unit tests for lib/greenfield/run-descriptor.js (SPEC_V010A AC-3).
//
// readRunDescriptor + isWebPreviewable are PURE and must NEVER throw: a valid
// descriptor parses to {kind, entry, run}; missing / malformed / non-object →
// null (reader) / false (previewable). isWebPreviewable is true for a
// web-static kind with a real entry file, true for a bare index.html when no
// descriptor exists (back-compat), false otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readRunDescriptor, isWebPreviewable } from '../../lib/greenfield/run-descriptor.js';

/** Make a throwaway demoDir; optionally write run.json + arbitrary files. */
function makeDemo({ descriptor, files } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-rundesc-'));
  if (descriptor !== undefined) {
    mkdirSync(path.join(dir, '.mmd', 'shared'), { recursive: true });
    const body = typeof descriptor === 'string' ? descriptor : JSON.stringify(descriptor);
    writeFileSync(path.join(dir, '.mmd', 'shared', 'run.json'), body, 'utf8');
  }
  for (const [rel, content] of Object.entries(files || {})) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

const demos = [];
function demo(opts) { const d = makeDemo(opts); demos.push(d); return d; }
test.after(() => { for (const d of demos) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } });

// ── readRunDescriptor ────────────────────────────────────────────────────────

test('@unit AC-3: a valid descriptor parses to {kind, entry, run}', () => {
  const dir = demo({ descriptor: { kind: 'web-static', entry: 'index.html', run: 'open index.html' } });
  assert.deepEqual(readRunDescriptor(dir), {
    kind: 'web-static', entry: 'index.html', run: 'open index.html',
  });
});

test('@unit AC-3: a cli descriptor parses, entry may be absent', () => {
  const dir = demo({ descriptor: { kind: 'cli', run: 'node rename.js ./photos' } });
  assert.deepEqual(readRunDescriptor(dir), {
    kind: 'cli', entry: undefined, run: 'node rename.js ./photos',
  });
});

test('@unit AC-3: a missing run.json → null (the common case, no throw)', () => {
  const dir = demo({ files: { 'index.html': '<html></html>' } }); // no descriptor written
  assert.equal(readRunDescriptor(dir), null);
});

test('@unit AC-3: malformed JSON → null, never throws', () => {
  const dir = demo({ descriptor: '{ this is not json' });
  assert.doesNotThrow(() => readRunDescriptor(dir));
  assert.equal(readRunDescriptor(dir), null);
});

test('@unit AC-3: a non-object JSON (array / string / number) → null', () => {
  assert.equal(readRunDescriptor(demo({ descriptor: '[1,2,3]' })), null);
  assert.equal(readRunDescriptor(demo({ descriptor: '"just a string"' })), null);
  assert.equal(readRunDescriptor(demo({ descriptor: '42' })), null);
  assert.equal(readRunDescriptor(demo({ descriptor: 'null' })), null);
});

test('@unit AC-3: an object with no usable kind → null (treated as malformed)', () => {
  assert.equal(readRunDescriptor(demo({ descriptor: { entry: 'index.html' } })), null);
  assert.equal(readRunDescriptor(demo({ descriptor: { kind: '' } })), null);
  assert.equal(readRunDescriptor(demo({ descriptor: { kind: 123 } })), null);
});

test('@unit AC-3: a non-string / empty demoDir → null, never throws', () => {
  assert.equal(readRunDescriptor(undefined), null);
  assert.equal(readRunDescriptor(''), null);
  assert.equal(readRunDescriptor(42), null);
});

// ── isWebPreviewable ─────────────────────────────────────────────────────────

test('@unit AC-3: web-static descriptor with a real entry file → true', () => {
  const dir = demo({
    descriptor: { kind: 'web-static', entry: 'index.html' },
    files: { 'index.html': '<html></html>' },
  });
  assert.equal(isWebPreviewable(readRunDescriptor(dir), dir), true);
});

test('@unit AC-3: web-static descriptor whose entry file is MISSING → false', () => {
  const dir = demo({ descriptor: { kind: 'web-static', entry: 'index.html' } }); // no file
  assert.equal(isWebPreviewable(readRunDescriptor(dir), dir), false);
});

test('@unit AC-3: web-static with a nested entry that exists → true', () => {
  const dir = demo({
    descriptor: { kind: 'web-static', entry: 'public/index.html' },
    files: { 'public/index.html': '<html></html>' },
  });
  assert.equal(isWebPreviewable(readRunDescriptor(dir), dir), true);
});

test('@unit AC-3: a non-web kind (cli) → false even if index.html happens to exist', () => {
  const dir = demo({
    descriptor: { kind: 'cli', run: 'node x.js' },
    files: { 'index.html': '<html></html>' },
  });
  // descriptor present + non-web kind → honestly NOT previewable (no silent
  // fall-through to the bare-index.html guess).
  assert.equal(isWebPreviewable(readRunDescriptor(dir), dir), false);
});

test('@unit AC-3: back-compat — NO descriptor + bare index.html → true', () => {
  const dir = demo({ files: { 'index.html': '<html></html>' } });
  assert.equal(readRunDescriptor(dir), null);
  assert.equal(isWebPreviewable(null, dir), true);
});

test('@unit AC-3: NO descriptor + NO index.html → false', () => {
  const dir = demo({ files: { 'README.md': '# hi' } });
  assert.equal(isWebPreviewable(null, dir), false);
});

test('@unit AC-3: isWebPreviewable never throws on junk inputs', () => {
  assert.doesNotThrow(() => isWebPreviewable(undefined, undefined));
  assert.equal(isWebPreviewable(undefined, undefined), false);
  assert.equal(isWebPreviewable({ kind: 'web-static', entry: 'x' }, ''), false);
  assert.equal(isWebPreviewable('not-an-object', '/tmp'), false);
});
