#!/usr/bin/env bash
# fake-autodev-align.sh — test fixture standing in for the real `claude` CLI for
# the v0.11.a ALIGNMENT GATE integration tests (SPEC_V011A AC-2/AC-3/AC-4). Used
# via MMD_AUTODEV_CMD=<this> so @integration tests exercise the full
# auto-dev-completes → judge → (iterate-on-gap) → judge flow WITHOUT ever calling
# the real claude.
#
# ONE fixture serves BOTH the CODER call (auto-dev) and the JUDGE call, branching
# on the judge marker the way fake-claude-sealed.sh does:
#
#   * JUDGE call — its prompt carries the "BEHAVIORAL JUDGE" marker (JUDGE_MARKER
#     in lib/sealed-tests/judge.js), passed verbatim as a positional arg by
#     invokeJudge. Emits a deterministic tagged verdict. Behaviour knobs:
#       (default)                       → OVERALL: MET
#       MMD_FAKE_ALIGN_NOTMET=1         → OVERALL: NOT-MET on every call (a gap
#                                         that survives → exit 7)
#       MMD_FAKE_ALIGN_GAP_THEN_MET=1   → first judge call NOT-MET, then MET on
#                                         the re-judge (gap closes after iterate)
#       MMD_FAKE_ALIGN_UNCERTAIN=1      → prose with no tags → MMD → uncertain
#
#   * CODER call — routed through auto-dev's test seam, which passes only the
#     bare [dream] string (no marker). Records the branch + commits a real change
#     so the slice diff is non-empty.
#
# cwd is the repo root for both calls.
set -euo pipefail

RUNS_DIR="$PWD/.mmd/local/runs"
mkdir -p "$RUNS_DIR"
ALL_ARGS="$*"

# ── JUDGE branch (must be matched BEFORE the coder branch) ────────────────────
if printf '%s' "$ALL_ARGS" | grep -q "BEHAVIORAL JUDGE"; then
  COUNT_FILE="$RUNS_DIR/judge-count"
  n=0
  [ -f "$COUNT_FILE" ] && n=$(cat "$COUNT_FILE")
  n=$((n + 1))
  echo "$n" > "$COUNT_FILE"

  if [ -n "${MMD_FAKE_ALIGN_UNCERTAIN:-}" ]; then
    echo "I had a look and it broadly seems fine to me — ship it."
    exit 0
  fi
  if [ -n "${MMD_FAKE_ALIGN_NOTMET:-}" ]; then
    echo "AC 1: MET — the basic feature renders"
    echo "AC 2: NOT-MET — the asked-for behavior is missing"
    echo "OVERALL: NOT-MET — at least one acceptance criterion is not satisfied"
    exit 0
  fi
  if [ -n "${MMD_FAKE_ALIGN_GAP_THEN_MET:-}" ] && [ "$n" -eq 1 ]; then
    # First judge call: a gap. The re-judge (call 2+) returns MET below.
    echo "AC 1: MET — the basic feature renders"
    echo "AC 2: NOT-MET — the asked-for behavior is missing on the first attempt"
    echo "OVERALL: NOT-MET — fix AC 2"
    exit 0
  fi
  echo "AC 1: MET — the feature renders"
  echo "AC 2: MET — the asked-for behavior is present and correct"
  echo "OVERALL: MET — every acceptance criterion is satisfied by the implementation"
  exit 0
fi

# ── CODER branch ──────────────────────────────────────────────────────────────
# Record the current branch (must be the slice branch — never main) when inside a
# git repo (--here). Greenfield's demoDir is NOT a git repo, so tolerate failure.
git rev-parse --abbrev-ref HEAD > "$RUNS_DIR/here-branch.txt" 2>/dev/null || true

# Write a real, unique change so the evidence (slice diff / produced files) is
# non-empty and a re-launch during iterate-on-gap produces a distinct artifact.
# A per-call coder counter guarantees there is always something to commit.
CODER_COUNT_FILE="$RUNS_DIR/coder-count"
c=0
[ -f "$CODER_COUNT_FILE" ] && c=$(cat "$CODER_COUNT_FILE")
c=$((c + 1))
echo "$c" > "$CODER_COUNT_FILE"

echo "feature attempt $c" > "$PWD/feature.txt"

# Commit only inside a git repo (the --here slice branch). The slice diff
# (git diff base..HEAD) is what the --here gate feeds the judge as evidence.
if git rev-parse --git-dir >/dev/null 2>&1; then
  git add feature.txt
  git commit -q -m "feat: add feature (coder attempt $c)"
fi

exit 0
