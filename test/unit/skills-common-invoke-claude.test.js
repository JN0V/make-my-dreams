// @unit tests for lib/skills/_common/invoke-claude.js — the shared spawn
// helper extracted in SPEC_V02G AC-1.
//
// Critical coverage targets (per the spec §5 key risks):
//   (a) Race-safe log-stream finish (L-013): the Promise from
//       invokeClaudeSkill MUST NOT resolve before the writeStream's 'finish'
//       event fires. Tested by spawning a fake-claude that emits a known
//       FINAL marker just before exit and asserting the log contains it when
//       the promise resolves.
//   (b) PATH-forcing: $HOME/.bun/bin is prepended idempotently by
//       buildSkillEnv.
//   (c) ENOENT branch → mmdExitCode=4 with templated message.
//   (d) assertSkillInstalled: ok / missing path / type-check errors.
//   (e) buildSkillArgs: shape contract (-p --output-format text <prompt>).
//   (f) skillLogPath: directory + filename shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildSkillEnv,
  buildSkillArgs,
  skillLogPath,
  assertSkillInstalled,
  invokeClaudeSkill,
} from '../../lib/skills/_common/invoke-claude.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FAKE_CLAUDE = path.join(REPO_ROOT, 'test', 'fixtures', 'fake-claude-skill.sh');

// ─── buildSkillEnv ────────────────────────────────────────────────────────

test('@unit buildSkillEnv: PATH starts with $HOME/.bun/bin', () => {
  const env = buildSkillEnv('qa', { PATH: '/usr/bin:/bin', HOME: '/home/u' });
  assert.ok(
    env.PATH.startsWith('/home/u/.bun/bin' + path.delimiter),
    `expected PATH to start with /home/u/.bun/bin:, got: ${env.PATH}`,
  );
});

test('@unit buildSkillEnv: PATH prepend is idempotent', () => {
  const env1 = buildSkillEnv('qa', { PATH: '/usr/bin', HOME: '/home/u' });
  const env2 = buildSkillEnv('qa', { ...env1, HOME: '/home/u' });
  // The bun prefix should not double-up.
  const prefix = '/home/u/.bun/bin' + path.delimiter + '/home/u/.bun/bin';
  assert.ok(!env2.PATH.startsWith(prefix), `idempotency broken: ${env2.PATH}`);
});

test('@unit buildSkillEnv: works when PATH is empty', () => {
  const env = buildSkillEnv('qa', { PATH: '', HOME: '/home/u' });
  assert.equal(env.PATH, '/home/u/.bun/bin');
});

test('@unit buildSkillEnv: honors HOME from parentEnv when env.HOME absent', () => {
  // buildSubprocessEnv returns an allowlisted subset — HOME is in the
  // allowlist so it survives. Defensive check: passing a parentEnv with HOME
  // should propagate.
  const env = buildSkillEnv('qa', { PATH: '/usr/bin', HOME: '/tmp/fake-home' });
  assert.ok(
    env.PATH.startsWith('/tmp/fake-home/.bun/bin' + path.delimiter),
    `expected fake-home in PATH, got: ${env.PATH}`,
  );
});

// ─── buildSkillArgs ──────────────────────────────────────────────────────

test('@unit buildSkillArgs: shape is [-p, --output-format, text, <prompt>]', () => {
  const args = buildSkillArgs('hello world');
  assert.deepEqual(args, ['-p', '--output-format', 'text', 'hello world']);
});

test('@unit buildSkillArgs: throws on empty/non-string prompt', () => {
  assert.throws(() => buildSkillArgs(''), TypeError);
  assert.throws(() => buildSkillArgs(null), TypeError);
  assert.throws(() => buildSkillArgs(123), TypeError);
});

// ─── skillLogPath ────────────────────────────────────────────────────────

test('@unit skillLogPath: includes the skill name in the dir', () => {
  const now = () => new Date('2026-05-18T12:34:56.789Z');
  const p = skillLogPath('/tmp/repo', 'qa', now);
  assert.ok(p.includes('/qa-runs/'), `expected qa-runs in path: ${p}`);
  assert.ok(p.endsWith('.log'));
});

test('@unit skillLogPath: each skill gets its own runs dir', () => {
  const now = () => new Date('2026-05-18T12:34:56.789Z');
  assert.ok(skillLogPath('/tmp/r', 'qa', now).includes('/qa-runs/'));
  assert.ok(skillLogPath('/tmp/r', 'cso', now).includes('/cso-runs/'));
  assert.ok(
    skillLogPath('/tmp/r', 'document-release', now).includes('/document-release-runs/'),
  );
});

