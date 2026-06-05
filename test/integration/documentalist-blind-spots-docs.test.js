// @integration tests for SPEC_V018A AC-6: the docs deliverables land. ADR-057
// exists with the right shape; README + CLAUDE.md + the /mmdream template
// document the wider scan surface + the deprecated/promise checks + the --check
// gate; the version is bumped to 0.18.0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

test('@integration AC-6: ADR-057 exists and documents the 5 blind-spots + fixes', () => {
  const adrPath = path.join(REPO_ROOT, 'docs', 'adr', '057-documentalist-close-5-blind-spots.md');
  assert.ok(existsSync(adrPath), 'ADR-057 must exist at docs/adr/057-documentalist-close-5-blind-spots.md');
  const adr = readFileSync(adrPath, 'utf8');
  assert.match(adr, /ADR-057/);
  assert.match(adr, /\*\*Status\*\*:\s*accepted/i);
  // The 5 gaps + fixes.
  assert.match(adr, /markdown-only|wider surface|UX-text/i, 'documents the surface fix (AC-2)');
  assert.match(adr, /deprecated[- ]surface/i, 'documents the deprecated-surface check (AC-3)');
  assert.match(adr, /version-pinned|promise/i, 'documents the promise check (AC-4)');
  assert.match(adr, /--check/, 'documents the --check gate (AC-5)');
  assert.match(adr, /unknown/i, 'documents the honest-reconciliation fix (AC-1)');
  // The design rationale: deterministic + precision-first + read-only + heuristic-doesn't-gate.
  assert.match(adr, /deterministic/i);
  assert.match(adr, /precision[- ]first/i);
  assert.match(adr, /read-only/i);
  assert.match(adr, /heuristic.*(does NOT|advisory)|advisory.*heuristic/is, 'why the heuristic does not gate');
});

test('@integration AC-6: README documents --check + the wider surface + the new checks + version 0.18.0', () => {
  const readme = read('README.md');
  assert.match(readme, /document-review --check/, 'README documents the --check gate');
  assert.match(readme, /deprecated[- ]surface/i, 'README mentions the deprecated-surface check');
  assert.match(readme, /promise/i, 'README mentions the promise check');
  assert.match(readme, /ux-text-surface|--help|install-mmd\.sh/i, 'README mentions the wider surface');
  assert.match(readme, /ADR-057/);
  assert.match(readme, /0\.18\.0/, 'README mentions the new version');
});

test('@integration AC-6: CLAUDE.md records the v0.18.0 blind-spots slice', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /document-review --check/, 'CLAUDE.md documents the --check gate');
  assert.match(claude, /deprecated[- ]surface/i);
  assert.match(claude, /checkVersionPinnedPromises|version-pinned/i);
  assert.match(claude, /v0\.18\.0/);
  assert.match(claude, /ADR-057/);
});

test('@integration AC-6: the /mmdream template notes --check + the wider surface + the new checks', () => {
  const tmpl = read('assets', 'claude-commands', 'mmdream.md');
  assert.match(tmpl, /document-review --check/, 'template documents --check');
  assert.match(tmpl, /deprecated[- ]surface/i, 'template mentions the deprecated-surface check');
  assert.match(tmpl, /promise/i, 'template mentions the promise check');
  assert.match(tmpl, /--help|install-mmd\.sh|wider/i, 'template mentions the wider surface');
});

test('@integration AC-6: the package version is at or past 0.18.0 (this slice shipped then)', () => {
  // The blind-spots slice shipped at 0.18.0. Asserting >= (not exact equality)
  // so a later version bump (v0.19.0 added the `mmdream document` orchestrator)
  // does not break this slice's doc test — the feature never regressed.
  const pkg = JSON.parse(read('package.json'));
  const [maj, min] = pkg.version.split('.').map(Number);
  assert.ok(maj > 0 || (maj === 0 && min >= 18), `expected version >= 0.18.0, got ${pkg.version}`);
});
