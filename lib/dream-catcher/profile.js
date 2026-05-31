// lib/dream-catcher/profile.js — the Dream Catcher audience profile.
//
// SRP (constitution §I.S): owns the closed set of profiles and the tone/safety
// hints that the elicitation prompt is built from. Pure — no I/O, no claude, no
// web. Surface-agnostic: the web layer (v0.3.a-1) and a future CLI/TTY layer
// (v0.3.b) both normalize their raw input through here.
//
// Three profiles (SPEC_V03A1 AC-3):
//   - Kid     — a young user; keeps the safe-by-default framing in the prompt.
//   - Curious — the DEFAULT; a non-technical adult who wants a friendly result.
//   - Pro     — a developer who wants a precise, technical scope.
//
// An absent or unrecognized profile defaults to Curious (AC-3) — we never throw
// on bad profile input, because the profile arrives from an untrusted web client
// (security.md) and a wrong value must degrade gracefully, not 500.

/** The closed profile enum. Frozen so callers cannot mutate it. */
export const PROFILES = Object.freeze({
  KID: 'Kid',
  CURIOUS: 'Curious',
  PRO: 'Pro',
});

/** Default when the profile is absent or unrecognized (AC-3). */
export const DEFAULT_PROFILE = PROFILES.CURIOUS;

// Accepted aliases → canonical profile. The web UI sends the French button
// labels (Enfant / Curieux / Pro), so those map here alongside the canonical
// English enum values. Keys are compared lowercased + trimmed.
const ALIASES = Object.freeze({
  // Kid
  kid: PROFILES.KID,
  enfant: PROFILES.KID,
  child: PROFILES.KID,
  // Curious
  curious: PROFILES.CURIOUS,
  curieux: PROFILES.CURIOUS,
  curieuse: PROFILES.CURIOUS,
  // Pro
  pro: PROFILES.PRO,
  expert: PROFILES.PRO,
});

// Tone hints injected into the elicitation prompt so BMAD speaks to the right
// audience. Plain prose — they are appended verbatim to the autonomous prompt.
const TONE_HINTS = Object.freeze({
  [PROFILES.KID]:
    'Speak to a curious young person in plain, friendly words. Keep the scope tiny and fun.',
  [PROFILES.CURIOUS]:
    'Speak to a non-technical but curious adult. Keep it friendly and concrete, no jargon.',
  [PROFILES.PRO]:
    'Speak to a developer. A precise, technical scope is welcome; still keep it walking-skeleton-sized.',
});

/**
 * Normalize arbitrary input to a canonical profile.
 * Absent / non-string / unrecognized input → DEFAULT_PROFILE (Curious) (AC-3).
 *
 * @param {unknown} input
 * @returns {'Kid'|'Curious'|'Pro'}
 */
export function normalizeProfile(input) {
  if (typeof input !== 'string') return DEFAULT_PROFILE;
  const key = input.trim().toLowerCase();
  return ALIASES[key] ?? DEFAULT_PROFILE;
}

/**
 * True when the (normalized) profile is Kid — drives the safe-by-default
 * framing in the elicitation prompt (AC-3 / safe-by-default.md).
 *
 * @param {unknown} profile
 * @returns {boolean}
 */
export function isKid(profile) {
  return normalizeProfile(profile) === PROFILES.KID;
}

/**
 * The tone hint for a profile, ready to append to the elicitation prompt.
 *
 * @param {unknown} profile
 * @returns {string}
 */
export function toneHint(profile) {
  return TONE_HINTS[normalizeProfile(profile)];
}
