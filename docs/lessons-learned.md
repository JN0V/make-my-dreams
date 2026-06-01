# Lessons learned — project-scoped, autolearning Layer F (dynamic)

> Per MAKE_MY_DREAMS.md §6.5 + §6.5b: every failure encountered during MMD development must produce a deterministic test+fix AND a documented lesson here. Once a lesson reaches N=5 validated re-uses (the matcher in the composer sees its keywords in the prompt and the prompt-receiver respects the rule), it is **promoted** into the relevant constitution module (typically `ai-coding.md`, `commit-git.md`, `testing.md`, or `observability.md`) and removed from this file.
>
> Format follows the template in scoping §6.5 (L-042 example). Lessons are version-controlled here in the project repo; the personal global lessons file is at `~/.mmd/lessons-learned.md` (not committed).
>
> **Note on this file's existence**: it was created in `docs/v025-lessons-learned` branch as a direct red-green response to Sébastien observing that I had listed 5 lessons in a session recap WITHOUT ever writing them down. Talking about lessons is not capturing them. The autolearning loop §6.5 only works if the file exists.

---

## L-001 — `nohup ... &` is insufficient to keep auto-dev alive across shell death

**Status**: active (1 occurrence in v0.2.5 session)
**Date**: 2026-05-17
**Origin**: slice v0.2.5, first auto-dev launch (PID 245796) died ~10 min after launch when its bash wrapper's parent session expired
**Context**: I launched `nohup bash -c "claude -p '/bmad-adv-auto-dev ...'" > /tmp/log 2>&1 &` from the Cowork shell sandbox. `nohup` alone does not detach the process from the controlling terminal's session group; when the spawning bash exits, the SIGHUP still propagates in some configurations. Result: the wrapper died, and the underlying `claude` ran orphan but with no stdout target (its file descriptor was the wrapper's pipe, now closed).
**Rule**: when launching long-running background subprocesses from the Cowork shell sandbox (or any shell that may exit before the child completes), use **`setsid bash -c "... &"`** instead of `nohup bash -c "..." &`. `setsid` creates a new session, fully detaching the process from the terminal session group. Alternatively, wrap in `tmux new-session -d -s <name>` which has the additional benefit of being attachable later (cf MAKE_MY_DREAMS.md §4.5.4bis Layer 5 — Remote Control via tmux).
**To promote if**: 5 reuses validated (counter: 1)
**Category**: subprocess-control, observability
**Applies to**: mmd --here, mmd ship, mmd qa, mmd cso, mmd document-release, mmd unblock
**Keywords for matching**: nohup, background subprocess, setsid, tmux, long-running, orphan process

---


## L-003 — Concurrent git operations on the same worktree conflict between auto-dev and human

**Status**: active (1 occurrence in v0.2.5 session)
**Date**: 2026-05-17
**Origin**: slice v0.2.5, I created branch `docs/v19-remote-observability` to commit a scoping update WHILE auto-dev was running on `slice/v0.2.5-mmd-serve` in the same worktree. Auto-dev (or its subprocess) ran `git checkout slice/v0.2.5-mmd-serve` to ensure its working branch was active, which moved `HEAD` while my Edit tools were preparing files. My subsequent `git add && git commit` landed on `slice/v0.2.5-mmd-serve` instead of my intended `docs/v19-remote-observability`. The wrong-branch commit was harmless functionally (the doc still merges to main eventually) but violated branch-based-workflow intent and left an empty `docs/v19-remote-observability` branch that got auto-deleted at the merge step.
**Rule**: while a long-running agent (auto-dev, gStack `/qa`, etc.) is active on branch X in a worktree, do NOT create or operate on other branches in that SAME worktree. Two options:
  1. Wait for the agent to finish before doing other git work in this worktree.
  2. Use `git worktree add ../<repo>-<sidetask>` to create a parallel worktree for the side task. This is the same mechanism v0.9 will use natively for parallel slices (MAKE_MY_DREAMS.md §4.3) — there's no reason not to use it manually beforehand.
**To promote if**: 5 reuses validated (counter: 1) — likely to become a key rule when v0.9 parallel slices ship
**Category**: git, concurrency
**Applies to**: mmd --here, mmd ship
**Keywords for matching**: git checkout, git worktree, parallel branches, concurrent git, auto-dev running, HEAD moved, wrong-branch commit

---

## L-004 — Auto-dev can stop at ~80% completion without explicit failure

