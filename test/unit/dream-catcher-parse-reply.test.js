// @unit tests for lib/dream-catcher/parse-reply.js — SPEC_V03A1 AC-2.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseReply,
  QUESTION_MARKER,
  SCOPE_MARKER,
} from '../../lib/dream-catcher/parse-reply.js';

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

/* ─────────── a-2: deterministic QUESTION / SCOPE tagging ─────────── */

test('@unit a QUESTION-tagged reply returns {question}, marker stripped', () => {
  const r = parseReply(`${QUESTION_MARKER} Quelle couleur préfères-tu ?`);
  assert.equal(r.question, 'Quelle couleur préfères-tu ?');
  assert.equal(r.scope, undefined);
  assert.equal(r.unparseable, undefined);
});

test('@unit a QUESTION marker with no text is unparseable (no fabrication)', () => {
  const r = parseReply(`${QUESTION_MARKER}   `);
  assert.equal(r.unparseable, true);
  assert.equal(r.question, undefined);
});

test('@unit a SCOPE-tagged reply returns {scope}, marker stripped', () => {
  const r = parseReply(`${SCOPE_MARKER} A drawing app: a touch canvas, a palette, and a Save button.`);
  assert.equal(r.scope, 'A drawing app: a touch canvas, a palette, and a Save button.');
  assert.equal(r.question, undefined);
});

test('@unit a multi-line SCOPE-tagged reply keeps the lines after the marker', () => {
  const reply = `${SCOPE_MARKER} A drawing app\n- touch canvas\n- save button`;
  const r = parseReply(reply);
  assert.match(r.scope, /A drawing app/);
  assert.match(r.scope, /touch canvas/);
  assert.match(r.scope, /save button/);
});

test('@unit a SCOPE marker with too-short text is unparseable', () => {
  const r = parseReply(`${SCOPE_MARKER} ok`);
  assert.equal(r.unparseable, true);
});

test('@unit a fence-wrapped tagged reply still detects the marker', () => {
  const r = parseReply('```\nQUESTION: Tu veux du son ?\n```');
  assert.equal(r.question, 'Tu veux du son ?');
});

test('@unit an UNTAGGED reply is still treated as a scope (a-1 path unchanged)', () => {
  const reply = 'A small drawing app with a canvas and a save button, no markers at all.';
  const r = parseReply(reply);
  assert.equal(r.scope, reply.trim());
  assert.equal(r.question, undefined);
});
