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
**Keywords for matching**: nohup, background subprocess, setsid, tmux, long-running, orphan process

---

## L-002 — `claude -p` does not flush stdout in real-time when redirected to a file

**Status**: active (1 occurrence in v0.2.5 session)
**Date**: 2026-05-17
**Origin**: slice v0.2.5, `/tmp/v025-autodev.log` stayed at 0 bytes for the entire 30+ min run even though commits were happening
**Context**: I redirected `claude -p ... > /tmp/v025-autodev.log 2>&1`. Throughout the run I checked the log and found it empty, which I initially interpreted as "auto-dev hasn't started yet". In reality, `claude -p` buffers its stdout in memory until process exit (or until a flush trigger), so when redirected to a file there is no live trace. The actual progress was visible via `git log <branch>` (auto-dev commits as it works) and via `find ... -mmin -N` (file activity).
**Rule**: do NOT rely on `tail -f` of a `claude -p` stdout redirect to monitor an auto-dev run in progress. Instead, monitor via:
  1. `git log <slice-branch> --oneline` — auto-dev commits atomically as it completes logical steps
  2. `find <repo> -type f -mmin -N -not -path "*/.git/*"` — file modification activity
  3. `_bmad-output/implementation-artifacts/` for techspec + deferred-work files
  4. Process liveness: `pgrep -f "claude -p"` to confirm it's still running
**To promote if**: 5 reuses validated (counter: 1)
**Keywords for matching**: claude -p, stdout buffer, redirect, tail, log file empty, monitor auto-dev, progress visibility

---

## L-003 — Concurrent git operations on the same worktree conflict between auto-dev and human

**Status**: active (1 occurrence in v0.2.5 session)
**Date**: 2026-05-17
**Origin**: slice v0.2.5, I created branch `docs/v19-remote-observability` to commit a scoping update WHILE auto-dev was running on `slice/v0.2.5-mmd-serve` in the same worktree. Auto-dev (or its subprocess) ran `git checkout slice/v0.2.5-mmd-serve` to ensure its working branch was active, which moved `HEAD` while my Edit tools were preparing files. My subsequent `git add && git commit` landed on `slice/v0.2.5-mmd-serve` instead of my intended `docs/v19-remote-observability`. The wrong-branch commit was harmless functionally (the doc still merges to main eventually) but violated branch-based-workflow intent and left an empty `docs/v19-remote-observability` branch that got auto-deleted at the merge step.
**Rule**: while a long-running agent (auto-dev, gStack `/qa`, etc.) is active on branch X in a worktree, do NOT create or operate on other branches in that SAME worktree. Two options:
  1. Wait for the agent to finish before doing other git work in this worktree.
  2. Use `git worktree add ../<repo>-<sidetask>` to create a parallel worktree for the side task. This is the same mechanism v0.9 will use natively for parallel slices (MAKE_MY_DREAMS.md §4.3) — there's no reason not to use it manually beforehand.
