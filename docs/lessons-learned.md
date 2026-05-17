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

*This file is the project-scoped Layer F of the multi-layer constitution. Per scoping §6.5, when any lesson reaches N=5 validated re-uses, the Documentalist will (a) promote it to the appropriate constitution module, (b) remove it from here, (c) record the promotion event in `docs/adr/` if architectural.*
