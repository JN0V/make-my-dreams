---
name: 'mmdream'
description: 'Drive Make My Dreams (MMD) from a Claude Code session with the right operator discipline — routes your intent to a detached --here slice, a greenfield dream, or a bare subcommand, and applies all the operational rules (timeout, label, commit-per-AC, honest monitoring) so you do not have to remember the incantations.'
---

# /mmdream — the MMD operator playbook

You are driving **Make My Dreams (MMD)** on behalf of the user. They typed:

> /mmdream $ARGUMENTS

`$ARGUMENTS` is the user's **intent** in plain language. Your job is to ROUTE it to the
right MMD action and run that action with MMD's full operator discipline — so the user
(or you) never has to remember the CLI incantations or the hard-won operational rules.

This playbook is self-contained. Follow it exactly. If `$ARGUMENTS` is empty, ask the
user what they want to do (a code change? a fresh app? a bare subcommand?) and stop —
do NOT launch anything against an empty intent.

---

## Always-on rules (apply to EVERY route)

These are non-negotiable, drawn from MMD's constitution and lessons-learned:

- **Branch-first + push always.** Never commit non-trivial work directly to `main`.
  Every code slice runs on its own `slice/<readable-name>` branch; push early
  (commit-git.md §III–IV). Uncommitted-and-unpushed work does not exist.
- **Honest failure reporting.** NEVER claim "done" when it isn't. If a run fails, a test
  is red, or you hit a wall, say so plainly with the evidence — "I tried X and it failed
  because Y" beats a fabricated success (ai-coding.md §I, universal §VI).
- **Verify before declaring done.** Run the tests (`npm run test:full`) and read the real
  status before reporting green. "I think it works" is not "it works" (ai-coding.md §V).
- **PATH must carry bun + node 20** for the `mmdream` CLI to work from a non-interactive
  context:
  `export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH"`
  (adjust the node path to the installed v20.x; HANDOVER.md documents the canonical one).
- **The alignment gate runs by DEFAULT, and is DUAL-FACE + anchored to the ORIGINAL ask
  (v0.11.a + v0.17.0).** At run start the original expectation is **frozen** into
  `.mmd/shared/expectation.md` (the dream + any Dream-Catcher scope) — written ONCE, never
  overwritten on a resume, so the build cannot quietly redefine its own success. After
  auto-dev completes and BEFORE the run is marked done, the gate verifies the result against
  that frozen oracle on **BOTH faces**: the **semantic** judge (grades the change against
  WHAT WAS ASKED, written to **`status.json.judge`**) AND the **deterministic** Reality Check
  (now un-skipped on `--here`: it runs the project's tests + a `run.json`-kind "does it run"
  check). A gap on EITHER face re-launches auto-dev (bounded) with feedback naming the failing
  face, then re-verifies. Outcomes: both faces pass → done; a gap that survives the bounded
  re-tries → **exit 7** (NOT done), with **`status.json.judge.face`** ∈ `semantic` /
  `deterministic` / `both` recording what failed; an uncertain/unverifiable semantic verdict
  (no deterministic fail) → an honest "alignment unverified" note (the sacred fallback — never
  a fabricated pass). Opt out with **`MMD_SKIP_ALIGN=1`** (restores pre-v0.11 behavior
  exactly, both faces off); cap the re-tries with **`MMD_ALIGN_MAX_ITERS`** (integer ≥ 0,
  default `1`; `0` = gate-but-never-iterate). The gate is a post-completion step — it never
  changes how auto-dev is spawned.

---

## ROUTE the intent

Read `$ARGUMENTS` and pick exactly ONE of the three routes.

### Route (a) — a code change for THIS repo

Triggers when the intent is "implement / add / fix / refactor X in this repository"
(a brownfield change to the repo you are currently in).

Launch MMD **detached** so the 30–90 min run survives this session, with ALL operational
rules applied. Use `setsid` (NOT `nohup` — `nohup … &` does not survive shell death,
L-001) and keep the launch command minimal so a tool timeout can't half-fire it:

```bash
setsid bash -c 'export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH" MMD_TIMEOUT_MS=0 MMD_DREAM_MAX_LEN=4000 && cd <REPO_ROOT> && mmdream --here --label "<readable-slug>" "<DREAM>" > /tmp/mmdream-<slug>.log 2>&1' </dev/null >/dev/null 2>&1 & disown ; echo "launched at $(date +%H:%M:%S)"
```

