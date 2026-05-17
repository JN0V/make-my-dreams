// lib/discover/ingest.js — INGEST phase: structured import of detected artifacts.
//
// SRP: read existing structured artifacts (Spec Kit constitution, BMAD stories,
// OpenSpec files, loose specs at root) and copy / consolidate them into
// `.mmd/shared/`. Never modifies the source files (read-only on target).
//
// Spec: SPEC_V02C AC-3. Writes ONLY in `.mmd/shared/` — every write site goes
// through `assertSafeWritePath` so a regression cannot break the non-intrusion
// invariant.

import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { assertSafeWritePath } from './safe-write.js';

/**
 * Import Spec Kit constitution (single-file or modular) into
 * `.mmd/shared/constitution/imported.md` prefixed with provenance metadata.
 *
 * Returns null when no Spec Kit constitution is present (caller skips silently).
 *
 * @param {string} targetDir
 * @param {{ sourceSha?: string|null }} [opts]
 * @returns {Promise<{ writtenPath: string, source: string }|null>}
 */
export async function importSpecKitConstitution(targetDir, opts = {}) {
  const candidates = [
    path.join(targetDir, '.specify', 'memory', 'constitution.md'),
    path.join(targetDir, '.specify', 'memory', 'constitution', 'index.md'),
  ];
  let source = null;
  let raw = null;
  for (const c of candidates) {
    try {
      raw = await readFile(c, 'utf8');
      source = c;
      break;
    } catch {
      // try next
    }
  }
  if (!source) return null;

  const sha = typeof opts.sourceSha === 'string' && opts.sourceSha.length > 0
    ? opts.sourceSha
    : 'unknown';
  const rel = path.relative(targetDir, source);
  const header =
    `<!-- imported-from: spec-kit -->\n` +
    `<!-- source-path: ${rel} -->\n` +
    `<!-- source-sha: ${sha} -->\n` +
    `\n`;

  const destDir = path.join(targetDir, '.mmd', 'shared', 'constitution');
  const destFile = path.join(destDir, 'imported.md');
  await assertSafeWritePath(targetDir, destFile);
  await mkdir(destDir, { recursive: true });
  await writeFile(destFile, header + raw, 'utf8');
  return { writtenPath: destFile, source };
}

/**
 * Classify a single BMAD story file based on a coarse heuristic over its
 * content. Looks at the first ~50 lines for one of the patterns:
 *   - `status: done` / `status: complete` → 'done'
 *   - `status: in-progress` / `status: in_progress` / `status: wip` → 'in-progress'
 *   - `status: draft` → 'draft'
 *   - else → 'unknown'
 *
 * Pure function (no I/O) — exported for testability.
 *
 * @param {string} content    full story file content
 * @returns {'done'|'in-progress'|'draft'|'unknown'}
 */
