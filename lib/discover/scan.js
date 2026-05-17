// lib/discover/scan.js — SCAN phase: passive inventory of an existing target.
//
// SRP: detection only. Never writes to user code. The only write site is the
// scan.json payload under <target>/.mmd/shared/project-onboarder/, gated by
// `assertSafeWritePath` so the non-intrusion invariant cannot be bypassed.
//
// Spec: SPEC_V02C AC-2.
//
// Detectors are deliberately independent so they can be unit-tested with
// synthetic fixture dirs (one detector at a time). The `runScan` aggregator
// is what the orchestrator calls — it composes the detectors and produces
// the schema-versioned scan.json payload.

import { spawn } from 'node:child_process';
import { readFile, readdir, stat, access, mkdir, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { assertSafeWritePath } from './safe-write.js';

/** Current scan.json schema version (observability.md §I). */
export const SCAN_VERSION = 1;

/**
 * Spawn-based git probe with a typed result — mirrors the pattern from
 * lib/here-mode.js#runGit and lib/ship/validate-branch.js#runGit (DRY: copying
 * the shape rather than importing avoids cross-module coupling on a 30-line
 * helper). Never rejects.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<{ok:true,code:number|null,stdout:string,stderr:string}|{ok:false,error:Error}>}
 */
function runGit(args, cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    } catch (err) {
      resolve({ ok: false, error: err });
      return;
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => resolve({ ok: false, error: e }));
    child.on('exit', (code) => resolve({ ok: true, code, stdout: out, stderr: err }));
  });
}

/**
 * True iff `p` exists (file or directory). Used by detectMethodologies.
 *
 * @param {string} p absolute path
 * @returns {Promise<boolean>}
 */
async function pathExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * True iff `p` exists and is a directory.
 *
 * @param {string} p absolute path
 * @returns {Promise<boolean>}
 */
async function isDir(p) {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Count files in a directory (non-recursive). Returns 0 on any I/O error so a
 * scan never crashes because of an unreadable dir.
 *
 * @param {string} dir absolute path
 * @returns {Promise<number>}
 */
async function countFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

/**
 * Detect SDD methodologies present at the target root.
 *
 * Per AC-2 the list is closed (Spec Kit / BMAD / OpenSpec / docs/stories /
 * docs/adr / .mmd / CLAUDE.md / MAKE_MY_DREAMS.md). We also surface a
 * boolean `already_onboarded` that classify.js uses for the priority-1 case
 * (looks for a VALIDATED line in `.mmd/shared/project-onboarder/last.md`).
 *
 * @param {string} targetDir absolute path
 * @returns {Promise<{
 *   spec_kit: boolean,
 *   bmad: boolean,
 *   openspec: boolean,
 *   stories_dir: boolean,
 *   stories_count: number,
 *   adr_dir: boolean,
 *   mmd_dir: boolean,
 *   claude_md: boolean,
 *   mmd_md: boolean,
 * }>}
 */
export async function detectMethodologies(targetDir) {
  const storiesDir = path.join(targetDir, 'docs', 'stories');
  const [
    spec_kit, bmad, openspec, stories_dir, adr_dir, mmd_dir, claude_md, mmd_md,
  ] = await Promise.all([
    isDir(path.join(targetDir, '.specify')),
    isDir(path.join(targetDir, '_bmad')),
    isDir(path.join(targetDir, 'openspec')),
    isDir(storiesDir),
    isDir(path.join(targetDir, 'docs', 'adr')),
    isDir(path.join(targetDir, '.mmd')),
    pathExists(path.join(targetDir, 'CLAUDE.md')),
    pathExists(path.join(targetDir, 'MAKE_MY_DREAMS.md')),
  ]);
  const stories_count = stories_dir ? await countFiles(storiesDir) : 0;
  return { spec_kit, bmad, openspec, stories_dir, stories_count, adr_dir, mmd_dir, claude_md, mmd_md };
}

/**
 * Check whether the target was previously onboarded AND validated. The signal
 * is a `VALIDATED` substring on the `Status:` line of `last.md`. We do not
 * parse markdown — a substring check is robust enough and KISS-compliant.
 *
 * @param {string} targetDir
 * @returns {Promise<boolean>}
 */
export async function isAlreadyOnboarded(targetDir) {
  const lastMd = path.join(targetDir, '.mmd', 'shared', 'project-onboarder', 'last.md');
  try {
    const raw = await readFile(lastMd, 'utf8');
    // The discover --approve writes "Status: VALIDATED at <iso>". A simple
    // substring check survives minor format changes (e.g. extra metadata).
    return /^\s*>?\s*Status:\s*VALIDATED\b/m.test(raw);
  } catch {
    return false;
  }
}

/**
 * Top-of-tree extension frequencies. Limited to the first 2 levels to keep
 * a SCAN cheap (the spec calls for "<5 s on a normal repo"). Returns the top
 * 5 extensions plus the raw counts for the inferred section.
 *
 * Anti-pattern guard: we hard-skip `.git/`, `node_modules/`, `dist/`, `build/`,
 * `.mmd/`, `_bmad/`, `_bmad-output/`, `.specify/` so language detection
 * reflects user code rather than tooling artifacts.
 *
 * @param {string} targetDir
 * @returns {Promise<{
 *   total: number,
 *   by_ext: Record<string, number>,
 *   top5: string[],
 * }>}
 */
export async function detectLanguages(targetDir) {
  const skip = new Set([
    '.git', 'node_modules', 'dist', 'build', '.mmd',
    '_bmad', '_bmad-output', '.specify', 'demo', 'bench',
  ]);
  /** @type {Record<string, number>} */
  const counts = {};
  let total = 0;

  async function visit(dir, depth) {
    if (depth > 2) return; // depth budget
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.isDirectory() && e.name !== '.specify') {
        // Skip hidden dirs (except .specify which is a methodology marker, but
        // .specify itself is already in `skip` for content scan; this branch
        // covers .git, .vscode, .idea, etc.).
        continue;
      }
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await visit(full, depth + 1);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!ext) continue;
        counts[ext] = (counts[ext] || 0) + 1;
        total += 1;
      }
    }
  }

  await visit(targetDir, 0);
  const top5 = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext]) => ext);
  return { total, by_ext: counts, top5 };
}

