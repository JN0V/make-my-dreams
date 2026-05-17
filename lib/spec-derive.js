// lib/spec-derive.js — heuristic 1-page-spec generator for FAST mode.
//
// Per SPEC_V02.md AC-4: the FAST engine writes a small, deterministic spec to
// .mmd/shared/slice.md BEFORE invoking auto-dev. Without this grounding, the
// trimmed auto-dev pipeline diverges (scoping §3.1: "without this upfront
// spec, Ralph diverges — same warning applies to trimmed auto-dev").
//
// Heuristic only — not LLM-driven. Output is deterministic given the inputs.
// Budget: ≤ 50 lines AND ≤ 3000 chars (AC-4).
//
// Public API:
//   - deriveSpec({ dream, slug, vision? }) -> string
//   - inferAcceptanceCriteria(dream) -> string[]
//   - SPEC_MAX_LINES, SPEC_MAX_CHARS (constants for tests / introspection)

export const SPEC_MAX_LINES = 50;
export const SPEC_MAX_CHARS = 3000;

// Keyword → AC mapping. Order is significant: a dream matching multiple
// patterns is capped at 3 ACs total (the first 3 matches). Kept conservative
// — adding more patterns is cheap, but each one raises the false-positive
// risk in a heuristic without negative examples.
const KEYWORD_AC_MAP = Object.freeze([
  {
    keywords: ['button', 'bouton'],
    ac: 'the new button is visible AND clickable AND triggers the intended behavior',
  },
  {
    keywords: ['form', 'formulaire', 'submit', 'input field'],
    ac: 'the form submits successfully AND validation messages appear for invalid input',
  },
  {
    keywords: ['camera', 'caméra', 'webcam', 'video stream', 'getusermedia'],
    ac: 'the camera permission is requested on user gesture only AND a live preview is shown when granted',
  },
  {
    keywords: ['draw', 'paint', 'dessin', 'canvas', 'brush', 'pinceau'],
    ac: 'the user can draw freely on a canvas AND the strokes persist until cleared',
  },
  {
    keywords: ['upload', 'file picker', 'choose file', 'téléverser'],
    ac: 'a file selected by the user is processed AND its preview or result is visible',
  },
  {
    keywords: ['color', 'couleur'],
    ac: 'the color choice is honored across the relevant UI surfaces AND persists until the user changes it',
  },
  {
    keywords: ['save', 'sauvegarde', 'persist', 'localstorage'],
    ac: 'state is persisted AND restored on reload',
  },
]);

const FALLBACK_AC =
  'the requested feature is functional AND visible to the user AND no regression is observable in adjacent flows';

/**
 * Match the dream against the keyword map. At most 3 ACs returned to stay
 * within the 1-page budget. Returns the fallback AC if nothing matches.
 *
 * @param {string} dream
 * @returns {string[]}
 */
export function inferAcceptanceCriteria(dream) {
  if (typeof dream !== 'string' || dream.trim() === '') {
    return [FALLBACK_AC];
  }
  const lower = dream.toLowerCase();
  const matched = [];
  for (const { keywords, ac } of KEYWORD_AC_MAP) {
    if (keywords.some((k) => lower.includes(k))) {
      matched.push(ac);
      if (matched.length === 3) break;
    }
  }
  return matched.length > 0 ? matched : [FALLBACK_AC];
}

/**
 * Compose a deterministic 1-page spec from the dream + optional vision.
 *
 * Budget enforcement: if the assembled text exceeds SPEC_MAX_CHARS we
 * truncate at a safe character boundary and append a marker. This is a
 * defensive last resort — for typical inputs the natural output is ~1500
 * chars / ~35 lines.
 *
 * @param {{ dream: string, slug: string, vision?: string }} params
 * @returns {string}
 */
export function deriveSpec({ dream, slug, vision }) {
  if (typeof dream !== 'string' || dream.trim() === '') {
    throw new TypeError('deriveSpec: dream must be a non-empty string');
  }
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new TypeError('deriveSpec: slug must be a non-empty string');
  }

  const acs = inferAcceptanceCriteria(dream);
  const visionLine =
    typeof vision === 'string' && vision.trim().length > 0
      ? `Vision (inherited): ${summarizeVision(vision)}`
      : 'Vision: see vision.md (no prior long-term context provided).';

  const lines = [
    `# Slice — ${slug}`,
    '',
    `Dream: ${dream}`,
    '',
    'Goal: deliver the smallest end-to-end change that fulfills the dream above.',
    '',
    visionLine,
    '',
    '## Acceptance criteria (heuristic — FAST engine)',
    '',
    ...acs.map((ac, i) => `${i + 1}. ${ac}`),
    '',
    '## Scope',
    '',
    '- Brownfield by default: preserve adjacent functionality (no regression).',
    '- Minimal surface area: change only what the dream requires.',
    '- Stack: follow project conventions; do not introduce new runtime dependencies.',
    '',
    '## Out of scope',
    '',
    '- Refactors not strictly required by the dream.',
    '- New tooling, frameworks, or build steps.',
    '- Documentation beyond a one-line note in README when applicable.',
    '',
    '## Definition of done',
    '',
    '- Acceptance criteria above pass against a fresh manual or automated check.',
    '- Existing tests (where present) remain green; new tests stratified per testing.md §V.',
    '- No new runtime dependencies introduced.',
    '',
    '*Auto-derived by `mmd --fast`. Re-run with `--standard` for a richer spec.*',
  ];

  let text = lines.join('\n');

  if (text.length > SPEC_MAX_CHARS) {
    // Defensive truncation. Cut at SPEC_MAX_CHARS minus a small marker budget
    // and try to land on a newline so we don't sever mid-word.
    const cut = SPEC_MAX_CHARS - 80;
    let truncated = text.slice(0, cut);
    const lastNl = truncated.lastIndexOf('\n');
    if (lastNl > cut / 2) truncated = truncated.slice(0, lastNl);
    text = truncated + '\n\n*(truncated by spec-derive to fit the 1-page budget)*';
  }

  // The line budget is honored naturally by the template above. If it ever
  // grows, fall back to a soft cap rather than silently breaking — see
  // ai-coding.md §I (honesty over plausibility).
  const lineCount = text.split('\n').length;
  if (lineCount > SPEC_MAX_LINES) {
    // Keep the header + first SPEC_MAX_LINES-2 lines + a marker.
    const kept = text.split('\n').slice(0, SPEC_MAX_LINES - 2);
    kept.push('');
    kept.push('*(truncated by spec-derive to fit the 1-page line budget)*');
    text = kept.join('\n');
  }
  return text;
}

/**
 * Reduce a possibly multi-line vision to a single trimmed clause.
 * Drops markdown headings and joins the next two non-empty lines.
 */
function summarizeVision(visionText) {
  const lines = visionText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  return lines.slice(0, 2).join(' ').slice(0, 200);
}
