// @integration tests for SPEC_V02L AC-4: every claude -p spawn site passes
// its specific context to the composer. We assert the recorded
// composer.json `context.subcommand` value per wiring site and confirm the
// `Applies to` filter actually fires (a non-matching-context lesson is
// filtered out).
//
// Sites covered:
//   - lib/invoke-autodev.js        → { subcommand: 'mmd --here', engine }
//   - lib/skills/_common (qa/ship) → { subcommand: 'mmd <skill>' }
//   - lib/conductor/five-whys.js   → { subcommand: 'mmd unblock', phase: 'review' }

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { invokeAutodev } from '../../lib/invoke-autodev.js';
import { invokeClaudeSkill } from '../../lib/skills/_common/invoke-claude.js';
import { runFiveWhys } from '../../lib/conductor/five-whys.js';
import { composerJsonPathFor } from '../../lib/composer/audit.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FAKE_AUTODEV = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-autodev.sh');
const FAKE_SKILL = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-skill.sh');
const FAKE_5WHYS = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-five-whys.sh');

// Two lessons matching keyword "zebra" but applying to different subcommands,
// so the context filter is observable: only the matching-subcommand lesson
// (plus universal) survives.
function seedLessons(dir) {
  const p = path.join(dir, 'docs', 'lessons-learned.md');
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(
    p,
    `# Lessons

## L-900 — here-only

**Status**: active
**Rule**: here rule.
**Applies to**: mmd --here
**Keywords for matching**: zebra

---

## L-901 — qa-only

**Status**: active
**Rule**: qa rule.
**Applies to**: mmd qa
**Keywords for matching**: zebra

---
`,
    'utf8',
  );
  return p;
}

function makeTmp() {
  return mkdtempSync(path.join(tmpdir(), 'mmd-ctx-wiring-'));
}

test('@integration AC-4: invoke-autodev passes { subcommand: "mmd --here" }', async () => {
  const tmp = makeTmp();
  try {
    const lessonsPath = seedLessons(tmp);
    process.env.MMD_AUTODEV_CMD = FAKE_AUTODEV;
    const logPath = path.join(tmp, 'run.log');
    const r = await invokeAutodev({
      demoDir: tmp,
      dream: 'a zebra dream',
      slug: 'a-zebra-dream',
      promptParts: { dream: 'a zebra dream', slug: 'a-zebra-dream', demoDir: tmp },
      logPath,
      timeoutMs: 10000,
      engine: 'standard',
      lessonsPath,
    });
    assert.equal(r.code, 0);
    const audit = JSON.parse(readFileSync(composerJsonPathFor(logPath), 'utf8'));
    assert.equal(audit.context.subcommand, 'mmd --here');
    assert.equal(audit.context.engine, 'standard');
    // Filter fired: L-900 (here) injected, L-901 (qa) filtered out.
    assert.deepEqual(audit.matched.map((m) => m.id), ['L-900']);
    assert.equal(audit.filtered_out_by_context, 1);
  } finally {
    delete process.env.MMD_AUTODEV_CMD;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-4: _common skill layer passes { subcommand: "mmd qa" }', async () => {
  const tmp = makeTmp();
  try {
    seedLessons(tmp);
    const logPath = path.join(tmp, 'qa-run.log');
    const r = await invokeClaudeSkill({
      skillName: 'qa',
      command: FAKE_SKILL,
      prompt: 'please review the zebra',
      env: { ...process.env, PATH: process.env.PATH },
      cwd: tmp,
      logPath,
      timeoutMs: 10000,
      heartbeatIntervalMs: 0,
    });
    assert.equal(r.code, 0);
    const audit = JSON.parse(readFileSync(composerJsonPathFor(logPath), 'utf8'));
    assert.equal(audit.context.subcommand, 'mmd qa');
    // Filter fired: L-901 (qa) injected, L-900 (here) filtered out.
    assert.deepEqual(audit.matched.map((m) => m.id), ['L-901']);
    assert.equal(audit.filtered_out_by_context, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-4: _common skill layer passes { subcommand: "mmd ship" }', async () => {
  const tmp = makeTmp();
  try {
    seedLessons(tmp);
    const logPath = path.join(tmp, 'ship-run.log');
    const r = await invokeClaudeSkill({
      skillName: 'ship',
      command: FAKE_SKILL,
      prompt: 'ship the zebra',
      env: { ...process.env, PATH: process.env.PATH },
      cwd: tmp,
      logPath,
      timeoutMs: 10000,
      heartbeatIntervalMs: 0,
    });
    assert.equal(r.code, 0);
    const audit = JSON.parse(readFileSync(composerJsonPathFor(logPath), 'utf8'));
    assert.equal(audit.context.subcommand, 'mmd ship');
    // Neither L-900 (here) nor L-901 (qa) applies to ship → both filtered out.
    assert.deepEqual(audit.matched.map((m) => m.id), []);
    assert.equal(audit.filtered_out_by_context, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@integration AC-4: five-whys passes { subcommand: "mmd unblock", phase: "review" }', async () => {
  const result = await runFiveWhys({
    context: {
      sliceBranch: 'slice/x',
      signals: ['no-commit'],
      evidence: {},
      dream: 'diagnose the stall',
    },
    repoRoot: REPO_ROOT,
    claudePath: FAKE_5WHYS,
    env: {
      ...process.env,
      MMD_FAKE_5WHYS_ACTION: 'continue-with-hint',
      MMD_COMPOSER_DISABLED: '',
    },
  });
  assert.ok(result.composer, 'composer result present');
  assert.deepEqual(result.composer.context, { subcommand: 'mmd unblock', phase: 'review' });
  // The canonical composer.json sidecar records the same context.
  const sidecar = composerJsonPathFor(result.logPath);
  assert.ok(existsSync(sidecar));
  const audit = JSON.parse(readFileSync(sidecar, 'utf8'));
  assert.equal(audit.context.subcommand, 'mmd unblock');
  assert.equal(audit.context.phase, 'review');
});
