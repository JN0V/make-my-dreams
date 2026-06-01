// @unit tests for the "Constitution suggestions" section in buildReport
// (SPEC_V06B AC-2). buildReport stays a pure transform: with constitutionText
// it renders the advisory section; without it, the section is omitted and the
// rest of the report is byte-compatible with pre-v0.6.b.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildReport } from '../../lib/discover/report.js';

const FROZEN_CLOCK = new Date('2026-05-17T12:00:00.000Z');

function base(extra = {}) {
  return {
    targetDir: '/fake/target',
    scanData: {
      methodologies: {},
      languages: { top5: ['.js'], total: 3 },
      frameworks: { language: 'javascript' },
      git: { is_git_repo: true, default_branch: 'main' },
    },
    ingestData: null,
    inferredMd: '# Inferred conventions\n\n## Stack\nJS',
    caseLabel: 'brownfield-app',
    version: '0.6.1',
    clock: FROZEN_CLOCK,
    ...extra,
  };
}

test('@unit buildReport: no constitutionText → no suggestions section (back-compat)', () => {
  const md = buildReport(base());
  assert.doesNotMatch(md, /Constitution suggestions/);
  // Inferred is still immediately followed by Hypotheses.
  assert.match(md, /## Inferred[\s\S]*## Hypotheses to validate/);
});

test('@unit buildReport: null constitutionText behaves like absent', () => {
  const md = buildReport(base({ constitutionText: null }));
  assert.doesNotMatch(md, /Constitution suggestions/);
});

test('@unit buildReport: empty/whitespace constitutionText → section omitted', () => {
  assert.doesNotMatch(buildReport(base({ constitutionText: '' })), /Constitution suggestions/);
  assert.doesNotMatch(buildReport(base({ constitutionText: '   \n ' })), /Constitution suggestions/);
});

test('@unit buildReport: thin constitution → section present, advisory + heuristic + non-destructive', () => {
  const md = buildReport(base({ constitutionText: 'We value KISS and keep the README updated.' }));
  assert.match(md, /## Constitution suggestions \(advisory — your constitution is never modified\)/);
  assert.match(md, /[Hh]euristic/);
  assert.match(md, /never modified|untouched|elle reste/i);
  // Solid on the themes it touched...
  assert.match(md, /looks solid on:.*[Dd]esign principles/);
  // ...and flags the gaps in plain language (no MMD-internal module paths).
  assert.match(md, /Consider adding/);
  assert.match(md, /Testing discipline/);
  assert.match(md, /Security practices/);
  assert.doesNotMatch(md, /\.specify\/memory\/constitution\//);
});

test('@unit buildReport: section sits between Inferred and Hypotheses when present', () => {
  const md = buildReport(base({ constitutionText: 'KISS' }));
  assert.match(md, /## Inferred[\s\S]*## Constitution suggestions[\s\S]*## Hypotheses to validate/);
});
