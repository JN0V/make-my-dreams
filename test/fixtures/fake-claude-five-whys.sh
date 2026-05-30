#!/usr/bin/env bash
# fake-claude-five-whys.sh — test fixture standing in for the real `claude` CLI
# for `mmd unblock` 5-Whys integration tests. Used via MMD_UNBLOCK_CMD=<this>
# to keep tests hermetic (no LLM, no network) while exercising the spawn + tee
# + env-passing + parse surface of lib/conductor/five-whys.js.
#
# Contract (mirrors the AC-2 invocation shape):
#   claude -p --output-format text "<prompt>"
#
# Asserts the spawn signature:
#   - $1 must be -p
#   - $2 must be --output-format
#   - $3 must be text
#   - $4 is the prompt
#
# Behavior:
#   - Emits a short markdown 5-why chain + a trailing fenced JSON block.
#   - The recommended_action is controlled by MMD_FAKE_5WHYS_ACTION (default
#     continue-with-hint). Set to one of the 5 enum values, or to 'prose' to
#     emit prose-only output (no JSON) so tests can exercise the sacred
#     escalate-to-user fallback, or 'malformed' for an unparseable JSON block.
#   - Echoes PATH so tests can confirm env.PATH contained ~/.bun/bin.
#
# v0.2.k test hooks (qa High-1/2/3):
#   - MMD_FAKE_5WHYS_DUMP_PROMPT=1  dump the full received prompt (AC-7: prove
#                                   the run-log tail reached the prompt).
#   - MMD_FAKE_5WHYS_SLEEP=<sec>    sleep before output (AC-6: let the runner's
#                                   timeout fire and kill us mid-run).
#   - MMD_FAKE_5WHYS_EXIT=<n>       when non-zero, simulate a mid-run crash:
#                                   emit a stderr error and exit WITHOUT a JSON
#                                   block (AC-5: parser falls back to
#                                   escalate-to-user, L-016). Default 0.
set -e

if [ "${1-}" != "-p" ]; then
    echo "fake-claude-five-whys: expected first arg '-p', got '${1-}'" >&2
    exit 11
fi
if [ "${2-}" != "--output-format" ]; then
    echo "fake-claude-five-whys: expected second arg '--output-format', got '${2-}'" >&2
    exit 12
fi
if [ "${3-}" != "text" ]; then
    echo "fake-claude-five-whys: expected third arg 'text', got '${3-}'" >&2
    exit 13
fi

PROMPT="${4-}"
ACTION="${MMD_FAKE_5WHYS_ACTION:-continue-with-hint}"

echo "fake-claude-five-whys: received prompt of ${#PROMPT} chars"
echo "fake-claude-five-whys: PATH=${PATH}"

# v0.2.k AC-7 (logTail wiring): dump the full received prompt on request so the
# integration test can assert the run-log tail reached the prompt.
if [ -n "${MMD_FAKE_5WHYS_DUMP_PROMPT:-}" ]; then
    echo "PROMPT_DUMP_START"
    printf '%s\n' "$PROMPT"
    echo "PROMPT_DUMP_END"
fi

# v0.2.k AC-6 (timeout e2e): sleep on request so the runner's hang-protection
# timeout (MMD_FIVEWHYS_TIMEOUT_MS) fires and kills this child mid-run.
if [ -n "${MMD_FAKE_5WHYS_SLEEP:-}" ]; then
    sleep "${MMD_FAKE_5WHYS_SLEEP}"
fi

# v0.2.k AC-5 (spawn-failure escalate): on a non-zero exit, simulate a mid-run
# crash — emit a stderr error and exit WITHOUT a structured JSON block so the
# runner's parser falls back to the sacred escalate-to-user verdict (L-016).
if [ "${MMD_FAKE_5WHYS_EXIT:-0}" != "0" ]; then
    echo "fake-claude-five-whys: simulated non-zero exit ${MMD_FAKE_5WHYS_EXIT} (no JSON emitted)" >&2
    exit "${MMD_FAKE_5WHYS_EXIT}"
fi

cat <<'EOF'
# 5-Whys Stuck-Recovery Session

### Why 1
Mary: Why does the slice look stuck? Because no commit landed in over 10 minutes.

### Why 2
Mary: Why no commit? Because the subprocess hit a timeout.

### Why 3
Winston/Quinn/Amelia/Christie weigh in; Mary synthesizes: the timeout default
was too short for the Standard engine.

### Why 4
Why was it too short? Because MMD_TIMEOUT_MS defaulted to 30 min.

### Why 5
Why does that matter? Because the BMAD pipeline needs more than 30 min.

Root cause: the 30-minute default timeout killed the run before completion.
EOF

if [ "$ACTION" = "prose" ]; then
    echo "(No structured JSON emitted — prose only, to test the fallback.)"
    exit "${MMD_FAKE_5WHYS_EXIT:-0}"
fi

if [ "$ACTION" = "malformed" ]; then
    echo '```json'
    echo '{ "root_cause": "broken", "recommended_action": '
    echo '```'
    exit "${MMD_FAKE_5WHYS_EXIT:-0}"
fi

cat <<EOF
\`\`\`json
{
  "root_cause": "The 30-minute default timeout killed the run before completion.",
  "recommended_action": "${ACTION}",
  "action_hint": "Set MMD_TIMEOUT_MS=0 and relaunch the slice.",
  "confidence": 0.82,
  "evidence": ["engine_metrics.duration_seconds ~ 1800", "state: failed"]
}
\`\`\`
EOF

exit "${MMD_FAKE_5WHYS_EXIT:-0}"
