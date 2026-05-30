# Make My Dreams — v0.2.m Spec: Spec Kit + OpenSpec + Ralph Loop install hardening

> Per L-012 closure (final pass) — v0.2.f hardened `install-mmd.sh` for bun + gStack + BMAD with functional verification (not just file presence). The README's "stands on the shoulders of" list claims 5 pillars: Spec Kit, OpenSpec, BMAD, gStack, Ralph Loop. Three of them are still **only cited, never installed or verified**. The `scripts/audit-pillars.sh` script confirms invocation in slices (currently reports each as INVOKED ≥1 because their patterns appear in MMD's own code), but `install-mmd.sh` never makes them actually available on a fresh machine. v0.2.m closes the gap with three new Phase blocks (Phase 5: Spec Kit, Phase 6: OpenSpec, Phase 7: Ralph Loop), each following the v0.2.f pattern: detect present → offer install if absent → functional check (not just file existence). After v0.2.m, a fresh `bash install-mmd.sh .` produces a machine with all 5 pillars present and responsive, with clear messages about what's installed vs skipped vs broken.

---

## 1. Goal of v0.2.m

Three new Phase blocks added to `install-mmd.sh`, each modeled on the existing Phase 0 (bun) + Phase 4 (gStack) patterns:

1. **Phase 5 — Spec Kit** (https://github.com/github/spec-kit): detect `command -v specify`; if absent, offer install (`uv tool install specify-cli` per Spec Kit's docs, or `pip install specify-cli` as fallback); functional verify via `specify --version`.
2. **Phase 6 — OpenSpec** (https://github.com/Fission-AI/OpenSpec): detect `command -v openspec`; if absent, offer install (`npm install -g openspec` per OpenSpec's convention); functional verify via `openspec --version` or `openspec help`.
3. **Phase 7 — Ralph Loop** (Claude Code plugin from `claude-plugins-official` marketplace): detect plugin presence via `claude plugin list 2>/dev/null | grep -q ralph-loop`; if absent, offer install via `claude plugin install ralph-loop`; functional verify via the plugin list grep.

Each phase:
- Gated by user prompt (`y/N`, default `N`) unless `MMD_AUTO_INSTALL_<PILLAR>=1` is set
- Honors a `MMD_REQUIRE_<PILLAR>=1` env var: if set and the pillar is absent and the user declines install → exit non-zero
- Prints a clear status line: `Spec Kit: present + functional (specify --version responded)` or `Spec Kit: NOT installed (user declined)` or `Spec Kit: PRESENT BUT BROKEN — see below`

**Non-features** (deliberately deferred):
- Pinning SHA-256 of the install URLs (the cso LOW-2 follow-up — separate slice).
- Detecting alternative install methods (e.g., Spec Kit installed via brew, asdf, manually). Each Phase covers ONE install path; users with alternative installs can `command -v` succeeds and the install step is skipped.
- Cross-version compatibility checks (any version of each pillar counts as "present").
- A "verify all pillars" subcommand independent of install-mmd.sh (could be `mmd doctor` v0.2.m+).

**Why this exists**: L-012's lite-option closure (v0.2.6 `mmd ship` wrapper) demonstrated MMD CAN invoke gStack skills. L-012's full closure requires every claimed pillar to be actually installable + verifiable. v0.2.m completes the install side; runtime invocations of Spec Kit / OpenSpec / Ralph Loop from MMD remain future slices (Heavy gStack v0.2.n+ would extend that pattern to non-gStack pillars).

**Mission validation**: after v0.2.m, on a hypothetical fresh machine, `bash install-mmd.sh .` produces a final banner listing all 5 pillars with their detection results. `mmd doctor` (if added later) returns the same data programmatically.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: Phase 5 (Spec Kit) detection + install + verify

**Given** a machine where `specify` is not on PATH
**When** `bash install-mmd.sh .` runs and reaches Phase 5
**Then**:
- Prints a header: `Phase 5 — Spec Kit (https://github.com/github/spec-kit)`
- Detects absence via `command -v specify`
- Offers install: `Install Spec Kit via 'uv tool install specify-cli'? [y/N]`
- If user accepts (or `MMD_AUTO_INSTALL_SPEC_KIT=1`): runs the install command, then `specify --version` to verify
- If user declines: prints `Spec Kit: NOT installed (user declined). MMD continues; \`mmd discover\` won't import Spec Kit constitutions from this machine.`
- If `MMD_REQUIRE_SPEC_KIT=1` is set AND the user declines AND `specify` is still absent → exit 1 with `Spec Kit is required (MMD_REQUIRE_SPEC_KIT=1). Re-run with --yes or install manually.`

Tag: `@unit` for the detection + decision logic (mocked `command -v` + user input).

### AC-2: Phase 6 (OpenSpec) detection + install + verify

**Given** a machine where `openspec` is not on PATH
**When** `bash install-mmd.sh .` runs and reaches Phase 6
**Then**: identical shape to AC-1 but with:
- Install command: `npm install -g openspec`
- Functional verify: `openspec --version` (fallback `openspec help` if --version is unsupported)
- Env vars: `MMD_AUTO_INSTALL_OPENSPEC=1`, `MMD_REQUIRE_OPENSPEC=1`

Tag: `@unit`.

### AC-3: Phase 7 (Ralph Loop) detection + install + verify

**Given** a machine where Ralph Loop plugin is not installed in Claude Code
**When** `bash install-mmd.sh .` runs and reaches Phase 7
**Then**:
- Detects absence via `claude plugin list 2>/dev/null | grep -q ralph-loop` (or equivalent — verify the actual claude plugin list command syntax exists in this Claude Code version)
- Offers install: `Install Ralph Loop plugin via 'claude plugin install ralph-loop'? [y/N]`
- If user accepts: runs install, re-runs the detection to verify
- If user declines: prints status + continues
- Env vars: `MMD_AUTO_INSTALL_RALPH_LOOP=1`, `MMD_REQUIRE_RALPH_LOOP=1`
- **Pre-check**: if `claude plugin list` itself errors (i.e., the Claude Code version is too old to support plugins), skip Phase 7 entirely with a clear message ("Ralph Loop needs Claude Code 2.1+ for plugin support. Skipping."), no error.

Tag: `@integration` with a fake `claude` script returning configurable plugin lists.

### AC-4: Final summary banner

**Given** `bash install-mmd.sh .` reaches the end
**When** all Phases 0-7 have run
**Then** the script prints a single summary block:

```
═══ Install summary ═══
  bun        ✓ present + functional (1.3.x)
  gStack     ✓ present + functional (gstack-config responded)
  BMAD       ✓ present + functional (adv module loaded)
  Spec Kit   ✓ present + functional (specify 1.x)
  OpenSpec   ⚠ NOT installed (user declined — re-run with MMD_AUTO_INSTALL_OPENSPEC=1)
  Ralph Loop ✓ present + functional (claude plugin list shows ralph-loop)
═════════════════════
```

Each status uses `✓` / `⚠` / `✗` markers + a short reason. The banner is rendered regardless of which Phases ran successfully (mix of present/absent is normal).

Tag: `@integration` with a fixture install run.

### AC-5: Documentation + ADR

**Given** v0.2.m ships
**When** the user reads `README.md` and `docs/adr/017-three-pillars-install-hardening.md`
**Then**:
- README's `## Install` section updates the prerequisites list mentioning that v0.2.m installer now handles all 5 pillars
- ADR-017 covers: why each pillar uses its native install method (not a custom installer), why functional verify over file-presence (consistency with v0.2.f), why the per-pillar env vars rather than a single `MMD_AUTO_INSTALL_ALL`, the rationale for the final summary banner (single glance at install state)
- `BOOTSTRAP.md` "Trust assumptions" subsection (added in v0.2.k) gets a line per new pillar mentioning its install URL

Tag: `@unit` for README/ADR/BOOTSTRAP anchor presence.

---

## 3. Architecture (incremental)

```
install-mmd.sh structure (modified):
  Phase 0 — bun                   (existing, v0.2.f)
  Phase 1 — Node detection         (existing)
  Phase 2 — Git                    (existing)
  Phase 3 — Claude Code CLI        (existing)
  Phase 4 — gStack                 (existing, v0.2.f)
  *** Phase 5 — Spec Kit  ***      (NEW)
  *** Phase 6 — OpenSpec  ***      (NEW)
  *** Phase 7 — Ralph Loop ***     (NEW)
  Phase 8 — BMAD core             (existing, was Phase 5)
  Phase 9 — adv module + workflow (existing, was Phase 6)
  Phase 10 — constitution         (existing, was Phase 7)
  *** Final summary banner ***     (NEW per AC-4)
```

### Files modified / added

```
make-my-dreams/
├── install-mmd.sh                              # modified — 3 new phases + summary
├── test/
│   ├── unit/
│   │   ├── install-mmd-spec-kit-phase.test.js  # NEW
│   │   ├── install-mmd-openspec-phase.test.js  # NEW
│   │   └── install-mmd-ralph-loop-phase.test.js # NEW
│   └── integration/
│       └── install-mmd-summary-banner.test.js   # NEW
├── BOOTSTRAP.md                                # modified — trust assumptions update
└── docs/adr/
    └── 017-three-pillars-install-hardening.md  # NEW
```

---

## 4. Out of scope for v0.2.m

- ❌ Pinning SHA-256 of install URLs (cso LOW-2 follow-up).
- ❌ Detecting alternative install methods per pillar.
- ❌ Cross-version compatibility matrices.
- ❌ A standalone `mmd doctor` subcommand (could be v0.2.m+).
- ❌ Runtime invocation of Spec Kit / OpenSpec / Ralph Loop from MMD (Heavy integration, future).

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation
1. Read SPEC_V02M.md (this file).
2. Read `install-mmd.sh` Phase 0 (bun) + Phase 4 (gStack) for the existing pattern.
3. **Verify actual install commands** for each pillar before coding:
   - Spec Kit: check https://github.com/github/spec-kit README for the install line
   - OpenSpec: check https://github.com/Fission-AI/OpenSpec README
   - Ralph Loop: check `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/` for any install hint, OR `claude plugin --help` for the install command syntax
4. If any pillar's install method changed since today, prefer the documented method over assumptions. If the install method is unclear, fall back to a graceful "Spec Kit / OpenSpec / Ralph Loop install path not yet wired — see <URL>" warning rather than blocking the installer.

### Key risks
- **`claude plugin list` syntax**: Claude Code versions vary. If the command doesn't exist or errors, Phase 7 must skip cleanly (not block install).
- **`uv` vs `pip` for Spec Kit**: uv may not be installed. Fallback to pip with a warning.
- **`npm install -g openspec` may need sudo**: warn explicitly if running as non-root + npm needs sudo. Don't sudo automatically.
- **Idempotency**: re-running install-mmd.sh after install must be a no-op (detection finds them present, skips install).

### Apply L-001..L-018 (and the just-promoted L-002/L-016 in ai-coding.md)
All standard. Particularly:
- **L-016**: launch with `MMD_TIMEOUT_MS=0` + spec-frozen.
- **L-019 prevention**: commit incrementally per AC.
- **L-015**: SPEC_V02M.md will be verified on base by v0.2.h's prompt-grounding check.

### Constitution module bindings
Active: universal, ai-coding (now includes promoted L-002/L-016), commit-git, testing, security (each curl|bash already documented per v0.2.k's BOOTSTRAP update), error-handling, documentation, observability.

---

## 6. Definition of done

v0.2.m is done when:

1. All 5 ACs met.
2. Full test suite passes (current 1003 + new tests, expected ~1030-1050).
3. Re-running `bash install-mmd.sh .` on this machine is idempotent + shows the final summary banner.
4. README + ADR-017 + BOOTSTRAP update in place.
5. Version bumped to `0.2.13`.
6. Slice merged + tag `v0.2.13`.
7. 12th reflexive use of `mmd --here`. Composer should match L-012 + L-009/L-018 with high confidence.

---

*Spec v0.2.m — generated 2026-05-30. L-012 fully closed: all 5 README pillars are installable + verifiable by the installer. 12th reflexive use of mmd --here.*
