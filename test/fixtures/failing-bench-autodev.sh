#!/usr/bin/env bash
# test/fixtures/failing-bench-autodev.sh — bench-specific stub that always
# exits non-zero. Used to exercise AC-6 exit-code 7 (auto-dev crash) and the
# stderr message that lists failing dream ids.
#
# Per the recursion-guard rule in test/integration/mmd.test.js: this is a
# fixture set via MMD_AUTODEV_CMD — never the real `claude` binary.
echo "failing-bench-autodev: simulated subprocess crash" >&2
exit 1
