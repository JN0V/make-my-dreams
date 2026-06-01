# Make My Dreams — v0.2.g Spec: Medium gStack — `mmd qa` + `mmd cso` + `mmd document-release`

> Per `docs/lessons-learned.md` L-012 — v0.2.f (Light option) wired `mmd ship` to the gStack `ship` skill, proving the integration mechanism works. Now we close more of L-012 by adding three more gStack-skill wrappers, each modeled on `mmd ship`: `mmd qa` (test stratification + adversarial review), `mmd cso` (security review per Bundle A), `mmd document-release` (auto-generated release notes from commit history). Same architecture as `mmd ship`: thin CLI wrapper → `claude -p` with PATH forced to include `~/.bun/bin` → invokes the named gStack skill end-to-end. The walking skeleton from v0.2.f's `lib/ship/*` becomes a reusable pattern: `lib/skills/<skill-name>/{build-prompt,invoke-claude,summary,validate-input}.js`. v0.2.g is the slice that moves L-012 from "1 of 41 gStack skills invoked" to "4 of 41" — still not exhaustive, but the *pattern* for adding the remaining ones becomes a 1-day per-skill exercise, not a design exercise.

---

## 1. Goal of v0.2.g

Deliver three new subcommands, all modeled on `mmd ship` (v0.2.3):

1. **`mmd qa [<branch>]`** — invokes the gStack `qa` skill (test stratification, classifying failures T1-T4, running adversarial test pass). Default target: current branch's diff vs `main`.
2. **`mmd cso [<branch>]`** — invokes the gStack `cso` skill (Chief Security Officer review per Bundle A: secret scanning, dependency audit, lethal trifecta check, sandbox config validation).
3. **`mmd document-release [<from-tag>] [<to-tag>]`** — invokes the gStack `document-release` skill (auto-generates release notes from commits + ADRs + lessons-learned diff between tags). Default: last tag → HEAD.

All three:
- Use the **exact same architecture** as `mmd ship` (per v0.2.f): early-branch in argv parser → validate inputs → build prompt → spawn `claude -p` with `PATH=$HOME/.bun/bin:$PATH` forced → tee to `.mmd/local/<skill>-runs/<ts>.log` → print summary.
- Refactor v0.2.f's `lib/ship/*` into a reusable `lib/skills/<skill-name>/*` layout BEFORE adding the new three — this is the value-add beyond just copy-paste.
- Run the gStack skill skill end-to-end (not a partial / stub).
- Include `--dry-run` mode for each.

**Why this version exists**: L-012 closure is incremental. v0.2.f proved one skill. v0.2.g extends to three more skills + extracts the pattern. After v0.2.g, adding a 5th skill (e.g., `/context-save`, `/context-restore`, `/freeze`, etc.) becomes a 1-hour exercise rather than a 1-week one.

**Mission validation**: after v0.2.g, the user can run on any branch:
- `mmd qa` → gStack does a full test classification (T1 in-branch / T2 pre-existing flake / T3 infra / T4 obsolete-deleted-spec) + suggests fixes
- `mmd cso` → gStack reports security findings against Bundle A
- `mmd document-release v0.2.3 v0.2.4` → gStack outputs release notes draft

The `audit-pillars.sh` script will then report gStack invocations from 1 to 4 skill names, showing the L-012 gap shrinking concretely.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: Refactor v0.2.f `lib/ship/` into generic `lib/skills/<name>/`

**Given** v0.2.f's `lib/ship/{build-prompt,invoke-claude,validate-branch,summary}.js` exist
**When** the v0.2.g refactor runs
**Then**:
- Files moved to `lib/skills/ship/*` (same names, semantically identical content).
- A new `lib/skills/_common/invoke-claude.js` extracts the shared `claude -p` spawn logic (PATH forcing, tee, race-safe log stream finish per the v0.2.f race fix).
- `lib/skills/ship/invoke-claude.js` becomes a thin wrapper over `_common/invoke-claude.js` parameterized by skill name and prompt.
- `bin/ship.js` is renamed to `bin/skills/ship.js` and imports adjust.
- ALL v0.2.f tests still pass after the refactor (regression bar).
- `mmd ship --help` output unchanged.

Tag: `@unit` for the move-with-fidelity (each helper produces identical output for identical input). `@integration` for `mmd ship --help` regression.

### AC-2: `mmd qa` subcommand

**Given** v0.2.g installed
**When** the user runs `mmd qa`, `mmd qa <branch>`, `mmd qa --dry-run`, `mmd qa --help`
**Then**:
- Routes to `lib/skills/qa/*` via the parameterized common layer.
- `mmd qa --help` describes: gStack qa skill invocation, default target = current branch's diff vs main, output goes to `.mmd/local/qa-runs/<ts>.log`, expected wall-clock 5-20 min.
- `mmd qa --dry-run` prints prompt + env + planned command without spawning claude.
- `mmd qa` spawns `claude -p` with the qa skill prompt (built from skill path `~/.claude/skills/gstack/qa/SKILL.md`).
- Returns subprocess exit code.

