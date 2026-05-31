// lib/handover/build-state-block.js — pure builder for HANDOVER.md's mechanical
// "State at handover" block (SPEC_V02P AC-2 + AC-4).
//
// SRP (universal.md §I.S): derive the one mechanical block of HANDOVER.md from
// deterministic, cheap sources and return it as markdown. It does NOT author
// any INTENT section, does NOT run the test suite, and does NOT touch the
// filesystem itself — every dependency (git runner, file reader, ADR lister,
// lessons parser, clock) is INJECTED, mirroring lib/conductor/stall-detector.js.
// That keeps the builder pure: the same inputs always yield the same markdown,
// so the AC-2 unit test drives it with fakes and never touches real git/fs.
//
// Honesty (universal.md §VI, ai-coding.md §I): a failing git call, a missing
// tag, or an empty/detached branch renders an explicit `(unavailable: <reason>)`
// value — NEVER a crash, NEVER a guess, NEVER a stale copy. The one non-cheap
// field (the passing-test count) is supplied via `--tests N` or left as an
// explicit "refresh me" placeholder; the builder never invents it (AC-4).

/**
 * Run one git command through the injected runner and reduce it to either a
 * trimmed string value or an explicit unavailability reason. Never throws.
 *
 * @param {(args: string[], cwd: string) => Promise<object>} runGit
 * @param {string[]} args
 * @param {string} repoRoot
 * @returns {Promise<{ ok: true, value: string } | { ok: false, reason: string }>}
 */
export async function gitField(runGit, args, repoRoot) {
  let r;
  try {
    r = await runGit(args, repoRoot);
  } catch (err) {
    return { ok: false, reason: `git invocation threw: ${err.message}` };
  }
  if (!r || r.ok !== true) {
    return { ok: false, reason: (r && r.error && r.error.message) || 'git invocation failed' };
  }
  if (r.code !== 0) {
    const firstStderrLine = (r.stderr || '').trim().split('\n')[0];
    return { ok: false, reason: firstStderrLine || `git exited with code ${r.code}` };
  }
  return { ok: true, value: (r.stdout || '').trim() };
}

/** Render an `(unavailable: <reason>)` marker (honesty — never a fabricated value). */
export function unavailable(reason) {
  return `(unavailable: ${reason})`;
}

/**
 * Sort `L-NNN` ids by their numeric part so the rendered id list reads in a
 * stable, human-friendly order regardless of parser/file order (universal §VII).
 */
function sortLessonIds(ids) {
  const num = (id) => {
    const m = /^L-(\d+)$/.exec(id);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  };
  return [...ids].sort((a, b) => num(a) - num(b) || a.localeCompare(b));
}

/**
 * Derive the ADR count + an honest `ADR-min..ADR-max` range from the list of
 * ADR markdown filenames (e.g. `020-mmd-handover-subcommand.md`). The range is
 * derived from the actual min/max numeric prefixes — it does not assume a
 * gap-free sequence beyond reporting the observed endpoints.
 *
 * @param {string[]} adrFiles
 * @returns {string} e.g. "20 (ADR-001..ADR-020)" or "0"
 */
export function renderAdrCount(adrFiles) {
  const numbers = adrFiles
    .map((name) => /^(\d+)/.exec(name))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const count = adrFiles.length;
  if (numbers.length === 0) return String(count);
  const pad = (n) => String(n).padStart(3, '0');
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const range = min === max ? `ADR-${pad(min)}` : `ADR-${pad(min)}..ADR-${pad(max)}`;
  return `${count} (${range})`;
}

/**
 * Build the mechanical State block markdown.
 *
 * @param {{
 *   runGit: (args: string[], cwd: string) => Promise<object>,
 *   repoRoot: string,
 *   readFile: (absPath: string) => string,        // sync reader; throws on missing
 *   parseLessons: (markdown: string) => Array<{ id: string, status: string }>,
 *   listAdrFiles: () => string[],                   // ADR *.md filenames
 *   clock: () => Date,                              // injected for determinism
 *   paths: { packageJson: string, lessons: string },
 *   tests?: number|null,                            // from --tests N (honest count)
 *   commitCount?: number,                           // git log --oneline -N (default 5)
 * }} opts
 * @returns {Promise<string>} the markdown block (no surrounding markers/newlines)
 */
export async function buildStateBlock(opts) {
  const {
    runGit,
    repoRoot,
    readFile,
    parseLessons,
    listAdrFiles,
    clock,
    paths,
    tests = null,
    commitCount = 5,
  } = opts || {};

  // ── git-derived fields ────────────────────────────────────────────────────
  const tagField = await gitField(runGit, ['describe', '--tags', '--abbrev=0'], repoRoot);
  const tag = tagField.ok && tagField.value.length > 0
    ? `\`${tagField.value}\``
    : unavailable(tagField.ok ? 'no tags found' : tagField.reason);

  const branchField = await gitField(runGit, ['branch', '--show-current'], repoRoot);
  const branch = branchField.ok && branchField.value.length > 0
    ? `\`${branchField.value}\``
    : unavailable(branchField.ok ? 'empty (detached HEAD?)' : branchField.reason);

  const logField = await gitField(
    runGit,
    ['log', '--oneline', `-${commitCount}`],
    repoRoot,
  );

  // ── version (package.json) ──────────────────────────────────────────────────
  let version;
  try {
    version = `\`${JSON.parse(readFile(paths.packageJson)).version}\` (package.json)`;
  } catch (err) {
    version = unavailable(`package.json: ${err.message}`);
  }

  // ── active lessons (parseLessons — authoritative; replaces hand-counting) ───
  let lessons;
  try {
    const parsed = parseLessons(readFile(paths.lessons));
    const activeIds = sortLessonIds(
      parsed.filter((l) => l.status === 'active').map((l) => l.id),
    );
    lessons = activeIds.length > 0
      ? `${activeIds.length} (${activeIds.join(', ')})`
      : '0 (none active)';
  } catch (err) {
    lessons = unavailable(`lessons-learned.md: ${err.message}`);
  }

  // ── ADR count ───────────────────────────────────────────────────────────────
  let adrs;
  try {
    adrs = renderAdrCount(listAdrFiles());
  } catch (err) {
    adrs = unavailable(`adr dir: ${err.message}`);
  }

  // ── test count (honest — never invented; AC-4) ─────────────────────────────
  const testsLine = Number.isInteger(tests) && tests >= 0
    ? `${tests} passing`
    : '(run `npm test` to refresh — pass `mmd handover --tests N`)';

  // ── generated date (INJECTED clock — deterministic in tests) ───────────────
  const generated = clock().toISOString().slice(0, 10);

  // ── assemble the block ──────────────────────────────────────────────────────
  const lines = [
    `- **Latest tag**: ${tag}`,
    `- **Branch**: ${branch}`,
    `- **Version**: ${version}`,
    `- **Active lessons**: ${lessons}`,
    `- **ADRs**: ${adrs}`,
    `- **Tests**: ${testsLine}`,
  ];

  if (logField.ok && logField.value.length > 0) {
    lines.push('- **Recent commits**:');
    for (const commit of logField.value.split('\n')) {
      lines.push(`  - \`${commit}\``);
    }
  } else {
    lines.push(
      `- **Recent commits**: ${unavailable(logField.ok ? 'no commits' : logField.reason)}`,
    );
  }

  lines.push(
    `- **Generated**: ${generated} by \`mmd handover\` ` +
      '(mechanical block — intent sections are human-authored)',
  );

  return lines.join('\n');
}
