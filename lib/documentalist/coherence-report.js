// lib/documentalist/coherence-report.js — pure markdown render of the
// Documentalist's coherence review (SPEC_V07A AC-3, render half).
//
// SRP (universal.md §I.S): turn an inventory + a roadmap reconciliation (+ an
// optional LLM-enrichment block) into the markdown of docs/coherence-review.md.
// Pure: no I/O, no decisions about WHAT is built (that is roadmap-reconcile.js)
// and no gathering (inventory.js). Same inputs → same bytes.
//
// Human-readable first (universal §VII): the report leads with prose a newcomer
// understands, labels the heuristic honestly, and pairs every code (ADR-NNN,
// vX.Y) with its plain-language capability. It is a dashboard for the tired
// owner at 2 a.m., not a parser artifact.

// Status → human glyph + word. `unknown` is the honest fallback when the
// reconciliation could not decide (e.g. no inventory) — never a fabricated verdict.
const STATUS_GLYPH = {
  built: '✅ built',
  partial: '🟡 partial',
  unbuilt: '❌ unbuilt',
  unknown: '❓ unknown',
};

// A root SPEC_V*.md count above this is flagged as sprawl (an archive candidate
// for v0.7.b). The figure is advisory — the flag is what matters, not the exact
// threshold (today MMD sits far above it).
export const SPEC_SPRAWL_THRESHOLD = 10;

