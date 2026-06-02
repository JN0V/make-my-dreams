// @unit anchor-presence tests for SPEC_V03A1 AC-6 documentation. Cheap guards
// that ADR-021, L-021, the README Dream Catcher paragraph, and the version bump
// are present, so a future edit that drops them fails loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('@unit AC-6: ADR-021 exists and covers the Dream Catcher rationale', () => {
  const p = 'docs/adr/021-dream-catcher.md';
  assert.ok(existsSync(path.join(REPO_ROOT, p)), `${p} must exist`);
  const md = read(p);
  assert.match(md, /# ADR-021/);
  assert.match(md, /SPEC_V03A\.md/);          // references the parent design
  assert.match(md, /no stdin/i);              // headless reality
  assert.match(md, /honest fallback/i);       // universal §VI
  assert.match(md, /v0\.3\.a-2/);             // deferred dial + editing
});

test('@unit AC-6: L-021 is a formal lesson with Category / Applies to / Keywords', () => {
  const md = read('docs/lessons-learned.md');
  assert.match(md, /## L-021 —/);
  assert.match(md, /no stdin/i);
  // The three machine-readable fields the composer relies on (L-018).
  const block = md.slice(md.indexOf('## L-021'));
  assert.match(block, /\*\*Category\*\*:.*subprocess-control/);
  assert.match(block, /\*\*Applies to\*\*:.*mmd serve/);
  assert.match(block, /\*\*Keywords for matching\*\*:.*dream catcher/i);
});

test('@unit AC-6: README documents Dream Catcher under mmd serve', () => {
  const md = read('README.md');
  assert.match(md, /Dream Catcher/);
  assert.match(md, /\/api\/catch\/start/);
  assert.match(md, /ADR-021/);
});

/* ─────────── v0.3.a-2 anchors (AC-7) ─────────── */

test('@unit AC-7: ADR-022 exists and covers the dial + state-driven answer + tagging + editing', () => {
  const p = 'docs/adr/022-dream-catcher-dial-and-edit.md';
  assert.ok(existsSync(path.join(REPO_ROOT, p)), `${p} must exist`);
  const md = read(p);
  assert.match(md, /# ADR-022/);
  assert.match(md, /SPEC_V03A\.md/);                    // references the parent design
  assert.match(md, /L-021/);                            // references the lesson
  assert.match(md, /Autonome.*Équilibré.*Guidé/s);      // the three levels
  assert.match(md, /0 \/ 1 \/ 2/);                      // turn-count mapping
  assert.match(md, /state-driven/i);                    // /answer design
  assert.match(md, /QUESTION:|SCOPE:/);                 // deterministic tagging
  assert.match(md, /editScope|\/api\/catch\/edit/);     // scope editing
});

test('@unit AC-7: README covers the 3 levels + scope editing + /api/catch/edit', () => {
  const md = read('README.md');
  assert.match(md, /Autonome/);
  assert.match(md, /Équilibré/);
  assert.match(md, /Guidé/);
  assert.match(md, /\/api\/catch\/edit/);
  assert.match(md, /Modifier|Edit/);
  assert.match(md, /ADR-022/);
});

/* ─────────── v0.3.b anchors (AC-6) ─────────── */

test('@unit AC-6: ADR-023 exists and covers the CLI surface + profile threading', () => {
  const p = 'docs/adr/023-dream-catcher-cli-and-profile.md';
  assert.ok(existsSync(path.join(REPO_ROOT, p)), `${p} must exist`);
  const md = read(p);
  assert.match(md, /# ADR-023/);
  assert.match(md, /SPEC_V03B\.md/);                 // references the slice spec
  assert.match(md, /MMD_PROFILE/);                   // the threaded env var
  assert.match(md, /resolveShouldCatch|--catch/);    // the TTY-gated trigger
  assert.match(md, /safe-by-default/i);              // Kid consumption
  assert.match(md, /deferred|defer/i);               // full bindings injection deferred
});

test('@unit AC-6: L-022 is a formal lesson with Category / Applies to / Keywords', () => {
  const md = read('docs/lessons-learned.md');
  assert.match(md, /## L-022 —/);
  assert.match(md, /consume|dead variable/i);
  const block = md.slice(md.indexOf('## L-022'));
  assert.match(block, /\*\*Category\*\*:.*observability/);
  assert.match(block, /\*\*Applies to\*\*:.*mmd serve/);
  assert.match(block, /\*\*Keywords for matching\*\*:.*MMD_PROFILE/);
});

test('@unit AC-6: README documents interactive mmd dream mode + --catch/--no-catch + MMD_PROFILE', () => {
  const md = read('README.md');
  assert.match(md, /--catch/);
  assert.match(md, /--no-catch/);
  assert.match(md, /MMD_PROFILE/);
  assert.match(md, /ADR-023/);
});

test('@unit package.json is bumped to the current slice version (0.8.1)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, '0.8.1');
});

// ── SPEC_V03C AC-5: Layer C docs anchors (Phase-4 review F2) ──

test('@unit AC-5: ADR-024 documents the Layer C composer rationale', () => {
  const p = 'docs/adr/024-constitution-composer-layer-c.md';
  assert.ok(existsSync(path.join(REPO_ROOT, p)), `${p} must exist`);
  const md = read(p);
  assert.match(md, /# ADR-024/);
  assert.match(md, /Layer C/);
  assert.match(md, /SPEC_V03C\.md/);                 // references the parent design
  assert.match(md, /hand-rolled YAML/i);             // why no dependency
  assert.match(md, /supersede/i);                    // supersedes the v0.3.b stopgap
  assert.match(md, /fallback/i);                     // graceful-fallback contract
  assert.match(md, /engine|context|skill/i);         // deferred dimensions
});

test('@unit AC-5: CLAUDE.md says the Layer C composer now EXISTS (not "planned")', () => {
  const md = read('CLAUDE.md');
  assert.match(md, /lib\/constitution-compose\.js/);
  assert.match(md, /shipped v0\.3\.c/i);
  assert.match(md, /ADR-024/);
  // The stale "planned" framing for the composer must be gone.
  assert.doesNotMatch(md, /constitution-compose\.js`, planned/);
});

test('@unit AC-5: README documents the Layer C composer under MMD_PROFILE', () => {
  const md = read('README.md');
  assert.match(md, /lib\/constitution-compose\.js/);
  assert.match(md, /Layer C/);
  assert.match(md, /ADR-024/);
});