Tag: `@unit` for prompt building + validate-input. `@integration` for `--dry-run` end-to-end and one fake-claude run.

### AC-3: `mmd cso` subcommand

**Given** v0.2.g installed
**When** the user runs `mmd cso`, `mmd cso <branch>`, `mmd cso --dry-run`, `mmd cso --help`
**Then**: identical shape to AC-2 but invoking the gStack `cso` skill (`~/.claude/skills/gstack/cso/SKILL.md`). Output to `.mmd/local/cso-runs/`. Tag: same.

### AC-4: `mmd document-release` subcommand

**Given** v0.2.g installed
**When** the user runs `mmd document-release [<from>] [<to>]`, `mmd document-release --dry-run`, `mmd document-release --help`
**Then**:
- Default `<from>` = last tag (auto-detected via `git describe --tags --abbrev=0`); default `<to>` = HEAD.
- Validates `<from>` and `<to>` are real refs (exit 4 if not).
- Invokes the gStack `document-release` skill with both refs in the prompt.
- Skill writes its output to `.mmd/local/document-release-runs/<ts>.md` (markdown file the user can copy/edit).
- Prints the path of the generated draft + a 1-line summary.

Tag: `@unit` for ref validation (mocked git). `@integration` for dry-run with two valid refs in a fixture repo.

### AC-5: Validation gate compatibility

**Given** the target dir has a PENDING discovery report (post v0.2c)
**When** the user runs `mmd qa`, `mmd cso`, or `mmd document-release`
**Then**: these subcommands do NOT trigger the discovery gate. Rationale: they're read-only / advisory (qa runs tests, cso reviews diff, document-release reads commits). The gate applies to dev commands that MODIFY code (`mmd --here`, `mmd <dream>`).

Tag: `@unit` for the gate-bypass logic.

### AC-6: All four skills reachable + report in audit-pillars

**Given** v0.2.g landed
**When** the user runs `scripts/audit-pillars.sh main..HEAD` on the v0.2.g slice
**Then** the gStack INVOKED count reflects multiple skill names (ship + qa + cso + document-release), not just `/ship`. The patterns.json schema may need expansion to track per-skill counts rather than a single gStack global — bump to `version: 2` of the schema additively if needed.

Also: `mmd qa --help | grep -c gstack`, `mmd cso --help | grep -c gstack`, `mmd document-release --help | grep -c gstack` all return ≥1.

Tag: `@integration` end-to-end audit on the slice.

### AC-7: Documentation + ADR

