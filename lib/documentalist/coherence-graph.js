// lib/documentalist/coherence-graph.js — the Documentalist's coherence graph
// (SPEC_V07D AC-2). Composes the three derived edge sources (code↔code imports,
// doc→code refs, doc↔doc links) into ONE file-level, bidirectional graph and
// walks it: given the files a diff changed, which OTHER files should a human
// review because they are coupled to the change?
//
// SRP (universal.md §I.S): TWO pure functions, no I/O, no rendering.
//   • buildCoherenceGraph({importEdges, docToCodeEdges, docLinkEdges}) → a
//     file-level bidirectional adjacency (each edge tagged with its kind).
//   • coupledNeighbors(graph, changedFiles) → per changed file, its neighbors
//     RANKED by edge strength (direct strong edge before transitive/weak),
//     de-duplicated, excluding the changed set.
//
// DERIVE, NEVER MAINTAIN (SPEC §1, the golden rule): the graph is rebuilt from
// edges that already exist for free; nothing here is hand-curated, so it cannot
// rot. ADVISORY + RANKED, never a hard gate: coupling ≠ certainty (universal §VI).
//
// §VIII (technology-agnostic): this module is LANGUAGE-NEUTRAL — it consumes
// already-resolved `{from, to}` edges and contains no language syntax. As of
// v0.8.1 the code↔code (`import`) edges it receives come from the POLYGLOT import
// graph (per-language adapters via lib/code-graph/adapters — JS, Python, …); the
// `--since` caller (bin/documentalist/document-review.js) honestly notes any
// language in the diff that has no import adapter yet rather than silently
// omitting its coupling. Nothing here needed to change for that — which is the
// point: the syntax lives in the adapters, never in this graph (SPEC_V081).
//
// RANKING (SPEC AC-2, kept deliberately simple):
//   • STRONG  = a DIRECT edge (one hop) — an import / doc-ref / doc-link. The
//     neighbor carries that edge's kind.
//   • WEAK    = a TRANSITIVE neighbor (two hops — a neighbor of a direct
//     neighbor). We stop at two hops on purpose: beyond that the coupling is too
//     diffuse to be an actionable review hint (precision-first, the v0.7.b
//     discipline — a graph that flags everything flags nothing). The full
//     transitive import closure remains the sealed-gate blast radius's job.
//   A node reachable BOTH directly and transitively is reported once, as STRONG.
//
// HUB SUPPRESSION (precision lever, AC-4) — TWO symmetric faces:
//   • hub TRANSIT (v0.7.d): we do NOT traverse transitively THROUGH a high-degree
//     "hub" node — a doc like CLAUDE.md / HANDOVER.md that references dozens of
//     ADRs would otherwise couple everything to everything (a change NEAR it would
//     weak-flag the whole repo). A direct neighbor whose degree exceeds HUB_DEGREE
//     is still reported (it is genuinely coupled), but its OWN neighbors are not
//     pulled in as weak edges.
//   • hub SOURCE (v0.7.e): when the CHANGED file ITSELF is a hub (you edit
//     CLAUDE.md), every one of its dozens of direct references would be reported
//     as `strong` — a flood that, per the v0.7.b discipline, flags nothing. So we
//     CAP a hub source to the top HUB_DEGREE direct neighbors (by the ranking
//     below), record how many were suppressed (`hubSuppressed` on the entry, for
//     an HONEST "+N more" note — never a silent truncation, universal §VI), and
//     skip its transitive layer (weak edges on top of a flood are pure noise).
// Together these keep the report to tight, actionable "these files travel
// together" couplings rather than hub noise — whether the hub is near the change
// or is the change.
//
// NEVER THROWS (error-handling §III): odd input, empty graph, or no changes → an
// explicit empty result, never a crash.

// Edge-kind precedence when two sources assert an edge between the same pair:
// keep the strongest/most-specific label deterministically (import < doc-ref <
// doc-link), independent of input order.
const KIND_RANK = { import: 0, 'doc-ref': 1, 'doc-link': 2 };

// A node with more than this many edges is a "hub" (e.g. a top-level doc that
// references most of the repo). Used BOTH ways (see HUB SUPPRESSION above): a hub
// is not used as a transit node for weak edges, and a changed file that is itself
// a hub has its direct-neighbor list capped to this many entries. Tuned so genuine
// clusters (a test importing a few modules, an ADR citing a few files) still
// propagate, while doc hubs do not. Exported for test robustness (tests assert
// behavior at this boundary without hard-coding the number).
export const HUB_DEGREE = 12;

function strongerKind(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (KIND_RANK[a] ?? 99) <= (KIND_RANK[b] ?? 99) ? a : b;
}

function normFile(f) {
  return typeof f === 'string' ? f.replace(/\\/g, '/') : null;
}

/**
 * Build the file-level bidirectional coherence graph.
 *
 * Each input is an array of `{ from, to }` edges (extra fields ignored). An edge
 * A→B is stored BOTH ways (A↔B) so a coupling surfaces when EITHER endpoint
 * changes (SPEC §1: "doc references code" must surface when the code changes too).
 * Self-edges and junk endpoints are dropped.
 *
 * @param {{
 *   importEdges?: Array<{from: string, to: string}>,     code↔code (kind 'import')
 *   docToCodeEdges?: Array<{from: string, to: string}>,  doc→code  (kind 'doc-ref')
 *   docLinkEdges?: Array<{from: string, to: string}>,    doc↔doc   (kind 'doc-link')
 * }} [sources]
 * @returns {Map<string, Map<string, string>>} node → (neighbor → kind). Never throws.
 */
