// @unit tests for lib/dream-catcher/cli-driver.js — SPEC_V03B AC-2.
// Pure: the io channel (scripted stdin) and the elicit runner are both injected,
// so no real claude / real TTY / fs is touched. $EDITOR is left unset so the
// edit path exercises the single-line replacement fallback (the editor round-trip
// is best-effort and lives in editor.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCliDreamCatcher } from '../../lib/dream-catcher/cli-driver.js';

/**
 * A scripted io channel. `answers` is consumed one per ask(); when it runs out,
 * ask() returns null (EOF) — modeling an aborted dialogue. print() is recorded.
 */
function scriptedIo(answers) {
  const printed = [];
  let i = 0;
  return {
    printed,
    asked: [],
    async ask(prompt) {
      this.asked.push(prompt);
      return i < answers.length ? answers[i++] : null;
    },
    print(text) {
      printed.push(text);
    },
  };
}

/**
 * A fake elicit runner mirroring runElicit's resolved shape. ask_question turns
 * return a numbered question; everything else returns a scope. Records calls.
 */
function fakeElicit(scope = 'A small drawing app: one touch canvas, a palette, a Save button.') {
  const calls = [];
  let qn = 0;
  const fn = async (ctx) => {
    calls.push(ctx);
    if (ctx.mode === 'ask_question') {
      qn += 1;
      return { ok: true, fallback: false, question: `Question ${qn} ?` };
    }
    return { ok: true, fallback: false, scope };
  };
  fn.calls = calls;
  return fn;
}

const noEnv = {}; // no EDITOR → edit uses the single-line replacement prompt

test('@unit AC-2: Autonome skips the question loop and confirms on Entrée', async () => {
  const elicit = fakeElicit('Autonome scope text');
  // profile=enfant, level=auto, menu=Entrée (confirm)
  const io = scriptedIo(['enfant', 'auto', '']);
  const r = await runCliDreamCatcher({ dream: 'une appli pour dessiner', io, elicit, env: noEnv });

  assert.equal(r.confirmed, true);
  assert.equal(r.profile, 'Kid');
  assert.equal(r.scope, 'Autonome scope text');
  // No ask_question call happened (Autonome = 0 turns).
  assert.equal(elicit.calls.filter((c) => c.mode === 'ask_question').length, 0);
  // Exactly one synthesize/autonome call.
  assert.equal(elicit.calls.length, 1);
  // The scope was printed.
  assert.ok(io.printed.some((t) => t.includes('Autonome scope text')));
});

test('@unit AC-2: Guidé drives the clarifying-question loop then confirms', async () => {
  const elicit = fakeElicit('Guided scope');
  // profile=pro, level=guidé (2 turns), answer1, answer2, menu=Entrée
  const io = scriptedIo(['pro', 'guidé', 'rouge', 'tactile', '']);
  const r = await runCliDreamCatcher({ dream: 'une appli pour dessiner', io, elicit, env: noEnv });

  assert.equal(r.confirmed, true);
  assert.equal(r.profile, 'Pro');
  assert.equal(r.scope, 'Guided scope');
  // Two questions were asked + printed.
  assert.equal(elicit.calls.filter((c) => c.mode === 'ask_question').length, 2);
  assert.ok(io.printed.some((t) => t.includes('Question 1 ?')));
  assert.ok(io.printed.some((t) => t.includes('Question 2 ?')));
});

test('@unit AC-2: returns {scope, profile, confirmed} shape', async () => {
  const io = scriptedIo(['curieux', 'auto', '']);
  const r = await runCliDreamCatcher({ dream: 'd', io, elicit: fakeElicit('S'), env: noEnv });
  assert.deepEqual(Object.keys(r).sort(), ['confirmed', 'profile', 'scope']);
  assert.equal(typeof r.confirmed, 'boolean');
});

