// @unit tests for lib/sealed-tests/manifest.js — the SEAL of the sealed-test
// oracle (SPEC_V04A AC-2). Pure logic over injected fs: build / verify /
// tamper / removed / added, plus the never-throw-on-missing-dir contract.
// Per testing.md §V: no real fs, no subprocess, < 100 ms.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildManifest,
  verifyManifest,
  sealIntact,
  sha256,
} from '../../lib/sealed-tests/manifest.js';

// An in-memory sealed dir: { relPath: content }. The fakes below close over it.
function makeFakeFs(files) {
  const readdirFn = () => Object.keys(files);
  const readFileFn = (_dir, rel) => {
    if (!(rel in files)) {
      const e = new Error(`ENOENT: ${rel}`);
      e.code = 'ENOENT';
      throw e;
    }
    return files[rel];
  };
  return { readdirFn, readFileFn };
}

test('@unit sha256: deterministic, 64-char hex, distinguishes content', () => {
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
  assert.match(sha256('abc'), /^[0-9a-f]{64}$/);
  // null/undefined never throw — hash the empty string.
  assert.equal(sha256(undefined), sha256(''));
});

test('@unit buildManifest: hashes each file, keys deterministic (sorted)', () => {
  const { readdirFn, readFileFn } = makeFakeFs({
    'b.test.js': 'expect(b).toBe(1)',
    'a.test.js': 'expect(a).toBe(1)',
  });
  const m = buildManifest('/sealed', readdirFn, readFileFn);
  assert.deepEqual(Object.keys(m), ['a.test.js', 'b.test.js']); // sorted
  assert.equal(m['a.test.js'], sha256('expect(a).toBe(1)'));
  assert.equal(m['b.test.js'], sha256('expect(b).toBe(1)'));
});

test('@unit buildManifest: NEVER throws on a missing dir → empty manifest', () => {
  const readdirThrows = () => {
    const e = new Error('ENOENT: no such dir');
    e.code = 'ENOENT';
    throw e;
  };
  const m = buildManifest('/gone', readdirThrows, () => '');
  assert.deepEqual(m, {});
});

test('@unit verifyManifest: identical state → all lists empty (intact)', () => {
  const files = { 'a.test.js': 'A', 'b.test.js': 'B' };
  const { readdirFn, readFileFn } = makeFakeFs(files);
  const sealed = buildManifest('/s', readdirFn, readFileFn);

  const verdict = verifyManifest('/s', sealed, readdirFn, readFileFn);
  assert.deepEqual(verdict, { tampered: [], removed: [], added: [] });
  assert.equal(sealIntact(verdict), true);
});

test('@unit verifyManifest: a changed file → tampered (the P-04 failure)', () => {
  const before = makeFakeFs({ 'a.test.js': 'A', 'b.test.js': 'B' });
  const sealed = buildManifest('/s', before.readdirFn, before.readFileFn);

  // Coder weakened a.test.js but left b.test.js intact.
  const after = makeFakeFs({ 'a.test.js': 'A // gutted', 'b.test.js': 'B' });
  const verdict = verifyManifest('/s', sealed, after.readdirFn, after.readFileFn);
  assert.deepEqual(verdict.tampered, ['a.test.js']);
  assert.deepEqual(verdict.removed, []);
  assert.deepEqual(verdict.added, []);
  assert.equal(sealIntact(verdict), false);
});

test('@unit verifyManifest: a deleted file → removed (also breaks the seal)', () => {
  const before = makeFakeFs({ 'a.test.js': 'A', 'b.test.js': 'B' });
  const sealed = buildManifest('/s', before.readdirFn, before.readFileFn);

  const after = makeFakeFs({ 'a.test.js': 'A' }); // b.test.js gone
  const verdict = verifyManifest('/s', sealed, after.readdirFn, after.readFileFn);
  assert.deepEqual(verdict.removed, ['b.test.js']);
  assert.deepEqual(verdict.tampered, []);
  assert.deepEqual(verdict.added, []);
  assert.equal(sealIntact(verdict), false);
});

test('@unit verifyManifest: a new file → added (does NOT break the seal)', () => {
  const before = makeFakeFs({ 'a.test.js': 'A' });
  const sealed = buildManifest('/s', before.readdirFn, before.readFileFn);

  // Coder added its own helper test alongside the untouched oracle.
  const after = makeFakeFs({ 'a.test.js': 'A', 'coder-extra.test.js': 'X' });
  const verdict = verifyManifest('/s', sealed, after.readdirFn, after.readFileFn);
  assert.deepEqual(verdict.added, ['coder-extra.test.js']);
  assert.deepEqual(verdict.tampered, []);
  assert.deepEqual(verdict.removed, []);
  // added-only is still intact: only tamper/remove of sealed files is forbidden.
  assert.equal(sealIntact(verdict), true);
});

test('@unit verifyManifest: vanished dir → every sealed file reported removed, no throw', () => {
  const before = makeFakeFs({ 'a.test.js': 'A', 'b.test.js': 'B' });
  const sealed = buildManifest('/s', before.readdirFn, before.readFileFn);

  const readdirThrows = () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; };
  const verdict = verifyManifest('/s', sealed, readdirThrows, () => '');
  assert.deepEqual(verdict.removed, ['a.test.js', 'b.test.js']);
  assert.equal(sealIntact(verdict), false);
});

test('@unit verifyManifest: null manifest → every current file is added, no throw', () => {
  const after = makeFakeFs({ 'a.test.js': 'A' });
  const verdict = verifyManifest('/s', null, after.readdirFn, after.readFileFn);
  assert.deepEqual(verdict.added, ['a.test.js']);
  assert.deepEqual(verdict.tampered, []);
  assert.deepEqual(verdict.removed, []);
});
