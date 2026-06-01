// lib/documentalist/compact.js — the Documentalist's active-compaction planner
// (SPEC_V07C AC-1). The Documentalist's first *action*: it has detected the root
// SPEC sprawl (v0.7.a) and guarded the docs' truth (v0.7.b); here it plans the
// safe, mechanical, reversible relocation of the root `SPEC_V*.md` files into an
// archive folder (docs/specs/) with an index and rewritten references.
//
// SRP (universal.md §I.S): this module DECIDES the plan and TRANSFORMS reference
// text — it never touches the filesystem or git. All I/O (readdir, readFile,
// git mv, writeFile) lives in bin/documentalist/document-compact.js. Two pure
// exports:
//   • planCompaction({ specs, existingArchive }) → { moves, indexMarkdown, referenceRewrites }
//   • applyReferenceRewrites(text, referenceRewrites) → text  (idempotent)
//
// PURE + NEVER THROWS (error-handling §III, AC-1): same inputs → same plan; odd /
// empty / malformed input degrades to an empty plan, never a crash. Emptiness is
// the honest signal that there was nothing to compact (universal §VI).
//
// KISS (universal §II): relocation + reference integrity only. The harder
// semantic compaction (sharding the over-cap docs) is DEFERRED — act on the safe
// thing first (SPEC §intro). This planner does not summarize, dedupe, or edit
// SPEC content; it only computes where each file moves and which path tokens must
// be rewritten so no link dangles afterwards.

// The archive folder, repo-root-relative (POSIX — it lands in git-tracked paths
// and in markdown links, both of which use forward slashes). A moved spec's
// destination is `${ARCHIVE_DIR}/<name>`; a rewritten reference gains this prefix.
export const ARCHIVE_DIR = 'docs/specs';

/**
 * Parse an MMD SPEC filename into a comparable version tuple + display string.
 *
 * The MMD convention pairs a filename with a human version (universal §VII):
 *   SPEC_V01.md  → v0.1      SPEC_V02P.md → v0.2.p     SPEC_V07C.md → v0.7.c
 * The digits after `V` are read as `<major><minor…>` (first digit major, the
 * rest minor — every MMD release so far is `0.x`), an optional trailing letter is
 * the sub-version, and an optional final digit disambiguates (rare). A name that
 * does not match the pattern is sorted last with an empty display version (honest
 * — we never fabricate a version we couldn't parse).
 *
 * @param {string} name e.g. "SPEC_V07C.md"
 * @returns {{ major: number, minor: number, letter: number, trail: number, display: string, valid: boolean }}
 */
export function parseSpecVersion(name) {
  const m = typeof name === 'string' ? /^SPEC_V(\d+)([A-Za-z])?(\d)?\.md$/.exec(name) : null;
  if (!m) return { major: 0, minor: 0, letter: 0, trail: 0, display: '', valid: false };
  const digits = m[1];
  const major = Number(digits[0]);
  const minor = Number(digits.slice(1) || '0');
  const letterChar = m[2] ? m[2].toLowerCase() : '';
  const letter = letterChar ? letterChar.charCodeAt(0) - 96 : 0; // a → 1
  const trail = m[3] ? Number(m[3]) : 0;
  const display = `v${major}.${minor}${letterChar ? `.${letterChar}` : ''}${trail ? `.${trail}` : ''}`;
  return { major, minor, letter, trail, display, valid: true };
}

/**
 * Compare two spec filenames newest-FIRST (descending version). A name that does
 * not parse sorts after valid ones; ties fall back to a reverse filename compare
 * so the order is total + deterministic.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function byVersionDesc(a, b) {
  const va = parseSpecVersion(a);
  const vb = parseSpecVersion(b);
  if (va.valid !== vb.valid) return va.valid ? -1 : 1; // valid versions first
  for (const k of ['major', 'minor', 'letter', 'trail']) {
    if (va[k] !== vb[k]) return vb[k] - va[k]; // descending
  }
  // Total order tie-break: reverse lexical (stable, deterministic).
  return a < b ? 1 : a > b ? -1 : 0;
}

/**
 * Strip a leading markdown `# ` and surrounding whitespace from a SPEC's title
 * line so the index shows the human phrase, not the markdown. A falsy / non-string
 * title yields '' (the caller falls back to the filename).
 *
 * @param {string} title the raw first H1 line, e.g. "# Make My Dreams — v0.7.c Spec: …"
 * @returns {string}
 */
