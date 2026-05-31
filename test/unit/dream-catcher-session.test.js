// @unit tests for lib/dream-catcher/session.js — SPEC_V03A1 AC-1 + SPEC_V03A2 AC-2.
// Pure: the elicitation runner is injected, so no real claude/web/fs is touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSession, STATES } from '../../lib/dream-catcher/session.js';

/**
 * A fake elicit runner that records its calls. For ask_question turns it returns
 * a scripted question; otherwise (autonome/synthesize) it returns a scope.
 */
function fakeElicit(scope = 'a synthesized scope long enough', over = {}) {
  const calls = [];
  let qn = 0;
  const fn = async (ctx) => {
    calls.push(ctx);
    if (ctx.mode === 'ask_question') {
      qn += 1;
      return { ok: true, fallback: false, question: `question ${qn}?` };
    }
    return { ok: true, fallback: false, scope, ...over };
  };
  fn.calls = calls;
  return fn;
}

/** Drive a session to SCOPE for a given level, answering each clarifying turn. */
async function driveToScope(s, level, answerText = 'my answer') {
  s.setDream('une appli pour dessiner');
  s.setProfile('Curieux');
  let r = await s.setLevel(level);
  while (r.next === 'question') {
    r = await s.answerClarify(answerText);
  }
  return r;
}

test('@unit createSession requires an elicit runner', () => {
  assert.throws(() => createSession({}), TypeError);
  assert.throws(() => createSession(), TypeError);
});

test('@unit advances dream → profile → level → scope → confirm (Autonome)', async () => {
  const elicit = fakeElicit();
  const s = createSession({ elicit });
  assert.equal(s.state, STATES.DREAM);

  assert.deepEqual(s.setDream('une appli pour dessiner'), { next: STATES.PROFILE });
  assert.equal(s.state, STATES.PROFILE);

  assert.deepEqual(s.setProfile('Curieux'), { next: STATES.LEVEL });
  assert.equal(s.state, STATES.LEVEL);
  assert.equal(s.profile, 'Curious');

  const r = await s.setLevel('Autonome');
  assert.equal(r.next, STATES.SCOPE);
  assert.equal(s.state, STATES.SCOPE);
  assert.equal(r.scope, 'a synthesized scope long enough');

  const c = s.confirm();
  assert.equal(s.state, STATES.CONFIRM);
  assert.equal(c.scope, 'a synthesized scope long enough');
});

test('@unit setProfile no longer synthesizes — it only advances to level', () => {
  const elicit = fakeElicit();
  const s = createSession({ elicit });
  s.setDream('draw');
  const r = s.setProfile('Pro');
  assert.deepEqual(r, { next: STATES.LEVEL });
  assert.equal(elicit.calls.length, 0); // nothing synthesized yet
});

test('@unit profile/level questions come in order (cannot set profile/level first)', async () => {
  const s = createSession({ elicit: fakeElicit() });
  assert.throws(() => s.setProfile('Kid'), /not allowed in state "dream"/);
  s.setDream('draw');
  await assert.rejects(() => s.setLevel('Autonome'), /not allowed in state "profile"/);
});

test('@unit Autonome (N=0): exactly ONE synthesize, a-1 {dream,profile} call shape', async () => {
  const elicit = fakeElicit();
  const s = createSession({ elicit });
  await driveToScope(s, 'Autonome');
  assert.equal(s.synthesizeCount, 1);
  assert.equal(elicit.calls.length, 1);
  // The autonome synthesize preserves the a-1 shape exactly (no mode/previousAnswers).
  assert.deepEqual(elicit.calls[0], { dream: 'une appli pour dessiner', profile: 'Curious' });
  assert.equal(s.answers.length, 0);
});

test('@unit Équilibré (N=1): one question, then synthesize; exactly one synthesize', async () => {
  const elicit = fakeElicit();
  const s = createSession({ elicit });
  s.setDream('une appli pour dessiner');
  s.setProfile('Curieux');
  const q = await s.setLevel('Équilibré');
  assert.equal(q.next, 'question');
  assert.equal(typeof q.question, 'string');
  assert.equal(s.state, STATES.CLARIFY);

  const r = await s.answerClarify('pour des enfants de 6 ans');
  assert.equal(r.next, STATES.SCOPE);
  assert.equal(s.state, STATES.SCOPE);
  assert.equal(s.synthesizeCount, 1);
  assert.equal(s.answers.length, 1);
  assert.deepEqual(s.answers[0], { question: 'question 1?', answer: 'pour des enfants de 6 ans' });

  // ask_question call + one synthesize call.
  const modes = elicit.calls.map((c) => c.mode);
  assert.deepEqual(modes, ['ask_question', 'synthesize']);
});

test('@unit Guidé (N=2): two questions, then synthesize; answers[] records both', async () => {
  const elicit = fakeElicit();
  const s = createSession({ elicit });
  s.setDream('un jeu');
  s.setProfile('Pro');
  let r = await s.setLevel('Guidé');
  assert.equal(r.next, 'question');
  r = await s.answerClarify('plateforme');
  assert.equal(r.next, 'question'); // still asking
  assert.equal(s.answers.length, 1);
  r = await s.answerClarify('solo');
  assert.equal(r.next, STATES.SCOPE);
  assert.equal(s.answers.length, 2);
  assert.equal(s.synthesizeCount, 1); // exactly one synthesize for all levels
  assert.deepEqual(s.answers.map((a) => a.answer), ['plateforme', 'solo']);
  // the synthesize received all prior Q&A
  const synth = elicit.calls.find((c) => c.mode === 'synthesize');
  assert.equal(synth.previousAnswers.length, 2);
});

