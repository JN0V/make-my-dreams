#!/usr/bin/env bash
# fake-autodev-argecho.sh — captures the argv it was spawned with, so serve
# integration tests can assert how lib/server.js threads the `--monitor` flag
# (SPEC_V05C AC-2). Writes one arg per line to "$PWD/captured-argv.txt" (cwd is
# the test's tmp dir), then behaves like a minimal successful auto-dev run:
# writes demo/<slug>/index.html and exits 0.
#
# Usage: fake-autodev-argecho.sh [--monitor] "<dream>"
# Env:   MMD_SLUG (preferred)  slug to use as demo dir name (set by lib/server.js)
set -euo pipefail

# Record every argument verbatim, one per line (empty file if none).
: > "$PWD/captured-argv.txt"
for a in "$@"; do
  printf '%s\n' "$a" >> "$PWD/captured-argv.txt"
done

# Record MMD_TIMEOUT_MS so a test can assert serve disables the build timeout
# (L-016: serve builds are long Standard slices; the 30-min default kills them).
printf '%s' "${MMD_TIMEOUT_MS-<unset>}" > "$PWD/captured-timeout.txt"

# Find the dream positional (last non-flag arg) so we can name the demo dir.
DREAM=""
for a in "$@"; do
  case "$a" in
    --*) ;;        # ignore flags (--monitor and friends)
    *) DREAM="$a" ;;
  esac
done

echo "fake-autodev-argecho: done"

SLUG="${MMD_SLUG:-argecho}"
mkdir -p "demo/$SLUG"
echo "<!doctype html><meta charset=utf-8><title>fake</title><h1>${DREAM}</h1>" > "demo/$SLUG/index.html"
exit 0
