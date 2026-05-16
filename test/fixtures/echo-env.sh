#!/usr/bin/env bash
# Stub autodev: dumps the subprocess env to the file specified as $1.
# Used for F8 env-allowlist tests — verifies secrets are stripped.
set -e
if [ -z "${1:-}" ]; then
  echo "echo-env.sh: missing capture path arg" >&2
  exit 1
fi
env > "$1"
# Also write a stub index.html so downstream contract is preserved.
cat > index.html <<'HTML'
<!doctype html><meta charset="utf-8"><title>echo-env stub</title>
HTML
exit 0