test('@unit skillLogPath: throws on bad args', () => {
  assert.throws(() => skillLogPath('', 'qa'), TypeError);
  assert.throws(() => skillLogPath('/tmp', ''), TypeError);
});

// ─── assertSkillInstalled ────────────────────────────────────────────────

test('@unit assertSkillInstalled: ok when file exists', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-skill-assert-'));
  try {
    const skillFile = path.join(tmp, 'SKILL.md');
    // create it
    writeFileSync(skillFile, '# fake skill');
    const r = assertSkillInstalled({ skillName: 'qa', skillPath: skillFile });
    assert.equal(r.ok, true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit assertSkillInstalled: returns exit 4 + helpful message when missing', () => {
  const r = assertSkillInstalled({
    skillName: 'qa',
    skillPath: '/no/such/dir/SKILL.md',
  });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 4);
  assert.match(r.message, /not found/);
  assert.match(r.message, /MMD_GSTACK_SKILLS_DIR/);
});

test('@unit assertSkillInstalled: expands ~/ before existence check', () => {
  // Path starting with ~/ is expanded via expandSkillPath; the result MUST
  // NOT be a literal ~/ on the filesystem check.
  const r = assertSkillInstalled({
    skillName: 'qa',
    skillPath: '~/no/such/path-for-this-test',
  });
  assert.equal(r.ok, false);
  // The error message should mention the expanded absolute path, not '~/'.
  assert.ok(!r.message.includes('~/'), `message should not contain literal ~/ : ${r.message}`);
});

test('@unit assertSkillInstalled: type-checks its inputs', () => {
  assert.throws(() => assertSkillInstalled({ skillName: '', skillPath: '/x' }), TypeError);
  assert.throws(() => assertSkillInstalled({ skillName: 'qa', skillPath: '' }), TypeError);
});

// ─── invokeClaudeSkill (race-fix CRITICAL — L-013) ───────────────────────

test(
  '@unit invokeClaudeSkill: log stream finish race — FINAL-MARKER is in the log when the promise resolves',
  { timeout: 10000 },
  async () => {
    // L-013: the wrapper MUST wait for the writeStream's 'finish' event
    // before resolving its promise. If it resolved on the child's 'exit'
    // event alone, a caller that synchronously reads the log right after
    // `await invokeClaudeSkill(...)` could see a truncated file. The fake
    // emits a known marker right before exiting; the assertion is that
    // marker is ALWAYS in the log when the promise resolves.
    const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-race-'));
    try {
      const logPath = path.join(tmp, 'runs', 'race.log');
      const result = await invokeClaudeSkill({
        skillName: 'qa',
        command: FAKE_CLAUDE,
        prompt: 'A'.repeat(200),
        env: buildSkillEnv('qa', { PATH: '/usr/bin:/bin', HOME: '/tmp', MMD_FAKE_SKILL_DELAY_MS: '50' }),
        cwd: tmp,
        logPath,
        timeoutMs: 5000,
        quiet: true,
        heartbeatIntervalMs: 0,
      });
      assert.equal(result.code, 0);
      assert.ok(existsSync(logPath), 'log file must exist after resolve');
      const log = readFileSync(logPath, 'utf8');
      assert.match(
        log,
        /FINAL-MARKER-BEFORE-EXIT/,
        `race-fix broken: FINAL-MARKER not in log when promise resolved.\nlog content:\n${log}`,
      );
      assert.match(log, /SKILL-OK/, 'final SKILL-OK marker must also be flushed');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
);

test('@unit invokeClaudeSkill: ENOENT branch maps to mmdExitCode=4 with templated msg', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mmd-enoent-'));
  try {
    const logPath = path.join(tmp, 'runs', 'enoent.log');
    let err;
    try {
      await invokeClaudeSkill({
        skillName: 'qa',
        command: '/no/such/binary/anywhere',
        prompt: 'hi',
        env: { PATH: '/usr/bin' },
        cwd: tmp,
        logPath,
        heartbeatIntervalMs: 0,
      });
      throw new Error('should have rejected');
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.equal(err.mmdExitCode, 4);
    assert.match(err.message, /not found on PATH/);
    assert.match(err.message, /MMD_QA_CMD/, 'message should mention the override env var');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('@unit invokeClaudeSkill: required-args type-check', async () => {
  await assert.rejects(
    () => invokeClaudeSkill({}),
    /skillName/,
  );
  await assert.rejects(
    () => invokeClaudeSkill({ skillName: 'qa' }),
    /command/,
  );
  await assert.rejects(
    () => invokeClaudeSkill({ skillName: 'qa', command: 'x' }),
    /env/,
  );
});
