// test/unit/deps-assess.test.js — AC-1 for the PURE dependency-risk core
// (SPEC_V09B). Covers: unresolvable; the typosquat CONJUNCTION vs each signal
// alone; exact-popular-match is NOT a squat; unverified-on-null-metadata; gateExit
// high-vs-none; and never-throws on garbage input. Tagged @unit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessDependency,
  gateExit,
  editDistance,
  RULES,
  DEFAULT_TYPO_DISTANCE,
  DEFAULT_MIN_AGE_DAYS,
  DEFAULT_MIN_DOWNLOADS,
} from '../../lib/security/deps-assess.js';

const POPULAR = ['requests', 'lodash', 'express', 'numpy', 'react'];

function rulesOf(result) {
  return result.findings.map((f) => f.rule).sort();
}
function severityOf(result, rule) {
  const f = result.findings.find((x) => x.rule === rule);
  return f ? f.severity : null;
}

test('@unit defaults are sane and exported', () => {
  assert.equal(DEFAULT_TYPO_DISTANCE, 2);
  assert.equal(DEFAULT_MIN_AGE_DAYS, 30);
  assert.equal(DEFAULT_MIN_DOWNLOADS, 1000);
});

test('@unit editDistance: exact, one edit, bounded cap', () => {
  assert.equal(editDistance('requests', 'requests'), 0);
  assert.equal(editDistance('reqeusts', 'requests'), 2); // transposition = 2 edits in Levenshtein
  assert.equal(editDistance('lodahs', 'lodash'), 2);
  assert.equal(editDistance('abcdefg', 'z', 2), 3); // exceeds cap → cap+1
  assert.equal(editDistance(null, 'x'), Infinity); // non-string → Infinity, never throws
});

test('@unit unresolvable: existsInRegistry === false → high unresolvable', () => {
  const r = assessDependency({
    name: 'totally-made-up-pkg',
    metadata: { existsInRegistry: false },
    popularNames: POPULAR,
  });
  assert.deepEqual(rulesOf(r), [RULES.UNRESOLVABLE]);
  assert.equal(severityOf(r, RULES.UNRESOLVABLE), 'high');
});

test('@unit likely-typosquat: the CONJUNCTION (near + new + low-adoption) → single high', () => {
  const r = assessDependency({
    name: 'reqeusts', // distance 2 from "requests"
    metadata: { existsInRegistry: true, firstPublishedDaysAgo: 3, downloads: 5 },
    popularNames: POPULAR,
  });
  assert.deepEqual(rulesOf(r), [RULES.LIKELY_TYPOSQUAT]);
  assert.equal(severityOf(r, RULES.LIKELY_TYPOSQUAT), 'high');
  // The detail names the popular package it is near (human-readable, §VII).
  assert.match(r.findings[0].detail, /requests/);
});

test('@unit each signal ALONE is medium advisory, never high', () => {
  // near-popular only (old + well-adopted)
  const near = assessDependency({
    name: 'lodahs',
    metadata: { existsInRegistry: true, firstPublishedDaysAgo: 4000, downloads: 9_000_000 },
    popularNames: POPULAR,
  });
  assert.deepEqual(rulesOf(near), [RULES.NEAR_POPULAR_NAME]);
  assert.equal(severityOf(near, RULES.NEAR_POPULAR_NAME), 'medium');

  // very-new only (unique name, well-adopted)
  const fresh = assessDependency({
    name: 'my-unique-brand-new-internal-lib',
    metadata: { existsInRegistry: true, firstPublishedDaysAgo: 2, downloads: 5_000_000 },
    popularNames: POPULAR,
  });
  assert.deepEqual(rulesOf(fresh), [RULES.VERY_NEW]);
  assert.equal(severityOf(fresh, RULES.VERY_NEW), 'medium');

  // low-adoption only (unique name, old)
  const niche = assessDependency({
    name: 'my-unique-niche-internal-lib',
    metadata: { existsInRegistry: true, firstPublishedDaysAgo: 2000, downloads: 12 },
    popularNames: POPULAR,
  });
  assert.deepEqual(rulesOf(niche), [RULES.LOW_ADOPTION]);
  assert.equal(severityOf(niche, RULES.LOW_ADOPTION), 'medium');
});

