// @integration tests for SPEC_V012A AC-5: the v0.12.a docs landed — ADR-050
// exists, the /mmdream operator template documents `--resume` as continue-an-
// interrupted-run, and the version is bumped to 0.12.0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

test('@integration AC-5: ADR-050 (stateless/resumable orchestrator) exists with the contract', () => {
  const adr = path.join(REPO_ROOT, 'docs', 'adr', '050-stateless-resumable-orchestrator.md');
  assert.ok(existsSync(adr), 'ADR-050 file must exist');
  const text = readFileSync(adr, 'utf8');
  assert.match(text, /# ADR-050/);
  assert.match(text, /checkpoint/i);
  assert.match(text, /handoff/i);
  assert.match(text, /resum/i);
  assert.match(text, /step C|auto-handoff/i, 'names the foundation-for-C relationship');
  assert.match(text, /testability boundary/i, 'documents the §VI testability boundary');
});

test('@integration AC-5: /mmdream template documents --resume as continue-an-interrupted-run', () => {
  const tpl = readFileSync(path.join(REPO_ROOT, 'assets', 'claude-commands', 'mmdream.md'), 'utf8');
  assert.match(tpl, /--here --resume/, 'documents --here --resume');
  assert.match(tpl, /interrupted|continue an interrupted/i);
  assert.match(tpl, /no resumable run|nothing to resume/i, 'documents the honest no-op');
});

test('@integration AC-5: version bumped to 0.12.0', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.12.0');
});

test('@integration AC-5: README + CLAUDE.md mention the resumable orchestrator (v0.12.a)', () => {
  const readme = readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /v0\.12\.a/);
  assert.match(readme, /resumable|--resume/i);
  const claude = readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /v0\.12\.a/);
  assert.match(claude, /ADR-050/);
});
