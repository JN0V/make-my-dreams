// @unit tests for lib/documentalist/roadmap-reconcile.js (SPEC_V07A AC-2).
//
// Pure transform, table-driven on a CRAFTED fixture roadmap + a crafted
// inventory mirroring real MMD names — so we can assert the exact built /
// partial / unbuilt classifications the SPEC mandates, deterministically and
// without any filesystem (testing.md §V, < 100ms). The real compound MMD
// roadmap is exercised separately by the AC-4 self-validation (e2e).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reconcileRoadmap } from '../../lib/documentalist/roadmap-reconcile.js';

// A crafted inventory whose names mirror today's real MMD surface — enough for
// the heuristic to find (or not find) each capability.
const INVENTORY = {
  subcommands: [
    'serve', 'bench', 'ship', 'discover', 'qa', 'cso', 'document-release',
    'unblock', 'document-lessons', 'handover', 'document-readme', 'document-review',
  ],
  tags: ['v0.4.0', 'v0.4.1', 'v0.5.0', 'v0.5.1'],
  adrs: [
    { number: 26, title: 'Sealed-test oracle', file: '026.md' },
    { number: 29, title: 'Conductor notifications', file: '029.md' },
    { number: 30, title: 'Live context monitor', file: '030.md' },
  ],
  libModules: [
    'conductor', 'discover', 'dream-catcher', 'documentalist', 'reality-check',
    'sealed-tests', 'server', 'onboarding', 'engine', 'state',
  ],
};

// A crafted roadmap with clean single-capability headers so each classification
// is unambiguous. Mirrors the MAKE_MY_DREAMS.md `### vX.Y — Title  *(N days)*`
// shape (incl. the trailing time estimate we must strip).
const ROADMAP = [
  '## 9. Roadmap',
  '',
  '### v0.3 — Dream Catcher conversational CLI  *(3–4 days)*',
  '- bullet that must be ignored',
  '### v0.2.5 — `mmd serve` minimal web UI for non-tech users  *(2–3 days)*',
  '### v0.2c — `mmd discover` brownfield onboarding  *(3–4 days)*',
  '### v0.4a — Sealed-test oracle  *(2 days)*',
  '### v0.5a — Conductor notifications and monitor  *(2 days)*',
  '### v0.3a — Dream Expander (real BMAD brainstorming)  *(4–5 days)*',
  '### v0.3b — Plan-Review Worker  *(3 days)*',
  '### v0.2b — Bundle A Security  *(3–4 days)*',
  '### v0.5b — Documentalist (integrates gStack) + Context Worker  *(4-5 days)*',
  '### v0.6 — Polymorphic Reality Check + Mockup  *(4-5 days)*',
  '### v0.4b — Stateless auto-handoff @70%  *(4–5 days)*',
  '',
].join('\n');

function classify() {
  const out = reconcileRoadmap({ roadmapText: ROADMAP, inventory: INVENTORY });
  const byVersion = {};
  for (const e of out.entries) byVersion[e.version] = e;
  return { out, byVersion };
}

// ── Parsing ─────────────────────────────────────────────────────────────────

test('@unit reconcile: parses `### vX.Y — Title` headers, strips the time estimate', () => {
  const { byVersion } = classify();
  assert.equal(byVersion['v0.3'].capability, 'Dream Catcher conversational CLI');
  // The `*(2–3 days)*` estimate is stripped; backticks kept (raw title).
  assert.match(byVersion['v0.2.5'].capability, /minimal web UI/);
  assert.ok(!byVersion['v0.2.5'].capability.includes('days'));
});

test('@unit reconcile: always flagged as a heuristic, never an authoritative audit', () => {
  const { out } = classify();
  assert.equal(out.heuristic, true);
  assert.match(out.note, /heuristic/i);
  assert.match(out.note, /not an authoritative audit/i);
});

// ── The SPEC-mandated BUILT classifications ─────────────────────────────────

test('@unit reconcile: Dream Catcher / serve / discover-onboarding / sealed-test / Conductor → built', () => {
  const { byVersion } = classify();
  assert.equal(byVersion['v0.3'].status, 'built');      // lib dream-catcher
  assert.equal(byVersion['v0.2.5'].status, 'built');    // subcmd serve
  assert.equal(byVersion['v0.2c'].status, 'built');     // subcmd discover
  assert.equal(byVersion['v0.4a'].status, 'built');     // lib sealed-tests
  assert.equal(byVersion['v0.5a'].status, 'built');     // lib conductor
});

