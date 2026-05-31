// lib/dream-catcher/level.js — the Dream Catcher involvement dial.
//
// SRP (constitution §I.S): owns the closed set of involvement LEVELS and the
// mapping from a level to the number of MMD-orchestrated clarifying turns. Pure
// — no I/O, no claude, no web. Surface-agnostic, mirroring profile.js: the web
// layer (v0.3.a-2) and a future CLI/TTY layer both normalize their raw input
// through here.
//
// Three levels (SPEC_V03A2 AC-1) — the user picks HOW INVOLVED they want to be:
//   - Autonome  — "Je te fais confiance": 0 clarifying turns (the a-1 path);
//                 one autonomous synthesize straight from dream + profile.
//   - Équilibré — the DEFAULT: 1 clarifying turn before synthesize.
//   - Guidé     — 2 (up to 3) clarifying turns before synthesize.
//
// The dial controls how many stateless headless calls MMD orchestrates, NOT a
// flag inside one BMAD call (a headless `claude -p` has no stdin — see L-021).
//
// An absent or unrecognized level defaults to Équilibré (never throws) — the
// level arrives from an untrusted web client (security.md), so a wrong value
// must degrade gracefully, not 500 (same discipline as profile.js).

/** The closed involvement-level enum. Frozen so callers cannot mutate it. */
export const LEVELS = Object.freeze({
  AUTONOME: 'Autonome',
  EQUILIBRE: 'Équilibré',
  GUIDE: 'Guidé',
});

/** Default when the level is absent or unrecognized (AC-1). */
export const DEFAULT_LEVEL = LEVELS.EQUILIBRE;

/**
 * The hard cap on clarifying turns. Guidé MAY ask up to 3; no level ever
 * returns more than this (defensive ceiling — keeps the in-flight loop bounded,
 * SPEC_V03A2 §4 scale assumption).
 */
export const MAX_TURNS = 3;

// Accepted aliases → canonical level. The web UI sends the friendly bilingual
// button labels alongside the canonical accented enum values; common ASCII and
// English synonyms map here too. Keys are compared lowercased + trimmed.
const ALIASES = Object.freeze({
  // Autonome — zero clarifying turns
  autonome: LEVELS.AUTONOME,
  auto: LEVELS.AUTONOME,
  autonomous: LEVELS.AUTONOME,
  simple: LEVELS.AUTONOME,
  // Équilibré — one clarifying turn (default)
  'équilibré': LEVELS.EQUILIBRE,
  equilibre: LEVELS.EQUILIBRE,
  'equilibré': LEVELS.EQUILIBRE,
  balanced: LEVELS.EQUILIBRE,
  default: LEVELS.EQUILIBRE,
  // Guidé — two (up to three) clarifying turns
  'guidé': LEVELS.GUIDE,
  guide: LEVELS.GUIDE,
  guided: LEVELS.GUIDE,
  detailed: LEVELS.GUIDE,
});

// Clarifying-turn count per canonical level (AC-1: 0 / 1 / 2, Guidé capped at 3).
const TURNS = Object.freeze({
  [LEVELS.AUTONOME]: 0,
  [LEVELS.EQUILIBRE]: 1,
  [LEVELS.GUIDE]: 2,
});

/**
 * Normalize arbitrary input to a canonical level.
 * Absent / non-string / unrecognized input → DEFAULT_LEVEL (Équilibré) (AC-1).
 *
 * @param {unknown} input
 * @returns {'Autonome'|'Équilibré'|'Guidé'}
 */
export function normalizeLevel(input) {
  if (typeof input !== 'string') return DEFAULT_LEVEL;
  const key = input.trim().toLowerCase();
  return ALIASES[key] ?? DEFAULT_LEVEL;
}

/**
 * The number of clarifying turns MMD orchestrates for a level:
 * Autonome → 0, Équilibré → 1, Guidé → 2 (never more than MAX_TURNS).
 * Uses normalizeLevel internally so it never throws on bad input.
 *
 * @param {unknown} input
 * @returns {number} 0..MAX_TURNS
 */
export function turnsForLevel(input) {
  const n = TURNS[normalizeLevel(input)] ?? TURNS[DEFAULT_LEVEL];
  return Math.min(n, MAX_TURNS);
}
