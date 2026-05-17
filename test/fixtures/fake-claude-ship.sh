#!/usr/bin/env bash
# fake-claude-ship.sh — test fixture standing in for the real `claude` CLI for
# `mmd ship` integration tests. Used via MMD_SHIP_CMD=<this-fixture> to keep
# tests hermetic (no LLM, no network) while still exercising the spawn + tee
# + env-passing surface of lib/ship/invoke-claude.js.
#
# Contract (mirrors the AC-4 invocation shape):
#   claude -p --output-format text "<prompt>"
#
# The fixture asserts the spawn signature was honored:
#   - $1 must be -p
#   - $2 must be --output-format
#   - $3 must be text
#   - $4 is the prompt (we echo a fingerprint so tests can match it)
#
# Behavior:
#   - Echoes a structured "fake ship completed" line (used by tests to assert
#     the tee captured stdout)
#   - Echoes PATH so tests can confirm env.PATH contained ~/.bun/bin
#   - Exits 0 to simulate a successful ship
#
# To simulate a failure, set MMD_FAKE_SHIP_EXIT=<n> in the test env.
set -e

if [ "${1-}" != "-p" ]; then
    echo "fake-claude-ship: expected first arg '-p', got '${1-}'" >&2
    exit 11
fi
if [ "${2-}" != "--output-format" ]; then
    echo "fake-claude-ship: expected second arg '--output-format', got '${2-}'" >&2
    exit 12
fi
if [ "${3-}" != "text" ]; then
    echo "fake-claude-ship: expected third arg 'text', got '${3-}'" >&2
    exit 13
fi

PROMPT="${4-}"
echo "fake-claude-ship: received prompt of ${#PROMPT} chars"
echo "fake-claude-ship: PATH=${PATH}"
echo "fake-claude-ship: cwd=$(pwd)"
echo "fake-claude-ship: prompt fingerprint=${PROMPT:0:80}"
echo "fake-claude-ship: SHIP-OK"

exit "${MMD_FAKE_SHIP_EXIT:-0}"
