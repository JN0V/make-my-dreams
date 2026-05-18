// @unit tests for lib/composer/match.js — SPEC_V02E AC-1, AC-3, AC-4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  matchLessons,
  composeLessons,
  composeLessonsSync,
  lessonsFileSha,
  COMPOSER_VERSION,
} from '../../lib/composer/match.js';
import { parseLessons } from '../../lib/composer/parse-lessons.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const LIVE = path.join(REPO_ROOT, 'docs', 'lessons-learned.md');
const FIX_MIN = path.join(REPO_ROOT, 'test', 'fixtures', 'composer-lessons', 'minimal.md');

test('@unit matchLessons: returns [] for empty prompt', () => {
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  assert.deepEqual(matchLessons('', lessons), []);
});

test('@unit matchLessons: matches "alpha" against L-001 keywords', () => {
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  const out = matchLessons('please run alpha tonight', lessons);
  assert.ok(out.length >= 1, 'expected at least one match');
  const l1 = out.find((l) => l.id === 'L-001');
  assert.ok(l1, 'L-001 should match');
  assert.equal(l1.score, 1);
  assert.deepEqual(l1.keywords_hit, ['alpha']);
});

test('@unit matchLessons: case-insensitive matching', () => {
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  const out = matchLessons('please run ALPHA tonight', lessons);
  assert.ok(out.find((l) => l.id === 'L-001'));
});

test('@unit matchLessons: word-boundary respects non-alnum edges', () => {
  // "alpha" must NOT match "alphabet" (boundary).
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  const out = matchLessons('the alphabet is long', lessons);
  // Should NOT match L-001 on "alpha".
  assert.equal(out.find((l) => l.id === 'L-001'), undefined);
});

test('@unit matchLessons: multi-word keyword "git branch -d" matches L-003', () => {
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  const out = matchLessons('careful with git branch -d on this slice', lessons);
  const l3 = out.find((l) => l.id === 'L-003');
  assert.ok(l3, 'L-003 should match on "git branch -d"');
  assert.equal(l3.score, 1);
});

test('@unit matchLessons: milestones are NEVER matched', () => {
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  // L-002 has the same alpha/bravo/gamma keywords as L-001 but is milestone.
  const out = matchLessons('alpha bravo gamma', lessons);
  assert.equal(out.find((l) => l.id === 'L-002'), undefined);
});

test('@unit matchLessons: topN truncates to N', () => {
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  // Match 2 lessons (L-001 has alpha/bravo/gamma, L-005 has alpha/bravo/gamma/delta/epsilon/zeta)
  const out = matchLessons('alpha bravo gamma delta epsilon zeta', lessons, { topN: 1 });
  assert.equal(out.length, 1);
});

test('@unit matchLessons: sorted by score desc, ties broken by id asc', () => {
  const md = readFileSync(FIX_MIN, 'utf8');
  const lessons = parseLessons(md);
  // Both L-001 and L-005 match on alpha+bravo+gamma (3 each).
  // L-005 also matches delta/epsilon/zeta if present.
  // Test the score ordering when scores tie: L-001 should come first by id.
  const out = matchLessons('alpha bravo gamma', lessons);
  const idsByScore = out.map((l) => l.id);
  // L-001 score=3, L-005 score=3 → tie → sorted L-001 first.
  assert.deepEqual(idsByScore, ['L-001', 'L-005']);
});

test('@unit matchLessons: lessons without keywords never match', () => {
  const lessons = [{ id: 'L-999', title: 'no keywords', status: 'active', rule: 'r', keywords: [] }];
  const out = matchLessons('anything', lessons);
  assert.deepEqual(out, []);
});

test('@unit matchLessons: throws TypeError on non-string prompt', () => {
  assert.throws(() => matchLessons(null, []), TypeError);
});

test('@unit lessonsFileSha: stable hash for same content', () => {
  const a = lessonsFileSha('hello');
  const b = lessonsFileSha('hello');
  assert.equal(a, b);
  assert.equal(a.length, 12);
  // Different content yields different hash.
  assert.notEqual(a, lessonsFileSha('world'));
});

