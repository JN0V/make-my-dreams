# Make My Dreams — v0.2.f Spec: gStack effective (install hardening + `mmd ship` + audit-pillars)

> Per `docs/lessons-learned.md` L-012 — for 11 slices MMD claimed to stand on gStack while never invoking it. Root causes: (a) `install-mmd.sh` only *prompted* about gStack and *warned* about bun rather than installing+verifying both, (b) `bun` was in `~/.bashrc` but not in the `PATH` of non-interactive subprocesses (Claude `-p`, scripted invocations), and (c) `~/.claude/skills/gstack/ship/` exists but no MMD code path ever called it. v0.2.f closes the gap on three axes simultaneously: install hardening (so a fresh MMD install actually has working gStack), an `mmd ship` wrapper that invokes the gStack `ship` skill end-to-end (so at least one gStack skill is used in production), and a `scripts/audit-pillars.sh` that prevents the L-012 drift from recurring silently (every release lists which pillars were and were not invoked). Pre-implementation probe (`/tmp/gstack-smoke.log`, 2026-05-17) confirmed: `claude -p` with `PATH=$HOME/.bun/bin:$PATH` can invoke the gStack `ship` skill and read its 20-step workflow cleanly.

---

## 1. Goal of v0.2.f

Deliver three coordinated changes that turn gStack from a documentation claim into a runtime reality:

1. **Install hardening** — `install-mmd.sh` becomes idempotent and functional-test-based: bun, gStack, and BMAD are installed if absent AND verified to *respond* (not just "the folder exists"). If any pillar fails its functional check, the installer exits non-zero with a clear remediation message.
2. **`mmd ship`** — a new subcommand `mmd ship [<slice-branch>]` that invokes the gStack `ship` skill via `claude -p` with the right `PATH`. Replaces the manual `git merge --ff-only && git tag && git push --tags && git push --tags` chain that has been used for v0.1.0 → v0.2.2 releases. Provides much richer behavior: merge-base-before-tests, semver bump from diff, CHANGELOG auto-update, squash WIP commits, push, PR creation, analytics persist.
3. **`scripts/audit-pillars.sh`** — closure of L-012: for each "pillar" claimed in README's "stands on the shoulders of" list, grep the slice's commits for invocation patterns and report `INVOKED` / `NOT INVOKED`. Run automatically before tagging and emit a warning (not a hard fail) if any claimed pillar was never invoked in the slice.

**Why this version exists**: per L-012, "silent indefinite deferral is a documentation defect." This slice is the operational answer — make pillar claims testable and the workflow honest.

**Mission validation**: after v0.2.f, three things must be true on a freshly-cloned + freshly-installed MMD:
- `which bun && bun --version` works in any subprocess spawned from `mmd`
- `mmd ship` on a feature branch successfully invokes the gStack ship skill and produces a merged + tagged + pushed result (real-world test: a tiny doc-only branch like the L-013 capture)
- `scripts/audit-pillars.sh` run against any slice tells you which of {Spec Kit, OpenSpec, BMAD, gStack, Ralph Loop} were actually invoked

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: install-mmd.sh installs + verifies bun functionally

**Given** a machine where `bun` is NOT in `PATH` (or not installed at all)
**When** the user runs `bash install-mmd.sh .` from the MMD repo
**Then** the script:
- Detects bun absence via `command -v bun` (NOT just "is `~/.bun/bin/bun` a file?")
- Offers to install bun automatically via `curl -fsSL https://bun.sh/install | bash` (with a 5-line summary of what it does + a `y/N` prompt, default N; `MMD_AUTO_INSTALL_BUN=1` env var skips the prompt and proceeds)
- After install, verifies `~/.bun/bin/bun --version` succeeds (functional check, not file presence)
- Adds bun to MMD-spawned subprocess `PATH` by writing a small shim: `bin/mmd` wrapper script that exports `PATH="$HOME/.bun/bin:$PATH"` before invoking `node bin/mmd.js`. The shim replaces the current `package.json` `bin` entry that points directly to `bin/mmd.js`. (Backward-compatible: direct `node bin/mmd.js` invocations still work; the shim only matters for the installed `mmd` command.)
- If user declines and `MMD_REQUIRE_GSTACK=1` is set, exits 1 with: `bun is required for gStack integration (v0.2.f). Re-run with --yes or install bun manually.`

