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
#     `mmd discover` command + `.mmd/shared/` vs `.mmd/local/` structure
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

INSTALLER_VERSION="5.0.0"

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
(cd "$TARGET" && npx --yes bmad-method@latest install \
    --yes \
    --directory "$TARGET" \
    --modules "$MODULES" \
    --tools claude-code \
    --communication-language French \
    --document-output-language English)
BMAD_EXIT=$?

if [ "$BMAD_EXIT" -ne 0 ]; then
    echo ""
    fail "BMAD installation exited with code $BMAD_EXIT."
    echo "  Fix any issues above and re-run this script."
    exit 1
fi

ok "BMAD installation completed"

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
- **Bug fix = test first**: Every bug fix MUST start with a non-regression test that reproduces the bug (red), then fix the bug (green). This ensures the bug never resurfaces
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
- **FORBIDDEN to mention AI in commits**: No reference to "AI", "Claude", "GPT", "Copilot", "IA", "assistant" or any other AI tool in commit messages, PR descriptions, or code comments

**Rationale**: Commit control ensures traceability and code quality.

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

**Version**: 1.0.0 | **Generated by install-mmd.sh**
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
2. You MUST invoke Party Mode exactly 3 times as described above — this is NON-NEGOTIABLE
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
COMMAND_FILE="$TARGET/.claude/commands/bmad-${ADV_CODE}-auto-dev.md"

cat > "$COMMAND_FILE" << COMMAND_EOF
---
name: 'auto-dev'
description: 'Automated end-to-end pipeline: quick-dev spec + party mode → adversarial spec review loop → quick-dev implementation → adversarial code review loop. Fully autonomous with progress reporting.'
---

IT IS CRITICAL THAT YOU FOLLOW THIS COMMAND: LOAD the FULL @{project-root}/_bmad/${ADV_CODE}/workflows/auto-dev/workflow.md, READ its entire contents and follow its directions exactly!
COMMAND_EOF

ok "Generated: .claude/commands/bmad-${ADV_CODE}-auto-dev.md"

# ============================================================================
# PHASE 4: Update skill manifest
# ============================================================================
header "Phase 4 — Updating skill manifest"

# Determine which manifest file exists
MANIFEST=$(resolve_dep \
    "_bmad/_config/skill-manifest.csv" \
    "_bmad/_config/workflow-manifest.csv")
MANIFEST="$TARGET/$MANIFEST"

MANIFEST_ENTRY="\"auto-dev\",\"auto-dev\",\"Automated end-to-end pipeline: quick-dev spec + party mode → adversarial spec review loop → quick-dev implementation → adversarial code review loop.\",\"${ADV_CODE}\",\"_bmad/${ADV_CODE}/workflows/auto-dev/workflow.md\",\"false\""

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
# PHASE 5: Cleanup old installation artifacts
# ============================================================================
header "Phase 5 — Cleanup"

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
# PHASE 6: Validation
# ============================================================================
header "Phase 6 — Validation"

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
# Summary
# ============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════╗"

if [ "$ALL_OK" = true ]; then
    echo "║  ✅  MMD Phase A installed successfully!                 ║"
    echo "║      (Standard engine ready — \`${ADV_CODE}\` module + auto-dev)    ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo ""
    printf "  ${BOLD}Usage in Claude Code (Standard engine, current):${NC}\n"
    echo ""
    printf "    ${CYAN}/bmad-${ADV_CODE}-auto-dev <dev description>${NC}\n"
    echo ""
    printf "  ${BOLD}Example:${NC}\n"
    echo ""
    printf "    ${CYAN}/bmad-${ADV_CODE}-auto-dev Add a REST API for user management${NC}\n"
    echo ""
    if [ "$HAS_CONSTITUTION" = true ]; then
        printf "  ${GREEN}📜 Constitution detected${NC} — sub-agents will enforce its rules\n"
    else
        printf "  ${YELLOW}ℹ️  No constitution${NC} — create one and re-run this script to enable\n"
    fi
    echo ""
    printf "  ${BOLD}Coming phases${NC} (see header roadmap):\n"
    printf "    Phase B (MMD v0.2)  → FAST engine (Ralph + 1-page spec)\n"
    printf "    Phase C (MMD v0.2b) → Bundle A Security (sandbox, deps-gate)\n"
    printf "    Phase D (MMD v0.2c) → Project Onboarder (\`mmd discover\`)\n"
    printf "    Phase E (MMD v0.5)  → Conductor + Observability\n"
    printf "    Phase F (MMD v0.9)  → Worktrees parallelization\n"
    echo ""
    printf "  See ${CYAN}MAKE_MY_DREAMS.md${NC} §9 for the full roadmap.\n"
    printf "  Re-run this script at any time to update or repair the installation.\n"
    echo ""
else
    echo "║  ⚠  Installation completed with warnings               ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo ""
    printf "  Some verification checks failed. Review the output above.\n"
    echo ""
fi
