# ADR-007: gStack effective via `mmd ship` subcommand + functional install + pillar audit

Date: 2026-05-17
Status: Accepted

## Context

Per [`docs/lessons-learned.md` L-012](../lessons-learned.md), MMD claimed gStack as a foundational pillar (README "stands on the shoulders of") for 11 consecutive slices (v0.0 through v0.2b) while never actually invoking it. Root causes:

1. `install-mmd.sh` only **prompted** about gStack and **warned** about bun rather than installing + verifying both functionally.
2. `bun` lived in `~/.bashrc` but was NOT in the `PATH` of non-interactive subprocesses (`claude -p`, scripted invocations, IDE integrations).
3. `~/.claude/skills/gstack/ship/` existed but no MMD code path ever called it.

L-012 also identified this as a repeat of the L-009 pattern: design scope leaking into ahistorically-true claims in the implementation. The remedy required three coordinated changes:

- Make the install **functional** (verify each pillar responds, not just "the folder exists").
- Wire **at least one** gStack skill into a real MMD invocation path.
- Make the pattern **auditable** so future drift is named, not silent.

## Decision

v0.2.f delivers three coupled changes:

### 1. `mmd ship` wrapper

A new subcommand `mmd ship [<branch>] [--dry-run]` invokes the gStack `ship` skill via `claude -p --output-format text` with `PATH` forced to include `$HOME/.bun/bin`. It replaces the manual `git merge --ff-only && git tag && git push --tags` chain used for v0.1.0 → v0.2.2.

**Why a wrapper rather than telling users to invoke claude directly?**

- **Uniform UX**: the same `mmd ship` works in a fresh shell, in a CI runner, and inside `claude -p` itself — no shell-rc setup required.
- **Enforced `PATH`**: every subprocess inherits `~/.bun/bin` at the head of PATH so gStack's skill preamble can resolve `bun` without user-shell mutations.
- **Audit hook**: `scripts/audit-pillars.sh` always runs after `ship` exits, so every release surfaces which pillars were actually invoked.
- **Single point of evolution**: when gStack ships a new skill (e.g. `/document-release` integration), it lands in `mmd ship` without forcing every user to learn a new incantation.

### 2. Functional install (install-mmd.sh Phase 0 + Phase 6)

`install-mmd.sh` now:

- **Phase 0 (bun)**: detects bun via `command -v bun` (not just file presence), offers automatic install via the official `curl | bash` pipe (gated by a `y/N` prompt or `MMD_AUTO_INSTALL_BUN=1`), and verifies `~/.bun/bin/bun --version` responds.
- **Phase 6 (gStack)**: if `~/.claude/skills/gstack/` is present, runs a functional probe: `PATH=$HOME/.bun/bin:$PATH ~/.claude/skills/gstack/bin/gstack-config get proactive` MUST succeed. Otherwise prints remediation + exits 2 (when `MMD_REQUIRE_GSTACK=1`).
- `MMD_REQUIRE_GSTACK=1`: turns advisory checks into hard gates (bun missing → exit 1; gStack broken → exit 2).

**Why functional verification instead of file-presence?**

Per L-012, "the folder exists" is not the same as "the dependency works." Several v0.x slices passed install-mmd.sh's Phase B check while having a `bun` binary that wasn't on PATH for subprocesses — i.e. an install that looked OK but produced broken-gStack behavior at runtime. Functional verification (`bun --version`, `gstack-config get proactive`) catches the gap at install time, where remediation is cheapest.

### 3. `scripts/audit-pillars.sh` (advisory by default, --ci gating opt-in)

For each pillar claimed in README's "stands on the shoulders of" list, the script greps the slice's commit messages + diff for known invocation patterns (defined in `scripts/audit-pillars.patterns.json`) and reports `INVOKED (count)` / `NOT INVOKED` with the matched patterns and last commit.

**Why advisory rather than gating?**

A hard gate on pillar invocation would break **emergency ships** — bug fixes that legitimately don't invoke any pillar (e.g. a typo fix in a docstring) would fail to merge for no reason. The L-012 problem was not "every slice must use every pillar," it was "claims must be testable and visible." Advisory output achieves the visibility without imposing a usage requirement. CI users who want to enforce can opt in via `--ci`.

The audit always runs at `mmd ship` time so every release surfaces the pillar table in its summary. If a slice claims to use gStack but the audit shows `gStack | NOT INVOKED (0)`, the L-012 closure mechanism catches the drift before the tag lands.

## Consequences

### Positive

- **L-012 operationally closed**: after v0.2.f's first `mmd ship` run, the pillar audit will show `gStack | INVOKED (>=1)` for the slice — a measurable proof that gStack is no longer a documentation-only claim.
- **Install regressions caught early**: a fresh clone + fresh `install-mmd.sh` either produces a working bun+gStack OR exits with a clear remediation message. No more silent partial installs.
- **gStack ship skill validated against MMD**: the v0.2.f slice itself is the first real-world test of the ship skill against a non-trivial branch (this slice has 60+ tests, library + script + doc changes). The acid test in DoD §9 is "ship uses ship" (v0.2.f merges via its own `mmd ship`).
- **Audit hook reusable**: future pillars (e.g. Spec Kit, OpenSpec, Ralph Loop) get the same visibility for free — add patterns to `audit-pillars.patterns.json` v1 schema, no code change needed.

### Negative

- **Larger install footprint**: bun adds ~40 MB to a fresh install. Justified by the gStack dependency; the `y/N` prompt + `MMD_AUTO_INSTALL_BUN=1` env var keep this opt-in.
- **`claude -p` dependency surface**: `mmd ship` depends on `claude` being on PATH. The bin/mmd shim handles the bun part, but Claude Code itself must be installed separately (documented prerequisite). Failure surfaces as exit 4 with a clear "claude not found" message.
- **L-006 zombie risk**: per L-006, `claude -p` can stay `S (sleeping)` after finishing its work. `mmd ship` mitigates with `MMD_SHIP_TIMEOUT_MS` (default 30 min) and a SIGTERM/SIGKILL pair. The L-006 invariant ("`pgrep -af \"claude -p\"` before launching") is documented in `lib/ship/invoke-claude.js`.

### Follow-up work

- v0.2.f+ medium gStack integration: a Conductor stub orchestrating `auto-dev → /qa → /cso → /ship` as a measured sequence (per L-012 closure options 2-3).
- v0.2.f+ CI integration: wire `audit-pillars.sh --ci` into the GitHub Actions release pipeline so any future PR that claims a pillar without invoking it fails CI.
- v0.3+ retire the manual `git merge --ff-only` instructions from README — once `mmd ship` proves stable across 3+ releases, the manual path becomes legacy.

## Related

- L-012 — the failure that motivated this slice.
- L-009 — the meta-rule (distinguish design scope from current implementation) that L-012 generalizes.
- ADR-001 — adopt gStack as backbone (the original commitment that this ADR makes operational).
- SPEC_V02F.md — the authoritative spec implemented by this ADR.
