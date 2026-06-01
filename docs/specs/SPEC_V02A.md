# Make My Dreams — v0.2a Spec: `--here` mode (self / brownfield-in-place)

> Per `docs/lessons-learned.md` L-009 + scoping `MAKE_MY_DREAMS.md` §7 (reflexive bootstrap) — the `mmd <dream>` wrapper currently scaffolds an external PWA under `demo/<slug>/`. This forecloses MMD's stated design intent: **MMD must be able to operate on any project, including itself**. v0.2a closes that gap by introducing an explicit `--here` flag that asks auto-dev to modify the **current working directory** (a git repo) instead of scaffolding a fresh demo. This is the missing piece for §7 to be honest in practice: with v0.2a I (or any user) can run `mmd --here "<change>"` from inside the MMD repo and watch MMD develop MMD via its own wrapper. v0.2a is a short slice — small surface, small risk, large symbolic + practical payoff.

---

## 1. Goal of v0.2a

Deliver an `mmd --here "<change>"` invocation that:

1. Accepts the same `<dream>` natural-language argument as `mmd "<dream>"`, but interprets it as **a change to apply to the current repo**, not a brief for a new PWA.
2. Refuses to run unless `cwd` is a clean git repo (no uncommitted changes, no untracked files outside `.gitignore`).
3. Creates and switches to a **slice branch** automatically (auto-generated name: `slice/here-<slug>-<timestamp>`), so `main` is never modified directly.
4. Invokes the **Standard engine (auto-dev)** with a prompt that explicitly tells it to **modify files in place**, not to scaffold a new `demo/<slug>/` tree.
5. Writes state files to `.mmd/shared/` in the cwd repo (which, in self-mode, IS the MMD repo itself).
6. Leaves the merge to `main` as an **explicit human gate** — never auto-merges, never auto-deletes the slice branch.

**Why this version exists**: per L-009, the walking-skeleton scope (greenfield-only) silently capped the reflexive bootstrap §7. Without `--here`, the only way to "use MMD on MMD" is to bypass the wrapper and call `claude /bmad-adv-auto-dev` manually — which is exactly what I have been doing in v0.2.5 and v0.2. v0.2a makes the supported path real.

**Mission validation**: after v0.2a, `cd ~/Documents/make-my-dreams && mmd --here "add a banner at the top of README.md that links to BOOTSTRAP.md"` produces a slice branch with the README edited, status.json populated, all tests still green, ready for human review + merge. No `demo/<slug>/` directory is created. Then a more interesting dogfood: `mmd --here "implement the minimal lessons-learned composer (read docs/lessons-learned.md, match keywords against the dream, return matched lessons to inject)"` produces a real internal feature.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `--here` flag is recognized

**Given** MMD v0.2a installed (`npm install -g .`)
**When** the user runs `mmd --here "any change"` or `mmd "any change" --here`
**Then** the CLI:
- Parses `--here` correctly regardless of position (POSIX-style flag, per argv-parser from v0.2)
- Records `mode: "here"` in `.mmd/shared/status.json` from the start, alongside `target_dir: "<cwd absolute path>"`
- Prints `Mode: --here (modifying current repo: <cwd>)` after parsing
- Proceeds with the in-place pipeline (AC-3 onwards) — does NOT create `demo/<slug>/`

Without `--here`, behavior is unchanged from v0.2 (greenfield: creates `demo/<slug>/`).

Tag: `@unit` for flag parsing, `@integration` for end-to-end.

### AC-2: `--here` mutually exclusive with conflicting flags + target validation

**Given** v0.2a defines `--here`
**When** the user passes:
- `--here` with `--standard` / `--deep` → allowed (engine flags compose with mode flags)
- `--here` with another mode flag (none exist yet, but reserved: `--target <path>` future) → exit code 2 with a clear message
- `--here` outside any git repo → exit code 3, message: `--here requires the current directory to be a git repository (run \`git init\` first or cd into one)`
- `--here` in a git repo with uncommitted changes or untracked non-ignored files → exit code 4, message: `--here requires a clean working tree (commit, stash, or .gitignore your changes first)`. The check uses `git status --porcelain=v1` and fails if output is non-empty.
- `--here` in a worktree currently on a protected branch (default: `main`, `master`, configurable via `MMD_HERE_PROTECTED_BRANCHES`) → does NOT fail; instead auto-creates the slice branch (AC-3).

Tag: `@unit` for argv-level mutex, `@integration` for git-state validation with fixture repos under `test/fixtures/here-repos/`.

### AC-3: Slice branch auto-creation and enforcement