// ── The SPEC-mandated UNBUILT-OR-PARTIAL classifications (the big rocks) ─────

test('@unit reconcile: Dream Expander / Bundle A Security / auto-handoff → unbuilt (no signal)', () => {
  const { byVersion } = classify();
  assert.equal(byVersion['v0.3a'].status, 'unbuilt');   // nothing named "expander"
  assert.equal(byVersion['v0.2b'].status, 'unbuilt');   // nothing named "security"
  assert.equal(byVersion['v0.4b'].status, 'unbuilt');   // nothing named "handoff"
});

test('@unit reconcile: full Documentalist / polymorphic Reality Check → partial (compound, half-matched)', () => {
  const { byVersion } = classify();
  // documentalist lib exists but "Context Worker" does not → partial.
  assert.equal(byVersion['v0.5b'].status, 'partial');
  // reality-check lib exists but "Mockup" does not → partial.
  assert.equal(byVersion['v0.6'].status, 'partial');
});

test('@unit reconcile: Plan-Review Worker is never "built" (unbuilt or partial)', () => {
  const { byVersion } = classify();
  assert.notEqual(byVersion['v0.3b'].status, 'built');
  assert.ok(['unbuilt', 'partial'].includes(byVersion['v0.3b'].status));
});

test('@unit reconcile: NONE of the six big rocks is classified "built"', () => {
  const { byVersion } = classify();
  for (const v of ['v0.3a', 'v0.3b', 'v0.2b', 'v0.5b', 'v0.6', 'v0.4b']) {
    assert.notEqual(byVersion[v].status, 'built', `${v} must not be built`);
  }
});

test('@unit reconcile: each entry carries a human-readable signal string', () => {
  const { byVersion } = classify();
  assert.match(byVersion['v0.3'].signal, /lib dream-catcher/);
  assert.equal(byVersion['v0.3a'].signal, '(none)');
});

// ── tag-presence weak signal ────────────────────────────────────────────────

test('@unit reconcile: a numeric version with a shipped tag but no name signal → partial (not unbuilt)', () => {
  // "v0.4 — Mystery capability" has no name signal, but tags v0.4.x exist.
  const roadmap = '### v0.4 — Mystery capability nobody named  *(1 day)*\n';
  const out = reconcileRoadmap({ roadmapText: roadmap, inventory: INVENTORY });
  assert.equal(out.entries[0].status, 'partial');
  assert.match(out.entries[0].signal, /tag v0\.4\.x shipped/);
});

test('@unit reconcile: a lettered version (v0.4b) does NOT borrow the v0.4.x tag', () => {
  const roadmap = '### v0.4b — Mystery lettered capability  *(1 day)*\n';
  const out = reconcileRoadmap({ roadmapText: roadmap, inventory: INVENTORY });
  assert.equal(out.entries[0].status, 'unbuilt');
});

// ── A fully-matched compound → built ────────────────────────────────────────

test('@unit reconcile: a compound where EVERY concept matches → built', () => {
  const roadmap = '### v0.9 — discover + serve  *(1 day)*\n';
  const out = reconcileRoadmap({ roadmapText: roadmap, inventory: INVENTORY });
  assert.equal(out.entries[0].status, 'built');
});

// ── Degradation (never throws) ──────────────────────────────────────────────

test('@unit reconcile: malformed roadmapText → empty entries, never throws', () => {
  for (const bad of [undefined, null, 42, {}, []]) {
    const out = reconcileRoadmap({ roadmapText: bad, inventory: INVENTORY });
    assert.equal(out.heuristic, true);
    assert.deepEqual(out.entries, []);
  }
});

test('@unit reconcile: missing/empty inventory → every entry "unknown", never throws', () => {
  for (const badInv of [undefined, null, 'nope']) {
    const out = reconcileRoadmap({ roadmapText: ROADMAP, inventory: badInv });
    assert.ok(out.entries.length > 0);
    for (const e of out.entries) assert.equal(e.status, 'unknown');
  }
});

test('@unit reconcile: no args at all → empty entries, never throws', () => {
  assert.doesNotThrow(() => reconcileRoadmap());
  assert.doesNotThrow(() => reconcileRoadmap({}));
  const out = reconcileRoadmap({});
  assert.deepEqual(out.entries, []);
});
