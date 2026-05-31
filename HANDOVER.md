# Session handover

> **Read this first** when picking up the project across a context switch (Cowork ↔ Claude Code, Sonnet ↔ Opus, fresh session, new collaborator). It transfers the **intent** (what's next + why), not just the **state** (state is in git).
> Updated: 2026-05-31 (Sunday), end of a multi-session arc that landed v0.2.4 → v0.2.15.

---

## State at handover

> The block between the two markers below is mechanical and machine-derived.
> Run `mmd handover --tests <N>` to refresh it — do NOT hand-edit it (that hand
> maintenance is the drift this command exists to kill: this block said "17
> active lessons" while the parser counted 13). Everything OUTSIDE the markers is
> human intent and is preserved byte-for-byte.

<!-- mmd:handover:state:start -->
- **Latest tag**: `v0.2.15`
- **Branch**: `slice/here-mmd-handover-subcommand-1780224302`
- **Version**: `0.2.16` (package.json)
- **Active lessons**: 14 (L-001, L-003, L-004, L-005, L-006, L-007, L-008, L-009, L-012, L-015, L-017, L-018, L-019, L-020)
- **ADRs**: 20 (ADR-001..ADR-020)
- **Tests**: 1087 passing
- **Recent commits**:
  - `d3cce8f chore(handover): re-bless ship-help snapshot for v0.2.16 + refresh State`
  - `7236a19 fix(handover): actually add L-020 lesson + refresh State block to 14`
  - `f0228f8 fix(handover): add the L-020 lesson that was lost + refresh State block`
  - `5cc43f4 docs(handover): refresh State block via mmd handover (17 -> 14 active lessons)`
  - `c9d2613 docs(handover): ADR-020 + L-020 + README + bump to v0.2.16`
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

**Plus an auto-promotion event** (post-v0.2.12, pre-v0.2.13): `mmd document-lessons` auto-promoted L-002 (claude -p stdout buffering) and L-016 (MMD_TIMEOUT_MS + spec-polish) into `ai-coding.md`, generated ADR-015 + ADR-016. **First time MMD modified its own constitution autonomously based on accumulated runtime data.**

## Planned next (in order)

1. ~~**L-019 candidates**~~ — **DONE in v0.2.14.**
   - **(b) WIP-salvage stall signal**: shipped. `wip-uncommitted-since-N-min` added to the closed enum + detector (`lib/conductor/stall-detector.js`, threshold `MMD_STALL_WIP_UNCOMMITTED_MIN` default 15, injectable never-throwing `gitWorktreeDirtyFn`); fires only on `dirty tree && lastCommitAge>threshold`. Flows through `mmd unblock` with a signal-keyed 5-Whys hint recommending `escalate-to-user` + `git stash push -u` (no new closed action; sacred fallback intact). NB: the hint lives in `lib/conductor/five-whys-prompt.js` (SRP-correct), not `unblock.js`.
   - **(a) composer migration accuracy**: investigation found this was **already-resolved**. The v0.2.h-launch miss was a *temporal* gap — context-wiring (`subcommand: 'mmd --here'`) and L-015's `Applies to` field both shipped later in v0.2.l (`fda5665` + `451e6e1`), closing it incidentally. Verified empirically: L-015 matches today. Shipped a **regression-lock test only** (`test/integration/composer-l015-regression.test.js`), no composer code change.

2. **v0.3 Dream Catcher conversational** (bigger, 2-4h) — **now the top priority**:
   - Replace `mmd <dream>` CLI arg with a 2-3 turn dialogue that refines the dream before launching. This is THE feature for end users (Sébastien's daughter scenario).
   - Spec not yet drafted. Worth its own session (Opus 4.x ideal here for the conversational design reasoning).

3. **L-020 candidate** (post-Dream Catcher, predictive):
   - `mmd handover` subcommand that auto-generates this file from current state (last tag, last commits, in-flight tasks, recent lessons). Would have produced THIS very file mechanically. Pattern: session handover formalized as a command, not a wiki page.

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
- `docs/lessons-learned.md` — 17 active lessons (L-001..L-019 minus L-002 + L-016 promoted)
- `.specify/memory/constitution/*.md` — 13 modules + the 2 promoted lesson rules in `ai-coding.md`
- `docs/adr/*.md` — 19 ADRs documenting major design decisions (001..019)
- `SPEC_V02*.md` at root — every slice's spec, with full DoD
- `CLAUDE.md` — Layer A diffusion (this is what Claude Code auto-loads at session start; it points to all the above)

## Open questions / pending decisions

- None blocking. v0.3 Dream Catcher scope deserves a design conversation before SPEC; user (Sébastien) wants this for the 13yo daughter scenario.
- L-018's META-rule promotion ("walking-skeleton specs must enumerate scale assumptions in Out-of-scope") is a candidate for direct promotion to `ai-coding.md` — pattern observed 5 times now. Could be done in same slice as L-019 closure.

---

*This file is a session handover. Update it at the end of any context-bridge moment so the next picker-up has the intent, not just the state. If you find yourself updating it often, consider implementing the `mmd handover` subcommand (L-020 candidate).*
