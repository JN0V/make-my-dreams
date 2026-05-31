// lib/dream-catcher/cli-driver.js — the CLI/TTY surface over the Dream Catcher
// session core (SPEC_V03B AC-2).
//
// SRP (constitution §I.S): owns ONLY the terminal dialogue's turn-by-turn I/O —
// printing each question/scope, reading each answer, and offering restart / edit
// / confirm. It reuses the SAME surface-agnostic session core that lib/server.js
// drives over HTTP (createSession: setDream → setProfile → setLevel → answerClarify…
// → confirm), so there is NO new dialogue logic here — just a thin readline loop.
//
// Everything that touches the outside world is INJECTED (DI, constitution §I.D):
//   - `io`     a readline-like channel: ask(prompt) → Promise<string|null>, print(text)
//   - `elicit` the elicitation runner (typically runElicit, or a fake in tests)
//   - `env`    process env (read for $EDITOR only) — injectable for tests
// so unit tests drive the exact same core with a scripted fake stdin and a fake
// elicit, NEVER the real claude / a real TTY (mirrors the session core's design).
//
// Abort contract (universal §VI honesty): `io.ask` returns `null` to signal EOF /
// no-input. Any null answer aborts the dialogue — the driver returns
// { confirmed: false } and the caller MUST NOT launch (an aborted dialogue does
// not launch). The driver never throws on user input; only a programmer error
// (driving the core out of order) would throw, and the core guards that.

import { createSession } from './session.js';
import { openScopeInEditor } from './editor.js';

/** The profile chooser prompt (FR-facing, matches the web button labels). */
const PROFILE_PROMPT = "C'est pour qui ?  [enfant / curieux / pro] (curieux par défaut) : ";
/** The involvement-level chooser prompt. */
const LEVEL_PROMPT = 'Niveau ?          [auto / équilibré / guidé] (équilibré par défaut) : ';
/** The per-clarifying-question answer prompt. */
const ANSWER_PROMPT = '> ';
/** The restart / edit / confirm menu. */
const MENU_PROMPT = '[R]ecommencer / [M]odifier / [Entrée]=C\'est parti : ';

/**
 * Run the Dream Catcher dialogue in a terminal over an injected I/O channel.
 *
 * Drives the session core: setDream(dream) → setProfile(ask) → setLevel(ask) →
 * [answerClarify(ask) while next==='question'] → scope. Prints each question and
 * the final scope, then offers restart (re-run from the profile step) / edit
 * (best-effort) / confirm. The Autonome level skips the clarifying-question loop.
 *
 * @param {Object}   args
 * @param {string}   args.dream    the dream text (already collected by the CLI)
 * @param {{ask:(prompt:string)=>Promise<string|null>, print:(text:string)=>void}} args.io
 *                                 injected readline-like channel (scriptable in tests)
 * @param {Function} args.elicit  injected elicitation runner (fake in tests)
 * @param {NodeJS.ProcessEnv} [args.env]  env source (read for $EDITOR only)
 * @returns {Promise<{scope: string|null, profile: string, confirmed: boolean}>}
 */
export async function runCliDreamCatcher({ dream, io, elicit, env = process.env } = {}) {
  if (!io || typeof io.ask !== 'function' || typeof io.print !== 'function') {
    throw new TypeError('runCliDreamCatcher: an io channel with ask()/print() is required');
  }
  if (typeof elicit !== 'function') {
    throw new TypeError('runCliDreamCatcher: an elicit runner function is required');
  }
  if (typeof dream !== 'string' || dream.trim().length === 0) {
    throw new TypeError('runCliDreamCatcher: dream must be a non-empty string');
  }

  const session = createSession({ elicit });

  // Each pass runs one full dialogue (profile → level → questions → scope → menu).
  // [R]ecommencer restarts the loop from the profile step (the dream is fixed —
  // it is the CLI argument). Any null answer aborts (EOF) — no launch.
  for (;;) {
    session.setDream(dream); // DREAM → PROFILE

    const profileAns = await io.ask(PROFILE_PROMPT);
    if (profileAns === null || profileAns === undefined) return aborted(session);
    session.setProfile(profileAns); // PROFILE → LEVEL (bad input normalized → Curious)

    const levelAns = await io.ask(LEVEL_PROMPT);
    if (levelAns === null || levelAns === undefined) return aborted(session);

    // setLevel → SCOPE (Autonome, 0 turns) or the first clarifying question.
    let step = await session.setLevel(levelAns);
    while (step.next === 'question') {
      io.print(`\n${step.question}`);
      const answer = await io.ask(ANSWER_PROMPT);
      if (answer === null || answer === undefined) return aborted(session);
      step = await session.answerClarify(answer);
    }

    // SCOPE reached — present it and offer the menu.
    const decision = await runScopeMenu(session, io, env);
    if (decision === 'abort') return aborted(session);
    if (decision === 'confirm') {
      const { scope, profile } = session.confirm();
      return { scope, profile, confirmed: true };
    }
    // decision === 'restart' — discard and loop from the top (re-run from profile).
    session.restart();
  }
}

