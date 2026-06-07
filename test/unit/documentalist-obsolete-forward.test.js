// test/unit/documentalist-obsolete-forward.test.js — unit tests for the v0.22.a
// obsolete-forward-narrative detection (SPEC_V022A):
//   • checkObsoleteForwardClaims (AC-1, AC-2, AC-4)
//
// The INVERSE of v0.21's capability-lie: it flags a FORWARD-LOOKING claim
// ("next / coming / planned / then vX") of an ALREADY-BUILT capability or an
// already-shipped version (<= current). Pure, deterministic, never throws.
// Tagged @unit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkObsoleteForwardClaims } from '../../lib/documentalist/conformance.js';

// A small roadmap + inventory fixture: the roadmap names "Conductor" and
// "Documentalist" capabilities; the inventory has matching built signals (a
// `document` subcommand → Documentalist built; a `lib/conductor/*` named "conductor"
// module → Conductor built). "Voice mode" is in the roadmap but has NO inventory
// signal → unbuilt (a real future item).
const ROADMAP = [
  '## 9. Roadmap',
  '',
  '### v0.5 — Conductor (orchestration + auto-handoff)',
  '### v0.19 — Documentalist (autonomous doc agent)',
  '### v0.30 — Voice mode (speak your dream)',
  '',
].join('\n');

const INVENTORY = {
  subcommands: ['document', 'conductor', 'discover'],
  libModules: ['conductor', 'documentalist', 'discover'],
  adrs: [{ number: 58, title: 'document orchestrator' }, { number: 51, title: 'cooperative auto-handoff conductor' }],
  tags: ['v0.5.0', 'v0.19.0', 'v0.22.0'],
  lessonCount: 30,
};

// ── AC-1 / AC-2: a forward cue naming a built capability or a past version ──────

test('@unit checkObsoleteForwardClaims: forward cue + past version (<= current) → flagged high', () => {
  const r = checkObsoleteForwardClaims({
    docText: 'Next on the roadmap: then v0.5 Conductor, v0.19 Documentalist.',
    doc: 'README.md',
    roadmap: ROADMAP,
    inventory: INVENTORY,
    currentVersion: '0.22.0',
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].confidence, 'high');
  assert.equal(r[0].doc, 'README.md');
  assert.equal(r[0].line, 1);
  assert.ok(/v0\.5|v0\.19/.test(r[0].reason));
});

test('@unit checkObsoleteForwardClaims: version compare is correct incl. 0.4 <= 0.22', () => {
  const r = checkObsoleteForwardClaims({
    docText: 'Coming soon: then v0.4 stateless Orchestrator.',
    doc: 'x', roadmap: ROADMAP, inventory: INVENTORY, currentVersion: '0.22.0',
  });
  assert.equal(r.length, 1, 'v0.4 <= v0.22 → stale forward claim flagged');
});

test('@unit checkObsoleteForwardClaims: forward cue naming a BUILT capability (no version) → flagged', () => {
  const r = checkObsoleteForwardClaims({
    docText: 'Next: the full Documentalist agent.',
    doc: 'x', roadmap: ROADMAP, inventory: INVENTORY, currentVersion: '0.22.0',
  });
  assert.equal(r.length, 1);
  assert.ok(/documentalist/i.test(r[0].reason));
  assert.equal(r[0].capability, 'Documentalist (autonomous doc agent)');
});

// ── AC-4: precision — a real future item is NOT flagged ─────────────────────

test('@unit checkObsoleteForwardClaims: forward cue naming an UNBUILT capability → NOT flagged', () => {
  // "voice mode" is in the roadmap but unbuilt (no inventory signal) AND no past version.
  const r = checkObsoleteForwardClaims({
    docText: 'Next: voice mode — speak your dream.',
    doc: 'x', roadmap: ROADMAP, inventory: INVENTORY, currentVersion: '0.22.0',
  });
  assert.equal(r.length, 0, 'a genuine future item must not be flagged');
});

test('@unit checkObsoleteForwardClaims: forward cue + a FUTURE version (> current) → NOT flagged', () => {
  const r = checkObsoleteForwardClaims({
    docText: 'Next: then v0.30 voice mode and a game engine.',
    doc: 'x', roadmap: ROADMAP, inventory: INVENTORY, currentVersion: '0.22.0',
  });
  assert.equal(r.length, 0, 'v0.30 > v0.22 → a real future item, not flagged');
});

