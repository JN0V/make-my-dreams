# Session handover

> **Read this first** when picking up the project across a context switch (Cowork ↔ Claude Code, Sonnet ↔ Opus, fresh session, new collaborator). It transfers the **intent** (what's next + why), not just the **state** (state is in git).
> Updated: 2026-05-31 (Sunday), end of a multi-session arc that landed v0.2.4 → v0.3.2 (v0.3 Dream Catcher complete).

---

## State at handover

> The block between the two markers below is mechanical and machine-derived.
> Run `mmd handover --tests <N>` to refresh it — do NOT hand-edit it (that hand
> maintenance is the drift this command exists to kill: this block said "17
> active lessons" while the parser counted 13). Everything OUTSIDE the markers is
> human intent and is preserved byte-for-byte.

<!-- mmd:handover:state:start -->
- **Latest tag**: `v0.3.2`
- **Branch**: `main`
- **Version**: `0.3.2` (package.json)
- **Active lessons**: 16 (L-001, L-003, L-004, L-005, L-006, L-007, L-008, L-009, L-012, L-015, L-017, L-018, L-019, L-020, L-021, L-022)
- **ADRs**: 23 (ADR-001..ADR-023)
- **Tests**: 1224 passing
- **Recent commits**:
  - `85682ba test(v0.3.b): Phase 4 review — bin-level trigger tests + DI/comment fixes`
  - `99ec35f docs(v0.3.b): ADR-023 + L-022 + README CLI/profile + bump 0.3.2 (AC-6)`
  - `41434f6 feat(v0.3.b): thread MMD_PROFILE into the /api/catch/confirm launch (AC-4)`
  - `9b30a01 feat(v0.3.b): TTY-gated Dream Catcher trigger in the greenfield CLI (AC-3)`
  - `06d5f48 feat(v0.3.b): buildPrompt consumes MMD_PROFILE; Kid gets safe-by-default (AC-4/AC-5)`
- **Generated**: 2026-05-31 by `mmd handover` (mechanical block — intent sections are human-authored)
<!-- mmd:handover:state:end -->

## What just shipped (chronological, this multi-session arc)

| Tag | Slice purpose | Closure |
|---|---|---|
| v0.2.4 | Project Onboarder (`mmd discover`) | L-009 walking-skeleton scope |
| v0.2.6 | Medium gStack (`mmd qa/cso/document-release`) | L-012 medium option |
| v0.2.7 | Composer minimal (lessons → prompt injection) | autolearning §6.5 compose-side |
| v0.2.8 | Five Whys Escalation (`mmd unblock`) | stuck-recovery primitive |
| v0.2.9 | MMD-on-MMD findings closure (cso LOW-1/2, qa High-1/2/3) | L-017 + dogfood-surfaced findings |
| v0.2.10 | Composer categorization (`Category` + `Applies to`) | L-018 predictive (scale-resilience) |
| v0.2.11 | Prompt-grounding check (`lib/here-mode` precheck) | L-015 code-enforced |
| v0.2.12 | Documentalist lite (`mmd document-lessons`) | autolearning §6.5 promote-side |
| v0.2.13 | 3 pillars install hardening (Spec Kit + OpenSpec + Ralph Loop) | L-012 fully closed |
| v0.2.14 | WIP-salvage stall signal (`wip-uncommitted-since-N-min`) + composer L-015 regression-lock | L-019 closed |
| v0.2.15 | Human-readable branch names (`--label` + boilerplate-stripped fallback) + constitution §VII | §VII written AND embodied |
| v0.2.16 | `mmd handover` — auto-refresh the mechanical State block, never fabricate intent | L-020 closed (1st `--label` dogfood) |
| **v0.3.0** | **Dream Catcher walking skeleton** — web dream → profile → autonomous `bmad-product-brief` scope → confirm → auto-dev | v0.3.a-1 (1st v0.3 milestone; verified end-to-end with a real BMAD call) |
| **v0.3.1** | **Dream Catcher dial + scope editing** — Autonome/Équilibré/Guidé (0/1/2–3 turns) + `/api/catch/edit` | v0.3.a-2 (Dream Catcher CORE complete; guided multi-turn verified end-to-end) |
| **v0.3.2** | **Dream Catcher CLI surface** (TTY-gated `mmd "<dream>"` + `--catch`/`--no-catch`) + `MMD_PROFILE` threading (Kid → safe-by-default in the build prompt) | v0.3.b — **v0.3 COMPLETE: web + CLI + meaningful profile** |

**Plus an auto-promotion event** (post-v0.2.12, pre-v0.2.13): `mmd document-lessons` auto-promoted L-002 (claude -p stdout buffering) and L-016 (MMD_TIMEOUT_MS + spec-polish) into `ai-coding.md`, generated ADR-015 + ADR-016. **First time MMD modified its own constitution autonomously based on accumulated runtime data.**

## Planned next (in order)

1. ~~**L-019 candidates**~~ — **DONE in v0.2.14.**
   - **(b) WIP-salvage stall signal**: shipped. `wip-uncommitted-since-N-min` added to the closed enum + detector (`lib/conductor/stall-detector.js`, threshold `MMD_STALL_WIP_UNCOMMITTED_MIN` default 15, injectable never-throwing `gitWorktreeDirtyFn`); fires only on `dirty tree && lastCommitAge>threshold`. Flows through `mmd unblock` with a signal-keyed 5-Whys hint recommending `escalate-to-user` + `git stash push -u` (no new closed action; sacred fallback intact). NB: the hint lives in `lib/conductor/five-whys-prompt.js` (SRP-correct), not `unblock.js`.
   - **(a) composer migration accuracy**: investigation found this was **already-resolved**. The v0.2.h-launch miss was a *temporal* gap — context-wiring (`subcommand: 'mmd --here'`) and L-015's `Applies to` field both shipped later in v0.2.l (`fda5665` + `451e6e1`), closing it incidentally. Verified empirically: L-015 matches today. Shipped a **regression-lock test only** (`test/integration/composer-l015-regression.test.js`), no composer code change.

2. ~~**L-020 — `mmd handover`**~~ — **DONE in v0.2.16.** Subcommand refreshes ONLY the mechanical State block (tag, branch, version, lesson/ADR counts, recent commits) between `<!-- mmd:handover:state:* -->` markers; intent sections stay human-authored (§VI). Test count via `--tests N` or honest placeholder (no auto `npm test` — SRP). Pure builders in `lib/handover/{build-state-block,rewrite-markers}.js`, entry `bin/handover.js`. Run `mmd handover --tests <N>` after each slice instead of hand-editing the block (it caught a 17→14 stale-count drift on first use). See ADR-020.

3. **v0.3 Dream Catcher** — design FROZEN in [`SPEC_V03A.md`](SPEC_V03A.md), being built in phases:
   - **v0.3.a-1 — DONE (v0.3.0).** Walking skeleton: web `mmd serve` → dream → profile (1st question) → ONE autonomous `bmad-product-brief` call (headless, Kid-aware) → scope card → confirm → existing auto-dev. Surface-agnostic core `lib/dream-catcher/{session,elicit,parse-reply,profile}.js`. Routes `/api/catch/{start,answer,confirm}` (CSRF/Host-guarded). Honest fallback to verbatim dream. Verified end-to-end with a REAL BMAD call (scope returned `profile:Kid, fallback:false`). See [`SPEC_V03A1.md`](SPEC_V03A1.md), ADR-021, L-021.
   - **v0.3.a-2 — DONE (v0.3.1).** Involvement **dial** (`lib/dream-catcher/level.js`: Autonome/Équilibré-default/Guidé = 0/1/2–3 turns) + **scope editing** (`/api/catch/edit`). `/answer` is now **state-driven** (session decides profile vs level vs clarify; returns `next ∈ level|question|scope`), keeping the frozen SPEC_V03A API. Guided multi-turn verified end-to-end with real BMAD calls (Q2 built on Q1's answer; scope tailored; edit replaced text). See [`SPEC_V03A2.md`](SPEC_V03A2.md), ADR-022. **Dream Catcher CORE is now complete.**
   - **v0.3.b — DONE (v0.3.2).** CLI/TTY surface: `lib/dream-catcher/cli-driver.js` runs the SAME session core over readline; greenfield `mmd "<dream>"` is TTY-gated (`shouldCatch = --catch || (isTTY && !--no-catch)`, never under `--here`; non-TTY/CI skips; `--catch` on non-TTY → exit 2). `MMD_PROFILE` now threaded into the auto-dev subprocess and CONSUMED in `buildPrompt` (Kid → safe-by-default directive; verified directly). See [`SPEC_V03B.md`](SPEC_V03B.md), ADR-023, L-022. **Dream Catcher is complete on both surfaces with a profile that shapes the build.**
   - **Design facts already proven (don't re-investigate):** `bmad-product-brief` is the backbone (headless, autonomous, convergent, auto-applies Kid safe-by-default); headless `claude -p` has NO stdin, so guided mode is MMD-orchestrated *stateless per-turn* calls (turn 1 = "ask ONE question", final = "synthesize scope"); parsing is deterministic via output tags because MMD controls each turn's intent (L-021).

4. **v0.3.c (optional follow-up) — full profile→constitution binding.** Today `MMD_PROFILE` is consumed minimally (the build prompt states the profile + injects the Kid safe-by-default directive). The COMPLETE version reads `constitution-bindings.yaml` at runtime and injects the matching modules (`kid.md`/`pro.md`/`safe-by-default`) into the auto-dev prompt via the composer. Deferred from v0.3.b on purpose (composer evolution, its own slice). This is the only acknowledged v0.3-adjacent follow-up — everything in the frozen [`SPEC_V03A.md`](SPEC_V03A.md) is shipped.

## Operational rules (non-evident, MUST apply)

- **`MMD_TIMEOUT_MS=0`** for any `mmd --here` real-implementation slice (Standard engine). Default is 30 min = kills mid-Phase-1. (Now promoted to `ai-coding.md` via the L-016 auto-promotion event.)
- **Spec-frozen prompt directive**: every `mmd --here "<dream>"` whose dream references a `SPEC_V02X.md` MUST include the explicit text `"SPEC IS FROZEN, do NOT edit it. Skip Party Mode, go DIRECTLY to implementation."` Otherwise auto-dev enters the spec-polish trap (also L-016, also promoted).
- **`MMD_DREAM_MAX_LEN=4000`** for non-trivial dreams (default 500 chars too tight for RESUME prompts).
- **Incremental commits per AC**: prompt MUST explicitly say `"CRITICAL: commit incrementally per AC (L-019 prevention)."` Otherwise auto-dev bundles all work into a single end-of-run commit; if killed mid-run = WIP lost.
- **L-015 grounding check now enforced**: `mmd --here` refuses launch (exit 6) if the dream references a file that doesn't exist on the slice's base SHA. Verify SPEC files are on main before launch (or `MMD_SKIP_GROUNDING=1` to bypass, NOT recommended).
- **Grounding false-trip on OUTPUT paths (hit on v0.2.n launch)**: the grounding regex (`lib/here-mode/extract-file-refs.js`) matches `SPEC_*.md`, `docs/**.md`, `.specify/memory/**.md`, and root tokens (`README.md`, `package.json`, …) — it can't tell an *input* file (must exist) from an *output* file the slice will *create*. So do NOT cite a to-be-created `docs/adr/0NN-slug.md` with its literal `.md` path in the dream; describe it as "a new ADR numbered 0NN under the ADR folder" and let auto-dev read the exact path from SPEC §3. (`.js`/`.ts` paths are not matched, so citing new test/lib files is fine.)
- **L-003 (concurrent worktree ops)**: while auto-dev runs on slice in main worktree, any side-work goes through `git worktree add ../make-my-dreams-side <branch>`. Multiple workmtree are fine.
- **L-006 (claude -p zombies)**: before launching, always `pgrep -af "claude -p"` to check for survivors from previous runs.

## Special considerations

- **Git history was rewritten** on 2026-05-30 via `git filter-repo --mailmap` to consolidate all author emails to `230834992+JN0V@users.noreply.github.com`. SHAs from before the rewrite are stale. If you saw a SHA in old chat logs that doesn't match the current `git log`, it's because of this rewrite. All 5 tags were force-pushed.
- **Sandbox / claude -p oddities seen in this arc**:
  - `pgrep -f "claude -p"` regex sometimes misses an alive claude because of how the cmdline matches. Use `pstree -p <node-pid>` to be sure.
  - Bash MCP timeouts (45s max) can trigger silent retries of the WHOLE command. Make launch commands minimal: just `setsid bash -c "..." & disown; echo "launched"`. Do verification in separate calls.
- **`.gstack/` is gitignored** (cso/qa/document-release skill output dir). Don't commit it.
- **`mmd-discovery-report.md`** is gitignored at root — `mmd discover` regenerates it on demand.
- **Bun + Node 20** must be in PATH for `mmd ship/qa/cso/document-release/document-lessons` to work. Use `PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH"` prefix when launching from non-interactive contexts.

## How to continue (concrete)

If you're picking up to do **L-019 (next slice)**:

```bash
cd ~/Documents/make-my-dreams
# 1. Verify state
git status --porcelain=v1  # should be empty
mmd --version              # should be 0.2.13
npm run test:full | tail -5  # should be 1025 pass

# 2. Draft SPEC_V02N.md (the L-019 closure slice; pattern: read prior SPECs for style)
#    Or ask Claude: "draft SPEC_V02N.md following the same pattern as SPEC_V02M.md
#    closing the L-019 candidates from HANDOVER.md (composer migration accuracy
#    + WIP-salvage stall signal). 5-6 ACs. Commit it on main."

# 3. Launch via mmd --here (apply ALL operational rules above)
setsid bash -c 'export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH" MMD_TIMEOUT_MS=0 MMD_DREAM_MAX_LEN=4000 && cd ~/Documents/make-my-dreams && mmd --here "implement v0.2.n per SPEC_V02N.md. SPEC IS FROZEN. Skip Party Mode, go DIRECTLY to implementation. <change description>. Apply L-001..L-018. CRITICAL: commit incrementally per AC (L-019 prevention). Bump to 0.2.14" > /tmp/v02n-here.log 2>&1' </dev/null >/dev/null 2>&1 & disown ; echo "launched at $(date +%H:%M:%S)"

# 4. Monitor (cadence ~10 min; L-016 rule: read status.json FIRST, then process, then commits)
cat .mmd/shared/status.json | grep state
git log --oneline main..slice/here-implement-v0-2-n-... | head

# 5. When done: tests, push, merge ff-only, tag, push, delete slice, npm install -g .
```

If you're picking up to do **v0.3 Dream Catcher**: it's a bigger design slice. Don't launch directly — first have a design conversation (this is what Opus 4.x is great for). Draft SPEC_V03A.md collaboratively, then launch.

## Where to find fuller context

- `MAKE_MY_DREAMS.md` — scoping doc, v19 iterations of design (~1000 lines, complete rationale)
- `docs/lessons-learned.md` — 16 active lessons (L-001..L-022 minus the promoted/non-active ones; count is now authoritative via `mmd handover`)
- `.specify/memory/constitution/*.md` — 13 modules + the 2 promoted lesson rules in `ai-coding.md`
- `docs/adr/*.md` — 23 ADRs documenting major design decisions (001..023)
- `SPEC_V02*.md` at root — every slice's spec, with full DoD
- `CLAUDE.md` — Layer A diffusion (this is what Claude Code auto-loads at session start; it points to all the above)

## Open questions / pending decisions

- None blocking. v0.3 Dream Catcher scope deserves a design conversation before SPEC; user (Sébastien) wants this for the 13yo daughter scenario.
- L-018's META-rule promotion ("walking-skeleton specs must enumerate scale assumptions in Out-of-scope") is a candidate for direct promotion to `ai-coding.md` — pattern observed 5 times now. Could be done in same slice as L-019 closure.

---

*This file is a session handover. Update it at the end of any context-bridge moment so the next picker-up has the intent, not just the state. If you find yourself updating it often, consider implementing the `mmd handover` subcommand (L-020 candidate).*
