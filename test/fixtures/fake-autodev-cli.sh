#!/usr/bin/env bash
# fake-autodev-cli.sh — simulates a NON-WEB greenfield build: writes
# demo/<slug>/.mmd/shared/run.json {kind:"cli", run:"..."} and a CLI entry file,
# but NO index.html. Used by mmd serve integration tests (MMD_AUTODEV_CMD) to
# exercise the v0.10.a honest non-web result path (SPEC_V010A AC-5).
#
# Usage: fake-autodev-cli.sh "<dream>"
# Env:
#   MMD_SLUG (passed by lib/server.js)  slug to use as the demo dir name
#   MMD_FAKE_EXIT (default 0)           exit code to return
set -euo pipefail
DREAM="${1:?missing dream}"
SLUG="${MMD_SLUG:-${MMD_FAKE_SLUG:-$(echo "$DREAM" | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | head -c 40)}}"
EXIT_CODE="${MMD_FAKE_EXIT:-0}"

echo "fake-autodev-cli: building a CLI project for: $DREAM"

if [ "$EXIT_CODE" = "0" ]; then
  mkdir -p "demo/$SLUG/.mmd/shared"
  cat > "demo/$SLUG/rename.js" <<'JS'
// a tiny CLI — no browser preview
console.log('renamed files');
JS
  cat > "demo/$SLUG/.mmd/shared/run.json" <<JSON
{"kind":"cli","run":"node rename.js <dir>"}
JSON
  echo "demo/$SLUG/run.json written (kind=cli)"
fi

exit "$EXIT_CODE"
