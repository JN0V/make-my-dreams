#!/usr/bin/env bash
# ============================================================================
# install.sh — Make My Dreams one-liner installer
#
# Usage (the goal):
#   curl -fsSL https://raw.githubusercontent.com/JN0V/make-my-dreams/main/install.sh | bash
#
# What it does:
#   1. Checks prerequisites (Node 20+, Git, Bun, Claude Code CLI).
#   2. Clones the make-my-dreams repo into ~/Documents/make-my-dreams/
#      (or $MMD_HOME if set, or the first positional arg if given).
#   3. Runs install-mmd.sh in that directory to install Phase A
#      (BMAD + adv module + auto-dev workflow + project constitution).
#   4. Suggests installing gStack as the next step (interactive).
#
# Safe to re-run: if the target dir exists, install.sh will fetch updates
# (git pull) and re-run install-mmd.sh (which is idempotent).
#
# Env vars:
#   MMD_HOME       Target directory (default: ~/Documents/make-my-dreams)
#   MMD_REPO_URL   Git URL to clone (default: https://github.com/JN0V/make-my-dreams.git
#                  — falls back to https://github.com/JN0V/extend-bmad.git during
#                  the transition period before the GitHub repo rename)
#   MMD_BRANCH     Branch to checkout (default: main)
#   MMD_SKIP_GSTACK_PROMPT  Set to 1 to skip the interactive gStack install prompt.
# ============================================================================

set -euo pipefail

# --- Colors ----------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { printf "${GREEN}  ✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}  ⚠${NC} %s\n" "$1"; }
fail() { printf "${RED}  ✗${NC} %s\n" "$1"; }
info() { printf "${CYAN}  →${NC} %s\n" "$1"; }
header() { printf "\n${CYAN}━━━ %s ━━━${NC}\n" "$1"; }

# --- Config (env-overridable) ----------------------------------------------
MMD_HOME="${MMD_HOME:-${1:-$HOME/Documents/make-my-dreams}}"
MMD_REPO_URL="${MMD_REPO_URL:-https://github.com/JN0V/make-my-dreams.git}"
MMD_REPO_URL_FALLBACK="https://github.com/JN0V/extend-bmad.git"
MMD_BRANCH="${MMD_BRANCH:-main}"
MMD_SKIP_GSTACK_PROMPT="${MMD_SKIP_GSTACK_PROMPT:-0}"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Make My Dreams — one-liner installer                    ║"
echo "║  Standing on Spec Kit, OpenSpec, BMAD, gStack, Ralph Loop║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
info "Target dir   : $MMD_HOME"
info "Repo URL     : $MMD_REPO_URL (fallback: $MMD_REPO_URL_FALLBACK)"
info "Branch       : $MMD_BRANCH"

# --- Phase 1: prerequisites -------------------------------------------------
header "Phase 1 — Prerequisites"

MISSING=""
check_cmd() {
    local name="$1" min="$2"
    if command -v "$name" >/dev/null 2>&1; then
        ok "$name found: $($name --version 2>&1 | head -1)"
    else
        fail "$name not found (required: $min)"
        MISSING="$MISSING $name"
    fi
}

check_cmd git "any version"
check_cmd node "v20+"
check_cmd npx "bundled with node"
check_cmd claude "Claude Code CLI"

# Bun: check standard install locations even if not in PATH yet
if command -v bun >/dev/null 2>&1; then
    ok "bun found: $(bun --version)"
elif [ -x "$HOME/.bun/bin/bun" ]; then
    ok "bun found at \$HOME/.bun/bin/bun (add to PATH for global use): $($HOME/.bun/bin/bun --version)"
    export PATH="$HOME/.bun/bin:$PATH"
else
    warn "bun not found — needed later for gStack (you can install via: curl -fsSL https://bun.sh/install | bash)"
fi

if [ -n "$MISSING" ]; then
    echo ""
    fail "Missing prerequisites:$MISSING"
    echo "  Install them and re-run this script."
    exit 1
fi

# --- Phase 2: clone or update ----------------------------------------------
header "Phase 2 — Clone or update the MMD repo"