/**
 * Detect framework + test runner + build tool hints from manifest files. KISS:
 * we look only at a closed list of well-known files; richer detection (e.g.
 * `node_modules/.bin/`, lockfile heuristics) is out of v0.2c scope.
 *
 * @param {string} targetDir
 * @returns {Promise<{
 *   language: string|null,
 *   frameworks: string[],
 *   test_runner: string|null,
 *   build_tool: string|null,
 *   package_manager: string|null,
 * }>}
 */
export async function detectFrameworks(targetDir) {
  /** @type {string[]} */
  const frameworks = [];
  let language = null;
  let test_runner = null;
  let build_tool = null;
  let package_manager = null;

  // package.json — JS / TS world.
  const pkgPath = path.join(targetDir, 'package.json');
  if (await pathExists(pkgPath)) {
    language = 'javascript';
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.react) frameworks.push('react');
      if (deps.vue) frameworks.push('vue');
      if (deps.next) frameworks.push('next');
      if (deps.svelte) frameworks.push('svelte');
      if (deps.typescript) { language = 'typescript'; frameworks.push('typescript'); }
      if (deps.jest) test_runner = 'jest';
      else if (deps.vitest) test_runner = 'vitest';
      else if (deps.mocha) test_runner = 'mocha';
      if (deps.vite) build_tool = 'vite';
      else if (deps.webpack) build_tool = 'webpack';
      else if (deps.esbuild) build_tool = 'esbuild';
    } catch {
      // Malformed package.json — surface as no extra hints rather than crash.
    }
  }
  // Test runner config files (override even if not declared as dep).
  if (await pathExists(path.join(targetDir, 'jest.config.js'))) test_runner = test_runner || 'jest';
  if (await pathExists(path.join(targetDir, 'vitest.config.ts'))) test_runner = test_runner || 'vitest';
  if (await pathExists(path.join(targetDir, 'vitest.config.js'))) test_runner = test_runner || 'vitest';
  // Default for plain Node projects without a declared runner — node:test (Node 20+).
  if (language === 'javascript' && !test_runner) {
    // Heuristic: if any test/ dir uses node:test, treat that as the runner.
    const testDir = path.join(targetDir, 'test');
    if (await isDir(testDir)) {
      try {
        const sample = await readdir(testDir, { withFileTypes: true });
        const hasNodeTest = sample.some((e) => e.isFile() && e.name.endsWith('.test.js'));
        if (hasNodeTest) test_runner = 'node:test';
      } catch {
        // Ignore.
      }
    }
  }
  // Package manager hint.
  if (await pathExists(path.join(targetDir, 'package-lock.json'))) package_manager = 'npm';
  else if (await pathExists(path.join(targetDir, 'yarn.lock'))) package_manager = 'yarn';
  else if (await pathExists(path.join(targetDir, 'pnpm-lock.yaml'))) package_manager = 'pnpm';
  else if (await pathExists(path.join(targetDir, 'bun.lockb'))) package_manager = 'bun';

  // Python.
  if (await pathExists(path.join(targetDir, 'pyproject.toml'))) {
    language = language || 'python';
  }
  if (await pathExists(path.join(targetDir, 'requirements.txt'))) {
    language = language || 'python';
  }
  if (await pathExists(path.join(targetDir, 'pytest.ini'))) test_runner = test_runner || 'pytest';

  // Rust.
  if (await pathExists(path.join(targetDir, 'Cargo.toml'))) language = language || 'rust';
  // Go.
  if (await pathExists(path.join(targetDir, 'go.mod'))) language = language || 'go';

  return { language, frameworks, test_runner, build_tool, package_manager };
}

/**
 * Detect lint / format config (advisory — surfaced in the report's "scanned"
 * section). Closed list — KISS.
 *
 * @param {string} targetDir
 * @returns {Promise<{ eslint: boolean, prettier: boolean, biome: boolean }>}
 */
