#!/usr/bin/env bash
# ============================================================================
# install-mmd.sh — Self-contained installer for Make My Dreams
#
# Bootstraps Make My Dreams (MMD) in a target project. MMD is an accessibility
# and orchestration layer for AI-driven development that stands on top of
# existing frameworks (Spec Kit, OpenSpec, BMAD, gStack, Ralph Loop).
# See MAKE_MY_DREAMS.md and BOOTSTRAP.md for the full design rationale.
#
# Lineage: this script started as `install-auto-dev.sh` (Extend BMAD) and
# evolves into the MMD installer. The auto-dev workflow it installs becomes
# MMD's "STANDARD engine" (cf MAKE_MY_DREAMS.md §3.1).
#
# This script is AUTOPORTANT: it generates all files from embedded content.
# It can be re-run safely at any time (idempotent), and migrates older
# installs from previous layouts.
#
# Usage:
#   cd /path/to/target-project && bash install-mmd.sh
#   # or
#   bash install-mmd.sh /path/to/target-project
#
# Re-run to:
#   - Update module/workflow files to latest version
#   - Pick up a newly created constitution
#   - Migrate from previous install layouts (auto-dev v2/v3, MMD pre-v5)
#   - Repair a broken installation
#
# Installation roadmap (phases progressively added with each MMD version):
#
#   ✓ PHASE A (active since MMD v0.1) — Standard engine
#     BMAD core install + `adv` module + `auto-dev` workflow
#     + project constitution (multi-layer base)
#
#   ☐ PHASE B (planned for MMD v0.2)  — FAST engine
#     Bounded Ralph Loop + 1-page minimal spec generator
#
#   ☐ PHASE C (planned for MMD v0.2b) — Bundle A Security
#     Sandbox config, deps-gate Worker, secret scanning hooks
#
#   ☐ PHASE D (planned for MMD v0.2c) — Project Onboarder
#     `mmdream discover` command + `.mmd/shared/` vs `.mmd/local/` structure
#
#   ☐ PHASE E (planned for MMD v0.5)  — Conductor + Bundle C Observability
#     Stateless hierarchical orchestration + OpenTelemetry + risk-scoring
#
#   ☐ PHASE F (planned for MMD v0.9)  — Worktrees parallelization + Bundle E
#     Multi-worktree Conductor + merger Worker + safety hooks
#
#   PHASE G+ — see MAKE_MY_DREAMS.md §9 for full roadmap
#
# gStack integration: gStack is NOT installed by this script (it's a global
# install under ~/.claude/skills/gstack — see BOOTSTRAP.md Step 3). MMD
# Workers invoke gStack skills at runtime via a wrapper (cf §3.3).
# ============================================================================

set -euo pipefail

# --- Make the install prompts interactive even with a piped stdin -----------
# This script is ALWAYS invoked as a FILE ARGUMENT — `bash install-mmd.sh .`, or
# `bash "$MMD_HOME/install-mmd.sh"` from the one-liner install.sh. bash therefore
# reads the script text FROM THE FILE, not from fd 0, so reassigning fd 0 here is
# safe: it does NOT disturb how bash reads the rest of this script. (Contrast
# install.sh, which is run PIPED via `curl … | bash` — there bash reads the
# script from fd 0, so a top-level `exec < /dev/tty` would make it read the rest
# of the script from the keyboard and halt; install.sh uses a per-command
# `read … < /dev/tty` helper instead. Do NOT copy this `exec` into a piped
# script.)
#
# Why we need it at all: when install.sh (piped) calls this script, our stdin is
# inherited as that pipe — not a terminal — so every `[ -t 0 ]` prompt below
# (bun, gStack, Spec Kit, OpenSpec, Ralph Loop) would silently take its
# non-interactive branch and SKIP, leaving a half-working MMD. If a controlling
# terminal exists, reconnect fd 0 to it so those prompts can ask the human. In a
# genuine non-interactive context (CI, no /dev/tty) this is a no-op and the
# `MMD_AUTO_INSTALL_*` env-vars remain the way to opt in.
#
# IMPORTANT: this `exec` is only correct because the invocation is a file
# argument. If you ever support `curl … | bash install-mmd.sh`, switch to the
# per-command `read … < /dev/tty` pattern (see install.sh's ask_tty).
#
# The guard tests OPENABILITY, not permission. `[ -r /dev/tty ]` only checks the
# mode bits via access() — on a container / sandbox / some CI the node is present
# and world-readable (crw-rw-rw-) yet has NO controlling terminal, so OPENING it
# fails with ENXIO ("No such device or address") and `exec < /dev/tty` would
# abort the whole script under `set -e`. `( : < /dev/tty ) 2>/dev/null` actually
# attempts the open in a subshell and is true ONLY when the device opens — so a
# terminal-less environment falls cleanly through to non-interactive mode.
if [ ! -t 0 ] && ( : < /dev/tty ) 2>/dev/null; then
    exec < /dev/tty
fi

INSTALLER_VERSION="5.1.0"

# Module identity (single source of truth for paths/names)
ADV_CODE="adv"
ADV_NAME="BMad Autonomous Development"
ADV_DESCRIPTION="Autonomous end-to-end development workflows (spec → review → implement → review)"

# --- Colors & helpers -------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { printf "${GREEN}  ✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}  ⚠${NC} %s\n" "$1"; }
fail() { printf "${RED}  ✗${NC} %s\n" "$1"; }
info() { printf "${CYAN}  →${NC} %s\n" "$1"; }
header() { printf "\n${CYAN}━━━ %s ━━━${NC}\n" "$1"; }

# --- Target directory -------------------------------------------------------
TARGET="${1:-$(pwd)}"
TARGET="$(cd "$TARGET" && pwd)"

# --- Source directory (where this script + its tracked assets live) ---------
# Resolved from BASH_SOURCE so we can copy tracked assets (e.g. the /mmdream
# slash-command template) into the target. When the script is curl'd standalone
# the assets won't be next to it — callers that need them must run from a full
# MMD checkout; the materialization steps degrade gracefully if absent.
MMD_SRC_DIR="${MMD_SRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Make My Dreams — Self-Contained Installer           ║"
echo "║  Version: ${INSTALLER_VERSION}  (Phase A — Standard engine active)   ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
info "Target project : $TARGET"
info "Active phase   : A — Standard engine (BMAD + adv module + auto-dev workflow)"
info "MMD module     : ${ADV_CODE} — ${ADV_NAME}"

# ============================================================================
# PHASE 0: bun runtime (gStack dependency — v0.2.f hardening, AC-1)
# ============================================================================
# Per docs/lessons-learned.md L-012: gStack was named as a pillar but never
# invoked because `bun` was in ~/.bashrc but NOT in the PATH of non-interactive
# subprocesses (claude -p, scripted invocations). v0.2.f closes that gap with
# a functional install (not "is the binary file present?") + a CLI shim
# (bin/mmdream) that prepends ~/.bun/bin to PATH before invoking node bin/mmd.js.
#
# Env vars (idempotent re-run controls):
#   MMD_AUTO_INSTALL_BUN=1  -> skip the y/N prompt and install bun if absent
#   MMD_REQUIRE_GSTACK=1    -> make bun MANDATORY; declining or failing exits 1
header "Phase 0 — bun runtime (gStack dependency)"

BUN_PATH_BIN="$HOME/.bun/bin/bun"
BUN_OK=false

# Detect bun via `command -v` (NOT just file existence) — this catches the
# "binary present but not on PATH" case which is the L-012 root cause.
if command -v bun >/dev/null 2>&1; then
    BUN_VER="$(bun --version 2>&1 || echo unknown)"
    ok "bun present on PATH (version: ${BUN_VER})"
    BUN_OK=true
elif [ -x "$BUN_PATH_BIN" ]; then
    # Binary exists at the canonical location but PATH does not include it.
    # Verify it FUNCTIONALLY responds to --version.
    if BUN_VER="$("$BUN_PATH_BIN" --version 2>&1)"; then
        warn "bun installed at ${BUN_PATH_BIN} (version: ${BUN_VER}) but NOT on shell PATH."
        info "MMD's bin/mmdream shim prepends \$HOME/.bun/bin to PATH automatically."
        info "For interactive shells, add this to your ~/.bashrc or ~/.zshrc:"
        info "  export PATH=\"\$HOME/.bun/bin:\$PATH\""
        BUN_OK=true
    else
        fail "bun binary at ${BUN_PATH_BIN} is present but did NOT respond to --version."
        info "Remediation: re-install bun via 'curl -fsSL https://bun.sh/install | bash'"
    fi
else
    # bun absent. bun is FOUNDATION → install by DEFAULT, interactive or not.
    #   - opt OUT with MMD_SKIP_BUN=1 (the escape hatch)
    #   - a real terminal gets a courtesy [Y/n] prompt (declining == opting out)
    #   - NO terminal (curl|bash, CI) → install anyway (the default), because the
    #     install itself needs no interactivity; only the *permission prompt* did,
    #     and a foundation does not ask permission to be the foundation.
    #   - MMD_AUTO_INSTALL_BUN=1 still works (explicit force, skips the prompt)
    info "bun is NOT installed. bun is the JavaScript runtime gStack runs on — part"
    info "of the foundation MMD stands on (it drives the gStack review skills)."
    info "  - Install location: \$HOME/.bun/ (no root, no apt)"
    info "  - Install command : curl -fsSL https://bun.sh/install | bash"
    info "  - Disk footprint  : ~40 MB"
    info "  - Uninstall later : rm -rf \$HOME/.bun"
    info "  - Opt out with MMD_SKIP_BUN=1 (then 'mmdream qa'/'cso'/'document-release' stay unavailable)."
    AUTO_INSTALL=false
    if [ "${MMD_SKIP_BUN:-0}" = "1" ]; then
        info "MMD_SKIP_BUN=1 — opting out of bun (foundation)."
        AUTO_INSTALL=false
    elif [ "${MMD_AUTO_INSTALL_BUN:-0}" = "1" ]; then
        info "MMD_AUTO_INSTALL_BUN=1 — installing bun without prompt."
        AUTO_INSTALL=true
    elif [ -t 0 ]; then
        # Courtesy prompt on a real terminal; default INSTALL, decline == opt-out.
        printf "%s" "  Install bun now? [Y/n] "
        read -r reply
        case "$reply" in
            n|N|no|NO) AUTO_INSTALL=false ;;
            *) AUTO_INSTALL=true ;;
        esac
    else
        # No terminal (curl|bash, CI): install the foundation by DEFAULT.
        info "Non-interactive — installing bun (foundation). Opt out with MMD_SKIP_BUN=1."
        AUTO_INSTALL=true
    fi

    if [ "$AUTO_INSTALL" = true ]; then
        info "Installing bun via the official curl pipe..."
        # The official bun installer writes to \$HOME/.bun/. We do NOT modify the
        # user's shell rc files — MMD's bin/mmdream shim handles PATH for MMD subprocesses.
        if curl -fsSL https://bun.sh/install | bash; then
            if [ -x "$BUN_PATH_BIN" ] && BUN_VER="$("$BUN_PATH_BIN" --version 2>&1)"; then
                ok "bun installed and verified: ${BUN_VER} (at ${BUN_PATH_BIN})"
                BUN_OK=true
            else
                fail "bun install completed but ${BUN_PATH_BIN} --version did not respond."
                info "Remediation: re-run this script, or install bun manually."
            fi
        else
            fail "bun install via curl pipe failed (network? curl missing? bun.sh down?)."
            info "Remediation: run 'curl -fsSL https://bun.sh/install | bash' manually, then re-run this script."
        fi
    else
        warn "bun NOT installed → 'mmdream qa', 'mmdream cso' and 'mmdream document-release' are UNAVAILABLE."
        warn "  (The MMD core — serve, --here, auto-dev, discover, … — works without bun.)"
        warn "  Re-run WITHOUT MMD_SKIP_BUN to install it (it installs by default)."
    fi