**Given** the user passes `--here` in a clean git repo
**When** the CLI proceeds before invoking auto-dev
**Then** the CLI:
- Generates a slice branch name: `slice/here-<dream-slug>-<unix-timestamp>` (timestamp avoids collision on re-runs)
- Runs `git checkout -b <slice-branch>` from the current HEAD
- Records the slice branch name in `status.json.slice_branch`
- Passes the slice branch name to the auto-dev prompt so the agent stays on it
- If `git checkout -b` fails (branch exists, or git error), the CLI exits with code 5 and prints the underlying git error verbatim
- After auto-dev finishes (success OR failure), the CLI does NOT switch back to `main` and does NOT merge. The user is left on the slice branch for review.

Tag: `@integration` with a fake-autodev fixture that verifies the current branch when invoked.

### AC-4: Prompt adaptation for self-modification

**Given** the CLI has prepared the slice branch and state files
**When** the CLI builds the auto-dev prompt
**Then** the prompt explicitly contains:
- The line `Mode: --here — modify the current repository in place. Do NOT create a demo/ directory. Do NOT scaffold a new PWA.`
- The line `Slice branch: <slice-branch>. All commits MUST land on this branch.`
- The line `Target repo: <cwd absolute path>. Working directory is the repo root.`
- The dream / change description verbatim.
- The standard auto-dev pipeline reference (`/bmad-adv-auto-dev` with the existing structure).
- A pointer to read `MAKE_MY_DREAMS.md`, `.specify/memory/constitution.md`, and `docs/lessons-learned.md` for context (these are part of the target repo when target == MMD itself, but also the right convention for any target repo that has installed MMD's constitution).
- NO references to `demo/<slug>/`, `vision.md` for a new product, or `slice.md` for a new feature — those are greenfield concepts. The slice.md written in `--here` mode describes **the change**, not a new product.

Tag: `@unit` for prompt-building logic, `@integration` for the full prompt going through to a fake auto-dev that asserts the expected strings are present.

### AC-5: status.json records mode + target + slice branch

**Given** any `--here` run completes (success or fail)
**When** the user inspects `<cwd>/.mmd/shared/status.json`
**Then** the file contains, in addition to the v0.2 fields:
- `"mode": "here"`
- `"target_dir": "<absolute cwd path at invocation time>"`
- `"slice_branch": "<auto-generated slice branch name>"`
- `"base_branch": "<branch HEAD was on when --here was invoked>"` (typically `main`)
- `"base_sha": "<SHA of HEAD at invocation>"` — so the user can `git diff <base_sha>..HEAD` to review the full slice

Tag: `@unit` for serialization shape, `@integration` for the end-to-end shape after a real run.

### AC-6: Reality Check skipped or adapted in `--here` mode

**Given** the v0.1/v0.2 Reality Check opens `demo/<slug>/index.html` in a browser
**When** the run is `--here` (no `demo/<slug>/` exists)
**Then** the CLI:
- Skips the Reality Check by default in `--here` mode (logs: `Reality Check: skipped (--here mode — no PWA to open). Run \`npm test\` to verify changes.`)
- Optionally: if `<cwd>/package.json` declares a `test` script, the CLI MAY suggest `npm test` in the final report (suggestion only — never auto-runs without explicit consent, to respect the `--here` user's existing workflow)

Tag: `@integration` with a fixture repo that has + does not have `package.json`.

### AC-7: Self-dogfood smoke — `mmd --here` modifies the MMD repo itself

**Given** v0.2a is installed via `npm install -g .` from the MMD repo
**When** the user runs `cd ~/Documents/make-my-dreams && mmd --here "add a one-line comment '# self-dogfood smoke' at the top of docs/lessons-learned.md"` (or similar trivial reversible change)
**Then**:
- A new slice branch `slice/here-add-one-line-comment-self-dogfood-smoke-<ts>` exists
- `docs/lessons-learned.md` has the comment line on the slice branch (verified by `git show <slice-branch>:docs/lessons-learned.md | head -1`)
- `main` is unchanged
- `.mmd/shared/status.json` exists in the MMD repo with `mode: "here"` and `target_dir: <path to MMD>`
- The user can `git checkout main && git merge <slice-branch>` to apply, or `git branch -D <slice-branch>` to discard — both work cleanly

This AC is the **acid test of L-009's resolution**: if it works, the reflexive bootstrap §7 is no longer aspirational. Tag: `@e2e` (slow, real auto-dev invocation, marked `@slow` per testing.md §V — runnable on demand, NOT in the default `npm test` set).

---

## 3. Architecture (incremental)

```
mmd [--here] "<change>"
   │
   ▼
[0] argv parser — already handles --fast/--standard/--deep/-- from v0.2; adds --here recognition
   │
   ▼
[1a] IF --here:
       validate cwd is git repo (exit 3 if not)
       validate clean working tree (exit 4 if not)
       generate slice branch name
       git checkout -b <slice-branch> (exit 5 on failure)
       write .mmd/shared/{vision.md (minimal: "modify <target>"), slice.md (the change), status.json with mode+target+slice_branch+base_branch+base_sha}
   │
   ▼
[1b] ELSE (greenfield, v0.2 behavior unchanged):
       create demo/<slug>/
       write .mmd/shared/ inside demo/<slug>/
   │
   ▼
[2] Build auto-dev prompt:
       if mode == "here": prompt asserts in-place modification, no demo/ scaffold, names the slice branch
       else: current v0.2 prompt
   │
   ▼
[3] Spawn auto-dev (same lib/invoke-autodev.js, with new mode arg)
   │   tee stdout/stderr (respect MMD_QUIET)
   │
   ▼
[4] Reality Check:
       if mode == "here": skip, suggest `npm test` if applicable
       else: v0.2 behavior
   │
   ▼
[5] Update status.json, exit. NEVER auto-merge in --here mode.
```

### Project structure (additions only)

```
make-my-dreams/
├── bin/mmd.js                   # modified — argv parser handles --here, dispatches to here-mode path
├── lib/
│   ├── argv-parser.js           # modified — adds --here recognition; engine/mode separation
│   ├── here-mode.js             # NEW — validation (git repo, clean tree), slice branch creation, prompt building
│   ├── engine.js                # modified — engine.buildPrompt() takes a `mode` arg ("greenfield" | "here")
│   ├── invoke-autodev.js        # unchanged interface; receives the new prompt as before
│   ├── reality-check.js         # modified — skip path in --here mode
│   └── state.js                 # modified — write target_dir, slice_branch, base_branch, base_sha to status.json
├── test/
│   ├── unit/
│   │   ├── argv-parser.test.js  # modified — adds --here cases
│   │   ├── here-mode.test.js    # NEW — validation logic with mocked git
│   │   └── engine-select.test.js # modified — assert prompt shape differs by mode
│   ├── integration/
│   │   ├── here-mode.test.js    # NEW — uses fixture git repos under test/fixtures/here-repos/
│   │   └── here-prompt.test.js  # NEW — fake-autodev fixture asserts the in-place prompt strings are present
│   ├── fixtures/
│   │   ├── here-repos/
│   │   │   ├── clean-repo/      # pre-initialized git repo with one commit
│   │   │   ├── dirty-repo/      # has uncommitted changes
│   │   │   └── no-git/          # plain directory, not a git repo
│   │   └── fake-autodev-here.sh # NEW — fake auto-dev that records its invocation prompt + verifies it's on the slice branch
│   └── e2e/
│       └── self-dogfood.test.js # NEW — AC-7, marked @slow + @e2e, opt-in via MMD_RUN_E2E=1
└── docs/
    └── adr/
        └── 005-here-mode-explicit-flag-not-auto-detect.md  # NEW — ADR for the explicit-flag choice
```

---

## 4. Out of scope for v0.2a

To stay focused on the smallest change that unblocks the reflexive bootstrap:

- ❌ No auto-detection of brownfield mode (no "if cwd has vision.md → infer --here"). Explicit flag only — safer (per ADR-005). Auto-detection can land later if usage proves the pattern.
- ❌ No `--target <path>` flag (modify a repo other than cwd). Out of scope; can be added in v0.2c with the Project Onboarder.
- ❌ No automatic merge of the slice branch into main. The human gate stays.
- ❌ No automatic deletion of the slice branch — per L-008, deletion only after verified successful merge by the human.
- ❌ No Project Onboarder logic (read existing constitution, infer stack, etc.). That's v0.2c — v0.2a only does the "in-place" plumbing.
- ❌ No reflexive Documentalist (lessons composer). That's v0.2e/v0.5b. v0.2a just makes it POSSIBLE for the Documentalist to land via `mmd --here` later.
- ❌ No new engine. `--here` is a **mode flag**, orthogonal to the `--fast/--standard/--deep` **engine flags**. `mmd --here --fast "<change>"` is valid and means: trimmed auto-dev, in-place.

---

## 5. Implementation hints (for auto-dev)

### Key risks to handle

- **Auto-dev's default greenfield mindset**: the existing `/bmad-adv-auto-dev` workflow expects to scaffold something new. The prompt in AC-4 must be unambiguous. If auto-dev still tries to create `demo/<slug>/`, the test in `here-prompt.test.js` catches it by asserting that no `demo/` directory was created in the fixture repo.
- **Branch-state safety**: a bug in `git checkout -b` handling could leave the user on a partial slice with no easy recovery. Mitigations: (a) check `git status --porcelain` BEFORE switching, (b) record `base_branch` + `base_sha` in status.json so recovery is `git checkout <base_branch> && git reset --hard <base_sha>`.
- **`.mmd/shared/` collision**: if MMD itself is the target, `.mmd/shared/` is already a tracked path in MMD's own working tree. The `--here` run will write new state files there. Solution: `.mmd/shared/` in `--here` mode writes to the slice branch only; the human review at merge time decides what to keep. Update `.gitignore` if needed to keep transient files out of commits (already done for `.mmd/local/`).
- **Backward compatibility**: every test from v0.1 + v0.2 + v0.2.5 must still pass. The default behavior (no `--here`) is unchanged.

### Testing per `testing.md` §V stratification

- `@unit` for argv parsing, here-mode validation logic (mocked git), prompt-building per mode, status.json shape.
- `@integration` for end-to-end `--here` with fixture git repos (no real auto-dev — fake-autodev-here.sh records the invocation).
- `@e2e @slow` for the self-dogfood (AC-7) — opt-in via `MMD_RUN_E2E=1` env var so the default `npm test` stays fast.

### Constitution module bindings (per `.specify/memory/constitution-bindings.yaml`)

Active during this work:
- `universal.md`, `ai-coding.md` (always)
- `commit-git.md` (touches git history — and now CREATES branches as core behavior; ensure the slice branch convention is documented)
- `testing.md` (red-green for any failure; the L-009 lesson itself was already a meta-application of this rule to design-vs-implementation gaps)
- `security.md` (the new feature lets MMD modify files in any repo — keep the constraint that it does so only on a slice branch and never auto-merges)
- `error-handling.md` (exit codes 2/3/4/5 per AC-2; messages must be friendly per §II)
- `brownfield.md` (this IS the first real brownfield support — read §III for the regression-safe principle, even though v0.2a doesn't yet do delta analysis)
- `observability.md` (status.json shape extended — keep it forward-compatible)

### Apply the lessons learned (`docs/lessons-learned.md` L-001 through L-009)

- **L-001**: launch via `setsid bash -c "claude -p ..." &` — not nohup.
- **L-002**: monitor via `git log slice/v0.2a-here-mode` + `find -mmin -N`, NOT `tail -f`.
- **L-003**: while auto-dev runs on this slice, use `git worktree add ../make-my-dreams-side` for any side work.
- **L-004**: explicitly verify Definition of Done after auto-dev exits. Relaunch with a precise RESUME prompt if anything is missing.
- **L-005 + L-007**: no hardcoded version strings or slug paths in tests — read from package.json or call the slug function.
- **L-006**: before launching auto-dev, `pgrep -af "claude -p"` to confirm no zombie from a previous run.
- **L-008**: never `git branch -d` on a warning. Verify merge succeeded first.
- **L-009** (THIS spec's origin): communicate honestly. v0.2a addresses one specific implementation gap (greenfield-only wrapper); other gaps may remain — name them in the README / status.

---

## 6. Definition of done

v0.2a is done when:

1. All 7 acceptance criteria are met (AC-1 to AC-7).
2. Full test suite passes — v0.1 + v0.2.5 + v0.2 + v0.2a (~230-250 tests), with new `@e2e @slow` tests gated behind `MMD_RUN_E2E=1`.
3. The self-dogfood smoke (AC-7) works in practice on a trivial change.
4. README updated: new `### Self-modification mode (--here)` subsection in `## Usage`, and an `### Operate on any project (--here)` subsection. The History section gets a paragraph noting that v0.2a delivered the reflexive bootstrap §7 in practice.
5. ADR-005 written: "Explicit `--here` flag rather than auto-detection — why."
6. `MAKE_MY_DREAMS.md` §7 (reflexive bootstrap) gets a paragraph noting v0.2a is the version that makes it real, with a date and the slice SHA.
7. Version bumped to 0.2.1 in `package.json` (`mmd --version` returns `0.2.1`; v0.2a is published as 0.2.1 because semver 0.2.0 is the FAST engine and we're additive).
8. Branch `slice/v0.2a-here-mode` merged to main via fast-forward (or non-FF if needed per L-008), tag `v0.2.1` created.
9. A NEW lessons-learned entry (`L-010+`) added if any failure surfaces during the v0.2a development itself (red-green rule).
10. **Symbolic gate**: at least one subsequent change to MMD is delivered via `mmd --here` rather than manual `claude -p`. Capture the SHA and the time-to-completion in `docs/lessons-learned.md` as a reflexive-bootstrap-validated marker.

---

*Spec v0.2a — generated 2026-05-17 from MAKE_MY_DREAMS.md §7 + lessons-learned L-009. To be fed to `/bmad-adv-auto-dev` on branch `slice/v0.2a-here-mode`. Third reflexive bootstrap test after v0.2.5 and v0.2, and the FIRST one that — if AC-7 passes — finally fulfills §7 in practice.*
