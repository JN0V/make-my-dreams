#!/usr/bin/env bash
# Test fixture for v0.2a --here mode integration tests.
#
# Records the invocation prompt to .mmd/local/runs/here-prompt.txt and writes
# the current git branch name to .mmd/local/runs/here-branch.txt so the test
# can assert (a) AC-4 prompt strings are present and (b) auto-dev is invoked
# on the slice branch (AC-3 — never on main/master).
#
# Also makes a trivial, in-place file edit to prove "no demo/<slug>/
# scaffolding" — appends a marker line to a small file at the repo root.

set -e

PWD_DIR="$(pwd)"
mkdir -p "$PWD_DIR/.mmd/local/runs"

# Record the prompt. Test fixtures receive the dream string as a single
# positional arg per lib/invoke-autodev.js, but in --here mode the orchestrator
# passes the FULL prompt body when promptParts.prompt is set. Test mode still
# only gets [dream] (see invoke-autodev §args), so we receive the verbatim
# dream and the prompt assembly happens in lib/here-mode.js — which is what
# test/integration/here-prompt.test.js inspects directly.
#
# We persist whatever we receive for forensic value.
echo "fake-autodev-here: argc=$# arg0_len=${#1}" > "$PWD_DIR/.mmd/local/runs/here-prompt.txt"
{
  echo "--- argv ---"
  for a in "$@"; do
    echo ":: $a"
  done
  echo "--- env (MMD_*) ---"
  env | grep -E '^MMD_' | sort
} >> "$PWD_DIR/.mmd/local/runs/here-prompt.txt"

# Record the current branch — must be the slice branch (AC-3).
git rev-parse --abbrev-ref HEAD > "$PWD_DIR/.mmd/local/runs/here-branch.txt"

# AC-4 acceptance: no demo/<slug>/ creation. Make a TINY in-place change to
# prove the fixture honored --here semantics.
touch "$PWD_DIR/.mmd/local/runs/here-marker"

# Refuse to create demo/<slug>/ — if the orchestrator mistakenly invokes us
# the way greenfield does, we'd see PWD == cwd of mmd. We don't actively
# refuse; the test asserts no demo/ exists in the repo afterwards.

exit 0
