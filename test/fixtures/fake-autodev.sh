#!/usr/bin/env bash
# Stub autodev: writes a minimal index.html in $PWD and exits 0.
# Used via MMD_AUTODEV_CMD for integration tests (recursion-guard).
set -e
echo "fake-autodev: received prompt of $# args, first 80 chars: ${1:0:80}"
cat > index.html <<'HTML'
<!doctype html><meta charset="utf-8"><title>stub</title><h1>hello</h1>
HTML
exit 0