test('@unit two-of-three signals → two mediums, still NOT the high conjunction', () => {
  // near-popular AND very-new, but well-adopted → no high typosquat.
  const r = assessDependency({
    name: 'lodahs',
    metadata: { existsInRegistry: true, firstPublishedDaysAgo: 2, downloads: 5_000_000 },
    popularNames: POPULAR,
  });
  assert.deepEqual(rulesOf(r), [RULES.NEAR_POPULAR_NAME, RULES.VERY_NEW]);
  assert.ok(!r.findings.some((f) => f.severity === 'high'));
});

test('@unit an exact match to a popular name is NOT a typosquat (distance 0) → clean', () => {
  const r = assessDependency({
    name: 'requests',
    metadata: { existsInRegistry: true, firstPublishedDaysAgo: 4000, downloads: 50_000_000 },
    popularNames: POPULAR,
  });
  assert.deepEqual(r.findings, []);
});

test('@unit a healthy, unique, old, popular dep → no findings', () => {
  const r = assessDependency({
    name: 'express',
    metadata: { existsInRegistry: true, firstPublishedDaysAgo: 5000, downloads: 80_000_000 },
    popularNames: POPULAR,
  });
  assert.deepEqual(r.findings, []);
});

test('@unit null/failed metadata → a single unverified medium (honest, never a pass)', () => {
  for (const meta of [null, undefined, 'oops', 42]) {
    const r = assessDependency({ name: 'requests', metadata: meta, popularNames: POPULAR });
    assert.deepEqual(rulesOf(r), [RULES.UNVERIFIED]);
    assert.equal(severityOf(r, RULES.UNVERIFIED), 'medium');
  }
});

test('@unit existsInRegistry neither true nor false → unverified (honest, not a fabricated pass)', () => {
  const r = assessDependency({
    name: 'requests',
    metadata: { existsInRegistry: undefined, downloads: 5 },
    popularNames: POPULAR,
  });
  assert.deepEqual(rulesOf(r), [RULES.UNVERIFIED]);
});

test('@unit opts override the thresholds', () => {
  // With a tiny typoDistance of 1, "reqeusts" (distance 2) is NOT near "requests".
  const r = assessDependency({
    name: 'reqeusts',
    metadata: { existsInRegistry: true, firstPublishedDaysAgo: 1, downloads: 1 },
    popularNames: POPULAR,
    opts: { typoDistance: 1 },
  });
  // No near-popular signal at distance 1 → only the very-new + low-adoption mediums.
  assert.deepEqual(rulesOf(r), [RULES.LOW_ADOPTION, RULES.VERY_NEW]);
  assert.ok(!r.findings.some((f) => f.severity === 'high'));
});

test('@unit never throws on garbage; empty/odd input → { name, findings: [] }', () => {
  assert.deepEqual(assessDependency(undefined), { name: '', findings: [] });
  assert.deepEqual(assessDependency(null), { name: '', findings: [] });
  assert.deepEqual(assessDependency({}), { name: '', findings: [] });
  assert.deepEqual(assessDependency({ name: '' }), { name: '', findings: [] });
  assert.deepEqual(assessDependency({ name: 42 }), { name: '', findings: [] });
  // metadata present but popularNames garbage → no crash, treated as no seed.
  const r = assessDependency({ name: 'x', metadata: { existsInRegistry: true }, popularNames: 'nope' });
  assert.deepEqual(r.findings, []);
});

test('@unit gateExit: 1 iff any high finding, else 0', () => {
  const high = [{ findings: [{ severity: 'medium' }, { severity: 'high' }] }];
  const mediumOnly = [{ findings: [{ severity: 'medium' }] }, { findings: [] }];
  assert.equal(gateExit(high), 1);
  assert.equal(gateExit(mediumOnly), 0);
  assert.equal(gateExit([]), 0);
  assert.equal(gateExit('not-an-array'), 0);
  assert.equal(gateExit([null, { findings: null }]), 0);
});
