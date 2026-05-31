// @integration tests for the CLI Dream Catcher surface — SPEC_V03B AC-2/AC-3.
//
// Exercises the REAL integration: the cli-driver drives the REAL session core and
// the REAL runElicit, which spawns a fake `claude` via MMD_AUTODEV_CMD (the
// fake-claude-elicit fixture — the real claude is NEVER invoked). Stdin is
// scripted (one queued answer per ask()), proving the driver + real elicitation
// + real subprocess spawn work end to end with scripted input. The thin readline
// wrapper (bin/mmd.js#createReadlineIo) is exercised in production; here we focus
// the integration on the driver↔elicit↔subprocess seam, which is what carries
// risk (the readline-over-a-finished-Readable behavior is a Node quirk, not MMD
// logic, and would only make this test flaky).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { runCliDreamCatcher } from '../../lib/dream-catcher/cli-driver.js';
import { runElicit } from '../../lib/dream-catcher/elicit.js';

const FIXTURE = path.resolve(
  fileURLToPath(new URL('../fixtures/fake-claude-elicit.sh', import.meta.url)),
);

/**
 * A scripted stdin io. `lines` are consumed one per ask(); after they run out
 * ask() returns null (EOF → the driver aborts, no launch). Records prints.
 */
function scriptedReadlineIo(lines) {
  const printed = [];
  let i = 0;
  return {
    printed,
    async ask() {
      return i < lines.length ? lines[i++] : null;
    },
    print(text) {
      printed.push(text);
    },
    close() {},
  };
}

/** The real elicit runner, wired to the fake-claude fixture (never real claude). */
function fakeElicitEnv(extra = {}) {
  return { ...process.env, MMD_AUTODEV_CMD: FIXTURE, MMD_AUTODEV_MODE: 'test', ...extra };
}

test('@integration AC-3: Curious + Autonome walks the real elicit and confirms', async () => {
  const env = fakeElicitEnv();
  const io = scriptedReadlineIo(['curieux', 'auto', '']); // profile, level, Entrée=confirm
  let result;
  try {
    result = await runCliDreamCatcher({
      dream: 'une appli pour dessiner',
      io,
      elicit: (ctx) => runElicit({ ...ctx, env }),
    });
  } finally {
    io.close();
  }
  assert.equal(result.confirmed, true);
  assert.equal(result.profile, 'Curious');
  // The fixture returns its non-Kid canned scope for a Curious autonome run.
  assert.match(result.scope, /drawing app/i);
});

test('@integration AC-3: Kid profile flows into the real elicit prompt (safe-by-default scope)', async () => {
  const env = fakeElicitEnv();
  const io = scriptedReadlineIo(['enfant', 'auto', '']);
  let result;
  try {
    result = await runCliDreamCatcher({
      dream: 'une appli pour dessiner',
      io,
      elicit: (ctx) => runElicit({ ...ctx, env }),
    });
  } finally {
    io.close();
  }
  assert.equal(result.confirmed, true);
  assert.equal(result.profile, 'Kid');
  // The fixture reflects the Kid framing back (its prompt carried "safe-by-default"),
  // proving the chosen profile reached the real elicitation prompt.
  assert.match(result.scope, /Hors-ligne|sans compte|sans reseau/i);
});

test('@integration AC-3: Guidé runs N clarifying turns over the real elicit', async () => {
  const env = fakeElicitEnv();
  // profile, level=guidé (2 turns), answer1, answer2, confirm
  const io = scriptedReadlineIo(['pro', 'guidé', 'rouge', 'tactile', '']);
  let result;
  try {
    result = await runCliDreamCatcher({
      dream: 'une appli pour dessiner',
      io,
      elicit: (ctx) => runElicit({ ...ctx, env }),
    });
  } finally {
    io.close();
  }
  assert.equal(result.confirmed, true);
  assert.equal(result.profile, 'Pro');
  // Two clarifying questions were printed (the fixture emits a QUESTION marker).
  const printed = io.printed.join('\n');
  assert.match(printed, /Quelle couleur/i);
});

test('@integration AC-3: EOF before confirm aborts — confirmed:false (no launch)', async () => {
  const env = fakeElicitEnv();
  const io = scriptedReadlineIo(['curieux', 'auto']); // no menu line → EOF at the menu
  let result;
  try {
    result = await runCliDreamCatcher({
      dream: 'une appli pour dessiner',
      io,
      elicit: (ctx) => runElicit({ ...ctx, env }),
    });
  } finally {
    io.close();
  }
  assert.equal(result.confirmed, false);
});