fi

# AC-1 gate: when MMD_REQUIRE_GSTACK=1 is set, bun is mandatory.
if [ "$BUN_OK" != true ] && [ "${MMD_REQUIRE_GSTACK:-0}" = "1" ]; then
    fail "bun is required for gStack integration (v0.2.f). Re-run with MMD_AUTO_INSTALL_BUN=1 or install bun manually."
    exit 1
fi

# ============================================================================
# PHASE 1: Install/update BMAD
# ============================================================================
header "Phase 1 — Installing/updating BMAD"

# Check for npx availability
if ! command -v npx &>/dev/null; then
    fail "npx not found. Please install Node.js (https://nodejs.org) and re-run."
    exit 1
fi

# Discover available modules dynamically, exclude gds (GameDev)
EXCLUDED_MODULES="gds"

# Ensure bmad-method is in npx cache, then find its module registry
npx --yes bmad-method@latest --version >/dev/null 2>&1
EXTERNAL_MODULES_YAML=$(find ~/.npm/_npx -path "*/bmad-method/tools/cli/external-official-modules.yaml" -print -quit 2>/dev/null)

if [ -n "$EXTERNAL_MODULES_YAML" ] && [ -f "$EXTERNAL_MODULES_YAML" ]; then
    # Extract module codes from yaml, exclude gds, join with commas
    EXTRA_MODULES=$(grep '^\s*code:' "$EXTERNAL_MODULES_YAML" \
        | sed 's/.*code:\s*//' | tr -d '"' | tr -d "'" | tr -d ' ' \
        | grep -v "^${EXCLUDED_MODULES}$" \
        | tr '\n' ',' | sed 's/,$//')
    MODULES="bmm,${EXTRA_MODULES}"
    info "Discovered modules: $MODULES (excluded: $EXCLUDED_MODULES)"
else
    # Fallback if yaml not found
    MODULES="bmm,bmb,cis,tea,wds"
    warn "Could not discover modules dynamically, using fallback: $MODULES"
fi

# Always run bmad-method install — pre-configured with all discovered modules
# --yes passed to BMAD itself (separate from npx --yes) to skip BMAD's own prompts.
# --directory anchors the install path so BMAD doesn't ask interactively.
# --output-folder set explicitly: BMAD 6.6.0 doesn't substitute the {output_folder} template
# variable in generated config files even though its default is documented as _bmad-output.
# Without this, you end up with a literal {output_folder}/ directory at the repo root.
(cd "$TARGET" && npx --yes bmad-method@latest install \
    --yes \
    --directory "$TARGET" \
    --modules "$MODULES" \
    --tools claude-code \
    --communication-language French \
    --document-output-language English \
    --output-folder _bmad-output)
BMAD_EXIT=$?

# Defensive fix: if BMAD still leaves {output_folder} unresolved in configs (it does in
# 6.6.0), patch the references to the literal _bmad-output path. Idempotent.
if [ -f "$TARGET/_bmad/bmm/config.yaml" ]; then
    sed -i 's|{output_folder}|_bmad-output|g' "$TARGET/_bmad/bmm/config.yaml"
fi
if [ -f "$TARGET/_bmad/config.toml" ]; then
    sed -i 's|{output_folder}|_bmad-output|g' "$TARGET/_bmad/config.toml"
fi
# Remove the literal placeholder dir if BMAD created it during install
[ -d "$TARGET/{output_folder}" ] && rm -rf "$TARGET/{output_folder}"

if [ "$BMAD_EXIT" -ne 0 ]; then
    echo ""
    fail "BMAD installation exited with code $BMAD_EXIT."
    echo "  Fix any issues above and re-run this script."
    exit 1
fi

ok "BMAD installation completed"
# Pillar status for the v0.2.m summary banner (reaching here means BMAD is OK —
# Phase 1 exits non-zero above on any BMAD failure).
BMAD_STATUS="PRESENT_FUNCTIONAL"

# Ensure _bmad/ is in .gitignore with a dedicated section
GITIGNORE="$TARGET/.gitignore"
if [ -f "$GITIGNORE" ]; then
    if ! grep -q '^_bmad' "$GITIGNORE"; then
        printf '\n# BMAD Method\n_bmad/\n' >> "$GITIGNORE"
        ok "Added _bmad/ to .gitignore (BMAD Method section)"
    fi
else
    printf '# BMAD Method\n_bmad/\n' > "$GITIGNORE"
    ok "Created .gitignore with _bmad/ (BMAD Method section)"
fi

# Ensure .claude/commands exists
mkdir -p "$TARGET/.claude/commands"

# resolve_dep returns the first existing path among candidates
resolve_dep() {
    for path in "$@"; do
        if [ -e "$TARGET/$path" ]; then
            echo "$path"
            return 0
        fi
    done
    echo "$1"
}

# Resolve actual paths for renamed files (used in generated workflow)
ADVERSARIAL_REVIEW_PATH=$(resolve_dep \
    "_bmad/core/bmad-review-adversarial-general/SKILL.md" \
    "_bmad/core/skills/bmad-review-adversarial-general/SKILL.md" \
    "_bmad/core/tasks/review-adversarial-general.xml")

CODE_REVIEW_PATH=$(resolve_dep \
    "_bmad/bmm/4-implementation/bmad-code-review/workflow.md" \
    "_bmad/bmm/workflows/4-implementation/bmad-code-review/workflow.md" \
    "_bmad/bmm/workflows/4-implementation/code-review/instructions.xml")

QUICK_DEV_PATH=$(resolve_dep \
    "_bmad/bmm/4-implementation/bmad-quick-dev/workflow.md" \
    "_bmad/bmm/workflows/bmad-quick-flow/bmad-quick-dev/workflow.md" \
    "_bmad/bmm/workflows/bmad-quick-flow/quick-dev/workflow.md")

# ============================================================================
# PHASE 2: Check optional dependencies
# ============================================================================
header "Phase 2 — Checking optional dependencies"

CONSTITUTION_PATH=".specify/memory/constitution.md"
if [ -f "$TARGET/$CONSTITUTION_PATH" ]; then
    ok "Project constitution found at $CONSTITUTION_PATH"
    info "The workflow will inject it into every sub-agent for compliance checks"
else
    info "No constitution found — generating default constitution"
    mkdir -p "$TARGET/.specify/memory"
    cat > "$TARGET/$CONSTITUTION_PATH" << 'CONSTITUTION_EOF'
# Project Constitution

## Core Principles

### I. SOLID Principles (NON-NEGOTIABLE)

Code MUST follow SOLID principles:

- **S - Single Responsibility Principle (SRP)**: Each class/module has only one reason to change
- **O - Open/Closed Principle**: Open for extension, closed for modification
- **L - Liskov Substitution Principle**: Subtypes must be substitutable for their base types
- **I - Interface Segregation Principle**: Prefer multiple specific interfaces over one general-purpose interface
- **D - Dependency Inversion Principle**: Depend on abstractions, not implementations

**Rationale**: These principles ensure maintainable, testable, and evolvable code over the long term.

### II. KISS - Keep It Simple, Stupid (NON-NEGOTIABLE)

