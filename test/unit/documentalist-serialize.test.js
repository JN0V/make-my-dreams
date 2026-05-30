// test/unit/documentalist-serialize.test.js — @unit
// SPEC_V02I AC-3 support + §5 "Serialization round-trip safety".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseCounterMeta,
  resolveTargetModule,
  serializeCounterUpdates,
  removeLessonBlock,
} from '../../lib/documentalist/serialize-lessons.js';

const LESSONS_PATH = fileURLToPath(new URL('../../docs/lessons-learned.md', import.meta.url));
const REAL = readFileSync(LESSONS_PATH, 'utf8');

const SAMPLE = `# Lessons

---

## L-001 — first lesson

**Status**: active (1 occurrence)
**Rule**: do the thing.
**To promote if**: 5 reuses validated (counter: 1)
**Keywords for matching**: foo, bar

---

## L-002 — second lesson

**Status**: active
**Rule**: do another thing — promote to testing.md when ready.
**To promote if**: 3 reuses validated (counter: 2) — promote to testing.md
**Keywords for matching**: baz

---
`;

test('@unit serialize: empty update map is byte-identical (round-trip safety, sample)', () => {
  assert.equal(serializeCounterUpdates(SAMPLE, new Map()), SAMPLE);
});

test('@unit serialize: empty update map is byte-identical on the REAL lessons file', () => {
  assert.equal(serializeCounterUpdates(REAL, new Map()), REAL);
});

test('@unit parseCounterMeta extracts counter, threshold, target module', () => {
  const meta = parseCounterMeta(SAMPLE);
  assert.equal(meta.get('L-001').counter, 1);
  assert.equal(meta.get('L-001').promoteIfN, 5);
  assert.equal(meta.get('L-001').status, 'active');
  assert.equal(meta.get('L-001').targetModule, 'ai-coding.md'); // default
  assert.equal(meta.get('L-002').counter, 2);
  assert.equal(meta.get('L-002').promoteIfN, 3);
  assert.equal(meta.get('L-002').targetModule, 'testing.md');
});

test('@unit parseCounterMeta on the REAL file: every active lesson has a counter', () => {
  const meta = parseCounterMeta(REAL);
  // L-001..L-009 are active with counters; L-010/011/013/014 are milestones.
  assert.equal(meta.get('L-001').counter, 1);
  assert.equal(meta.get('L-010').promoteIfN, null); // marker, not counter-tracked
});

test('@unit resolveTargetModule recognizes phrasings, defaults to ai-coding.md', () => {
  assert.equal(resolveTargetModule('**To promote if**: 5 reuses (counter: 1)'), 'ai-coding.md');
  assert.equal(resolveTargetModule('... promote to testing.md as a rule'), 'testing.md');
  assert.equal(resolveTargetModule('... promotion into documentation.md'), 'documentation.md');
  assert.equal(resolveTargetModule('... promote to commit-git.md'), 'commit-git.md');
  assert.equal(resolveTargetModule(null), 'ai-coding.md');
});

test('@unit serializeCounterUpdates rewrites only the targeted counter token', () => {
  const out = serializeCounterUpdates(SAMPLE, new Map([['L-001', 4]]));
  assert.match(out, /## L-001 — first lesson[\s\S]*\(counter: 4\)/);
  // L-002 untouched.
  assert.match(out, /## L-002 — second lesson[\s\S]*\(counter: 2\)/);
  // Only one character region changed: re-applying the inverse restores it.
  assert.equal(serializeCounterUpdates(out, new Map([['L-001', 1]])), SAMPLE);
});

test('@unit removeLessonBlock removes header→first separator, leaves siblings', () => {
  const out = removeLessonBlock(SAMPLE, 'L-001');
  assert.doesNotMatch(out, /## L-001/);
  assert.match(out, /## L-002 — second lesson/);
});

test('@unit removeLessonBlock is a no-op for an unknown id', () => {
  assert.equal(removeLessonBlock(SAMPLE, 'L-999'), SAMPLE);
});