// Escape a markdown table cell: a literal pipe would break the column layout.
function cell(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Render the designed-vs-built reconciliation table.
 * @param {object} reconciliation  output of reconcileRoadmap
 * @returns {string}
 */
function renderReconciliation(reconciliation) {
  const note = reconciliation && typeof reconciliation.note === 'string'
    ? reconciliation.note
    : 'heuristic';
  const entries = reconciliation && Array.isArray(reconciliation.entries)
    ? reconciliation.entries
    : [];

  const lines = [
    '## Designed vs built (roadmap §9 reconciliation — heuristic)',
    '',
    `_${note}._`,
    '',
  ];
  if (entries.length === 0) {
    lines.push('_(No roadmap entries parsed — the §9 roadmap was empty or unreadable.)_');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| Capability (roadmap) | Version | Signal | Status |');
  lines.push('|---|---|---|---|');
  for (const e of entries) {
    const status = STATUS_GLYPH[e.status] || STATUS_GLYPH.unknown;
    lines.push(`| ${cell(e.capability)} | ${cell(e.version)} | ${cell(e.signal)} | ${status} |`);
  }
  lines.push('');
  lines.push('Legend: ✅ built · 🟡 partial · ❌ unbuilt · ❓ unknown.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the doc-health section: length-cap violations + SPEC sprawl.
 * @param {object} inventory
 * @returns {string}
 */
function renderDocHealth(inventory) {
  const lines = ['## Doc health', ''];
  const flags = [];

  const docs = Array.isArray(inventory?.docLineCounts) ? inventory.docLineCounts : [];
  const cap = typeof inventory?.docCap === 'number' ? inventory.docCap : 200;
  for (const d of docs) {
    if (d && d.overCap) {
      flags.push(
        `⚠️ ${d.doc}: ${d.lines} lines (cap ${cap} per MAKE_MY_DREAMS §6.4.4) — split candidate`,
      );
    }
  }

  const specCount = typeof inventory?.specCount === 'number' ? inventory.specCount : 0;
  if (specCount > SPEC_SPRAWL_THRESHOLD) {
    flags.push(
      `⚠️ ${specCount} SPEC_V*.md at the repo root — sprawl, archive candidate (v0.7.b active compaction)`,
    );
  }

  if (flags.length === 0) {
    lines.push('- ✅ No doc-health flags (every key doc within the cap; SPEC count under the sprawl threshold).');
  } else {
    for (const f of flags) lines.push(`- ${f}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * One-line tag range for the inventory header.
 * @param {string[]} tags
 * @returns {string}
 */
function tagRange(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return 'no tags';
  if (tags.length === 1) return tags[0];
  return `${tags[0]}..${tags[tags.length - 1]}`;
}

/**
 * Render the inventory summary section.
 * @param {object} inventory
 * @returns {string}
 */
function renderInventory(inventory) {
  const subs = Array.isArray(inventory?.subcommands) ? inventory.subcommands : [];
  const adrs = Array.isArray(inventory?.adrs) ? inventory.adrs : [];
  const libs = Array.isArray(inventory?.libModules) ? inventory.libModules : [];
  const tags = Array.isArray(inventory?.tags) ? inventory.tags : [];
  const lessonCount = typeof inventory?.lessonCount === 'number'
    ? `${inventory.lessonCount}` : 'unknown';

  const headline =
    `${subs.length} subcommands · ${adrs.length} ADRs · ${lessonCount} lessons · ` +
    `tags ${tagRange(tags)}`;

  const lines = [`## Inventory  (${headline})`, ''];
  lines.push(`- **Subcommands** (${subs.length}): ${subs.length ? subs.join(', ') : '(none found)'}`);
  lines.push(`- **lib/ modules** (${libs.length}): ${libs.length ? libs.join(', ') : '(none found)'}`);

  const latest = adrs.length ? adrs[adrs.length - 1] : null;
  const latestStr = latest && latest.number != null
    ? `latest ADR-${String(latest.number).padStart(3, '0')} — ${latest.title || '(untitled)'}`
    : '(none found)';
  lines.push(`- **ADRs** (${adrs.length}): ${latestStr}`);
  lines.push(`- **Active lessons**: ${lessonCount}`);
  lines.push(`- **Root SPEC files**: ${typeof inventory?.specCount === 'number' ? inventory.specCount : 0}`);
  lines.push(`- **Tags**: ${tags.length} (${tagRange(tags)})`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the Drift / conformance section (SPEC_V07B AC-3): dangling artifact
 * references (file:line) + bounded stale facts, advisory and flag-only. The
 * optional `--with-claude` semantic-drift sub-block renders honestly (a fallback
 * note, never a fabricated "conformant" verdict) when the LLM is unavailable.
 *
 * @param {{
 *   dangling?: Array<{ doc: string, line: number, ref: string, kind: string, reason: string }>,
 *   staleFacts?: Array<{ doc: string, line: number, claim: string, actual: any }>,
 *   scannedDocs?: number,
 *   semantic?: { requested: boolean, text: string|null, note: string|null },
 * }} drift
 * @returns {string}
 */
function renderDrift(drift) {
  const dangling = Array.isArray(drift?.dangling) ? drift.dangling : [];
  const staleFacts = Array.isArray(drift?.staleFacts) ? drift.staleFacts : [];
  const scanned = typeof drift?.scannedDocs === 'number' ? drift.scannedDocs : 0;

  const lines = ['## Drift / conformance  (does the doc still match reality?)', ''];
  lines.push(
    `_Heuristic + advisory — the Documentalist **flags** drift, it does **NOT** edit your docs ` +
    `(detect-before-correct). Scanned ${scanned} truth doc${scanned === 1 ? '' : 's'}._`,
  );
  lines.push('');

  lines.push('### Dangling references (a doc claims an artifact that does not exist)');
  lines.push('');
  if (dangling.length === 0) {
    lines.push('- ✅ No dangling references — every claimed file / subcommand / ADR / lib module resolves.');
  } else {
    for (const d of dangling) {
      lines.push(`- ⚠️ ${cell(d.doc)}:${d.line} → \`${cell(d.ref)}\` — ${cell(d.reason)}`);
    }
  }
  lines.push('');

  lines.push('### Stale facts (a prose claim disagrees with the live inventory)');
  lines.push('');
  if (staleFacts.length === 0) {
    lines.push('- ✅ No stale facts — bounded counts / current-version claims match the inventory.');
  } else {
    for (const f of staleFacts) {
      lines.push(`- ⚠️ ${cell(f.doc)}:${f.line} says "${cell(f.claim)}" — inventory has ${cell(f.actual)}`);
    }
  }
  lines.push('');

  // Opt-in semantic-drift sub-block. Honest fallback, never a fabricated verdict.
  const sem = drift?.semantic;
  if (sem && sem.requested) {
    lines.push('### Semantic drift (`--with-claude`)');
    lines.push('');
    if (typeof sem.text === 'string' && sem.text.trim()) {
      lines.push(sem.text.trim());
    } else {
      lines.push(
        `_(LLM drift check unavailable${sem.note ? `: ${sem.note}` : ''} — ` +
        'no semantic-conformance verdict was fabricated; rely on the deterministic checks above.)_',
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render the optional LLM-enrichment section (--with-claude). When enrichment
 * is null but was requested, render the honest "unavailable" note (never a
 * fabricated classification — the sacred uncertain discipline, universal §VI).
 *
 * @param {{ requested: boolean, enrichment: string|null, note: string|null }} llm
 * @returns {string}
 */
function renderEnrichment(llm) {
  if (!llm || !llm.requested) return '';
  const lines = ['## LLM enrichment (`--with-claude`)', ''];
  if (typeof llm.enrichment === 'string' && llm.enrichment.trim()) {
    lines.push(llm.enrichment.trim());
  } else {
    lines.push(
      `_(LLM enrichment unavailable${llm.note ? `: ${llm.note}` : ''} — ` +
      'falling back to the deterministic report above. No classification was fabricated.)_',
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the full coherence-review markdown (AC-3). Pure.
 *
 * @param {{
 *   inventory: object,
 *   reconciliation: object,
 *   llm?: { requested: boolean, enrichment: string|null, note: string|null },
 *   drift?: { dangling: object[], staleFacts: object[], scannedDocs: number, semantic?: object },
 *   generatedBy?: string,
 *   version?: string,
 * }} args
 * @returns {string}
 */
export function renderCoherenceReport(args) {
  const {
    inventory = {},
    reconciliation = {},
    llm = { requested: false, enrichment: null, note: null },
    drift = null,
    generatedBy = 'mmdream document-review',
    version = null,
  } = args || {};

  const parts = [];
  // Machine-owned banner (mirrors document-readme's generated-block discipline):
  // this file is regenerated, never hand-edited.
  parts.push(
    `<!-- GENERATED by \`${generatedBy}\` — regenerate after any material change; do NOT hand-edit. -->`,
  );
  parts.push('# MMD Coherence Review');
  parts.push('');
  parts.push(
    '> Generated on demand by `mmdream document-review` — the Documentalist\'s **detection** face: ' +
    'a designed-vs-built reconciliation of the roadmap against MMD\'s real surface, plus doc-health ' +
    'flags. It is a **dashboard, not a hand-maintained doc** — regenerate it after any material ' +
    'change (new subcommand, ADR, tag, or `MAKE_MY_DREAMS.md` edit) with `mmdream document-review`. ' +
    'The designed-vs-built table is a **heuristic** (name-matching), not an authoritative audit; ' +
    'run `mmdream document-review --with-claude` to layer LLM judgment on top.',
  );
  if (version) {
    parts.push('');
    parts.push(`_MMD ${version}._`);
  }
  parts.push('');
  parts.push(renderReconciliation(reconciliation));
  parts.push(renderDocHealth(inventory));
  parts.push(renderInventory(inventory));
  // Drift / conformance (AC-3). Rendered only when the caller supplies a drift
  // payload, so v0.7.a callers (no drift) keep their exact output (back-compat).
  if (drift) parts.push(renderDrift(drift));
  const enrich = renderEnrichment(llm);
  if (enrich) parts.push(enrich);

  let out = parts.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}