Tag: `@unit` for shim PATH logic, `@integration` (skipped on systems where bun is already installed to keep CI fast) for the install path with a bun-uninstall fixture.

### AC-2: install-mmd.sh installs + verifies gStack functionally

**Given** the user runs `bash install-mmd.sh .`
**When** the script reaches Phase 4 (gStack)
**Then**:
- If `~/.claude/skills/gstack/` is absent → offer to install via the documented gStack curl command + `y/N` prompt (or `MMD_AUTO_INSTALL_GSTACK=1`).
- If `~/.claude/skills/gstack/` IS present, run a functional check: `PATH=$HOME/.bun/bin:$PATH ~/.claude/skills/gstack/bin/gstack-config get proactive` MUST succeed and produce output. If it fails → print remediation (likely `bun install` inside gStack dir, or upgrade) and exit 2.
- The Phase 4 banner explicitly prints: `gStack: present + functional (gstack-config responded)` or `gStack: NOT installed` or `gStack: PRESENT BUT BROKEN — see below`.

Tag: `@integration` with a fixture that fakes a broken gStack install (stubs the binary).

### AC-3: `mmd ship` subcommand recognized

**Given** MMD v0.2.f installed
**When** the user runs `mmd ship`, `mmd ship <branch>`, `mmd ship --dry-run`, or `mmd ship --help`
**Then** the CLI:
- Routes to the ship handler (NOT the dream-creation path).
- `mmd ship --help` prints usage including: subcommand description, `--dry-run`, `[<branch>]` (default current branch).
- `mmd ship` without `<branch>` argument uses `git branch --show-current` (refuse if cwd is not a git repo: exit 3).
- `mmd ship --dry-run` always works (per below), no env-var gate needed.
- Bare `mmd ship` (no flag) refuses unless the user is on a non-protected branch (`slice/*`, `feat/*`, `fix/*`, `docs/*`, `chore/*` allowed; `main`/`master` blocked) — exit 4 with explanation.

Tag: `@unit` for routing + branch protection check, `@integration` for `--help`.

### AC-4: `mmd ship` invokes gStack ship skill via `claude -p`