- Code MUST favor simplicity over cleverness
- All complexity MUST be justified by a concrete business need
- Premature abstractions are FORBIDDEN
- YAGNI (You Ain't Gonna Need It): do not implement what is not explicitly required

**Rationale**: Simplicity reduces bugs, eases maintenance, and accelerates onboarding.

### III. DRY - Don't Repeat Yourself

- Avoid duplicating business logic
- Extract common code only when duplication is proven (not preemptively)
- Prefer duplication over a bad abstraction

**Rationale**: DRY reduces inconsistencies, but must be applied with judgment (cf. KISS/YAGNI).

### IV. Test-First & Integration Testing (NON-NEGOTIABLE)

- **Integration tests are mandatory**: Every change MUST include integration tests
- **Unit tests**: Required only when isolated business logic warrants it
- **Red-Green-Refactor**: Write the test → Verify it fails → Implement → Verify it passes → Refactor
- **Every failure deserves a red-green pass — not just bugs (NON-NEGOTIABLE)**: ANY failure during development MUST trigger a red-green sequence. "Failure" is broad: failing test, crashing install script, misbehaving pipeline phase, tool not producing expected output, integration mismatch, Worker returning wrong shape, autodev iteration looping without converging, Reality Check failing. Protocol:
  1. RED: write/run an explicit, deterministic, repeatable test that demonstrates the failure.
  2. GREEN: implement the fix and verify the test now passes.
  3. Document the failure + fix (lessons-learned entry; automatic when autolearning is active).
  There is no "just fix it" — there is always a test/check that proves the failure was understood and is now corrected.
- **Bug fix = test first**: a specific application of the rule above.
- Tests MUST cover API contracts (inputs/outputs)
- No code is merged without passing tests
- **TDD by default**: Test-driven development is the standard working method

**Rationale**: Integration tests validate the real behavior of the system and catch regressions.

### V. Security & OWASP Top 10 (NON-NEGOTIABLE)

Code MUST follow security best practices and guard against OWASP Top 10 vulnerabilities:

- **A01:2021 - Broken Access Control**: Strict access control, principle of least privilege
- **A02:2021 - Cryptographic Failures**: Encrypt sensitive data, no plaintext secrets
- **A03:2021 - Injection**: Validate and sanitize all inputs, use parameterized queries
- **A04:2021 - Insecure Design**: Threat modeling, security by design
- **A05:2021 - Security Misconfiguration**: Secure defaults, no default credentials
- **A06:2021 - Vulnerable Components**: Keep dependencies up to date, regular vulnerability scanning
- **A07:2021 - Authentication Failures**: Robust authentication, secure session management
- **A08:2021 - Software and Data Integrity**: Integrity verification, secure CI/CD pipelines
- **A09:2021 - Security Logging and Monitoring**: Log security events
- **A10:2021 - Server-Side Request Forgery**: URL validation, network restrictions

**Mandatory measures**:
- Secrets managed via environment variables or a secrets manager
- HTTP security headers configured (CORS, CSP, etc.)
- Rate limiting on sensitive endpoints

**Rationale**: Security is not optional. Any exposed service must be protected against common attacks.

### VI. Separation of Concerns

- Strict separation between business logic, presentation, and infrastructure
- Layers MUST communicate through clean interfaces
- No business logic in controllers/handlers
- No direct database access from the presentation layer

**Rationale**: Separation of concerns eases testing, maintenance, and independent evolution of layers.

### VII. Defensive Programming

- Validate all inputs at system boundaries (user input, external APIs)
- Fail fast: detect and report errors as early as possible
- Never trust external data
- Handle error cases explicitly (no silent catches)

**Rationale**: Defensive programming prevents undefined behavior and eases diagnosis.

### VIII. Comprehensive Documentation

- **Code documentation**: Public interfaces documented
- **Architecture documentation**: Diagrams and decisions documented
- **README** kept up to date with setup and contribution instructions
- Each business entity documented (purpose, relations, constraints)

**Rationale**: Documentation ensures sustainability and knowledge transfer.

### IX. Commit Control (NON-NEGOTIABLE)

- **No commit without explicit user approval**
- Each commit must be atomic and correspond to an identifiable task
- Conventional Commit messages:
  - `feat:` for new features
  - `fix:` for bug fixes
  - `docs:` for documentation
  - `test:` for tests
  - `refactor:` for refactoring
- **AI attribution policy (OPTIONAL, honest)**: mentioning AI involvement in commits, PRs or code comments is **permitted and even encouraged** when it adds useful traceability (e.g. `feat: generate drawing-camera PWA (auto-dev v0.X)`). It is NOT required for every commit. Authors should not contort messages to either hide AI usage (dishonest) or showcase it gratuitously (noise) — focus on clarity of what changed and why.
- **Commit early, commit often, push always (NON-NEGOTIABLE)**: any meaningful chunk of work — even partial, even broken-on-purpose during a red phase — MUST be committed as soon as it constitutes a recoverable unit. **Uncommitted-and-unpushed work does not exist**: a crash, a forced reboot, a worktree cleanup, a misclick — and your work is gone. Atomic commits per logical step; push to remote after each commit. Worktrees and disposable environments make this rule more critical, not less. Applies to humans AND AI agents.
- **Branch-based workflow (NON-NEGOTIABLE)**: every non-trivial change MUST be developed on a dedicated branch, never directly on \`main\`. Naming: \`feat/<slug>\`, \`fix/<slug>\`, \`slice/<name>\`, \`docs/<slug>\`, \`chore/<slug>\`. Protocol: (1) branch created BEFORE any code, (2) pushed immediately with \`git push -u origin <branch>\`, (3) merged into \`main\` via PR (team) or fast-forward (solo), (4) deleted after merge. Every AI agent run (auto-dev, MMD slice, gStack invocation chain) runs on its own branch to isolate \`main\` from rogue pipelines and to allow trivial rollback. Trivial typos may go on \`main\` directly under the author's documented responsibility.

**Rationale**: Commit control ensures traceability and code quality. Honesty about authorship — including AI co-authorship — is part of that traceability. Uncommitted-and-unpushed work is not work; it is a draft that the universe may reclaim at any moment. Branches make \`main\` safe.

### X. Audit Logging

**Every business action in the system MUST be audit-logged.**

- **Covered actions**: Creation, modification, deletion, status changes, permission changes
- **Mandatory fields**: Entity, action, changed fields, before/after values, user identity, UTC timestamp
- **Non-deletion**: Audit logs MUST NEVER be deleted or modified

**Rationale**: Complete traceability is essential for compliance, debugging, and accountability.

### XI. Observability & Structured Logging

- Structured logs (JSON) with appropriate levels (debug, info, warn, error)
- Performance metrics on critical operations
- Request correlation (request ID / trace ID)
- Error and anomaly monitoring

**Rationale**: Observability enables fast diagnosis of production issues.

### XII. Least Privilege & Defense in Depth

- Each component must have only the minimum permissions necessary
- Multiple independent security layers (authentication, authorization, validation, encryption)
- Component isolation (no implicit trust between services)

**Rationale**: Defense in depth limits the impact of a compromise.

## Development Workflow

### Quality Gates

1. **Before implementation**: Tests written and failing
2. **After implementation**: All tests pass
3. **Before commit**: User approval required
4. **Documentation**: Code documented, API documented
5. **Review**: SOLID, KISS, and security verification

### Conventions

- Code, variable names, technical comments in **English**
- Commit messages in **English** (Conventional Commits)

## Governance

- This constitution **takes precedence over all other practices**
- Any amendment to the constitution requires:
  1. Documented rationale for the change
  2. Explicit approval
  3. Migration plan if existing code is impacted
- Code reviews MUST verify compliance with these principles
- Any violation MUST be justified and documented

**Version**: 1.3.0 | **Generated by install-mmd.sh**
CONSTITUTION_EOF
    ok "Generated default constitution at $CONSTITUTION_PATH"
    info "Customize it for your project's specific needs"
fi

if [ -f "$TARGET/_bmad/bmm/4-implementation/bmad-quick-dev/spec-template.md" ]; then
    ok "Quick-Dev spec template found"
else
    warn "Quick-Dev spec template not found — quick-dev may prompt for format"
fi

# ============================================================================
# PHASE 3: Generate `adv` module files
# ============================================================================
header "Phase 3 — Generating \`${ADV_CODE}\` module files"

# Module layout (mirrors official BMAD module conventions):
#   _bmad/adv/
#     module.yaml
#     workflows/
#       auto-dev/
#         workflow.md
ADV_MODULE_DIR="$TARGET/_bmad/${ADV_CODE}"
WORKFLOW_DIR="$ADV_MODULE_DIR/workflows/auto-dev"
WORKFLOW_FILE="$WORKFLOW_DIR/workflow.md"
MODULE_YAML="$ADV_MODULE_DIR/module.yaml"

mkdir -p "$WORKFLOW_DIR"

# --- 3a. Generate module.yaml -----------------------------------------------
cat > "$MODULE_YAML" << MODULE_YAML_EOF
code: ${ADV_CODE}
name: "${ADV_NAME}"
description: "${ADV_DESCRIPTION}"
default_selected: false

# This module is materialized locally by install-mmd.sh (Phase A)
# (not yet published to the BMAD external module registry).
#
# Workflows live under workflows/<name>/workflow.md
# Add new autonomous-development workflows alongside auto-dev.
MODULE_YAML_EOF

ok "Generated: _bmad/${ADV_CODE}/module.yaml"

# --- 3b. Generate workflow.md -----------------------------------------------

# Write the workflow with resolved paths already embedded
cat > "$WORKFLOW_FILE" << WORKFLOW_EOF
---
name: auto-dev
description: 'Automated end-to-end development pipeline: quick-dev spec phase + party mode → adversarial review loop → quick-dev implementation → adversarial code review loop. All phases run in fresh sub-agent contexts.'
main_config: '{project-root}/_bmad/bmm/config.yaml'
constitution: '{project-root}/.specify/memory/constitution.md'
---

# Auto-Dev Workflow — Fully Automated Development Pipeline

**Goal:** Automate the entire spec→review→dev→review pipeline with minimal user intervention. Each phase runs in a fresh sub-agent context via the **Agent tool** (\`subagent_type: "general-purpose"\`). The orchestrator (you) monitors progress and keeps the user informed.

---

## OVERVIEW

This workflow orchestrates 4 phases:

| Phase | Description | Sub-agent | Loop? |
|-------|-------------|-----------|-------|
| 1 | **Quick-Dev Spec** (steps 1-2: clarify + plan with 3x Party Mode) | Fresh context | No |
| 2 | **Adversarial Review** of the spec | Fresh context | Until no Critical/High |
| 3 | **Quick-Dev Implementation** (steps 3-5: implement + 3-reviewer review with loopback + present) | Fresh context | No (internal loopback) |
| 4 | **Final Adversarial Code Review** — safety net after the 3-reviewer pass | Fresh context | Until no Critical/High |

**Severity tolerance:** When an adversarial review finds Critical or High findings, fix them ALL (including any Medium/Low in the same pass) and re-review. Stop looping only when the review returns **zero Critical and zero High** findings (Medium/Low are tolerated as exit condition).

---

## QUICK MODE (MMD FAST engine — opt-in trimmed pipeline)

If \`MMD_AUTODEV_QUICK=1\` is present in the environment, OR the \`{dev_request}\` contains an explicit "Engine: FAST" / "MMD_AUTODEV_QUICK=1" marker, this workflow operates in **trimmed mode**. Goal: under 10 minutes per slice for small features (per scoping §3.1 v15 revision). Behavior changes vs the default 4-phase pipeline:

- **Phase 1**: invoke Party Mode **ONCE** (covering scope + investigation + spec generation in a single pass), instead of 3 rounds. The single round absorbs the topics of rounds #1, #2, and #3.
- **Phase 2 (Adversarial Spec Review)**: **opportunistic skip** if the spec at \`.mmd/shared/slice.md\` is < 200 lines AND contains < 5 TODO/TBD markers. Otherwise run normally. Log the decision: \`"Phase 2 skipped (robust spec heuristic passed)."\` OR \`"Phase 2 running (spec did not pass robustness heuristic)."\`
- **Phase 3 (Implementation + 3-reviewer review)**: **UNCHANGED** — correctness is non-negotiable per testing.md §III red-green rule.
- **Phase 4 (Final adversarial code review)**: **UNCHANGED** — cheap to keep and cheaper than retroactively auditing.

Quick mode does NOT alter the constitution injection, the sub-agent fresh-context discipline, or the severity-tolerance loop exit. It is purely a Phase 1/Phase 2 ceremony reduction.

---

## YOUR ROLE: ORCHESTRATOR

You are the **macro orchestrator**. You do NOT execute the workflows yourself. Instead, you:

1. **Launch sub-agents** using the **Agent tool** with \`subagent_type: "general-purpose"\` for each phase — this guarantees a **fresh context** for every sub-agent
2. **Craft detailed prompts** so each sub-agent has all the context it needs
3. **Parse sub-agent results** to determine next steps
4. **Report progress** to the user at every phase transition
5. **Handle errors** gracefully — if a sub-agent fails, report what happened and ask the user

**CRITICAL RULES:**
- Each sub-agent MUST be launched via the **Agent tool** — this ensures a **fresh, isolated context**
- NEVER execute quick-dev or review workflows yourself — always delegate to a sub-agent
- ALWAYS inform the user before and after each phase
- Track the spec file path across phases — it's the critical handoff artifact
- EVERY sub-agent prompt MUST include the constitution block (see below)

---

## CONSTITUTION INJECTION (MANDATORY)

The project may have a **constitution** at \`{constitution}\` that governs ALL development decisions.

### During Initialization

1. Attempt to read \`{constitution}\`
2. If it exists: set \`{has_constitution}\` = true, store its full content as \`{constitution_content}\`
3. If it does NOT exist: set \`{has_constitution}\` = false

### Constitution Block for Sub-Agent Prompts

If \`{has_constitution}\` is true, EVERY sub-agent prompt MUST start with this block:

\`\`\`
## Project Constitution (NON-NEGOTIABLE)

The following constitution governs ALL development on this project. It SUPERSEDES all other practices. Read it carefully and comply with EVERY principle.

<constitution>
{constitution_content}
</constitution>

You MUST comply with ALL constitution principles in your work. Any violation is a defect.
\`\`\`

If \`{has_constitution}\` is false, SKIP this block entirely — do not mention a constitution that doesn't exist.

This approach ensures:
- The constitution content is **injected verbatim** — no summarization, no missed rules
- Works with ANY project's constitution, not just a specific one
- Sub-agents get the full context without needing file access to read it themselves

---

## INITIALIZATION

### 1. Load Configuration

Load \`{main_config}\` and resolve:
- \`user_name\`, \`communication_language\`, \`project_name\`
- \`output_folder\`, \`implementation_artifacts\`
- Communicate in \`{communication_language}\`

### 2. Load Constitution

Attempt to read \`{constitution}\`:
- If found: store content, set \`{has_constitution}\` = true
- If not found: set \`{has_constitution}\` = false, log a note but continue

### 3. Get User Input

The user provides a description of what to develop. This can be:
- A feature description in natural language
- A reference to existing docs/issues
- A brief sentence — the quick-dev spec phase will flesh it out

Store this as \`{dev_request}\`.

### 4. Announce Pipeline Start

Report to user (adapt if no constitution):

\`\`\`
🚀 Auto-Dev Pipeline lancé pour : {dev_request}

📋 Plan d'exécution :
  Phase 1 → Quick-Dev Spec (clarify + plan avec 3x Party Mode)
  Phase 2 → Revue adversariale de la spec (boucle jusqu'à 0 Critical/High)
  Phase 3 → Quick-Dev Implementation (implement + 3 reviewers avec loopback + present)
  Phase 4 → Revue adversariale finale du code — filet de sécurité (boucle jusqu'à 0 Critical/High)

{if has_constitution: "📜 Constitution du projet chargée — toutes les phases respecteront ses principes."}
{if not has_constitution: "ℹ️ Pas de constitution trouvée — les phases suivront les bonnes pratiques générales."}
{if MMD_AUTODEV_QUICK=1 or "Engine: FAST" in dev_request: "⚡ Quick mode (MMD FAST engine) — 1× Party Mode, Phase 2 opportunistic. Target <=10 min."}
Chaque phase s'exécute dans un sous-agent avec un contexte frais (Agent tool).
C'est parti !
\`\`\`

---

## PHASE 1: QUICK-DEV SPEC (STEPS 1-2) WITH 3x PARTY MODE

### Objective
Generate a complete, implementation-ready tech-spec from the user's request using quick-dev's clarify and plan steps, with Party Mode invoked at 3 key points for diverse expert input.

### How to Launch

Use the **Agent tool** with:
- \`subagent_type\`: \`"general-purpose"\`
- \`description\`: \`"Phase 1: Quick-Dev Spec with 3x Party Mode"\`
- \`prompt\`: (see below)

### Sub-Agent Prompt

\`\`\`
You are executing the SPEC PHASE of an automated quick-dev workflow. Your goal is to produce a complete, implementation-ready tech-spec. You will ONLY execute steps 1 and 2 — do NOT proceed to implementation.

IMPORTANT: You must invoke Party Mode 3 times during this phase for expert multi-agent review. Party Mode is a skill you invoke by reading and following:
{project-root}/_bmad/core/bmad-party-mode/SKILL.md
(which loads {project-root}/_bmad/core/bmad-party-mode/workflow.md)

QUICK MODE OVERRIDE: if MMD_AUTODEV_QUICK=1 is set in the environment (or the {dev_request} contains "Engine: FAST"), you MUST invoke Party Mode ONCE total in this phase (the single round covers scope + investigation + spec generation), NOT three times. The PARTY MODE #2 and PARTY MODE #3 markers below are SKIPPED in quick mode. The single Party Mode round happens after Step 1 clarification (where PARTY MODE #1 is currently placed) and covers the topics of all three rounds.

{CONSTITUTION_BLOCK — inject full block here if has_constitution, otherwise omit entirely}

## Configuration
- Project root: {project-root}
- Config: {project-root}/_bmad/bmm/config.yaml
- Communication language: {communication_language}
- User name: {user_name}

## What to build
{dev_request}

## Instructions

Read the quick-dev workflow at:
{project-root}/${QUICK_DEV_PATH}

Then execute ONLY these steps, with mandatory Party Mode injections:

### Step 1: Clarify and Route
Read and follow: {project-root}/_bmad/bmm/4-implementation/bmad-quick-dev/step-01-clarify-and-route.md

The user's intent is the description above. Do NOT wait for user input — use the provided description. This is a NEW spec (not resuming an existing one).

#### >>> PARTY MODE #1: Post-Clarification <<<
After clarifying the intent and before proceeding to Step 2, invoke Party Mode.
Topic: "Review the clarified intent, scope, and routing decision. Is the scope right? Are we missing anything? Is the approach sound?"
Accept the recommendations and incorporate them before continuing.

### Step 2: Plan
Read and follow: {project-root}/_bmad/bmm/4-implementation/bmad-quick-dev/step-02-plan.md

Execute the deep investigation as instructed.

#### >>> PARTY MODE #2: Post-Investigation <<<
After investigating the codebase but BEFORE generating the spec, invoke Party Mode.
Topic: "Review the investigation findings: architecture patterns, integration points, risks, and dependencies identified. Are there blind spots? Alternative approaches? Missing constraints?"
Accept the recommendations and incorporate them into the spec generation.

Now generate the full spec using the template from:
{project-root}/_bmad/bmm/4-implementation/bmad-quick-dev/spec-template.md

#### >>> PARTY MODE #3: Post-Spec Generation <<<
After generating the spec but BEFORE approving at CHECKPOINT 1, invoke Party Mode.
Topic: "Review the complete tech-spec. Is it implementation-ready? Are tasks specific with file paths? Are acceptance criteria testable (Given/When/Then)? Any gaps, ambiguities, or missing edge cases?"
Accept the recommendations, apply any improvements to the spec, then select [A] (Approve) at CHECKPOINT 1.

### Automation Rules (override normal interactive behavior):
1. NEVER wait for user input — all decisions are automated
2. You MUST invoke Party Mode exactly 3 times as described above — this is NON-NEGOTIABLE (EXCEPTION: in QUICK MODE, exactly ONCE, after Step 1)
3. ALWAYS accept Party Mode recommendations and incorporate them
4. {if has_constitution: "The spec MUST respect the project constitution included above"}
5. Produce the highest quality spec possible — it will face adversarial review next
6. STOP after Step 2 — do NOT proceed to Step 3 (implementation)
7. When done, report the FINAL SPEC FILE PATH (the renamed file, not the WIP)
\`\`\`

### After Sub-Agent Completes

1. Extract the **final spec file path** from the sub-agent's output
2. Store as \`{spec_file_path}\`
3. Verify the file exists (read it to confirm)
4. Report to user:

\`\`\`
✅ Phase 1 terminée — Spec générée
📄 Fichier : {spec_file_path}
🔄 Lancement Phase 2 — Revue adversariale de la spec...
\`\`\`

---

## PHASE 2: ADVERSARIAL SPEC REVIEW LOOP

### Objective
Review the spec adversarially. Loop until no Critical or High severity findings remain.

### Quick Mode Pre-Check (optional skip)

If MMD_AUTODEV_QUICK=1 is set (FAST engine), evaluate the spec at \`{spec_file_path}\` against the robustness heuristic:
- Lines: < 200
- TODO/TBD/FIXME markers: < 5 total

If BOTH conditions are met, **skip Phase 2 entirely** and proceed directly to Phase 3. Log to the user:

\`\`\`
⚡ Phase 2 skipped (quick mode + spec passed robustness heuristic: {N_LINES} lines, {N_TODO} TODO markers).
🔄 Lancement Phase 3 — Quick-Dev Implementation...
\`\`\`

Otherwise (one or both heuristics fail), run Phase 2 normally. Log:

\`\`\`
⚡ Quick mode: spec did NOT pass robustness heuristic ({N_LINES} lines, {N_TODO} TODO markers). Running Phase 2 normally.
\`\`\`

### Loop Structure

Set \`{review_iteration}\` = 1

**REPEAT:**

#### 2a. Launch Review Sub-Agent

Use the **Agent tool** with:
- \`subagent_type\`: \`"general-purpose"\`
- \`description\`: \`"Phase 2: Adversarial spec review #{review_iteration}"\`

Prompt:

\`\`\`
You are performing an ADVERSARIAL REVIEW of a technical specification.

{CONSTITUTION_BLOCK — if has_constitution, inject it and add: "Your review MUST verify compliance with ALL constitution principles. Flag ANY violation as HIGH or CRITICAL."}

## Task
Read and follow the adversarial review skill defined at:
{project-root}/${ADVERSARIAL_REVIEW_PATH}

## Content to Review
Read the FULL file at: {spec_file_path}

## Additional Review Focus
- Is the spec truly implementation-ready? Could a fresh dev agent implement it without questions?
- Are all tasks specific with file paths and concrete actions?
- Are acceptance criteria testable (Given/When/Then)?
- Are there any gaps, ambiguities, or missing edge cases?
- Is the scope well-defined? Are there scope creep risks?
{if has_constitution: "- Does the spec comply with the project constitution? Flag violations."}

## Output Format
For EACH finding, provide:
- **ID**: F1, F2, F3...
- **Severity**: CRITICAL | HIGH | MEDIUM | LOW
- **Description**: Clear description of the issue
- **Recommendation**: How to fix it

End your review with a SUMMARY LINE in this exact format:
SUMMARY: X critical, Y high, Z medium, W low
\`\`\`

#### 2b. Parse Results

From the sub-agent output:
1. Extract the SUMMARY line
2. Count Critical and High findings
3. If **Critical > 0 OR High > 0**: proceed to fix step (2c)
4. If **Critical == 0 AND High == 0**: exit loop, proceed to Phase 3

#### 2c. Launch Fix Sub-Agent (if needed)

Use the **Agent tool** with:
- \`subagent_type\`: \`"general-purpose"\`
- \`description\`: \`"Phase 2: Fix spec findings #{review_iteration}"\`

Prompt:

\`\`\`
You are fixing adversarial review findings in a technical specification.

{CONSTITUTION_BLOCK — if has_constitution, inject it and add: "All fixes MUST comply with constitution principles."}

## Spec File
{spec_file_path}

## Findings to Fix
{paste ALL findings from the review — not just Critical/High, ALL of them}

## Instructions
1. Read the FULL spec file
2. Fix ALL findings listed above (Critical, High, Medium, AND Low)
3. Edit the spec file directly with your fixes
4. Maintain the overall structure and quality of the spec
5. Do NOT remove valid content — only fix, improve, and add what's missing
6. When done, confirm all fixes applied
\`\`\`

#### 2d. Report Progress

\`\`\`
🔄 Revue adversariale de la spec — Itération {review_iteration}
   Findings : {critical} Critical, {high} High, {medium} Medium, {low} Low
   Action : {if fixing: "Corrections en cours..." | if done: "✅ Aucun Critical/High — spec validée !"}
\`\`\`

Increment \`{review_iteration}\` and repeat from 2a.

**Safety limit:** After 5 iterations, warn the user and ask whether to continue or accept current state.

---

## PHASE 3: QUICK-DEV IMPLEMENTATION (STEPS 3-5 WITH 3-REVIEWER REVIEW + LOOPBACK)

### Objective
Implement the spec using quick-dev's full implementation pipeline: implement, then 3-reviewer adversarial review with automatic loopback on findings, then present.

### How to Launch

Use the **Agent tool** with:
- \`subagent_type\`: \`"general-purpose"\`
- \`description\`: \`"Phase 3: Quick-Dev implementation with 3-reviewer review"\`

### Sub-Agent Prompt

\`\`\`
You are executing the IMPLEMENTATION PHASE of an automated quick-dev workflow to implement a technical specification.

{CONSTITUTION_BLOCK — if has_constitution, inject it and add: "You MUST comply with ALL constitution principles in your implementation."}

## Configuration
- Project root: {project-root}
- Config: {project-root}/_bmad/bmm/config.yaml
- Communication language: {communication_language}
- User name: {user_name}

## Tech Spec to Implement
{spec_file_path}

## Instructions

Read the quick-dev workflow at:
{project-root}/${QUICK_DEV_PATH}

The spec has already been created and reviewed. You are resuming from Step 3. Execute ALL steps fully — including the 3-reviewer adversarial review in Step 4.

### Step 3: Implement
Read and follow: {project-root}/_bmad/bmm/4-implementation/bmad-quick-dev/step-03-implement.md

Implement ALL tasks from the spec. Write code, create/modify files, write tests. Be thorough.

### Step 4: Review (CRITICAL — DO NOT SKIP)
Read and follow: {project-root}/_bmad/bmm/4-implementation/bmad-quick-dev/step-04-review.md

This step launches 3 parallel review sub-agents:
1. **Blind Hunter** — adversarial review of the diff only (no context)
2. **Edge Case Hunter** — edge case analysis with project access
3. **Acceptance Auditor** — spec compliance verification

Follow the classification and loopback logic exactly as described:
- **intent_gap** or **bad_spec** findings → loop back to fix spec and re-implement
- **patch** findings → auto-fix immediately
- **defer** findings → append to deferred work file
- Max 5 loopback iterations before escalating

### Step 5: Present
Read and follow: {project-root}/_bmad/bmm/4-implementation/bmad-quick-dev/step-05-present.md

Generate the suggested review order, commit, and present results.

### Automation Rules:
- NEVER wait for user input — execute autonomously
- Implement EVERY task in the spec — no partial implementations
- Write tests as specified in the testing strategy
- Follow all code patterns and conventions identified in the spec
- Execute the FULL Step 4 review with all 3 reviewers — do NOT skip it
- {if has_constitution: "Follow ALL constitution mandates (TDD, patterns, constraints, etc.)"}
- When done, list ALL files created or modified and the review outcome (findings resolved, deferred, etc.)
\`\`\`

### After Sub-Agent Completes

1. Report to user:

\`\`\`
✅ Phase 3 terminée — Implémentation réalisée + revue 3 reviewers passée
📁 Fichiers modifiés/créés : {list from sub-agent}
🔍 Résultat revue interne : {summary from sub-agent — loopbacks, patches, deferred}
🔄 Lancement Phase 4 — Revue adversariale finale (filet de sécurité)...
\`\`\`

---

## PHASE 4: FINAL ADVERSARIAL CODE REVIEW — SAFETY NET

### Objective
Final cynical review of the implemented code as a safety net after the 3-reviewer pass in Phase 3. This catches anything the structured reviewers may have missed. Loop until no Critical or High severity findings remain.

### Loop Structure

Set \`{code_review_iteration}\` = 1

**REPEAT:**

#### 4a. Launch Review Sub-Agent

Use the **Agent tool** with:
- \`subagent_type\`: \`"general-purpose"\`
- \`description\`: \`"Phase 4: Adversarial code review #{code_review_iteration}"\`

Prompt:

\`\`\`
You are performing an ADVERSARIAL CODE REVIEW of a recent implementation.

{CONSTITUTION_BLOCK — if has_constitution, inject it and add: "Your review MUST verify compliance with ALL constitution principles. Flag ANY violation as HIGH or CRITICAL severity."}

## Context
The implementation was done based on this tech-spec:
{spec_file_path}

Read the spec first to understand what was supposed to be implemented.

## What to Review
Run \`git diff\` and \`git status\` to see all changes made during implementation.
Also read the spec's task list and acceptance criteria.

## Review Instructions
Follow the code review methodology from:
{project-root}/${CODE_REVIEW_PATH}

But adapt it: there is no story file — use the tech-spec as the reference document.
Exclude _bmad/, _bmad-output/, .claude/, .cursor/, .windsurf/ folders from review.

## Review Focus
For EACH changed file:
1. **Correctness**: Does the code do what the spec says?
2. **Security**: Injection risks, missing validation, auth issues
3. **Performance**: Inefficient patterns, resource waste
4. **Error Handling**: Missing error paths, poor error messages
5. **Code Quality**: Complex functions, magic numbers, poor naming, duplication
6. **Test Quality**: Real assertions vs placeholder tests, edge case coverage
7. **Spec Compliance**: Are ALL acceptance criteria actually implemented?
{if has_constitution: "8. **Constitution Compliance**: Verify ALL constitution mandates are respected"}

## Output Format
For EACH finding:
- **ID**: F1, F2, F3...
- **Severity**: CRITICAL | HIGH | MEDIUM | LOW
- **File**: path/to/file.ext:line
- **Description**: What's wrong
- **Recommendation**: How to fix

End with: SUMMARY: X critical, Y high, Z medium, W low
\`\`\`

#### 4b. Parse Results

Same logic as Phase 2:
1. Extract SUMMARY line
2. If **Critical > 0 OR High > 0**: proceed to fix (4c)
3. If **Critical == 0 AND High == 0**: exit loop, pipeline complete

#### 4c. Launch Fix Sub-Agent (if needed)

Use the **Agent tool** with:
- \`subagent_type\`: \`"general-purpose"\`
- \`description\`: \`"Phase 4: Fix code findings #{code_review_iteration}"\`

Prompt:

\`\`\`
You are fixing adversarial code review findings.

{CONSTITUTION_BLOCK — if has_constitution, inject it and add: "All fixes MUST comply with constitution principles."}

## Tech Spec Reference
{spec_file_path}

## Findings to Fix
{paste ALL findings — Critical, High, Medium, AND Low}

## Instructions
1. Read the spec for context on what the code should do
2. Fix ALL findings listed above
3. Edit source files directly
4. Run existing tests if available to verify fixes don't break anything
5. Update/add tests as needed for the fixes
6. When done, list all files modified and confirm fixes applied
\`\`\`

#### 4d. Report Progress

\`\`\`
🔄 Revue adversariale du code — Itération {code_review_iteration}
   Findings : {critical} Critical, {high} High, {medium} Medium, {low} Low
   Action : {if fixing: "Corrections en cours..." | if done: "✅ Aucun Critical/High — code validé !"}
\`\`\`

Increment \`{code_review_iteration}\` and repeat from 4a.

**Safety limit:** After 5 iterations, warn the user and ask whether to continue.

---

## PIPELINE COMPLETE

When all 4 phases are done, report:

\`\`\`
🎉 Auto-Dev Pipeline terminé avec succès !

📋 Récapitulatif :
  ✅ Phase 1 — Spec générée avec 3x Party Mode : {spec_file_path}
  ✅ Phase 2 — Spec validée par revue adversariale ({spec_review_iterations} itération(s))
  ✅ Phase 3 — Implémentation + revue 3 reviewers (Blind Hunter, Edge Case Hunter, Acceptance Auditor)
  ✅ Phase 4 — Code validé par revue adversariale finale ({code_review_iterations} itération(s))

{if has_constitution: "📜 Constitution respectée tout au long du pipeline."}
📁 Tous les fichiers sont prêts. Pensez à relire et tester avant de commit !
\`\`\`

---

## ERROR HANDLING

- **Sub-agent failure:** Report the error to the user, ask how to proceed
- **File not found:** Verify paths, retry once, then ask user
- **Infinite loop protection:** Max 5 iterations per review loop
- **Partial completion:** If interrupted, report what was completed and what remains
WORKFLOW_EOF

ok "Generated: _bmad/${ADV_CODE}/workflows/auto-dev/workflow.md"

# --- 3c. Generate command file ----------------------------------------------
# Bug 2: the newer BMAD manages skills under .claude/skills/. If it already
# provides bmad-<adv>-auto-dev there, our flat .claude/commands/ copy is a
# DUPLICATE (the skill shows up twice). Write the legacy command ONLY when no
# skills version exists (older BMAD / this repo) — there it is the sole source of
# /bmad-<adv>-auto-dev, so removing it unconditionally would break auto-dev. When
# the skills version IS present, skip it AND clean up any stale legacy copy a
# previous install left behind (idempotent de-dup).
COMMAND_FILE="$TARGET/.claude/commands/bmad-${ADV_CODE}-auto-dev.md"
SKILL_DIR="$TARGET/.claude/skills/bmad-${ADV_CODE}-auto-dev"

if [ -d "$SKILL_DIR" ]; then
  if [ -f "$COMMAND_FILE" ]; then
    rm -f "$COMMAND_FILE"
    ok "Removed legacy .claude/commands/bmad-${ADV_CODE}-auto-dev.md (BMAD provides it under .claude/skills/ — de-duplicated)."
  else
    info "BMAD provides bmad-${ADV_CODE}-auto-dev under .claude/skills/ — skipping the legacy .claude/commands/ copy."
  fi
else
  cat > "$COMMAND_FILE" << COMMAND_EOF
---
name: 'auto-dev'
description: 'Automated end-to-end pipeline: quick-dev spec + party mode → adversarial spec review loop → quick-dev implementation → adversarial code review loop. Fully autonomous with progress reporting.'
---

IT IS CRITICAL THAT YOU FOLLOW THIS COMMAND: LOAD the FULL @{project-root}/_bmad/${ADV_CODE}/workflows/auto-dev/workflow.md, READ its entire contents and follow its directions exactly!
COMMAND_EOF

  ok "Generated: .claude/commands/bmad-${ADV_CODE}-auto-dev.md"
fi

# --- 3d. /mmdream operator slash command (v0.7.5) ------------------------------
# The /mmdream Claude Code slash command encodes the MMD operator playbook so a
# user (or Claude) can drive MMD with the right discipline from a session
# without remembering the CLI incantations. Its single source of truth is the
# TRACKED file assets/claude-commands/mmdream.md (NOT under the gitignored
# .claude/). We copy it idempotently (cp overwrites on re-run; mkdir -p is a
# no-op when the dir exists). MMD_SRC_DIR is resolved at the top of this script
# (overridable via env — the DI seam the install test uses). If the source is
# missing (e.g. the script was curl'd standalone, away from a full checkout) we
# skip with an honest warning rather than fabricate the file (universal §VI).
#
# ONE destination — GLOBAL ~/.claude/commands/mmdream.md: a Claude Code personal
# command, available in EVERY session regardless of which project you open. This
# is what makes `/mmdream` usable after a one-liner install (the operator playbook
# is generic, not tied to one repo).
#
# Bug 2: a project-scoped copy at $TARGET/.claude/commands/mmdream.md would make
# `/mmdream` appear TWICE in a session opened inside $TARGET (project + global both
# load). The global copy already covers every session, so we write ONLY global and
# clean up any project copy a previous install left behind (idempotent de-dup).
# >>> MMD_SLASH_COMMAND_MATERIALIZE_BEGIN
MMD_CMD_SRC="$MMD_SRC_DIR/assets/claude-commands/mmdream.md"
MMD_CMD_DST="$TARGET/.claude/commands/mmdream.md"
MMD_CMD_DST_GLOBAL="$HOME/.claude/commands/mmdream.md"
if [ -f "$MMD_CMD_SRC" ]; then
    mkdir -p "$(dirname "$MMD_CMD_DST_GLOBAL")"
    cp "$MMD_CMD_SRC" "$MMD_CMD_DST_GLOBAL"
    ok "Generated: ~/.claude/commands/mmdream.md (/mmdream available in every Claude Code session)"
    # De-dup: remove a project-scoped copy from an earlier install (the global one
    # covers this repo too, so a project copy only causes a duplicate listing).
    if [ "$MMD_CMD_DST" != "$MMD_CMD_DST_GLOBAL" ] && [ -f "$MMD_CMD_DST" ]; then
        rm -f "$MMD_CMD_DST"
        ok "Removed project-scoped .claude/commands/mmdream.md (global copy covers it — de-duplicated)."
    fi
else
    warn "/mmdream source not found at $MMD_CMD_SRC — skipping the /mmdream slash command."
    info "Run install-mmd.sh from a full MMD checkout to materialize the /mmdream slash command."
fi
# >>> MMD_SLASH_COMMAND_MATERIALIZE_END

# --- 3e. Bundle A Security pre-commit hook (v0.9.1 secret-scan + v0.9.2 deps-gate, OPT-IN) ---
# The Bundle A Security bricks (MAKE_MY_DREAMS §6.6) ship a git pre-commit gate that
# runs `mmdream secret-scan --staged` (brick 1: catch a leaked credential before commit)
# AND `mmdream deps-gate --since HEAD` (brick 2: catch a poisoned/unresolvable dependency
# before it is committed → installed). We ALWAYS materialize the hook as a NON-ACTIVE
# sample under the gitignored .mmd/hooks/ (idempotent: `cat >` overwrites byte-for-byte
# on re-run), but we NEVER enable it without the user (a pre-commit gate is a workflow
# change the developer must opt into). Set MMD_INSTALL_SECRET_HOOK=1 OR
# MMD_INSTALL_DEPS_HOOK=1 to actually install it into .git/hooks/pre-commit — and even
# then we REFUSE to clobber an existing pre-commit hook (universal §VI honesty: report +
# skip rather than overwrite the user's hook). The hook body lives between the sentinels
# so a test can extract it.
# >>> MMD_SECRET_SCAN_HOOK_MATERIALIZE_BEGIN
MMD_HOOK_SAMPLE_DIR="$TARGET/.mmd/hooks"
MMD_HOOK_SAMPLE="$MMD_HOOK_SAMPLE_DIR/pre-commit"
mkdir -p "$MMD_HOOK_SAMPLE_DIR"
cat > "$MMD_HOOK_SAMPLE" << 'MMD_HOOK_EOF'
#!/usr/bin/env sh
# MMD Bundle A Security pre-commit gate (materialized by install-mmd.sh, v0.9.2).
# Blocks a commit when a HIGH-confidence secret is staged (secret-scan) OR a newly
# added dependency is unresolvable / a likely typosquat (deps-gate). Delete this file
# to disable. Both gates are READ-ONLY, polyglot, and add no new dependency. deps-gate
# is network-bounded and degrades to an honest advisory (exit 0) when offline, so it
# never blocks a commit on a network blink.
run_mmd() {
  if command -v mmdream >/dev/null 2>&1; then
    mmdream "$@"
  elif [ -f bin/mmd.js ]; then
    node bin/mmd.js "$@"
  else
    echo "mmdream not found on PATH; skipping MMD $1 pre-commit gate." >&2
    return 0
  fi
}
# Brick 1 — secret-scan the staged blobs.
run_mmd secret-scan --staged || exit 1
# Brick 2 — deps-gate the dependencies added since the last commit (fall back to a
# full scan on the very first commit, when there is no HEAD yet).
if git rev-parse --verify --quiet HEAD >/dev/null 2>&1; then
  run_mmd deps-gate --since HEAD || exit 1
else
  run_mmd deps-gate || exit 1
fi
exit 0
MMD_HOOK_EOF
chmod +x "$MMD_HOOK_SAMPLE" 2>/dev/null || true
ok "Generated: .mmd/hooks/pre-commit (secret-scan + deps-gate sample — NOT active)"

MMD_GIT_HOOK="$TARGET/.git/hooks/pre-commit"
if [ "${MMD_INSTALL_SECRET_HOOK:-0}" = "1" ] || [ "${MMD_INSTALL_DEPS_HOOK:-0}" = "1" ]; then
    if [ ! -d "$TARGET/.git/hooks" ]; then
        warn "MMD_INSTALL_SECRET_HOOK / MMD_INSTALL_DEPS_HOOK set but $TARGET/.git/hooks is absent (not a git repo?) — leaving the sample only."
    elif [ -e "$MMD_GIT_HOOK" ]; then
        warn "MMD security hook opt-in set but a pre-commit hook already exists — NOT overwriting it."
        info "To chain MMD's gates, add 'mmdream secret-scan --staged' and 'mmdream deps-gate --since HEAD' to your existing $MMD_GIT_HOOK."
    else
        cp "$MMD_HOOK_SAMPLE" "$MMD_GIT_HOOK"
        chmod +x "$MMD_GIT_HOOK" 2>/dev/null || true
        ok "Installed: .git/hooks/pre-commit (secret-scan + deps-gate gate ACTIVE — opt-in honored)"
    fi
else
    info "Bundle A Security pre-commit gate is OPT-IN and NOT enabled. To enable it:"
    info "  cp .mmd/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit"
    info "  (or re-run install-mmd.sh with MMD_INSTALL_SECRET_HOOK=1 or MMD_INSTALL_DEPS_HOOK=1)"
fi
# >>> MMD_SECRET_SCAN_HOOK_MATERIALIZE_END

# ============================================================================
# PHASE 4: gStack functional verify (v0.2.f — AC-2; moved ahead of the pillar
#          block in v0.2.m so all five pillars are detected contiguously)
# ============================================================================
# Per docs/lessons-learned.md L-012: claiming gStack as a pillar without ever
# invoking it is a documentation defect. AC-2 makes the installer functional:
# if ~/.claude/skills/gstack/ is present we MUST verify it responds, not just
# observe the folder exists. If absent we offer to install via the documented
# gStack curl command.
#
# Env vars:
#   MMD_AUTO_INSTALL_GSTACK=1 -> skip y/N prompt and install gStack if absent
#   MMD_REQUIRE_GSTACK=1      -> a broken gStack install fails the run (exit 2)
header "Phase 4 — gStack functional verify"

GSTACK_DIR="$HOME/.claude/skills/gstack"
GSTACK_CONFIG_BIN="$GSTACK_DIR/bin/gstack-config"
GSTACK_STATUS="NOT_INSTALLED"

if [ ! -d "$GSTACK_DIR" ]; then
    info "gStack is NOT installed (~/.claude/skills/gstack/ absent)."
    info "  - gStack is part of the foundation MMD stands on: it provides the review"
    info "    skills behind 'mmdream qa', 'mmdream cso' and 'mmdream document-release'."
    info "  - Install command: git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && (cd ~/.claude/skills/gstack && bun install)"
    info "  - Without gStack, those three commands are unavailable (the core is fine)."
    info "  - Opt out with MMD_SKIP_GSTACK=1 (else it installs by default)."
    INSTALL_GSTACK=false
    if [ "${MMD_SKIP_GSTACK:-0}" = "1" ]; then
        info "MMD_SKIP_GSTACK=1 — opting out of gStack (foundation)."
        INSTALL_GSTACK=false
    elif [ "${MMD_AUTO_INSTALL_GSTACK:-0}" = "1" ]; then
        info "MMD_AUTO_INSTALL_GSTACK=1 — installing gStack without prompt."
        INSTALL_GSTACK=true
    elif [ -t 0 ]; then
        # Courtesy prompt on a real terminal; default INSTALL, decline == opt-out.
        printf "%s" "  Install gStack now? [Y/n] "
        read -r reply
        case "$reply" in
            n|N|no|NO) INSTALL_GSTACK=false ;;
            *) INSTALL_GSTACK=true ;;
        esac
    else
        # No terminal (curl|bash, CI): install the foundation by DEFAULT.
        info "Non-interactive — installing gStack (foundation). Opt out with MMD_SKIP_GSTACK=1."
        INSTALL_GSTACK=true
    fi
    if [ "$INSTALL_GSTACK" != true ]; then
        warn "gStack NOT installed → 'mmdream qa', 'mmdream cso' and 'mmdream document-release' are UNAVAILABLE (the MMD core works without it)."
    fi
    if [ "$INSTALL_GSTACK" = true ]; then
        # Install via git clone + `bun install` — the real, resolvable source on
        # GitHub. (A previous vanity-host curl-installer URL did not resolve.)
        # bun may have just been installed this run into ~/.bun/bin, so force it
        # onto PATH for the clone's `bun install`.
        if git clone --depth=1 https://github.com/garrytan/gstack.git "$GSTACK_DIR" \
           && ( cd "$GSTACK_DIR" && PATH="$HOME/.bun/bin:$PATH" bun install ); then
            info "gStack cloned + dependencies installed — re-checking..."
        else
            warn "gStack install failed (network? git/bun missing?). Continuing without it."
            warn "  Manual: git clone https://github.com/garrytan/gstack.git $GSTACK_DIR && (cd $GSTACK_DIR && bun install)"
        fi
    fi
fi

# Re-check after a possible install attempt.
if [ -d "$GSTACK_DIR" ]; then
    # Functional probe: PATH-prepend bun so the skill's preamble can run, then
    # call gstack-config which is the cheapest skill-host healthcheck.
    if [ -x "$GSTACK_CONFIG_BIN" ]; then
        if GSTACK_OUT="$(PATH="$HOME/.bun/bin:$PATH" "$GSTACK_CONFIG_BIN" get proactive 2>&1)"; then
            ok "gStack: present + functional (gstack-config responded)"
            info "  proactive setting: ${GSTACK_OUT}"
            GSTACK_STATUS="PRESENT_FUNCTIONAL"
        else
            fail "gStack: PRESENT BUT BROKEN — gstack-config did not respond"
            info "  output: ${GSTACK_OUT}"
            info "  Remediation: cd ${GSTACK_DIR} && bun install (or upgrade gStack)"
            GSTACK_STATUS="PRESENT_BROKEN"
        fi
    else
        fail "gStack: PRESENT BUT BROKEN — ${GSTACK_CONFIG_BIN} missing or not executable"
        info "  Remediation: re-install gStack or upgrade to a version that ships gstack-config"
        GSTACK_STATUS="PRESENT_BROKEN"
    fi
else
    warn "gStack: NOT installed (skipping functional check)"
    GSTACK_STATUS="NOT_INSTALLED"
fi

# AC-2 gate: exit 2 when gStack is required but broken.
if [ "$GSTACK_STATUS" = "PRESENT_BROKEN" ] && [ "${MMD_REQUIRE_GSTACK:-0}" = "1" ]; then
    fail "MMD_REQUIRE_GSTACK=1 set but gStack is broken — exiting 2 per AC-2."
    exit 2
fi
if [ "$GSTACK_STATUS" = "NOT_INSTALLED" ] && [ "${MMD_REQUIRE_GSTACK:-0}" = "1" ]; then
    fail "MMD_REQUIRE_GSTACK=1 set but gStack is not installed — exiting 1."
    exit 1
fi

# ============================================================================
# PHASE 5: Spec Kit (v0.2.m — AC-1)
# ============================================================================
# Pillar #4 of 5. https://github.com/github/spec-kit — versioned constitution +
# spec-driven workflow. Detect `specify` on PATH; if absent offer the documented
# install (`uv tool install specify-cli`, pip fallback); functional-verify via
# `specify --version`. Same detect→offer→verify shape as Phase 0 (bun) and
# Phase 4 (gStack).
#
# Env vars:
#   MMD_AUTO_INSTALL_SPEC_KIT=1 -> skip the y/N prompt and install if absent
#   MMD_REQUIRE_SPEC_KIT=1      -> absent + declined → exit 1
header "Phase 5 — Spec Kit (https://github.com/github/spec-kit)"

SPEC_KIT_STATUS="NOT_INSTALLED"
SPEC_KIT_VER=""

# Functional probe: prefer `specify --version`, but GitHub Spec Kit's `specify`
# has no --version flag (it exits non-zero) — fall back to `specify --help`,
# which a working install always answers. (SPEC §5 anticipates this: prefer the
# tool's real documented behavior over the literal --version assumption.)
spec_kit_probe() {
    if SPEC_KIT_VER="$(specify --version 2>&1)" && [ -n "${SPEC_KIT_VER//[[:space:]]/}" ]; then
        SPEC_KIT_VER="${SPEC_KIT_VER%%$'\n'*}"
        return 0
    elif specify --help >/dev/null 2>&1; then
        SPEC_KIT_VER="responsive (specify --help)"
        return 0
    fi
    return 1
}

if command -v specify >/dev/null 2>&1; then
    if spec_kit_probe; then
        ok "Spec Kit: present + functional (${SPEC_KIT_VER})"
        SPEC_KIT_STATUS="PRESENT_FUNCTIONAL"
    else
        fail "Spec Kit: PRESENT BUT BROKEN — specify on PATH but neither --version nor --help responded"
        info "  Remediation: reinstall via 'uv tool install specify-cli' (or 'pip install specify-cli')"
        SPEC_KIT_STATUS="PRESENT_BROKEN"
    fi
else
    info "Spec Kit is NOT installed (specify not on PATH)."
    info "  - Spec Kit provides a versioned constitution + spec-driven workflow."
    info "  - Install command: uv tool install specify-cli  (fallback: pip install specify-cli)"
    info "  - Without Spec Kit, 'mmdream discover' won't import Spec Kit constitutions from this machine."
    INSTALL_SPEC_KIT=false
    if [ "${MMD_AUTO_INSTALL_SPEC_KIT:-0}" = "1" ]; then
        info "MMD_AUTO_INSTALL_SPEC_KIT=1 detected — proceeding without prompt."
        INSTALL_SPEC_KIT=true
    elif [ -t 0 ]; then
        printf "%s" "  Install Spec Kit via 'uv tool install specify-cli'? [y/N] "
        read -r reply
        case "$reply" in
            y|Y|yes|YES) INSTALL_SPEC_KIT=true ;;
            *) INSTALL_SPEC_KIT=false ;;
        esac
    else
        info "Non-interactive stdin — skipping prompt. Set MMD_AUTO_INSTALL_SPEC_KIT=1 to auto-install."
    fi
    if [ "$INSTALL_SPEC_KIT" = true ]; then
        SPEC_KIT_INSTALLED=false
        if command -v uv >/dev/null 2>&1; then
            if uv tool install specify-cli; then SPEC_KIT_INSTALLED=true; fi
        else
            warn "uv not found — falling back to 'pip install specify-cli'."
            if command -v pip >/dev/null 2>&1 && pip install specify-cli; then
                SPEC_KIT_INSTALLED=true
            elif command -v pip3 >/dev/null 2>&1 && pip3 install specify-cli; then
                SPEC_KIT_INSTALLED=true
            else
                warn "Neither uv nor pip available — cannot install Spec Kit automatically."
            fi
        fi
        if [ "$SPEC_KIT_INSTALLED" = true ] && command -v specify >/dev/null 2>&1 \
           && spec_kit_probe; then
            ok "Spec Kit installed and verified: ${SPEC_KIT_VER}"
            SPEC_KIT_STATUS="PRESENT_FUNCTIONAL"
        else
            fail "Spec Kit install attempted but 'specify --version' did not respond."
            info "  Remediation: install manually — see https://github.com/github/spec-kit"
        fi
    else
        warn "Spec Kit: NOT installed (user declined). MMD continues; \`mmdream discover\` won't import Spec Kit constitutions from this machine."
    fi
fi

# AC-1 gate: Spec Kit mandatory when MMD_REQUIRE_SPEC_KIT=1 and still absent.
if [ "$SPEC_KIT_STATUS" != "PRESENT_FUNCTIONAL" ] && [ "${MMD_REQUIRE_SPEC_KIT:-0}" = "1" ]; then
    fail "Spec Kit is required (MMD_REQUIRE_SPEC_KIT=1). Re-run with --yes or install manually."
    exit 1
fi

# ============================================================================
# PHASE 6: OpenSpec (v0.2.m — AC-2)
# ============================================================================
# Pillar #5 detection. https://github.com/Fission-AI/OpenSpec — lightweight
# spec-first alternative. Detect `openspec`; if absent offer `npm install -g
# openspec`; functional-verify via `openspec --version` (fallback `openspec
# help`). Identical shape to Phase 5.
#
# Env vars:
#   MMD_AUTO_INSTALL_OPENSPEC=1 -> skip the y/N prompt and install if absent
#   MMD_REQUIRE_OPENSPEC=1      -> absent + declined → exit 1
header "Phase 6 — OpenSpec (https://github.com/Fission-AI/OpenSpec)"

OPENSPEC_STATUS="NOT_INSTALLED"
OPENSPEC_VER=""

# Functional probe: prefer --version, fall back to `help` for older builds.
# Normalize OPENSPEC_VER to its first line so every consumer (the ok lines AND
# the summary banner) can use it without re-truncating — keeps the banner's
# "reads ${VAR:-default}" promise honest.
openspec_probe() {
    if OPENSPEC_VER="$(openspec --version 2>&1)" && [ -n "${OPENSPEC_VER//[[:space:]]/}" ]; then
        OPENSPEC_VER="${OPENSPEC_VER%%$'\n'*}"
        return 0
    elif OPENSPEC_VER="$(openspec help 2>&1)"; then
        OPENSPEC_VER="${OPENSPEC_VER%%$'\n'*}"
        return 0
    fi
    return 1
}

if command -v openspec >/dev/null 2>&1; then
    if openspec_probe; then
        ok "OpenSpec: present + functional (openspec responded: ${OPENSPEC_VER})"
        OPENSPEC_STATUS="PRESENT_FUNCTIONAL"
    else
        fail "OpenSpec: PRESENT BUT BROKEN — openspec on PATH but neither --version nor help responded"
        info "  Remediation: reinstall via 'npm install -g openspec'"
        OPENSPEC_STATUS="PRESENT_BROKEN"
    fi
else
    info "OpenSpec is NOT installed (openspec not on PATH)."
    info "  - OpenSpec provides a lightweight, spec-first workflow."
    info "  - Install command: npm install -g openspec"
    info "  - Without OpenSpec, 'mmdream discover' won't import OpenSpec change proposals from this machine."
    if [ "$(id -u)" != "0" ]; then
        info "  - Note: 'npm install -g' may require sudo on this machine. MMD will NOT sudo for you;"
        info "    if the install fails with EACCES, re-run the npm command manually with the right privileges."
    fi
    INSTALL_OPENSPEC=false
    if [ "${MMD_AUTO_INSTALL_OPENSPEC:-0}" = "1" ]; then
        info "MMD_AUTO_INSTALL_OPENSPEC=1 detected — proceeding without prompt."
        INSTALL_OPENSPEC=true
    elif [ -t 0 ]; then
        printf "%s" "  Install OpenSpec via 'npm install -g openspec'? [y/N] "
        read -r reply
        case "$reply" in
            y|Y|yes|YES) INSTALL_OPENSPEC=true ;;
            *) INSTALL_OPENSPEC=false ;;
        esac
    else
        info "Non-interactive stdin — skipping prompt. Set MMD_AUTO_INSTALL_OPENSPEC=1 to auto-install."
    fi
    if [ "$INSTALL_OPENSPEC" = true ]; then
        if npm install -g openspec; then
            if command -v openspec >/dev/null 2>&1 && openspec_probe; then
                ok "OpenSpec installed and verified: ${OPENSPEC_VER}"
                OPENSPEC_STATUS="PRESENT_FUNCTIONAL"
            else
                fail "OpenSpec install completed but the openspec command did not respond."
                info "  Remediation: ensure your npm global bin is on PATH — see https://github.com/Fission-AI/OpenSpec"
            fi
        else
            fail "OpenSpec install via 'npm install -g openspec' failed (permissions? network?)."
            info "  Remediation: run 'npm install -g openspec' manually (may need sudo), then re-run this script."
        fi
    else
        warn "OpenSpec: NOT installed (user declined). MMD continues; 'mmdream discover' won't import OpenSpec proposals from this machine."
    fi
