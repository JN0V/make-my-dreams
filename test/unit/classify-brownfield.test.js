// @unit tests for the v0.6.a `brownfield-app` case in lib/discover/classify.js.
// Pure function, table-driven — no I/O (testing.md §V: < 100ms total).
//
// AC-1 (SPEC_V06A): `classify` returns 'brownfield-app' when the scan detected a
// recognized stack (frameworks.language OR languages non-empty) but no SDD
// methodology — DISTINCT from 'blank' (a genuinely empty/unstructured repo).
// already-onboarded / rich / bmad-alone still win; malformed input → blank.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify, DISCOVERY_CASES } from '../../lib/discover/classify.js';

// ── Positive: a recognized stack with no SDD → brownfield-app ───────────────

test('@unit classify: frameworks.language set, no methodology → brownfield-app', () => {
  const data = { frameworks: { language: 'typescript' }, methodologies: {} };
  assert.equal(classify(data), 'brownfield-app');
});

test('@unit classify: languages.top5 non-empty (plain JS, no framework lang) → brownfield-app', () => {
  const data = {
    frameworks: { language: null },
    languages: { total: 3, by_ext: { '.js': 2, '.json': 1 }, top5: ['.js', '.json'] },
    methodologies: { spec_kit: false, bmad: false },
  };
  assert.equal(classify(data), 'brownfield-app');
});

test('@unit classify: languages.total > 0 but top5 empty → brownfield-app (defensive)', () => {
  const data = { languages: { total: 5, by_ext: {}, top5: [] }, methodologies: {} };
  assert.equal(classify(data), 'brownfield-app');
});

test('@unit classify: languages given as a plain array (legacy shape) non-empty → brownfield-app', () => {
  const data = { languages: ['javascript'], methodologies: {} };
  assert.equal(classify(data), 'brownfield-app');
});

test('@unit classify: Python repo (frameworks.language=python) → brownfield-app', () => {
  const data = { frameworks: { language: 'python' }, methodologies: { stories_count: 2 } };
  assert.equal(classify(data), 'brownfield-app');
});

// ── Negative: truly empty / unstructured → still blank ──────────────────────

test('@unit classify: no language, no languages, no methodology → blank', () => {
  assert.equal(classify({ methodologies: {} }), 'blank');
  assert.equal(classify({ frameworks: { language: null }, methodologies: {} }), 'blank');
});

test('@unit classify: empty languages object (total 0, empty top5) → blank', () => {
  const data = { frameworks: { language: null }, languages: { total: 0, by_ext: {}, top5: [] }, methodologies: {} };
  assert.equal(classify(data), 'blank');
});

test('@unit classify: empty languages array → blank', () => {
  assert.equal(classify({ languages: [], methodologies: {} }), 'blank');
});

// ── Priority: rich / bmad-alone / already-onboarded win over brownfield-app ──

test('@unit classify: already_onboarded wins over a recognized stack', () => {
  const data = { already_onboarded: true, frameworks: { language: 'go' }, methodologies: {} };
  assert.equal(classify(data), 'already-onboarded');
});

test('@unit classify: Spec Kit present + a stack → rich (rich wins over brownfield-app)', () => {
  const data = { frameworks: { language: 'typescript' }, methodologies: { spec_kit: true } };
  assert.equal(classify(data), 'rich');
});

test('@unit classify: BMAD present + a stack → rich (rich wins over brownfield-app)', () => {
  const data = { languages: { top5: ['.js'] }, methodologies: { bmad: true } };
  assert.equal(classify(data), 'rich');
});

test('@unit classify: stories sprawl (>=10) + a stack → bmad-alone (wins over brownfield-app)', () => {
  const data = { frameworks: { language: 'ruby' }, methodologies: { stories_count: 12 } };
  assert.equal(classify(data), 'bmad-alone');
});

// ── Malformed input still degrades to blank (never throws) ──────────────────

test('@unit classify: null / non-object → blank even with the new branch', () => {
  assert.equal(classify(null), 'blank');
  assert.equal(classify(undefined), 'blank');
  assert.equal(classify('nope'), 'blank');
  assert.equal(classify(7), 'blank');
});

test('@unit classify: malformed frameworks/languages do not throw → blank', () => {
  assert.equal(classify({ frameworks: 'oops', languages: 'oops', methodologies: {} }), 'blank');
  assert.equal(classify({ frameworks: 42, languages: null, methodologies: {} }), 'blank');
});

// ── Enum integrity ──────────────────────────────────────────────────────────

test('@unit DISCOVERY_CASES is frozen and now contains exactly the 5 known cases', () => {
  assert.ok(Object.isFrozen(DISCOVERY_CASES));
  assert.deepEqual(
    [...DISCOVERY_CASES].sort(),
    ['already-onboarded', 'blank', 'bmad-alone', 'brownfield-app', 'rich'],
  );
});

test('@unit classify: every return value is in DISCOVERY_CASES (incl. brownfield-app)', () => {
  const inputs = [
    { already_onboarded: true },
    { methodologies: { spec_kit: true } },
    { methodologies: { stories_count: 12 } },
    { frameworks: { language: 'typescript' }, methodologies: {} },
    { methodologies: {} },
    null,
  ];
  for (const i of inputs) {
    const r = classify(i);
    assert.ok(DISCOVERY_CASES.includes(r), `${r} not in DISCOVERY_CASES`);
  }
});
