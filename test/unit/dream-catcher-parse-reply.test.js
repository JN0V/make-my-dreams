// @unit tests for lib/dream-catcher/parse-reply.js — SPEC_V03A1 AC-2.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseReply } from '../../lib/dream-catcher/parse-reply.js';

test('@unit a normal brief reply IS the scope (autonomous path)', () => {
  const reply = 'Une appli de dessin : un canvas tactile, palette de couleurs, et un bouton pour sauver le dessin.';
  const r = parseReply(reply);
  assert.equal(r.unparseable, undefined);
  assert.equal(r.scope, reply.trim());
});

test('@unit surrounding whitespace is trimmed', () => {
  const r = parseReply('\n\n  a drawing app with a canvas and a save button  \n');
  assert.equal(r.scope, 'a drawing app with a canvas and a save button');
});

test('@unit a single wrapping ```fence is stripped, inner text kept', () => {
  const reply = '```markdown\nA drawing app: canvas + color palette + save.\n```';
  const r = parseReply(reply);
  assert.equal(r.scope, 'A drawing app: canvas + color palette + save.');
});

test('@unit non-string reply is unparseable with a reason', () => {
  for (const bad of [undefined, null, 42, {}, []]) {
    const r = parseReply(bad);
    assert.equal(r.unparseable, true);
    assert.equal(typeof r.reason, 'string');
    assert.equal(r.scope, undefined);
  }
});

test('@unit empty / whitespace-only reply is unparseable (no fabrication)', () => {
  assert.equal(parseReply('').unparseable, true);
  assert.equal(parseReply('    \n\t ').unparseable, true);
});

test('@unit a too-short reply is unparseable rather than a bogus scope', () => {
  const r = parseReply('ok');
  assert.equal(r.unparseable, true);
  assert.match(r.reason, /short/);
});

test('@unit exactly one shape is returned — never both scope and unparseable', () => {
  const good = parseReply('a real scope sentence that is long enough');
  assert.ok('scope' in good && !('unparseable' in good));
  const bad = parseReply('');
  assert.ok('unparseable' in bad && !('scope' in bad));
});