fi

# AC-2 gate: OpenSpec mandatory when MMD_REQUIRE_OPENSPEC=1 and still absent.
if [ "$OPENSPEC_STATUS" != "PRESENT_FUNCTIONAL" ] && [ "${MMD_REQUIRE_OPENSPEC:-0}" = "1" ]; then
    fail "OpenSpec is required (MMD_REQUIRE_OPENSPEC=1). Re-run with --yes or install manually."
    exit 1
fi

# ============================================================================
# PHASE 7: Ralph Loop (v0.2.m — AC-3)
# ============================================================================
# Pillar detection via the Claude Code plugin system. Ralph Loop ships as a
# plugin in the `claude-plugins-official` marketplace. Detect with
# `claude plugin list | grep -q ralph-loop`; if absent offer
# `claude plugin install ralph-loop`; verify by re-running the detection.
#
# Pre-check (AC-3): if `claude plugin list` itself errors (Claude Code too old
# to support plugins, or claude absent) we SKIP Phase 7 cleanly — never block.
#
# Env vars:
#   MMD_AUTO_INSTALL_RALPH_LOOP=1 -> skip the y/N prompt and install if absent
#   MMD_REQUIRE_RALPH_LOOP=1      -> absent + declined → exit 1
header "Phase 7 — Ralph Loop (Claude Code plugin: ralph-loop)"

