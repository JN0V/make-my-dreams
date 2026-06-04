// @unit tests for lib/conductor/model-policy.js — the PURE, env-overridable
// model policy (SPEC_V016A AC-1, ADR-055). Mirrors the handoff / alignment-gate
// pure-helper suites: deterministic, never-throws, every role default + the
// per-role override + the unknown/empty→null fallback + null-safety, all with no
// spawn and no real env.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { modelForRole, ROLES, DEFAULTS } from '../../lib/conductor/model-policy.js';

// ── AC-1: the cost-aware defaults per role ──────────────────────────────────

test('@unit AC-1: orchestrator defaults to the LIGHT model (sonnet)', () => {
  assert.equal(modelForRole('orchestrator', {}), 'sonnet');
});

test('@unit AC-1: spec + impl default to the STRONG model (opus)', () => {
  assert.equal(modelForRole('spec', {}), 'opus');
  assert.equal(modelForRole('impl', {}), 'opus');
});

test('@unit AC-1: review / judge / tester / unblock default to sonnet', () => {
  assert.equal(modelForRole('review', {}), 'sonnet');
  assert.equal(modelForRole('judge', {}), 'sonnet');
  assert.equal(modelForRole('tester', {}), 'sonnet');
  assert.equal(modelForRole('unblock', {}), 'sonnet');
});

test('@unit AC-1: every exported role resolves to its DEFAULTS entry with empty env', () => {
  for (const role of ROLES) {
    assert.equal(modelForRole(role, {}), DEFAULTS[role], `role ${role}`);
  }
});

// ── AC-1: MMD_MODEL_<ROLE> overrides a single role ──────────────────────────

test('@unit AC-1: MMD_MODEL_<ROLE> overrides that role only', () => {
  const env = { MMD_MODEL_IMPL: 'haiku' };
  assert.equal(modelForRole('impl', env), 'haiku');
  // other roles are unaffected by another role's override
  assert.equal(modelForRole('spec', env), 'opus');
  assert.equal(modelForRole('orchestrator', env), 'sonnet');
});

test('@unit AC-1: the override is case-insensitive on the role argument', () => {
  const env = { MMD_MODEL_ORCHESTRATOR: 'opus' };
  assert.equal(modelForRole('ORCHESTRATOR', env), 'opus');
  assert.equal(modelForRole('  Orchestrator  ', env), 'opus');
});

test('@unit AC-1: an empty / whitespace override falls through to the default', () => {
  assert.equal(modelForRole('judge', { MMD_MODEL_JUDGE: '' }), 'sonnet');
  assert.equal(modelForRole('judge', { MMD_MODEL_JUDGE: '   ' }), 'sonnet');
});

test('@unit AC-1: an override value is trimmed', () => {
  assert.equal(modelForRole('tester', { MMD_MODEL_TESTER: '  haiku  ' }), 'haiku');
});

// ── AC-1: unknown / empty role → null (CLI default) ─────────────────────────

test('@unit AC-1: an unknown role → null (use the CLI default)', () => {
  assert.equal(modelForRole('coder', {}), null);
  assert.equal(modelForRole('nonsense', { MMD_MODEL_NONSENSE: 'opus' }), null);
});

test('@unit AC-1: an empty role → null', () => {
  assert.equal(modelForRole('', {}), null);
  assert.equal(modelForRole('   ', {}), null);
});

// ── AC-1: pure, deterministic, never throws on odd input ────────────────────

test('@unit AC-1: null-safe — null/undefined/non-string role never throws → null', () => {
  assert.equal(modelForRole(null, {}), null);
  assert.equal(modelForRole(undefined, {}), null);
  assert.equal(modelForRole(42, {}), null);
  assert.equal(modelForRole({}, {}), null);
});

test('@unit AC-1: null/undefined/non-object env never throws → defaults', () => {
  assert.equal(modelForRole('spec', null), 'opus');
  assert.equal(modelForRole('spec', undefined), 'opus');
  assert.equal(modelForRole('spec', 'not-an-object'), 'opus');
});

test('@unit AC-1: deterministic — same inputs give the same output', () => {
  const env = { MMD_MODEL_REVIEW: 'opus' };
  assert.equal(modelForRole('review', env), modelForRole('review', env));
});

test('@unit AC-1: ROLES + DEFAULTS are frozen (shared policy is immutable)', () => {
  assert.ok(Object.isFrozen(ROLES));
  assert.ok(Object.isFrozen(DEFAULTS));
  assert.equal(ROLES.length, Object.keys(DEFAULTS).length);
});