**Given** v0.2.g ships
**When** the user reads `README.md` and `docs/adr/009-medium-gstack-integration-pattern.md`
**Then**:
- README has `### QA mode (mmd qa)`, `### CSO mode (mmd cso)`, `### Release notes (mmd document-release)` subsections (or a unified `### Other gStack skill wrappers` covering all three).
- ADR-009 covers: why we extracted a `lib/skills/<name>/` pattern after `mmd ship` rather than copy-pasting (DRY + future skills easy to add), why the validation gate does NOT block these read-only commands (UX — don't block legit non-modifying inspection), why we did NOT do the `/qa /cso` skills inside auto-dev's pipeline (Heavy option deferred — still v0.5+).
- `MAKE_MY_DREAMS.md` §3.1 (Medium option from L-012) gets a paragraph noting v0.2.g delivered the Medium walking skeleton.

Tag: `@unit` for README anchor presence.

---

## 3. Architecture (incremental)

```
bin/skills/{ship,qa,cso,document-release}.js  ← each is a thin coordinator
   │
   ▼
lib/skills/<name>/build-prompt.js              ← skill-specific prompt
lib/skills/<name>/validate-input.js            ← skill-specific pre-checks
lib/skills/<name>/summary.js                   ← skill-specific summary formatter
   │
   ▼
lib/skills/_common/invoke-claude.js            ← shared spawn + PATH + tee + race-safe finish
```

### Project structure (additions only, after refactor)

```
make-my-dreams/
├── bin/
│   ├── mmd.js                                  # modified — dispatch qa/cso/document-release subcommands
│   └── skills/
│       ├── ship.js                             # MOVED from bin/ship.js
│       ├── qa.js                               # NEW
│       ├── cso.js                              # NEW
│       └── document-release.js                 # NEW
├── lib/
│   └── skills/
│       ├── _common/
│       │   └── invoke-claude.js                # NEW — extracted from lib/ship/invoke-claude.js
│       ├── ship/                               # MOVED from lib/ship/
│       │   ├── build-prompt.js
│       │   ├── validate-branch.js
│       │   ├── summary.js
│       │   └── invoke-claude.js                # NOW wraps _common
│       ├── qa/{build-prompt,validate-input,summary,invoke-claude}.js   # NEW
│       ├── cso/{build-prompt,validate-input,summary,invoke-claude}.js  # NEW
│       └── document-release/{build-prompt,validate-input,summary,invoke-claude}.js  # NEW
├── test/
│   ├── unit/
│   │   ├── skills-common-invoke-claude.test.js   # NEW
│   │   ├── skills-qa-build-prompt.test.js        # NEW
│   │   ├── skills-cso-build-prompt.test.js       # NEW
│   │   ├── skills-document-release-build-prompt.test.js  # NEW
│   │   └── (existing ship tests moved + updated import paths)
│   └── integration/
│       ├── qa-dry-run.test.js                    # NEW
│       ├── cso-dry-run.test.js                   # NEW
│       └── document-release-dry-run.test.js      # NEW
├── scripts/
│   └── audit-pillars.patterns.json               # modified — per-skill counts
└── docs/adr/
    └── 009-medium-gstack-integration-pattern.md  # NEW
```

---

## 4. Out of scope for v0.2.g

- ❌ Heavy gStack (folding `/qa`, `/cso` INSIDE auto-dev's pipeline). Still v0.5+.
- ❌ Wrappers for the remaining 37 gStack skills. The pattern is in place; adding more is incremental.
- ❌ Skill version compatibility checks. v0.2.g assumes the user has a compatible gStack install (v0.2.f's `install-mmd.sh` Phase 4 already verifies functional gStack).
- ❌ Composition of skills (`mmd qa && mmd cso && mmd ship`). User can do this with `&&` in shell; orchestration is a Conductor concern (v0.5+).
- ❌ Auto-trigger of `mmd qa` after `mmd --here`. Out of scope; the user explicitly invokes.

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation: refactor before extending

The refactor (AC-1) MUST be done first as its own atomic commit. Then the three new subcommands added in parallel. Then docs + ADR. This ordering:
- Keeps the diff readable
- Lets the refactor be reverted if it surfaces a regression, without losing the new subcommands' work
- Makes the test suite green after each step

### Key risks to handle

- **Refactor regression**: `mmd ship --help` output must be byte-identical pre/post refactor. Add a snapshot test asserting this.
- **PATH inheritance**: same trap as v0.2.f. The `_common/invoke-claude.js` MUST force `env.PATH = $HOME/.bun/bin:` + parentEnv.PATH or the gStack skills' preambles fail (their preamble calls `gstack-config` which needs bun).
- **Race fix preserved**: v0.2.f had a race fix on log stream finish (commit a9d6011). The `_common` extraction MUST preserve that pattern — add a test for the race condition.
- **Validation gate bypass**: AC-5 says these read-only commands skip the gate. Implement this as an opt-in property in each skill's module (`skipDiscoveryGate: true`) rather than special-casing in bin/mmd.js.
- **Skill SKILL.md path resolution**: hardcode `~/.claude/skills/gstack/<name>/SKILL.md` in each build-prompt, but expose an env var override `MMD_GSTACK_SKILLS_DIR` for testing with fake skills.

### Apply lessons L-001..L-014

All standard. The v0.2.f race-fix (L-013 area) is particularly important — preserve it in the extracted common layer.

### Constitution module bindings

Same as v0.2.f. Active: universal, ai-coding, commit-git, testing, security, error-handling, documentation, observability, brownfield (since `mmd cso`'s output IS the Bundle A audit running on the target).

---

## 6. Definition of done

v0.2.g is done when:

1. All 7 ACs met.
2. Full test suite passes (current 430 + v0.2c's additions + v0.2.g's, expected ~550-600 total).
3. `mmd ship --help` is byte-identical pre/post refactor (snapshot test).
4. `mmd qa --dry-run`, `mmd cso --dry-run`, `mmd document-release --dry-run` all return exit 0 in <5s each.
5. README updated with new subsections.
6. ADR-009 written.
7. `MAKE_MY_DREAMS.md` §3.1 Medium-option paragraph updated.
8. Version bumped to `0.2.5b` or `0.2.5` (the existing `v0.2.5` tag is for mmd serve; v0.2.g lands as `0.2.5b` or we re-tag — auto-dev decides via semver from diff per gStack ship's logic). **Note for auto-dev**: prefer `0.2.5b` to avoid colliding with the existing `v0.2.5` tag from earlier mmd serve work; or bump to `0.2.6` if `0.2.5b` is awkward.
9. Slice merged to main via `mmd ship` (second use of mmd ship — first was v0.2c if that one used it, else v0.2.g is first real-world `mmd ship` invocation).
10. `scripts/audit-pillars.sh` reports gStack invocations for ≥2 distinct skills (ship + at least one new one).
11. L-016 captured if any failure surfaces.

---

*Spec v0.2.g — generated 2026-05-17 alongside v0.2c launch. Fifth reflexive use of mmd --here (after L-010/L-011/L-013/L-015). Closes more of L-012 by going from 1 gStack skill in production to 4, AND extracts the reusable pattern so future skills are 1-hour additions.*