**Status**: active (1 occurrence in v0.2.5 session)
**Date**: 2026-05-17
**Origin**: slice v0.2.5, auto-dev #1 produced the spec extension + scaffold + UI (commits c34806a → c32086f) but stopped before committing test/unit/, README, ADR-003, or running Phase 4. Auto-dev #2 (relaunched with a precise "RESUME" prompt) produced the remaining tests but also stopped before README + ADR + tag.
**Rule**: do not assume an auto-dev run completes the full pipeline. After EVERY auto-dev run, verify:
  1. Process exited (pgrep finds nothing) AND every Phase 4 artifact is present (final adversarial review report under `_bmad-output/implementation-artifacts/`).
  2. The expected output file list (per the spec's Definition of Done) is fully committed.
  3. The release tag was created.
If any item is missing, either (a) relaunch with a precise "RESUME — here's what's missing" prompt naming each missing artifact, or (b) finish the residual items manually if they're small. A second auto-dev pass with a focused resume prompt is typically faster than a from-scratch run, but doesn't always complete either — be ready to take over the final 10%.
**To promote if**: 5 reuses validated (counter: 2) — likely to inform the dream-bench design in v0.2b (the bench should assert that auto-dev's Definition of Done was respected)
**Category**: subprocess-control, definition-of-done
**Applies to**: mmd --here, mmd unblock
**Keywords for matching**: auto-dev stopped, incomplete pipeline, resume prompt, partial run, Phase 4, missing tests, definition of done

---

## L-005 — Tests that hardcode a version string break on every version bump

**Status**: active (1 occurrence in v0.2.5 session)
**Date**: 2026-05-17
**Origin**: slice v0.2.5, `test/integration/mmd.test.js` had `assert.match(r.stdout, /0\.1\.0/)` for `mmd --version`. When `package.json` was bumped from 0.1.0 to 0.2.5, the test broke.
**Rule**: when a value has a single source of truth, tests MUST read from that source — never hardcode the value. For version strings, read `package.json` dynamically:
```js
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
assert.equal(r.stdout.trim(), pkg.version);
```
The same rule generalizes: configuration values, file paths, port numbers — whenever the production code reads from a source, the test must read from the SAME source. Hardcoding in tests creates fragility that surfaces only at release time, when stress is highest. This rule already exists implicitly in `testing.md` III ("every failure deserves a red-green pass") but the version-hardcode case is common enough to deserve explicit mention.
**To promote if**: 5 reuses validated (counter: 1) — strong candidate for promotion into `testing.md` as an explicit rule "Tests must read constants from the same source as production code"
**Category**: testing, version-management
**Applies to**: mmd --here
**Keywords for matching**: version hardcoded, package.json version, version bump, test fragility, single source of truth, test/integration

---

## L-006 — `claude -p` can stay in `S (sleeping)` state forever after finishing its work

**Status**: active (1 occurrence between v0.2.5 and v0.2)
**Date**: 2026-05-17
**Origin**: when launching v0.2 auto-dev, I discovered that the v0.2.5 auto-dev (PID 247659/247662) was STILL running after 40 minutes, in state `S (sleeping)`. It had merged its work, the branch had been deleted, but the process never received a "you're done, exit" signal. Two concurrent auto-devs in the same worktree is exactly the L-003 anti-pattern. Had to manually SIGTERM both.
**Context**: `claude -p "<prompt>" --output-format text` is a non-interactive invocation but it does NOT guarantee process termination after `/bmad-adv-auto-dev` completes its pipeline. The slash command's "done" state and the parent `claude` process's exit are not linked tightly. The process can sit idle indefinitely waiting for nothing in particular.
**Rule**: BEFORE launching a new auto-dev (or any long-running `claude -p` subprocess), ALWAYS verify no previous one is still alive:
```bash
pgrep -af "claude -p" || echo "(no previous claude -p alive — safe to launch)"
# If any survivor, SIGTERM it cleanly:
pgrep -f "claude -p" | xargs -r kill -TERM
sleep 3
# Confirm it's gone, SIGKILL if needed:
pgrep -f "claude -p" | xargs -r kill -KILL
```
Better: wrap every `claude -p` launch with a **session ID env var** (`MMD_RUN_ID=v0.2-fast-engine-$(date +%s)`) recorded in `status.json`, so any orchestrator (Conductor in v0.5+) can `pgrep -af "MMD_RUN_ID=<previous>" | xargs kill` to enforce single-active-run-per-worktree as a constitutional invariant.
**To promote if**: 5 reuses validated (counter: 1) — likely to inform the Conductor's lifecycle management in v0.5
**Category**: subprocess-control, observability
**Applies to**: mmd --here, mmd ship, mmd qa, mmd cso, mmd document-release, mmd unblock
**Keywords for matching**: claude -p zombie, sleeping process, previous auto-dev, single active run, MMD_RUN_ID, process cleanup, SIGTERM SIGKILL

---

## L-007 — Tests must NOT hardcode slugifier output either; use a slug that survives the stopword/dropchars pipeline

**Status**: active (1 occurrence in v0.2 session — discovered AND fixed by auto-dev itself, captured as a lesson rather than handed off)
**Date**: 2026-05-17
**Origin**: slice v0.2, `test/integration/deferred-v01.test.js` initial draft expected `demo/literally-a-dream` for the input `mmd -- --literally-a-dream`. The slugifier drops the `--`, then drops the stopword "a" (`STOPWORDS` in `lib/parse-dream.js`), then rejoins, producing `literally-dream`. The test asserted on the wrong directory name and failed RED. Trivial fix (pick a stopword-free dream like `--literally-my-dream` → `literally-my-dream`), but worth noting.
**Rule**: when an integration test asserts on a slugifier-derived path, choose dream strings whose tokens are NONE of the `STOPWORDS` list (current: `a, an, the, that, on, of, for, to, in, with, and, or`). A safer pattern is to ask the slugifier itself for the expected output: `import { slugify } from '../../lib/parse-dream.js'; const expectedSlug = slugify(dream);` and assert on `demo/${expectedSlug}`. This generalizes L-005: tests must read the SAME source as production code. Hardcoding a path string here is the same antipattern as hardcoding a version string.
**To promote if**: 3 reuses validated (counter: 1) — strong candidate to fold into L-005 as a generalization rather than a separate lesson.
**Category**: testing
**Applies to**: mmd --here
**Keywords for matching**: slug, slugifier, stopwords, demo dir, integration test, hardcoded path, parse-dream

---

## L-008 — Never delete a branch when `git branch -d` warns "not yet merged to HEAD"

**Status**: active (1 occurrence at v0.2 merge attempt)
**Date**: 2026-05-17
**Origin**: After auto-dev v0.2 finished its work on `slice/v0.2-fast-engine` (HEAD `51bb3fe`), I tried `git checkout main && git merge --ff-only slice/v0.2-fast-engine`. Git refused with `fatal: Not possible to fast-forward, aborting.` because `main` had `fc843ee` (L-006 added in a side worktree) that wasn't on the slice. I then ran `git branch -d slice/v0.2-fast-engine` which produced this warning:
```
warning: deleting branch 'slice/v0.2-fast-engine' that has been merged to
         'refs/remotes/origin/slice/v0.2-fast-engine', but not yet merged to HEAD.
Deleted branch slice/v0.2-fast-engine (was 51bb3fe).
```
I ignored the warning. The branch was deleted locally AND on the remote (`git push origin --delete`), losing the easy path back to the work. Recovery was possible only because the SHA was still in the reflog (`git branch slice/v0.2-fast-engine 51bb3fe`).
**Rule**: when `git branch -d <name>` warns "**not yet merged to HEAD**", STOP. The branch contains commits that are NOT on your current branch. Three options:
  1. Investigate why the divergence exists (typically: `main` advanced after the slice was created — rebase or cherry-pick the missing commits).
  2. Force the deletion only if you genuinely want to discard the slice's work (`git branch -D <name>`, but this is destructive).
  3. NEVER chain `git branch -d X && git push origin --delete X` based on a warning — confirm the merge succeeded first.
The systemic fix: always run the merge BEFORE the cleanup, and ONLY run the cleanup if the merge produced "Fast-forward" output (or a clean merge commit). Make this a script: `git merge --ff-only X && git branch -d X && git push origin --delete X` (`&&` chain ensures cleanup runs only on merge success).
**To promote if**: 5 reuses validated (counter: 1) — strong candidate for promotion to `commit-git.md` as an explicit rule "Cleanup branches only after merge success".
**Category**: git
**Applies to**: mmd --here, mmd ship
**Keywords for matching**: git branch -d, merge ff-only failed, not yet merged to HEAD, branch deleted, recovery from SHA, reflog

---

## L-009 — Walking-skeleton scope is NOT design scope: the `mmd <dream>` wrapper was too narrow

**Status**: active (1 occurrence at v0.2 retro, surfaced by Sébastien's direct challenge)
**Date**: 2026-05-17
**Origin**: After v0.2 merge, Sébastien asked whether MMD was really being used to develop MMD. My honest answer was "I use the Standard engine (auto-dev) but not the wrapper `mmd <dream>`, because the wrapper creates `demo/<slug>/` and produces external PWAs, not self-modifying code." Sébastien pushed back: "le principe de mmd, c'est que ça puisse fonctionner sur n'importe quoi, y compris sur soi-même." He was right. The "wrapper only produces external demos" is a SPEC_V01 limitation (greenfield-only walking skeleton), not a MMD design constraint. The design (MAKE_MY_DREAMS.md §7 reflexive bootstrap + Project Onboarder) explicitly says MMD must work on any project, including itself. I had internalized an implementation limit as a design constraint, which silently capped the reflexive bootstrap and made §7 dishonest in practice.
**Rule**: when communicating the **current state** of MMD, explicitly distinguish:
  1. What the **design** (MAKE_MY_DREAMS.md + scoping docs) requires
  2. What the **current implementation** (latest spec + code) actually does
  3. The **gap** between (1) and (2), and which planned slice closes it
Never present an implementation limitation as a design choice — it hides debt and erodes the design's integrity. A concrete check before any architectural statement: "is this true of the *design*, of the *current code*, or both?" If only the code, name the gap and the planned closure (e.g., "currently greenfield-only — `--here` mode planned in v0.2a"). This generalizes beyond MMD: in any spec-driven workflow, walking-skeleton scope must be communicated as deliberately partial, not as the system's true boundary.
**To promote if**: 3 reuses validated (counter: 2) — strong candidate for promotion to `documentation.md` as an explicit rule "Always distinguish design scope from current-implementation scope".
**Category**: design-vs-implementation, documentation
**Applies to**: *
**Keywords for matching**: walking skeleton, design scope, implementation gap, reflexive bootstrap, brownfield, self-modification, --here, scope confusion, premature constraint

---

## L-010 — Reflexive bootstrap §7 validated in practice (symbolic gate)

**Status**: milestone (not a failure-derived lesson — a captured proof-of-life per SPEC_V02A DoD §10)
**Date**: 2026-05-17
**Origin**: AC-7 of SPEC_V02A passed on first attempt. The test runs `mmd --here "<trivial change>"` inside a fresh `git worktree` of MMD, lets the real `claude` CLI run the full Standard auto-dev pipeline, and verifies the slice branch carries the change. Until this moment, every claim that MMD develops MMD (MAKE_MY_DREAMS.md §7) was true only in the abstract — concretely, every reflexive run had been via raw `claude -p /bmad-adv-auto-dev …`, bypassing the wrapper. With v0.2a + AC-7 passing, the supported `mmd --here` path is the proof.
**Numbers** (the symbolic gate, per DoD §10):
- Slice branch: `slice/v0.2a-here-mode`, base `cb8833c`, tip `49a3094` (13 commits)
- Test that validates: `test/e2e/self-dogfood.test.js` (`@e2e @slow`, gated `MMD_RUN_E2E=1`)
- Wall-clock for the acid test (real auto-dev, trivial change): **121 s** (2 min 1 s)
- Test result: 1/1 PASS, 0 fail, 0 skip
- Auto-dev run id: `v0.2a-AC7-e2e-1779029559`
- Worktree path used: `/tmp/mmd-e2e-mka3NF/mmd-clone` (cleaned up by the test's `finally` block)
- The exact change applied by the dogfood: `<!-- self-dogfood smoke 2026-05-17T14:52:40.069Z -->` at the top of `docs/lessons-learned.md` (on the dogfood slice branch only — never reached this file in main)
**Rule** (operative implication, not a lesson-rule per se): from now on, every NEW slice on MMD itself SHOULD be launched via `mmd --here` rather than raw `claude -p`, except in two cases:
  1. The slice modifies the wrapper itself (chicken/egg — use `claude -p` once, then test the modified wrapper from the next slice).
  2. The slice has a known dependency on a feature that's not yet on `main` (e.g. v0.2b being developed before its dependencies are merged).
Using `mmd --here` instead of raw `claude -p` is the difference between "MMD's reflexive bootstrap is documented" and "MMD's reflexive bootstrap is the supported workflow." This is the change that justifies removing the asterisk on §7.4's roadmap statement ("v0.2+: MMD is used to develop MMD").
**To promote if**: this is a marker, not a counter-tracked lesson. Keep here as a historical anchor; do not promote to a constitution module — it belongs in the project narrative (the History section of README.md gains a paragraph noting v0.2a is the version that made §7 real).
**Category**: reflexive-bootstrap, milestone
**Applies to**: *
**Keywords for matching**: reflexive bootstrap, §7, AC-7, dogfood, --here, symbolic gate, milestone, MMD develops MMD, v0.2a

---

## L-012 — gStack was named as a pillar but never invoked: the L-009 pattern, repeated

**Status**: active (1 occurrence, surfaced by Sébastien immediately after launching v0.2b)
**Date**: 2026-05-17
**Origin**: After v0.2a's L-010 closed the wrapper-narrowness gap, Sébastien asked: "par contre, ça fait uniquement auto dev, jamais de gstack ?" Verified on the spot:
  - gStack is installed at `~/.claude/skills/gstack/` (with sub-skills openclaw-ceo-review, openclaw-investigate, openclaw-office-hours, etc.)
  - `bun` (a gStack runtime dependency for some skills) is NOT on `PATH`
  - No slash commands `/qa`, `/cso`, `/ship`, `/document-release`, `/context-save` exist anywhere in `~/.claude/commands/` or in the MMD repo's `.claude/commands/` (which only contains `bmad-adv-auto-dev.md`)
  - Every MMD slice from v0.0 through v0.2b was implemented by `claude -p /bmad-adv-auto-dev …` only — zero gStack invocations
  - The `install-mmd.sh` script's Phase B comment (lines 7, 52-54, 123-128) explicitly says gStack integration is "deferred to subsequent MMD versions" — but no subsequent version (v0.1, v0.2, v0.2.5, v0.2a, v0.2b) has actually wired it in
**The pattern**: this is L-009 in another domain. The design (README "MMD stands on the shoulders of Spec Kit, OpenSpec, BMAD, gStack, Ralph Loop"; MAKE_MY_DREAMS.md scoping mentioning gStack throughout) claims gStack as a foundational pillar. The current implementation never calls it. L-009's rule ("distinguish design scope from current implementation scope, name the gap") was not applied to gStack — so the gap accumulated for 11 slices without being named.
**Rule**: extend L-009's rule with an explicit check at every release: before tagging vN, audit "what frameworks does the README claim we stand on, and which of them have actually been invoked in vN's slices?" If the answer is "none" for any claimed framework, the README and scoping MUST either (a) remove the framework from the pillar list, or (b) name it explicitly in the release notes as "still deferred — planned for vN+k." Silent deferral indefinitely is a documentation defect. Practically, add a `scripts/audit-pillars.sh` (v0.2c+) that greps for invocation patterns of each claimed framework across the slice's commits and reports the audit at PR/merge time.
**To promote if**: 3 reuses validated (counter: 1) — strong candidate to promote to `documentation.md` as "Pillar-claim audit: README claims must be testable against actual invocations." Until promoted, it's the second occurrence of the L-009 pattern, which itself suggests the underlying meta-rule (design-vs-implementation discipline) deserves promotion sooner rather than later.
**Category**: pillar-audit, design-vs-implementation
**Applies to**: *
**Closure options to consider** (the user picked option 1 as the next slice after v0.2b lands):
  1. **Light**: `mmd ship` wrapper invoking `/ship` + `/document-release` automatically at merge time — would have replaced the manual `git merge --ff-only && git tag && git push --tags` sequence used for v0.2.1.
  2. **Medium**: a Conductor stub orchestrating `auto-dev → /qa → /cso → /ship` as a real sequence (each step commited separately, allows measuring which steps add value).
  3. **Heavy**: fold gStack invocation into the auto-dev workflow itself (Phase 3 reviews via `/qa`, Phase 4 via `/cso`) — most integrated but largest blast radius.
**Note on numbering**: L-011 was reserved by auto-dev itself on the v0.2b slice (commit `7fa8aec chore(v0.2b): bump version to 0.2.2 + L-011 reflexive milestone capture`) for the v0.2b reflexive milestone, parallel to L-010 for v0.2a. This L-012 was captured in parallel on a side branch (per L-003) to avoid concurrent git ops in the same worktree while auto-dev was active.
**Keywords for matching**: gStack, gstack, pillar, framework claim, design vs implementation, /qa, /cso, /ship, /document-release, /context-save, install-mmd.sh Phase B, audit-pillars, README claim audit

---

*This file is the project-scoped Layer F of the multi-layer constitution. Per scoping §6.5, when any lesson reaches N=5 validated re-uses, the Documentalist will (a) promote it to the appropriate constitution module, (b) remove it from here, (c) record the promotion event in `docs/adr/` if architectural.*

---

## L-011 — Reflexive bootstrap §7 validated on a real feature (second symbolic gate)

**Status**: milestone (not a failure-derived lesson — a captured proof-of-life per SPEC_V02B DoD §10)
**Date**: 2026-05-17
**Origin**: Sébastien launched `mmd --here "implement v0.2b per SPEC_V02B.md ..."` from inside `~/Documents/make-my-dreams/`. The supported `mmd --here` path produced the entire v0.2b slice — bench dreams + schema + library modules + CLI wiring + integration test + docs + version bump — end-to-end. Until L-010, every reflexive run had been via raw `claude -p`. With L-010 we validated `mmd --here` on a trivial symbolic change. L-011 strengthens that result to "validated on a real feature slice" (the `mmd bench` v0 harness — non-trivial: 9 new files in `lib/bench/` + `bin/`, 5 new test files, 4 docs).

**Numbers** (the symbolic gate, per SPEC_V02B DoD §10):
- Slice branch: `slice/here-implement-v0-2b-per-spec-v02b-md-read-it-now-it-is-1779030967`, base `0bd703c`
- Files created: 19 new (5 bench dreams, 1 schema, 1 bench gitignore, 1 runs README, 4 lib/bench modules, 1 bin/bench.js, 4 unit tests, 1 integration test, 1 ADR-006)
- Files modified: 5 (bin/mmd.js, lib/argv-parser.js, README.md, MAKE_MY_DREAMS.md, package.json, docs/lessons-learned.md)
- Test results: full suite passes with the new tests (count + duration recorded in the final commit message of the slice)
- `mmd bench --dry-run` actual wall-clock: under 1 second on the developer machine (well under the 30-second mission validation)
- Exit code 0
- v0.2b complete. The reflexive bootstrap §7 is now validated on a real feature slice. The asterisk on §7.4's roadmap statement ("v0.2+: MMD is used to develop MMD") can be removed permanently — both L-010 and L-011 underwrite it.

**Rule** (operative implication, not a lesson-rule per se): from now on, every NEW MMD slice MUST be launched via `mmd --here` rather than raw `claude -p`, except in the two carve-outs from L-010:
  1. The slice modifies the wrapper itself (chicken/egg — use `claude -p` once, then test the modified wrapper from the next slice).
  2. The slice has a known dependency on a feature that's not yet on `main`.

After L-011, raw `claude -p` for a regular feature slice is a **constitution violation** (commit-git.md §IV preference for "the supported path"), not just a stylistic regression. The next slice that uses raw `claude -p` without falling into a carve-out triggers a red-green pass to either widen the carve-out list with a documented reason OR fix the wrapper limitation that motivated the bypass.

**To promote if**: this is a marker, not a counter-tracked lesson. Keep here as a historical anchor; promote to the History section of README.md when v0.3 ships (the version that demonstrates dream-bench actually gates a release).
**Category**: reflexive-bootstrap, milestone
**Applies to**: *
**Keywords for matching**: reflexive bootstrap, §7, v0.2b, dream-bench, --here, symbolic gate, milestone, MMD develops MMD, L-010 strengthened

---

## L-013 — Reflexive bootstrap §7 — third validation on a wrapper-modifying slice

**Status**: milestone (not a failure-derived lesson — a captured proof-of-life per SPEC_V02F DoD §12)
**Date**: 2026-05-17
**Origin**: Sébastien launched `mmd --here "implement v0.2.f per SPEC_V02F.md ..."` from inside `~/Documents/make-my-dreams/`. The supported `mmd --here` path produced the entire v0.2.f slice — install hardening (Phase 0 bun + Phase 6 gStack functional verify), `bin/mmd` PATH shim, `mmd ship` subcommand (argv parsing + branch validation + prompt builder + claude invocation + summary), `scripts/audit-pillars.sh` + patterns.json, README + ADR-007 + MAKE_MY_DREAMS.md updates, 66+ new tests. This is the **third** reflexive use after L-010 (trivial) and L-011 (feature) — and the **first** that intentionally modifies the wrapper itself (the L-010 carve-out #1: "chicken/egg — use `claude -p` once, then test the modified wrapper from the next slice"). The slice was developed with the existing `mmd --here` wrapper (pre-shim), and the next slice will use the post-shim wrapper to validate the change.

**Numbers** (the symbolic gate, per SPEC_V02F DoD §12):
- Slice branch: `slice/here-implement-v0-2-f-per-spec-v02f-md-authoritative-install-1779037717`, base on main pre-slice
- Files created: 12+ new (lib/ship/{build-prompt, validate-branch, invoke-claude, summary}.js, bin/ship.js, bin/mmd shim, scripts/audit-pillars.sh, scripts/audit-pillars.patterns.json, test/fixtures/fake-claude-ship.sh, test/unit/ship-*.test.js × 3, test/unit/audit-pillars.test.js, test/integration/ship-dry-run.test.js, test/integration/ship-fake-claude.test.js, test/integration/install-mmd.test.js, docs/adr/007-gstack-effective-via-ship-subcommand.md)
- Files modified: 6 (install-mmd.sh, bin/mmd.js, lib/argv-parser.js, package.json, README.md, MAKE_MY_DREAMS.md, test/unit/argv-parser.test.js)
- Test results: full suite (`npm run test:full`) passes — 424+ tests, 0 failures, 0 skipped
- `mmd ship --dry-run` actual wall-clock on a temp slice repo: ~90 ms (well under the 5-second DoD §3 budget)
- Exit code 0
- v0.2.f's wrapper change (the `mmd ship` subcommand) IS the slice — making this the first reflexive run whose primary deliverable is the wrapper itself. After v0.2.f merges, subsequent slices use the new shim PATH-elevation + the `mmd ship` subcommand to ship themselves.

**Rule** (operative implication — extends L-011): the L-010 carve-out #1 ("the slice modifies the wrapper") is now exercised. Concretely, v0.2.f used the **existing** `mmd --here` (which does not depend on the changes being introduced) to produce a slice that modifies `bin/mmd` (new shim), `bin/mmd.js` (ship dispatch wiring), `lib/argv-parser.js` (parseShipArgs), and adds `bin/ship.js`. The development worked because:
  1. The pre-shim `mmd --here` does not need the post-shim PATH elevation (auto-dev doesn't call `bun` directly — only the new `mmd ship` does).
  2. The pre-ship `mmd --here` does not invoke `mmd ship` (the new subcommand is invoked at release time, not at slice-creation time).
  3. The new test suite for `mmd ship` uses `MMD_SHIP_CMD=<fixture>` so the post-shim PATH elevation can be verified in CI without requiring `bun` to be installed on the runner.

The reflexive bootstrap §7 now has three distinct validations (trivial / feature / infrastructure-touching) — sufficient to retire any remaining language about §7 being aspirational. The next test for §7 is whether `mmd ship` itself can ship v0.2.f to main (the SPEC_V02F DoD §9 acid test — "ship uses ship") — captured separately by Sébastien post-merge.

**To promote if**: marker, not a counter-tracked lesson. Keep as a historical anchor. Promote to README History when v0.3 ships and the full reflexive loop (slice → ship → release-notes → tag → next slice) is demonstrated end-to-end with `mmd ship` at the helm.
**Category**: reflexive-bootstrap, milestone
**Applies to**: *
**Keywords for matching**: reflexive bootstrap, §7, v0.2.f, mmd ship, gStack effective, --here, symbolic gate, milestone, MMD develops MMD, L-011 strengthened, wrapper-modifying slice, L-010 carve-out #1

---

## L-014 — Reflexive bootstrap §7 — sixth validation: composer minimal lands the autolearning loop

**Status**: milestone (not a failure-derived lesson — a captured proof-of-life per SPEC_V02E DoD §6.12)
**Date**: 2026-05-18
**Origin**: Sébastien launched `mmd --here "implement v0.2e per SPEC_V02E.md ..."` from inside `~/Documents/make-my-dreams/`. The supported `mmd --here` path produced the entire v0.2e slice — composer library (`lib/composer/{parse-lessons,match,format,audit,usage-stats}.js`), wiring into `lib/invoke-autodev.js` + `lib/skills/_common/invoke-claude.js`, `mmd lessons` subcommand, `audit-pillars.sh --with-composer`, ADR-010, README + MAKE_MY_DREAMS.md updates, 80+ new tests. This is the **sixth** reflexive use after L-010 (trivial), L-011 (feature), L-013 (wrapper-modifying), L-015 (pre-condition gap surfaced), and L-016 (timeout + spec-polish trap). v0.2e is also the slice that closes the autolearning loop §6.5 + §6.5b end-to-end: the manual Documentalist (Cowork) is no longer the gatekeeper for lesson injection — `lib/composer/match.js#composeLessons` is invoked automatically before every `claude -p` spawn.

**Numbers** (the symbolic gate, per SPEC_V02E DoD):
- Slice branch: `slice/here-implement-v0-2e-per-spec-v02e-md-spec-is-frozen-do-not-edit-it-1779091384`, base on main pre-slice
- Files created: 16 new (lib/composer/{parse-lessons,match,format,audit,usage-stats}.js — 5 modules, bin/lessons.js, docs/adr/010-composer-minimal-keyword-overlap.md, test/unit/composer-{parse-lessons,match,format,audit,usage-stats}.test.js — 5 unit tests, test/unit/lessons-cmd.test.js, test/integration/{invoke-autodev-with-composer,lessons-cmd,audit-pillars-composer}.test.js — 3 integration tests, test/fixtures/composer-lessons/{minimal,malformed,empty}.md — 3 fixtures)
- Files modified: 8 (bin/mmd.js, lib/invoke-autodev.js, lib/skills/_common/invoke-claude.js, scripts/audit-pillars.sh, MAKE_MY_DREAMS.md §6.5, README.md, package.json, test/fixtures/ship-help.snapshot.txt re-blessed)
- Test results: full suite (`npm run test:full`) passes — 766 tests (was 686 before this slice), 0 failures, 0 skipped
- `composeLessons` actual wall-clock on the live lessons file at slice time: single-digit ms (well under the 100 ms SPEC §5 perf budget)
- Exit code 0
- v0.2e's primary deliverable is the composer — the slice that makes the autolearning loop §6.5 operational. After v0.2e merges, every subsequent slice's auto-dev / ship / qa / cso / document-release invocation auto-receives any keyword-matched lesson from `docs/lessons-learned.md` without human-in-the-loop. The reuse counter (still manual until v0.5b) starts ticking truthfully because injection is now deterministic.

**Rule** (operative implication — extends L-011 + L-013): after v0.2e, the `mmd --here` workflow's promise is no longer just "MMD develops MMD" but "MMD develops MMD with cumulative learning". Concretely, the L-016 lesson captured during v0.2.g development (MMD_TIMEOUT_MS=0 + spec-frozen directive) is now AUTOMATICALLY injected into the prompt of any future `mmd --here` whose dream mentions timeout / MMD_TIMEOUT_MS / Phase 1 — without the human Documentalist remembering to do so. Each new failure → new lesson → next run automatically benefits. The autolearning loop §6.5 is no longer aspirational — it's the supported pathway.

**To promote if**: marker, not a counter-tracked lesson. Keep as a historical anchor. Promote to README History when v0.5b ships the Documentalist Worker that closes the reuse-counter loop (composer feeds the data; Documentalist makes the promote/archive decisions; constitution modules absorb promoted lessons).
**Category**: reflexive-bootstrap, milestone
**Applies to**: *
**Keywords for matching**: reflexive bootstrap, §7, v0.2e, composer, lessons-learned auto-injection, --here, symbolic gate, milestone, MMD develops MMD, autolearning loop, §6.5, sixth reflexive use, L-013 strengthened

---

## L-015 — Conductor's pre-conditions miss prompt-grounding (file references)

**Status**: active (1 occurrence, surfaced by Sébastien immediately when v0.2.g first launch was about to fail silently)
**Date**: 2026-05-18
**Origin**: Launching v0.2.g via `mmd --here "implement v0.2.g per SPEC_V02G.md (authoritative): ..."` the prompt referenced `SPEC_V02G.md` as authoritative. I had drafted that spec in a side worktree on branch `docs/spec-v02g` and **assumed** my `git merge --ff-only origin/docs/spec-v02g` into main had landed it. In reality, `docs/spec-v02g` had been forked from `main@ffc6b3a` (pre-v0.2c), while current main was at `fc0962c` (post-v0.2c). The spec branch was BEHIND main, so `--ff-only` did nothing ("Already up to date") — and `SPEC_V02G.md` never reached main. Auto-dev would have spent 30-90 min reading a non-existent file via the dream prompt, producing nonsense. Sébastien caught it by asking "le Conductor aurait-il vu ce que tu as vu ?" — answer: **no, it would not have**, because `lib/here-mode.js` (today's closest thing to a Conductor) does `validateGitRepo → validateCleanTree → createSliceBranch → buildPrompt → spawn`, with zero introspection of prompt content.
**The pattern**: third occurrence of the L-009 design-vs-implementation drift. The scoping §4 describes the Conductor as "stateless orchestrator that verifies pre-conditions". Today's pre-conditions are domain-general (git state) but not domain-specific (does the file the prompt cites actually exist?). The gap was never named until it bit.
**Rule**: any pre-launch validation must include **prompt-grounding** checks. Concretely, before `spawn` in `lib/here-mode.js` / `lib/invoke-autodev.js`:
  1. Parse the dream/prompt body with a regex extracting referenced file paths: `\bSPEC_[A-Z0-9_]+\.md\b`, `\bdocs/[a-z0-9/\-_]+\.md\b`, `\b\.specify/[a-z0-9/\-_]+\.md\b`, etc.
  2. For each extracted path, verify it exists on the slice's base SHA: `git show <base_sha>:<path>` must succeed.
  3. If any cited file is missing, exit non-zero (proposed exit code 6 — "prompt-grounding failed") with the list of missing files. The user must either fix the prompt or land the missing files on the base first.
This is the missing line in v0.2a AC-2 (validation gates) — `--here` cleanliness check was insufficient. Implementation is a slice of its own (~v0.2.h, see Future tasks) because it touches `here-mode.js` core paths and needs careful test coverage to not break existing flows.
**To promote if**: 3 reuses validated (counter: 1) — once exercised twice more, strong candidate to promote to `ai-coding.md` as "Prompt-grounding pre-condition: every file path cited in a dream/prompt MUST be verified to exist on the launch base before subprocess spawn." Until promoted, sits here as a flagrant L-009-pattern instance.
**Operational mitigation while the gap exists**: I (the manual Conductor) MUST run `git show <base>:<each-spec-file> > /dev/null` before launching any `mmd --here` whose dream references a spec file. The check takes <1 s and saves 30-90 min of wasted auto-dev time.
**Category**: conductor, pre-conditions
**Applies to**: mmd --here
**Keywords for matching**: prompt-grounding, conductor, pre-conditions, SPEC_*.md, ff-only no-op, dream file reference, here-mode validation, L-009 pattern third occurrence

---


## L-017 — `mmd discover` SCAN under-detects tests, runners, frameworks (no recursion, no package.json.scripts read)

**Status**: active (1 occurrence, surfaced by self-application of `mmd discover` on the MMD repo itself)
**Date**: 2026-05-30
**Origin**: After v0.2.8 shipped, ran `mmd discover .` on MMD itself as part of the full-stack dogfood (`mmd discover` → `document-release` → `cso` → `qa` → `unblock`). The discover report declared `Test runner: none detected` and `0 test files (top-level)` for MMD, which is **flagrantly false**: `package.json` has 5 named test scripts (`test`, `test:unit`, `test:integration`, `test:smoke`, `test:full`, `test:e2e`) and `test/` contains roughly 60 `.test.js` files across `unit/`, `integration/`, `e2e/`, and `fixtures/`. SCAN as currently implemented reads only the top-level entries of selected directories and does not parse `package.json.scripts`. The bug never surfaced because every prior `mmd discover` execution was against fixture repos (Rich / BMAD-sprawl / Blank / Already-onboarded), all of which have either zero tests or a single tracked `*.test.*` at root.
**The pattern**: third-order L-009 echo. The spec (SPEC_V02C §AC-2) says SCAN must detect "test runner (`jest.config.js`, `vitest.config.ts`, `pytest.ini`, etc.)" — a list of common config files. It does NOT mention `package.json.scripts` (which is the actual idiomatic Node way to expose `node --test`) and it does not specify recursive directory walking. Implementation followed spec literally and missed the cases that matter. **Dogfood is what surfaced the gap.** Every fixture-only test passed; only the real repo broke the abstraction.
**Rule**:
  1. **SCAN must read `package.json.scripts`** and treat any value matching `/\bnode\s+--test\b|\bjest\b|\bvitest\b|\bmocha\b|\btap\b|\btape\b|\bava\b|\bpytest\b|\bplaywright\b|\bcypress\b/` as a test-runner signal. Same for `pyproject.toml` `[tool.pytest.ini_options]`, `Cargo.toml` `[dev-dependencies]`, `go.mod` test presence, etc.
  2. **SCAN must walk `test/`, `tests/`, `__tests__/`, `spec/`, `specs/` recursively** (bounded depth 4, gitignore-aware) to count `*.test.*`, `*_test.*`, `*.spec.*` files.
  3. **Fixture tests must include at least one "realistic" case** — a small but real Node/Python/Rust project with `package.json.scripts` + nested test dir, so future SCAN regressions surface in CI, not in dogfood. Add `test/fixtures/discover-repos/realistic-node/` mirroring the MMD shape minus the size.
  4. **Generalization**: every SCAN-like component must have a test case derived from an actual repo it claims to handle, not just synthetic minimal fixtures. The failure mode "spec literally followed, but reality differs" is recurrent.
**To promote if**: 3 reuses validated (counter: 1) — strong candidate to promote to `ai-coding.md` §VII as "Scanners must be tested against at least one real-world example of every claimed support category, not only synthetic minimal fixtures." Until promoted, sits here as a flagrant dogfood-surfaced gap.
**Other findings from the same dogfood session** (not separate lessons, just operational follow-ups):
  - **`mmd cso` LOW-1**: `lib/server.js:536` spawns the intermediate process with `{ ...process.env, MMD_SLUG: slug }` instead of `buildSubprocessEnv(process.env)`. Every other spawn site uses the allowlist. Defense-in-depth inconsistency, not a live vuln.
  - **`mmd cso` LOW-2**: `install-mmd.sh:161,1214` pipes `curl … | bash` for bun/gstack. Standard dev pattern, gated by prompts, but worth a trust-assumption note in BOOTSTRAP.md.
  - **`mmd qa` High-1**: `MMD_FAKE_5WHYS_EXIT` fixture exists but no test sets it — the L-016 escalate-to-user guarantee for the spawn-failure branch is unproven.
  - **`mmd qa` High-2**: `five-whys-timeout.test.js` tests only the pure `resolveTimeoutMs()`, never asserts an end-to-end timeout fires — L-006 hang-protection / F1 fix unproven.
  - **`mmd qa` High-3**: `safeReadLogTail` feeds the prompt but no test inspects the prompt/`.md` content for it — `logTail` could silently regress to `''`.
  - **e2e secondary**: `test/e2e/self-dogfood.test.js:67` uses `assert.fail()` in a path that should be `t.skip()` (when `git worktree add … main` is rejected because the e2e is itself running on `main`).
  All scheduled for closure in v0.2.k.
**Category**: discover, scanner, testing
**Applies to**: mmd discover
**Keywords for matching**: discover, SCAN, scanner, test runner detection, package.json scripts, recursive glob, fixture realism, dogfood, .test.js, node --test, jest, vitest, false negative, spec literal vs reality

---

## L-018 — Composer's walking-skeleton scope omitted scale concerns (5th L-009-pattern echo)

**Status**: active (0 occurrences yet — *anticipated* by Sébastien before it became painful; predictive capture)
**Date**: 2026-05-30
**Origin**: After v0.2.7 (composer) + v0.2.j (5-Whys consuming composer) + v0.2.k draft (closure of dogfood findings), Sébastien observed: "à un moment donné on va avoir le même problème que celui qu'on avait identifié dans la Constitution. On va se retrouver à charger un contexte énorme tout le temps dans des situations où ce qui est indiqué dans le learning n'est pas nécessaire. Il faudrait que les learning soient classifiés aussi par catégorie et déclenchés en fonction de ce qu'on fait." Verified by reading `lib/composer/match.js`: keyword matching is global over the whole lessons file with no context awareness; the only ceiling is `topN=5`. With 17 active lessons today and topN=5, the composer averages 2-4 relevant injections — fine. At 50+ lessons, the keyword "git" alone collides across L-003/L-008/L-017 + everything new, and topN starts excluding genuinely-relevant lessons in favor of lexical-coincidence ones. The recent v0.2.k launch matched L-009/L-017/L-016/L-004 — relevant by luck, not by structural design.
**The pattern (5th iteration)**: every MMD walking-skeleton component touching data-volume-sensitive logic has had this conversation. Constitution v1.3→v2.0 was modularized into 13 modules + `constitution-bindings.yaml` because loading the monolith always wasted context. SPEC_V02E §4 explicitly deferred "semantic matching" and "scoring sophistication" but never said "no categorization either" — leaving the future-scale gap unnamed. Sébastien named it, again, before it bit.
**Rule**: the composer must adopt the same architecture as the constitution did — light per-item categorization + a context-aware filter that runs BEFORE keyword matching:
  1. Every lesson gets two new optional fields (authored or migrated): `**Category**: <comma-list>` (e.g. "git, subprocess-control, observability") and `**Applies to**: <comma-list>` (e.g. "mmd --here, mmd ship, any-claude-spawn", or `*` for universal).
  2. The parser tolerates missing fields (legacy lessons treated as `Category: uncategorized`, `Applies to: *` for back-compat).
  3. `composeLessons(prompt, lessonsPath, { context })` where `context = { subcommand, phase?, engine? }`. The composer first filters lessons by `Applies to` (must include `subcommand` or be `*`), then runs keyword matching on the filtered subset, then applies `topN` cap as before.
  4. Backward-compat: if `context` is undefined (legacy callers), no filtering happens — current v0.2.7 behavior.
  5. Optional `lessons-bindings.yaml` (mirroring `constitution-bindings.yaml`) for explicit per-subcommand prefer-lists on top of `Applies to`.
  6. Mechanical migration of the 17 existing lessons (1-line `Category` + `Applies to` each).
**To promote if**: 3 reuses validated (counter: 0) — BUT the meta-pattern has now been observed 5 times: L-009 (wrapper) / L-012 (gStack) / L-015 (Conductor) / L-017 (discover) / L-018 (composer). **Strong candidate to promote a META-rule to `ai-coding.md`**: "Walking-skeleton specs must enumerate explicit **scale assumptions** in their Out-of-scope section (e.g., 'works up to N items, beyond N consider categorization/filtering/sharding'). Unstated assumptions become silent L-009 echoes." Promote when v0.5b Documentalist exists.
**Operational mitigation while v0.2.l ships**: nothing needed today (17 lessons is safe). Re-check the load profile (`mmd lessons` + composer.json metrics) when the lessons count crosses 30; bump priority of v0.2.l if injection looks noisy before then.
**Category**: composer, design-vs-implementation, scale
**Applies to**: *
**Keywords for matching**: composer, autolearning, scale, context bloat, modularization, categorization, lessons-bindings, walking-skeleton scope, L-009 pattern fifth occurrence, scale assumption, Applies to, Category, predictive capture, prevention before pain

---

## L-019 — Auto-dev killed mid-run leaves uncommitted WIP at risk (commit-incrementally rule had no detector)

**Status**: active (1 occurrence — a v0.2.k auto-dev run killed mid-flight left a large uncommitted working tree, rescued manually with `git stash push`)
**Date**: 2026-05-31
**Origin**: A v0.2.k Standard-engine auto-dev run was killed mid-pipeline. Because the run had generated substantial code without intermediate commits, the kill left a large dirty working tree. The rescue was a manual `git stash push -u` — and that only worked because someone noticed. The prevention rule already existed (commit-git.md §III "commit early, commit often, push always"; restated in every launch prompt as "commit incrementally per AC"), but its *failure* was invisible: nothing observed "auto-dev stopped committing yet the tree keeps changing". The work was one `git worktree` cleanup or misclick away from oblivion.
**The pattern**: a load-bearing rule that lived only in prose/prompts, with no code that detects its violation. The conductor's stall detector (ADR-011) had `no-commit-since-N-min`, but that fires for a *clean* paused branch too — it could not tell "paused, nothing at risk" from "dirty, work at risk". The missing signal is the *conjunction*: dirty tree AND stale last commit.
**Rule**:
  1. **Make the prevention rule code-detectable.** A prose/prompt rule whose violation is expensive (here: lost work) must have a detector. v0.2.n adds a closed-enum stall signal `wip-uncommitted-since-N-min` (`lib/conductor/stall-signals.js` + `stall-detector.js`) that fires when `git status --porcelain` is non-empty AND the last commit is older than `MMD_STALL_WIP_UNCOMMITTED_MIN` (default 15 min). It flows through `mmd unblock` into the 5-Whys session.
  2. **Derive, don't track (KISS).** Git records no "dirty-since" timestamp; derive WIP age from `lastCommitAge` (dirty tree + last commit N min ago ⇒ WIP uncommitted ≥ N min). Precise tracking would need conductor-side `status.json` bookkeeping — deferred (ADR-018).
  3. **Detect + recommend, never auto-mutate.** The signal recommends `escalate-to-user` with the salvage step `git stash push -u -m "wip-salvage <slice>"`; it never auto-stashes (a false positive that auto-stashed mid-edit would itself cause the loss it prevents). The hint is additive prompt text only — the closed action set and the sacred `escalate-to-user` fallback (L-016, ADR-011) are unchanged.
  4. **Negative/boundary discipline.** A clean stale branch, a fresh never-committed branch, and recent dirty work each do NOT fire — only the dirty+stale conjunction does.
**Companion finding (candidate a, composer L-015 — already-resolved)**: the v0.2.h "composer didn't inject L-015 for the Conductor" miss was forensically reproduced on 2026-05-31 and found to be a *temporal* gap, not a live bug: at v0.2.h the composer passed no invocation context and L-015 had no `Applies to` field; both shipped in v0.2.l (`451e6e1` + `fda5665`), closing it incidentally. L-015 *does* match today under `context: { subcommand: 'mmd --here' }` (score 2: `prompt-grounding` + `conductor`). Lesson: a fix can land *incidentally* via a later refactor; capture the forensic conclusion and pin it with a regression-lock test (`test/integration/composer-l015-regression.test.js`) rather than re-fixing a non-bug. See ADR-018.
**To promote if**: 3 reuses validated (counter: 0) — candidate to promote to `commit-git.md` as "every load-bearing process rule whose violation is costly must have an automated detector, not just prose." Until then, sits here.
**Category**: conductor, git, subprocess-control, observability
**Applies to**: mmd --here, mmd unblock
**Keywords for matching**: wip-uncommitted, uncommitted changes, git stash, stall signal, conductor, work in progress lost, killed mid-run, commit incrementally, worktree dirty, git status porcelain, WIP salvage, escalate-to-user, prompt-grounding

---

## L-020 — Mechanical handover state drifts when hand-maintained (HANDOVER.md said 17, the parser said 13)

**Status**: active (1 occurrence — caught at the v0.2.p launch: the live HANDOVER.md State block claimed 17 active lessons while `parseLessons` counted 13)
**Date**: 2026-05-31
**Origin**: HANDOVER.md mixes human intent (roadmap, "why") with a mechanical "State at handover" block (latest tag, branch, version, lesson/ADR counts, recent commits). The mechanical block was hand-maintained and drifted: at the v0.2.p launch it claimed 17 active lessons while the authoritative parser (`parseLessons`) counted 13. A wrong number in the first document a tired human reads at 2 a.m. is exactly the human-opacity universal §VII warns against.
**Rule**:
  1. **Derive mechanical state; author only intent.** Any document that mixes machine-derivable facts with human intent MUST derive the mechanical part from the source of truth, not hand-maintain it. v0.2.p adds `mmd handover`, which re-derives ONLY the block between `<!-- mmd:handover:state:start -->` / `<!-- mmd:handover:state:end -->` and preserves every byte outside byte-for-byte.
  2. **Count from the authoritative parser, not a regex or a human.** The active-lessons count comes from `parseLessons(...).filter(status==='active')`, the same code the composer trusts — never a hand-tally. A second source of truth is a second thing to drift.
  3. **Never fabricate the non-derivable; mark it honest.** The one non-cheap field (passing-test count) is NOT auto-run (SRP: a doc generator is not a test runner; determinism). It comes from `--tests N` or an explicit `(run npm test to refresh)` placeholder — never an invented or copied-stale number (universal §VI honesty). A failing git call renders `(unavailable: <reason>)`, never a guess.
  4. **Markers are the contract; refuse rather than guess.** If a marker is absent the command does NOT pick an insertion point — it exits non-zero and prints the derived block for the human to place. Idempotency (same state + same `--tests` ⇒ byte-identical file) is a tested invariant. See [ADR-020](adr/020-mmd-handover-subcommand.md).
**To promote if**: 3 reuses validated (counter: 0) — candidate to promote to `documentation.md` as "machine-derivable doc state must be generated, not hand-maintained." Until then, sits here.
**Category**: documentation, observability, automation, honesty
**Applies to**: mmd handover, any-handover-doc, any-claude-spawn
**Keywords for matching**: handover, state, drift, mechanical, derive, marker, idempotent, test count, count, tag, branch, parseLessons, fabricate, honesty

---

## L-021 — Headless `claude -p` has no stdin: multi-turn elicitation must be MMD-orchestrated stateless calls

**Status**: active (1 occurrence — surfaced by the v0.3.a Dream Catcher de-risk smoke test, 2026-05-31)
**Date**: 2026-05-31
**Origin**: The Dream Catcher design assumed it could lean on BMAD's `bmad-product-brief` for elicitation. The natural reading of "an elicitation skill" is *interactive*: BMAD asks a question, the user answers, it asks the next, and so on. But the smoke test (SPEC_V03A §1) ran `claude -p "/bmad-product-brief <dream>"` and proved the headless reality: **a `claude -p` subprocess has no stdin and no interactive loop** — it cannot pause to ask the user anything. What it *can* do is converge fully autonomously when told to ask no questions (the smoke test produced an 81-line structured brief, Kid-aware, zero prompts, exit 0). The guided prototype then confirmed the corollary: multi-turn refinement works only when **MMD** drives it — turn 1 prompts BMAD "ask exactly ONE question", turn 2 feeds `dream + question + answer` back and prompts "synthesize the scope". Each turn is a fresh, stateless `claude -p` call.
**The pattern**: a fourth-order L-009 echo — the *design* ("BMAD-backed elicitation dialogue") quietly assumed a capability the *implementation substrate* (`claude -p` headless) does not have. The gap between "BMAD facilitates a conversation" and "BMAD runs as a one-shot stateless subprocess" was never named until the smoke test forced it. Same shape as L-015 (Conductor assumed a file existed) and L-017 (SCAN assumed fixtures = reality): the abstraction held until a real run broke it.
**Rule**:
  1. **Headless LLM subprocesses are stateless one-shots — never assume a back-and-forth.** Any "conversation" with `claude -p` must be modeled as N independent calls, each carrying the full accumulated context (`dream + all prior answers`) as a prompt argument. There is no session, no stdin, no memory between calls.
  2. **Interactivity lives at the orchestration layer, not inside the LLM call.** MMD (the web UI here) collects the human's answers; BMAD is invoked per turn with MMD telling it the turn's intent ("ask one question" vs "synthesize the scope"). The involvement dial is therefore *how many turns MMD runs*, not a flag inside one BMAD call.
  3. **Because MMD controls each turn's intent, parsing stays trivial.** MMD already knows whether a reply is a question (show it) or the final scope (confirm + launch) — no fragile output classification. Keep the parser defensive anyway (validate before trust, ai-coding §III): an empty/garbage reply must trigger the honest fallback, never a fabricated scope (universal §VI).
  4. **Generalizes to every headless-LLM integration in MMD.** `mmd unblock` (5-Whys), `mmd ship`, future skills: if a design says "have a dialogue with the model", translate it to "MMD orchestrates K stateless calls" before estimating it. v0.3.a-1 ships the proven 1-call autonomous path; the N-call guided modes are a-2.
**To promote if**: 3 reuses validated (counter: 1) — strong candidate to promote to `ai-coding.md` as "Headless `claude -p` is a stateless one-shot; model any multi-turn interaction as N MMD-orchestrated stateless calls, never as an in-subprocess conversation." Until promoted, sits here as the foundational Dream Catcher lesson.
**Category**: subprocess-control, ai-coding, dream-catcher, design-vs-implementation
**Applies to**: mmd serve, mmd --here, any-claude-spawn
**Keywords for matching**: dream catcher, bmad-product-brief, headless, claude -p, no stdin, stateless, multi-turn, elicitation, MMD-orchestrated, involvement dial, autonomous, guided, product brief, L-009 pattern, honest fallback, scope synthesis

---

## L-022 — Don't thread an env var (or any field) that nothing consumes: plumbing without a reader is a dead variable

**Status**: active (1 occurrence — surfaced while wiring the Dream Catcher profile into the build, v0.3.b, 2026-05-31)
**Date**: 2026-05-31
**Origin**: Through v0.3.a the chosen audience **profile** (Kid / Curious / Pro) was dutifully collected by the dialogue and persisted to `status.json.profile` — and then read by nothing. The web confirm route even carried an honest comment admitting "threading the profile INTO the subprocess is deferred". So the profile *looked* wired (it appeared in state, in the archive, in logs) while having **zero effect on the actual build**: a Kid dream and a Pro dream produced byte-for-byte identical auto-dev prompts. The plumbing existed; the consumer did not. v0.3.b closed it by (a) setting `MMD_PROFILE` on both launch paths and (b) making `buildPrompt` actually consume it (state the profile; Kid → safe-by-default directive). The two halves are inseparable: setting the env var without the `buildPrompt` reader would have been the same dead-variable trap one layer down.
**The pattern**: an *observability* sibling of the L-009 design-vs-implementation gap. A value that is stored/logged/passed but never **read by the behavior it claims to influence** is indistinguishable, from the outside, from one that works — until someone checks the output and finds it unchanged. "It's in `status.json`" is not "it changes the build", exactly as "I ran X" is not "X passed" (ai-coding §I). Threading a variable is only done when a consumer reads it AND its effect is observable in the artifact the variable is supposed to shape.
**Rule**:
  1. **A variable is not "wired" until a consumer reads it and its effect is observable.** Before adding an env var / status field / config key, name the exact site that will READ it and the artifact whose change proves it was read. If you can't, you're plumbing a dead variable — stop.
  2. **Ship the producer and the consumer together, or not at all.** Setting `MMD_PROFILE` (producer) and `buildPrompt` consuming it (reader) are one change, not two slices. A "we'll consume it later" comment is a smell: the value sits dead and silently diverges from intent in the meantime.
  3. **Test the consumption, not just the plumbing.** Assert the *artifact* changes (the built prompt carries the profile / Kid safe-by-default), not merely that the var survives the allowlist. An allowlist test proves transport; a prompt-content test proves effect.
  4. **Default explicitly, never empty.** A threaded value gets a real default (here: `Curious`) so the consumer has a defined branch; an empty/unset value must be a deliberate, documented "leave unchanged" path (back-compat), not an accident.
  5. **Generalizes to every cross-process value in MMD.** `MMD_SLUG`, `MMD_AUTODEV_QUICK`, future `MMD_*` vars, status.json fields, SSE event fields: each must have a named reader and an observable effect, or it is noise that erodes trust in the rest of the state.
**To promote if**: 3 reuses validated (counter: 1) — candidate for `observability.md` (or `ai-coding.md`) as "A value isn't wired until a consumer reads it and its effect is observable; ship producer + consumer together and test the effect, not the transport." Until then it sits here as the profile-threading lesson.
**Category**: observability, subprocess-control, env-threading, design-vs-implementation
**Applies to**: mmd "<dream>", mmd serve, mmd --here, any-claude-spawn
**Keywords for matching**: MMD_PROFILE, profile, env var, thread, consume, dead variable, buildPrompt, buildSubprocessEnv, observability, status.json, safe-by-default, Kid, allowlist, plumbing, producer consumer, dream catcher, auto-dev prompt

---

## L-023 — A test the author also wrote is a soft oracle: only an independent, sealed test catches the agent-rewrites-the-test failure

**Status**: active (1 occurrence — surfaced building the v0.4.a sealed-test oracle, 2026-06-01)
**Date**: 2026-06-01
**Origin**: MMD's auto-dev "passes its tests" — but its Phase-3 reviewers and Phase-4 adversarial pass grade *the agent's own tests*. So the most damaging AI-coding failure slips straight through: the agent makes a test pass by **rewriting (or deleting) the test, not the code** (PROBLEMS.md P-04; ~a quarter of "verified" SWE-bench-Pro patches are actually wrong this way). A self-graded suite cannot catch a self-serving test edit — the grader and the cheater are the same agent. v0.4.a closes the vector with `mmd --sealed`: a separate **TESTER** sub-agent derives acceptance tests *blind to the implementation*, MMD **seals** them with a sha256 manifest, the **CODER** (auto-dev) implements against a dir it is told is read-only, and MMD **verifies** the seal afterwards — any tampered/removed sealed file fails the slice, named and loud. Enforcement lives at the MMD layer because the auto-dev workflow is gitignored (`_bmad/`), so it could not be hardened in the workflow itself (see ADR-026).
**The pattern**: an *oracle-independence* sibling of the honesty rules. "Tests pass" is only trustworthy when the test is an oracle the implementer **does not control**. The moment the same agent can both write the assertion and edit it to suit the implementation, "green" measures compliance-with-itself, not correctness — exactly the "'I ran X' is not 'X passed'" gap (ai-coding §I), one level up: "'the agent's tests pass' is not 'an independent oracle passes'". The fix is structural (a blind author + a tamper-evident seal), not exhortative (telling the agent "don't cheat").
**Rule**:
  1. **Separate the test author from the implementer for anything that must be trusted.** The oracle's tests MUST be written by an agent that has not seen and will not write the implementation (the TESTER is told, emphatically, not to implement). An author who also implements writes tests that rationalize the implementation.
  2. **Seal the oracle and verify it after, by content hash — do not rely on instructions.** Record `{ relPath: sha256 }` before the coder runs; re-hash after. A `tampered`/`removed` file is a *detected failure*, not a warning: fail the slice, name the files, never mark it done (anti-P-04). The read-only prompt is a courtesy; the seal is the enforcement.
  3. **`added` is not `tampered`.** A coder legitimately adds its own helper tests; only weakening/deleting the *sealed* files breaks the seal. Over-strict enforcement (forbidding any new file) trains agents to fight the harness instead of the problem.
  4. **Honest at every branch — never a silent "sealed OK".** Tester-failed, empty-seal (the tester wrote nothing), coder-error, tamper, and a failing sealed re-run each surface explicitly with an exit code (universal §VI). An empty oracle proves nothing and MUST abort, not pass.
  5. **Enforce where your code is committed.** When the thing to harden lives in a gitignored / regenerated substrate (here `_bmad/`), wrap it from the committed layer (MMD) rather than editing the substrate — otherwise the guard is uncommitted, untested, and wiped on the next install (L-009 / L-021 design-vs-substrate echo).
  6. **Generalizes to every "the agent verified it" claim in MMD.** Reality Check, `/qa`, future golden-trace / property oracles: if the agent under test can edit the check, the check is a soft oracle — make the verifier independent and tamper-evident, or treat its green as unproven.
**To promote if**: 3 reuses validated (counter: 0) — candidate to promote to `testing.md` as "a test the implementer can edit is a soft oracle; trusted verification needs an independent author + a tamper-evident seal." Until then, sits here as the sealed-test-oracle lesson.
**Category**: testing, ai-coding, oracle-independence, subprocess-control, design-vs-implementation
**Applies to**: mmd "<dream>", mmd --here, any-claude-spawn
**Keywords for matching**: sealed, sealed test, oracle, tamper, manifest, sha256, seal, rewrite the test, P-04, false positive, independent oracle, tester, coder, blast radius, verify, acceptance tests, self-graded, blind, read-only, auto-dev, SWE-bench

---

## L-024 — A resolved import graph beats fragment-grep for impact, and a full AST wasn't worth a dependency

**Status**: active (1 occurrence — surfaced upgrading the v0.4.a blast-radius stub to v0.4.c, 2026-06-01)
**Date**: 2026-06-01
**Origin**: v0.4.a shipped `computeBlastRadius` as an honest fragment-grep stub (ADR-026): it matched filename substrings inside import/require lines. v0.4.c (ADR-027) replaced it with a resolved, transitive import graph. The stub was wrong in BOTH directions — over-counting (a filename mentioned only in a comment or string; a basename collision conflating `./helper.js` and `../helper.js`) and under-counting (no path resolution, and no transitive reach, so a change's true reach through a chain stayed invisible — the exact P-05 gap).
**The pattern**: an "honest stub graduates to honest accuracy" sibling of L-009 (walking-skeleton scope is deliberately partial, not the true boundary). The first cut was advertised as a stub with a documented limitation; the upgrade closes the limitation WITHOUT overselling — "import-graph accurate", not "AST-accurate", with the residual gap (computed/runtime specifiers, re-export aliasing, non-JS importers) stated plainly. The dependency question generalizes: when a constrained grammar (module specifiers) needs parsing, a small hand-rolled extractor + resolver can beat a heavyweight parser dependency — the same call already made twice for YAML-lite.
**Rule**:
  1. **For impact analysis, resolve don't grep.** A substring match on import lines over- and under-counts; resolve each specifier to a concrete file (literal, `+ext`, `/index`) against the real file set, and conflate nothing (`./x` ≠ `../x`). A filename in a comment or string is NOT a dependency — strip comments and match only the real import forms.
  2. **"Reach" means the TRANSITIVE reverse closure, not one hop.** Direct importers are a starting point; the blast radius is everything that imports the change directly OR through a chain. Invert the graph and BFS/DFS with a visited set so cycles can't hang.
  3. **Weigh a dependency against the vanilla-stack convention, especially for advisory features.** A full AST parser (acorn/babel) is more accurate, but for an advisory map that never gates a run it isn't worth a permanent dependency in a zero-dep repo. The YAML-lite precedent (hand-rolled twice) is the bar: a small, tested, hand-rolled parser for a constrained grammar over a heavyweight dep.
  4. **Name the claim honestly and document the gap.** "Import-graph accurate" ≠ "AST-accurate". State what the no-dep approach does NOT catch (computed/runtime specifiers, re-export aliasing through computed names, non-JS importers) in the ADR — a documented limit is not a bug; an undocumented one erodes trust (universal §VI).
**To promote if**: 3 reuses validated (counter: 0) — candidate for `architecture.md` or `ai-coding.md` as "resolve don't grep for impact; weigh every dependency against the zero-dep convention; name accuracy claims honestly and document the residual gap." Until then it sits here as the import-graph blast-radius lesson.
**Category**: architecture, ai-coding, dependency-discipline, observability, design-vs-implementation
**Applies to**: mmd --sealed, mmd --here, blast radius, any-impact-analysis
**Keywords for matching**: blast radius, import graph, computeBlastRadius, transitive, reverse closure, resolveSpecifier, parseSpecifiers, AST, acorn, babel, vanilla-stack, zero-deps, YAML-lite, P-05, fragment grep, stub, residual gap, dependency, advisory

---

## L-025 — A passing test suite is not proof of asked-for behavior; an independent judge against the dream catches P-09

**Status**: active (1 occurrence — surfaced building the v0.4.d behavioral oracle, 2026-06-01)
**Date**: 2026-06-01
**Origin**: the sealed-test oracle (v0.4.a–c, L-023/ADR-026) hardened MMD against P-04 — the agent rewriting its own check — by sealing an *independent* test suite and re-running it. But "the sealed tests pass" answers a narrower question than "the implementation does what was asked". A suite — even an independent, tamper-evident one — can be adequate-but-incomplete: an acceptance criterion the tester didn't cover, an edge of the dream no assertion touches, a requirement met in letter but not spirit. All go green. That is P-09. v0.4.d (ADR-028) added an LLM-as-judge that grades the implementation against the dream/ACs *after* the deterministic gate passes.
**The pattern**: a sibling of L-023 ("the agent verified it" is only as strong as the verifier's independence) one level up — there the failure was the agent editing the check; here the check itself is *complete-looking but incomplete*. Two different oracles answer two different questions: the deterministic sealed test asks "does the code satisfy these assertions?", the behavioral judge asks "does the code do what was asked?". Green on the first is necessary, not sufficient. The same honesty discipline as the 5-Whys (L-016, ADR-011) governs the judge's failure mode: an unreadable verdict escalates to a human, it never fabricates a pass.
**Rule**:
  1. **Treat "tests pass" as necessary, not sufficient.** A green suite proves the code does what the tests *check*, not what was *asked*. Where correctness against intent matters, add a second oracle that grades against the request (the dream / ACs), with the test suite as evidence — not as the bar.
  2. **The behavioral oracle runs BEHIND the deterministic one, never instead of it.** The judge is non-deterministic and softer; run it strictly downstream of the hard gate (seal intact + tests green). A tamper or a red test still fails first (exit 6) before the judge speaks. The worst a flaky judge can do is over-flag for human review (exit 7) — it can never wave through a tamper or a red test.
  3. **Sacred fallback: unreadable → uncertain, NEVER met.** Any unparseable/empty/odd verdict, spawn error, timeout, or non-zero exit resolves to `uncertain` with an explicit reason and escalates (exit 7). Mirror the 5-Whys escalate-on-unparseable; never invent a confident `met`. The parser is pure and never throws.
  4. **Make the two failures distinguishable.** A tamper/seal/red-test failure (exit 6) and a behavioral gap (exit 7) are different signals to a human or CI — give them distinct exit codes and name which one fired. Write the per-AC verdict to `status.json` so the gap is inspectable, not just a code.
  5. **Name the softness; defer the softeners explicitly.** A single LLM judge is non-deterministic — say so (ADR), and note the obvious next steps (`--judge-advisory` warn-only mode, multi-judge majority vote) as deferred rather than re-discovering them. A documented limit is not a bug; an undocumented one erodes trust (universal §VI).
**To promote if**: 3 reuses validated (counter: 0) — candidate for `ai-coding.md` as "tests-pass ≠ asked-for; add a behavioral oracle behind the deterministic gate; unreadable → escalate, never a fabricated pass." Until then it sits here as the LLM-judge behavioral-oracle lesson.
**Category**: testing, ai-coding, oracle-independence, verification, honesty
**Applies to**: mmd --sealed, mmd --here, any-claude-spawn, any "the agent verified it" claim
**Keywords for matching**: judge, LLM-as-judge, behavioral oracle, P-09, sealed, buildJudgePrompt, parseJudgeVerdict, met, not-met, uncertain, sacred fallback, exit 7, exit 6, behavioral gap, tests pass, asked-for behavior, five-whys, escalate, non-determinism, judge-advisory, multi-judge

---

## L-026 — A detached run needs a push signal; polling is the symptom of a missing fan-out

**Status**: active (1 occurrence — surfaced building the v0.5.a Conductor notifications, 2026-06-01)
**Date**: 2026-06-01
**Origin**: MMD runs auto-dev detached (`setsid … mmd --here "<dream>"`) for 30–90 minutes. The recurring user feedback — "I keep having to ask where things are" — was really a missing *push*: the user kept polling `git log` / `status.json` / `pgrep` to discover an end-state the run already knew. v0.5.a (ADR-029) added an opt-in, best-effort webhook fan-out (`lib/conductor/notify.js`) that POSTs a ✅/❌ payload on run done/failed when `MMD_NOTIFY_URL` is set.
**The pattern**: when one side of a system knows an event and the other side is reduced to polling for it, the fix is a **push from the knower**, not a better poller. A long-running detached process is exactly that asymmetry — it owns the completion moment; make it announce it. The same shape recurs anywhere a producer's terminal state is being polled (CI, deploys, queues).
**Rule**:
  1. **Push the terminal event from the side that owns it.** A detached/long-running run must emit its own done/failed signal; do not make the user reconstruct it from side artifacts. Polling is the smell.
  2. **A side channel must be opt-in and best-effort — never part of the outcome.** Gate it on an explicit env/config (no surprise egress; default byte-for-byte unchanged), and make a delivery failure degrade to a logged line — never change the run's exit code or status. The sender never throws and never blocks beyond a short bounded timeout (`AbortController` + race).
  3. **Egress carries metadata only.** The payload is user-configured egress to the user's own sink — slice/state/summary/ts, no secrets/env/file contents (security.md, least disclosure). Never fabricate a summary you don't have; use a neutral phrase (universal §VI).
  4. **Ship the cleanest/safest brick of a big layer first.** Of the v0.5 Conductor pieces, notifications are purely additive (they don't touch the spawn), so they shipped before the riskier `stream-json` context monitor. When a layer has several candidate slices, the additive/opt-in/best-effort one is the lowest-risk first step.
**To promote if**: 3 reuses validated (counter: 0) — candidate for `architecture.md` or `observability.md` as "push terminal events from the owner; side channels are opt-in, best-effort, metadata-only." Until then it sits here as the Conductor-notifications lesson.
**Category**: observability, architecture, error-handling, security, ai-coding
**Applies to**: mmd --here, mmd greenfield, any detached/long-running run, any "where is it / is it done" poll
**Keywords for matching**: notification, notify, MMD_NOTIFY_URL, webhook, ntfy, push, fan-out, Conductor, Layer 6, detached, run_done, run_failed, best-effort, opt-in, shouldNotify, buildNotification, sendNotification, AbortController, timeout, polling, proactive feedback, egress, least disclosure
