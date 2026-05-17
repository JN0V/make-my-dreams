#!/usr/bin/env bash
# fake-autodev-streaming.sh — emits N lines with sleeps and writes demo/<slug>/index.html.
# Used by mmd serve integration tests (MMD_AUTODEV_CMD).
#
# Usage: fake-autodev-streaming.sh "<dream>"
# Env:
#   MMD_FAKE_LINES (default 5)   number of stdout progress lines to emit
#   MMD_FAKE_SLEEP (default 0.05) seconds between lines
#   MMD_SLUG (preferred)          slug to use as demo dir name (passed by lib/server.js)
#   MMD_FAKE_SLUG (legacy fallback) same as MMD_SLUG
#   MMD_FAKE_EXIT (default 0)     exit code to return at the end
set -euo pipefail
DREAM="${1:?missing dream}"
SLUG="${MMD_SLUG:-${MMD_FAKE_SLUG:-$(echo "$DREAM" | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | head -c 40)}}"
LINES="${MMD_FAKE_LINES:-5}"
SLEEP="${MMD_FAKE_SLEEP:-0.05}"
EXIT_CODE="${MMD_FAKE_EXIT:-0}"

for i in $(seq 1 "$LINES"); do
  echo "fake-autodev: step $i/$LINES"
  sleep "$SLEEP"
done

if [ "$EXIT_CODE" = "0" ]; then
  mkdir -p "demo/$SLUG"
  echo "<!doctype html><meta charset=utf-8><title>fake</title><h1>$DREAM</h1>" > "demo/$SLUG/index.html"
  echo "demo/$SLUG/index.html written"
fi

exit "$EXIT_CODE"
