// lib/discover/infer.js — INFER phase: deterministic conventions extraction.
//
// SRP: derive natural-language summaries from the structured SCAN data PLUS
// a few extra filesystem peeks (line counts, commit-message scan). The
// optional `--infer-with-claude` LLM augmentation is a stub in v0.2c (per
// spec §4 out-of-scope deferral): the flag is accepted, the inferred file
// notes that LLM augmentation was requested but not yet implemented.
//
// Spec: SPEC_V02C AC-4.

import { readFile, stat, mkdir, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { assertSafeWritePath } from './safe-write.js';

/**
 * Spawn-based git probe (typed result) — same shape as scan.js#runGit. DRY:
 * a tiny helper duplicated rather than imported keeps these phase modules
 * independently testable.
 */
function runGit(args, cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    } catch (err) { resolve({ ok: false, error: err }); return; }
    let out = ''; let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => resolve({ ok: false, error: e }));
    child.on('exit', (code) => resolve({ ok: true, code, stdout: out, stderr: err }));
  });
}

/**
 * Stack summary line. Pure transform over the SCAN payload — exported so
 * tests can lock the format without setting up a target dir.
 *
 * Examples:
 *   "JavaScript project, npm, node:test test runner, ESLint+Prettier"
 *   "Python project, pytest test runner"
 *   "No recognized language manifests detected"
 *
 * @param {object} scanData
 * @returns {string}
 */
export function summarizeStack(scanData) {
  if (!scanData || typeof scanData !== 'object') return 'No scan data available';
  const f = scanData.frameworks || {};
  const lint = scanData.lint || {};
  const parts = [];
  if (f.language) {
    const cased = f.language.charAt(0).toUpperCase() + f.language.slice(1);
    parts.push(`${cased} project`);
  } else {
    parts.push('No recognized language manifests detected');
  }
  if (f.package_manager) parts.push(f.package_manager);
  if (f.frameworks && f.frameworks.length > 0) parts.push(`frameworks: ${f.frameworks.join(', ')}`);
  if (f.test_runner) parts.push(`${f.test_runner} test runner`);
  if (f.build_tool) parts.push(`${f.build_tool} build tool`);
  const lintBits = [];
  if (lint.eslint) lintBits.push('ESLint');
  if (lint.prettier) lintBits.push('Prettier');
  if (lint.biome) lintBits.push('Biome');
  if (lintBits.length > 0) parts.push(lintBits.join('+'));
  return parts.join(', ');
}

/**
 * Naming + structure summary. Pure transform over SCAN data. Surfaces the
 * top 5 file extensions and whether TypeScript is in use.
 *
 * @param {object} scanData
 * @returns {string}
 */
export function summarizeNaming(scanData) {
  if (!scanData || typeof scanData !== 'object') return '(no scan data)';
  const langs = scanData.languages || { top5: [], total: 0 };
  const f = scanData.frameworks || {};
  const hasTs = f.language === 'typescript' || (f.frameworks || []).includes('typescript');
  const top = langs.top5 && langs.top5.length > 0 ? langs.top5.join(', ') : '(no files found)';
  return `Top extensions: ${top}; TypeScript: ${hasTs ? 'yes' : 'no'}; total files scanned: ${langs.total || 0}`;
}

/**
 * Test-conventions summary: which test dirs exist, what runner was detected,
 * how many test files.
 *
 * Cheap I/O (only reads directory listings, doesn't open files).
 *
 * @param {string} targetDir
 * @param {object} scanData
 * @returns {Promise<string>}
 */
export async function summarizeTests(targetDir, scanData) {
  const runner = (scanData && scanData.frameworks && scanData.frameworks.test_runner) || 'none detected';
  const candidates = ['test', 'tests', '__tests__', 'spec'];
  const present = [];
  let total = 0;
  for (const c of candidates) {
    const dir = path.join(targetDir, c);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile() && /\.(test|spec)\.[jt]sx?$/.test(e.name));
      if (files.length > 0) {
        present.push(`${c}/ (${files.length} test files)`);
        total += files.length;
      } else if (entries.length > 0) {
        present.push(`${c}/ (no *.test.* files at top level)`);
      }
    } catch {
      // dir missing — skip
    }
  }
  if (present.length === 0) return `Runner: ${runner}; no recognized test dirs at root`;
  return `Runner: ${runner}; dirs: ${present.join(', ')}; ${total} test files (top-level)`;
}