export async function detectLintConfig(targetDir) {
  const [eslint, prettier, biome] = await Promise.all([
    Promise.all([
      pathExists(path.join(targetDir, '.eslintrc')),
      pathExists(path.join(targetDir, '.eslintrc.js')),
      pathExists(path.join(targetDir, '.eslintrc.json')),
      pathExists(path.join(targetDir, 'eslint.config.js')),
    ]).then((arr) => arr.some(Boolean)),
    Promise.all([
      pathExists(path.join(targetDir, '.prettierrc')),
      pathExists(path.join(targetDir, '.prettierrc.json')),
      pathExists(path.join(targetDir, 'prettier.config.js')),
    ]).then((arr) => arr.some(Boolean)),
    pathExists(path.join(targetDir, 'biome.json')),
  ]);
  return { eslint, prettier, biome };
}

/**
 * Detect git state: presence, HEAD SHA, default branch (best-effort: HEAD's
 * branch, then `main`, then `master`), first-commit date, commits in the last
 * 90 days. Returns `{ is_git_repo: false }` if cwd is not a git repo.
 *
 * Defensive: every git call is best-effort — a missing git binary or a
 * shallow clone falls back to nulls, never throws.
 *
 * @param {string} targetDir
 * @param {{ now?: Date }} [opts] inject `now` for deterministic tests
 * @returns {Promise<{
 *   is_git_repo: boolean,
 *   head_sha?: string|null,
 *   default_branch?: string|null,
 *   first_commit_iso?: string|null,
 *   commits_last_90d?: number|null,
 * }>}
 */
export async function detectGit(targetDir, opts = {}) {
  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], targetDir);
  if (!inside.ok || inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return { is_git_repo: false };
  }

  const headProbe = await runGit(['rev-parse', 'HEAD'], targetDir);
  const head_sha = headProbe.ok && headProbe.code === 0 ? headProbe.stdout.trim() : null;

  const currentBranch = await runGit(['branch', '--show-current'], targetDir);
  let default_branch = currentBranch.ok && currentBranch.code === 0
    ? currentBranch.stdout.trim() || null
    : null;
  if (!default_branch) {
    // Fallback: try main, then master.
    for (const candidate of ['main', 'master']) {
      const probe = await runGit(['rev-parse', '--verify', candidate], targetDir);
      if (probe.ok && probe.code === 0) { default_branch = candidate; break; }
    }
  }

  // First commit date.
  let first_commit_iso = null;
  const firstCommit = await runGit(
    ['log', '--reverse', '--format=%cI', '--max-count=1'],
    targetDir,
  );
  if (firstCommit.ok && firstCommit.code === 0 && firstCommit.stdout.trim().length > 0) {
    first_commit_iso = firstCommit.stdout.trim().split('\n')[0];
  }

  // Commits in last 90 days.
  let commits_last_90d = null;
  const now = opts.now instanceof Date ? opts.now : new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString();
  const rev = await runGit(
    ['rev-list', '--count', `--since=${ninetyDaysAgo}`, 'HEAD'],
    targetDir,
  );
  if (rev.ok && rev.code === 0) {
    const n = parseInt(rev.stdout.trim(), 10);
    if (Number.isFinite(n)) commits_last_90d = n;
  }

  return { is_git_repo: true, head_sha, default_branch, first_commit_iso, commits_last_90d };
}

/**
 * High-level SCAN orchestrator. Composes the detectors above and returns the
 * versioned scan payload. Callers persist this via `writeScan` (which goes
 * through assertSafeWritePath).
 *
 * @param {string} targetDir absolute path
 * @param {{ now?: Date }} [opts]
 * @returns {Promise<object>} scan payload (scan_version === SCAN_VERSION)
 */
export async function runScan(targetDir, opts = {}) {
  const [methodologies, languages, frameworks, lint, git, already_onboarded] = await Promise.all([
    detectMethodologies(targetDir),
    detectLanguages(targetDir),
    detectFrameworks(targetDir),
    detectLintConfig(targetDir),
    detectGit(targetDir, opts),
    isAlreadyOnboarded(targetDir),
  ]);
  return {
    scan_version: SCAN_VERSION,
    target_dir: targetDir,
    scanned_at: (opts.now instanceof Date ? opts.now : new Date()).toISOString(),
    already_onboarded,
    methodologies,
    languages,
    frameworks,
    lint,
    git,
  };
}

/**
 * Persist a scan payload to `.mmd/shared/project-onboarder/scan.json`. Goes
 * through `assertSafeWritePath` so a misuse (caller passes the wrong path)
 * fails loud.
 *
 * @param {string} targetDir
 * @param {object} payload
 * @returns {Promise<string>} absolute path of the written file
 */
export async function writeScan(targetDir, payload) {
  const dir = path.join(targetDir, '.mmd', 'shared', 'project-onboarder');
  const file = path.join(dir, 'scan.json');
  await assertSafeWritePath(targetDir, file);
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return file;
}
