// lib/dream-catcher/session.js — the surface-agnostic Dream Catcher state machine.
//
// SRP (constitution §I.S): owns ONLY the dialogue's control flow:
//   dream → profile → synthesize → scope → confirm
// It performs no I/O of its own — the elicitation runner is INJECTED, so the web
// layer (v0.3.a-1), a future CLI/TTY layer, and the unit tests all drive the
// exact same core with no real claude / web / fs (AC-1, pure/injected).
//
// v0.3.a-1 ships only the AUTONOMOUS path: after the profile is chosen the core
// performs EXACTLY ONE synthesize call. A `clarify` seam (a no-op here) sits
// between `profile` and `synthesize` so v0.3.a-2 can insert N clarifying turns
// (the "Équilibré / Guidé" dial) without rewriting this module — callers already
// await setProfile() and branch on the returned `next` state.
//
// The machine is deliberately strict about ordering: calling a transition from
// the wrong state throws (programmer error), while bad *data* (a junk profile)
// is normalized, never thrown (it arrives from an untrusted client).

import { normalizeProfile, DEFAULT_PROFILE } from './profile.js';

/** The ordered states of the autonomous dialogue. */
export const STATES = Object.freeze({
  DREAM: 'dream',         // awaiting the dream text
  PROFILE: 'profile',     // dream captured, awaiting the profile answer
  SYNTHESIZE: 'synthesize', // transient: the one elicitation call is running
  SCOPE: 'scope',         // scope ready, awaiting confirm / restart
  CONFIRM: 'confirm',     // user confirmed — terminal, ready to launch
});

/**
 * Create a fresh Dream Catcher session.
 *
 * @param {Object}   deps
 * @param {Function} deps.elicit  async ({dream, profile}) => {ok, fallback, scope, reason?}
 *                                 (typically lib/dream-catcher/elicit.js#runElicit,
 *                                  or a fake in tests). REQUIRED.
 * @returns {Object} the session control surface (see methods below).
 */
export function createSession({ elicit } = {}) {
  if (typeof elicit !== 'function') {
    throw new TypeError('createSession: an `elicit` runner function is required');
  }

  let state = STATES.DREAM;
  let dream = null;
  let profile = DEFAULT_PROFILE;
  let scope = null;
  let fallback = false;
  let fallbackReason = null;
  let synthesizeCount = 0;

  function assertState(expected, action) {
    if (state !== expected) {
      throw new Error(`Dream Catcher: ${action} is not allowed in state "${state}" (expected "${expected}")`);
    }
  }

  // a-2 seam: insert clarifying turns between profile and synthesize. In a-1
  // this is a no-op, so the autonomous path goes straight to the single
  // synthesize call. Kept as an explicit async hook so a-2 can override the
  // factory without touching setProfile's control flow.
  async function clarify() {
    /* no clarifying turns in the autonomous walking skeleton (v0.3.a-1) */
  }

  return {
    /** @returns {string} the current state. */
    get state() { return state; },
    /** @returns {string} the verbatim dream (null until captured). */
    get dream() { return dream; },
    /** @returns {'Kid'|'Curious'|'Pro'} the normalized profile (Curious until set). */
    get profile() { return profile; },
    /** @returns {string|null} the synthesized (or fallback) scope. */
    get scope() { return scope; },
    /** @returns {boolean} true if the scope came from the honest fallback. */
    get usedFallback() { return fallback; },
    /** @returns {string|null} why the fallback fired, if it did. */
    get fallbackReason() { return fallbackReason; },
    /** @returns {number} number of synthesize calls performed (must be exactly 1). */
    get synthesizeCount() { return synthesizeCount; },

    /**
     * Step 1 → 2: capture the dream and advance to the profile question.
     * @param {string} text
     * @returns {{next: string}}
     */
    setDream(text) {
      assertState(STATES.DREAM, 'setDream');
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new TypeError('setDream: dream must be a non-empty string');
      }
      dream = text.trim();
      state = STATES.PROFILE;
      return { next: STATES.PROFILE };
    },

    /**
     * Step 2 → (clarify seam) → 3 → 4: record the profile, run the ONE
     * autonomous synthesize call, and land in the scope state.
     *
     * Bad/absent profile data is normalized to Curious (never throws).
     *
     * @param {unknown} rawProfile
     * @returns {Promise<{next: string, scope: string, profile: string, fallback: boolean, fallbackReason: string|null}>}
     */
    async setProfile(rawProfile) {
      assertState(STATES.PROFILE, 'setProfile');
      profile = normalizeProfile(rawProfile);

      await clarify(); // a-2 seam — no-op in a-1

      state = STATES.SYNTHESIZE;
      const result = await elicit({ dream, profile });
      synthesizeCount += 1;

      // The runner is contracted to always return a usable scope (its own
      // honest fallback hands back the verbatim dream). Defend anyway: if it
      // returns nothing usable, fall back to the dream here too — never leave
      // scope null, never fabricate (universal §VI).
      if (result && typeof result.scope === 'string' && result.scope.trim().length > 0) {
        scope = result.scope;
        fallback = result.fallback === true;
        fallbackReason = result.reason ?? null;
      } else {
        scope = dream;
        fallback = true;
        fallbackReason = 'elicitation returned no usable scope';
      }

      state = STATES.SCOPE;
      return { next: STATES.SCOPE, scope, profile, fallback, fallbackReason };
    },

    /**
     * Step 4 → done: the user accepts the scope. Terminal.
     * @returns {{scope: string, profile: string, fallback: boolean, fallbackReason: string|null}}
     */
    confirm() {
      assertState(STATES.SCOPE, 'confirm');
      state = STATES.CONFIRM;
      return { scope, profile, fallback, fallbackReason };
    },

    /**
     * "Recommencer": discard everything and return to the dream step.
     * @returns {{next: string}}
     */
    restart() {
      state = STATES.DREAM;
      dream = null;
      profile = DEFAULT_PROFILE;
      scope = null;
      fallback = false;
      fallbackReason = null;
      synthesizeCount = 0;
      return { next: STATES.DREAM };
    },
  };
}
