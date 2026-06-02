// test/unit/autolearn-promote-gate.test.js — @unit
// SPEC_V090 AC-3: the LLM promotion-validation gate parser + prompt builder.
//
// The gate is the conservative oracle that runs BEFORE a lesson is promoted into
// the constitution (an irreversible-ish, rule-changing act). Mirrors the v0.4.d
// judge: pure parser, the sacred fallback (unparseable → uncertain, NEVER a
// fabricated `validated`), never throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePromoteGateVerdict,
  buildPromoteGatePrompt,
  gateFallback,
  GATE_VERDICTS,
  PROMOTE_GATE_MARKER,
} from '../../lib/autolearn/promote-gate.js';

test('@unit VERDICT: VALIDATED → validated', () => {
  const r = parsePromoteGateVerdict('VERDICT: VALIDATED — the rule was applied in every run');
  assert.equal(r.verdict, 'validated');
  assert.match(r.reason, /applied/);
});

test('@unit VERDICT: NOT-VALIDATED → not-validated (hyphenated token wins)', () => {
  const r = parsePromoteGateVerdict('VERDICT: NOT-VALIDATED — no evidence the rule mattered');
  assert.equal(r.verdict, 'not-validated');
});

test('@unit VERDICT: UNCERTAIN → uncertain', () => {
  const r = parsePromoteGateVerdict('VERDICT: UNCERTAIN — insufficient evidence');
  assert.equal(r.verdict, 'uncertain');
});

test('@unit case-insensitive + tolerant of separators', () => {
  assert.equal(parsePromoteGateVerdict('verdict: validated').verdict, 'validated');
  assert.equal(parsePromoteGateVerdict('VERDICT : Not-Validated - x').verdict, 'not-validated');
});

test('@unit empty / whitespace reply → uncertain (sacred fallback)', () => {
  assert.equal(parsePromoteGateVerdict('').verdict, 'uncertain');
  assert.equal(parsePromoteGateVerdict('   \n  ').verdict, 'uncertain');
});

test('@unit unparseable reply (no VERDICT line) → uncertain, NEVER validated', () => {
  const r = parsePromoteGateVerdict('I think this lesson is great and should be promoted!');
  assert.equal(r.verdict, 'uncertain');
  assert.notEqual(r.verdict, 'validated');
  assert.match(r.reason, /VERDICT/i);
});

test('@unit garbage verdict token → uncertain', () => {
  assert.equal(parsePromoteGateVerdict('VERDICT: MAYBE — dunno').verdict, 'uncertain');
});

test('@unit non-string input → uncertain, never throws', () => {
  assert.doesNotThrow(() => parsePromoteGateVerdict(null));
  assert.doesNotThrow(() => parsePromoteGateVerdict(undefined));
  assert.doesNotThrow(() => parsePromoteGateVerdict(42));
  assert.equal(parsePromoteGateVerdict(null).verdict, 'uncertain');
});

test('@unit last VERDICT line wins (an example earlier in prose does not)', () => {
  const reply = [
    'For example a reply might say VERDICT: VALIDATED.',
    'But after analysis:',
    'VERDICT: NOT-VALIDATED — the rule never fired in these runs',
  ].join('\n');
  assert.equal(parsePromoteGateVerdict(reply).verdict, 'not-validated');
});

test('@unit gateFallback always returns uncertain with a reason', () => {
  const f = gateFallback('boom');
  assert.equal(f.verdict, 'uncertain');
  assert.equal(f.reason, 'boom');
});

test('@unit GATE_VERDICTS is the frozen closed set', () => {
  assert.deepEqual(GATE_VERDICTS, ['validated', 'not-validated', 'uncertain']);
  assert.throws(() => { GATE_VERDICTS.push('x'); });
});

test('@unit buildPromoteGatePrompt carries the marker, the rule, the runs, and the output contract', () => {
  const prompt = buildPromoteGatePrompt({
    lesson: { id: 'L-019', title: 'commit incrementally', rule: 'Commit per AC.' },
    reusingRuns: ['r1', 'r2', 'r3'],
  });
  assert.match(prompt, new RegExp(PROMOTE_GATE_MARKER));
  assert.match(prompt, /L-019/);
  assert.match(prompt, /commit incrementally/);
  assert.match(prompt, /Commit per AC\./);
  assert.match(prompt, /r1/);
  assert.match(prompt, /3/); // the count of reusing runs is surfaced
  assert.match(prompt, /VERDICT\s*:/);
  assert.match(prompt, /VALIDATED/);
  assert.match(prompt, /NOT-VALIDATED/);
  assert.match(prompt, /UNCERTAIN/);
});

test('@unit buildPromoteGatePrompt requires a lesson with an id', () => {
  assert.throws(() => buildPromoteGatePrompt({ lesson: null }));
  assert.throws(() => buildPromoteGatePrompt({ lesson: {} }));
});

test('@unit buildPromoteGatePrompt tolerates zero reusing runs', () => {
  const prompt = buildPromoteGatePrompt({ lesson: { id: 'L-001', rule: 'x' }, reusingRuns: [] });
  assert.match(prompt, /L-001/);
});
