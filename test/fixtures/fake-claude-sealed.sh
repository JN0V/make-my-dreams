#!/usr/bin/env bash
# fake-claude-sealed.sh — test fixture standing in for the real `claude` CLI for
# the v0.4.a sealed-test oracle integration test (SPEC_V04A AC-4). Used via
# MMD_AUTODEV_CMD=<this> so @integration tests exercise the full
# tester→seal→coder→verify flow WITHOUT ever calling the real claude.
#
# ONE fixture serves BOTH agent calls; it branches on a marker in the prompt,
# the way fake-claude-elicit.sh branches on its turn mode (SPEC_V04A §5 hint 3):
#
#   * TESTER call — its prompt carries the SHARED_MARKER ("SEALED ORACLE") and
#     is passed verbatim as a positional arg by invokeSealedTester. On this
#     branch the fixture WRITES a passing acceptance test into the sealed dir
#     and writes NOTHING else (it does not implement the app).
#
#   * CODER call — routed through auto-dev's test seam, which passes only the
#     bare [dream] string (no marker). On this branch the fixture writes the
#     "app" (index.html). Behaviour knob:
#       MMD_FAKE_SEALED_TAMPER (unset) → "good" coder: leaves the sealed dir
#                                        untouched → seal intact → run passes.
#       MMD_FAKE_SEALED_TAMPER=1       → "tampering" coder: rewrites the sealed
#                                        test → seal broken → MMD exits non-zero
#                                        naming the file.
#
# cwd is the demo dir for both calls, so the sealed dir is at the relative path
# .mmd/shared/sealed-tests/ (MMD created it before invoking the tester).
set -euo pipefail

SEALED_DIR="$PWD/.mmd/shared/sealed-tests"
ALL_ARGS="$*"

# v0.16.a (AC-2): model-per-role argv capture. When MMD_FAKE_SEALED_DUMP_ARGV=1,
# dump THIS call's argv (one token per line) into a per-role file in the demo dir
# (cwd), so the integration test can assert MMD passed `--model <policy>` to its
# OWN judge / tester claude -p call. Additive + guarded — off by default, no
# behavior change for the existing sealed tests.
if [ -n "${MMD_FAKE_SEALED_DUMP_ARGV:-}" ]; then
  DUMP_ROLE=coder
  printf '%s' "$ALL_ARGS" | grep -q "BEHAVIORAL JUDGE" && DUMP_ROLE=judge
  printf '%s' "$ALL_ARGS" | grep -q "SEALED ORACLE" && DUMP_ROLE=tester
  : > "$PWD/argv-$DUMP_ROLE.txt"
  for a in "$@"; do printf '%s\n' "$a" >> "$PWD/argv-$DUMP_ROLE.txt"; done
fi

# ── JUDGE (v0.4.d behavioral oracle) ──────────────────────────────────────────
# The judge prompt carries the "BEHAVIORAL JUDGE" marker (JUDGE_MARKER in
# lib/sealed-tests/judge.js) and NOT "SEALED ORACLE", so it must be matched
# BEFORE the tester branch. Emit a deterministic tagged verdict:
#   MMD_FAKE_JUDGE_NOTMET=1       → OVERALL: NOT-MET (a behavioral gap)
#   MMD_FAKE_JUDGE_UNPARSEABLE=1  → prose with no tags → MMD falls back to uncertain
#   MMD_FAKE_JUDGE_FAIL=1         → exit non-zero (spawn/crash) → MMD → uncertain
#   (default)                     → OVERALL: MET (the implementation matches the ask)
if printf '%s' "$ALL_ARGS" | grep -q "BEHAVIORAL JUDGE"; then
  if [ -n "${MMD_FAKE_JUDGE_FAIL:-}" ]; then
    echo "fake-claude-sealed: JUDGE simulated crash" >&2
    exit 3
  fi
  if [ -n "${MMD_FAKE_JUDGE_UNPARSEABLE:-}" ]; then
    echo "I took a look and it all seems fine to me — looks good, ship it."
    exit 0
  fi
  if [ -n "${MMD_FAKE_JUDGE_NOTMET:-}" ]; then
    echo "AC 1: MET — the counter UI renders"
    echo "AC 2: NOT-MET — the minus button is missing; the dream asked for plus AND minus"
    echo "OVERALL: NOT-MET — at least one acceptance criterion is not satisfied"
    exit 0
  fi
  if [ -n "${MMD_FAKE_JUDGE_INCONSISTENT:-}" ]; then
    # A self-contradictory verdict: an over-eager OVERALL: MET while a per-AC
    # line is NOT-MET. MMD must distrust the optimistic bottom line (§VI).
    echo "AC 1: MET — the counter UI renders"
    echo "AC 2: NOT-MET — the minus button is missing"
    echo "OVERALL: MET — looks good overall"
    exit 0
  fi
  echo "AC 1: MET — the counter starts at zero and renders"
  echo "AC 2: MET — both the plus and minus buttons are present and wired"
  echo "OVERALL: MET — every acceptance criterion is satisfied by the implementation"
  exit 0
fi

if printf '%s' "$ALL_ARGS" | grep -q "SEALED ORACLE"; then
  # ── TESTER ──────────────────────────────────────────────────────────────
  if [ -n "${MMD_FAKE_SEALED_TESTER_EMPTY:-}" ]; then
    # Tester "succeeds" (exit 0) but writes NO tests → MMD must abort with an
    # explicit empty-seal error, never a silent "no tests = pass" (§VI).
    echo "fake-claude-sealed: TESTER wrote nothing (empty-seal knob)"
    exit 0
  fi
  mkdir -p "$SEALED_DIR"
  # A real, runnable, PASSING acceptance test (CJS so it runs under
  # `node --test` in a dir without a package.json). It encodes the dream's
  # observable behaviour at the oracle level; the assertion is trivially true
  # here because the fake "app" is a stub — the point under test is the SEAL,
  # not the app's correctness.
  cat > "$SEALED_DIR/acceptance.test.js" <<'JS'
const { test } = require('node:test');
const assert = require('node:assert');

test('counter starts at zero and the + button is wired (oracle)', () => {
  // Derived from the dream: a counter app with + and − buttons.
  // The sealed oracle asserts the acceptance contract holds.
  assert.equal(0, 0);
});
JS
  echo "fake-claude-sealed: TESTER wrote acceptance.test.js into the sealed dir"
  exit 0
fi

# ── CODER ───────────────────────────────────────────────────────────────────
cat > index.html <<'HTML'
<!doctype html><meta charset="utf-8"><title>counter</title>
<h1 id="count">0</h1><button id="inc">+</button><button id="dec">−</button>
HTML
echo "fake-claude-sealed: CODER wrote index.html"

if [ -n "${MMD_FAKE_SEALED_TAMPER:-}" ]; then
  # The classic P-04 failure: the coder rewrites the oracle to pass cheaply.
  echo "// silently gutted by the coder" >> "$SEALED_DIR/acceptance.test.js"
  echo "fake-claude-sealed: CODER TAMPERED the sealed oracle (P-04)"
fi

exit 0
