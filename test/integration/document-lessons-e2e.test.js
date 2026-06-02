// test/integration/document-lessons-e2e.test.js — @integration
// SPEC_V090 AC-2/AC-3/AC-4: end-to-end `mmd document-lessons` over fixture
// composer audits + run outcomes + a fixture lessons file. Spawns the real CLI.
//
// The counter now rises on VALIDATED REUSES (a lesson injected into a `done`
// run, per-run deduped, idempotent), NOT raw injections (ADR-010's wrong
// signal); promotion at threshold is gated by an injected judge (the
// MMD_PROMOTE_GATE_CMD seam) — only `validated` promotes, everything else holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MMD = fileURLToPath(new URL('../../bin/mmd.js', import.meta.url));

/**
 * Build a fixture repo. `runs` is an array of { runId, inject:[lessonId], state }.
 * Each run writes <runId>.composer.json (injected ids) + <runId>.outcome.json
 * (the run's final state — the join key for validated reuse). A run with
 * state:null writes NO outcome.json (missing-state).
 */
function setupRepo({ counter = 1, promoteIfN = 5, runs } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'mmd-doclessons-'));
  const runsDir = path.join(root, '.mmd', 'local', 'runs');
  mkdirSync(runsDir, { recursive: true });
  mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true });
  mkdirSync(path.join(root, '.specify', 'memory', 'constitution'), { recursive: true });
  writeFileSync(
    path.join(root, '.specify', 'memory', 'constitution', 'testing.md'),
    `# Testing\n\n---\n\n*Version: 1.0.0*\n`,
    'utf8',
  );
  const lessonsPath = path.join(root, 'docs', 'lessons-learned.md');
  writeFileSync(
    lessonsPath,
    `# Lessons\n\n---\n\n## L-900 — fixture lesson\n\n**Status**: active\n` +
      `**Rule**: fixture rule body.\n` +
      `**To promote if**: ${promoteIfN} reuses validated (counter: ${counter}) — promote to testing.md\n` +
      `**Keywords for matching**: fixture\n\n---\n`,
    'utf8',
  );
  const effectiveRuns = runs || [{ runId: 'r1', inject: ['L-900'], state: 'done' }];
  for (const rdef of effectiveRuns) {
    writeFileSync(
      path.join(runsDir, `${rdef.runId}.composer.json`),
      JSON.stringify({
        composer_version: 'v0.2e',
        run_id: rdef.runId,
        matched: (rdef.inject || []).map((id) => ({ id, score: 1 })),
      }),
      'utf8',
    );
    if (rdef.state !== null && rdef.state !== undefined) {
      writeFileSync(
        path.join(runsDir, `${rdef.runId}.outcome.json`),
        JSON.stringify({ run_id: rdef.runId, state: rdef.state, ts: '2026-06-02T00:00:00Z' }),
        'utf8',
      );
    }
  }
  return { root, lessonsPath };
}

/** Write an executable fake gate that echoes $MMD_FAKE_GATE_OUTPUT verbatim. */
function writeFakeGate(root) {
  const p = path.join(root, 'fake-gate.sh');
  writeFileSync(p, `#!/usr/bin/env bash\nprintf '%s\\n' "$MMD_FAKE_GATE_OUTPUT"\n`, 'utf8');
  chmodSync(p, 0o755);
  return p;
}

function run(root, args, env = {}) {
  return spawnSync(process.execPath, [MMD, 'document-lessons', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('@integration --help prints usage with flags + exit codes, exit 0', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mmd-doclessons-help-'));
  const r = run(root, ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--dry-run/);
  assert.match(r.stdout, /--since/);
  assert.match(r.stdout, /MMD_PROMOTE_GATE_CMD/);
  assert.match(r.stdout, /5 {2}no composer\.json found/);
  assert.match(r.stdout, /MODIFIES docs\/lessons-learned\.md/);
});

test('@integration exit 5 when no composer audits exist', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mmd-doclessons-empty-'));
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'lessons-learned.md'), '# Lessons\n', 'utf8');
  const r = run(root, [], { MMD_LESSONS_FILE: path.join(root, 'docs', 'lessons-learned.md') });
  assert.equal(r.status, 5);
});

test('@integration AC-4 output labels raw injections AND validated reuses distinctly', () => {
  const { root, lessonsPath } = setupRepo({ counter: 1, promoteIfN: 5 });
  const r = run(root, ['--dry-run'], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Raw injections.*1 across 1 lesson/);
  assert.match(r.stdout, /Validated reuses.*1 across 1 lesson/);
});

