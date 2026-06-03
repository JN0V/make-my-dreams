// @unit tests for profile threading in lib/invoke-autodev.js.
//
// AC-4 (SPEC_V03B): MMD_PROFILE survives the env allowlist.
// AC-4 (SPEC_V03C): buildPrompt now injects the COMPOSED constitution modules
//   bound to the profile (Layer C), superseding v0.3.b's single hardcoded Kid
//   line, with a graceful null→fallback. These tests inject a fake `composeFn`
//   so they stay pure (no fs, no real claude) and can exercise BOTH the
//   inject-success path AND the null-fallback path. The real composer is wired
//   end to end in test/integration/constitution-compose-real.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt, buildSubprocessEnv } from '../../lib/invoke-autodev.js';

// ── AC-4 (SPEC_V03B): MMD_PROFILE reaches the subprocess via the allowlist ──

test('@unit AC-4: buildSubprocessEnv keeps MMD_PROFILE (MMD_ prefix allowlist)', () => {
  const out = buildSubprocessEnv({ MMD_PROFILE: 'Kid', PATH: '/usr/bin' });
  assert.equal(out.MMD_PROFILE, 'Kid');
});

test('@unit AC-4: MMD_PROFILE survives alongside stripped secrets', () => {
  const out = buildSubprocessEnv({
    MMD_PROFILE: 'Pro',
    AWS_SECRET_ACCESS_KEY: 'shh',
    GITHUB_TOKEN: 'ghp_x',
    HOME: '/home/x',
  });
  assert.equal(out.MMD_PROFILE, 'Pro');
  assert.equal(out.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(out.GITHUB_TOKEN, undefined);
  assert.equal(out.HOME, '/home/x');
});

// ── AC-4 (SPEC_V03C): buildPrompt injects the composed constitution ──

const base = { dream: 'une appli pour dessiner', slug: 'appli-dessiner', demoDir: '/tmp/demo/x' };

// A fake composer: returns a sentinel block for any profile, capturing the
// profile it was called with so we can assert it was the NORMALIZED value.
function fakeComposer() {
  const calls = [];
  const fn = ({ profile }) => {
    calls.push(profile);
    return `## Constitution — fake\n\nCOMPOSED-FOR-${profile}`;
  };
  fn.calls = calls;
  return fn;
}

const nullComposer = () => null;
const throwingComposer = () => { throw new Error('composer blew up'); };

test('@unit AC-4: unset MMD_PROFILE leaves the prompt unchanged (back-compat)', () => {
  const composeFn = fakeComposer();
  const without = buildPrompt({ ...base, env: {}, composeFn });
  assert.doesNotMatch(without, /Audience profile/);
  assert.doesNotMatch(without, /Constitution/);
  assert.equal(composeFn.calls.length, 0, 'composer not even invoked when profile unset');
});

test('@unit AC-4: empty/whitespace MMD_PROFILE is treated as unset', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: '   ' }, composeFn: fakeComposer() });
  assert.doesNotMatch(p, /Audience profile/);
  assert.doesNotMatch(p, /Constitution/);
});

test('@unit AC-4: a custom prompt (--here) short-circuits, profile NOT injected', () => {
  const p = buildPrompt({ ...base, prompt: 'CUSTOM HERE PROMPT', env: { MMD_PROFILE: 'Kid' }, composeFn: fakeComposer() });
  assert.equal(p, 'CUSTOM HERE PROMPT');
});

// ── Field-bug fix: the dream/scope is NOT inlined in the prompt ──────────────
// A Dream Catcher scope is a multi-paragraph product brief. Inlining it after
// `/bmad-adv-auto-dev` (as the slash-command argument) mangled it (newlines /
// length / markdown). It is already written verbatim to .mmd/shared/slice.md by
// initStateFiles, so the greenfield prompt must POINT to that file, not embed it.

test('@unit greenfield prompt does NOT inline the dream — it points at slice.md', () => {
  const nastyDream =
    '## Kitchen Timer — Scope\n\nA `multi-paragraph` brief with "quotes",\n' +
    'newlines, and a $shell-ish token. ' + 'x'.repeat(1200);
  const p = buildPrompt({ dream: nastyDream, slug: 'kitchen-timer', demoDir: '/tmp/demo/k', env: {} });
  // The raw brief must NOT appear in the /bmad-adv-auto-dev argument.
  assert.doesNotMatch(p, /Kitchen Timer — Scope/, 'the raw multi-paragraph dream must not be inlined');
  assert.ok(!p.includes(nastyDream), 'the verbatim dream string must not be embedded in the prompt');
  // It must direct the agent to READ the dream from the state file (which holds it).
  assert.match(p, /\.mmd\/shared\/slice\.md/, 'the prompt must point at .mmd/shared/slice.md for the dream');
  assert.match(p, /READ the full dream/i);
});

test('@unit AC-4: a set profile is stated AND the composed block is injected', () => {
  const composeFn = fakeComposer();
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Pro' }, composeFn });
  assert.match(p, /Audience profile: Pro\./);
  assert.match(p, /Project constitution modules bound to this profile/);
  assert.match(p, /COMPOSED-FOR-Pro/);
  assert.deepEqual(composeFn.calls, ['Pro'], 'composer called with the normalized profile');
});

test('@unit AC-4: the composer receives the NORMALIZED profile (enfant → Kid)', () => {
  const composeFn = fakeComposer();
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'enfant' }, composeFn });
  assert.match(p, /Audience profile: Kid\./);
  assert.match(p, /COMPOSED-FOR-Kid/);
  assert.deepEqual(composeFn.calls, ['Kid']);
});

test('@unit AC-4: NO double-inject — composed present means the hardcoded Kid line is absent', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Kid' }, composeFn: fakeComposer() });
  assert.match(p, /COMPOSED-FOR-Kid/);
  // The v0.3.b fallback line must NOT also appear when the composer succeeded.
  assert.doesNotMatch(p, /Kid safe-by-default \(NON-NEGOTIABLE\)/);
});

test('@unit AC-4: null composition + Kid → graceful fallback to the v0.3.b minimal line', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Kid' }, composeFn: nullComposer });
  assert.match(p, /Audience profile: Kid\./);
  assert.match(p, /Kid safe-by-default \(NON-NEGOTIABLE\)/);
  assert.match(p, /offline/i);
  assert.match(p, /third-party/i);
  // No composed block when the composer returned null.
  assert.doesNotMatch(p, /Project constitution modules bound to this profile/);
});

test('@unit AC-4: null composition + non-Kid → no fallback constraints (Pro has none)', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Pro' }, composeFn: nullComposer });
  assert.match(p, /Audience profile: Pro\./);
  assert.doesNotMatch(p, /Kid safe-by-default/);
  assert.doesNotMatch(p, /Project constitution modules bound to this profile/);
});

test('@unit AC-4: a throwing composer never breaks the build (treated as null)', () => {
  let p;
  assert.doesNotThrow(() => {
    p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Kid' }, composeFn: throwingComposer });
  });
  // Falls back to the minimal Kid line, build still produced.
  assert.match(p, /Kid safe-by-default \(NON-NEGOTIABLE\)/);
});

test('@unit AC-4: profile block composes with the FAST engine block', () => {
  const p = buildPrompt({ ...base, engine: 'fast', env: { MMD_PROFILE: 'Kid' }, composeFn: fakeComposer() });
  assert.match(p, /Engine: FAST/);
  assert.match(p, /Audience profile: Kid\./);
  assert.match(p, /COMPOSED-FOR-Kid/);
});