Operational rules baked into that command — every one is mandatory:

- **`MMD_TIMEOUT_MS=0`** — disable the 30-min default timeout, or a real Standard-engine
  slice gets killed mid-pipeline (L-016). The default is only safe for trivial / `--fast`
  changes.
- **`MMD_DREAM_MAX_LEN=4000`** — the default 500-char cap is too tight for a real dream
  (L-016 operational checklist).
- **PATH includes bun + node 20** — see the always-on rule above.
- **`--label "<readable-slug>"`** — a short, human-readable, plain-language slug naming
  the work (`wip-salvage-stall-signal`, not a bare timestamp). It becomes the
  `slice/<slug>-…` branch name. Human-readable first (universal §VII).
- **Auto-handoff is AUTOMATIC — the transparent Conductor (v0.15.a). No flag needed.**
  Every run monitors the orchestrator's context and, when it fills past 70% on a LONG run,
  hands the work off to a FRESH successor that resumes from the next phase with low context
  (HYBRID: it asks the orchestrator to stop cleanly at a phase boundary, and ENFORCES a
  terminate at the checkpoint if it ignores the ask — no committed work lost). Bounded by
  `MMD_MAX_HANDOFFS` (default 3), then one final un-handoffed successor; `MMD_TIMEOUT_MS=0`
  applies per successor. You no longer pass `--auto-handoff` / `--monitor` — they are
  accepted-but-inert no-ops kept only for back-compat. **To opt the whole Conductor OUT**
  (restore the pre-v0.15 plain text spawn, one un-looped run, no monitor — e.g. a wary
  bootstrap or to save the stream-json parse cost), set **`MMD_NO_AUTO_HANDOFF=1`**.
