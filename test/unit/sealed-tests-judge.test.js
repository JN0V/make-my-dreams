// @unit tests for lib/sealed-tests/judge.js — the pure pieces of the LLM-as-judge
// behavioral oracle (v0.4.d, SPEC_V04D AC-1). Asserts buildJudgePrompt's wording
// (grade against WHAT WAS ASKED + the deterministic tagged format) and
// parseJudgeVerdict's closed-set parse + the sacred `uncertain` fallback (it must
// NEVER fabricate `met`, and NEVER throw) — mirroring the 5-Whys parser tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildJudgePrompt,
  parseJudgeVerdict,
  judgeFallback,
  JUDGE_MARKER,
  VERDICT_STATUSES,
} from '../../lib/sealed-tests/judge.js';

// ── buildJudgePrompt ─────────────────────────────────────────────────────────

test('@unit AC-1: buildJudgePrompt grades against WHAT WAS ASKED and dictates the tagged format', () => {
  const dream = 'a counter app with plus and minus buttons';
  const sealedDir = '/tmp/x/.mmd/shared/sealed-tests';
  const p = buildJudgePrompt({ dream, sealedDir });

  // Carries the distinctive marker so the fake-claude can branch on it.
  assert.match(p, new RegExp(JUDGE_MARKER));
  // Grades against the request, not "do the tests pass".
  assert.match(p, /WHAT WAS ASKED/);
  assert.match(p, /not\b.*do the tests pass/i);
  // The dream rides verbatim.
  assert.ok(p.includes(dream));
  // The sealed dir is named as evidence.
  assert.ok(p.includes(sealedDir));
  // It dictates the exact per-AC + OVERALL tagged format.
  assert.match(p, /AC <id>: MET\|NOT-MET\|UNCERTAIN/);
  assert.match(p, /OVERALL: MET\|NOT-MET\|UNCERTAIN/);
  // It does NOT carry the tester/coder marker (would mis-route the fake).
  assert.doesNotMatch(p, /SEALED ORACLE/);
});

test('@unit AC-1: buildJudgePrompt folds in the slice ACs and artifacts summary when given', () => {
  const p = buildJudgePrompt({
    dream: 'd',
    slice: '### AC-7 — the greeting must be friendly',
    sealedDir: '/s',
    artifactsSummary: 'Produced/changed files (1): index.html',
  });
  assert.match(p, /AC-7 — the greeting must be friendly/);
  assert.match(p, /Produced artifacts/);
  assert.match(p, /index\.html/);
});

test('@unit AC-1: buildJudgePrompt throws on a missing dream or sealedDir (programmer error, not runtime)', () => {
  assert.throws(() => buildJudgePrompt({ dream: '', sealedDir: '/s' }), /non-empty dream/);
  assert.throws(() => buildJudgePrompt({ dream: 'd', sealedDir: '' }), /sealedDir/);
});

// ── parseJudgeVerdict — happy paths ──────────────────────────────────────────

test('@unit AC-1: parseJudgeVerdict parses MET verdict with per-AC lines', () => {
  const reply = [
    'AC 1: MET — counter starts at zero',
    'AC 2: MET — the + button increments',
    'OVERALL: MET — every acceptance criterion is satisfied',
  ].join('\n');
  const v = parseJudgeVerdict(reply);
  assert.equal(v.overall, 'met');
  assert.equal(v.verdicts.length, 2);
  assert.deepEqual(v.verdicts[0], { ac: '1', status: 'met', reason: 'counter starts at zero' });
  assert.equal(v.verdicts[1].status, 'met');
});

test('@unit AC-1: parseJudgeVerdict parses NOT-MET (hyphenated tag is not confused with MET)', () => {
  const reply = [
    'AC 1: MET — the canvas renders',
    'AC 2: NOT-MET — there is no Save button anywhere in the UI',
    'OVERALL: NOT-MET — the Save-as-PNG criterion is unmet',
  ].join('\n');
  const v = parseJudgeVerdict(reply);
  assert.equal(v.overall, 'not-met');
  assert.equal(v.verdicts[1].status, 'not-met');
  assert.match(v.verdicts[1].reason, /no Save button/);
});

test('@unit AC-1: parseJudgeVerdict parses UNCERTAIN and tolerates a plain hyphen separator', () => {
  const reply = [
    'AC 1: UNCERTAIN - cannot tell from the evidence whether offline works',
    'OVERALL: UNCERTAIN - insufficient evidence for one criterion',
  ].join('\n');
  const v = parseJudgeVerdict(reply);
  assert.equal(v.overall, 'uncertain');
  assert.equal(v.verdicts[0].status, 'uncertain');
});

test('@unit AC-1: every parsed status is within the closed set', () => {
  const reply = 'AC a: MET — ok\nAC b: NOT-MET — no\nAC c: UNCERTAIN — maybe\nOVERALL: NOT-MET — mixed';
  const v = parseJudgeVerdict(reply);
  for (const item of v.verdicts) assert.ok(VERDICT_STATUSES.includes(item.status));
  assert.ok(VERDICT_STATUSES.includes(v.overall));
});

// ── parseJudgeVerdict — the SACRED fallback (never `met`, never throws) ───────

test('@unit AC-1: unparseable reply → uncertain (sacred fallback, NEVER met)', () => {
  const v = parseJudgeVerdict('I had a good look and it seems fine to me, ship it!');
  assert.equal(v.overall, 'uncertain');
  assert.deepEqual(v.verdicts, []);
  assert.ok(typeof v.reason === 'string' && v.reason.length > 0);
  assert.notEqual(v.overall, 'met');
});

test('@unit AC-1: empty / whitespace / non-string reply → uncertain, never throws', () => {
  for (const bad of ['', '   \n  ', null, undefined, 42, {}]) {
    const v = parseJudgeVerdict(bad);
    assert.equal(v.overall, 'uncertain');
    assert.deepEqual(v.verdicts, []);
  }
});

test('@unit AC-1: per-AC lines present but NO OVERALL line → uncertain (an oracle with no bottom line proves nothing)', () => {
  const v = parseJudgeVerdict('AC 1: MET — looks done\nAC 2: MET — also done');
  assert.equal(v.overall, 'uncertain');
  assert.match(v.reason, /OVERALL/);
});

test('@unit AC-1: a bogus OVERALL status word → uncertain (closed set enforced)', () => {
  const v = parseJudgeVerdict('AC 1: MET — ok\nOVERALL: PROBABLY — vibes');
  assert.equal(v.overall, 'uncertain');
});

test('@unit AC-1: judgeFallback always yields uncertain with a reason', () => {
  const f = judgeFallback('spawn failed: ENOENT');
  assert.equal(f.overall, 'uncertain');
  assert.deepEqual(f.verdicts, []);
  assert.match(f.reason, /ENOENT/);
});
