// lib/documentalist/roadmap-reconcile.js — the Documentalist's designed-vs-built
// reconciliation (SPEC_V07A AC-2).
//
// SRP (universal.md §I.S): parse the MAKE_MY_DREAMS.md §9 roadmap into
// {version, capability} entries and classify each built / partial / unbuilt by
// matching the capability name against the deterministic inventory. Pure
// transform — no I/O, no rendering (coherence-report.js renders; inventory.js
// gathers). Same input → same output, always.
//
// HONEST HEURISTIC, NOT AN AUDIT (universal §VI, SPEC §5.3): this matches
// roadmap capability *names* against inventory *names* (subcommands, lib
// modules, ADR titles, tags). It cannot tell "full Documentalist" from "lite
// Documentalist" or know that a shipped lib is only half the planned feature —
// it sees names, not behaviour. So it is deliberately CONSERVATIVE:
//   • a single capability with every concept strongly matched   → built
//   • a compound capability with some concepts strongly matched,
//     some not                                                  → partial
//     (the honest middle: "part of this shipped, part didn't")
//   • ONLY a weak token / shipped-tag signal (no real NAME match) → unknown
//     (the honest "we can't tell" — NEVER a false "partial")
//   • no signal anywhere                                         → unbuilt
//     (the honest default for "we cannot find it" — never a false "built")
// The renderer labels the table a heuristic; `--with-claude` (the subcommand's
// opt-in) is where real judgment is layered on. Malformed input → every entry
// 'unknown', never throws.
//
// SPEC_V018A AC-1 — NO FALSE "partial" ON A WEAK SIGNAL: the previous heuristic
// lifted a tag-number match (versionHasTag) OR a weak related-token match to
// `partial`. That manufactured false comfort: "Voice mode" read 🟡 partial only
// because a v0.11.x tag NUMBER existed (v0.11 was the alignment gate, not voice),
// and "parallel worktrees" read partial on a generic weak token. A `partial`
// must mean "part of THIS capability, by NAME, demonstrably shipped" — so it now
// requires at least one STRONG capability-name match. A weak/tag-only signal is
// classified `unknown` (honestly "can't tell from names alone"), never `partial`.

const UNKNOWN = 'unknown';

// Words too common across MMD's surface to count as a distinctive "weak" match
// on their own (they would create false signals — e.g. "dream" appears in both
// "Dream Expander" [unbuilt] and lib/dream-catcher [built]). A weak signal must
// be a distinctive token, not one of these.
const COMMON_WORDS = new Set([
  'dream', 'mode', 'modes', 'engine', 'engines', 'worker', 'workers', 'bundle',
  'real', 'minimal', 'full', 'conversational', 'structure', 'shared', 'local',
  'deferred', 'integrates', 'automated', 'optional', 'explicit', 'stateless',
  'divergent', 'advanced', 'project', 'system', 'support', 'simple', 'based',
  'with', 'from', 'into', 'over', 'this', 'that', 'gstack', 'bmad',
]);

// Connectors that conjoin multiple deliverables in one roadmap title. Splitting
// on these turns "Documentalist + Context Worker" into two concepts so a
// half-built compound classifies as `partial`, not a false `built`.
const CONCEPT_SPLIT = /\s*[+&]\s*|\s+\+\s+/;

/**
 * Lowercase a string into significant word tokens, plural-normalized (trailing
 * 's' stripped) so "tests" matches "test". Punctuation is dropped.
 *
 * @param {string} s
 * @returns {string[]}
 */
