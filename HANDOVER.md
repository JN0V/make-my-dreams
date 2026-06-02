# Session handover

> **Read this first** when picking up the project across a context switch (Cowork ↔ Claude Code, Sonnet ↔ Opus, fresh session, new collaborator). It transfers the **intent** (what's next + why), not just the **state** (state is in git).
> Updated: 2026-06-01, end of a multi-session arc that landed v0.2.4 → v0.5.1 (v0.3 Dream Catcher + Layer-C composer + doc-sync + v0.4 Bundle-B complete + v0.5 Conductor: Layer-6 notifications + live context monitor).

---

## State at handover

> The block between the two markers below is mechanical and machine-derived.
> Run `mmd handover --tests <N>` to refresh it — do NOT hand-edit it (that hand
> maintenance is the drift this command exists to kill: this block said "17
> active lessons" while the parser counted 13). Everything OUTSIDE the markers is
> human intent and is preserved byte-for-byte.

<!-- mmd:handover:state:start -->
- **Latest tag**: `v0.7.8`
- **Branch**: `slice/here-polyglot-test-curator-adapters-1780381137`
- **Version**: `0.8.0` (package.json)
- **Active lessons**: 21 (L-001, L-003, L-004, L-005, L-006, L-007, L-008, L-009, L-012, L-015, L-017, L-018, L-019, L-020, L-021, L-022, L-023, L-024, L-025, L-026, L-027)
- **ADRs**: 42 (ADR-001..ADR-042)
- **Tests**: 1779 passing
- **Recent commits**:
  - `e84b158 test(v0.8.0): re-bless version-pinned anchors for 0.8.0 (ship --help snapshot + package.json version assert)`
  - `3345d93 docs(v0.8.0): ADR-042 polyglot Test Curator + README/CLAUDE; bump to 0.8.0 (AC-6)`
  - `51e407f test(v0.8.0): polyglot Test Curator — adapters, capability honesty, JS-unchanged, Python report, Rust refusal`
  - `3e8b692 feat(v0.8.0): genericize the Test Curator core + honest §VIII language gate (AC-3, AC-4)`
  - `19516ac feat(v0.8.0): polyglot Test Curator adapter layer — contract + registry + JS & Python adapters`
- **Generated**: 2026-06-02 by `mmd handover` (mechanical block — intent sections are human-authored)
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
| **v0.3.3** | **Layer-C constitution composer** (`lib/constitution-compose.js`) — `MMD_PROFILE` now injects the real `kid.md`/`pro.md`/`safe-by-default` module text into the build prompt | v0.3.c — profile drives actual constitution modules (verified: Kid prompt 13.6 KB) |
| **v0.3.4** | **`mmd document-readme`** (Documentalist-lite) — regenerates the README's Status + Changelog (from git tag annotations) between markers + a drift report; the `mmd handover` pattern applied to the README | v0.3.d — doc drift closed at the root (drift report: none) |
| **v0.4.0** | **Bundle B — sealed-test oracle** (`mmd --sealed`): tester writes blind acceptance tests → MMD seals (sha256) → coder (auto-dev) → verify (tamper → fail) → re-run + blast-radius stub | v0.4.a — first correctness hardening (anti-P-04); opt-in, MMD-layer |
| **v0.4.1** | **Sealed oracle on `--here`** (`mmd --here --sealed`): extracted surface-agnostic `runSealedPipeline` (coder injected); MMD can seal-test its own slices | v0.4.b — reflexive reach; greenfield unchanged |
| **v0.4.2** | **Import-graph blast radius** — `computeBlastRadius` parses+resolves module specifiers → transitive reverse closure (true P-05 reach); no parser dep | v0.4.c — accurate impact (no comment false-positives, no `./`vs`../` collision, transitive) |
| **v0.4.3** | **LLM-as-judge behavioral oracle** (P-09) — after the sealed-test gate, a judge grades the impl against *what was asked*; not-met/uncertain → exit 7 (distinct from tamper exit 6) | v0.4.d — Bundle B now has BOTH oracles (P-04 deterministic + P-09 behavioral) |
| **v0.5.0** | **Conductor brick 1 — Layer-6 notifications** (opt-in `MMD_NOTIFY_URL`): best-effort POST ✅/❌ on run done/failed to a user webhook (ntfy/Slack/…) | v0.5.a — the proactive-feedback fix for detached runs (no spawn change, never breaks a run) |
| **v0.5.1** | **Conductor brick 2 — live context monitor** (opt-in `--monitor`): stream-json `usage` → context % in `status.json` + `READY_FOR_HANDOFF`/`context_70` at 70% | v0.5.b — the Conductor can SEE; default spawn (bootstrap path) untouched; auto-handoff still future |

**Plus an auto-promotion event** (post-v0.2.12, pre-v0.2.13): `mmd document-lessons` auto-promoted L-002 (claude -p stdout buffering) and L-016 (MMD_TIMEOUT_MS + spec-polish) into `ai-coding.md`, generated ADR-015 + ADR-016. **First time MMD modified its own constitution autonomously based on accumulated runtime data.**

## Planned next (in order)

1. ~~**L-019 candidates**~~ — **DONE in v0.2.14.**
   - **(b) WIP-salvage stall signal**: shipped. `wip-uncommitted-since-N-min` added to the closed enum + detector (`lib/conductor/stall-detector.js`, threshold `MMD_STALL_WIP_UNCOMMITTED_MIN` default 15, injectable never-throwing `gitWorktreeDirtyFn`); fires only on `dirty tree && lastCommitAge>threshold`. Flows through `mmd unblock` with a signal-keyed 5-Whys hint recommending `escalate-to-user` + `git stash push -u` (no new closed action; sacred fallback intact). NB: the hint lives in `lib/conductor/five-whys-prompt.js` (SRP-correct), not `unblock.js`.
   - **(a) composer migration accuracy**: investigation found this was **already-resolved**. The v0.2.h-launch miss was a *temporal* gap — context-wiring (`subcommand: 'mmd --here'`) and L-015's `Applies to` field both shipped later in v0.2.l (`fda5665` + `451e6e1`), closing it incidentally. Verified empirically: L-015 matches today. Shipped a **regression-lock test only** (`test/integration/composer-l015-regression.test.js`), no composer code change.

2. ~~**L-020 — `mmd handover`**~~ — **DONE in v0.2.16.** Subcommand refreshes ONLY the mechanical State block (tag, branch, version, lesson/ADR counts, recent commits) between `<!-- mmd:handover:state:* -->` markers; intent sections stay human-authored (§VI). Test count via `--tests N` or honest placeholder (no auto `npm test` — SRP). Pure builders in `lib/handover/{build-state-block,rewrite-markers}.js`, entry `bin/handover.js`. Run `mmd handover --tests <N>` after each slice instead of hand-editing the block (it caught a 17→14 stale-count drift on first use). See ADR-020.

3. **v0.3 Dream Catcher** — design FROZEN in [`docs/specs/SPEC_V03A.md`](docs/specs/SPEC_V03A.md), being built in phases:
   - **v0.3.a-1 — DONE (v0.3.0).** Walking skeleton: web `mmd serve` → dream → profile (1st question) → ONE autonomous `bmad-product-brief` call (headless, Kid-aware) → scope card → confirm → existing auto-dev. Surface-agnostic core `lib/dream-catcher/{session,elicit,parse-reply,profile}.js`. Routes `/api/catch/{start,answer,confirm}` (CSRF/Host-guarded). Honest fallback to verbatim dream. Verified end-to-end with a REAL BMAD call (scope returned `profile:Kid, fallback:false`). See [`docs/specs/SPEC_V03A1.md`](docs/specs/SPEC_V03A1.md), ADR-021, L-021.
   - **v0.3.a-2 — DONE (v0.3.1).** Involvement **dial** (`lib/dream-catcher/level.js`: Autonome/Équilibré-default/Guidé = 0/1/2–3 turns) + **scope editing** (`/api/catch/edit`). `/answer` is now **state-driven** (session decides profile vs level vs clarify; returns `next ∈ level|question|scope`), keeping the frozen SPEC_V03A API. Guided multi-turn verified end-to-end with real BMAD calls (Q2 built on Q1's answer; scope tailored; edit replaced text). See [`docs/specs/SPEC_V03A2.md`](docs/specs/SPEC_V03A2.md), ADR-022. **Dream Catcher CORE is now complete.**
   - **v0.3.b — DONE (v0.3.2).** CLI/TTY surface: `lib/dream-catcher/cli-driver.js` runs the SAME session core over readline; greenfield `mmd "<dream>"` is TTY-gated (`shouldCatch = --catch || (isTTY && !--no-catch)`, never under `--here`; non-TTY/CI skips; `--catch` on non-TTY → exit 2). `MMD_PROFILE` now threaded into the auto-dev subprocess and CONSUMED in `buildPrompt` (Kid → safe-by-default directive; verified directly). See [`docs/specs/SPEC_V03B.md`](docs/specs/SPEC_V03B.md), ADR-023, L-022. **Dream Catcher is complete on both surfaces with a profile that shapes the build.**
   - **Design facts already proven (don't re-investigate):** `bmad-product-brief` is the backbone (headless, autonomous, convergent, auto-applies Kid safe-by-default); headless `claude -p` has NO stdin, so guided mode is MMD-orchestrated *stateless per-turn* calls (turn 1 = "ask ONE question", final = "synthesize scope"); parsing is deterministic via output tags because MMD controls each turn's intent (L-021).

4. ~~**v0.3.c — full profile→constitution binding**~~ — **DONE (v0.3.3).** `lib/constitution-compose.js` (Layer C): hand-rolled YAML-lite parser for `constitution-bindings.yaml` + `resolveModules({profile})` (defaults ∪ profiles[profile]) + `composeConstitution` (reads `.specify/memory/constitution/*.md`, graceful fallback to the v0.3.b minimal line). `buildPrompt` injects it when `MMD_PROFILE` set. Verified: Kid prompt carries real `safe-by-default.md`+`kid.md` text; Pro carries `pro.md`. Profile dimension only — engine/context/skill composition is a future extension of the resolver. See [`docs/specs/SPEC_V03C.md`](docs/specs/SPEC_V03C.md), ADR-024.

5. ~~**Documentalist-lite (doc-sync)**~~ — **DONE (v0.3.4).** `mmd document-readme` ([`docs/specs/SPEC_V03D.md`](docs/specs/SPEC_V03D.md), ADR-025): regenerates the README's **Status** block (version/tag/ADR/lesson/slice/test counts) and a **Changelog** block (one line per git tag from its annotation, newest-first) between `<!-- mmd:readme:status:* -->` / `<!-- mmd:readme:changelog:* -->` markers, plus a stdout **drift report** (SUBCOMMANDS+flags vs README). Reuses `lib/handover/rewrite-markers.js` + the count helpers — the `mmd handover` pattern applied to the README. Human prose (intro, History narrative, command docs) untouched. **Run `mmd document-readme --tests N` after each slice** (like `mmd handover`). The one-off manual meta-fix (commit `4c46318`) is now machine-maintained. Drift report currently: none.

6. **v0.4 — Bundle B (sealed-test oracle)** — **STARTED in v0.4.0 (v0.4.a).** Investigation showed v0.4-as-roadmapped was partly already-done (state, orchestration) and partly **blocked** (70% auto-handoff = `claude -p` token opacity → deferred to v0.5 Conductor). So v0.4 was rescoped to its high-value buildable core: the **sealed-test oracle** `mmd --sealed` ([`docs/specs/SPEC_V04A.md`](docs/specs/SPEC_V04A.md), ADR-026, L-023) — opt-in, MMD-layer (`_bmad/` is gitignored). `lib/sealed-tests/{manifest,tester-prompt,blast-radius}.js`. Verified: seal catches weaken+delete → `intact:false`.
   - **v0.4.b — DONE (v0.4.1):** `--sealed` now works on `--here` ([`docs/specs/SPEC_V04B.md`](docs/specs/SPEC_V04B.md)) via the extracted `runSealedPipeline` — MMD can seal-test its own slices (`mmd --here --sealed`).
   - **v0.4.c — DONE (v0.4.2):** import-graph blast radius ([`docs/specs/SPEC_V04C.md`](docs/specs/SPEC_V04C.md), ADR-027, L-024) — `computeBlastRadius` resolves specifiers + returns the transitive reverse closure; no parser dep (vanilla-stack); verified (no comment false-positive, no `./`vs`../` collision, transitive chain).
   - **v0.4.d — DONE (v0.4.3):** LLM-as-judge behavioral oracle ([`docs/specs/SPEC_V04D.md`](docs/specs/SPEC_V04D.md), ADR-028, L-025) — after the deterministic sealed-test gate, a judge grades the impl against *what was asked* (the dream/ACs), met/not-met/uncertain; not-met/uncertain → exit 7; unparseable → uncertain (sacred fallback, never a fabricated pass). Bundle B now has BOTH oracles (P-04 + P-09). **Only remaining v0.4.x candidate:** `--sealed` as a Standard-engine default (deliberately left opt-in — it would add a tester+judge LLM cost to every Standard run).

7. **v0.5 Conductor — bricks 1 + 2 DONE.** Token-visibility for the 70% auto-handoff was **DE-RISKED** (`claude -p --output-format stream-json --verbose` emits `usage` + the model in the `system` event → context window known, `[1m]` = 1M).
   - **v0.5.a — DONE (v0.5.0):** Layer-6 notifications (`MMD_NOTIFY_URL`).
   - **v0.5.b — DONE (v0.5.1):** live context monitor (opt-in `--monitor`) — stream-json `usage` → `status.json.context` (model/window/tokens/pct) + `READY_FOR_HANDOFF`/`context_70` at `MMD_HANDOFF_THRESHOLD` (0.70). `lib/conductor/stream-parse.js` (pure). **The default spawn is byte-for-byte untouched** (opt-in protects the bootstrap — `--output-format` only in the monitor branch). See [`docs/specs/SPEC_V05B.md`](docs/specs/SPEC_V05B.md), ADR-030, L-027.
   - **NEXT in v0.5:** (a) the actual **auto-handoff/resume** — but it needs MMD to orchestrate auto-dev in steps (auto-dev is a monolithic BMAD call today; "handoff of what" — deemed low-value in v0.4); honestly, the monitor's `READY_FOR_HANDOFF` is an early-warning, and full resume is a big design question. (b) **Bundle C** (observability/HITL, per-action risk-scoring). (c) a **serve-UI context gauge** from `status.json.context` (small, visible win).
   - Then **v0.5b full Documentalist** (event-driven, Diataxis, gStack `/document-generate`+`/document-release`).

8. **Smaller / housekeeping:** `--sealed` as a Standard default (deliberately opt-in — adds tester+judge LLM cost per run); **`MAKE_MY_DREAMS.md` reconciliation pass** — its labels `v0.3a`/`v0.3b` mean Dream **Expander** (divergent brainstorming, arguably superseded by our convergent Dream Catcher) / Plan-Review Worker (unbuilt), NOT what we shipped as v0.3.x.

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

# 2. Draft docs/specs/SPEC_V02N.md (the L-019 closure slice; pattern: read prior SPECs for style)
#    Or ask Claude: "draft docs/specs/SPEC_V02N.md following the same pattern as docs/specs/SPEC_V02M.md
#    closing the L-019 candidates from HANDOVER.md (composer migration accuracy
#    + WIP-salvage stall signal). 5-6 ACs. Commit it on main."

# 3. Launch via mmd --here (apply ALL operational rules above)
setsid bash -c 'export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH" MMD_TIMEOUT_MS=0 MMD_DREAM_MAX_LEN=4000 && cd ~/Documents/make-my-dreams && mmd --here "implement v0.2.n per docs/specs/SPEC_V02N.md. SPEC IS FROZEN. Skip Party Mode, go DIRECTLY to implementation. <change description>. Apply L-001..L-018. CRITICAL: commit incrementally per AC (L-019 prevention). Bump to 0.2.14" > /tmp/v02n-here.log 2>&1' </dev/null >/dev/null 2>&1 & disown ; echo "launched at $(date +%H:%M:%S)"

# 4. Monitor (cadence ~10 min; L-016 rule: read status.json FIRST, then process, then commits)
cat .mmd/shared/status.json | grep state
git log --oneline main..slice/here-implement-v0-2-n-... | head

# 5. When done: tests, push, merge ff-only, tag, push, delete slice, npm install -g .
```

If you're picking up to do **v0.3 Dream Catcher**: it's a bigger design slice. Don't launch directly — first have a design conversation (this is what Opus 4.x is great for). Draft docs/specs/SPEC_V03A.md collaboratively, then launch.

## Where to find fuller context

- `MAKE_MY_DREAMS.md` — scoping doc, v19 iterations of design (~1000 lines, complete rationale)
- `docs/lessons-learned.md` — 21 active lessons (L-001..L-027 minus the promoted/non-active ones; count is now authoritative via `mmd handover`)
- `.specify/memory/constitution/*.md` — 13 modules + the 2 promoted lesson rules in `ai-coding.md`
- `docs/adr/*.md` — the project's ADRs documenting major design decisions (the authoritative count lives in the State block above, refreshed by `mmd handover`)
- `SPEC_V02*.md` at root — every slice's spec, with full DoD
- `CLAUDE.md` — Layer A diffusion (this is what Claude Code auto-loads at session start; it points to all the above)

## Open questions / pending decisions

- None blocking. v0.3 Dream Catcher scope deserves a design conversation before SPEC; user (Sébastien) wants this for the 13yo daughter scenario.
- L-018's META-rule promotion ("walking-skeleton specs must enumerate scale assumptions in Out-of-scope") is a candidate for direct promotion to `ai-coding.md` — pattern observed 5 times now. Could be done in same slice as L-019 closure.

---

*This file is a session handover. Update it at the end of any context-bridge moment so the next picker-up has the intent, not just the state. If you find yourself updating it often, consider implementing the `mmd handover` subcommand (L-020 candidate).*

---


---

## JUST LANDED — v0.7.7: the Test Curator's REDUNDANCY face (`mmd test-health`)

**The Test Curator gained a second face: find tests that likely _overlap_, so the corpus can be pruned.** (ADR-040 deferred "duplicate-test detection"; now built.) Implemented per SPEC_V077.md (frozen), 5 ACs, via this reflexive `mmd --here` slice. Same contract as the stratification face — **deterministic** (no LLM), **advisory**, **DETECT-BEFORE-CUT** (never deletes a test — a similar-looking test may document distinct intent; the human decides). Method = **clustering by target + structural similarity, NOT coverage** (a coverage mode stays a deferred opt-in — it needs an instrumented run that breaks the pure/read-only contract). What shipped:
- **AC-1 — body + target extraction** (`lib/test-curator/extract-bodies.js`, new): `extractTestBody` (deterministic brace-depth scan, skips strings/comments, robust to nested braces) + `extractFileTargets` (sorted-unique `lib/`/`bin/` imports). `scan.js` attaches `body`+`targets` additively (existing fields/determinism unchanged). 19 `@unit` tests.
- **AC-2 — pure redundancy detector** (`lib/test-curator/redundancy.js`, new): `nearDuplicatePairs(tests,{threshold})` (normalize → token shingles → Jaccard ≥ threshold, default 0.9, **bounded within-file** so no quadratic blow-up, precision floor skips trivial bodies) + `targetClusters(tests)` (group by imported module, largest-first). Deterministic, never throws. 16 `@unit` tests.
- **AC-3 — report section + subcommand** (`report.js` + `bin/test-curator/test-health.js`): a "Redundancy candidates" section (near-duplicate pairs + most-tested modules), `MMD_TEST_DUP_SIMILARITY` env override (graceful fallback), honest "+N more" caps, **strictly read-only beyond `docs/test-health.md`**. 6 `@integration` tests.
- **AC-5 — docs**: ADR-041 (method, why-not-coverage, detect-before-cut, bounded comparison, documented residuals), README + CLAUDE, mechanical blocks refreshed, bumped to 0.7.7.

**AC-4 status — LIVE CORPUS STATE CAPTURED ✅ (executed 2026-06-02 on MMD itself, post Phase-4 fix).** `mmd test-health` now reports, in addition to the stratification face: **4 near-duplicate test pairs** at similarity ≥ 0.9 (precision-first — no flood): `unblock-dry-run.test.js:100↔143` (**0.95**), `sealed-tests-manifest.test.js:69↔82` (**0.94**), `here-mode-lib.test.js:43↔115` (**0.92** — two `validateHereTarget` tests differing only in main/master), `server.test.js:194↔240` (**0.91**) — all real copy-paste candidates worth a human glance; **nothing was deleted**. The **most-tested modules** (over-test candidates): `lib/invoke-autodev.js` (**204** tests / 33 files), `lib/argv-parser.js` (139/7), `lib/server.js` (98/6) — ~96 clusters total, top 15 listed with an honest "+N more" note. The read-only contract held (only `docs/test-health.md` changed). Documented heuristic residual: an import line written inside a *fixture string* in a test file is counted as a target (same class as the v0.7.6 `test(`-in-a-string note; a couple of the smaller entries in the cluster list come from such strings). **Phase-4 adversarial review (independent sub-agent): 0 Critical / 0 High / 1 Medium / 2 Low.** The Medium (F1) + a related Low (F2) were a real precision bug — a bare callback ref `test('name', fn)` / a destructured param made the brace scan grab the wrong braces; fixed with a callback-aware body finder (the 4th pair above is a true positive newly surfaced because options-object args are now skipped to reach the real body). Future (deferred, YAGNI): coverage-based redundancy, cross-file pairing within a cluster, identifier-normalized similarity, any auto-pruning — each opt-in and human-reviewed if ever built.

## JUST LANDED — v0.7.6: the Test Curator — test-corpus health (`mmd test-health`)

**MMD now owns the fourth quality question its other roles kept blurring: is the test _corpus itself_ healthy as it grows?** The test analog of the Documentalist — distinct from `mmd qa` (per-change review) and the BMAD TEA (test architecture). Implemented per SPEC_V076.md (frozen), 5 ACs, via a reflexive `mmd --here` slice. **Detect-and-report only** (strictly read-only — never modifies a test) and **deterministic** (no LLM — the corpus signal is exactly computable). What shipped:
- **AC-1 — pure scanner** (`lib/test-curator/scan.js`): `scanTestCorpus(files)` reads the stratification tag from each test title (`@smoke`/`@unit`/`@integration`/`@e2e` prefix — the convention `npm test:smoke` greps + testing.md §V mandates), extracts `{title,tag,file,line}` per test + `{path,lineCount,testCount}` per file. Skips comment lines (a commented-out `test()` is not counted); best-effort on multiline/template titles. Pure, deterministic, never throws. 13 `@unit` tests.
- **AC-2 — pure report builder** (`lib/test-curator/report.js`): `buildTestHealthReport(scan, {maxLines,maxTests})` → the stratification distribution, the untagged tests (a §V violation) with `file:line`, a smoke-health line (vs the §V 5–10 fast-feedback band), and oversized split candidates. Honest advisory framing, clearly heuristic; exports `DEFAULT_MAX_LINES`/`DEFAULT_MAX_TESTS`. 13 `@unit` tests.
- **AC-3 — `mmd test-health`** (`bin/test-curator/test-health.js`): gather git-tracked test files (`git ls-files '*.test.js'`, **excluding `test/fixtures/`**), scan, build, write EXACTLY `docs/test-health.md` (read-only contract asserted — only that path changes), print a summary. Env-overridable thresholds (`MMD_TEST_FILE_MAX_LINES`/`MMD_TEST_FILE_MAX_TESTS`) with graceful honest fallback; `--dry-run`/`--help`; exit 5 when not a git repo. Dispatch + USAGE + `SUBCOMMANDS` mirror the document-* contract. 9 `@integration` tests.
- **AC-5 — docs**: ADR-040 (the role + its boundaries + detect-before-act + deterministic-over-LLM), README + CLAUDE.md, mechanical blocks refreshed, bumped to 0.7.6.

**AC-4 status — LIVE CORPUS STATE CAPTURED ✅ (executed 2026-06-01 on MMD itself).** `mmd test-health` reports: **1708 tests across 184 files** (git-tracked, fixtures excluded; heuristic count of `test(`/`it(` calls) — **1265 `@unit` · 359 `@integration` · 8 `@smoke` · 2 `@e2e` · 74 UNTAGGED**. The smoke subset (8) sits **within the testing.md §V 5–10 fast-feedback band** (usable). The headline finding is the **~74 untagged tests** — real §V stratification debt accumulated in older files (`test/integration/mmd.test.js`, `parse-dream.test.js`, `invoke-autodev.test.js`, `camera-secure-context.test.js`, …), each listed with `file:line` in `docs/test-health.md`. These are pre-existing (NOT introduced by this slice) and the Curator **does not fix them** — detect-before-act: a wrong stratum is worse than an absent one (it would corrupt the fast lane), so retagging is a separate human-reviewed action. **2 oversized files** flagged at the default 500-line / 60-test thresholds. The read-only contract held (only `docs/test-health.md` written). `docs/test-health.md` is committed as the regenerable dashboard (the test analog of `docs/coherence-review.md`). Known heuristic residual (documented, Phase-4 F1): a `test('…')` written *inside a string literal* in a test file is counted (≈1 of the 74 is such a fixture string) — fully stripping string contexts needs a real parser (KISS, out of scope). Future (deferred, YAGNI): tighter parsing, auto-retag suggestions, per-stratum runtime budgets, duplicate-test detection, an opt-in `--with-claude` semantic pass.

## JUST LANDED — v0.7.3 (v0.7.d): the coherence graph — staleness-on-diff (`mmd document-review --since`)

**The Documentalist now sees COUPLING: change one node, learn which doc/code/ADR neighbors to review — derived from edges that already exist, advisory, never a gate.** Implemented per SPEC_V07D.md (frozen), 5 ACs, via the 32nd reflexive `mmd --here`. The golden rule: **derive, never maintain** — a hand-kept "these relate" map rots; this graph is composed for free from `computeBlastRadius` (imports), `doc-refs` (doc→code), and the new doc-links (doc↔doc). What shipped:
- **AC-1 — pure doc↔doc extractor** (`lib/documentalist/doc-links.js`): `extractDocLinks(text, {docPath, resolveAdr})` → `{to, kind:'doc-link'}` for `[[wiki]]` links, `ADR-NNN` (resolved to the real file via an injected resolver, else a number-keyed stem), and relative `.md` links. Pure, never throws, conservative (external/absolute/anchor/code links → no edge). 9 `@unit` tests.
- **AC-2 — pure graph builder + walk** (`lib/documentalist/coherence-graph.js`): `buildCoherenceGraph({importEdges, docToCodeEdges, docLinkEdges})` → a file-level **bidirectional** adjacency (each edge keeps its kind); `coupledNeighbors(graph, changedFiles)` → per changed file, neighbors **ranked strong (direct) before weak (2-hop transitive)**, deduped, excluding the changed set. Includes **hub suppression** (don't transit through a high-degree doc) — precision-first. Pure, deterministic, never throws; empty graph / no changes → empty; isolated node → no neighbors. 9 `@unit` tests.
- **AC-3 — `mmd document-review --since <ref>`** (`bin/documentalist/document-review.js`): computes `git diff --name-only <ref>` (injectable seam), builds the graph from the three derived sources (edges kept only to real tracked files — no phantom neighbors), walks it, prints the ranked, advisory **"Coupled changes"** report to stdout. **Standalone READ-ONLY query**: returns before any roadmap read/write — it does NOT rewrite `docs/coherence-review.md` (asserted clean tree); no-flag path byte-for-byte unchanged. Bad/unknown ref or non-git → exit 5; `--since` with no value → exit 2. 7 `@integration` tests.
- **AC-5 — docs**: ADR-037 (derive-never-maintain + the three free edge sources + file-level-first + advisory-ranked + the precision levers + would-have-caught-v0.7.c), README + CLAUDE.md, mechanical blocks refreshed, bumped to 0.7.3.

**Full suite 1651/1651 green** (1626 baseline + 25 new: 18 unit + 7 integration).

**AC-4 status — LIVE COUPLING VALIDATED ✅ (executed 2026-06-01 on MMD itself).** `mmd document-review --since HEAD` on a working-tree change to `lib/discover/classify.js` (the SPEC's own mission example) surfaces exactly the coupled neighbors a human otherwise chases manually — all **STRONG**: `test/unit/classify-brownfield.test.js` `[imports]` + `test/unit/discover-classify.test.js` `[imports]` (the tests that import it), `bin/discover.js` `[imports]` (the importer), and `CLAUDE.md` / `HANDOVER.md` / `SPEC_V07D.md` / `docs/specs/SPEC_V06A.md` `[doc→code ref]` (the docs that reference it) — with a ranked weak/transitive tail below. The read-only contract held (clean tree after). This is precisely the coupling that would have flagged the v0.7.c break (the moved SPECs ↔ the inventory test that referenced the SPEC sprawl) **before** it went red — the structural fix for the pain v0.7.c surfaced live. The mind-map render, the semantic `@mmd:link` anchor, symbol granularity, and git co-change edges are the trusted-next enrichments (deferred).

## JUST LANDED — v0.7.2 (v0.7.c): the Documentalist's first ACTION — SPEC archival (`mmd document-compact`)

**The Documentalist now ACTS: it detected the root SPEC sprawl (v0.7.a), guards the docs' truth (v0.7.b), and here clears the sprawl — safely, reversibly, idempotently.** Implemented per docs/specs/SPEC_V07C.md (frozen), 5 ACs, via the 31st reflexive `mmd --here`. *Act on the safe thing first*: archiving SPECs is mechanical + fully reversible (`git mv`); the harder semantic compaction (sharding the over-cap docs) is deferred. What shipped:
- **AC-1 — pure planner** (`lib/documentalist/compact.js`): `planCompaction({specs, existingArchive}) → {moves, indexMarkdown, referenceRewrites}` + `applyReferenceRewrites`, an idempotent exact-token transform (prefixes a root `SPEC_V0XX.md` ref with `docs/specs/` only when not already prefixed) + `countReferences`/`parseSpecVersion`. Pure, no I/O, never throws; empty specs → empty plan; already-archived not re-planned. 22 `@unit` tests.
- **AC-2 — `mmd document-compact`** (`bin/documentalist/document-compact.js` + dispatch/USAGE/`SUBCOMMANDS`): gather root SPECs → plan → `git mv` into `docs/specs/` (history preserved) → write the newest-first index → rewrite references in tracked markdown **outside** the archive. `--dry-run` is a true no-op that reports the real blast radius; idempotent no-op when no root SPECs; move-only (never edits prose, never deletes); preconditions validated **before any mutation** (non-git → exit 5; untracked SPEC → exit 6); does NOT auto-commit. 9 `@integration` tests on fixture git repos.
- **AC-3 — reference integrity**: every textual form (link target, anchored link, prose mention, backticked link) rewritten; a non-moved SPEC untouched; no `docs/specs/docs/specs/`; a moved SPEC keeps its bare sibling cross-refs. Validated by the v0.7.b Drift detector (no new dangling SPEC refs).
- **AC-5 — docs**: ADR-036 (act-safe-first + the move-only/idempotent/reversible safety contract + Drift-as-validation + new-SPECs-still-land-at-root model), README + CLAUDE.md, mechanical blocks refreshed, bumped to 0.7.2.

**Full suite 1626/1626 green** (1597 baseline + 29 new). **Phase-4 adversarial review: 1 pass found 1 critical** (the version parser fabricated "v0.25" for the real `docs/specs/SPEC_V025.md` and sorted it above v0.7.c) **+ 3 medium + 3 low — all fixed**; a 2nd review confirmed 0/0/0/0.

**AC-4 status — LIVE OPERATOR ARCHIVAL DONE ✅ (executed 2026-06-01, post-merge, commit `7b5c2c2`).** After ff-merge + tag `v0.7.2`, the operator ran `mmd document-compact` on MMD itself: **35 root `SPEC_V*.md` → `docs/specs/`** via `git mv` (history preserved — `git log --follow docs/specs/SPEC_V06A.md` reaches its original creation commit `d358131`), wrote `docs/specs/INDEX.md` (newest-first), and **rewrote 102 references across 32 tracked markdown files**. `--dry-run` previewed it as a true no-op first. The root SPEC sprawl is **gone** (root `SPEC_V*.md` count = 0; `docs/specs/` = 35 SPECs + index).
**Validated by the v0.7.b Drift detector (the designed synergy):** post-archival `mmd document-review` reports **zero dangling SPEC references** (the rewrite was complete; only the 2 pre-existing historical/rejected false positives remain) and no root `](SPEC_V` link survives. **One coupled change surfaced + fixed** (exactly the kind v0.7.d's coherence graph would flag): `test/integration/documentalist-inventory.test.js` asserted root SPEC sprawl `>= 20`; that signal is now correctly `0`, so the assertion became "`specCount` is a valid non-negative integer". Full suite **1626/1626 green**. New SPECs keep landing at the repo root per slice; a later `mmd document-compact` archives them (the §6.4 periodic-consolidation model).

## JUST LANDED — v0.7.0 (v0.7.a): the Documentalist's coherence review (`mmd document-review`)

**MMD can now tell its owner, on demand, what it designed vs what it became — and where the docs have drifted.** First brick of the §6.4 **Documentalist**, built **detect-first, report-only**, per docs/specs/SPEC_V07A.md (frozen), 5 ACs, via the 29th reflexive `mmd --here`. What shipped:
- **AC-1 — deterministic inventory** (`lib/documentalist/inventory.js`): pure-ish `gatherInventory(deps)` over injected fs/git readers — subcommands, git tags, ADRs+titles, `lib/` modules, per-doc line counts (with a 200-line §6.4 cap flag), root `SPEC_V*.md` sprawl count, active-lesson count. **Never throws**: each field degrades to empty/null on read failure. Unit-tested on an in-memory fixture repo + integration-tested against the real surface.
- **AC-2 — heuristic roadmap reconciliation** (`lib/documentalist/roadmap-reconcile.js`): pure `reconcileRoadmap({roadmapText,inventory})` parses the §9 `### vX.Y — Title` headers and classifies each capability **built/partial/unbuilt** by name-matching against the inventory. Conservative + clearly-labelled a heuristic (single fully-matched concept → built, half-matched compound → partial, no signal → unbuilt; malformed → unknown, never throws). 14 exhaustive fixture unit tests.
- **AC-3 — `mmd document-review`** (`lib/documentalist/coherence-report.js` render + `bin/documentalist/document-review.js` subcommand + dispatch/USAGE/`SUBCOMMANDS`): writes **EXACTLY** `docs/coherence-review.md` and is **strictly read-only beyond that one file** (an integration test asserts `git status` shows only that path). Opt-in `--with-claude` enriches via the `MMD_DOCUMENT_REVIEW_CMD` spawn seam with a graceful honest fallback (absent/non-zero/empty → deterministic report + an "unavailable" note, never a fabricated classification). 8 integration tests.
- **AC-5 — docs**: ADR-034 (detect-before-act + the deterministic-inventory/heuristic-reconciliation method + v0.7.b active compaction), README + CLAUDE.md notes, mechanical blocks refreshed, bumped to 0.7.0.

**Full suite 1561/1561 green** (1523 baseline + 38 new). No Phase-4 review iterations needed (slice implemented directly per the frozen-spec directive; adversarial self-review surfaced no Critical/High).

**AC-4 status — DETECTION GATE VALIDATED ✅ (executed 2026-06-01 on MMD itself).** Running `mmd document-review` on the MMD repo wrote `docs/coherence-review.md` that **reproduces the manual gap audit's big rocks**: all six — auto-handoff@70% (v0.4 🟡 partial), Dream Expander (v0.3a ❌ unbuilt), Plan-Review Worker (v0.3b 🟡 partial), Bundle A Security (v0.2b 🟡 partial), full Documentalist (v0.5b 🟡 partial), polymorphic Reality Check (v0.6 🟡 partial) — come out **unbuilt or partial**, while Dream Catcher (v0.3) / `mmd serve` (v0.2.5) come out ✅ built. It flags **`MAKE_MY_DREAMS.md` at 1722 lines over the 200-line §6.4 cap** (plus README/HANDOVER/PROBLEMS/BOOTSTRAP/lessons-learned), the **33 `SPEC_V*.md` root sprawl** (the SPEC's "32" + the new docs/specs/SPEC_V07A.md — the live count is reported honestly), and a correct inventory (**12 subcommands · 34 ADRs · 21 lessons · tags v0.1.0..v0.6.1**). The read-only contract held: `git status` after the run showed only `docs/coherence-review.md`. **Detection is trustworthy — the prerequisite for granting compaction in v0.7.b.** (Known heuristic blind spot, acknowledged in ADR-034: it name-matches, so v0.10 "Full Dream Catcher Web UI" over-credits as built off `lib/dream-catcher`; `--with-claude` is the escape hatch.)

## JUST LANDED — v0.6.1 (v0.6.b): considerate guest — constitution suggestions + discover→`--here` friction fix

**MMD now respects a third-party repo's constitution absolutely ("elle reste") and offers non-destructive improvement suggestions when one exists.** Implemented per docs/specs/SPEC_V06B.md (frozen), 5 ACs, via the 28th reflexive `mmd --here`. What shipped:
- **AC-1 — deterministic suggestions checklist** (`lib/discover/constitution-suggest.js`): pure `suggestConstitutionImprovements(text) → {present[], missing[{theme,suggestion}]}` over 7 governance themes (testing, commit/git, security, error-handling, design principles, documentation, AI-coding) by case-insensitive keyword heuristic. No I/O, never throws (empty/malformed → all-missing), stable. Honestly labeled a heuristic, not an audit.
- **AC-2 — discover surfaces them, non-destructively**: `buildReport` gains `constitutionText` and renders an advisory "## Constitution suggestions (advisory — your constitution is never modified)" section (omitted when no constitution; back-compat otherwise). `bin/discover.js` READS `.specify/memory/constitution.md` and **never writes it** (integration test asserts byte-for-byte unchanged).
- **AC-3 — discover→`--here` friction fix**: `bin/discover.js` gitignores its scratch (`.mmd/`, `mmd-discovery-report.md`) via an idempotent marked block; the first-run setup preflight in `bin/mmd.js` treats a tree dirtied *only* by MMD-managed paths (pure predicate `lib/onboarding/mmd-managed.js`) as clean. **F7 intact**: any non-MMD dirty path still → exit 4. `lib/discover/safe-write.js` adds the root `.gitignore` as the only new write sink.
- **AC-4 — docs**: ADR-033 (suggestions + friction + the honest composer-rework retirement), README + CLAUDE.md notes, mechanical blocks refreshed, bumped to 0.6.1.
- **The Layer-C composer rework was RETIRED, not built** (honest §VI correction): `--here` is already governed by the *project's* constitution via **Layer B** (the auto-dev workflow reads `.specify/memory/constitution.md` directly — v0.6.a AC-6 confirmed it); the composer only runs on the greenfield `demo/` path where there is no project constitution. Rewriting it would be work against a non-problem (KISS/YAGNI). See ADR-033.

**Full suite 1523/1523 green** (1496 baseline + 27 new). No Phase-4 review iterations run by this `--here` (the slice was implemented directly per the frozen-spec directive).

**AC-5 status — VALIDATED ✅ (executed 2026-06-01, real repos).** On a throwaway repo with a deliberately thin constitution (KISS + docs only): `mmd discover` → the report's "Constitution suggestions" section correctly lists *Design principles, Documentation* as present and flags *Testing / Commit & branch / Security / Error handling / AI-coding* as gaps, explicitly stating the file is untouched; `constitution.md` verified **byte-for-byte identical** (sha256 unchanged) across the run. Post-discover `git status --porcelain` = `?? .gitignore` only (`.mmd/` + report gitignored). Then `mmd --here --skip-onboarding "<trivial>"` (driven with the `MMD_SETUP_CMD`/`MMD_AUTODEV_CMD` seams + `MMD_SKIP_GROUNDING=1`) **proceeded past the dirty-tree preflight with NO manual stash** — auto-ran setup, committed it on the base branch, and created `slice/here-tweak-greeting-…`. The negative side (a real user edit on top of the scratch → **exit 4**, "clean working tree") is covered by `test/integration/discover-then-here-clean.test.js` and was observed live (a stray deleted `.claude` file correctly refused). **MMD is now a considerate guest of a repo it doesn't own.**

## JUST LANDED — v0.6.0 (v0.6.a): third-party readiness (transparent first-run setup + brownfield detection)

**MMD now works on a repo other than itself, with no new command to learn.** Implemented per docs/specs/SPEC_V06A.md (frozen), 6 ACs, via the 27th reflexive `mmd --here`. What shipped:
- **AC-1 — `classify` names the scanned stack.** New `brownfield-app` case in `lib/discover/classify.js` (recognized stack via `frameworks.language` OR `languages` non-empty, no SDD methodology), distinct from `blank` (genuinely empty/unstructured). Priority below `rich`/`bmad-alone`, above `blank`; malformed input still → `blank`. The `blank` fixture was gutted to a truly stackless repo; a new `brownfield-node` fixture covers the positive case.
- **AC-2/3/4 — transparent first-run setup guard** (`lib/onboarding/{detect,setup,cheatsheet}.js`, wired into `runHereMode` before the gate): pure `detectMmdSetup` probe → `runFirstRunSetup` (injected confirm/runner/preflight) → TTY confirm / non-TTY auto / decline-or-failure → **exit 8** (never inert) / `MMD_SKIP_SETUP=1` bypass / already-ready no-op (constitution never overwritten). A successful setup is committed on the base branch before the clean-tree check; a dirty tree is refused first (exit 4). The cheat-sheet surfaces the operational tribal knowledge once after setup.
- **AC-5 — docs:** ADR-032, README "Using MMD on your own repo", CLAUDE.md working-agreement bullet; mechanical blocks refreshed; bumped to 0.6.0.

**Phase-4 adversarial review (2 iterations):** found + fixed F1 (CRITICAL — setup wrote files but didn't commit → the next clean-tree check aborted exit 4, defeating AC-6), F3 (signal-kill reporting), F7 (MEDIUM — `git add -A` could sweep a user's uncommitted work; now refused on a dirty tree before writing). Exit condition reached: **0 Critical / 0 High** (F8/F9 documented as accepted LOW limits in ADR-032). Full suite **1496/1496** green.

**AC-6 status — LIVE GREEN ✅ (executed 2026-06-01, real toolchain).** The cross-project flow is proven **green by a real end-to-end run on a throwaway non-MMD repo** (`/tmp/mmd-ac6-3nIk`: `git init` → `package.json` + `index.js`, no `.specify/`, no `_bmad/`). `mmd --here --skip-onboarding "<trivial>"` (non-TTY) printed the missing-pieces detection, **auto-ran the REAL `install-mmd.sh`** (Phase 0 bun ✓, Phase 1 real `npx bmad-method` install), committed the setup on the base branch (`db53c32 chore: MMD first-run setup …`), created a `slice/here-…` branch from `master`, ran a **real `claude -p` auto-dev**, and landed a green commit (`fa0d6fb docs: add top-of-file comment …`) — `status.json.state = done`, `EXIT=0`. The fast surfaces were also confirmed on a real repo directly: `mmd discover` → `detected case = brownfield-app` (the exact `blank` bug fixed) and `detectMmdSetup` → `ready:false` with named missing pieces. Plus the scripted seam test (`test/integration/here-setup-commit-flow.test.js`) covers the no-op-on-already-set-up path. **MMD now provably works on a repo other than itself.**

**Third-party gotchas surfaced by the live run (candidates for v0.6.b — honest §VI):**
- `git init` defaults to **`master`** on this host, not `main`. The guard handled it correctly (used `master` as base, never assumed `main`) — but worth a regression test that `--here` is branch-name-agnostic.
- **`mmd discover` dirties the working tree** (writes `mmd-discovery-report.md` + `.mmd/`), which would trip the guard's dirty-tree veto (exit 4) if run *before* `--here` — friction for the documented "discover then --here" flow. Fix candidate: `discover` should `.gitignore` its own outputs, or the guard should tolerate MMD's own artifacts. (Worked around in the live run by using `--skip-onboarding`; discover→brownfield-app was proven separately.)
- The build used the **monolithic default constitution** that `install-mmd.sh` materializes (`v1.3.0`, read via Layer B), NOT MMD's modular Layer-C modules — exactly the gap v0.6.b closes (composer reads the *project's* constitution).

## v0.6.b — DONE (see "JUST LANDED — v0.6.1" above)

The deeper "whose constitution governs the build" question, deferred from v0.6.a, is resolved:
- ~~**Layer-C composer reads the project's constitution modules**~~ — **RETIRED, not built** (honest §VI). Layer B already governs `--here` with the project's own constitution; the composer is greenfield-only. Documented in ADR-033 rather than coded (KISS/YAGNI).
- ~~**Non-destructive "suggest improvements" mode**~~ — **DONE.** Deterministic checklist in the `mmd discover` report; `constitution.md` never modified ("elle reste"). AC-1/AC-2.
- ~~**Fix the discover-dirties-tree friction**~~ — **DONE.** discover gitignores its scratch + the setup preflight tolerates MMD-managed paths; F7 intact. AC-3.

## NEXT PRIORITY — candidates (no slice frozen yet)

**Documentalist roadmap. Core mission (Sébastien, 2026-06-01): keep docs TRUE first (conformance / anti-drift), tidy second (compaction). Truth over tidiness. The a→d arc + a precision refinement all SHIPPED this session:**
- ✅ **v0.7.0 (a) — roadmap-level DETECT** (`mmd document-review` → `docs/coherence-review.md`: designed-vs-built reconciliation + doc-health).
- ✅ **v0.7.1 (b) — DRIFT / conformance detection.** Per-claim "is the doc still true?": a "Drift / conformance" section flagging dangling artifact refs + bounded stale facts (+ opt-in `--with-claude` semantic drift). Flag-only, precision-first. **Found real drift live** (ADR-007's stale `lib/ship/…` path — fixed; 2 known false-positives remain on historical/rejected mentions → queue item 3).
- ✅ **v0.7.2 (c) — active compaction.** `mmd document-compact` archived the 35 root `SPEC_V*.md` → `docs/specs/` (git mv, history preserved, 102 refs rewritten, idempotent, reversible). Validated by the v0.7.b Drift detector (0 dangling SPEC refs after).
- ✅ **v0.7.3 (d) — the coherence graph.** `mmd document-review --since <ref>`: derived file-level bidirectional graph (blast-radius imports + v0.7.b doc-refs + new doc-links) → ranked, advisory "Coupled changes" report. **✅ v0.7.4 (d.1) — hub-source cap**: a changed hub doc no longer floods (README 121→13 lines + honest "+N suppressed" note); code changes listed in full. `MMD_COHERENCE_MAX_NEIGHBORS`.

**Remaining Documentalist queue (rough priority):**
1. **Aggressive SEMANTIC consolidation — cut the bloat (the "owed" piece Sébastien flagged).** v0.7.c only did the *mechanical* file-move (sprawl); the over-cap docs (`MAKE_MY_DREAMS.md` 1722 lines, README, HANDOVER, PROBLEMS, BOOTSTRAP, lessons-learned) are still bloated. The valuable *aggressive* part is daring to **cut/shorten obsolete + redundant content** (§6.4.3). Needs a **safety model** — *propose cuts for review* (detect-before-correct, like the drift detector) or *lossless restructure/shard* — NOT a blind autonomous "shorten". Own design conversation.
2. **Coherence-graph enrichments**: symbol-level granularity, the opt-in semantic anchor `@mmd:link <concept>`, the Mermaid/.dot mind-map render, git co-change weak edges. (Memory `coherence-graph-traceability`.)
3. **Drift-detector precision**: historical/rejected context-awareness so archival "Files created" lists + "rejected alternative" mentions (today's 2 false positives) aren't flagged.
- Then: Diataxis generation (§6.3 "produce" face), event-driven triggering, full autolearning reuse-counter (§6.5).

**Hors-roadmap concepts Sébastien raised (NOT in MAKE_MY_DREAMS §9) — BOTH now shipped (he asked to bring them early):**
- ✅ **`/mmd` slash command (v0.7.5)** — the operator playbook as a Claude Code command (`assets/claude-commands/mmd.md`, materialized by install-mmd.sh into `.claude/commands/mmd.md`). Drive MMD by intent from a session. Live in this repo (materialized).
- ✅ **Test rationalization → the Test Curator (v0.7.6)** — `mmd test-health`, a role DISTINCT from qa/TEA/Documentalist: test-CORPUS health (stratification, untagged violations, @smoke band, oversized files), detect-and-report. **Applied**: tagged 71 untagged `@integration` tests (74→3, the 3 are curator-own fixture strings). Correction: @smoke (8) is actually within testing.md §V's 5–10 band — fine. Future Curator work: a `--fix` act-mode (auto-tag by directory stratum), dedup/coverage-overlap detection.

**Full designed-vs-built roadmap audit:** run `mmd document-review` → `docs/coherence-review.md` (heuristic; corrected-by-judgment synthesis of "what remains to finalize MMD" lives in the session log: core gaps = full autolearning, Bundle A security, polymorphic Reality Check, auto-handoff@70%, Bundle C/HITL; reach = Plan-Review, Mockup, Dream Expander, Dream Delivery/Retro, parallel Conductor; far = voice/game/web-UI/gbrain).

**Smaller / orthogonal candidates:**
- **LLM-enriched suggestions** (`discover --suggest-with-claude`) — a future opt-in mirroring `--infer-with-claude` (deferred from v0.6.b, YAGNI).
- **Content/version-aware readiness** in `detectMmdSetup` (today it only checks presence).
- **`--here` branch-name-agnostic regression test** (the v0.6.a live run surfaced `git init` defaulting to `master`; the guard handled it but it's untested).
