// @unit tests for the v0.5.b monitor seam in lib/invoke-autodev.js
// (SPEC_V05B AC-3/AC-5): the pure arg builder + the readable-tee consumer.
//
// These exercise the bootstrap-safety invariant (default args carry NO
// --output-format) and the readable re-render (assistant text + periodic
// [monitor] context X% lines, NOT raw JSON) WITHOUT spawning a real process.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAutodevArgs, makeMonitorConsumer } from '../../lib/invoke-autodev.js';

// ── buildAutodevArgs — bootstrap safety (AC-3) ──────────────────────────────

test('@unit buildAutodevArgs: DEFAULT CLI args carry no --output-format (bootstrap-safe)', () => {
  const args = buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd' });
  assert.deepEqual(args, ['-p', '/bmad-adv-auto-dev BODY']);
  assert.ok(!args.includes('--output-format'), 'default path must NOT request stream-json');
  assert.ok(!args.includes('stream-json'));
  assert.ok(!args.includes('--verbose'));
});

test('@unit buildAutodevArgs: monitor CLI args append stream-json + --verbose only', () => {
  const args = buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd', monitor: true });
  assert.deepEqual(args, [
    '-p', '/bmad-adv-auto-dev BODY', '--output-format', 'stream-json', '--verbose',
  ]);
});

test('@unit buildAutodevArgs: model override appends --model only when set (default still byte-for-byte)', () => {
  // No model → byte-for-byte the historical shape (bootstrap-safe).
  assert.deepEqual(
    buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd' }),
    ['-p', '/bmad-adv-auto-dev BODY'],
  );
  // Empty / whitespace model → still no --model (treated as unset).
  assert.deepEqual(
    buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd', model: '  ' }),
    ['-p', '/bmad-adv-auto-dev BODY'],
  );
  // A model → appended as `--model <model>`, before any monitor flags.
  assert.deepEqual(
    buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd', model: 'haiku' }),
    ['-p', '/bmad-adv-auto-dev BODY', '--model', 'haiku'],
  );
  assert.deepEqual(
    buildAutodevArgs({ isClaudeCli: true, prompt: 'BODY', dream: 'd', monitor: true, model: 'haiku' }),
    ['-p', '/bmad-adv-auto-dev BODY', '--model', 'haiku', '--output-format', 'stream-json', '--verbose'],
  );
  // Test-fixture mode ignores the model (args stay [dream]).
  assert.deepEqual(
    buildAutodevArgs({ isClaudeCli: false, prompt: 'BODY', dream: 'd', model: 'haiku' }),
    ['d'],
  );
});

test('@unit buildAutodevArgs: test-fixture mode is [dream] in BOTH default and monitor', () => {
  assert.deepEqual(buildAutodevArgs({ isClaudeCli: false, prompt: 'BODY', dream: 'd' }), ['d']);
  assert.deepEqual(
    buildAutodevArgs({ isClaudeCli: false, prompt: 'BODY', dream: 'd', monitor: true }),
    ['d'],
  );
});

// ── makeMonitorConsumer — readable re-render + running-max onContext (AC-5) ──

function fakeLog() {
  let s = '';
  return { write: (x) => { s += x; }, get: () => s };
}

const SYSTEM = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-4-8[1m]' });
function assistant(text, input) {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text }], usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  });
}

test('@unit makeMonitorConsumer: renders assistant text + [monitor] lines, not raw JSON', () => {
  const log = fakeLog();
  const seen = [];
  const c = makeMonitorConsumer(log, true /* quiet */, (ctx) => seen.push(ctx));
  // Feed lines split across chunks to exercise the line buffer.
  c.onData(`${SYSTEM}\n${assistant('Hello there', 100000)}\n`);
  c.onData(`${assistant('More work', 250000)}\n`);
  c.flush();

  const out = log.get();
  assert.match(out, /Hello there/);
  assert.match(out, /More work/);
  assert.match(out, /\[monitor\] context/);
  // The window is 1M (from the [1m] model); 250000/1_000_000 = 25.0%.
  assert.match(out, /\[monitor\] context 25\.0% \(250000\/1000000\)/);
  // Never echoes the raw JSON envelope.
  assert.ok(!out.includes('"type":"assistant"'), 'raw JSON must not appear in the tee');
});

test('@unit makeMonitorConsumer: onContext fires only on a new running MAX, with the [1m] window', () => {
  const seen = [];
  const c = makeMonitorConsumer(fakeLog(), true, (ctx) => seen.push(ctx));
  c.onData(`${SYSTEM}\n`);
  c.onData(`${assistant('a', 100000)}\n`); // new max → fire
  c.onData(`${assistant('b', 50000)}\n`);  // lower → no fire (running max)
  c.onData(`${assistant('c', 300000)}\n`); // new max → fire
  c.flush();

  assert.equal(seen.length, 2, 'fired once per new running max only');
  assert.equal(seen[0].tokens, 100000);
  assert.equal(seen[1].tokens, 300000);
  assert.equal(seen[1].window, 1_000_000);
  assert.equal(seen[1].estimated, false);
  assert.ok(Math.abs(seen[1].pct - 0.3) < 1e-9);
  assert.equal(seen[1].model, 'claude-opus-4-8[1m]');
});

test('@unit makeMonitorConsumer: unknown/absent model → 200K window flagged estimated', () => {
  const seen = [];
  const c = makeMonitorConsumer(fakeLog(), true, (ctx) => seen.push(ctx));
  // No system event → model stays unknown; window defaults to 200K estimated.
  c.onData(`${assistant('x', 20000)}\n`);
  c.flush();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].window, 200_000);
  assert.equal(seen[0].estimated, true);
  assert.equal(seen[0].model, null);
});