test('@unit a bad/unknown level defaults to Équilibré (1 turn), never throws', async () => {
  const elicit = fakeElicit();
  const s = createSession({ elicit });
  s.setDream('draw');
  s.setProfile('Curieux');
  const r = await s.setLevel('not-a-level');
  assert.equal(s.level, 'Équilibré');
  assert.equal(r.next, 'question'); // Équilibré → 1 turn
});

test('@unit guided path degrades honestly when ask_question yields no question', async () => {
  // elicit returns no usable question → session synthesizes instead of hanging.
  const calls = [];
  const elicit = async (ctx) => {
    calls.push(ctx);
    if (ctx.mode === 'ask_question') return { ok: false, fallback: true, scope: 'verbatim' };
    return { ok: true, fallback: false, scope: 'a fine synthesized scope here' };
  };
  const s = createSession({ elicit });
  s.setDream('draw');
  s.setProfile('Curieux');
  const r = await s.setLevel('Équilibré');
  assert.equal(r.next, STATES.SCOPE); // degraded straight to synthesize
  assert.equal(s.synthesizeCount, 1);
});

test('@unit fallback result is surfaced honestly on the session (Autonome)', async () => {
  const elicit = fakeElicit('the verbatim dream', { ok: false, fallback: true, reason: 'exit code 7' });
  const s = createSession({ elicit });
  s.setDream('the verbatim dream');
  s.setProfile('Curious');
  const r = await s.setLevel('Autonome');
  assert.equal(r.fallback, true);
  assert.equal(r.fallbackReason, 'exit code 7');
  assert.equal(s.usedFallback, true);
  assert.equal(r.scope, 'the verbatim dream');
});

test('@unit a runner that returns no usable scope still never leaves scope null', async () => {
  const elicit = async (ctx) => {
    if (ctx.mode === 'ask_question') return { ok: true, question: 'q?' };
    return { ok: false, fallback: true, scope: '' }; // empty
  };
  const s = createSession({ elicit });
  s.setDream('my dream verbatim');
  s.setProfile('Curious');
  const r = await s.setLevel('Autonome');
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

test('@unit invalid profile is normalized to Curious, not thrown', () => {
  const s = createSession({ elicit: fakeElicit() });
  s.setDream('draw');
  const r = s.setProfile('not-a-profile');
  assert.deepEqual(r, { next: STATES.LEVEL });
  assert.equal(s.profile, 'Curious');
});

test('@unit confirm is illegal before a scope exists', () => {
  const s = createSession({ elicit: fakeElicit() });
  assert.throws(() => s.confirm(), /not allowed in state "dream"/);
  s.setDream('draw');
  assert.throws(() => s.confirm(), /not allowed in state "profile"/);
  s.setProfile('Pro');
  assert.throws(() => s.confirm(), /not allowed in state "level"/);
});

/* ─────────── editScope (AC-4) ─────────── */

test('@unit editScope replaces the scope, stays in SCOPE, no extra elicit call', async () => {
  const elicit = fakeElicit();
  const s = createSession({ elicit });
  await driveToScope(s, 'Autonome');
  const callsBefore = elicit.calls.length;
  const r = s.editScope('  my hand-edited scope, plenty long  ');
  assert.deepEqual(r, { next: STATES.SCOPE, scope: 'my hand-edited scope, plenty long' });
  assert.equal(s.scope, 'my hand-edited scope, plenty long');
  assert.equal(s.state, STATES.SCOPE);
  assert.equal(elicit.calls.length, callsBefore); // no relaunch
  assert.equal(s.usedFallback, false); // an edit is the user's own words
});

test('@unit editScope rejects empty / non-string / oversized text', async () => {
  const s = createSession({ elicit: fakeElicit() });
  await driveToScope(s, 'Autonome');
  assert.throws(() => s.editScope(''), TypeError);
  assert.throws(() => s.editScope('   '), TypeError);
  assert.throws(() => s.editScope(42), TypeError);
  assert.throws(() => s.editScope('x'.repeat(5000)), RangeError);
});

test('@unit editScope is rejected outside the SCOPE state', () => {
  const s = createSession({ elicit: fakeElicit() });
  assert.throws(() => s.editScope('whatever long enough'), /not allowed in state "dream"/);
  s.setDream('draw');
  assert.throws(() => s.editScope('whatever long enough'), /not allowed in state "profile"/);
});

test('@unit confirm launches with the EDITED scope', async () => {
  const s = createSession({ elicit: fakeElicit() });
  await driveToScope(s, 'Autonome');
  s.editScope('the edited scope we actually want to build');
  const c = s.confirm();
  assert.equal(c.scope, 'the edited scope we actually want to build');
});

/* ─────────── bad-state input rejection ─────────── */

test('@unit answerClarify is rejected outside CLARIFY', async () => {
  const s = createSession({ elicit: fakeElicit() });
  s.setDream('draw');
  s.setProfile('Curieux');
  await assert.rejects(() => s.answerClarify('x'), /not allowed in state "level"/);
});

test('@unit restart returns to dream and clears level + answers', async () => {
  const s = createSession({ elicit: fakeElicit() });
  s.setDream('draw');
  s.setProfile('Pro');
  await s.setLevel('Guidé');
  await s.answerClarify('one answer');
  assert.ok(s.answers.length >= 1);
  assert.deepEqual(s.restart(), { next: STATES.DREAM });
  assert.equal(s.state, STATES.DREAM);
  assert.equal(s.dream, null);
  assert.equal(s.scope, null);
  assert.equal(s.synthesizeCount, 0);
  assert.equal(s.answers.length, 0);
  assert.equal(s.level, 'Équilibré');
  // and the cycle can run again cleanly (Autonome this time)
  const r = await driveToScope(s, 'Autonome');
  assert.equal(r.next, STATES.SCOPE);
});
