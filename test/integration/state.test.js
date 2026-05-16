// Tests for lib/state.js
// CRITICAL: never let a test invoke the real claude CLI. See SPEC §4.4.1 + F1 recursion-guard rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, statSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

import {
  ensureLayout,
  readStatus,
  writeStatus,
  appendDecision,
  ensureGitignore,
} from '../../lib/state.js';

function makeTmp(prefix = 'mmd-state-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test('ensureLayout creates .mmd/shared/, .mmd/local/runs/, .mmd/local/reality-checks/ idempotently', async () => {
  const tmp = makeTmp();
  try {
    const demoDir = path.join(tmp, 'demo', 'foo');
    await ensureLayout(demoDir);
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'shared')));
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'local', 'runs')));
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'local', 'reality-checks')));
    // idempotent
    await ensureLayout(demoDir);
    assert.ok(existsSync(path.join(demoDir, '.mmd', 'shared')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('readStatus on a fresh demoDir returns null', async () => {
  const tmp = makeTmp();
  try {
    const demoDir = path.join(tmp, 'demo', 'foo');
    await ensureLayout(demoDir);
    const status = await readStatus(demoDir);
    assert.equal(status, null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('writeStatus then readStatus round-trips the object', async () => {
  const tmp = makeTmp();
  try {
    const demoDir = path.join(tmp, 'demo', 'foo');
    await ensureLayout(demoDir);
    const payload = {
      slice_id: 'foo',
      dream: 'a foo dream',
      state: 'in_progress',
      created_at: '2026-05-16T10:00:00.000Z',
      updated_at: '2026-05-16T10:00:00.000Z',
      tasks: [{ id: 'auto-dev', state: 'in_progress' }],
    };
    await writeStatus(demoDir, payload);
    const back = await readStatus(demoDir);
    assert.equal(back.slice_id, 'foo');
    assert.equal(back.state, 'in_progress');
    assert.equal(back.dream, 'a foo dream');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('writeStatus appends a decision line on state transition', async () => {
  const tmp = makeTmp();
  try {
    const demoDir = path.join(tmp, 'demo', 'foo');
    await ensureLayout(demoDir);
    await writeStatus(demoDir, {
      slice_id: 'foo',
      dream: 'd',
      state: 'in_progress',
      created_at: '2026-05-16T10:00:00.000Z',
      updated_at: '2026-05-16T10:00:00.000Z',
      tasks: [{ id: 'auto-dev', state: 'in_progress' }],
    });
    await writeStatus(demoDir, {
      slice_id: 'foo',
      dream: 'd',
      state: 'done',
      created_at: '2026-05-16T10:00:00.000Z',
      updated_at: '2026-05-16T10:01:00.000Z',
      tasks: [{ id: 'auto-dev', state: 'done' }],
    });
    const log = readFileSync(path.join(demoDir, '.mmd', 'shared', 'decisions.log'), 'utf8');
    const lines = log.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /\(initial\) -> in_progress/);
    assert.match(lines[1], /in_progress -> done/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('appendDecision writes a single line atomically to decisions.log', async () => {
  const tmp = makeTmp();
  try {
    const demoDir = path.join(tmp, 'demo', 'foo');
    await ensureLayout(demoDir);
    await appendDecision(demoDir, 'foo', '(initial)', 'in_progress', 'first run');
    const log = readFileSync(path.join(demoDir, '.mmd', 'shared', 'decisions.log'), 'utf8');
    assert.match(log, /foo \(initial\) -> in_progress \[reason: first run\]/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('ensureGitignore is a no-op when there is no .git/ and no .gitignore (outside-git case)', async () => {
  const tmp = makeTmp();
  try {
    await ensureGitignore(tmp);
    // no file should have been created
    assert.equal(existsSync(path.join(tmp, '.gitignore')), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('ensureGitignore adds .mmd/local/ section to an existing .gitignore', async () => {
  const tmp = makeTmp();
  try {
    writeFileSync(path.join(tmp, '.gitignore'), 'node_modules/\n');
    await ensureGitignore(tmp);
    const content = readFileSync(path.join(tmp, '.gitignore'), 'utf8');
    assert.match(content, /\.mmd\/local\//);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('ensureGitignore is a no-op when .mmd/local/ is already present', async () => {
  const tmp = makeTmp();
  try {
    const initial = 'node_modules/\n.mmd/local/\n';
    writeFileSync(path.join(tmp, '.gitignore'), initial);
    await ensureGitignore(tmp);
    assert.equal(readFileSync(path.join(tmp, '.gitignore'), 'utf8'), initial);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('ensureGitignore creates .gitignore when only .git/ exists', async () => {
  const tmp = makeTmp();
  try {
    mkdirSync(path.join(tmp, '.git'));
    await ensureGitignore(tmp);
    const content = readFileSync(path.join(tmp, '.gitignore'), 'utf8');
    assert.match(content, /\.mmd\/local\//);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('readStatus rejects on corrupt JSON by renaming and warning (no silent failure)', async () => {
  const tmp = makeTmp();
  try {
    const demoDir = path.join(tmp, 'demo', 'foo');
    await ensureLayout(demoDir);
    const statusPath = path.join(demoDir, '.mmd', 'shared', 'status.json');
    writeFileSync(statusPath, '{not valid json');
    const result = await readStatus(demoDir);
    assert.equal(result, null);
    // corrupt file is preserved with a rename
    const sharedDir = path.join(demoDir, '.mmd', 'shared');
    const { readdirSync } = await import('node:fs');
    const corruptFiles = readdirSync(sharedDir).filter(f => f.startsWith('status.json.corrupt-'));
    assert.ok(corruptFiles.length >= 1, 'expected a status.json.corrupt-* artifact');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('writeStatus surfaces EACCES (no silent catch)', { skip: platform() === 'win32' }, async () => {
  const tmp = makeTmp();
  try {
    const demoDir = path.join(tmp, 'demo', 'foo');
    await ensureLayout(demoDir);
    const statusPath = path.join(demoDir, '.mmd', 'shared', 'status.json');
    // First, write a valid status.json then chmod 0000 to force EACCES on read.
    writeFileSync(statusPath, JSON.stringify({
      slice_id: 'foo', dream: 'd', state: 'in_progress',
      created_at: '2026-05-16T10:00:00.000Z', updated_at: '2026-05-16T10:00:00.000Z',
      tasks: [],
    }));
    chmodSync(statusPath, 0o000);
    // If running as root, chmod 0000 doesn't prevent reads — skip in that case.
    if (process.getuid && process.getuid() === 0) {
      chmodSync(statusPath, 0o644);
      return;
    }
    let caught = null;
    try {
      await writeStatus(demoDir, {
        slice_id: 'foo', dream: 'd', state: 'done',
        created_at: '2026-05-16T10:00:00.000Z', updated_at: '2026-05-16T10:01:00.000Z',
        tasks: [],
      });
    } catch (err) {
      caught = err;
    }
    // Restore perms so cleanup works.
    chmodSync(statusPath, 0o644);
    assert.ok(caught, 'writeStatus should have rejected');
    assert.equal(caught.code, 'EACCES');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