// ── precision: past-tense / historical framing suppressed ───────────────────

test('@unit checkObsoleteForwardClaims: past-tense / historical framing → NOT flagged', () => {
  const base = { doc: 'x', roadmap: ROADMAP, inventory: INVENTORY, currentVersion: '0.22.0' };
  assert.equal(checkObsoleteForwardClaims({ ...base, docText: 'v0.5 Conductor was next on the roadmap.' }).length, 0);
  assert.equal(checkObsoleteForwardClaims({ ...base, docText: 'The Documentalist was originally planned for v0.19.' }).length, 0);
  assert.equal(checkObsoleteForwardClaims({ ...base, docText: 'The Conductor used to be next.' }).length, 0);
  assert.equal(checkObsoleteForwardClaims({ ...base, docText: 'Auto-handoff was coming in v0.5; it shipped.' }).length, 0);
});

test('@unit checkObsoleteForwardClaims: a line with no forward cue → NOT flagged', () => {
  const r = checkObsoleteForwardClaims({
    docText: 'v0.5 Conductor shipped. v0.19 Documentalist shipped.',
    doc: 'x', roadmap: ROADMAP, inventory: INVENTORY, currentVersion: '0.22.0',
  });
  assert.equal(r.length, 0);
});

test('@unit checkObsoleteForwardClaims: a fenced code block is not scanned (precision)', () => {
  const text = ['```', 'next: then v0.5 Conductor', '```'].join('\n');
  const r = checkObsoleteForwardClaims({
    docText: text, doc: 'x', roadmap: ROADMAP, inventory: INVENTORY, currentVersion: '0.22.0',
  });
  assert.equal(r.length, 0);
});

// ── removable shape: discrete list item of a past version → removable ───────

test('@unit checkObsoleteForwardClaims: discrete list item naming only past versions → removable whole-line', () => {
  const r = checkObsoleteForwardClaims({
    docText: '- next: v0.5 Conductor',
    doc: 'x', roadmap: ROADMAP, inventory: INVENTORY, currentVersion: '0.22.0',
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].removable, true);
  assert.equal(r[0].removalMode, 'whole-line');
});

test('@unit checkObsoleteForwardClaims: a multi-clause prose sentence → flagged, NOT removable', () => {
  // The README line-73 case: a single prose line with multiple capabilities/versions.
  const line = 'Next on the roadmap: a lite Documentalist, then v0.4 Orchestrator, v0.5 Conductor.';
  const r = checkObsoleteForwardClaims({
    docText: line, doc: 'README.md', roadmap: ROADMAP, inventory: INVENTORY, currentVersion: '0.22.0',
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].removable, false, 'a prose sentence is FLAGGED, never auto-rewritten (semantic, deferred)');
  assert.equal(r[0].removalMode, null);
});

test('@unit checkObsoleteForwardClaims: a list item that ALSO names a future version → flagged, not removable', () => {
  // The discrete item shape, but it preserves a real future plan (v0.30) → keep it.
  const r = checkObsoleteForwardClaims({
    docText: '- next: v0.5 Conductor then v0.30 voice mode',
    doc: 'x', roadmap: ROADMAP, inventory: INVENTORY, currentVersion: '0.22.0',
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].removable, false, 'a surviving future version means the item still names a real plan');
});

// ── purity / null-safety ────────────────────────────────────────────────────

test('@unit checkObsoleteForwardClaims: pure + never throws on odd input', () => {
  assert.doesNotThrow(() => checkObsoleteForwardClaims(null));
  assert.doesNotThrow(() => checkObsoleteForwardClaims({}));
  assert.doesNotThrow(() => checkObsoleteForwardClaims({ docText: 'next: v0.5' })); // no roadmap/inventory/version
  assert.equal(checkObsoleteForwardClaims({}).length, 0);
  // No current version + no built signal → cannot judge → empty (honest, never a fake finding).
  assert.equal(checkObsoleteForwardClaims({ docText: 'next: something', doc: 'x' }).length, 0);
});

test('@unit checkObsoleteForwardClaims: version signal works WITHOUT a roadmap (deterministic)', () => {
  // No roadmap → no built set, but the version compare still flags a past version.
  const r = checkObsoleteForwardClaims({
    docText: 'Next up: then v0.5 stuff.',
    doc: 'x', currentVersion: '0.22.0',
  });
  assert.equal(r.length, 1, 'a past-version forward claim is flagged on the version signal alone');
});