**Given** the user is on a clean slice branch with commits ahead of `main`
**When** the user runs `mmd ship`
**Then** the CLI:
- Builds a prompt that names the slice branch, base branch, current SHA, and asks Claude to "invoke the gstack ship skill" on this branch end-to-end.
- Spawns `claude -p --output-format text "<prompt>"` with `env.PATH = "$HOME/.bun/bin:" + process.env.PATH` (forced PATH so the skill's preamble works in non-interactive contexts).
- Tees stdout/stderr to `.mmd/local/ship-runs/<timestamp>.log`.
- Returns exit code 0 on subprocess success, the subprocess's exit code otherwise.
- After completion, prints a summary: branch shipped, base merged, tests run (if any), tag created (if any), PR URL (if any).

Tag: `@integration` with a fake-claude fixture that simulates the skill's structured output, asserts the env vars were set + the prompt contains the expected anchors.

### AC-5: `mmd ship --dry-run` validates the wiring without invoking claude

**Given** the user wants to confirm `mmd ship` is wired correctly before spending tokens
**When** the user runs `mmd ship --dry-run` on any branch
**Then** the CLI:
- Performs all pre-checks (git repo, branch, clean tree)
- Builds the exact prompt that would be sent to `claude -p`
- Prints the prompt + the env vars + the planned subprocess command
- Does NOT spawn `claude` — exit 0 if all pre-checks passed, non-zero otherwise

Tag: `@unit` for prompt building, `@integration` for end-to-end dry-run with fixture git repos.

### AC-6: `scripts/audit-pillars.sh` reports pillar invocations per slice

**Given** v0.2.f ships
**When** the user runs `scripts/audit-pillars.sh [<base-branch>]` (default `main`)
**Then** the script:
- Reads `README.md`'s pillar list (Spec Kit, OpenSpec, BMAD, gStack, Ralph Loop — and any future additions)
- For each commit between `<base>..HEAD`, greps the diff + commit message for known invocation patterns per pillar (definitions in `scripts/audit-pillars.patterns.json`)
- Prints a table: `PILLAR | INVOKED (count) | LAST_COMMIT | NOTES`
- Returns exit 0 always (advisory, not gating) — exit code can become non-zero in a future version (v0.2.f+) if MMD wants to enforce
- If invoked with `--ci` flag, returns exit 1 if any claimed pillar has `count=0` — for opt-in CI usage

Tag: `@unit` for the patterns + counting logic (pure function), `@integration` with a fixture-repo containing known invocations.

### AC-7: Auto-invoke audit-pillars in `mmd ship` flow

**Given** `mmd ship` completes successfully and creates a tag
**When** the ship handler finishes
**Then** the CLI:
- Runs `scripts/audit-pillars.sh main..<just-shipped-branch>` automatically
- Includes the audit output in the ship summary print
- Does NOT block the ship on advisory warnings (the audit is informative — a hard gate would risk breaking emergency ships)

This is the operational L-012 closure: the audit ALWAYS runs at release time, surfaces non-invocations explicitly, but does not block.

Tag: `@integration` end-to-end with fake-claude + fixture repo.

### AC-8: Documentation + ADR

**Given** v0.2.f ships
**When** the user reads `README.md` and `docs/adr/007-gstack-effective-via-ship-subcommand.md`
**Then**:
- README has `### Ship mode (mmd ship)` subsection in `## Usage`, explaining: prerequisites (bun + gStack functional, both installed by install-mmd.sh as of v0.2.f), what the ship skill does (5-line summary), expected exit codes, link to gStack's own docs for deeper info
- README also gets a note in `### Install`: "v0.2.f's installer now installs bun + gStack functionally (verifies they respond, not just present) — see `install-mmd.sh` for details."
- ADR-007 covers: why a `mmd ship` wrapper rather than just telling users to invoke claude directly (uniform UX + enforced PATH + audit hook), why the install becomes mandatory-functional for gStack (L-012 demands functional verification, not file existence), why `audit-pillars.sh` is advisory not gating (avoid breaking emergency releases)
- `MAKE_MY_DREAMS.md` §3 (engines / orchestration section) gets a paragraph noting v0.2.f delivered the first real gStack invocation in production with `<sha>` and `<date>`

Tag: `@unit` for README anchor presence.

---

## 3. Architecture (incremental)

```
mmd ship [<branch>] [--dry-run]
   │
   ▼
[0] argv parser — recognizes 'ship' as a subcommand (early branch, like 'bench')
   │
   ▼
[1] Validate cwd is git repo, branch is non-protected, working tree state per AC-3
   │
   ▼
[2] Build the ship prompt (slice branch, base, SHA, project context anchors)
   │
   ▼
[3] If --dry-run: print prompt + env + planned command, exit 0
   Else: spawn `claude -p --output-format text` with env.PATH forced to include ~/.bun/bin
   │
   ▼
[4] Tee subprocess output to .mmd/local/ship-runs/<ts>.log
   │
   ▼
[5] After exit: run scripts/audit-pillars.sh main..<branch>, include in summary
   │
   ▼
[6] Print summary + exit with subprocess code
```

### Project structure (additions only)

```
make-my-dreams/
├── install-mmd.sh                       # modified — Phase 0 adds bun functional install, Phase 4 adds gStack functional verify
├── bin/
│   ├── mmd                              # NEW — shell shim exporting PATH=~/.bun/bin then invoking node bin/mmd.js
│   └── mmd.js                           # modified — 'ship' subcommand dispatch
├── lib/
│   ├── ship/
│   │   ├── build-prompt.js              # NEW — prompt construction (pure)
│   │   ├── validate-branch.js           # NEW — git checks (cwd is repo, branch protection, clean tree)
│   │   ├── invoke-claude.js             # NEW — claude -p subprocess with forced PATH
│   │   └── summary.js                   # NEW — final summary formatting (pure)
│   └── argv-parser.js                   # modified — recognize 'ship' subcommand
├── scripts/
│   ├── audit-pillars.sh                 # NEW — bash audit script
│   └── audit-pillars.patterns.json      # NEW — invocation pattern definitions per pillar
├── test/
│   ├── unit/
│   │   ├── ship-build-prompt.test.js    # NEW
│   │   ├── ship-validate-branch.test.js # NEW
│   │   ├── ship-summary.test.js         # NEW
│   │   ├── audit-pillars.test.js        # NEW — unit-tests the bash logic via fixture commits
│   │   └── argv-parser.test.js          # modified
│   └── integration/
│       ├── ship-dry-run.test.js         # NEW — end-to-end dry-run with fixture git repo
│       ├── ship-fake-claude.test.js     # NEW — full flow with fake-claude fixture
│       └── install-mmd.test.js          # modified — adds functional gStack/bun verification cases
└── docs/adr/
    └── 007-gstack-effective-via-ship-subcommand.md  # NEW
```

---

## 4. Out of scope for v0.2.f

- ❌ No automatic install of Spec Kit, OpenSpec, Ralph Loop. v0.2.f deliberately scopes "install hardening" to bun + gStack + BMAD (the three with installer phases today). Spec Kit / OpenSpec / Ralph Loop join in v0.2.f+.
- ❌ No medium / heavy gStack integration from L-012 (no `/qa`, `/cso` etc. wired into auto-dev). v0.2.f is the LIGHT option only — `ship` skill is the first invocation; others land in later slices.
- ❌ No replacement of auto-dev with gStack's own Review Army. Auto-dev stays as the engine; `mmd ship` is post-build.
- ❌ No removal of the manual `git merge --ff-only` path. `mmd ship` is additive; users can still merge by hand.
- ❌ No CI integration for `audit-pillars.sh --ci` mode. The script supports the flag; wiring into GitHub Actions is v0.2.f+.

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation checks (DO THESE FIRST)

Before writing any code, the implementing agent MUST:

1. Verify bun is on PATH or installable: `command -v bun || ls $HOME/.bun/bin/bun`. If neither, the agent cannot validate AC-1 — skip live install but still write the AC-1 logic + tests with fixtures.
2. Verify gStack ship skill is readable: `ls ~/.claude/skills/gstack/ship/SKILL.md`. If absent, AC-4 cannot be smoke-tested live; the agent should fake-fixture the skill response.
3. Verify the probe log from 2026-05-17 still exists: `ls /tmp/gstack-smoke.log` — if so, read the last line, expect `SHIP-SKILL-PROBE-OK`. This is the evidence that the design is feasible.

### Key risks to handle

- **PATH inheritance in `npm install -g .`**: when `mmd` is installed globally via npm, the shebang of `bin/mmd.js` is `#!/usr/bin/env node`. The shim `bin/mmd` (no `.js`) must be a bash script with `#!/usr/bin/env bash`, exporting PATH then `exec node "$(dirname "$0")/mmd.js" "$@"`. Update `package.json` `bin` to point to `bin/mmd` (no extension) so npm symlinks the shim, not the JS.
- **Backward compatibility**: `node bin/mmd.js <args>` (direct invocation, used in tests) must still work without the shim — the JS is the source of truth, the shim only fixes the global-install PATH.
- **`claude -p` exit code semantics**: per L-006, `claude -p` can stay sleeping forever even after work is done; per the recent v0.2b experience, it can also exit with code null after completing. `mmd ship` should treat both as "subprocess weirdness" — log the exit code, but still run audit-pillars + print summary as long as the git state looks consistent (tag exists, branch merged).
- **Idempotency of install-mmd.sh**: re-running should be safe — every install step must be `if absent → install; verify either way`.
- **audit-pillars.patterns.json schema**: keep it simple but versioned. v1: `{ "version": 1, "pillars": [{ "name": "gStack", "patterns": ["~/.claude/skills/gstack/", "/ship", "/qa", "/cso", "/document-release"], "negative_patterns": [] }, ... ] }`. Match by regex over diff + commit message.

### Apply lessons L-001..L-012

- **L-001**: launch via `setsid bash -c "..." &`, never nohup.
- **L-002**: monitor via `git log slice/v0.2f-... --oneline` + file mtimes, not log tail.
- **L-003**: while auto-dev runs in main worktree, use `git worktree add ../mmd-side` for side work.
- **L-004**: explicitly verify Definition of Done after auto-dev exits.
- **L-005 + L-007**: NO hardcoded version strings or slug paths in tests — read from package.json / call slug function.
- **L-006**: `pgrep -af "claude -p"` before launching; defensive cleanup of zombies.
- **L-008**: never `git branch -d` on warning; verify merge first.
- **L-009 + L-012 (THIS spec's origin)**: distinguish design from implementation; ship the functional evidence not just the intent.
- **L-010 + L-011**: this slice is the **third** reflexive use of `mmd --here` (after L-010 trivial + L-011 v0.2b real). Capture L-013 if anything new surfaces; otherwise add the third data point to the running record.

### Constitution module bindings

Active during this work:
- `universal.md`, `ai-coding.md` (always)
- `commit-git.md` (slice workflow)
- `testing.md` (red-green; @unit first, then @integration)
- `security.md` (subprocess invocation with elevated PATH, env vars, secrets handling)
- `error-handling.md` (exit codes 0/2/3/4 with clear messages)
- `documentation.md` (README + ADR-007 + scoping update + audit-pillars patterns docs)
- `observability.md` (ship-runs logs, audit-pillars output, summary print)
- `brownfield.md` (modifying install-mmd.sh + adding subcommand to existing CLI)

---

## 6. Definition of done

v0.2.f is done when:

1. All 8 ACs met.
2. Full test suite passes (current 330 + new tests, expected 360-390).
3. `mmd ship --dry-run` on a fixture branch prints a coherent prompt + env + command in under 5 s.
4. README updated: `### Ship mode (mmd ship)` subsection + install note.
5. ADR-007 written.
6. `MAKE_MY_DREAMS.md` §3 paragraph + a sentence in §7 noting v0.2.f's gStack-effective milestone.
7. Version bumped to `0.2.3` (`mmd --version` returns `0.2.3`).
8. `install-mmd.sh` re-run on a fresh checkout idempotently succeeds; bun + gStack functional checks pass.
9. Slice merged to main via `mmd ship` itself (acid test: ship uses ship) — or fall back to manual merge with a captured lesson if that fails.
10. Tag `v0.2.3` created (by `mmd ship` if AC succeeded, else manually).
11. `scripts/audit-pillars.sh main..HEAD` reports `gStack: INVOKED (≥1)` after the slice merges — that single positive count is L-012's operational closure.
12. New lesson(s) captured in `docs/lessons-learned.md` if any failure surfaces during the v0.2.f development itself (red-green rule).

---

*Spec v0.2.f — generated 2026-05-17 from L-012 + the gStack ship probe (SHIP-SKILL-PROBE-OK). To be implemented via `mmd --here` on `slice/here-implement-v0-2-f-...`. Third reflexive use of the supported workflow after L-010 + L-011 — and the first slice that, by design, invokes a non-BMAD pillar.*