if [ -d "$MMD_HOME/.git" ]; then
    info "Existing repo found at $MMD_HOME — fetching updates"
    git -C "$MMD_HOME" fetch --quiet
    git -C "$MMD_HOME" checkout --quiet "$MMD_BRANCH"
    git -C "$MMD_HOME" pull --ff-only --quiet
    ok "Updated to latest $MMD_BRANCH"
elif [ -d "$MMD_HOME" ] && [ "$(ls -A "$MMD_HOME" 2>/dev/null)" ]; then
    fail "Target dir $MMD_HOME exists and is not empty (not a git repo)."
    echo "  Move it aside or set MMD_HOME to a different path, then re-run."
    exit 1
else
    mkdir -p "$(dirname "$MMD_HOME")"
    info "Cloning into $MMD_HOME"
    if ! git clone --quiet --branch "$MMD_BRANCH" "$MMD_REPO_URL" "$MMD_HOME" 2>/dev/null; then
        warn "Clone of $MMD_REPO_URL failed — trying fallback $MMD_REPO_URL_FALLBACK"
        git clone --quiet --branch "$MMD_BRANCH" "$MMD_REPO_URL_FALLBACK" "$MMD_HOME"
    fi
    ok "Cloned"
fi

# --- Phase 3: run install-mmd.sh -------------------------------------------
header "Phase 3 — Install MMD Phase A (BMAD + adv module + auto-dev)"

if [ ! -f "$MMD_HOME/install-mmd.sh" ]; then
    fail "install-mmd.sh not found in $MMD_HOME — the repo may be incomplete."
    exit 1
fi
bash "$MMD_HOME/install-mmd.sh" "$MMD_HOME"

# --- Phase 4: gStack prompt (optional) -------------------------------------
header "Phase 4 — gStack (optional but recommended)"

if [ -d "$HOME/.claude/skills/gstack" ]; then
    ok "gStack already installed at ~/.claude/skills/gstack"
elif [ "$MMD_SKIP_GSTACK_PROMPT" = "1" ]; then
    info "Skipping gStack install (MMD_SKIP_GSTACK_PROMPT=1). You can install it later with:"
    echo "    git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && bun install"
else
    info "gStack provides 64+ slash-commands MMD will leverage (e.g. /qa, /cso, /ship)."
    if [ -t 0 ]; then
        printf "    Install gStack now? [Y/n] "
        read -r REPLY
        REPLY="${REPLY:-y}"
        if [[ "$REPLY" =~ ^[Yy]$ ]]; then
            if ! command -v bun >/dev/null 2>&1; then
                fail "bun not installed — install it first: curl -fsSL https://bun.sh/install | bash"
            else
                git clone --depth=1 https://github.com/garrytan/gstack.git "$HOME/.claude/skills/gstack"
                (cd "$HOME/.claude/skills/gstack" && bun install)
                ok "gStack installed"
            fi
        else
            info "Skipped. Install later with: git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && (cd ~/.claude/skills/gstack && bun install)"
        fi
    else
        info "Non-interactive shell (piped install) — skipping gStack prompt. Install later with:"
        echo "    git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && (cd ~/.claude/skills/gstack && bun install)"
    fi
fi

# --- Summary ---------------------------------------------------------------
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅  Make My Dreams installed!                            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
printf "  ${BOLD}Next steps:${NC}\n"
echo ""
printf "    cd ${CYAN}$MMD_HOME${NC}\n"
printf "    Open a Claude Code session and try:\n"
printf "      ${CYAN}/bmad-adv-auto-dev <your dream>${NC}\n"
echo ""
printf "  ${BOLD}Scoping:${NC} read ${CYAN}MAKE_MY_DREAMS.md${NC} for the full design rationale.\n"
printf "  ${BOLD}Bootstrap guide:${NC} ${CYAN}BOOTSTRAP.md${NC} walks through v0.0 and v0.1 step by step.\n"
echo ""
printf "  Re-run this installer any time to update: ${CYAN}curl -fsSL <url> | bash${NC}\n"
echo ""
