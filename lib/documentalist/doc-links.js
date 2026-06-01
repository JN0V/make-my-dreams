// lib/documentalist/doc-links.js — the Documentalist's doc↔doc link extractor
// (SPEC_V07D AC-1). The doc→doc edge source of the v0.7.d coherence graph.
//
// SRP (universal.md §I.S): ONE job — given a doc's text, return the OTHER DOCS it
// links to as inter-doc edges {to, kind:'doc-link'}. It asserts edges; it does
// NOT build the graph (coherence-graph.js) nor read the filesystem. Pure: text
// (+ the doc's own path, for relative resolution) in, edges out — no I/O, no
// state. Same inputs → same edges.
//
// THREE link forms (SPEC AC-1), all resolved to a repo-relative path where
// determinable, conservative otherwise (don't invent an edge we cannot place —
// an unresolvable target is the v0.7.b drift detector's concern, not the graph's):
//   1. Wiki-links `[[name]]` (an `[[target|alias]]` keeps the target; a trailing
//      `#anchor` is dropped) → a sibling `<dir>/<name>.md` (or the given relative
//      path if the name already carries a slash / `.md`).
//   2. `ADR-NNN` references → the real ADR file when an `resolveAdr` resolver is
//      injected (the subcommand builds one from the inventory), else the stable
//      number-keyed stem `docs/adr/NNN` (the number IS determinable; the slug is
//      not, from text alone).
//   3. Relative markdown links `](../foo.md)` / `](docs/specs/SPEC_V06A.md)` to
//      another doc (`.md` targets only — a link to code is doc-refs.js's job;
//      http/mailto/anchor/absolute links are skipped).
//
// DISTINCT IN PURPOSE from doc-refs.js (the v0.7.b extractor): that one pulls the
// CODE artifacts a doc claims exist (doc→code); this one pulls the OTHER DOCS a
// doc points at (doc→doc). Together they supply two of the graph's three edge
// sources (computeBlastRadius supplies the third, code↔code).
//
// NEVER THROWS (error-handling §III): non-string / odd input → [].

// ── Path helpers (hand-rolled POSIX, no node:path — keeps the module pure and
// deterministic across platforms, mirroring import-graph.js) ────────────────

function dirOf(file) {
  const norm = String(file).replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? '' : norm.slice(0, idx);
}

// Resolve `.`/`..` segments of a POSIX-ish path. A leading `..` that escapes the
// root is kept (it simply won't match any real node downstream).
function normalizePath(p) {
  const out = [];
  for (const seg of String(p).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}

// Join a target relative to a base directory and normalize to repo-relative.
function resolveRelative(baseDir, target) {
  const joined = baseDir ? `${baseDir}/${target}` : target;
  return normalizePath(joined.replace(/\\/g, '/'));
}

const WIKI_RE = /\[\[([^\]]+)\]\]/g;
const ADR_RE = /\bADR-(\d{1,4})\b/g;
// Markdown inline link target: the `(...)` after a `]`. We capture up to the
// first `)`; a link title (`](url "t")`) and a `#anchor` are stripped below.
const MD_LINK_RE = /\]\(([^)]+)\)/g;

const pad3 = (n) => String(n).padStart(3, '0');

/**
 * Extract the inter-doc edges a doc asserts (AC-1). Pure, never throws.
 *
 * @param {string} text the doc's full text
 * @param {{ docPath?: string, resolveAdr?: (num: number) => (string|null) }} [opts]
 *   docPath: the doc's repo-relative path (the base for relative resolution).
 *   resolveAdr: optional pure resolver mapping an ADR number to its repo-relative
 *     file; when absent / returns null, the ADR edge falls back to the stem
 *     `docs/adr/NNN`. Injected (not read here) so the module stays pure.
 * @returns {Array<{ to: string, kind: 'doc-link' }>} de-duplicated by `to`,
 *   in first-seen order. `[]` for empty / non-string input.
 */
export function extractDocLinks(text, opts = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];
  try {
    const docPath = opts && typeof opts.docPath === 'string' ? opts.docPath : '';
    const baseDir = dirOf(docPath);
    const resolveAdr = opts && typeof opts.resolveAdr === 'function' ? opts.resolveAdr : null;
    const edges = [];

    // 1. Wiki-links [[name]] (and [[target|alias]]).
    WIKI_RE.lastIndex = 0;
    let m;
    while ((m = WIKI_RE.exec(text)) !== null) {
      let name = m[1].split('|')[0].split('#')[0].trim();
      if (!name) continue;
      const target = /\.md$/i.test(name) ? name : `${name}.md`;
      const to = resolveRelative(baseDir, target);
      if (to) edges.push({ to, kind: 'doc-link' });
    }

    // 2. ADR-NNN references → the real file (resolver) or the number-keyed stem.
    ADR_RE.lastIndex = 0;
    while ((m = ADR_RE.exec(text)) !== null) {
      const num = Number(m[1]);
      let to = null;
      if (resolveAdr) {
        try {
          const r = resolveAdr(num);
          if (typeof r === 'string' && r) to = r.replace(/\\/g, '/');
        } catch {
          to = null; // a throwing resolver never breaks extraction
        }
      }
      if (!to) to = `docs/adr/${pad3(num)}`;
      edges.push({ to, kind: 'doc-link' });
    }

    // 3. Relative markdown links to other docs (.md only).
    MD_LINK_RE.lastIndex = 0;
    while ((m = MD_LINK_RE.exec(text)) !== null) {
      let target = m[1].trim().split(/\s+/)[0]; // drop a `"title"` suffix
      target = target.split('#')[0]; // drop a #anchor
      if (!target) continue;
      // Skip external / absolute / anchor-only links — not an inter-doc edge.
      if (/^(?:https?:|mailto:|tel:|ftp:|#|\/)/i.test(target)) continue;
      if (!/\.md$/i.test(target)) continue; // a code link is doc-refs.js's job
      const to = resolveRelative(baseDir, target);
      if (to) edges.push({ to, kind: 'doc-link' });
    }

    // Dedup by target, first-seen order.
    const seen = new Set();
    const out = [];
    for (const e of edges) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      out.push(e);
    }
    return out;
  } catch {
    return [];
  }
}
