// @integration tests for Layer C against the REAL repo modules — SPEC_V03C
// AC-3 (real .specify/memory/constitution/*.md) + AC-4 (buildPrompt wired to
// the real composer, no injection). This proves the end-to-end binding:
// MMD_PROFILE → constitution-bindings.yaml → module files → prompt. No spawn,
// no real claude — buildPrompt and composeConstitution are pure over fs reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeConstitution } from '../../lib/constitution-compose.js';
import { buildPrompt } from '../../lib/invoke-autodev.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOD_DIR = path.join(REPO_ROOT, '.specify', 'memory', 'constitution');
// Read each module from the SAME source the composer reads, so the assertions
// never hardcode prose that the .md file owns (L-007).
const readModule = (name) => readFileSync(path.join(MOD_DIR, `${name}.md`), 'utf8').trim();

const base = { dream: 'une appli pour dessiner', slug: 'appli-dessiner', demoDir: '/tmp/demo/x' };

// ── AC-3: composeConstitution against the real modules ──

test('@integration AC-3: Kid composes the real universal+ai-coding+safe-by-default+kid', () => {
  const out = composeConstitution({ profile: 'Kid' });
  assert.ok(out, 'real Kid composition is non-null');
  assert.match(out, /## Constitution — universal/);
  assert.match(out, /## Constitution — ai-coding/);
  assert.match(out, /## Constitution — safe-by-default/);
  assert.match(out, /## Constitution — kid/);
  // Real bodies present, in full (not a one-liner).
  assert.ok(out.includes(readModule('safe-by-default')));
  assert.ok(out.includes(readModule('kid')));
});

test('@integration AC-3: Pro composes the real pro.md and not the kid module', () => {
  const out = composeConstitution({ profile: 'Pro' });
  assert.ok(out);
  assert.match(out, /## Constitution — pro/);
  assert.ok(out.includes(readModule('pro')));
  assert.doesNotMatch(out, /## Constitution — kid/);
});

test('@integration AC-3: module order is deterministic (defaults before profile)', () => {
  const out = composeConstitution({ profile: 'Kid' });
  const order = ['universal', 'ai-coding', 'safe-by-default', 'kid']
    .map((n) => out.indexOf(`## Constitution — ${n}`));
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1] >= 0 && order[i] > order[i - 1], `module ${i} out of order`);
  }
});

// ── AC-4: buildPrompt wired to the REAL composer (no injection) ──

test('@integration AC-4: buildPrompt Kid carries the full safe-by-default + kid text', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Kid' } });
  assert.match(p, /Audience profile: Kid\./);
  assert.match(p, /Project constitution modules bound to this profile/);
  assert.ok(p.includes(readModule('safe-by-default')), 'full safe-by-default.md body in prompt');
  assert.ok(p.includes(readModule('kid')), 'full kid.md body in prompt');
  // Supersedes v0.3.b: the single hardcoded fallback line is NOT used here.
  assert.doesNotMatch(p, /Kid safe-by-default \(NON-NEGOTIABLE\): the generated app MUST NOT use the network/);
});

test('@integration AC-4: buildPrompt Pro carries pro.md and NOT the Kid constraints', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Pro' } });
  assert.match(p, /Audience profile: Pro\./);
  assert.ok(p.includes(readModule('pro')));
  assert.doesNotMatch(p, /## Constitution — kid/);
  assert.doesNotMatch(p, /No social, no contact with strangers/);
});

test('@integration AC-4: unset MMD_PROFILE leaves the real prompt unchanged', () => {
  const p = buildPrompt({ ...base, env: {} });
  assert.doesNotMatch(p, /Audience profile/);
  assert.doesNotMatch(p, /## Constitution —/);
});

test('@integration AC-4: bindingsPath that does not exist degrades to null (no crash)', () => {
  // Simulates the "unreadable bindings" degradation that drives buildPrompt's
  // fallback — composeConstitution must return null, never throw.
  let out;
  assert.doesNotThrow(() => {
    out = composeConstitution({ profile: 'Kid', bindingsPath: path.join(REPO_ROOT, 'no-such-bindings.yaml') });
  });
  assert.equal(out, null);
});