RALPH_STATUS="NOT_INSTALLED"

ralph_present() {
    claude plugin list 2>/dev/null | grep -q ralph-loop
}

if ! command -v claude >/dev/null 2>&1; then
    warn "Ralph Loop: claude CLI not found — skipping plugin check."
    info "  Install Claude Code first, then re-run this script to wire Ralph Loop."
    RALPH_STATUS="SKIPPED_NO_CLAUDE"
elif ! claude plugin list >/dev/null 2>&1; then
    warn "Ralph Loop needs Claude Code 2.1+ for plugin support. Skipping."
    RALPH_STATUS="SKIPPED_OLD_CLAUDE"
elif ralph_present; then
    ok "Ralph Loop: present + functional (claude plugin list shows ralph-loop)"
    RALPH_STATUS="PRESENT_FUNCTIONAL"
else
    info "Ralph Loop plugin is NOT installed (not in 'claude plugin list')."
    info "  - Ralph Loop is a minimalist bounded-loop pattern (Claude Code plugin)."
    info "  - Install command: claude plugin install ralph-loop"
    INSTALL_RALPH=false
    if [ "${MMD_AUTO_INSTALL_RALPH_LOOP:-0}" = "1" ]; then
        info "MMD_AUTO_INSTALL_RALPH_LOOP=1 detected — proceeding without prompt."
        INSTALL_RALPH=true
    elif [ -t 0 ]; then
        printf "%s" "  Install Ralph Loop plugin via 'claude plugin install ralph-loop'? [y/N] "
        read -r reply
        case "$reply" in
            y|Y|yes|YES) INSTALL_RALPH=true ;;
            *) INSTALL_RALPH=false ;;
        esac
    else
        info "Non-interactive stdin — skipping prompt. Set MMD_AUTO_INSTALL_RALPH_LOOP=1 to auto-install."
    fi
    if [ "$INSTALL_RALPH" = true ]; then
        if claude plugin install ralph-loop && ralph_present; then
            ok "Ralph Loop installed and verified (claude plugin list shows ralph-loop)"
            RALPH_STATUS="PRESENT_FUNCTIONAL"
        else
            fail "Ralph Loop install attempted but the plugin is still not listed."
            info "  Remediation: run 'claude plugin install ralph-loop' manually, then re-run this script."
        fi
    else
        warn "Ralph Loop: NOT installed (user declined). MMD continues; the FAST engine's bounded-loop pattern is unaffected."
    fi
