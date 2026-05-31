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

EXIT_CODE="${MMD_FAKE_ELICIT_EXIT:-0}"

if [ "$EXIT_CODE" != "0" ]; then
  echo "fake-claude-elicit: simulated non-zero exit ${EXIT_CODE} (no scope)" >&2
  exit "$EXIT_CODE"
fi

if [ -n "${MMD_FAKE_ELICIT_EMPTY:-}" ]; then
  # Emit nothing usable on stdout -> parseReply returns unparseable.
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
printf '%s\n' "$SCOPE"
exit 0
