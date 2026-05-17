// @unit tests for lib/discover/scan.js — detectors against synthetic fixtures.
// Uses isolated tmp dirs; no git operations on the host repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  detectMethodologies,
  detectLanguages,
  detectFrameworks,
  detectLintConfig,
  isAlreadyOnboarded,
  runScan,
  writeScan,
  SCAN_VERSION,
} from '../../lib/discover/scan.js';

async function tmp() {
  return await mkdtemp(path.join(os.tmpdir(), 'mmd-scan-'));
}

test('@unit detectMethodologies: empty dir → all false, stories_count=0', async () => {
  const t = await tmp();
  try {
    const m = await detectMethodologies(t);
    assert.equal(m.spec_kit, false);
    assert.equal(m.bmad, false);
    assert.equal(m.openspec, false);
    assert.equal(m.stories_dir, false);
    assert.equal(m.stories_count, 0);
    assert.equal(m.claude_md, false);
    assert.equal(m.mmd_md, false);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit detectMethodologies: Spec Kit + BMAD detected when both present', async () => {
  const t = await tmp();
  try {
    await mkdir(path.join(t, '.specify'), { recursive: true });
    await mkdir(path.join(t, '_bmad'), { recursive: true });
    const m = await detectMethodologies(t);
    assert.equal(m.spec_kit, true);
    assert.equal(m.bmad, true);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit detectMethodologies: docs/stories/ counts files', async () => {
  const t = await tmp();
  try {
    const sd = path.join(t, 'docs', 'stories');
    await mkdir(sd, { recursive: true });
    for (let i = 0; i < 4; i += 1) {
      await writeFile(path.join(sd, `story-${i}.md`), '# x', 'utf8');
    }
    const m = await detectMethodologies(t);
    assert.equal(m.stories_dir, true);
    assert.equal(m.stories_count, 4);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit isAlreadyOnboarded: no last.md → false', async () => {
  const t = await tmp();
  try {
    assert.equal(await isAlreadyOnboarded(t), false);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit isAlreadyOnboarded: last.md with VALIDATED → true', async () => {
  const t = await tmp();
  try {
    const dir = path.join(t, '.mmd', 'shared', 'project-onboarder');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'last.md'),
      '# foo\n> Status: VALIDATED at 2026-01-01\n', 'utf8');
    assert.equal(await isAlreadyOnboarded(t), true);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit isAlreadyOnboarded: last.md with PENDING → false', async () => {
  const t = await tmp();
  try {
    const dir = path.join(t, '.mmd', 'shared', 'project-onboarder');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'last.md'),
      'Status: PENDING VALIDATION\n', 'utf8');
    assert.equal(await isAlreadyOnboarded(t), false);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit detectLanguages: counts top extensions', async () => {
  const t = await tmp();
  try {
    await mkdir(path.join(t, 'src'), { recursive: true });
    await writeFile(path.join(t, 'src', 'a.js'), '', 'utf8');
    await writeFile(path.join(t, 'src', 'b.js'), '', 'utf8');
    await writeFile(path.join(t, 'src', 'c.ts'), '', 'utf8');
    const l = await detectLanguages(t);
    assert.ok(l.total >= 3);
    assert.ok(l.top5.includes('.js'));
    assert.ok(l.top5.includes('.ts'));
    assert.equal(l.by_ext['.js'], 2);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit detectLanguages: skips .git/, node_modules/', async () => {
  const t = await tmp();
  try {
    await mkdir(path.join(t, '.git'), { recursive: true });
    await writeFile(path.join(t, '.git', 'config'), 'x', 'utf8');
    await mkdir(path.join(t, 'node_modules', 'foo'), { recursive: true });
    await writeFile(path.join(t, 'node_modules', 'foo', 'index.js'), '', 'utf8');
    await writeFile(path.join(t, 'real.js'), '', 'utf8');
    const l = await detectLanguages(t);
    assert.equal(l.by_ext['.js'], 1);
    assert.equal(l.by_ext.config, undefined);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit detectFrameworks: package.json with react + vitest', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'package.json'), JSON.stringify({
      name: 'x',
      dependencies: { react: '18' },
      devDependencies: { vitest: '1', typescript: '5' },
    }), 'utf8');
    const f = await detectFrameworks(t);
    assert.equal(f.language, 'typescript');
    assert.ok(f.frameworks.includes('react'));
    assert.equal(f.test_runner, 'vitest');
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit detectFrameworks: no manifests → language null, no frameworks', async () => {
  const t = await tmp();
  try {
    const f = await detectFrameworks(t);
    assert.equal(f.language, null);
    assert.deepEqual(f.frameworks, []);
    assert.equal(f.test_runner, null);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit detectFrameworks: Python via pyproject.toml', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'pyproject.toml'), '[tool.poetry]\nname = "x"', 'utf8');
    await writeFile(path.join(t, 'pytest.ini'), '[pytest]\n', 'utf8');
    const f = await detectFrameworks(t);
    assert.equal(f.language, 'python');
    assert.equal(f.test_runner, 'pytest');
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit detectLintConfig: eslint + prettier detected via config files', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, '.eslintrc.json'), '{}', 'utf8');
    await writeFile(path.join(t, '.prettierrc'), '{}', 'utf8');
    const c = await detectLintConfig(t);
    assert.equal(c.eslint, true);
    assert.equal(c.prettier, true);
    assert.equal(c.biome, false);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit runScan: returns schema-versioned payload with all sections', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'package.json'), '{"name":"x"}', 'utf8');
    const s = await runScan(t);
    assert.equal(s.scan_version, SCAN_VERSION);
    assert.equal(s.target_dir, t);
    assert.ok(s.methodologies);
    assert.ok(s.languages);
    assert.ok(s.frameworks);
    assert.ok(s.lint);
    assert.ok(s.git);
    assert.equal(s.git.is_git_repo, false); // tmp dir is not a git repo
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit writeScan: persists scan.json under .mmd/shared/project-onboarder/', async () => {
  const t = await tmp();
  try {
    const payload = { scan_version: SCAN_VERSION, foo: 1 };
    const file = await writeScan(t, payload);
    assert.ok(file.endsWith(path.join('.mmd', 'shared', 'project-onboarder', 'scan.json')));
    // file content readable + parseable
    const raw = await (await import('node:fs/promises')).readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.scan_version, SCAN_VERSION);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});
