#!/usr/bin/env bash
# Test fixture for v0.13.a cooperative auto-handoff (SPEC_V013A AC-4).
#
# Stands in for the auto-dev orchestrator under MMD's handoff loop. It SIMULATES
# a cooperative stop: on a "stop" call it writes an INCOMPLETE checkpoint AND the
# handoff-request marker (the real flow has MMD's monitor write the marker and
# auto-dev see it at a phase boundary; this fake collapses both so the LOOP can
# be tested deterministically without a stream-json crossing). It counts its
# invocations via a counter file and drops per-call evidence the test asserts.
#
# Modes (env MMD_FAKE_HANDOFF_MODE — MMD_-prefixed so it survives the subprocess
# env allowlist in lib/invoke-autodev.js buildSubprocessEnv):
#   complete-on-N (default) — calls < MMD_FAKE_COMPLETE_AT (default 2)
#                             cooperatively stop (incomplete + marker); the
#                             MMD_FAKE_COMPLETE_AT-th call completes (phase 4, no marker).
#   always-stop             — every call cooperatively stops (never completes) →
#                             exercises the MMD_MAX_HANDOFFS cap + final successor.

set -e

PWD_DIR="$(pwd)"
LOCAL="$PWD_DIR/.mmd/local"
mkdir -p "$LOCAL/runs"

# Count invocations (one line per call); N = this call's number.
echo "call" >> "$LOCAL/runs/autodev-calls"
N=$(wc -l < "$LOCAL/runs/autodev-calls" | tr -d ' ')

# Per-call evidence for the test.
touch "$LOCAL/runs/autodev-call-$N"
git rev-parse --abbrev-ref HEAD > "$LOCAL/runs/handoff-branch-$N.txt" 2>/dev/null || true

MODE="${MMD_FAKE_HANDOFF_MODE:-complete-on-2}"
COMPLETE_AT="${MMD_FAKE_COMPLETE_AT:-2}"

write_checkpoint() { # phase frozen
  printf '{ "last_completed_phase": %s, "spec_frozen": %s, "spec_path": ".mmd/shared/slice.md" }\n' \
    "$1" "$2" > "$LOCAL/checkpoint.json"
}
request_handoff() {
  printf '{ "requested_at": "fake-cooperative-stop", "by": "fake-autodev-handoff" }\n' \
    > "$LOCAL/handoff-request"
}

if [ "$MODE" = "always-stop" ]; then
  write_checkpoint 1 true
  request_handoff
elif [ "$N" -lt "$COMPLETE_AT" ]; then
  # Cooperative stop at phase N (incomplete) + request a handoff.
  write_checkpoint "$N" true
  request_handoff
else
  # The successor completes the pipeline: phase 4, NO request marker.
  write_checkpoint 4 true
  rm -f "$LOCAL/handoff-request"
fi

exit 0
