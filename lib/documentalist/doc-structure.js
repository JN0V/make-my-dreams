// lib/documentalist/doc-structure.js — role-aware structure assessment
// (SPEC_V021A AC-3). The Documentalist's third NEW detection: is a doc the WRONG
// SHAPE for its role? A landing/concise doc (README) has a tight length budget +
// should not carry a 700-line section nor an inline changelog; a reference doc
// (MAKE_MY_DREAMS.md, an ADR, a SPEC) is LEGITIMATELY long and is NOT flagged.
//
// SRP (universal §I.S): this module DECIDES structure facts about a doc's text —
// it never reads the filesystem nor edits anything. Pure transform: text in,
// {overBudget, lineCount, oversizedSections, changelogInline} out.
//
// §VIII / L-009 — general, not README-hardcoded: the assessment is driven by a
// doc's ROLE, not its filename baked into the logic. `inferRole(docPath)` is a
// labelled heuristic-by-filename (README/landing → concise; MAKE_MY_DREAMS /
// docs/adr/* / docs/specs/* → reference); a caller may pass an explicit role.
//
// HONEST HEURISTIC (universal §VI): a structure flag is advisory — it says "this
// concise doc is over its budget", not "this doc is wrong". Pure, never throws.

// The §6.4 landing-doc length budget. A concise doc over this is a condensation
// candidate; a reference doc is exempt regardless.
const DEFAULT_CONCISE_BUDGET = 200;

// A section is "oversized" when it alone exceeds this fraction of the doc budget —
// a rough heuristic: one `##` section should not dominate a concise landing doc.
// budget/3 keeps it conservative (a 200-budget doc flags a section > ~66 lines).
const OVERSIZED_SECTION_FRACTION = 3;

// The marker that identifies the README's mechanical changelog block. We match
// the HTML-comment START tag (not a bare 'mmd:readme:changelog' substring, which
// also appears in PROSE describing the markers) so a prose mention never reads as
// "changelog inline". Its presence is a structure signal (the changelog belongs
// in CHANGELOG.md once the doc is over budget — AC-4 moves it there).
const CHANGELOG_MARKER = '<!-- mmd:readme:changelog:start -->';

/**
 * Heuristic role-by-filename (labelled, SPEC §3 — a smart classifier is deferred).
 *   • README*.md (any dir)                 → 'concise' (a landing doc, tight budget)
 *   • MAKE_MY_DREAMS.md                    → 'reference' (legitimately long)
 *   • docs/adr/* , docs/specs/* , *SPEC_V* → 'reference' (point-in-time records)
 *   • anything else                        → 'concise' (the safe default for a doc
 *                                            we condense; never silently exempts)
 *
 * @param {string} docPath repo-relative or bare path
 * @returns {'concise'|'reference'}
 */
export function inferRole(docPath) {
  if (typeof docPath !== 'string' || docPath.length === 0) return 'concise';
  const norm = docPath.replace(/\\/g, '/');
  const base = norm.split('/').pop() || norm;

  if (/^README(\.[\w-]+)?\.md$/i.test(base)) return 'concise';
  if (base === 'MAKE_MY_DREAMS.md') return 'reference';
  if (/^SPEC_V.*\.md$/i.test(base)) return 'reference';
  if (norm.includes('docs/adr/')) return 'reference';
  if (norm.includes('docs/specs/')) return 'reference';
  return 'concise';
}

/**
 * Split a markdown doc into its top-level `##` sections, each with its heading,
 * 1-based start line, and line span (heading line through the line before the
 * next `##` or EOF). The preamble before the first `##` is NOT a section. A
 * fenced code block is respected so a `## ` written inside ``` is not a heading.
 *
 * @param {string} text
 * @returns {Array<{ heading: string, startLine: number, endLine: number, lines: number }>}
 */
function splitSections(text) {
  const lines = typeof text === 'string' ? text.split('\n') : [];
  const sections = [];
  let inFence = false;
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const isHeading = !inFence && /^##\s+/.test(line);
    if (isHeading) {
      if (current) {
        current.endLine = i; // previous section ends on the line before this heading
        current.lines = current.endLine - current.startLine + 1;
        sections.push(current);
      }
      current = { heading: line.replace(/^##\s+/, '').trim(), startLine: i + 1, endLine: lines.length, lines: 0 };
    }
  }
  if (current) {
    current.lines = current.endLine - current.startLine + 1;
    sections.push(current);
  }
  return sections;
}

/**
 * Assess a doc's structure for its role (AC-3). PURE, never throws.
 *
 * @param {{
 *   docPath?: string,
 *   docText?: string,
 *   role?: 'concise'|'reference',  // explicit role overrides the filename heuristic
 *   budget?: number,               // concise-doc line budget (default 200)
 * }} args
 * @returns {{
 *   role: 'concise'|'reference',
 *   overBudget: boolean,
 *   lineCount: number,
 *   budget: number,
 *   oversizedSections: Array<{ heading: string, startLine: number, endLine: number, lines: number }>,
 *   changelogInline: boolean,
 *   heuristic: true,
 * }}
 */
export function assessDocStructure(args) {
  const a = args && typeof args === 'object' ? args : {};
  const docPath = typeof a.docPath === 'string' ? a.docPath : '';
  const docText = typeof a.docText === 'string' ? a.docText : '';
  const role = a.role === 'concise' || a.role === 'reference' ? a.role : inferRole(docPath);
  const budget = Number.isFinite(a.budget) && a.budget > 0 ? a.budget : DEFAULT_CONCISE_BUDGET;

  const lineCount = docText.length === 0 ? 0 : docText.split('\n').length;

  // REFERENCE role → exempt. A reference doc is legitimately long; we never flag
  // it over budget nor list oversized sections (SPEC §1.3 — role-aware, not blanket).
  if (role === 'reference') {
    return {
      role, overBudget: false, lineCount, budget,
      oversizedSections: [], changelogInline: false, heuristic: true,
    };
  }

  const overBudget = lineCount > budget;
  const sectionCap = Math.max(1, Math.floor(budget / OVERSIZED_SECTION_FRACTION));
  const oversizedSections = splitSections(docText).filter((s) => s.lines > sectionCap);
  const changelogInline = docText.includes(CHANGELOG_MARKER) || splitSections(docText).some((s) => /^changelog$/i.test(s.heading));

  return {
    role, overBudget, lineCount, budget,
    oversizedSections, changelogInline, heuristic: true,
  };
}

export { splitSections, DEFAULT_CONCISE_BUDGET, CHANGELOG_MARKER };