fi

# AC-3 gate: Ralph Loop mandatory when MMD_REQUIRE_RALPH_LOOP=1 and absent. The
# pre-check SKIPPED states do NOT exit (AC-3: "no error" when plugins
# unsupported) — they only warn.
if [ "${MMD_REQUIRE_RALPH_LOOP:-0}" = "1" ]; then
    case "$RALPH_STATUS" in
        NOT_INSTALLED)
            fail "Ralph Loop is required (MMD_REQUIRE_RALPH_LOOP=1). Re-run with --yes or install manually."
            exit 1
            ;;
        SKIPPED_*)
            warn "MMD_REQUIRE_RALPH_LOOP=1 set but the plugin system is unavailable — cannot verify. Continuing (pre-check skip is not an error per AC-3)."
            ;;
    esac
fi

# ============================================================================
# PHASE 8: Update skill manifest
# ============================================================================
header "Phase 8 — Updating skill manifest"

# Determine which manifest file exists
MANIFEST=$(resolve_dep \
    "_bmad/_config/skill-manifest.csv" \
    "_bmad/_config/workflow-manifest.csv")
MANIFEST="$TARGET/$MANIFEST"

MANIFEST_ENTRY="\"auto-dev\",\"auto-dev\",\"Automated end-to-end pipeline: quick-dev spec + party mode → adversarial spec review loop → quick-dev implementation → adversarial code review loop.\",\"${ADV_CODE}\",\"_bmad/${ADV_CODE}/workflows/auto-dev/workflow.md\""

