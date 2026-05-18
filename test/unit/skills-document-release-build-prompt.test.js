// @unit tests for lib/skills/document-release/build-prompt.js — SPEC_V02G AC-4.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDocumentReleasePrompt,
  documentReleasePromptAnchors,
  DOCUMENT_RELEASE_SKILL_PATH,
} from '../../lib/skills/document-release/build-prompt.js';

const VALID_OPTS = {
  fromRef: 'v0.2.4',
  toRef: 'HEAD',
  fromSha: 'fc0962ccdf63f7c99591555e0c611a74c50e04e5',
  toSha: 'deadbeef1234567890abcdef0987654321aabbcc',
  repoRoot: '/tmp/repo',
  outputPath: '/tmp/repo/.mmd/local/document-release-runs/draft.md',
};

test('@unit buildDocumentReleasePrompt: includes both refs verbatim', () => {
  const p = buildDocumentReleasePrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.fromRef), `prompt must mention fromRef ${VALID_OPTS.fromRef}`);
  assert.ok(p.includes(VALID_OPTS.toRef), `prompt must mention toRef ${VALID_OPTS.toRef}`);
});

test('@unit buildDocumentReleasePrompt: includes both SHAs verbatim', () => {
  const p = buildDocumentReleasePrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.fromSha));
  assert.ok(p.includes(VALID_OPTS.toSha));
});

test('@unit buildDocumentReleasePrompt: includes the output path', () => {
  const p = buildDocumentReleasePrompt(VALID_OPTS);
  assert.ok(p.includes(VALID_OPTS.outputPath));
});

test('@unit buildDocumentReleasePrompt: references the gStack skill path', () => {
  const p = buildDocumentReleasePrompt(VALID_OPTS);
  assert.ok(p.includes(DOCUMENT_RELEASE_SKILL_PATH));
  assert.match(DOCUMENT_RELEASE_SKILL_PATH, /document-release\/SKILL\.md$/);
});

test('@unit buildDocumentReleasePrompt: mentions input sources (commits, ADRs, lessons)', () => {
  const p = buildDocumentReleasePrompt(VALID_OPTS);
  assert.match(p, /git log|commit/i);
  assert.match(p, /ADR/);
  assert.match(p, /lessons[- ]learned/i);
});

test('@unit buildDocumentReleasePrompt: declares headless invocation', () => {
  const p = buildDocumentReleasePrompt(VALID_OPTS);
  assert.match(p, /headless|non-interactive/i);
});

test('@unit buildDocumentReleasePrompt: forbids commits/pushes/tags', () => {
  const p = buildDocumentReleasePrompt(VALID_OPTS);
  assert.match(p, /NEVER\s+push/i);
  assert.match(p, /NEVER\s+open\s+PRs?/i);
  assert.match(p, /NEVER\s+create\s+tags?/i);
});

test('@unit buildDocumentReleasePrompt: throws on missing required fields', () => {
  assert.throws(() => buildDocumentReleasePrompt({ ...VALID_OPTS, fromRef: '' }), TypeError);
  assert.throws(() => buildDocumentReleasePrompt({ ...VALID_OPTS, toRef: '' }), TypeError);
  assert.throws(() => buildDocumentReleasePrompt({ ...VALID_OPTS, fromSha: '' }), TypeError);
  assert.throws(() => buildDocumentReleasePrompt({ ...VALID_OPTS, toSha: '' }), TypeError);
  assert.throws(() => buildDocumentReleasePrompt({ ...VALID_OPTS, outputPath: '' }), TypeError);
  assert.throws(() => buildDocumentReleasePrompt(null), TypeError);
});

test('@unit documentReleasePromptAnchors: every anchor present', () => {
  const prompt = buildDocumentReleasePrompt(VALID_OPTS);
  for (const a of documentReleasePromptAnchors(VALID_OPTS)) {
    assert.ok(prompt.includes(a), `prompt missing anchor: ${a}`);
  }
});

test('@unit buildDocumentReleasePrompt: stable shape', () => {
  assert.equal(buildDocumentReleasePrompt(VALID_OPTS), buildDocumentReleasePrompt(VALID_OPTS));
});
