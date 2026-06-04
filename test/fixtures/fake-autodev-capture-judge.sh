#!/usr/bin/env bash
# fake-autodev-capture-judge.sh — like fake-autodev-align.sh, but the JUDGE branch
# ALSO records the full judge prompt it received to .mmd/local/runs/judge-prompt.txt
# so the v0.17.a AC-2 integration test can assert the judge is anchored to the
# FROZEN expectation.md content (the original ask) rather than the mutable
# slice.md. The verdict is always MET (the test cares about the anchor, not the
# outcome). The real claude is NEVER invoked.
set -euo pipefail

RUNS_DIR="$PWD/.mmd/local/runs"
mkdir -p "$RUNS_DIR"
ALL_ARGS="$*"

# ── JUDGE branch ──────────────────────────────────────────────────────────────
if printf '%s' "$ALL_ARGS" | grep -q "BEHAVIORAL JUDGE"; then
  # Record the prompt verbatim so the test can inspect the grading anchor.
  printf '%s' "$ALL_ARGS" > "$RUNS_DIR/judge-prompt.txt"
  echo "AC 1: MET — the feature renders"
  echo "OVERALL: MET — every acceptance criterion is satisfied by the implementation"
  exit 0
fi

# ── CODER branch ──────────────────────────────────────────────────────────────
git rev-parse --abbrev-ref HEAD > "$RUNS_DIR/here-branch.txt" 2>/dev/null || true
echo "feature" > "$PWD/feature.txt"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git add feature.txt
  git commit -q -m "feat: add feature"
fi
exit 0
