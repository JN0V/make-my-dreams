#!/usr/bin/env bash
# fake-claude-elicit.sh — test fixture standing in for the real `claude` CLI for
# the Dream Catcher autonomous elicitation (lib/dream-catcher/elicit.js). Used
# via MMD_AUTODEV_CMD=<this> so @integration tests exercise the spawn + env +
# parse + fallback surface WITHOUT ever calling the real claude (SPEC_V03A1
# AC-2: "NEVER the real claude").
#
# Invocation shape (mode 'test' in elicit.js): the prompt arrives as $1.
#
# Behavior knobs (env):
#   MMD_FAKE_ELICIT_EXIT  (default 0)  exit code; non-zero simulates a crash
#                                      (no scope emitted) -> honest fallback.
#   MMD_FAKE_ELICIT_EMPTY (unset)      when set, emit nothing on stdout ->
#                                      unparseable -> honest fallback.
#   MMD_FAKE_ELICIT_SCOPE (optional)   override the canned scope text.
set -euo pipefail

PROMPT="${1-}"
echo "fake-claude-elicit: received prompt of ${#PROMPT} chars" >&2

# MMD_FAKE_ELICIT_SLEEP (default 0): delay output so a test can fire a second
# concurrent /api/catch/answer and exercise the single-in-flight synthesize guard.
if [ -n "${MMD_FAKE_ELICIT_SLEEP:-}" ]; then
  sleep "${MMD_FAKE_ELICIT_SLEEP}"
fi

EXIT_CODE="${MMD_FAKE_ELICIT_EXIT:-0}"

if [ "$EXIT_CODE" != "0" ]; then
  echo "fake-claude-elicit: simulated non-zero exit ${EXIT_CODE} (no scope)" >&2
  exit "$EXIT_CODE"
fi

if [ -n "${MMD_FAKE_ELICIT_EMPTY:-}" ]; then
  # Emit nothing usable on stdout -> parseReply returns unparseable.
  exit 0
fi

# JUDGE mode (v0.4.d behavioral oracle) — the judge prompt carries the
# "BEHAVIORAL JUDGE" marker (JUDGE_MARKER in lib/sealed-tests/judge.js). Emit a
# deterministic tagged verdict so parseJudgeVerdict can read it. Knobs:
#   MMD_FAKE_JUDGE_NOTMET=1       → OVERALL: NOT-MET (a behavioral gap)
#   MMD_FAKE_JUDGE_UNPARSEABLE=1  → untagged prose → MMD falls back to uncertain
#   (default)                     → OVERALL: MET
if echo "$PROMPT" | grep -q "BEHAVIORAL JUDGE"; then
  if [ -n "${MMD_FAKE_JUDGE_UNPARSEABLE:-}" ]; then
    echo "Looks good to me overall — I'd ship it."
    exit 0
  fi
  if [ -n "${MMD_FAKE_JUDGE_NOTMET:-}" ]; then
    printf 'AC 1: NOT-MET — the asked-for behaviour is missing\n'
    printf 'OVERALL: NOT-MET — at least one acceptance criterion is unmet\n'
    exit 0
  fi
  printf 'AC 1: MET — the implementation does what was asked\n'
  printf 'OVERALL: MET — every acceptance criterion is satisfied\n'
  exit 0
fi

# Branch on the turn MODE, detected from the prompt's instructions (the a-2
# ask_question / synthesize prompts carry distinct markers + wording; the a-1
# autonome prompt carries neither marker and says "Ask NO questions").
#
# ask_question → emit a tagged QUESTION line (guided multi-turn).
if echo "$PROMPT" | grep -q "QUESTION:"; then
  QUESTION="${MMD_FAKE_ELICIT_QUESTION:-Quelle couleur préfères-tu ?}"
  printf 'QUESTION: %s\n' "$QUESTION"
  exit 0
fi

# Default canned scope. If the prompt mentions the Kid framing, reflect it so a
# test can assert the profile reached the prompt.
SCOPE="${MMD_FAKE_ELICIT_SCOPE:-}"
if [ -z "$SCOPE" ]; then
  if echo "$PROMPT" | grep -qi "safe-by-default"; then
    SCOPE="Une appli pour dessiner : un canvas tactile (capacite principale), une palette de couleurs et un bouton Sauver. Hors-ligne, sans compte, sans reseau."
  else
    SCOPE="A small drawing app: one touch canvas (core), a color palette, and a Save-as-PNG button. Walking-skeleton scope."
  fi
fi

# synthesize → emit the SCOPE marker so parse-reply detects it deterministically.
# autonome (the a-1 path) emits the UNTAGGED scope so existing tests are unchanged.
if echo "$PROMPT" | grep -q "SCOPE:"; then
  printf 'SCOPE: %s\n' "$SCOPE"
else
  printf '%s\n' "$SCOPE"
fi
exit 0
