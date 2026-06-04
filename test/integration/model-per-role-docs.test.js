// @integration tests for SPEC_V016A AC-5: the docs deliverables land. ADR-055
// exists with the right shape; README + the /mmdream template document the
// MMD_MODEL_<ROLE> overrides; CLAUDE.md records the slice; the version is bumped
// to 0.16.0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

test('@integration AC-5: ADR-055 exists and documents model-per-role', () => {
  const adr = read('docs', 'adr', '055-model-per-task-role-policy.md');
  assert.match(adr, /ADR-055/);
  assert.match(adr, /\*\*Status\*\*:\s*accepted/i);
  assert.match(adr, /model-per-task/i);
  assert.match(adr, /MMD_MODEL_<ROLE>/, 'documents the per-role override');
  assert.match(adr, /#47488|attached|detached/i, 'documents the attached-vs-detached finding');
  assert.match(adr, /mmd-spec|mmd-impl|mmd-review/, 'documents the named sub-agents');
  assert.match(adr, /orchestrator/i);
});

test('@integration AC-5: README documents the MMD_MODEL_<ROLE> overrides + the cost-aware defaults', () => {
  const readme = read('README.md');
  assert.match(readme, /MMD_MODEL_<ROLE>/, 'README names the override env var');
  assert.match(readme, /model-per-task/i, 'README describes the feature');
  // The cost-aware defaults are stated.
  assert.match(readme, /orchestrator/i);
  assert.match(readme, /opus/);
  assert.match(readme, /sonnet/);
});

test('@integration AC-5: the /mmdream template documents the MMD_MODEL_<ROLE> overrides', () => {
  const tmpl = read('assets', 'claude-commands', 'mmdream.md');
  assert.match(tmpl, /MMD_MODEL_<ROLE>/, 'template names the override env var');
  assert.match(tmpl, /Model-per-task/i, 'template frames the feature');
  assert.match(tmpl, /ORCHESTRATOR.*SPEC.*IMPL/s, 'template lists the roles');
});

test('@integration AC-5: CLAUDE.md records the v0.16.a model-per-task slice', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /model-per-task|model-per-role/i);
  assert.match(claude, /v0\.16\.a/);
  assert.match(claude, /ADR-055/);
});

test('@integration AC-5: the package version is at least 0.16.0', () => {
  const pkg = JSON.parse(read('package.json'));
  const [major, minor] = pkg.version.split('.').map(Number);
  assert.equal(major, 0);
  assert.ok(minor >= 16, `expected version >= 0.16.0, got ${pkg.version}`);
});
