#!/usr/bin/env node
// fake-claude-enforce.js — a FAKE `claude -p` for the v0.14.b HYBRID ENFORCE
// path (SPEC_V014B AC-3, ADR-053). Stands in for an auto-dev orchestrator that
// IGNORES the cooperative incitation: it crosses the context threshold (so MMD's
// monitor writes the marker), ADVANCES the checkpoint a NEW phase boundary (so
// shouldForceHandoff's "new boundary since spawn" gate passes), then STAYS ALIVE
// — forcing MMD's abort seam to terminate it (Path B). Used via MMD_AUTODEV_CMD
// so the real claude / network is NEVER hit.
//
// Unlike fake-autodev-handoff.sh (which writes the marker ITSELF, simulating the
// cooperative exit), this fake leaves the marker to MMD's REAL monitor — it only
// emits the stream-json that drives the monitor. It counts its invocations and
// drops per-call evidence the test asserts.
//
// Modes (env MMD_FAKE_ENFORCE_MODE — MMD_-prefixed so it survives the subprocess
// env allowlist in buildSubprocessEnv):
//   enforce-then-complete (default) — calls < MMD_FAKE_COMPLETE_AT (default 2)
//                                     enforce-alive (advance + stay alive); the
//                                     MMD_FAKE_COMPLETE_AT-th call COMPLETES
//                                     (phase 4, exit 0). Drives the simple Path B.
//   enforce-to-cap                  — calls <= MMD_MAX_HANDOFFS enforce-alive;
//                                     call == MMD_MAX_HANDOFFS+1 COOPERATIVELY
//                                     stops (marker + incomplete checkpoint, exit
//                                     0) so the cap-final branch triggers; later
//                                     calls COMPLETE. Drives the enforce→cap path.
//   cross-no-advance                — cross the threshold but DO NOT advance the
//                                     checkpoint; sleep briefly then exit 0. MMD
//                                     must NOT enforce (no new boundary) — the
//                                     v0.13.1 no-false-kill guard under enforce.
//   complete-over-threshold         — write the COMPLETE checkpoint (phase 4),
//                                     cross the threshold, then stay alive a beat
//                                     (post-pipeline wrap-up) before exiting 0. MMD
//                                     must NOT enforce a finished run (the F1
//                                     completeness guard) — it would otherwise be
//                                     mis-reported as a failure.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const LOCAL = path.join(process.cwd(), '.mmd', 'local');
const RUNS = path.join(LOCAL, 'runs');
const CHECKPOINT = path.join(LOCAL, 'checkpoint.json');
const MARKER = path.join(LOCAL, 'handoff-request');
mkdirSync(RUNS, { recursive: true });

// Count invocations (one line per call); N = this call's number.
appendFileSync(path.join(RUNS, 'autodev-calls'), 'call\n');
const N = readFileSync(path.join(RUNS, 'autodev-calls'), 'utf8').split('\n').filter((l) => l.trim()).length;
writeFileSync(path.join(RUNS, `autodev-call-${N}`), '');
try {
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: process.cwd() }).toString().trim();
  writeFileSync(path.join(RUNS, `enforce-branch-${N}.txt`), branch);
} catch { /* not a git repo — non-fatal for the test evidence */ }

const mode = process.env.MMD_FAKE_ENFORCE_MODE || 'enforce-then-complete';
const completeAt = Number(process.env.MMD_FAKE_COMPLETE_AT || '2');
const maxHandoffs = Number(process.env.MMD_MAX_HANDOFFS || '3');
const model = process.env.MMD_FAKE_MODEL || 'claude-opus-4-8[1m]';

function readPhase() {
  try {
    const obj = JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
    const n = Number(obj.last_completed_phase ?? obj.lastCompletedPhase);
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}
function writeCheckpoint(phase) {
  writeFileSync(
    CHECKPOINT,
    `{ "last_completed_phase": ${phase}, "spec_frozen": true, "spec_path": ".mmd/shared/slice.md" }\n`,
  );
}
function emit(obj) { process.stdout.write(`${JSON.stringify(obj)}\n`); }
function emitSystem() { emit({ type: 'system', subtype: 'init', model, cwd: process.cwd() }); }
function emitCrossing() {
  // 80% of a 1M window → well over the 0.70 threshold.
  emit({
    type: 'assistant',
    message: {
      model: model.replace(/\[1m\]$/i, ''),
      content: [{ type: 'text', text: `phase ${readPhase()} done; continuing past the incitation` }],
      usage: { input_tokens: 800000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5 },
    },
  });
}
function complete() {
  emitSystem();
  writeCheckpoint(4);
  if (existsSync(MARKER)) { try { writeFileSync(MARKER, ''); } catch { /* noop */ } }
  emit({ type: 'result', subtype: 'success', is_error: false, result: 'done',
    usage: { input_tokens: 800000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5 } });
  process.exit(0);
}
function enforceAlive() {
  emitSystem();
  const next = readPhase() + 1;        // a NEW phase boundary since this spawn
  writeCheckpoint(next);               // write BEFORE the crossing tick so maybeAbort sees it
  emitCrossing();                      // monitor crosses threshold → writes marker + fires the predicate
  setInterval(() => {}, 1000);         // stay alive → MMD must enforce-terminate us
}
function cooperativeStop() {
  // The cap-eligible call: predicate is disabled at the cap, so to trigger the
  // cap-final branch we COOPERATIVELY stop (write the marker + an incomplete
  // checkpoint, exit 0) like the real obeying orchestrator would.
  emitSystem();
  const next = readPhase() + 1;
  writeCheckpoint(next);
  writeFileSync(MARKER, '{ "requested_at": "fake-cap-cooperative-stop" }\n');
  process.exit(0);
}
function completeOverThreshold() {
  // The pipeline FINISHED (checkpoint phase 4) and is now over the threshold,
  // still alive doing post-pipeline wrap-up. MMD must NOT enforce a kill here.
  emitSystem();
  writeCheckpoint(4);
  emitCrossing();
  setTimeout(() => process.exit(0), 600); // wrap-up, then exit on its own
}
function crossNoAdvance() {
  // Cross the threshold but DO NOT advance the checkpoint → no new boundary →
  // MMD must not enforce. Sleep briefly (if MMD wrongly enforced with a small
  // grace it would kill us here), then exit 0 on our own.
  emitSystem();
  emitCrossing();
  setTimeout(() => process.exit(0), 600);
}

if (mode === 'cross-no-advance') {
  crossNoAdvance();
} else if (mode === 'complete-over-threshold') {
  completeOverThreshold();
} else if (mode === 'enforce-to-cap') {
  if (N <= maxHandoffs) enforceAlive();
  else if (N === maxHandoffs + 1) cooperativeStop();
  else complete();
} else { // enforce-then-complete
  if (N < completeAt) enforceAlive();
  else complete();
}