function tokens(s) {
  if (typeof s !== 'string') return [];
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

/**
 * Build the matchable signal sets from an inventory object. Each subcommand and
 * lib-module name becomes a token-set; ADR titles + names contribute a flat
 * distinctive-token set for weak matching.
 *
 * @param {object} inventory
 * @returns {{
 *   nameTokenSets: string[][],   // per subcommand + per lib module (for STRONG subset match)
 *   nameLabels: string[][],      // parallel labels [kind, name] for the signal text
 *   weakTokens: Set<string>,     // all distinctive tokens from names + ADR titles (for WEAK match)
 *   tags: string[],
 * }}
 */
function buildSignals(inventory) {
  const nameTokenSets = [];
  const nameLabels = [];
  const weakTokens = new Set();

  const addName = (kind, name) => {
    if (typeof name !== 'string' || !name) return;
    const tks = tokens(name);
    if (tks.length === 0) return;
    nameTokenSets.push(tks);
    nameLabels.push([kind, name]);
    for (const t of tks) if (!COMMON_WORDS.has(t)) weakTokens.add(t);
  };

  const subs = Array.isArray(inventory?.subcommands) ? inventory.subcommands : [];
  for (const s of subs) addName('subcmd', s);
  const libs = Array.isArray(inventory?.libModules) ? inventory.libModules : [];
  for (const m of libs) addName('lib', m);

  const adrs = Array.isArray(inventory?.adrs) ? inventory.adrs : [];
  for (const a of adrs) {
    for (const t of tokens(a?.title)) if (!COMMON_WORDS.has(t)) weakTokens.add(t);
  }

  const tags = Array.isArray(inventory?.tags) ? inventory.tags : [];
  return { nameTokenSets, nameLabels, weakTokens, tags };
}

/**
 * Classify ONE concept (a sub-phrase of a capability) against the signals.
 *   STRONG: some subcommand/lib-module's full token-set ⊆ the concept's tokens
 *           (the named thing literally appears in the capability — e.g. lib
 *           module {reality, check} ⊆ "polymorphic reality check").
 *   WEAK:   a distinctive concept token appears in any name/ADR title.
 *   NONE:   no signal.
 *
 * @returns {{ strength: 'strong'|'weak'|'none', label: string|null }}
 */
function classifyConcept(concept, signals) {
  const tks = new Set(tokens(concept));
  if (tks.size === 0) return { strength: 'none', label: null };

  for (let i = 0; i < signals.nameTokenSets.length; i += 1) {
    const set = signals.nameTokenSets[i];
    if (set.length > 0 && set.every((t) => tks.has(t))) {
      const [kind, name] = signals.nameLabels[i];
      return { strength: 'strong', label: `${kind} ${name}` };
    }
  }

  for (const t of tks) {
    if (!COMMON_WORDS.has(t) && t.length >= 5 && signals.weakTokens.has(t)) {
      return { strength: 'weak', label: `related: ${t}` };
    }
  }
  return { strength: 'none', label: null };
}

/**
 * Does the roadmap version correspond to a shipped git tag? A weak,
 * version-presence signal — never enough to call a capability "built" on its
 * own (a shipped vX.Y tag does not mean every capability the roadmap bundled
 * under vX.Y shipped), but enough to lift an otherwise-unsignalled entry off
 * "unbuilt" to "partial". Matches a tag that starts with the (dot-suffixed)
 * version, so "v0.4" matches tag "v0.4.0" but NOT the lettered "v0.4b".
 *
 * @param {string} version
 * @param {string[]} tags
 * @returns {boolean}
 */
function versionHasTag(version, tags) {
  if (typeof version !== 'string' || !Array.isArray(tags)) return false;
  // Only plain numeric versions (no trailing letter) map to release tags.
  if (!/^v\d+\.\d+$/.test(version)) return false;
  return tags.some((t) => typeof t === 'string' && t.startsWith(`${version}.`));
}

/**
 * Parse the §9 roadmap text into entries. Headers look like:
 *   ### v0.3a — Dream Expander (real BMAD/CIS brainstorming)  *(4–5 days)*
 * We strip the trailing `*(…)*` time estimate from the capability.
 *
 * @param {string} roadmapText
 * @returns {Array<{ version: string, capability: string }>}
 */
function parseRoadmap(roadmapText) {
  if (typeof roadmapText !== 'string') return [];
  const entries = [];
  const re = /^###\s+(v[\d.]+[a-z]?)\s+[—–-]\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(roadmapText)) !== null) {
    const version = m[1];
    // Drop a trailing `*(...)*` estimate and any stray surrounding whitespace.
    const capability = m[2].replace(/\s*\*\([^)]*\)\*\s*$/, '').trim();
    if (capability) entries.push({ version, capability });
  }
  return entries;
}

/**
 * Reconcile the roadmap against the inventory (AC-2). Pure.
 *
 * @param {{ roadmapText: string, inventory: object }} args
 * @returns {{
 *   heuristic: true,
 *   note: string,
 *   entries: Array<{ version: string, capability: string, status: string, signal: string }>,
 * }}
 */
export function reconcileRoadmap(args) {
  const heuristicNote =
    'heuristic — matched roadmap capability names against the built inventory ' +
    '(subcommands / lib modules / ADR titles / tags); not an authoritative audit';

  const roadmapText = args && typeof args.roadmapText === 'string' ? args.roadmapText : null;
  const inventory = args && typeof args.inventory === 'object' && args.inventory ? args.inventory : null;

  // Malformed input → every-entry-unknown (or empty), never throws.
  if (roadmapText === null) {
    return { heuristic: true, note: heuristicNote, entries: [] };
  }

  const entries = parseRoadmap(roadmapText);
  const signals = inventory
    ? buildSignals(inventory)
    : { nameTokenSets: [], nameLabels: [], weakTokens: new Set(), tags: [] };

  const classified = entries.map(({ version, capability }) => {
    // No inventory at all → we cannot decide → unknown (honest, never throws).
    if (!inventory) {
      return { version, capability, status: UNKNOWN, signal: '(no inventory)' };
    }

    const concepts = capability.split(CONCEPT_SPLIT).map((c) => c.trim()).filter(Boolean);
    const conceptList = concepts.length > 0 ? concepts : [capability];
    const verdicts = conceptList.map((c) => classifyConcept(c, signals));

    const strong = verdicts.filter((v) => v.strength === 'strong');
    const weak = verdicts.filter((v) => v.strength === 'weak');
    const labels = verdicts.map((v) => v.label).filter(Boolean);

    // SPEC_V018A AC-1: a `partial`/`built` verdict REQUIRES a STRONG (real
    // capability-NAME) match. A weak token or a shipped-tag number alone is NOT
    // evidence the named capability shipped — it is honestly `unknown`, never a
    // falsely-comforting `partial`.
    let status;
    if (strong.length === verdicts.length && strong.length > 0) {
      status = 'built';
    } else if (strong.length > 0) {
      status = 'partial'; // mixed compound: some concepts shipped (by NAME), some not
    } else if (weak.length > 0) {
      // A weak related-token match (no name match) → we can't tell. UNKNOWN, not
      // a false partial. The label keeps the weak signal visible + honest.
      status = UNKNOWN;
    } else if (versionHasTag(version, signals.tags)) {
      // The version shipped a tag but NO capability-name signal — a tag NUMBER is
      // not proof THIS capability shipped (the "Voice mode" false-partial bug).
      status = UNKNOWN;
      labels.push(`tag ${version}.x shipped (no capability-name match — unverified)`);
    } else {
      status = 'unbuilt';
    }

    const signal = labels.length > 0 ? labels.join(', ') : '(none)';
    return { version, capability, status, signal };
  });

  return { heuristic: true, note: heuristicNote, entries: classified };
}