function cleanTitle(title) {
  if (typeof title !== 'string') return '';
  return title.replace(/^\s*#+\s*/, '').trim();
}

/**
 * Render the archive INDEX.md content: one entry per SPEC, newest-first, each
 * pairing the filename (a sibling relative link, since INDEX.md lives beside the
 * archived specs) with its parsed version and title line (universal §VII — the
 * code is paired with prose). A generated-do-not-edit banner heads it.
 *
 * @param {Array<{ name: string, title?: string }>} specs all specs that live in the archive
 * @returns {string}
 */
function renderIndex(specs) {
  const sorted = [...specs].sort((a, b) => byVersionDesc(a.name, b.name));
  const out = [
    '# Archived SPECs',
    '',
    '> Shipped specifications, archived from the repo root by `mmd document-compact`.',
    '> Newest first. GENERATED — do not hand-edit (regenerate with `mmd document-compact`).',
    '',
  ];
  if (sorted.length === 0) {
    out.push('_No archived specs yet._', '');
    return out.join('\n');
  }
  for (const s of sorted) {
    const v = parseSpecVersion(s.name);
    const versionCol = v.display || '(unparsed)';
    const title = cleanTitle(s.title) || s.name;
    out.push(`- **${versionCol}** — [\`${s.name}\`](${s.name}) — ${title}`);
  }
  out.push('');
  return out.join('\n');
}

/**
 * Plan the compaction (AC-1). PURE, deterministic, never throws.
 *
 * @param {{
 *   specs?: Array<{ name: string, title?: string }>,  // SPECs that will live in the archive (root + already-archived)
 *   existingArchive?: string[],                        // names ALREADY under docs/specs/ (not to be re-moved)
 * }} [args]
 * @returns {{
 *   moves: Array<{ src: string, dst: string }>,
 *   indexMarkdown: string,
 *   referenceRewrites: Array<{ from: string, to: string }>,
 * }}
 *   `moves`/`referenceRewrites` cover ONLY the specs not already archived (the
 *   root sprawl); `indexMarkdown` lists EVERY spec that ends up in the archive
 *   (so an incremental run keeps the index complete). Empty `specs` → empty plan.
 */
export function planCompaction(args) {
  const specs = args && Array.isArray(args.specs)
    ? args.specs.filter((s) => s && typeof s.name === 'string')
    : [];
  const archivedSet = new Set(
    args && Array.isArray(args.existingArchive)
      ? args.existingArchive.filter((n) => typeof n === 'string')
      : [],
  );

  // Only the specs NOT already archived are moved + rewritten (idempotency,
  // AC-1: already-archived SPECs are not re-planned).
  const toMove = specs.filter((s) => !archivedSet.has(s.name));

  const moves = toMove.map((s) => ({ src: s.name, dst: `${ARCHIVE_DIR}/${s.name}` }));
  const referenceRewrites = toMove.map((s) => ({ from: s.name, to: `${ARCHIVE_DIR}/${s.name}` }));

  // The index covers every spec that ends up in the archive (already-archived +
  // newly moved) so it stays complete across incremental runs.
  const indexMarkdown = renderIndex(specs);

  return { moves, indexMarkdown, referenceRewrites };
}

/**
 * Apply the reference rewrites to a doc's text (AC-3). PURE + IDEMPOTENT.
 *
 * For each rewrite, an EXACT root-level `SPEC_V0XX.md` filename token is prefixed
 * with the archive folder — but ONLY when it is not already part of a path (the
 * negative lookbehind `(?<![\w/.-])` rejects a preceding path separator, so an
 * already-`docs/specs/`-prefixed token is left untouched → no `docs/specs/docs/
 * specs/`, and a `some/other/SPEC_V0XX.md` is not mangled). The trailing
 * `(?![\w])` keeps `.md` from gluing onto `.mdx`; an anchor (`#…`) or link
 * punctuation that follows the token is left intact (it sits outside the match).
 *
 * Covers every textual form the SPEC calls out: bare prose mentions, link targets
 * `](SPEC_V06A.md)`, anchored links `](SPEC_V05C.md#anchor)`, and backticked
 * `` [`SPEC_V07A.md`](SPEC_V07A.md) ``. A SPEC with no rewrite entry is untouched.
 *
 * @param {string} text
 * @param {Array<{ from: string, to: string }>} referenceRewrites
 * @returns {string} the rewritten text (unchanged when nothing matches)
 */
export function applyReferenceRewrites(text, referenceRewrites) {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (!Array.isArray(referenceRewrites) || referenceRewrites.length === 0) return text;

  let out = text;
  for (const rw of referenceRewrites) {
    if (!rw || typeof rw.from !== 'string' || typeof rw.to !== 'string' || rw.from.length === 0) continue;
    const esc = rw.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\w/.-])${esc}(?![\\w])`, 'g');
    // Function replacer so a `$` in `to` is never interpreted as a capture ref.
    out = out.replace(re, () => rw.to);
  }
  return out;
}
