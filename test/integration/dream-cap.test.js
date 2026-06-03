// @integration — the greenfield CLI dream-length cap (field bug: a real first
// dream is several sentences, and the old 500-char cap rejected it with
// "dream string too long (max 500 chars)"). The default is now 4000.
//
// MMD_AUTODEV_CMD=/bin/true fakes the auto-dev spawn (and skips the BMAD
// auto-setup, gated on that seam); MMD_SKIP_SETUP=1 belt-and-suspenders.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

function runDream(dream) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-dreamcap-'));
  const home = mkdtempSync(path.join(tmpdir(), 'mmd-home-'));
  try {
    return spawnSync('node', [MMD, dream], {
      cwd: dir, encoding: 'utf8', timeout: 20000,
      env: { PATH: process.env.PATH, HOME: home, MMD_AUTODEV_CMD: '/bin/true', MMD_SKIP_SETUP: '1' },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

test('@integration a 600-char dream is ACCEPTED (the old 500 cap rejected real dreams)', () => {
  const r = runDream('a '.repeat(300)); // 600 chars
  assert.doesNotMatch(r.stderr || '', /dream string too long/, `600-char dream must not be rejected; stderr=${r.stderr}`);
});

test('@integration a dream over 4000 chars → "dream string too long (max 4000 chars)" + exit 2', () => {
  const r = runDream('a'.repeat(4001));
  assert.equal(r.status, 2, `expected exit 2; stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stderr, /dream string too long \(max 4000 chars\)/);
});