# Remove any existing auto-dev entry (handles updates cleanly)
if grep -q '"auto-dev"' "$MANIFEST" 2>/dev/null; then
    grep -v '"auto-dev"' "$MANIFEST" > "$MANIFEST.tmp"
    mv "$MANIFEST.tmp" "$MANIFEST"
    info "Removed old manifest entry"
fi

# Add fresh entry
echo "$MANIFEST_ENTRY" >> "$MANIFEST"

# Sort manifest (keep header, sort rest)
{
    head -1 "$MANIFEST"
    tail -n +2 "$MANIFEST" | sort
} > "$MANIFEST.tmp"
mv "$MANIFEST.tmp" "$MANIFEST"

ok "Manifest entry written and sorted"

# ============================================================================
# PHASE 9: Cleanup old installation artifacts
# ============================================================================
header "Phase 9 — Cleanup"

# v2.x layout: workflow lived under bmm-quick-flow
OLD_WORKFLOW_DIR_V2="$TARGET/_bmad/bmm/workflows/bmad-quick-flow/auto-dev"
if [ -d "$OLD_WORKFLOW_DIR_V2" ]; then
    rm -rf "$OLD_WORKFLOW_DIR_V2"
    ok "Removed v2 workflow directory: _bmad/bmm/workflows/bmad-quick-flow/auto-dev/"