export function buildCoherenceGraph(sources = {}) {
  const graph = new Map();
  try {
    const groups = [
      ['import', sources.importEdges],
      ['doc-ref', sources.docToCodeEdges],
      ['doc-link', sources.docLinkEdges],
    ];

    const link = (a, b, kind) => {
      if (!graph.has(a)) graph.set(a, new Map());
      const adj = graph.get(a);
      adj.set(b, strongerKind(adj.get(b), kind));
    };

    for (const [kind, edges] of groups) {
      if (!Array.isArray(edges)) continue;
      for (const e of edges) {
        if (!e || typeof e !== 'object') continue;
        const from = normFile(e.from);
        const to = normFile(e.to);
        if (!from || !to || from === to) continue; // a file is never its own neighbor
        link(from, to, kind);
        link(to, from, kind); // bidirectional
      }
    }
    return graph;
  } catch {
    return new Map();
  }
}

/**
 * Walk the graph from each changed file and return its coupled neighbors to
 * review, ranked strong-then-weak (AC-2).
 *
 * @param {Map<string, Map<string, string>>} graph from buildCoherenceGraph
 * @param {Iterable<string>} changedFiles the files a diff touched
 * A changed file that is itself a HUB (more than HUB_DEGREE direct neighbors) is
 * capped to its top HUB_DEGREE direct neighbors (by the ranking below) and carries
 * an extra `hubSuppressed` count of the dropped neighbors; its transitive layer is
 * skipped. An ordinary entry has no `hubSuppressed` field (back-compat shape).
 *
 * @returns {Array<{
 *   file: string,
 *   neighbors: Array<{ to: string, kind: 'import'|'doc-ref'|'doc-link'|'transitive', strength: 'strong'|'weak' }>,
 *   hubSuppressed?: number,
 * }>} one entry per changed file (input order, de-duplicated). A changed file
 *   with no edges → `neighbors: []` ("no neighbors"). Deterministic; never throws.
 */
export function coupledNeighbors(graph, changedFiles) {
  try {
    const g = graph instanceof Map ? graph : new Map();
    const changed = [];
    const changedSet = new Set();
    for (const f of changedFiles || []) {
      const n = normFile(f);
      if (n && !changedSet.has(n)) {
        changedSet.add(n);
        changed.push(n);
      }
    }
    if (changed.length === 0) return [];

    const result = [];
    for (const file of changed) {
      const direct = g.get(file); // Map<neighbor, kind> | undefined
      // best[neighbor] = { strength, kind } — strong wins over weak; among strong,
      // the stronger kind wins (deterministic).
      const best = new Map();

      // Direct (strong) neighbors, excluding co-changed files.
      const directNeighbors = [];
      if (direct) {
        for (const [nb, kind] of direct) {
          if (changedSet.has(nb)) continue; // never report a co-changed file
          directNeighbors.push([nb, kind]);
        }
      }
      // HUB SOURCE: the changed file itself couples to too much to be an
      // actionable hint. Cap to the top HUB_DEGREE direct neighbors and skip the
      // transitive layer (weak edges on top of a flood are pure noise). See header.
      const isHubSource = directNeighbors.length > HUB_DEGREE;

      for (const [nb, kind] of directNeighbors) {
        best.set(nb, { strength: 'strong', kind });
      }
      // Two-hop (transitive) neighbors: a neighbor of a direct neighbor. Skipped
      // entirely for a hub source; otherwise we do NOT transit THROUGH a hub
      // (high-degree) node — that would couple the whole repo through a top-level
      // doc (precision lever, see header).
      if (!isHubSource) {
        for (const [nb] of directNeighbors) {
          const second = g.get(nb);
          if (!second) continue;
          if (second.size > HUB_DEGREE) continue; // hub — report it, don't transit it
          for (const [nb2] of second) {
            if (changedSet.has(nb2)) continue;
            if (nb2 === file) continue;
            if (best.has(nb2)) continue; // already direct/strong (or seen) — keep strongest
            best.set(nb2, { strength: 'weak', kind: 'transitive' });
          }
        }
      }

      let neighbors = [...best.entries()].map(([to, v]) => ({
        to, kind: v.kind, strength: v.strength,
      }));
      // Rank: strong before weak; within a strength, by kind precedence then path
      // (fully deterministic regardless of Map insertion order).
      neighbors.sort((a, b) => {
        if (a.strength !== b.strength) return a.strength === 'strong' ? -1 : 1;
        const ka = KIND_RANK[a.kind] ?? 99;
        const kb = KIND_RANK[b.kind] ?? 99;
        if (ka !== kb) return ka - kb;
        return a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
      });

      // Cap a hub source AFTER ranking, so the kept top-N is the highest-ranked
      // slice (deterministic). Record the suppressed count for an honest "+N more"
      // note in the report — never a silent truncation (universal §VI).
      const entry = { file, neighbors };
      if (isHubSource && neighbors.length > HUB_DEGREE) {
        entry.hubSuppressed = neighbors.length - HUB_DEGREE;
        entry.neighbors = neighbors.slice(0, HUB_DEGREE);
      }
      result.push(entry);
    }
    return result;
  } catch {
    return [];
  }
}
