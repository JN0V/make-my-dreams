// @unit tests for lib/conductor/stream-parse.js (SPEC_V05B AC-2).
//
// Exercises the pure parsing + context math against the REAL captured
// stream-json sample at test/fixtures/streamjson-sample.txt (deterministic —
// no real claude, no network). The fixture is a `claude -p "say ok"
// --output-format stream-json --verbose` transcript: a system/init event
// (model "claude-opus-4-8[1m]"), an assistant event with usage, and a result
// event with usage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  parseStreamEvent,
  contextWindowFor,
  contextTokens,
  contextPct,
} from '../../lib/conductor/stream-parse.js';

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'streamjson-sample.txt');
const LINES = readFileSync(FIXTURE, 'utf8').split('\n').filter((l) => l.trim().length > 0);

test('@unit parseStreamEvent: extracts the model from the system/init event (with [1m] suffix)', () => {
  const events = LINES.map(parseStreamEvent).filter(Boolean);
  const system = events.find((e) => e.type === 'system');
  assert.ok(system, 'a system event is present in the sample');
  assert.equal(system.model, 'claude-opus-4-8[1m]');
});

test('@unit parseStreamEvent: extracts usage from assistant and result events', () => {
  const events = LINES.map(parseStreamEvent).filter(Boolean);
  const assistant = events.find((e) => e.type === 'assistant');
  const result = events.find((e) => e.type === 'result');
  assert.ok(assistant && assistant.usage, 'assistant event carries usage');
  assert.equal(assistant.usage.input_tokens, 6238);
  assert.equal(assistant.usage.cache_read_input_tokens, 16206);
  assert.equal(assistant.usage.cache_creation_input_tokens, 11213);
  assert.ok(result && result.usage, 'result event carries usage');
});

test('@unit parseStreamEvent: extracts assistant text for the readable tee', () => {
  const events = LINES.map(parseStreamEvent).filter(Boolean);
  const assistant = events.find((e) => e.type === 'assistant');
  assert.equal(assistant.text, 'ok');
});

test('@unit parseStreamEvent: returns null for non-JSON / partial / blank lines, never throws', () => {
  assert.equal(parseStreamEvent('not json at all'), null);
  assert.equal(parseStreamEvent('{"type":"assistant"'), null); // truncated/partial
  assert.equal(parseStreamEvent(''), null);
  assert.equal(parseStreamEvent('   '), null);
  assert.equal(parseStreamEvent(undefined), null);
  assert.equal(parseStreamEvent(null), null);
  assert.equal(parseStreamEvent('42'), null); // JSON but not an object
  assert.equal(parseStreamEvent('[1,2,3]'), null); // array, no type
  assert.equal(parseStreamEvent('{"foo":"bar"}'), null); // object, no type
});

test('@unit contextWindowFor: [1m] suffix → 1_000_000 (not estimated)', () => {
  const w = contextWindowFor('claude-opus-4-8[1m]');
  assert.equal(w.window, 1_000_000);
  assert.equal(w.estimated, false);
});

test('@unit contextWindowFor: known 200K model → 200_000 (not estimated)', () => {
  assert.deepEqual(contextWindowFor('claude-opus-4-8'), { window: 200_000, estimated: false });
  assert.deepEqual(contextWindowFor('claude-sonnet-4-6'), { window: 200_000, estimated: false });
  assert.deepEqual(
    contextWindowFor('claude-haiku-4-5-20251001'),
    { window: 200_000, estimated: false },
  );
});

test('@unit contextWindowFor: unknown / empty model → 200_000 + estimated:true', () => {
  assert.deepEqual(contextWindowFor('some-future-model-x'), { window: 200_000, estimated: true });
  assert.deepEqual(contextWindowFor(''), { window: 200_000, estimated: true });
  assert.deepEqual(contextWindowFor(undefined), { window: 200_000, estimated: true });
  assert.deepEqual(contextWindowFor(null), { window: 200_000, estimated: true });
});

test('@unit contextTokens: sums input + cache_read + cache_creation (missing → 0)', () => {
  // From the real fixture's assistant usage: 6238 + 16206 + 11213.
  const events = LINES.map(parseStreamEvent).filter(Boolean);
  const assistant = events.find((e) => e.type === 'assistant');
  assert.equal(contextTokens(assistant.usage), 6238 + 16206 + 11213);
  // output_tokens is excluded.
  assert.equal(contextTokens({ input_tokens: 100, output_tokens: 9999 }), 100);
  // tolerant of missing / non-numeric fields.
  assert.equal(contextTokens({ cache_read_input_tokens: 5 }), 5);
  assert.equal(contextTokens({}), 0);
  assert.equal(contextTokens(undefined), 0);
  assert.equal(contextTokens({ input_tokens: 'oops' }), 0);
});

test('@unit contextPct: pct = tokens / window against the real sample', () => {
  const events = LINES.map(parseStreamEvent).filter(Boolean);
  const assistant = events.find((e) => e.type === 'assistant');
  const { window } = contextWindowFor('claude-opus-4-8[1m]');
  const { tokens, pct } = contextPct(assistant.usage, window);
  assert.equal(tokens, 33657);
  assert.equal(window, 1_000_000);
  assert.ok(Math.abs(pct - 0.033657) < 1e-9, `pct ${pct}`);
});

test('@unit contextPct: non-positive window → pct 0 (never NaN/Infinity)', () => {
  assert.deepEqual(contextPct({ input_tokens: 10 }, 0), { tokens: 10, pct: 0 });
  assert.deepEqual(contextPct({ input_tokens: 10 }, -5), { tokens: 10, pct: 0 });
});