- **Model-per-task is AUTOMATIC — the Conductor allocates a model to each role (v0.16.a). No flag needed.**
  Each role runs on a cost-aware default: the **orchestrator** on `sonnet` (it coordinates +
  delegates + hands off at 70%), the **workers** on `opus` (`spec`/`impl` — the real
  reasoning), and `review`/`judge`/`tester`/`unblock` on `sonnet`. Per-subagent models are
  honored because MMD launches DETACHED (a Claude Code host forces Haiku when *attached* —
  #47488; this is why `/mmdream` launches via `setsid`). Override any role with
  **`MMD_MODEL_<ROLE>`** (`ORCHESTRATOR`/`SPEC`/`IMPL`/`REVIEW`/`JUDGE`/`TESTER`/`UNBLOCK`),
  e.g. export `MMD_MODEL_IMPL=sonnet` before launch to run the implementation light, or
  `MMD_MODEL_ORCHESTRATOR=opus` for a heavier orchestrator. `MMD_AUTODEV_MODEL` still
  globally overrides the orchestrator. Unset = the cost-aware defaults.
- **The `<DREAM>` MUST instruct incremental commits per AC.** Always append:
  `CRITICAL: commit incrementally per AC (L-019 prevention).`
  An auto-dev run killed mid-flight with no intermediate commits loses everything.
- **If the dream references a frozen SPEC, add the spec-frozen directive.** When the dream
  cites an authoritative `docs/specs/SPEC_V0XX.md`, append verbatim:
  `The SPEC at <path> is AUTHORITATIVE and FROZEN. Do NOT edit it. Skip Party Mode, go DIRECTLY to implementation (Phase 3 / coding).`
  This short-circuits the endless spec-polishing trap (L-016).

Then **set up a per-run watcher and MONITOR honestly**:

- Monitor via **`status.json` state + git commits**, NOT by tailing the redirect log:
  `claude -p` does not flush stdout in real time when redirected, so `tail -f /tmp/…log`
  lies about progress (L-002). The buffered log is for the post-mortem, not live tracking.
- Read the truth in this order (L-016 cadence, ~10 min between checks):
  ```bash
  cat <REPO_ROOT>/.mmd/shared/status.json   # .state ∈ running|done|failed; also .judge, .context
  git -C <REPO_ROOT> log --oneline <base>..slice/<slug>-... | head   # atomic per-AC commits appearing
  pgrep -f "claude -p" >/dev/null && echo "auto-dev alive" || echo "auto-dev exited"
  ```
- **First run on a fresh repo? The first few minutes are AUTO-SETUP, not a stall.** If the
  target directory has no MMD/BMAD yet, `--here` auto-runs `install-mmd.sh` (the same guard
  every spawning command now uses) and commits it on the base branch BEFORE creating the
  slice branch — so `status.json` and the `slice/<slug>-…` branch only appear AFTER setup
  finishes (`npx bmad-method` takes a few minutes). Don't read "no status.json yet" as a
  failure during that window; watch for the setup commit on the base, then the slice. A
  genuine setup failure surfaces as **exit 8** (handled below). `MMD_SKIP_SETUP=1` skips it.
- Set up a **per-run watcher** that wakes you when the run ends instead of busy-polling —
  watch the run's OWN log sentinel / `status.json.state` flipping to `done`/`failed`, not a
  shared `pgrep` that could match an unrelated `claude` process. Optionally set
  `MMD_NOTIFY_URL=<your ntfy/Slack sink>` before launch so MMD pushes a `run_done`/
  `run_failed` signal itself (opt-in, best-effort — L-026).
- **Report honestly** at each check: state, latest commit, and — when `status.json.judge`
  or a non-zero exit appears — the real verdict. Never round a `running` or `failed` up to
  "done" (ai-coding.md §I).

**On green** (`status.json.state == done`, tests pass), do NOT merge silently — **offer**:
```bash
# verify first
cd <REPO_ROOT> && npm run test:full | tail -5
# then, with the user's go-ahead:
git checkout main && git merge --ff-only slice/<slug>-...
git tag -a v<X.Y.Z> -m "<readable release note>" && git push && git push --tags
git branch -d slice/<slug>-...
```
Merge is **fast-forward only** (`--ff-only`) and the tag is **annotated** (`-a`). Present
this as an offer with the exact commands; let the user confirm before touching `main`.

If the run **fails** (exit 6 tamper/seal, exit 7 behavioral-gap — now also fired by the
default-on alignment gate when an acceptance criterion stays unmet, exit 8 setup, non-zero,
or `state == failed`): report the exit code and what it means, point at `status.json`
(`.judge` carries the per-AC verdict on an exit-7 alignment gap) and the log, and ask how to
proceed. Do NOT retry blindly — if it stalled, suggest `mmdream unblock <slice>` (the
5-Whys session, ai-coding.md §VI).

**Continue an interrupted run (`--resume`, v0.12.a).** If a run was killed mid-pipeline
(crash, reboot, Ctrl-C) and left a checkpoint, **`mmdream --here --resume`** (run from the
repo root, on the slice branch) relaunches a fresh auto-dev that reads `.mmd/local/checkpoint.json`
+ the `.mmd/local/handoff/<N>.md` notes and **continues from the last completed phase** — it
does NOT redo the spec or the completed phases. It is an **honest no-op** ("nothing to resume" /
"no resumable run found", exit 0) when the run already completed or there is no checkpoint —
never a fabricated continuation. Keep `MMD_TIMEOUT_MS=0` for the resumed run (the remaining
phases still need real time — L-016). Prefer `--resume` over relaunching from scratch: it skips
the work already on the branch. (Greenfield runs resume the same way: `mmdream "<dream>" --resume`.)

### Route (b) — a greenfield dream (a brand-new app)

Triggers when the intent is "build me a NEW app / PWA / project from scratch" — there is
no existing repo to modify; MMD should scaffold under `demo/<slug>/`.

Run MMD with the dream (no `--here`). With bun + node 20 on PATH:

```bash
export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH"
mmdream "<DREAM>"
```

MMD catches the dream, derives a slug, and scaffolds under
`<REPO_ROOT>/demo/<slug>/`. The same monitoring + honesty rules from Route (a) apply.
**Never launch against an empty `<DREAM>`** — if the intent is just the placeholder, stop
and ask the user for the real dream; do not generate anything against a blank.

### Route (c) — a bare MMD subcommand

Triggers when the intent names a read-only / utility subcommand directly, e.g.
`discover`, `serve`, `document-review`, `handover`, `document-readme`, `document-compact`,
`unblock`. Just run it (it is not a long detached slice), with bun + node 20 on PATH:

```bash
export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH"
mmdream <subcommand> [args]
```

Report the result plainly. These are fast and mostly read-only (e.g. `document-review`
writes only its dashboard; `discover` writes only its report) — no detached watcher needed.

---

## If unsure which route

If the intent is ambiguous (could be a code change OR a fresh app), ASK the user one
clarifying question before launching anything. A 30-minute detached run started against a
misread intent is the expensive mistake — a single question is cheap. When in doubt,
prefer the most narrowly-scoped action (ai-coding.md §II).
