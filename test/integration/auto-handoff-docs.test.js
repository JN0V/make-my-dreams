// @integration tests for SPEC_V013A AC-5: the docs deliverables land.
// ADR-051 exists with the right shape; the /mmdream operator template documents
// --auto-handoff for long runs; the version is bumped to 0.13.0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

test('@integration AC-5: ADR-051 exists and documents cooperative auto-handoff', () => {
  const adr = readFileSync(path.join(REPO_ROOT, 'docs', 'adr', '051-cooperative-auto-handoff.md'), 'utf8');
  assert.match(adr, /ADR-051/);
  assert.match(adr, /\*\*Status\*\*:\s*accepted/i);
  assert.match(adr, /cooperative auto-handoff/i);
  assert.match(adr, /--auto-handoff/);
  assert.match(adr, /implies\s+`?--monitor`?/i, 'documents the opt-in/monitor implication');
  assert.match(adr, /MMD_MAX_HANDOFFS/, 'documents the cap');
  assert.match(adr, /byte-for-byte/i, 'documents the default-unchanged contract');
});

test('@integration v0.15.a AC-5: the /mmdream operator template documents AUTOMATIC auto-handoff + the opt-out', () => {
  const tmpl = readFileSync(path.join(REPO_ROOT, 'assets', 'claude-commands', 'mmdream.md'), 'utf8');
  // v0.15.a: auto-handoff is now automatic (transparent Conductor) — the template
  // says so, documents the MMD_NO_AUTO_HANDOFF opt-out, and still names the cap.
  assert.match(tmpl, /AUTOMATIC/i, 'frames auto-handoff as automatic (no flag)');
  assert.match(tmpl, /MMD_NO_AUTO_HANDOFF/, 'documents the single opt-out');
  assert.match(tmpl, /MMD_MAX_HANDOFFS/, 'names the cap env var');
  assert.match(tmpl, /LONG run/i, 'still frames it for long runs that may fill context');
});

test('@integration AC-5: the package version is at least 0.13.0 (the v0.13.a bump; patches move it forward)', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  // The v0.13.a deliverable bumped to 0.13.0; later patches (v0.13.1 …) move it
  // forward, so assert minor >= 13 rather than pinning an exact value that every
  // bump would break (the same fragility that turned main red on the v0.13.1 patch).
  const [major, minor] = pkg.version.split('.').map(Number);
  assert.equal(major, 0);
  assert.ok(minor >= 13, `expected version >= 0.13.0, got ${pkg.version}`);
});

test('@integration AC-5: CLAUDE.md records the v0.13.a auto-handoff slice', () => {
  const claude = readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /Cooperative auto-handoff at 70% \(v0\.13\.a\)/);
  assert.match(claude, /ADR-051/);
});

// ── v0.15.a AC-5: the transparent-Conductor docs land ───────────────────────

test('@integration v0.15.a AC-5: ADR-054 exists and documents the transparent Conductor default-on + opt-out', () => {
  const adr = readFileSync(path.join(REPO_ROOT, 'docs', 'adr', '054-transparent-conductor-default.md'), 'utf8');
  assert.match(adr, /ADR-054/);
  assert.match(adr, /\*\*Status\*\*:\s*accepted/i);
  assert.match(adr, /transparent Conductor/i);
  assert.match(adr, /default-on|default/i);
  assert.match(adr, /MMD_NO_AUTO_HANDOFF/, 'documents the single opt-out');
  assert.match(adr, /inert/i, 'documents the legacy flags are inert');
});

test('@integration v0.15.a AC-5: the package version is at least 0.15.0', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const [major, minor] = pkg.version.split('.').map(Number);
  assert.equal(major, 0);
  assert.ok(minor >= 15, `expected version >= 0.15.0, got ${pkg.version}`);
});

test('@integration v0.15.a AC-5: CLAUDE.md records the v0.15.a transparent-Conductor slice', () => {
  const claude = readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /v0\.15\.a/);
  assert.match(claude, /ADR-054/);
  assert.match(claude, /MMD_NO_AUTO_HANDOFF/);
});