test('@unit AC-2: [R]ecommencer restarts from the profile step, then confirms', async () => {
  const elicit = fakeElicit('Restarted scope');
  // pass 1: profile, level, menu=R (restart)
  // pass 2: profile, level, menu=Entrée (confirm)
  const io = scriptedIo(['enfant', 'auto', 'r', 'pro', 'auto', '']);
  const r = await runCliDreamCatcher({ dream: 'une appli', io, elicit, env: noEnv });

  assert.equal(r.confirmed, true);
  // The SECOND pass's profile (pro) wins — proof the restart re-ran from profile.
  assert.equal(r.profile, 'Pro');
  // Two autonome synthesize calls (one per pass).
  assert.equal(elicit.calls.length, 2);
});

test('@unit AC-2: [M]odifier replaces the scope via the single-line prompt', async () => {
  const elicit = fakeElicit('Original synthesized scope');
  // profile, level, menu=M, new scope line, menu=Entrée
  const io = scriptedIo(['curieux', 'auto', 'm', 'My hand-edited scope', '']);
  const r = await runCliDreamCatcher({ dream: 'une appli', io, elicit, env: noEnv });

  assert.equal(r.confirmed, true);
  assert.equal(r.scope, 'My hand-edited scope');
});

test('@unit AC-2: empty edit keeps the existing scope', async () => {
  const elicit = fakeElicit('Kept scope');
  // profile, level, menu=M, empty replacement line, menu=Entrée
  const io = scriptedIo(['curieux', 'auto', 'm', '', '']);
  const r = await runCliDreamCatcher({ dream: 'une appli', io, elicit, env: noEnv });

  assert.equal(r.confirmed, true);
  assert.equal(r.scope, 'Kept scope');
});

test('@unit AC-2: EOF (null answer) aborts — confirmed:false, no launch', async () => {
  const elicit = fakeElicit('never confirmed');
  // profile, level, then EOF at the menu (answers run out → null)
  const io = scriptedIo(['curieux', 'auto']);
  const r = await runCliDreamCatcher({ dream: 'une appli', io, elicit, env: noEnv });

  assert.equal(r.confirmed, false);
});

test('@unit AC-2: EOF at the profile step aborts immediately', async () => {
  const elicit = fakeElicit();
  const io = scriptedIo([]); // first ask (profile) → null
  const r = await runCliDreamCatcher({ dream: 'une appli', io, elicit, env: noEnv });
  assert.equal(r.confirmed, false);
  // The session never synthesized.
  assert.equal(elicit.calls.length, 0);
});

test('@unit AC-2: unrecognized menu input re-prompts (never launches on garbage)', async () => {
  const elicit = fakeElicit('S');
  // profile, level, garbage menu input, then Entrée
  const io = scriptedIo(['curieux', 'auto', 'xyz', '']);
  const r = await runCliDreamCatcher({ dream: 'une appli', io, elicit, env: noEnv });
  assert.equal(r.confirmed, true);
  assert.ok(io.printed.some((t) => /non reconnue/i.test(t)));
});

test('@unit AC-2: honest fallback scope is flagged to the user', async () => {
  // elicit returns a fallback (BMAD failed → verbatim dream as scope).
  const elicit = async () => ({ ok: false, fallback: true, scope: 'verbatim dream', reason: 'boom' });
  const io = scriptedIo(['curieux', 'auto', '']);
  const r = await runCliDreamCatcher({ dream: 'verbatim dream', io, elicit, env: noEnv });
  assert.equal(r.confirmed, true);
  assert.equal(r.scope, 'verbatim dream');
  assert.ok(io.printed.some((t) => /synthèse BMAD/i.test(t)));
});

test('@unit AC-2: invalid args throw (programmer error, not user input)', async () => {
  await assert.rejects(() => runCliDreamCatcher({ dream: '', io: scriptedIo([]), elicit: fakeElicit() }), TypeError);
  await assert.rejects(() => runCliDreamCatcher({ dream: 'd', io: null, elicit: fakeElicit() }), TypeError);
  await assert.rejects(() => runCliDreamCatcher({ dream: 'd', io: scriptedIo([]), elicit: null }), TypeError);
});
