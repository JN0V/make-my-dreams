// @unit tests for lib/conductor/five-whys-parser.js — SPEC_V02J AC-2 + §5 risk #1.
//
// The sacred invariant (L-016): the parser NEVER throws and ALWAYS yields a
// result. Malformed / prose-only / bad-enum output → escalate-to-user fallback.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECOMMENDED_ACTIONS,
  isRecommendedAction,
  extractJsonBlock,
  validateParsed,
  fallbackResult,
  parseFiveWhys,
} from '../../lib/conductor/five-whys-parser.js';

const GOOD = (action = 'continue-with-hint') =>
  '```json\n' +
  JSON.stringify({
    root_cause: 'rc',
    recommended_action: action,
    action_hint: 'hint',
    confidence: 0.7,
    evidence: ['a', 'b'],
  }) +
  '\n```';

test('@unit RECOMMENDED_ACTIONS is the exact closed enum', () => {
  assert.deepEqual([...RECOMMENDED_ACTIONS], [
    'continue-with-hint',
    'abandon-approach',
    'escalate-to-user',
    'task-actually-complete',
    'false-positive-stall',
  ]);
});

test('@unit isRecommendedAction', () => {
  for (const a of RECOMMENDED_ACTIONS) assert.equal(isRecommendedAction(a), true);
  assert.equal(isRecommendedAction('bogus'), false);
  assert.equal(isRecommendedAction(null), false);
});

test('@unit extractJsonBlock: fenced json', () => {
  const b = extractJsonBlock('prose\n```json\n{"x":1}\n```\n');
  assert.equal(b, '{"x":1}');
});

test('@unit extractJsonBlock: takes the LAST fenced block', () => {
  const b = extractJsonBlock('```json\n{"first":1}\n```\nmid\n```json\n{"last":2}\n```');
  assert.equal(b, '{"last":2}');
});

test('@unit extractJsonBlock: bare balanced object fallback', () => {
  const b = extractJsonBlock('here it is {"k": {"nested": 1}} done');
  assert.equal(b, '{"k": {"nested": 1}}');
});

test('@unit extractJsonBlock: braces inside strings are not miscounted', () => {
  const b = extractJsonBlock('x {"s": "a } b { c"} y');
  assert.equal(b, '{"s": "a } b { c"}');
});

test('@unit extractJsonBlock: null on empty / no object', () => {
  assert.equal(extractJsonBlock(''), null);
  assert.equal(extractJsonBlock('no braces here'), null);
  assert.equal(extractJsonBlock(null), null);
});

test('@unit validateParsed: accepts well-formed object', () => {
  const v = validateParsed({
    root_cause: 'rc', recommended_action: 'abandon-approach',
    action_hint: 'h', confidence: 0.5, evidence: ['e'],
  });
  assert.equal(v.ok, true);
  assert.equal(v.value.recommended_action, 'abandon-approach');
  assert.equal(v.value.confidence, 0.5);
});

test('@unit validateParsed: clamps confidence to [0,1]', () => {
  assert.equal(validateParsed({ recommended_action: 'continue-with-hint', confidence: 9 }).value.confidence, 1);
  assert.equal(validateParsed({ recommended_action: 'continue-with-hint', confidence: -3 }).value.confidence, 0);
  assert.equal(validateParsed({ recommended_action: 'continue-with-hint', confidence: 'x' }).value.confidence, 0);
});

test('@unit validateParsed: rejects bad enum + non-object', () => {
  assert.equal(validateParsed({ recommended_action: 'nope' }).ok, false);
  assert.equal(validateParsed(null).ok, false);
  assert.equal(validateParsed([]).ok, false);
});

test('@unit fallbackResult is always escalate-to-user, confidence 0', () => {
  const f = fallbackResult('boom');
  assert.equal(f.recommended_action, 'escalate-to-user');
  assert.equal(f.confidence, 0);
  assert.deepEqual(f.evidence, ['boom']);
});

test('@unit parseFiveWhys: happy path for each enum value', () => {
  for (const action of RECOMMENDED_ACTIONS) {
    const r = parseFiveWhys(`why-chain...\n${GOOD(action)}`);
    assert.equal(r.parseOk, true, action);
    assert.equal(r.parsed.recommended_action, action);
  }
});

test('@unit parseFiveWhys: prose-only → fallback escalate (no throw)', () => {
  const r = parseFiveWhys('Mary says it is stuck but no JSON here.');
  assert.equal(r.parseOk, false);
  assert.equal(r.parsed.recommended_action, 'escalate-to-user');
});

test('@unit parseFiveWhys: malformed JSON → fallback (no throw)', () => {
  const r = parseFiveWhys('```json\n{ "root_cause": ');
  assert.equal(r.parseOk, false);
  assert.equal(r.parsed.recommended_action, 'escalate-to-user');
});

test('@unit parseFiveWhys: bad enum → fallback', () => {
  const r = parseFiveWhys('```json\n{"recommended_action":"do-something"}\n```');
  assert.equal(r.parseOk, false);
  assert.equal(r.parsed.recommended_action, 'escalate-to-user');
});

test('@unit parseFiveWhys: never throws on any junk input', () => {
  for (const junk of ['', null, undefined, 123, '```json```', '{}{}{}', '{"a":']) {
    assert.doesNotThrow(() => parseFiveWhys(junk));
  }
});