/**
 * Present the synthesized/edited scope and run the restart/edit/confirm menu.
 * Stays in this menu until the user confirms (Entrée), restarts ([R]), or aborts
 * (EOF). [M]odifier edits the scope in place (best-effort) then re-presents.
 *
 * @returns {Promise<'confirm'|'restart'|'abort'>}
 */
async function runScopeMenu(session, io, env) {
  for (;;) {
    io.print(`\n✨ Scope :\n${session.scope}\n`);
    if (session.usedFallback) {
      io.print(
        '(ℹ️  scope = ta demande telle quelle — la synthèse BMAD n\'a pas abouti : ' +
          `${session.fallbackReason || 'raison inconnue'})`,
      );
    }
    const choice = await io.ask(MENU_PROMPT);
    if (choice === null || choice === undefined) return 'abort';
    const c = choice.trim().toLowerCase();
    if (c === '') return 'confirm';
    if (c[0] === 'r') return 'restart';
    if (c[0] === 'm') {
      await editScope(session, io, env);
      continue; // re-present the (possibly edited) scope + menu
    }
    // Unrecognized → re-show the menu (defensive; never launches on garbage).
    io.print('Réponse non reconnue. Tape R, M, ou Entrée.');
  }
}

/**
 * Best-effort scope editing (AC-2 / SPEC_V03B §1):
 *   - if $EDITOR is set, open the current scope in it (round-trips via a temp file);
 *   - otherwise (or if the editor produced nothing usable) fall back to a single-
 *     line replacement prompt.
 * An empty / unchanged / over-long edit leaves the scope untouched (the core's
 * editScope validates and throws on bad data — we swallow that and keep the scope).
 */
async function editScope(session, io, env) {
  const current = session.scope;
  // The $EDITOR branch spawns a blocking editor on stdio:'inherit'. It is safe
  // here because the only production caller (bin/mmd.js) is TTY-gated upstream
  // (--catch on a non-TTY exits 2 before any dialogue runs). A non-interactive
  // caller that injects a different io MUST NOT set env.EDITOR.
  if (env && typeof env.EDITOR === 'string' && env.EDITOR.trim().length > 0 && current) {
    const edited = openScopeInEditor({ editor: env.EDITOR, initial: current });
    if (typeof edited === 'string' && edited.trim().length > 0 && edited.trim() !== current.trim()) {
      try {
        session.editScope(edited);
        return;
      } catch {
        io.print('Édition ignorée (scope invalide ou trop long) — scope inchangé.');
        return;
      }
    }
    // Editor unavailable or produced nothing → fall through to the single-line path.
  }
  io.print('Nouveau scope (une ligne, Entrée pour garder l\'actuel) :');
  const line = await io.ask(ANSWER_PROMPT);
  if (line === null || line === undefined) return; // EOF mid-edit → keep current scope
  if (line.trim().length === 0) return; // empty → keep current scope
  try {
    session.editScope(line);
  } catch {
    io.print('Édition ignorée (scope invalide ou trop long) — scope inchangé.');
  }
}

/**
 * Build the aborted return value. The scope (if any) is handed back for context,
 * but `confirmed:false` is the load-bearing signal: the caller MUST NOT launch.
 */
function aborted(session) {
  return { scope: session.scope ?? null, profile: session.profile, confirmed: false };
}
