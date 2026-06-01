#!/usr/bin/env bash
# Fake first-run setup for the v0.6.a guard integration test (MMD_SETUP_CMD seam).
# Materializes the minimum detectMmdSetup() looks for — a constitution + the adv
# slash-command — WITHOUT committing (exactly like install-mmd.sh), so the test
# exercises runHereMode's post-setup commit → clean-tree → branch path.
set -euo pipefail
TARGET="${1:-$(pwd)}"
mkdir -p "$TARGET/.specify/memory"
printf '# Fake constitution (test)\n' > "$TARGET/.specify/memory/constitution.md"
mkdir -p "$TARGET/.claude/commands"
printf 'fake adv command (test)\n' > "$TARGET/.claude/commands/bmad-adv-auto-dev.md"
exit 0
