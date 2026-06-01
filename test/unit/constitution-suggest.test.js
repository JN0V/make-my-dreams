// @unit tests for lib/discover/constitution-suggest.js (SPEC_V06B AC-1).
//
// Exhaustive over the four input classes the spec names: rich / thin / empty /
// malformed. Asserts the function is pure, stable, never throws, and honestly
// classifies governance themes by keyword heuristic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  suggestConstitutionImprovements,
  CHECKED_THEMES,
} from '../../lib/discover/constitution-suggest.js';

// A constitution touching every theme MMD checks.
const RICH = `
# Constitution
## Testing — write @unit tests, red→green on every failure, track coverage.
## Commit & git — atomic commits, branch first, push, conventional commit style.
## Security — validate input, never commit a secret, least privilege.
## Error handling — degrade gracefully, never throw silently, log exceptions.
## Design — SOLID, KISS, DRY, separation of concerns.
## Documentation — keep the README and ADRs current, write docstrings.
## AI coding — honest LLM failure reporting, prompt hygiene, context budget.
`;

// A deliberately thin constitution: only KISS + documentation (the spec's
// mission-validation example).
const THIN = `
# Constitution
We value KISS: keep it simple. Keep the README and documentation up to date.
`;

test('@unit suggestConstitutionImprovements: shape is {present[], missing[{theme,suggestion}]}', () => {
  const out = suggestConstitutionImprovements(RICH);
  assert.ok(Array.isArray(out.present));
  assert.ok(Array.isArray(out.missing));
  for (const m of out.missing) {
    assert.equal(typeof m.theme, 'string');
    assert.equal(typeof m.suggestion, 'string');
    assert.ok(m.theme.length > 0 && m.suggestion.length > 0);
  }
  // Every theme is classified exactly once (present XOR missing).
  assert.equal(out.present.length + out.missing.length, CHECKED_THEMES.length);
});

test('@unit suggestConstitutionImprovements: rich constitution → most/all themes present', () => {
  const out = suggestConstitutionImprovements(RICH);
  assert.equal(out.missing.length, 0, `expected no gaps, got: ${out.missing.map((m) => m.theme).join(', ')}`);
  assert.equal(out.present.length, CHECKED_THEMES.length);
});

test('@unit suggestConstitutionImprovements: thin constitution → flags the gaps, keeps the hits', () => {
  const out = suggestConstitutionImprovements(THIN);
  assert.ok(out.present.includes('Design principles'), 'KISS → design principles present');
  assert.ok(out.present.includes('Documentation'), 'README/docs → documentation present');
  const missingThemes = out.missing.map((m) => m.theme);
  assert.ok(missingThemes.includes('Testing discipline'));
  assert.ok(missingThemes.includes('Commit & branch workflow'));
  assert.ok(missingThemes.includes('Security practices'));
  assert.ok(missingThemes.includes('Error handling'));
});

test('@unit suggestConstitutionImprovements: empty / whitespace → all missing, never throws', () => {
  for (const input of ['', '   \n\t  ']) {
    const out = suggestConstitutionImprovements(input);
    assert.equal(out.present.length, 0);
    assert.equal(out.missing.length, CHECKED_THEMES.length);
  }
});

test('@unit suggestConstitutionImprovements: malformed / non-string → all missing, never throws', () => {
  for (const input of [undefined, null, 42, {}, [], true]) {
    let out;
    assert.doesNotThrow(() => { out = suggestConstitutionImprovements(input); });
    assert.equal(out.present.length, 0);
    assert.equal(out.missing.length, CHECKED_THEMES.length);
  }
});

test('@unit suggestConstitutionImprovements: case-insensitive', () => {
  const upper = suggestConstitutionImprovements('SOLID, KISS, DRY');
  const lower = suggestConstitutionImprovements('solid, kiss, dry');
  assert.ok(upper.present.includes('Design principles'));
  assert.deepEqual(upper, lower);
});

test('@unit suggestConstitutionImprovements: PURE + stable — same input, same output', () => {
  const a = suggestConstitutionImprovements(THIN);
  const b = suggestConstitutionImprovements(THIN);
  assert.deepEqual(a, b);
});