**To promote if**: 5 reuses validated (counter: 1) — likely to become a key rule when v0.9 parallel slices ship
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
**To promote if**: 5 reuses validated (counter: 1) — likely to inform the dream-bench design in v0.2b (the bench should assert that auto-dev's Definition of Done was respected)
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
**Keywords for matching**: claude -p zombie, sleeping process, previous auto-dev, single active run, MMD_RUN_ID, process cleanup, SIGTERM SIGKILL

---

## L-007 — Tests must NOT hardcode slugifier output either; use a slug that survives the stopword/dropchars pipeline

**Status**: active (1 occurrence in v0.2 session — discovered AND fixed by auto-dev itself, captured as a lesson rather than handed off)
**Date**: 2026-05-17
**Origin**: slice v0.2, `test/integration/deferred-v01.test.js` initial draft expected `demo/literally-a-dream` for the input `mmd -- --literally-a-dream`. The slugifier drops the `--`, then drops the stopword "a" (`STOPWORDS` in `lib/parse-dream.js`), then rejoins, producing `literally-dream`. The test asserted on the wrong directory name and failed RED. Trivial fix (pick a stopword-free dream like `--literally-my-dream` → `literally-my-dream`), but worth noting.
**Rule**: when an integration test asserts on a slugifier-derived path, choose dream strings whose tokens are NONE of the `STOPWORDS` list (current: `a, an, the, that, on, of, for, to, in, with, and, or`). A safer pattern is to ask the slugifier itself for the expected output: `import { slugify } from '../../lib/parse-dream.js'; const expectedSlug = slugify(dream);` and assert on `demo/${expectedSlug}`. This generalizes L-005: tests must read the SAME source as production code. Hardcoding a path string here is the same antipattern as hardcoding a version string.
**To promote if**: 3 reuses validated (counter: 1) — strong candidate to fold into L-005 as a generalization rather than a separate lesson.
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
**To promote if**: 3 reuses validated (counter: 1) — strong candidate for promotion to `documentation.md` as an explicit rule "Always distinguish design scope from current-implementation scope".
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
**Keywords for matching**: prompt-grounding, conductor, pre-conditions, SPEC_*.md, ff-only no-op, dream file reference, here-mode validation, L-009 pattern third occurrence

---

## L-016 — `MMD_TIMEOUT_MS=1800000` (30 min) default kills Standard auto-dev mid-pipeline + spec-polish trap

**Status**: active (1 occurrence on v0.2.g first launch; same mechanism likely caused v0.2c's premature stop)
**Date**: 2026-05-18
**Origin**: v0.2.g auto-dev was killed at exactly 1800.6 seconds with `state: "failed"` in `.mmd/shared/status.json` and `[mmd] subprocess timed out` in the run log. Tracked the timeout in `bin/mmd.js:291` (and `:594` for the dream path): `timeoutMs: env.MMD_TIMEOUT_MS ? Number(env.MMD_TIMEOUT_MS) : 1_800_000`. The default 30-minute budget is the symptom; the deeper cause is that auto-dev had spent ALL of those 30 min on adversarial review passes against `SPEC_V02G.md` (2 commits: `2839292 docs(spec-v0.2.g): adversarial review pass 1 — F1-F20 addressed` + `a08ed04 docs(spec-v0.2.g): adversarial review pass 2 — G1-G5 addressed`) — never reaching the implementation phase. Comparison with v0.2c (same 30-min wall-clock, same kill): v0.2c's auto-dev produced 2 commits totaling **3970 lines of real implementation** (52 files in `feat(discover): walking skeleton`, then 476 lines of integration tests), while v0.2.g's 2 commits totaled **273 lines edited inside SPEC_V02G.md** — zero implementation. The salvageable WIP refactor (lib/ship/* → lib/skills/_common/*) was sitting unstaged in the working tree when the kill happened; I almost lost it with a `git checkout` before noticing — recovered via `git stash push -u` (separate L-017 candidate if this happens twice).
**The pattern**: two distinct but coupled defects:
  1. **Timeout default too short for Standard engine**: the BMAD adversarial pipeline (3× Party Mode + Phase 2 review + Phase 3 + Phase 4) is ~45-90 min wall-clock on realistic slices. The 30-min default kills it consistently. Either bump the default to 7200000 (2h) or 0 (disabled), or document loudly that Standard runs MUST set `MMD_TIMEOUT_MS=0`.
  2. **Spec-polishing trap**: when the spec already exists and auto-dev is asked to "implement SPEC_V02X.md (authoritative)", it sometimes interprets "authoritative" as "this is the authoritative specification, my first task is to perfect it" → spends entire budget on adversarial review passes against the spec instead of implementing it. v0.2c got lucky (skipped/short-circuited Party Mode, went direct to implementation); v0.2.g did not.
**Rule**:
  1. **Always** set `MMD_TIMEOUT_MS=0` when launching `mmd --here` for a real implementation slice (Standard engine). The 30-min default is only safe for trivial changes (AC-7 dogfood) or `--fast` engine slices.
  2. The prompt to auto-dev MUST explicitly forbid further spec editing when the spec is considered final: include the line `The spec at SPEC_V02X.md is AUTHORITATIVE and FROZEN. Do NOT modify SPEC_V02X.md. Go directly to implementation (Phase 3 / coding).` This is the explicit way to short-circuit the spec-polishing trap.
  3. Operational checklist before `mmd --here` for a real implementation:
     - `MMD_TIMEOUT_MS=0` exported
     - The spec file's path verified to exist on base (L-015 mitigation)
     - The dream prompt explicitly says "spec is frozen, implement"
     - The previous slice's WIP (if any) is salvaged or discarded explicitly
**To promote if**: 3 reuses validated (counter: 1) — strong candidate to promote to `ai-coding.md` as "Standard engine pre-conditions: MMD_TIMEOUT_MS=0 + spec-frozen directive in prompt." A future v0.2.h (Conductor preconditions hardening, see L-015) should also bake in: (a) auto-set `MMD_TIMEOUT_MS=0` for the Standard engine path unless user overrides, (b) detect WIP in the working tree after subprocess exit and surface it rather than letting `here-mode` exit silently.
**Operational note**: this lesson surfaced when Sébastien asked "il faut vraiment qu'on arrive à comprendre pourquoi il s'arrête tout seul" — the answer was sitting in plain sight in `.mmd/shared/status.json` (`engine_metrics.duration_seconds: 1800.6` = pile 30 min). Reading the structured state files BEFORE hypothesizing saves cycles. Add to the operational checklist: when an auto-dev appears to have stopped, FIRST `cat .mmd/shared/status.json` and `tail .mmd/local/runs/*.log` before speculating.
**Keywords for matching**: MMD_TIMEOUT_MS, timeout, 1800, 30 min, subprocess timed out, spec polishing, adversarial review loop, party mode, Phase 1 stuck, auto-dev killed, salvage WIP, status.json failed state
