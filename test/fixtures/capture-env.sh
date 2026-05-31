#!/usr/bin/env bash
# capture-env.sh — test fixture standing in for the spawned `node bin/mmd.js`
# build on the Dream Catcher confirm path. Dumps its environment to the file at
# $MMD_ENV_CAPTURE so a test can assert MMD_PROFILE was threaded into the child
# (SPEC_V03B AC-4). MMD_ENV_CAPTURE survives buildSubprocessEnv via the MMD_
# prefix allowlist. Also writes a stub index.html so the launch contract holds.
set -e
if [ -n "${MMD_ENV_CAPTURE:-}" ]; then
  # Write atomically (temp + rename) so a poller never reads a half-written file:
  # `env > file` truncates+creates immediately but fills it line by line.
  env > "${MMD_ENV_CAPTURE}.tmp"
  mv "${MMD_ENV_CAPTURE}.tmp" "$MMD_ENV_CAPTURE"
fi
cat > index.html <<'HTML'
<!doctype html><meta charset="utf-8"><title>capture-env stub</title>
HTML
exit 0
