// @unit tests for lib/dream-catcher/elicit.js — SPEC_V03A1 AC-2.
// Pure: the `spawn` dependency is injected, so no real claude is ever launched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  buildElicitPrompt,
  resolveElicitMode,
  runElicit,
  DEFAULT_ELICIT_TIMEOUT_MS,
} from '../../lib/dream-catcher/elicit.js';

/**
 * Build a fake child process + a spawn() that returns it, scripted to emit the
 * given stdout/stderr then exit with `code` on the next tick. Records the
 * (cmd, args, opts) it was called with for assertions.
 */
function fakeSpawn({ stdout = '', stderr = '', code = 0, throwOn = false } = {}) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (throwOn) throw new Error('boom');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('exit', code, null);
    });
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

test('@unit buildElicitPrompt is autonomous: headless, no-questions, walking-skeleton cap', () => {
  const p = buildElicitPrompt({ dream: 'une appli pour dessiner', profile: 'Curious' });
  assert.match(p, /bmad-product-brief/);
  assert.match(p, /HEADLESS/);
  assert.match(p, /Ask NO questions/i);
  assert.match(p, /ONE primary capability/i);
  assert.match(p, /2 small extras/i);
  assert.match(p, /une appli pour dessiner/);
});

test('@unit buildElicitPrompt injects Kid safe-by-default framing only for Kid', () => {
  const kid = buildElicitPrompt({ dream: 'a game', profile: 'Enfant' });
  assert.match(kid, /safe-by-default/i);
  assert.match(kid, /offline/i);
  const pro = buildElicitPrompt({ dream: 'a game', profile: 'Pro' });
  assert.doesNotMatch(pro, /safe-by-default/i);
});

test('@unit resolveElicitMode mirrors the autodev switch', () => {
  assert.equal(resolveElicitMode({ MMD_AUTODEV_MODE: 'cli' }), 'cli');
  assert.equal(resolveElicitMode({ MMD_AUTODEV_MODE: 'test' }), 'test');
  assert.equal(resolveElicitMode({ MMD_AUTODEV_CMD: '/x/fake.sh' }), 'test');
  assert.equal(resolveElicitMode({}), 'cli');
});

test('@unit happy path: a clean reply becomes the scope', async () => {
  const spawn = fakeSpawn({ stdout: 'A drawing app: canvas + palette + save button.', code: 0 });
  const r = await runElicit({ dream: 'draw stuff', profile: 'Curious', env: {}, spawn });
  assert.equal(r.ok, true);
  assert.equal(r.fallback, false);
  assert.equal(r.scope, 'A drawing app: canvas + palette + save button.');
});

test('@unit CLI mode passes `-p <prompt>` as the args array', async () => {
  const spawn = fakeSpawn({ stdout: 'a scope long enough to be valid', code: 0 });
  await runElicit({ dream: 'draw', profile: 'Pro', env: { MMD_AUTODEV_MODE: 'cli' }, spawn });
  assert.equal(spawn.calls[0].args[0], '-p');
  assert.match(spawn.calls[0].args[1], /bmad-product-brief/);
  assert.equal(spawn.calls[0].opts.shell, false); // §V/A03
});

test('@unit non-zero exit → honest fallback to the verbatim dream (no fabrication)', async () => {
  const spawn = fakeSpawn({ stderr: 'kaboom', code: 7 });
  const r = await runElicit({ dream: 'my verbatim dream', profile: 'Curious', env: {}, spawn });
  assert.equal(r.ok, false);
  assert.equal(r.fallback, true);
  assert.equal(r.scope, 'my verbatim dream');
  assert.match(r.reason, /code 7/);
});

test('@unit empty/unparseable reply → honest fallback', async () => {
  const spawn = fakeSpawn({ stdout: '   ', code: 0 });
  const r = await runElicit({ dream: 'verbatim', profile: 'Curious', env: {}, spawn });
  assert.equal(r.fallback, true);
  assert.equal(r.scope, 'verbatim');
  assert.match(r.reason, /unparseable/);
});

test('@unit spawn throwing → honest fallback, never rejects', async () => {
  const spawn = fakeSpawn({ throwOn: true });
  const r = await runElicit({ dream: 'verbatim dream', profile: 'Curious', env: {}, spawn });
  assert.equal(r.fallback, true);
  assert.equal(r.scope, 'verbatim dream');
  assert.match(r.reason, /spawn failed/);
});

test('@unit subprocess error event → honest fallback', async () => {
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => child.emit('error', new Error('ENOENT-ish')));
    return child;
  };
  const r = await runElicit({ dream: 'verbatim', profile: 'Curious', env: {}, spawn });
  assert.equal(r.fallback, true);
  assert.match(r.reason, /subprocess error/);
});

test('@unit timeout → SIGTERM + honest fallback', async () => {
  let killed = false;
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { killed = true; }; // never emits exit → timer must fire
    return child;
  };
  const r = await runElicit({ dream: 'verbatim', profile: 'Curious', env: {}, spawn, timeoutMs: 20 });
  assert.equal(r.fallback, true);
  assert.match(r.reason, /timed out/);
  assert.equal(killed, true);
});

test('@unit empty dream → immediate fallback, no spawn attempted', async () => {
  const spawn = fakeSpawn({ stdout: 'should not run' });
  const r = await runElicit({ dream: '   ', profile: 'Curious', env: {}, spawn });
  assert.equal(r.fallback, true);
  assert.equal(spawn.calls.length, 0);
});

test('@unit DEFAULT_ELICIT_TIMEOUT_MS is a sane positive number', () => {
  assert.ok(Number.isFinite(DEFAULT_ELICIT_TIMEOUT_MS) && DEFAULT_ELICIT_TIMEOUT_MS > 0);
});
