#!/usr/bin/env bash
# Stub autodev: writes failure message to stderr and exits 7.
# Used for failure-path tests (state should be persisted as 'failed').
echo "fake-autodev: simulated failure" >&2
exit 7
