// @integration tests for SPEC_V012A AC-5: the v0.12.a docs landed — ADR-050
// exists, the /mmdream operator template documents `--resume` as continue-an-
// interrupted-run, and the version is bumped to 0.12.0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { readReadmeSurface } from '../helpers/readme-surface.js';

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

test('@integration AC-5: version is at least 0.12.0 (the v0.12.a bump; later slices move it forward)', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  // The v0.12.a deliverable bumped to 0.12.0; subsequent slices (v0.13.a → 0.13.0)
  // move the version forward, so assert the minor is >= 12 rather than pinning an
  // exact value that every later bump would break.
  const [major, minor] = pkg.version.split('.').map(Number);
  assert.equal(major, 0);
  assert.ok(minor >= 12, `expected version >= 0.12.0, got ${pkg.version}`);
});

test('@integration AC-5: README + CLAUDE.md mention the resumable orchestrator (v0.12.a)', () => {
  // v0.21.a condensed the README — its long-form History/Usage now live in the
  // extracted siblings; read the full surface (README + siblings).
  const readme = readReadmeSurface(REPO_ROOT);
  assert.match(readme, /v0\.12\.a/);
  assert.match(readme, /resumable|--resume/i);
  const claude = readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /v0\.12\.a/);
  assert.match(claude, /ADR-050/);
});
