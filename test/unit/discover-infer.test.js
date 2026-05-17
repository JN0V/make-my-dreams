// @unit tests for lib/discover/infer.js — deterministic summaries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  summarizeStack,
  summarizeNaming,
  summarizeTests,
  summarizeDocs,
  runInfer,
  writeInferred,
} from '../../lib/discover/infer.js';

async function tmp() {
  return await mkdtemp(path.join(os.tmpdir(), 'mmd-infer-'));
}

test('@unit summarizeStack: typed JS project with vitest + eslint', () => {
  const data = {
    frameworks: { language: 'javascript', package_manager: 'npm', test_runner: 'vitest', frameworks: ['react'] },
    lint: { eslint: true, prettier: true, biome: false },
  };
  const r = summarizeStack(data);
  assert.match(r, /Javascript project/);
  assert.match(r, /npm/);
  assert.match(r, /vitest/);
  assert.match(r, /react/);
  assert.match(r, /ESLint\+Prettier/);
});

test('@unit summarizeStack: empty scan → "No recognized language manifests detected"', () => {
  const r = summarizeStack({});
  assert.match(r, /No recognized language manifests detected/);
});

test('@unit summarizeStack: null input → graceful fallback', () => {
  assert.equal(summarizeStack(null), 'No scan data available');
});

test('@unit summarizeNaming: includes TypeScript: yes when ts in frameworks', () => {
  const data = {
    languages: { top5: ['.ts', '.tsx', '.json'], total: 42 },
    frameworks: { language: 'typescript', frameworks: ['typescript'] },
  };
  const r = summarizeNaming(data);
  assert.match(r, /TypeScript: yes/);
  assert.match(r, /total files scanned: 42/);
});

test('@unit summarizeNaming: TypeScript: no when no ts signal', () => {
  const data = {
    languages: { top5: ['.js'], total: 1 },
    frameworks: { language: 'javascript', frameworks: [] },
  };
  assert.match(summarizeNaming(data), /TypeScript: no/);
});

test('@unit summarizeTests: detects test/ dir with *.test.js', async () => {
  const t = await tmp();
  try {
    await mkdir(path.join(t, 'test'), { recursive: true });
    await writeFile(path.join(t, 'test', 'foo.test.js'), '', 'utf8');
    const r = await summarizeTests(t, { frameworks: { test_runner: 'node:test' } });
    assert.match(r, /Runner: node:test/);
    assert.match(r, /test\/ \(1 test files\)/);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit summarizeTests: no test dirs → reports none', async () => {
  const t = await tmp();
  try {
    const r = await summarizeTests(t, { frameworks: {} });
    assert.match(r, /no recognized test dirs/);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit summarizeDocs: README + CONTRIBUTING + CHANGELOG detected', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'README.md'), 'line1\nline2\n', 'utf8');
    await writeFile(path.join(t, 'CONTRIBUTING.md'), '', 'utf8');
    await writeFile(path.join(t, 'CHANGELOG.md'), '', 'utf8');
    const r = await summarizeDocs(t);
    assert.match(r, /README.md \(\d+ lines\)/);
    assert.match(r, /CONTRIBUTING.md/);
    assert.match(r, /CHANGELOG.md/);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit summarizeDocs: empty dir → "No common documentation files detected"', async () => {
  const t = await tmp();
  try {
    const r = await summarizeDocs(t);
    assert.equal(r, 'No common documentation files detected');
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit runInfer: produces a markdown body with all expected sections', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'README.md'), 'hi', 'utf8');
    const scanData = {
      frameworks: { language: 'javascript', test_runner: 'node:test', frameworks: [] },
      lint: { eslint: false, prettier: false, biome: false },
      languages: { top5: ['.js'], total: 1 },
    };
    const md = await runInfer(t, scanData);
    assert.match(md, /# Inferred conventions/);
    assert.match(md, /## Stack/);
    assert.match(md, /## Naming and structure/);
    assert.match(md, /## Tests/);
    assert.match(md, /## Docs/);
    assert.match(md, /## Commits/);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit runInfer: --infer-with-claude appends an "not yet implemented" note', async () => {
  const t = await tmp();
  try {
    const scanData = {
      frameworks: { language: 'javascript' },
      lint: {},
      languages: { top5: [], total: 0 },
    };
    const md = await runInfer(t, scanData, { useClaude: true });
    assert.match(md, /--infer-with-claude/);
    assert.match(md, /NOT yet implemented/);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit writeInferred: writes the markdown to .mmd/shared/project-onboarder/inferred.md', async () => {
  const t = await tmp();
  try {
    const file = await writeInferred(t, '# inferred\n');
    assert.ok(file.endsWith(path.join('.mmd', 'shared', 'project-onboarder', 'inferred.md')));
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});