/**
 * Documentation conventions: presence of README, CONTRIBUTING, CHANGELOG,
 * docs/ structure, README line count.
 *
 * @param {string} targetDir
 * @returns {Promise<string>}
 */
export async function summarizeDocs(targetDir) {
  const items = [];
  for (const f of ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CLAUDE.md']) {
    try {
      const s = await stat(path.join(targetDir, f));
      if (s.isFile()) {
        if (f === 'README.md') {
          try {
            const raw = await readFile(path.join(targetDir, f), 'utf8');
            const lines = raw.split(/\r?\n/).length;
            items.push(`README.md (${lines} lines)`);
          } catch {
            items.push('README.md');
          }
        } else {
          items.push(f);
        }
      }
    } catch {
      // missing
    }
  }
  // docs/ structure
  try {
    const entries = await readdir(path.join(targetDir, 'docs'), { withFileTypes: true });
    const sub = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    if (sub.length > 0) items.push(`docs/ subdirs: ${sub.join(', ')}`);
  } catch {
    // no docs/
  }
  if (items.length === 0) return 'No common documentation files detected';
  return items.join(', ');
}

/**
 * Commit-convention summary: scan up to the last 30 commit messages, report
 * Conventional Commits usage rate and AI-mention rate. Best-effort: a non-git
 * cwd or shallow clone yields `(no commits available)`.
 *
 * @param {string} targetDir
 * @returns {Promise<string>}
 */
export async function summarizeCommits(targetDir) {
  const r = await runGit(['log', '--format=%s', '--max-count=30'], targetDir);
  if (!r.ok || r.code !== 0) return '(no commits available)';
  const lines = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return '(no commits available)';
  const conv = lines.filter((l) => /^(feat|fix|docs|test|refactor|chore|style|perf|ci|build)(\([^)]+\))?:/i.test(l));
  // AI mention rate — "claude", "auto-dev", "ai-generated", "co-authored-by: claude".
  const ai = lines.filter((l) => /claude|auto-?dev|ai-generated|generated by/i.test(l));
  const pctConv = Math.round((conv.length / lines.length) * 100);
  const pctAi = Math.round((ai.length / lines.length) * 100);
  return `Last ${lines.length} commits — Conventional Commits: ${pctConv}%, AI-mention: ${pctAi}%`;
}

/**
 * High-level INFER orchestrator: produces the markdown body of
 * `.mmd/shared/project-onboarder/inferred.md`. Pure-string output — caller
 * persists via `writeInferred`.
 *
 * The `useClaude` flag (from `--infer-with-claude`) is honored cosmetically
 * in v0.2c: a clear "LLM augmentation requested but not yet implemented"
 * note is appended. Per ai-coding.md §I (honest failure reporting) we do
 * NOT fabricate LLM output.
 *
 * @param {string} targetDir
 * @param {object} scanData
 * @param {{ useClaude?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export async function runInfer(targetDir, scanData, opts = {}) {
  const [tests, docs, commits] = await Promise.all([
    summarizeTests(targetDir, scanData),
    summarizeDocs(targetDir),
    summarizeCommits(targetDir),
  ]);
  const stack = summarizeStack(scanData);
  const naming = summarizeNaming(scanData);
  const lines = [
    '# Inferred conventions',
    '',
    '> Generated by `mmd discover` INFER phase (deterministic — no LLM call by default).',
    '',
    '## Stack',
    stack,
    '',
    '## Naming and structure',
    naming,
    '',
    '## Tests',
    tests,
    '',
    '## Docs',
    docs,
    '',
    '## Commits',
    commits,
    '',
  ];
  if (opts.useClaude) {
    lines.push('## LLM-augmented inference (--infer-with-claude)');
    lines.push('');
    lines.push(
      'Note: `--infer-with-claude` was passed, but LLM-augmented inference is ' +
      'NOT yet implemented in v0.2c (per `SPEC_V02C.md` §4 — deferred to v0.2c+). ' +
      'The deterministic inference above is what got generated. No fabrication.',
    );
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Persist the inferred markdown to `.mmd/shared/project-onboarder/inferred.md`.
 *
 * @param {string} targetDir
 * @param {string} content
 * @returns {Promise<string>} absolute written path
 */
export async function writeInferred(targetDir, content) {
  const dir = path.join(targetDir, '.mmd', 'shared', 'project-onboarder');
  const file = path.join(dir, 'inferred.md');
  await assertSafeWritePath(targetDir, file);
  await mkdir(dir, { recursive: true });
  await writeFile(file, content, 'utf8');
  return file;
}