test('@integration AC-2 --dry-run shows the validated-reuse delta, modifies nothing', () => {
  const { root, lessonsPath } = setupRepo({ counter: 1, promoteIfN: 5 });
  const before = readFileSync(lessonsPath, 'utf8');
  const r = run(root, ['--dry-run'], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /would increment 1 counter/);
  assert.match(r.stdout, /L-900: \+1 \(validated reuses 1/);
  assert.equal(readFileSync(lessonsPath, 'utf8'), before, 'lessons file unchanged');
});

test('@integration AC-2 real run increments the counter by a validated reuse', () => {
  const { root, lessonsPath } = setupRepo({ counter: 1, promoteIfN: 5 });
  const r = run(root, [], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r.status, 0);
  assert.match(readFileSync(lessonsPath, 'utf8'), /\(counter: 2\)/);
});

test('@integration AC-2 a FAILED run does NOT increment the counter', () => {
  const { root, lessonsPath } = setupRepo({
    counter: 1,
    promoteIfN: 5,
    runs: [{ runId: 'r1', inject: ['L-900'], state: 'failed' }],
  });
  const r = run(root, [], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r.status, 0);
  assert.match(readFileSync(lessonsPath, 'utf8'), /\(counter: 1\)/); // unchanged
});

test('@integration AC-2 a MISSING-state run (no outcome.json) does NOT increment', () => {
  const { root, lessonsPath } = setupRepo({
    counter: 1,
    promoteIfN: 5,
    runs: [{ runId: 'r1', inject: ['L-900'], state: null }],
  });
  const r = run(root, [], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r.status, 0);
  assert.match(readFileSync(lessonsPath, 'utf8'), /\(counter: 1\)/); // unchanged
});

test('@integration AC-2 IDEMPOTENT: re-running does not re-count an already-credited run', () => {
  const { root, lessonsPath } = setupRepo({ counter: 1, promoteIfN: 5 });
  const r1 = run(root, [], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r1.status, 0);
  assert.match(readFileSync(lessonsPath, 'utf8'), /\(counter: 2\)/);
  // Second run with NO new audits → the one run is already credited → no change.
  const r2 = run(root, [], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r2.status, 0);
  assert.match(readFileSync(lessonsPath, 'utf8'), /\(counter: 2\)/); // still 2, not 3
  assert.match(r2.stdout, /will increment 0 counter/);
});

test('@integration AC-3 gate VALIDATED promotes at threshold (module + removal + ADR)', () => {
  const { root, lessonsPath } = setupRepo({ counter: 4, promoteIfN: 5 });
  const gate = writeFakeGate(root);
  const r = run(root, [], {
    MMD_LESSONS_FILE: lessonsPath,
    MMD_PROMOTE_GATE_CMD: gate,
    MMD_FAKE_GATE_OUTPUT: 'VERDICT: VALIDATED — the rule was applied',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /promoted L-900 → testing\.md/);
  assert.doesNotMatch(readFileSync(lessonsPath, 'utf8'), /## L-900/);
  const mod = readFileSync(path.join(root, '.specify', 'memory', 'constitution', 'testing.md'), 'utf8');
  assert.match(mod, /### L-900 — fixture lesson/);
  const adr = readdirSync(path.join(root, 'docs', 'adr')).find((f) => /lesson-L-900-promoted\.md$/.test(f));
  assert.ok(adr, 'promotion ADR created');
});

test('@integration AC-3 gate UNCERTAIN HOLDS at threshold (no promotion, counter preserved)', () => {
  const { root, lessonsPath } = setupRepo({ counter: 4, promoteIfN: 5 });
  const gate = writeFakeGate(root);
  const r = run(root, [], {
    MMD_LESSONS_FILE: lessonsPath,
    MMD_PROMOTE_GATE_CMD: gate,
    MMD_FAKE_GATE_OUTPUT: 'VERDICT: UNCERTAIN — not enough evidence',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /held L-900 — gate uncertain/);
  const lessons = readFileSync(lessonsPath, 'utf8');
  assert.match(lessons, /## L-900/); // still present
  assert.match(lessons, /\(counter: 5\)/); // counter preserved at threshold
  const mod = readFileSync(path.join(root, '.specify', 'memory', 'constitution', 'testing.md'), 'utf8');
  assert.doesNotMatch(mod, /L-900/); // NOT promoted into the constitution
});

test('@integration AC-3 an UNPARSEABLE gate reply HOLDS (sacred fallback)', () => {
  const { root, lessonsPath } = setupRepo({ counter: 4, promoteIfN: 5 });
  const gate = writeFakeGate(root);
  const r = run(root, [], {
    MMD_LESSONS_FILE: lessonsPath,
    MMD_PROMOTE_GATE_CMD: gate,
    MMD_FAKE_GATE_OUTPUT: 'I really think you should promote this one!',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /held L-900 — gate uncertain/);
  assert.match(readFileSync(lessonsPath, 'utf8'), /## L-900/); // still present
});

test('@integration AC-3 gate ABSENT HOLDS honestly (no MMD_PROMOTE_GATE_CMD)', () => {
  const { root, lessonsPath } = setupRepo({ counter: 4, promoteIfN: 5 });
  const r = run(root, [], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /held L-900 — gate uncertain.*unavailable/);
  assert.match(readFileSync(lessonsPath, 'utf8'), /## L-900/);
});

test('@integration AC-3 operator workflow: held-at-threshold (no gate) then re-run WITH gate promotes', () => {
  // Run 1: counter 4 → 5 on the one done run, gate absent → HOLD at threshold.
  const { root, lessonsPath } = setupRepo({ counter: 4, promoteIfN: 5 });
  const r1 = run(root, [], { MMD_LESSONS_FILE: lessonsPath });
  assert.equal(r1.status, 0);
  assert.match(r1.stdout, /held L-900/);
  assert.match(readFileSync(lessonsPath, 'utf8'), /\(counter: 5\)/); // persisted at threshold
  // Run 2: NO new validated reuse (the one run is already credited), but the
  // gate is now available and validates → it must promote without a new reuse.
  const gate = writeFakeGate(root);
  const r2 = run(root, [], {
    MMD_LESSONS_FILE: lessonsPath,
    MMD_PROMOTE_GATE_CMD: gate,
    MMD_FAKE_GATE_OUTPUT: 'VERDICT: VALIDATED — proven on review',
  });
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /promoted L-900 → testing\.md/);
  assert.doesNotMatch(readFileSync(lessonsPath, 'utf8'), /## L-900/);
});
