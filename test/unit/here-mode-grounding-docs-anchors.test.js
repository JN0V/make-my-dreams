// @unit anchor-presence tests for SPEC_V02H AC-5 documentation. Cheap guards
// that the README paragraph / ADR-013 / ai-coding §VI rule are present so a
// future edit that drops them fails loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('@unit AC-5: README documents the grounding check, exit 6, and the escape hatch', () => {
  const md = read('README.md');
  assert.match(md, /[Pp]rompt-grounding check/);
  assert.match(md, /code 6|exit.*6/i);
  assert.match(md, /MMD_SKIP_GROUNDING=1/);
  assert.match(md, /git cat-file -e/);
  assert.match(md, /ADR-013/);
});

test('@unit AC-5: ADR-013 exists and covers the key rationale points', () => {
  const p = 'docs/adr/013-prompt-grounding-check.md';
  assert.ok(existsSync(path.join(REPO_ROOT, p)), `${p} must exist`);
  const md = read(p);
  assert.match(md, /# ADR-013:/);
  assert.match(md, /closed-pattern/i); // why regex over LLM extraction
  assert.match(md, /sub-100ms|<100ms/i); // deterministic, cost-free, fast
  assert.match(md, /exit code 6/i); // why exit 6 (v0.2.j map consistency)
  assert.match(md, /escape hatch/i); // why the escape hatch (false positives)
  assert.match(md, /L-015/); // the origin
});

test('@unit AC-5: ai-coding.md §VI carries the prompt-grounding rule', () => {
  const md = read('.specify/memory/constitution/ai-coding.md');
  assert.match(md, /\*\*Prompt-grounding\*\*/);
  assert.match(md, /every file path cited in a dream MUST exist on the launch base/);
  assert.match(md, /MMD_SKIP_GROUNDING/);
  assert.match(md, /ADR-013/);
});
