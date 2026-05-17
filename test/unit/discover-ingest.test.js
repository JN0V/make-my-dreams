// @unit tests for lib/discover/ingest.js — importers + classifyStoryStatus.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  classifyStoryStatus,
  extractStoryTitle,
  importSpecKitConstitution,
  importBmadStories,
  importOpenspec,
  inventoryLooseSpecs,
  runIngest,
} from '../../lib/discover/ingest.js';

async function tmp() {
  return await mkdtemp(path.join(os.tmpdir(), 'mmd-ingest-'));
}

test('@unit classifyStoryStatus: done via frontmatter', () => {
  assert.equal(classifyStoryStatus('---\nstatus: done\n---\n# x'), 'done');
  assert.equal(classifyStoryStatus('status: completed'), 'done');
});

test('@unit classifyStoryStatus: in-progress variants', () => {
  assert.equal(classifyStoryStatus('status: in-progress'), 'in-progress');
  assert.equal(classifyStoryStatus('status: in_progress'), 'in-progress');
  assert.equal(classifyStoryStatus('status: wip'), 'in-progress');
});

test('@unit classifyStoryStatus: draft / obsolete map to draft', () => {
  assert.equal(classifyStoryStatus('status: draft'), 'draft');
  assert.equal(classifyStoryStatus('status: obsolete'), 'draft');
  assert.equal(classifyStoryStatus('status: backlog'), 'draft');
});

test('@unit classifyStoryStatus: no status → unknown', () => {
  assert.equal(classifyStoryStatus('# Story\n\nNo frontmatter.'), 'unknown');
  assert.equal(classifyStoryStatus(null), 'unknown');
});

test('@unit extractStoryTitle: H1 wins', () => {
  assert.equal(extractStoryTitle('# Hello world\n\nbody', 'x.md'), 'Hello world');
});

test('@unit extractStoryTitle: H2 fallback', () => {
  assert.equal(extractStoryTitle('## Second-level\n', 'x.md'), 'Second-level');
});

test('@unit extractStoryTitle: filename fallback', () => {
  assert.equal(extractStoryTitle('plain text no headings', 'story-001-login.md'), 'story-001-login');
});

test('@unit importSpecKitConstitution: returns null when no .specify/memory/constitution.md', async () => {
  const t = await tmp();
  try {
    assert.equal(await importSpecKitConstitution(t), null);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit importSpecKitConstitution: writes imported.md with provenance header', async () => {
  const t = await tmp();
  try {
    await mkdir(path.join(t, '.specify', 'memory'), { recursive: true });
    await writeFile(path.join(t, '.specify', 'memory', 'constitution.md'), '# const\nbody', 'utf8');
    const r = await importSpecKitConstitution(t, { sourceSha: 'abc123' });
    assert.ok(r);
    const raw = await readFile(r.writtenPath, 'utf8');
    assert.match(raw, /imported-from: spec-kit/);
    assert.match(raw, /source-sha: abc123/);
    assert.match(raw, /# const/);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit importBmadStories: returns null when no docs/stories/', async () => {
  const t = await tmp();
  try {
    assert.equal(await importBmadStories(t), null);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit importBmadStories: consolidates 3 stories with their statuses', async () => {
  const t = await tmp();
  try {
    const sd = path.join(t, 'docs', 'stories');
    await mkdir(sd, { recursive: true });
    await writeFile(path.join(sd, 'story-001.md'),
      '---\nstatus: done\n---\n# First', 'utf8');
    await writeFile(path.join(sd, 'story-002.md'),
      '---\nstatus: draft\n---\n# Second', 'utf8');
    await writeFile(path.join(sd, 'story-003.md'),
      '---\nstatus: in-progress\n---\n# Third', 'utf8');
    const r = await importBmadStories(t);
    assert.ok(r);
    assert.equal(r.stories.length, 3);
    // Sorted by id ASC.
    assert.deepEqual(r.stories.map((s) => s.id), ['story-001', 'story-002', 'story-003']);
    const statuses = r.stories.map((s) => s.status);
    assert.deepEqual(statuses.sort(), ['done', 'draft', 'in-progress']);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit importBmadStories: preserves existing status.json keys', async () => {
  const t = await tmp();
  try {
    const sd = path.join(t, 'docs', 'stories');
    await mkdir(sd, { recursive: true });
    await writeFile(path.join(sd, 'a.md'), '---\nstatus: done\n---\n# A', 'utf8');

    const sharedDir = path.join(t, '.mmd', 'shared');
    await mkdir(sharedDir, { recursive: true });
    await writeFile(path.join(sharedDir, 'status.json'),
      JSON.stringify({ slice_id: 'demo-1', state: 'in_progress' }), 'utf8');

    await importBmadStories(t);
    const raw = await readFile(path.join(sharedDir, 'status.json'), 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.slice_id, 'demo-1');
    assert.equal(parsed.state, 'in_progress');
    assert.equal(parsed.stories.length, 1);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit importOpenspec: returns null when no openspec/ dir', async () => {
  const t = await tmp();
  try {
    assert.equal(await importOpenspec(t), null);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit importOpenspec: copies files into .mmd/shared/openspec-imported/', async () => {
  const t = await tmp();
  try {
    await mkdir(path.join(t, 'openspec'), { recursive: true });
    await writeFile(path.join(t, 'openspec', 'project.md'), '# Project', 'utf8');
    await writeFile(path.join(t, 'openspec', 'goal.md'), '# Goal', 'utf8');
    const r = await importOpenspec(t);
    assert.ok(r);
    assert.equal(r.files.length, 2);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit inventoryLooseSpecs: SPEC*.md at root is captured', async () => {
  const t = await tmp();
  try {
    await writeFile(path.join(t, 'SPEC_V02C.md'), '# spec', 'utf8');
    await writeFile(path.join(t, 'PLAN.md'), '# plan', 'utf8');
    const r = await inventoryLooseSpecs(t);
    assert.ok(r);
    assert.equal(r.files.length, 2);
    assert.ok(r.files.includes('SPEC_V02C.md'));
    assert.ok(r.files.includes('PLAN.md'));
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit inventoryLooseSpecs: returns null when nothing matches', async () => {
  const t = await tmp();
  try {
    assert.equal(await inventoryLooseSpecs(t), null);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});

test('@unit runIngest: orchestrates all importers, returns combined summary', async () => {
  const t = await tmp();
  try {
    await mkdir(path.join(t, '.specify', 'memory'), { recursive: true });
    await writeFile(path.join(t, '.specify', 'memory', 'constitution.md'), '# c', 'utf8');
    const sd = path.join(t, 'docs', 'stories');
    await mkdir(sd, { recursive: true });
    await writeFile(path.join(sd, 'a.md'), '---\nstatus: done\n---\n# A', 'utf8');

    const r = await runIngest(t);
    assert.ok(r.spec_kit_constitution);
    assert.ok(r.bmad_stories);
    assert.equal(r.openspec, null);
    assert.equal(r.loose_specs, null);
  } finally {
    await rm(t, { recursive: true, force: true });
  }
});