fi

# v3.x layout: workflow side-loaded into bmm/4-implementation
OLD_WORKFLOW_DIR_V3="$TARGET/_bmad/bmm/4-implementation/auto-dev"
if [ -d "$OLD_WORKFLOW_DIR_V3" ]; then
    rm -rf "$OLD_WORKFLOW_DIR_V3"
    ok "Removed v3 workflow directory: _bmad/bmm/4-implementation/auto-dev/ (migrated to adv module)"
fi

# v3.x slash command name
OLD_COMMAND_FILE="$TARGET/.claude/commands/bmad-bmm-auto-dev.md"
if [ -f "$OLD_COMMAND_FILE" ]; then
    rm -f "$OLD_COMMAND_FILE"
    ok "Removed v3 slash command: .claude/commands/bmad-bmm-auto-dev.md (replaced by bmad-${ADV_CODE}-auto-dev)"
fi

if [ ! -d "$OLD_WORKFLOW_DIR_V2" ] && [ ! -d "$OLD_WORKFLOW_DIR_V3" ] && [ ! -f "$OLD_COMMAND_FILE" ]; then
    ok "No legacy artifacts to clean up"
fi

# ============================================================================
# PHASE 10: Validation
# ============================================================================
header "Phase 10 — Validation"

ALL_OK=true

for f in \
    "_bmad/${ADV_CODE}/module.yaml" \
    "_bmad/${ADV_CODE}/workflows/auto-dev/workflow.md" \
    ".claude/commands/bmad-${ADV_CODE}-auto-dev.md" \
; do
    if [ -f "$TARGET/$f" ]; then
        ok "Verified: $f"
    else
        fail "Missing after install: $f"
        ALL_OK=false
    fi
done

if grep -q '"auto-dev"' "$MANIFEST"; then
    ok "Verified: auto-dev in skill manifest"
else
    fail "auto-dev not found in manifest"
    ALL_OK=false
fi

# Check constitution status for summary
HAS_CONSTITUTION=false
if [ -f "$TARGET/$CONSTITUTION_PATH" ]; then
    HAS_CONSTITUTION=true
fi

# ============================================================================
# FINAL SUMMARY BANNER: all 5 pillars (v0.2.m — AC-4)
# ============================================================================
# Single at-a-glance block of every pillar's detection result. Rendered
# regardless of which pillars are present — a mix of present/absent is normal.
# Reads ${VAR:-default} so the block can be exercised in isolation by tests.
pillar_line() {
    # $1 = label, $2 = status keyword, $3 = detail text
    local label="$1" status="$2" detail="$3" marker
    case "$status" in
        PRESENT_FUNCTIONAL) marker="${GREEN}✓${NC}" ;;
        NOT_INSTALLED|SKIPPED_*) marker="${YELLOW}⚠${NC}" ;;
        *) marker="${RED}✗${NC}" ;;
    esac
    printf "  %-11s%b %s\n" "$label" "$marker" "$detail"
}

echo ""
echo "═══ Install summary ═══"

# bun
if [ "${BUN_OK:-false}" = true ]; then
    pillar_line "bun" "PRESENT_FUNCTIONAL" "present + functional (${BUN_VER:-unknown})"
else
    pillar_line "bun" "NOT_INSTALLED" "NOT installed (re-run with MMD_AUTO_INSTALL_BUN=1)"
fi

# gStack
case "${GSTACK_STATUS:-NOT_INSTALLED}" in
    PRESENT_FUNCTIONAL) pillar_line "gStack" "PRESENT_FUNCTIONAL" "present + functional (gstack-config responded)" ;;
    PRESENT_BROKEN)     pillar_line "gStack" "PRESENT_BROKEN" "PRESENT BUT BROKEN — see Phase 4 above" ;;
    *)                  pillar_line "gStack" "NOT_INSTALLED" "NOT installed (re-run with MMD_AUTO_INSTALL_GSTACK=1)" ;;
esac

# BMAD — invariant by construction: Phase 1 exits non-zero on any BMAD failure,
# so reaching the banner means BMAD installed. The row is always green.
pillar_line "BMAD" "${BMAD_STATUS:-PRESENT_FUNCTIONAL}" "present + functional (adv module loaded)"

# Spec Kit
case "${SPEC_KIT_STATUS:-NOT_INSTALLED}" in
    PRESENT_FUNCTIONAL) pillar_line "Spec Kit" "PRESENT_FUNCTIONAL" "present + functional (${SPEC_KIT_VER:-specify})" ;;
    PRESENT_BROKEN)     pillar_line "Spec Kit" "PRESENT_BROKEN" "PRESENT BUT BROKEN — see Phase 5 above" ;;
    *)                  pillar_line "Spec Kit" "NOT_INSTALLED" "NOT installed (re-run with MMD_AUTO_INSTALL_SPEC_KIT=1)" ;;
esac

# OpenSpec
case "${OPENSPEC_STATUS:-NOT_INSTALLED}" in
    PRESENT_FUNCTIONAL) pillar_line "OpenSpec" "PRESENT_FUNCTIONAL" "present + functional (${OPENSPEC_VER:-openspec})" ;;
    PRESENT_BROKEN)     pillar_line "OpenSpec" "PRESENT_BROKEN" "PRESENT BUT BROKEN — see Phase 6 above" ;;
    *)                  pillar_line "OpenSpec" "NOT_INSTALLED" "NOT installed (re-run with MMD_AUTO_INSTALL_OPENSPEC=1)" ;;
esac

# Ralph Loop
case "${RALPH_STATUS:-NOT_INSTALLED}" in
    PRESENT_FUNCTIONAL) pillar_line "Ralph Loop" "PRESENT_FUNCTIONAL" "present + functional (claude plugin list shows ralph-loop)" ;;
    SKIPPED_NO_CLAUDE)  pillar_line "Ralph Loop" "SKIPPED_NO_CLAUDE" "SKIPPED (claude CLI not found)" ;;
    SKIPPED_OLD_CLAUDE) pillar_line "Ralph Loop" "SKIPPED_OLD_CLAUDE" "SKIPPED (needs Claude Code 2.1+ plugin support)" ;;
    *)                  pillar_line "Ralph Loop" "NOT_INSTALLED" "NOT installed (re-run with MMD_AUTO_INSTALL_RALPH_LOOP=1)" ;;
esac

echo "═════════════════════"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════╗"

if [ "$ALL_OK" = true ]; then
    echo "║  ✅  MMD Phase A installed successfully!                 ║"
    echo "║      (Standard engine ready — \`${ADV_CODE}\` module + auto-dev)    ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo ""
    printf "  ${BOLD}Put the \`mmdream\` CLI on your PATH${NC} (from this repo dir):\n"
    echo ""
    printf "    ${CYAN}npm install -g .${NC}\n"
    echo ""
    printf "  ${BOLD}Then — the easiest way in:${NC}\n"
    echo ""
    printf "    ${CYAN}mmdream serve${NC}                          open the web UI (for anyone)\n"
    printf "    ${CYAN}mmdream \"a drawing app for kids\"${NC}       interactive Dream Catcher, then auto-dev\n"
    printf "    ${CYAN}mmdream --here \"add a dark-mode toggle\"${NC} evolve THIS repo in place (on a slice branch)\n"
    echo ""
    printf "  Inside a Claude Code session you can also drive MMD by intent with ${CYAN}/mmdream <what you want>${NC}.\n"
    printf "  (Low-level alternative, still available: the ${CYAN}/bmad-${ADV_CODE}-auto-dev${NC} slash-command.)\n"
    echo ""
    if [ "$HAS_CONSTITUTION" = true ]; then
        printf "  ${GREEN}📜 Constitution detected${NC} — sub-agents will enforce its rules\n"
    else
        printf "  ${YELLOW}ℹ️  No constitution${NC} — create one and re-run this script to enable\n"
    fi
    echo ""
    printf "  See ${CYAN}README.md${NC} (Quick start) and ${CYAN}MAKE_MY_DREAMS.md${NC} §9 for the full roadmap.\n"
    printf "  Re-run this script at any time to update or repair the installation.\n"
    echo ""
else
    echo "║  ⚠  Installation completed with warnings               ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo ""
    printf "  Some verification checks failed. Review the output above.\n"
    echo ""
fi
