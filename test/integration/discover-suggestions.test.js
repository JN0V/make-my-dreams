// @integration — SPEC_V06B AC-2: `mmd discover` on a repo WITH a constitution
// surfaces a non-destructive "Constitution suggestions" section in the report,
// and leaves constitution.md byte-for-byte unchanged ("elle reste"). A repo
// WITHOUT a constitution gets no such section.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MMD = path.join(REPO_ROOT, 'bin', 'mmd.js');

const THIN_CONSTITUTION = `# Project Constitution

We value KISS — keep it simple. Keep the README and documentation current.
`;

function git(dir, ...args) {
  return spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

function makeRepo(tag, { constitution } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), `mmd-sugg-${tag}-`));
  // A minimal real app so it is a recognized stack, not blank.
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
  writeFileSync(path.join(dir, 'index.js'), 'console.log(1);\n');
  if (constitution) {
    mkdirSync(path.join(dir, '.specify', 'memory'), { recursive: true });
    writeFileSync(path.join(dir, '.specify', 'memory', 'constitution.md'), constitution);
  }
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('@integration discover with a thin constitution → suggestions section + file untouched', () => {
  const dir = makeRepo('thin', { constitution: THIN_CONSTITUTION });
  const constPath = path.join(dir, '.specify', 'memory', 'constitution.md');
  const before = createHash('sha256').update(readFileSync(constPath)).digest('hex');
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    const report = readFileSync(path.join(dir, 'mmd-discovery-report.md'), 'utf8');
    assert.match(report, /## Constitution suggestions \(advisory — your constitution is never modified\)/);
    assert.match(report, /[Hh]euristic/);
    // The thin constitution names KISS + docs → those look present; the rest are gaps.
    assert.match(report, /looks solid on:.*[Dd]esign principles/);
    assert.match(report, /Testing discipline/);
    assert.match(report, /Security practices/);

    // "Elle reste": constitution.md is byte-for-byte unchanged.
    const after = createHash('sha256').update(readFileSync(constPath)).digest('hex');
    assert.equal(after, before, 'discover must NEVER write constitution.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@integration discover with NO constitution → no suggestions section', () => {
  const dir = makeRepo('none');
  try {
    const r = spawnSync('node', [MMD, 'discover', '.'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const report = readFileSync(path.join(dir, 'mmd-discovery-report.md'), 'utf8');
    assert.doesNotMatch(report, /Constitution suggestions/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
