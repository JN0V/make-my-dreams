// lib/dream-catcher/session.js — the surface-agnostic Dream Catcher state machine.
//
// SRP (constitution §I.S): owns ONLY the dialogue's control flow:
//   dream → profile → synthesize → scope → confirm
// It performs no I/O of its own — the elicitation runner is INJECTED, so the web
// layer (v0.3.a-1), a future CLI/TTY layer, and the unit tests all drive the
// exact same core with no real claude / web / fs (AC-1, pure/injected).
//
// The flow (SPEC_V03A2 AC-2):
//   dream → profile → LEVEL → [question → answer] × N → synthesize → scope → confirm
// where N = turnsForLevel(level): Autonome → 0, Équilibré → 1, Guidé → 2 (≤3).
//
// Autonome (N=0) is the a-1 path UNCHANGED: after the level it runs EXACTLY ONE
// synthesize call (with the same {dream, profile} shape elicit received in a-1)
// and lands in SCOPE. For N>0 the session asks one clarifying question at a time
// (CLARIFY state), records each {question, answer}, and synthesizes only after
// the Nth answer. Exactly ONE synthesize call happens per completed flow, every
// level (ask_question calls are NOT synthesize calls).
//
// The machine is deliberately strict about ordering: calling a transition from
// the wrong state throws (programmer error), while bad *data* (a junk profile /
// level) is normalized, never thrown (it arrives from an untrusted client).

import { normalizeProfile, DEFAULT_PROFILE } from './profile.js';
import { normalizeLevel, DEFAULT_LEVEL, turnsForLevel } from './level.js';

/** The ordered states of the dialogue. */
export const STATES = Object.freeze({
  DREAM: 'dream',         // awaiting the dream text
  PROFILE: 'profile',     // dream captured, awaiting the profile answer
  LEVEL: 'level',         // profile captured, awaiting the involvement level
  CLARIFY: 'clarify',     // a clarifying question was asked, awaiting its answer
  SYNTHESIZE: 'synthesize', // transient: the one synthesize call is running
  SCOPE: 'scope',         // scope ready, awaiting confirm / restart / edit
  CONFIRM: 'confirm',     // user confirmed — terminal, ready to launch
});

/** Defensive cap on an edited scope (aligns with the server's MAX body policy). */
const MAX_SCOPE_LEN = 4000;

/**
 * Create a fresh Dream Catcher session.
 *
 * @param {Object}   deps
 * @param {Function} deps.elicit  async ({dream, profile, mode, previousAnswers}) =>
 *                                 {ok, fallback, scope?, question?, reason?}
 *                                 (typically lib/dream-catcher/elicit.js#runElicit,
 *                                  or a fake in tests). REQUIRED. For ask_question
 *                                 turns it returns {question}; for autonome/synthesize
 *                                 it returns {scope}.
 * @returns {Object} the session control surface (see methods below).
 */
