#!/usr/bin/env node
// fake-claude-streamjson.js — a FAKE `claude -p` that emits canned stream-json
// lines (SPEC_V05B AC-3/AC-4/AC-5 integration). Used via MMD_AUTODEV_CMD so the
// real claude CLI / network is NEVER hit.
//
// It prints, line-by-line:
//   1. a system/init event carrying the model (default "claude-opus-4-8[1m]" →
//      a 1,000,000-token context window),
//   2. several assistant events with text + a `usage` whose context tokens
//      climb across the 70% handoff threshold (10% → 75% → 80% of 1M),
//   3. a final result event with usage,
// then exits 0. A line of NON-JSON noise is interleaved to prove the monitor
// tolerates it (parseStreamEvent returns null, never throws).
//
// Env overrides (all optional):
//   MMD_FAKE_MODEL   model id for the system event (default claude-opus-4-8[1m])
//   MMD_FAKE_TOKENS  comma list of input_tokens readings (default 100000,750000,800000)
//   MMD_FAKE_EXIT    exit code (default 0)

const model = process.env.MMD_FAKE_MODEL || 'claude-opus-4-8[1m]';
const tokens = (process.env.MMD_FAKE_TOKENS || '100000,750000,800000')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const exitCode = Number(process.env.MMD_FAKE_EXIT || '0');

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

emit({ type: 'system', subtype: 'init', model, cwd: process.cwd() });
// A noise line that is not valid stream-json — the monitor must skip it.
process.stdout.write('not-json: working on it...\n');

tokens.forEach((t, i) => {
  emit({
    type: 'assistant',
    message: {
      model: model.replace(/\[1m\]$/i, ''), // assistant model has NO [1m] suffix
      content: [{ type: 'text', text: `step ${i + 1}: thinking about the dream` }],
      usage: {
        input_tokens: t,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 5,
      },
    },
  });
});

const last = tokens.length > 0 ? tokens[tokens.length - 1] : 0;
emit({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'done',
  usage: {
    input_tokens: last,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 5,
  },
});

process.exitCode = exitCode;
