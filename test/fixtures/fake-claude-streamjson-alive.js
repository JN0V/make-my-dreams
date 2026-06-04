#!/usr/bin/env node
// fake-claude-streamjson-alive.js — a FAKE `claude -p` for the v0.14.b abort
// seam (SPEC_V014B AC-1, ADR-053). Like fake-claude-streamjson.js it emits canned
// stream-json whose context tokens climb across the 70% threshold, but it can
// then STAY ALIVE so MMD's abort seam has something to terminate (Path B), or
// EXIT on its own (the cooperative / never-fires control). Used via
// MMD_AUTODEV_CMD so the real claude CLI / network is NEVER hit.
//
// Env overrides (all optional):
//   MMD_FAKE_MODEL    model id for the system event (default claude-opus-4-8[1m])
//   MMD_FAKE_TOKENS   comma list of input_tokens readings (default 100000,750000,800000)
//   MMD_FAKE_ALIVE    "1" → after emitting the ticks, stay alive indefinitely
//                     (until SIGTERM/SIGKILL from MMD's enforce). Default: emit
//                     a final result event and exit 0 (the agent finished first).
//   MMD_FAKE_EXIT     exit code when NOT staying alive (default 0)
//   MMD_FAKE_GRANDCHILD_PIDFILE  when set, fork a child (in THIS process group,
//                     mimicking auto-dev's nested `claude -p`) that writes its PID
//                     here and sleeps. Lets a test prove MMD kills the whole GROUP
//                     (no orphan), not just the leader.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const model = process.env.MMD_FAKE_MODEL || 'claude-opus-4-8[1m]';
const tokens = (process.env.MMD_FAKE_TOKENS || '100000,750000,800000')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const stayAlive = process.env.MMD_FAKE_ALIVE === '1';
const exitCode = Number(process.env.MMD_FAKE_EXIT || '0');

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

emit({ type: 'system', subtype: 'init', model, cwd: process.cwd() });

tokens.forEach((t, i) => {
  emit({
    type: 'assistant',
    message: {
      model: model.replace(/\[1m\]$/i, ''),
      content: [{ type: 'text', text: `step ${i + 1}: working` }],
      usage: {
        input_tokens: t,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 5,
      },
    },
  });
});

if (stayAlive) {
  // Optionally fork a nested child IN THIS PROCESS GROUP (no `detached`), the way
  // auto-dev's orchestrator spawns its own `claude -p` sub-agents. A group
  // SIGTERM from MMD must reach it too — that is the "no orphan" guarantee.
  const pidFile = process.env.MMD_FAKE_GRANDCHILD_PIDFILE;
  if (pidFile) {
    const grandchild = spawn(
      process.execPath,
      ['-e', `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{}, 1000);`],
      { stdio: 'ignore' },
    );
    grandchild.unref();
  }
  // Keep the event loop alive so MMD's enforce path can terminate us. NO SIGTERM
  // handler → the default action (terminate) still applies, so a group SIGTERM
  // from MMD kills us cleanly.
  setInterval(() => {}, 1000);
} else {
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
}