export function createSession({ elicit } = {}) {
  if (typeof elicit !== 'function') {
    throw new TypeError('createSession: an `elicit` runner function is required');
  }

  let state = STATES.DREAM;
  let dream = null;
  let profile = DEFAULT_PROFILE;
  let level = DEFAULT_LEVEL;
  let turns = 0;             // N = turnsForLevel(level), fixed once the level is set
  let answers = [];          // [{question, answer}], one per completed clarifying turn
  let currentQuestion = null; // the question currently awaiting an answer (CLARIFY)
  let scope = null;
  let fallback = false;
  let fallbackReason = null;
  let synthesizeCount = 0;

  function assertState(expected, action) {
    if (state !== expected) {
      throw new Error(`Dream Catcher: ${action} is not allowed in state "${state}" (expected "${expected}")`);
    }
  }

  /**
   * Run the ONE synthesize call and land in SCOPE. Shared by the Autonome path
   * (called from setLevel, with the a-1 {dream, profile} shape) and the guided
   * path (called from answerClarify with previousAnswers). Never throws; never
   * leaves scope null — falls back to the verbatim dream (universal §VI).
   *
   * @param {{mode: 'autonome'|'synthesize'}} opts
   */
  async function runSynthesize({ mode }) {
    state = STATES.SYNTHESIZE;
    // Autonome preserves the a-1 call shape EXACTLY ({dream, profile}); the
    // guided synthesize additionally passes the collected Q&A.
    const ctx = mode === 'autonome'
      ? { dream, profile }
      : { dream, profile, mode: 'synthesize', previousAnswers: answers };
    const result = await elicit(ctx);
    synthesizeCount += 1;

    if (result && typeof result.scope === 'string' && result.scope.trim().length > 0) {
      scope = result.scope;
      fallback = result.fallback === true;
      fallbackReason = result.reason ?? null;
    } else {
      // Defensive: never leave scope null, never fabricate (universal §VI).
      scope = dream;
      fallback = true;
      fallbackReason = 'elicitation returned no usable scope';
    }
    currentQuestion = null;
    state = STATES.SCOPE;
    return { next: STATES.SCOPE, scope, profile, fallback, fallbackReason };
  }

  /**
   * Ask the next clarifying question via elicit(ask_question). On an honest
   * failure (no usable question) we DEGRADE GRACEFULLY rather than hang or
   * fabricate: skip remaining questions and synthesize with whatever answers we
   * have (universal §VI). Returns either {next:'question', question} or the
   * synthesize result.
   */
  async function askNextQuestion() {
    const result = await elicit({ dream, profile, mode: 'ask_question', previousAnswers: answers });
    if (result && typeof result.question === 'string' && result.question.trim().length > 0) {
      currentQuestion = result.question;
      state = STATES.CLARIFY;
      // `next:'question'` is the UI-facing render hint; the internal state is
      // CLARIFY (awaiting the answer). Keep the two distinct on purpose.
      return { next: 'question', question: currentQuestion };
    }
    // No usable question — degrade to synthesize now (honest, never hangs).
    return runSynthesize({ mode: 'synthesize' });
  }

  return {
    /** @returns {string} the current state. */
    get state() { return state; },
    /** @returns {string} the verbatim dream (null until captured). */
    get dream() { return dream; },
    /** @returns {'Kid'|'Curious'|'Pro'} the normalized profile (Curious until set). */
    get profile() { return profile; },
    /** @returns {'Autonome'|'Équilibré'|'Guidé'} the normalized involvement level. */
    get level() { return level; },
    /** @returns {Array<{question, answer}>} the recorded clarifying Q&A (copy). */
    get answers() { return answers.slice(); },
    /** @returns {string|null} the question currently awaiting an answer (CLARIFY). */
    get currentQuestion() { return currentQuestion; },
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
     * Step 2 → 3: record the profile and advance to the LEVEL question. Does NOT
     * synthesize anymore (a-2) — the involvement level is the next input.
     *
     * Bad/absent profile data is normalized to Curious (never throws).
     *
     * @param {unknown} rawProfile
     * @returns {{next: 'level'}}
     */
    setProfile(rawProfile) {
      assertState(STATES.PROFILE, 'setProfile');
      profile = normalizeProfile(rawProfile);
      state = STATES.LEVEL;
      return { next: STATES.LEVEL };
    },

    /**
     * Step 3 → (clarify×N) → synthesize → scope: record the involvement level and
     * branch on its turn count N = turnsForLevel(level):
     *   - N === 0 (Autonome): run EXACTLY ONE synthesize call (the a-1 path,
     *     same {dream, profile} elicit shape) and land in SCOPE.
     *   - N  >  0: ask the FIRST clarifying question and enter CLARIFY.
     *
     * Bad/absent level data is normalized to Équilibré (never throws).
     *
     * @param {unknown} rawLevel
     * @returns {Promise<{next: string, scope?: string, profile?: string, fallback?: boolean, fallbackReason?: string|null, question?: string}>}
     */
    async setLevel(rawLevel) {
      assertState(STATES.LEVEL, 'setLevel');
      level = normalizeLevel(rawLevel);
      turns = turnsForLevel(level);
      if (turns === 0) {
        // Autonome — preserve the a-1 single-synthesize behavior byte-for-byte.
        return runSynthesize({ mode: 'autonome' });
      }
      // Guided — ask the first question.
      return askNextQuestion();
    },

    /**
     * CLARIFY → (next question | synthesize): record the answer to the current
     * question. If fewer than N answers collected, ask the next question (stay in
     * CLARIFY). On the Nth answer, synthesize from dream + profile + all Q&A and
     * land in SCOPE.
     *
     * Bad/empty answer text is coerced to '' (never throws — untrusted input).
     *
     * @param {unknown} text
     * @returns {Promise<{next: string, question?: string, scope?: string, ...}>}
     */
    async answerClarify(text) {
      assertState(STATES.CLARIFY, 'answerClarify');
      const answer = typeof text === 'string' ? text.trim() : '';
      answers.push({ question: currentQuestion, answer });
      currentQuestion = null;
      if (answers.length < turns) {
        return askNextQuestion();
      }
      return runSynthesize({ mode: 'synthesize' });
    },

    /**
     * SCOPE only: replace the scope text with the user's edit (AC-4). Stays in
     * SCOPE, does NOT call elicit, does NOT relaunch. Validates a non-empty,
     * length-capped string. Editing outside SCOPE is rejected (throws).
     *
     * @param {unknown} text
     * @returns {{next: 'scope', scope: string}}
     */
    editScope(text) {
      assertState(STATES.SCOPE, 'editScope');
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new TypeError('editScope: scope must be a non-empty string');
      }
      if (text.length > MAX_SCOPE_LEN) {
        throw new RangeError(`editScope: scope exceeds ${MAX_SCOPE_LEN} chars`);
      }
      scope = text.trim();
      // An edited scope is the user's own words — no longer a BMAD fallback.
      fallback = false;
      fallbackReason = null;
      return { next: STATES.SCOPE, scope };
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
      level = DEFAULT_LEVEL;
      turns = 0;
      answers = [];
      currentQuestion = null;
      scope = null;
      fallback = false;
      fallbackReason = null;
      synthesizeCount = 0;
      return { next: STATES.DREAM };
    },
  };
}