test('@unit composeLessons: missing file → no-op with missing:true', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-compose-'));
  try {
    const fakePath = path.join(tmp, 'does-not-exist.md');
    const r = await composeLessons('some prompt', fakePath);
    assert.equal(r.missing, true);
    assert.equal(r.composedPrompt, 'some prompt');
    assert.deepEqual(r.injectedLessons, []);
    assert.equal(r.lessonsFileSha, null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit composeLessons: MMD_COMPOSER_DISABLED=1 short-circuits', async () => {
  const r = await composeLessons('alpha bravo', FIX_MIN, { env: { MMD_COMPOSER_DISABLED: '1' } });
  assert.equal(r.disabled, true);
  assert.equal(r.composedPrompt, 'alpha bravo');
  assert.deepEqual(r.injectedLessons, []);
});

test('@unit composeLessons: composes prompt with active-lessons prefix', async () => {
  const r = await composeLessons('alpha bravo', FIX_MIN);
  assert.ok(r.injectedLessons.length > 0);
  assert.match(r.composedPrompt, /## Active lessons \(auto-injected by composer/);
  assert.match(r.composedPrompt, /### L-001/);
  // Original prompt body is preserved at the END.
  assert.ok(r.composedPrompt.endsWith('alpha bravo'));
});

test('@unit composeLessons: zero matches → composedPrompt === original (byte-identity)', async () => {
  const r = await composeLessons('totally unrelated input zzz xxx yyy', FIX_MIN);
  assert.equal(r.injectedLessons.length, 0);
  assert.equal(r.composedPrompt, 'totally unrelated input zzz xxx yyy');
});

test('@unit composeLessons: deterministic output — same input → byte-identical output', async () => {
  const r1 = await composeLessons('alpha bravo gamma', FIX_MIN);
  const r2 = await composeLessons('alpha bravo gamma', FIX_MIN);
  assert.equal(r1.composedPrompt, r2.composedPrompt);
});

test('@unit composeLessons: sub-100ms on the live 12-active-lesson file', async () => {
  const r = await composeLessons('use git checkout to switch branches', LIVE);
  // Performance budget per SPEC_V02E §5 "Performance: < 100ms total"
  assert.ok(r.elapsedMs < 100, `expected <100ms; got ${r.elapsedMs}ms`);
});

test('@unit composeLessons: live file — "git checkout to switch branches" matches L-003', async () => {
  // DoD §4: mmd lessons match "git checkout to switch branches" returns L-003.
  const r = await composeLessons('git checkout to switch branches', LIVE);
  assert.ok(r.injectedLessons.find((l) => l.id === 'L-003'),
    `expected L-003 in injected; got ${r.injectedLessons.map((l) => l.id).join(',')}`);
});

test('@unit composeLessons: live file — realistic dream strings yield non-zero matches', async () => {
  // F14 (Phase-4 review): canary that the live keyword vocabulary stays
  // in touch with realistic dream phrasings. If this test goes 0-for-N it
  // signals lesson keywords have drifted from how humans actually type
  // (the silent-miss failure mode named in ADR-010's "Negative" section).
  const realisticDreams = [
    'launch auto-dev in the background with nohup',
    'tail -f the claude -p log to monitor progress',
    'careful with git branch -d after a partial merge',
    'rerun this test against the version in package.json',
    'check pgrep for previous claude -p before launching',
  ];
  let totalMatches = 0;
  for (const dream of realisticDreams) {
    const r = await composeLessons(dream, LIVE);
    totalMatches += r.injectedLessons.length;
  }
  // Even one match across N prompts means the canary is alive — zero means
  // the live file has drifted past the test fixture's keyword recognition.
  assert.ok(
    totalMatches >= realisticDreams.length / 2,
    `realistic-dream canary: only ${totalMatches} matches across ${realisticDreams.length} prompts — keyword vocabulary may have drifted`,
  );
});

test('@unit composeLessons: throws TypeError on non-string prompt', async () => {
  await assert.rejects(() => composeLessons(null, FIX_MIN), TypeError);
});

test('@unit composeLessons: throws TypeError on empty lessonsPath', async () => {
  await assert.rejects(() => composeLessons('x', ''), TypeError);
});

test('@unit composeLessonsSync: parity with async composeLessons', () => {
  const r = composeLessonsSync('alpha bravo', FIX_MIN);
  assert.ok(r.injectedLessons.length > 0);
  assert.match(r.composedPrompt, /## Active lessons/);
});

test('@unit composeLessonsSync: missing file → missing:true', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-compose-s-'));
  try {
    const r = composeLessonsSync('x', path.join(tmp, 'no.md'));
    assert.equal(r.missing, true);
    assert.equal(r.composedPrompt, 'x');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit composeLessons: COMPOSER_VERSION constant exported', () => {
  assert.equal(typeof COMPOSER_VERSION, 'string');
  assert.match(COMPOSER_VERSION, /^v0\.2e$/);
});
