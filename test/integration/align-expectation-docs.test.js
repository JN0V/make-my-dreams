// @integration tests for SPEC_V017A AC-5: the docs deliverables land. ADR-056
// exists with the right shape; README + CLAUDE.md + the /mmdream template
// document the frozen-expectation oracle + the dual-face gate + MMD_SKIP_ALIGN;
// the version is bumped to 0.17.0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

test('@integration AC-5: ADR-056 exists and documents the frozen oracle + dual-face verify', () => {
  const adrPath = path.join(REPO_ROOT, 'docs', 'adr', '056-align-to-original-expectation.md');
  assert.ok(existsSync(adrPath), 'ADR-056 must exist at docs/adr/056-align-to-original-expectation.md');
  const adr = readFileSync(adrPath, 'utf8');
  assert.match(adr, /ADR-056/);
  assert.match(adr, /\*\*Status\*\*:\s*accepted/i);
  assert.match(adr, /expectation\.md/, 'documents the frozen oracle file');
  assert.match(adr, /dual-face|deterministic.*semantic|semantic.*deterministic/is, 'documents the dual-face verify');
  assert.match(adr, /un-skip|deterministic face/i, 'documents un-skipping Reality Check on --here');
  assert.match(adr, /exit 7/i, 'documents the unresolved-gap exit');
  assert.match(adr, /MMD_SKIP_ALIGN/, 'documents the opt-out');
});

test('@integration AC-5: README documents the frozen oracle + dual-face gate + version 0.17.0', () => {
  const readme = read('README.md');
  assert.match(readme, /expectation\.md/, 'README names the frozen oracle file');
  assert.match(readme, /dual-face/i, 'README describes the dual-face gate');
  assert.match(readme, /ADR-056/);
  assert.match(readme, /0\.17\.0/, 'README mentions the new version');
});

test('@integration AC-5: CLAUDE.md records the v0.17.0 align-to-expectation slice', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /expectation\.md/, 'CLAUDE.md names the frozen oracle');
  assert.match(claude, /dual-face/i);
  assert.match(claude, /v0\.17\.0/);
  assert.match(claude, /ADR-056/);
});

test('@integration AC-5: the /mmdream template notes the frozen-expectation oracle + dual-face + MMD_SKIP_ALIGN', () => {
  const tmpl = read('assets', 'claude-commands', 'mmdream.md');
  assert.match(tmpl, /expectation\.md/, 'template names the frozen oracle');
  assert.match(tmpl, /dual-face/i, 'template frames the dual-face gate');
  assert.match(tmpl, /MMD_SKIP_ALIGN/, 'template documents the opt-out');
});

test('@integration AC-5: the package version is 0.17.0', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, '0.17.0', `expected version 0.17.0, got ${pkg.version}`);
});
