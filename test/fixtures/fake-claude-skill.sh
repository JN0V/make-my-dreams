#!/usr/bin/env bash
# fake-claude-skill.sh — generic test fixture standing in for the real `claude`
# CLI for v0.2.g skill wrapper integration tests (qa / cso / document-release).
# Used via MMD_{QA,CSO,DOCUMENT_RELEASE}_CMD=<this-fixture> to keep tests
# hermetic (no LLM, no network) while still exercising the spawn + tee + env-
# passing surface of lib/skills/_common/invoke-claude.js.
#
# Contract (mirrors the SPEC_V02G invocation shape — same as v0.2.f ship):
#   claude -p --output-format text "<prompt>"
#
# Behavior:
#   - Echoes a structured "fake skill completed" line (used by tests to assert
#     the tee captured stdout)
#   - Echoes PATH so tests can confirm env.PATH contained ~/.bun/bin
#   - Echoes the prompt's first 80 chars so tests can fingerprint it
#   - Honors MMD_FAKE_SKILL_DELAY_MS to write something then sleep — used by
#     L-013 race-fix tests (ensures the log stream is still being written to
#     when the subprocess exits, so the wrapper MUST wait for the stream
#     finish event before resolving)
#   - Exits 0 by default; set MMD_FAKE_SKILL_EXIT=<n> to simulate failure.
set -e

if [ "${1-}" != "-p" ]; then
    echo "fake-claude-skill: expected first arg '-p', got '${1-}'" >&2
    exit 11
fi
if [ "${2-}" != "--output-format" ]; then
    echo "fake-claude-skill: expected second arg '--output-format', got '${2-}'" >&2
    exit 12
fi
if [ "${3-}" != "text" ]; then
    echo "fake-claude-skill: expected third arg 'text', got '${3-}'" >&2
    exit 13
fi

PROMPT="${4-}"
echo "fake-claude-skill: received prompt of ${#PROMPT} chars"
echo "fake-claude-skill: PATH=${PATH}"
echo "fake-claude-skill: cwd=$(pwd)"
echo "fake-claude-skill: prompt fingerprint=${PROMPT:0:80}"

# L-013 race-fix scenario: write a final marker AND a large blob (≥64KB) to
# ensure the writable buffer can't drain synchronously. The wrapper must NOT
# resolve before the log stream has flushed this final write — modern Node
# flushes fast enough for tiny writes that a broken settle() resolving on
# 'exit' instead of 'finish' would still appear to pass on the small-marker
# case (F3 finding from Phase-4 review). The 64KB blob forces actual stream
# drain work between 'exit' and 'finish', making the race observable.
if [ -n "${MMD_FAKE_SKILL_DELAY_MS:-}" ]; then
    # busy-write something to keep stdout flowing
    for i in 1 2 3; do
        echo "fake-claude-skill: tick=$i"
    done
    echo "fake-claude-skill: FINAL-MARKER-BEFORE-EXIT"
    # 64KB of 'x's — large enough that the underlying writev() can't complete
    # synchronously on a fresh tmpfs/disk file. Printed with `dd` because
    # `printf '%.0sx' {1..N}` is bash-specific and slow.
    dd if=/dev/zero bs=1024 count=64 2>/dev/null | tr '\0' 'x'
    echo ""
    echo "fake-claude-skill: BLOB-END-MARKER"
fi

echo "fake-claude-skill: SKILL-OK"

exit "${MMD_FAKE_SKILL_EXIT:-0}"