export function classifyStoryStatus(content) {
  if (typeof content !== 'string') return 'unknown';
  // Look in first 50 lines only (frontmatter typically).
  const head = content.split(/\r?\n/, 50).join('\n').toLowerCase();
  // Order matters: 'in-progress' before 'progress' substrings; 'done' before
  // 'undone' (we use word boundaries via explicit regex).
  if (/(^|\n)\s*status\s*:\s*(done|complete|completed|delivered|shipped)\b/.test(head)) {
    return 'done';
  }
  if (/(^|\n)\s*status\s*:\s*(in[-_ ]progress|wip|active)\b/.test(head)) {
    return 'in-progress';
  }
  if (/(^|\n)\s*status\s*:\s*(draft|wip|todo|backlog|obsolete|deprecated)\b/.test(head)) {
    return 'draft';
  }
  // Also check H1 / H2 headings — some teams put "Status: Draft" in a header.
  if (/^#{1,3}\s+status\s*:\s*done/im.test(head)) return 'done';
  if (/^#{1,3}\s+status\s*:\s*draft/im.test(head)) return 'draft';
  return 'unknown';
}

/**
 * Read the first H1 (or H2) line from a story file and return it as the title.
 * Falls back to the filename (without extension) when no heading is present.
 *
 * @param {string} content
 * @param {string} filename
 * @returns {string}
 */
export function extractStoryTitle(content, filename) {
  if (typeof content === 'string') {
    const m = content.match(/^\s*#{1,2}\s+(.+?)\s*$/m);
    if (m) return m[1].trim();
  }
  return path.basename(filename, path.extname(filename));
}

/**
 * Walk `docs/stories/` (non-recursive), classify each `.md` file, and write
 * a consolidated payload to `.mmd/shared/status.json` under a `stories` key.
 *
 * Existing fields in status.json (other slices may have written `slice_id`,
 * `state`, etc.) are PRESERVED — we read-modify-write rather than overwrite.
 * This protects the v0.2a `--here` mode contract.
 *
 * Returns null when no stories dir exists.
 *
 * @param {string} targetDir
 * @returns {Promise<{
 *   writtenPath: string,
 *   stories: Array<{ id: string, title: string, status: string, path: string }>
 * }|null>}
 */
export async function importBmadStories(targetDir) {
  const storiesDir = path.join(targetDir, 'docs', 'stories');
  let entries;
  try {
    entries = await readdir(storiesDir, { withFileTypes: true });
  } catch {
    return null;
  }
  /** @type {Array<{ id: string, title: string, status: string, path: string }>} */
  const stories = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith('.md')) continue;
    const abs = path.join(storiesDir, e.name);
    let content = '';
    try { content = await readFile(abs, 'utf8'); } catch { /* skip unreadable */ continue; }
    stories.push({
      id: path.basename(e.name, path.extname(e.name)),
      title: extractStoryTitle(content, e.name),
      status: classifyStoryStatus(content),
      path: path.relative(targetDir, abs),
    });
  }
  // Stable order — by id ASC. Tests assert on deterministic output.
  stories.sort((a, b) => a.id.localeCompare(b.id));

  const sharedDir = path.join(targetDir, '.mmd', 'shared');
  const statusFile = path.join(sharedDir, 'status.json');
  await assertSafeWritePath(targetDir, statusFile);
  await mkdir(sharedDir, { recursive: true });

  // Read-modify-write: preserve existing keys (v0.2a status.json schema).
  let existing = {};
  try {
    const raw = await readFile(statusFile, 'utf8');
    existing = JSON.parse(raw);
    if (!existing || typeof existing !== 'object') existing = {};
  } catch {
    existing = {};
  }
  const next = { ...existing, stories };
  await writeFile(statusFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { writtenPath: statusFile, stories };
}

/**
 * Copy every top-level file under `openspec/` into
 * `.mmd/shared/openspec-imported/` preserving relative paths. We do NOT
 * recurse into subdirs (KISS — v0.2c walking skeleton); deeper trees are a
 * deferred enhancement.
 *
 * Returns null when no openspec dir exists.
 *
 * @param {string} targetDir
 * @returns {Promise<{ writtenDir: string, files: string[] }|null>}
 */
export async function importOpenspec(targetDir) {
  const src = path.join(targetDir, 'openspec');
  let entries;
  try {
    entries = await readdir(src, { withFileTypes: true });
  } catch {
    return null;
  }
  const dest = path.join(targetDir, '.mmd', 'shared', 'openspec-imported');
  const written = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const srcFile = path.join(src, e.name);
    const destFile = path.join(dest, e.name);
    await assertSafeWritePath(targetDir, destFile);
    await mkdir(dest, { recursive: true });
    const raw = await readFile(srcFile, 'utf8');
    await writeFile(destFile, raw, 'utf8');
    written.push(path.relative(targetDir, destFile));
  }
  return { writtenDir: dest, files: written };
}

/**
 * Inventory loose spec / plan files at the target root that fall OUTSIDE the
 * recognized methodologies. The user reviews this list and triages.
 *
 * Pattern: `SPEC*.md`, `PLAN*.md`, `docs/spec.md`, `docs/plan.md`,
 * `docs/specs/*.md`. Returns null when nothing matched.
 *
 * @param {string} targetDir
 * @returns {Promise<{ writtenPath: string, files: string[] }|null>}
 */
export async function inventoryLooseSpecs(targetDir) {
  const found = new Set();

  // Root: SPEC*.md / PLAN*.md
  try {
    const rootEntries = await readdir(targetDir, { withFileTypes: true });
    for (const e of rootEntries) {
      if (!e.isFile()) continue;
      if (/^(SPEC|PLAN).*\.md$/i.test(e.name)) {
        found.add(path.relative(targetDir, path.join(targetDir, e.name)));
      }
    }
  } catch {
    // ignore
  }

  // docs/spec.md, docs/plan.md
  for (const f of ['spec.md', 'plan.md']) {
    const p = path.join(targetDir, 'docs', f);
    try {
      const s = await stat(p);
      if (s.isFile()) found.add(path.relative(targetDir, p));
    } catch {
      // ignore
    }
  }

  // docs/specs/*.md
  try {
    const specsDir = path.join(targetDir, 'docs', 'specs');
    const entries = await readdir(specsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        found.add(path.relative(targetDir, path.join(specsDir, e.name)));
      }
    }
  } catch {
    // ignore
  }

  if (found.size === 0) return null;
  const files = [...found].sort();
  const destFile = path.join(targetDir, '.mmd', 'shared', 'project-onboarder', 'specs-found.json');
  await assertSafeWritePath(targetDir, destFile);
  await mkdir(path.dirname(destFile), { recursive: true });
  await writeFile(
    destFile,
    `${JSON.stringify({ ingest_version: 1, count: files.length, files }, null, 2)}\n`,
    'utf8',
  );
  return { writtenPath: destFile, files };
}

/**
 * Run every importer, returning a summary of what landed where. Each
 * importer is best-effort: a missing source dir → that importer returns null
 * and is omitted from the summary. The orchestrator turns this into the
 * "Ingested" section of the report.
 *
 * @param {string} targetDir
 * @param {{ sourceSha?: string|null }} [opts]
 * @returns {Promise<{
 *   spec_kit_constitution: { writtenPath: string, source: string }|null,
 *   bmad_stories: { writtenPath: string, stories: Array<object> }|null,
 *   openspec: { writtenDir: string, files: string[] }|null,
 *   loose_specs: { writtenPath: string, files: string[] }|null,
 * }>}
 */
export async function runIngest(targetDir, opts = {}) {
  const [spec_kit_constitution, bmad_stories, openspec, loose_specs] = await Promise.all([
    importSpecKitConstitution(targetDir, opts),
    importBmadStories(targetDir),
    importOpenspec(targetDir),
    inventoryLooseSpecs(targetDir),
  ]);
  return { spec_kit_constitution, bmad_stories, openspec, loose_specs };
}
