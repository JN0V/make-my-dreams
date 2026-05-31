// @unit tests for lib/dream-catcher/session.js — SPEC_V03A1 AC-1.
// Pure: the elicitation runner is injected, so no real claude/web/fs is touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSession, STATES } from '../../lib/dream-catcher/session.js';

/** A fake elicit runner that records its calls and returns a canned scope. */
function fakeElicit(scope = 'a synthesized scope long enough', over = {}) {
  const calls = [];
  const fn = async (ctx) => {
    calls.push(ctx);
    return { ok: true, fallback: false, scope, ...over };
  };
  fn.calls = calls;
  return fn;
}

test('@unit createSession requires an elicit runner', () => {
  assert.throws(() => createSession({}), TypeError);
  assert.throws(() => createSession(), TypeError);
});

test('@unit advances deterministically dream → profile → scope → confirm', async () => {
  const elicit = fakeElicit();
  const s = createSession({ elicit });
  assert.equal(s.state, STATES.DREAM);

  assert.deepEqual(s.setDream('une appli pour dessiner'), { next: STATES.PROFILE });
  assert.equal(s.state, STATES.PROFILE);
  assert.equal(s.dream, 'une appli pour dessiner');

  const r = await s.setProfile('Curieux');
  assert.equal(r.next, STATES.SCOPE);
  assert.equal(s.state, STATES.SCOPE);
  assert.equal(r.profile, 'Curious');
  assert.equal(r.scope, 'a synthesized scope long enough');

  const c = s.confirm();
  assert.equal(s.state, STATES.CONFIRM);
  assert.equal(c.scope, 'a synthesized scope long enough');
  assert.equal(c.profile, 'Curious');
});

test('@unit profile question comes AFTER the dream (cannot set profile first)', () => {
  const s = createSession({ elicit: fakeElicit() });
  assert.rejects(() => s.setProfile('Kid'), /not allowed in state "dream"/);
});

test('@unit performs EXACTLY ONE synthesize call (autonomous path)', async () => {
  const elicit = fakeElicit();
  const s = createSession({ elicit });
  s.setDream('draw stuff');
  await s.setProfile('Pro');
  assert.equal(s.synthesizeCount, 1);
  assert.equal(elicit.calls.length, 1);
  // the synthesize call received the dream + normalized profile
  assert.deepEqual(elicit.calls[0], { dream: 'draw stuff', profile: 'Pro' });
});

test('@unit fallback result is surfaced honestly on the session', async () => {
  const elicit = fakeElicit('the verbatim dream', { ok: false, fallback: true, reason: 'exit code 7' });
  const s = createSession({ elicit });
  s.setDream('the verbatim dream');
  const r = await s.setProfile('Curious');
  assert.equal(r.fallback, true);
  assert.equal(r.fallbackReason, 'exit code 7');
  assert.equal(s.usedFallback, true);
  assert.equal(r.scope, 'the verbatim dream');
});

test('@unit a runner that returns no usable scope still never leaves scope null', async () => {
  const elicit = async () => ({ ok: false, fallback: true, scope: '' }); // empty
  const s = createSession({ elicit });
  s.setDream('my dream verbatim');
  const r = await s.setProfile('Curious');
  assert.equal(r.scope, 'my dream verbatim'); // session-level defensive fallback
  assert.equal(r.fallback, true);
  assert.match(r.fallbackReason, /no usable scope/);
});

test('@unit setDream rejects empty / non-string input', () => {
  const s = createSession({ elicit: fakeElicit() });
  assert.throws(() => s.setDream(''), TypeError);
  assert.throws(() => s.setDream('   '), TypeError);
  assert.throws(() => s.setDream(42), TypeError);
});

test('@unit invalid profile is normalized to Curious, not thrown', async () => {
  const s = createSession({ elicit: fakeElicit() });
  s.setDream('draw');
  const r = await s.setProfile('not-a-profile');
  assert.equal(r.profile, 'Curious');
});

test('@unit confirm is illegal before a scope exists', () => {
  const s = createSession({ elicit: fakeElicit() });
  assert.throws(() => s.confirm(), /not allowed in state "dream"/);
  s.setDream('draw');
  assert.throws(() => s.confirm(), /not allowed in state "profile"/);
});

test('@unit restart returns to the dream step and clears state (seam for Recommencer)', async () => {
  const s = createSession({ elicit: fakeElicit() });
  s.setDream('draw');
  await s.setProfile('Kid');
  assert.equal(s.state, STATES.SCOPE);
  assert.deepEqual(s.restart(), { next: STATES.DREAM });
  assert.equal(s.state, STATES.DREAM);
  assert.equal(s.dream, null);
  assert.equal(s.scope, null);
  assert.equal(s.synthesizeCount, 0);
  // and the cycle can run again cleanly
  s.setDream('draw again');
  const r = await s.setProfile('Pro');
  assert.equal(r.next, STATES.SCOPE);
});

test('@unit the clarify seam keeps a-1 at exactly one synthesize (no clarifying turns)', async () => {
  // Documents the a-1 contract: nothing runs between profile and synthesize.
  const elicit = fakeElicit();
  const s = createSession({ elicit });
  s.setDream('draw');
  await s.setProfile('Curious');
  assert.equal(elicit.calls.length, 1);
});
