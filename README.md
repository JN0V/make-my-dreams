# Make My Dreams (MMD)

> An accessibility and orchestration layer for AI-driven development. From a 13-year-old kid to a 30-year veteran — same tool, adapted experience.

## What this is

Make My Dreams (MMD) lets any human describe an application need in natural language and see a working MVP delivered quickly, then enriched iteratively.

MMD is built **on the shoulders of** existing frameworks rather than replacing them:

- **[Spec Kit](https://github.com/github/spec-kit)** — versioned constitution + spec-driven workflow
- **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** — lightweight spec-first alternative
- **[BMAD](https://github.com/bmad-code-org/BMAD-METHOD)** — agent personas (Mary, Winston, Amelia…) and structured workflows
- **[gStack](https://github.com/garrytan/gstack)** — 41 mature skills covering the full sprint cycle
- **[Ralph Loop](https://ghuntley.com/loop/)** — minimalist bounded loop pattern

What MMD adds: multi-audience accessibility (Kid → Pro), reflexive bootstrap (MMD improves MMD), stateless hierarchical orchestration, brownfield Project Onboarder, local parallelization via git worktrees.

**MMD's success is the success of the projects it stands on.**

## Install

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/JN0V/make-my-dreams/main/install.sh | bash
```

This clones MMD into `~/Documents/make-my-dreams/` (override with `MMD_HOME=/path`), installs the **foundation MMD stands on** (BMAD + the auto-dev workflow + the project constitution), and installs `bun` + gStack by default (recommended). Hard prerequisites for the MMD **core**: `git`, `node` (v20+), `npx`, `claude` (Claude Code CLI) — the core (`mmdream serve`, `mmdream "<dream>"`, `mmdream --here`, `discover`, `document-*`, `test-health`, `secret-scan`, `deps-gate`, …) runs on these alone.

> **The stacks MMD stands on are the foundation, not extras — but MMD is honest when one is absent.** `bun` + gStack power the review commands `mmdream qa` / `mmdream cso` / `mmdream document-release`, so the installer offers to install them **by default**. If you decline (or in CI without a terminal), MMD does **not** silently ship a half-working install: it tells you exactly which commands are unavailable and how to enable them later. The env-vars are the **escape hatch**, not the price of entry: `MMD_AUTO_INSTALL_BUN=1` / `MMD_AUTO_INSTALL_GSTACK=1` provision them non-interactively (CI), and `MMD_SKIP_GSTACK_PROMPT=1` / declining the prompt opts out.

> **Piped one-liner stays interactive.** `curl … | bash` makes stdin a pipe; the installer prompts via the controlling terminal (an actual open-test on `/dev/tty`, so a terminal-less container/CI falls cleanly through to non-interactive mode rather than crashing).

Manual install (if you prefer to read the script first or operate offline):

```bash
git clone https://github.com/JN0V/make-my-dreams.git
cd make-my-dreams
bash install-mmd.sh .
```

> **v0.2.f install hardening** (2026-05-17): `install-mmd.sh` now installs `bun` + `gStack` *functionally* (verifies they respond, not just present), and writes `bin/mmdream` — a shell shim that prepends `~/.bun/bin` to `PATH` before delegating to `node bin/mmd.js`. This closes the L-012 gap (`docs/lessons-learned.md`) where gStack-dependent subprocesses could not find `bun` in non-interactive `PATH`. Toggles: `MMD_AUTO_INSTALL_BUN=1` (skip the y/N prompt), `MMD_AUTO_INSTALL_GSTACK=1` (same for gStack), `MMD_REQUIRE_GSTACK=1` (make bun + gStack mandatory: declining or broken exits non-zero). See [`install-mmd.sh`](./install-mmd.sh) for the full phase layout.

> **v0.2.m all-five-pillars install** (2026-05-30): `install-mmd.sh` now detects, offers to install, and functionally verifies **all five** "stands on the shoulders of" pillars — not just bun + gStack. Three new phases follow the v0.2.f detect→offer→verify shape: **Phase 5 — Spec Kit** (`specify --version`, installed via `uv tool install specify-cli`), **Phase 6 — OpenSpec** (`openspec --version`, via `npm install -g openspec`), **Phase 7 — Ralph Loop** (Claude Code plugin `ralph-loop`, via `claude plugin install`; pre-check skips cleanly on pre-2.1 Claude Code). Each honors `MMD_AUTO_INSTALL_<PILLAR>=1` and `MMD_REQUIRE_<PILLAR>=1`. The run ends with an **`═══ Install summary ═══`** banner showing each pillar's status at a glance. This is the install-side closure of L-012 (every claimed pillar is now installable + verifiable on a fresh machine). See [ADR-017](./docs/adr/017-three-pillars-install-hardening.md) for the design rationale.

## Usage

### CLI mode (terminal)

```bash
cd ~/Documents/make-my-dreams
mmdream "a drawing app that overlays an image on the camera feed"
# → creates ./demo/drawing-app-overlays-image-camera-feed/ with a working PWA
```

**Interactive Dream Catcher dialogue (`mmdream "<dream>"` on a TTY) — *new in v0.3.b*.** When you run `mmdream "<dream>"` in a terminal, MMD now refines your dream **before** launching — the same dialogue the web mode runs, driven over the *same* surface-agnostic core ([`lib/dream-catcher/`](./lib/dream-catcher/)), just in the terminal:

```
mmdream "une appli pour dessiner"        (on a TTY)
  → C'est pour qui ?  [enfant / curieux / pro]
  → Niveau ?          [auto / équilibré / guidé]
  → (guidé) Q1 → réponse → Q2 → réponse …
  → ✨ Scope  → [R]ecommencer / [M]odifier / [Entrée]=C'est parti
  → existing auto-dev launch with the refined scope
```

- **TTY-gated by default**: `shouldCatch = --catch || (stdin.isTTY && !--no-catch)`, and **never under `--here`**. So a terminal user gets the dialogue automatically, while `mmdream "…" | cat` (no TTY) and CI launch the **verbatim dream** directly, unchanged.
- **`--catch` / `--no-catch`** (mutually exclusive): `--catch` forces the dialogue (exit 2 on a non-TTY — it needs a terminal); `--no-catch` skips it even on a TTY.
- **`[M]odifier`** edits the scope in place — opens `$EDITOR` on it if set, else a single-line replacement prompt. **`[R]ecommencer`** restarts from the profile step. An aborted dialogue (Ctrl-D / EOF) does **not** launch.
- The refined scope replaces the dream fed to auto-dev, and the chosen **profile** is persisted to `status.json` **and threaded into the build** via `MMD_PROFILE` (see below).
- If BMAD fails or returns nothing usable, the Dream Catcher is honest (universal §VI): it launches your **verbatim dream** with a visible note rather than fabricate a scope.

See [ADR-023](./docs/adr/023-dream-catcher-cli-and-profile.md) and [L-022](./docs/lessons-learned.md).

**`MMD_PROFILE` — the profile reaches the build — *new in v0.3.b, composer added in v0.3.c*.** The audience profile chosen in the dialogue (`Kid` / `Curious` / `Pro`, default `Curious`) is exported as `MMD_PROFILE` into the auto-dev subprocess on **both** surfaces (CLI greenfield and the web `/api/catch/confirm`). The auto-dev prompt then **states the profile** and injects the **constitution modules bound to it** via the **Layer C composer** (`lib/constitution-compose.js`): `MMD_PROFILE` resolves through `.specify/memory/constitution-bindings.yaml` to `defaults.always ∪ profiles[profile]`, and each `.specify/memory/constitution/<name>.md` is read and concatenated into the prompt under per-module headers. So a **`Kid`** build now carries the full `safe-by-default.md` + `kid.md` text (no network, no third-party services, hardware permission on gesture only, no commerce/social, accessibility, age-appropriate), a **`Curious`** build carries `safe-by-default.md`, and a **`Pro`** build carries `pro.md`. If the bindings file or a module is unreadable the composer returns `null` and `buildPrompt` falls back to v0.3.b's minimal Kid line — graceful, never a crash (universal §VI). An unset `MMD_PROFILE` leaves the prompt unchanged (back-compat). The composer uses a hand-rolled YAML-lite parser (no `yaml` dependency, vanilla stack); it composes by **profile** only for now (engine/context/skill dimensions are a future slice — the resolver is built to extend). The profile is no longer a dead `status.json` field — see [ADR-024](./docs/adr/024-constitution-composer-layer-c.md) and [L-022](./docs/lessons-learned.md).

Env vars: `MMD_AUTODEV_CMD` (override subprocess for testing), `MMD_AUTODEV_MODE` (`cli` | `test` — explicit, replaces the v0.1 path heuristic), `MMD_QUIET=1` (suppress subprocess output on the terminal; log file preserved), `MMD_TIMEOUT_MS` (default 1800000), `MMD_REALITY_CHECK_BACKEND` (`mcp` | `playwright` | `skip`), `MMD_DREAM_MAX_LEN` (default 500), `MMD_PROFILE` (`Kid` | `Curious` | `Pro` — audience profile threaded into the build; usually set by the dialogue, `Kid` → safe-by-default prompt), `MMD_NOTIFY_URL` (opt-in Conductor notification sink — *new in v0.5.a*; when set, MMD POSTs a ✅/❌ payload on run done/failed; unset = no network call), `MMD_HANDOFF_THRESHOLD` (context % that triggers the `--monitor` READY_FOR_HANDOFF signal + `context_70` notification — *new in v0.5.b*; default `0.70`, honored when in `(0,1]`), `MMD_MAX_HANDOFFS` (max handoffs under `--auto-handoff` before one final un-enforced successor — *new in v0.13.a*; integer ≥ 1, default `3`, junk/0 → default), `MMD_HANDOFF_GRACE_MS` (HYBRID enforce grace — *new in v0.14.b*; ms MMD waits for the orchestrator to exit cooperatively after ignoring the incitation, before terminating its process group at the checkpoint; non-negative integer, default `15000`, `0` honored), `MMD_NO_AUTO_HANDOFF=1` (the single opt-out for the transparent Conductor — *new in v0.15.a*; restores the pre-v0.15 plain text spawn — one un-looped auto-dev run, no monitor, no handoff loop; unset = the Conductor is on by default), `MMD_MODEL_<ROLE>` (model-per-task override — *new in v0.16.a*; pin the model for any Conductor role — `ORCHESTRATOR`/`SPEC`/`IMPL`/`REVIEW`/`JUDGE`/`TESTER`/`UNBLOCK` — e.g. `MMD_MODEL_IMPL=sonnet`; unset = the cost-aware default: orchestrator/review/judge/tester/unblock → `sonnet`, spec/impl → `opus`; `MMD_AUTODEV_MODEL` still globally overrides the orchestrator).

### FAST mode — *new in v0.2*

For small features or quick iterations on brownfield projects, prefix the dream with `--fast`:

```bash
mmdream --fast "add a red color button to the drawing app"
```

FAST runs a **trimmed auto-dev pipeline** with reduced ceremony — 1× Party Mode (instead of 3×), Phase 2 adversarial spec review skipped opportunistically (when the upfront spec passes a robustness heuristic), Phases 3 + 4 kept full because correctness is non-negotiable. Target wall-clock: **under 10 minutes per slice**, versus 30–90 min for the default `mmdream <dream>` (STANDARD engine).

Before invoking auto-dev, FAST writes a deterministic 1-page minimal spec to `.mmd/shared/slice.md` (≤ 50 lines, ≤ 3000 chars, generated heuristically from the dream + any existing `vision.md`). Without this grounding the trimmed pipeline diverges; with it, the LLM stays on track. See [ADR-004](./docs/adr/004-fast-engine-trimmed-not-ralph.md) for why FAST is a trimmed auto-dev rather than a Ralph Loop.

After the run, `.mmd/shared/status.json` records the engine and a few metrics that seed the future `dream-bench` (v0.2b):

```json
{
  "engine": "fast",
  "engine_metrics": {
    "duration_seconds": 412.3,
    "party_mode_rounds": 1,
    "phase2_skipped": null,
    "phase2_skip_reason": null
  }
}
```

FAST-specific env vars:
- `MMD_FAST_MAX_MINUTES` — soft budget (default 12). If the run exceeds it, stderr emits a warning suggesting `--standard`; the subprocess is NEVER killed (would lose work).

Engine flags (`--fast`, `--standard`, `--deep`) are mutually exclusive. `--standard` and `--deep` parse cleanly in v0.2 but resolve to the default STANDARD engine — their distinct semantics land in v0.2d. POSIX `--` is supported: anything after `--` is treated as positional dream text, so a dream like `--literally-my-dream` can be passed as `mmdream -- --literally-my-dream`.

### Self-modification mode (`--here`) — *new in v0.2a*

For small in-place changes to **an existing git repo** — including MMD itself — pass `--here`:

```bash
cd ~/Documents/make-my-dreams
mmdream --here "add a banner at the top of README.md that links to BOOTSTRAP.md"
```

`--here` skips `demo/<slug>/` and works **on the current repo**:

1. Validates that cwd is a clean git repo (exits 3 if not a repo, exits 4 if the working tree is dirty).
2. Creates a slice branch `slice/here-<dream-slug>-<unix-timestamp>` from HEAD (exits 5 if `git checkout -b` fails).
3. Invokes auto-dev with an in-place prompt — explicitly told NOT to scaffold a new PWA.
4. Writes `.mmd/shared/{vision,slice,status.json,decisions.log}` under the target repo with `mode: "here"`, `target_dir`, `slice_branch`, `base_branch`, `base_sha`.
5. **Never auto-merges** — the human reviews the slice branch and merges (or discards) it.

After the run, MMD prints the slice branch name and the three follow-up commands:

```
[OK] Changes applied on slice/here-add-a-banner-1779537600. Review with: git diff <base_sha>..HEAD
     Merge with:  git checkout main && git merge --ff-only slice/here-add-a-banner-1779537600
     Discard with: git checkout main && git branch -D slice/here-add-a-banner-1779537600
```

Engine flags compose with `--here` (`mmdream --here --fast "<change>"` is valid). Reality Check is short-circuited in `--here` mode — there is no PWA to open. If the target repo has a `package.json` with a `test` script, MMD suggests `npm test` (suggestion only, never auto-runs).

**Why explicit and not auto-detected?** See [ADR-005](./docs/adr/005-here-mode-explicit-flag-not-auto-detect.md). Short version: silent in-place mutation is destructive-by-default — a footgun for any user running mmdream from inside a personal git repo. `--here` requires a named opt-in.

**Operate on any project (`--here`).** This is the implementation step that fulfills the reflexive bootstrap [MAKE_MY_DREAMS.md §7](./MAKE_MY_DREAMS.md): from v0.2a onward, the same CLI works on greenfield (`demo/<slug>/`) and on any existing repo (in-place). Self-development of MMD now flows through the supported path rather than bypassing it (cf [`docs/lessons-learned.md`](./docs/lessons-learned.md) L-009).

**Prompt-grounding check — *new in v0.2.h*.** Before creating the slice branch, `--here` parses your dream for documented file references (`SPEC_*.md`, `docs/*.md`, `.specify/memory/*.md`, and root files like `MAKE_MY_DREAMS.md`, `README.md`, `package.json`) and verifies each one exists on the slice's base via `git cat-file -e`. If any cited file is missing, `mmdream` exits with **code 6** and lists the missing paths plus how to fix it (commit the files to the base first, or remove the references from the dream) — instead of spending 30+ minutes of auto-dev on a prompt that references a file that isn't there (the failure captured in [`docs/lessons-learned.md`](./docs/lessons-learned.md) L-015). The check is deterministic, closed-pattern (no LLM), and runs in well under 100 ms. To bypass it — e.g. when a path lives somewhere the patterns don't recognize — set `MMD_SKIP_GROUNDING=1`; the slice then proceeds with a warning, at your own risk. See [ADR-013](./docs/adr/013-prompt-grounding-check.md).

`--here`-specific env vars:
- `MMD_HERE_PROTECTED_BRANCHES` — comma-separated list (default `main,master`). `--here` from a protected branch is NOT an error — the slice branch is still created from HEAD. This env var documents the protected names for future Conductor enforcement.
- `MMD_SKIP_GROUNDING` — set to `1` to bypass the prompt-grounding check (above). Not recommended; emits a warning and proceeds.

### Sealed-test oracle (`mmdream --sealed`) — *new in v0.4.a; `--here` in v0.4.b; import-graph blast radius in v0.4.c; behavioral judge in v0.4.d*

The classic AI-coding failure is **making a test pass by rewriting the test, not the code** (PROBLEMS.md P-04 — ~a quarter of "verified" SWE-bench-Pro patches are actually wrong). `mmdream --sealed "<dream>"` is an opt-in guard against it: an **independent oracle** that the implementing agent cannot quietly weaken.

```bash
mmdream --sealed "a counter app with + and − buttons"   # greenfield
mmdream --here --sealed "add a dark-mode toggle"          # in-place, incl. MMD itself (v0.4.b)
```

It runs a **two-phase, MMD-orchestrated** flow:

1. **TESTER** — a `claude -p` sub-agent derives acceptance tests from your dream (and `slice.md`, if present) into a sealed directory (`<target>/.mmd/shared/sealed-tests/` — `demo/<slug>/` on greenfield, the repo root on `--here`). It is told, emphatically, **not to implement the app** — the oracle must be blind to the implementation.
2. **SEAL** — MMD records a sha256 manifest of every sealed test file.
3. **CODER** — the existing auto-dev runs as usual, with a prompt stating the sealed directory is a **read-only oracle**: read the tests to learn the target behaviour, but never edit, weaken, rename, or delete them. (Greenfield runs the coder on `demo/<slug>/`; `--here` runs it on the slice branch.)
4. **VERIFY** — MMD re-hashes the sealed directory. Any **tampered** or **removed** file is a seal break: `mmdream` exits **non-zero naming the file(s)** and the slice is **not** marked done and **not** merged (anti-P-04). Files the coder *adds* (its own helper tests) are allowed.
5. **RE-RUN** — on an intact seal, MMD re-runs the sealed tests as an independent oracle (a failure flags the slice, exit 6). This is the **deterministic gate**.
6. **JUDGE** *(new in v0.4.d)* — once the deterministic gate is green, a `claude -p` **behavioral oracle** grades the implementation against **what was asked** (the dream / ACs), using the sealed tests + the produced artifacts as evidence. This closes a different gap (PROBLEMS.md **P-09**): *a passing test suite proves the code does what it does, not what was asked* — a suite can be adequate-but-incomplete. The judge emits a deterministic tagged verdict (one `AC <id>: MET|NOT-MET|UNCERTAIN — reason` line per AC + an `OVERALL:` line); MMD parses it into a closed set. **All ACs `MET` → the slice proceeds; any `NOT-MET`/`UNCERTAIN` (or an unparseable reply) → `mmdream` exits `7` (behavioral-gap), the slice is *not* marked done, and the per-AC verdict is printed and written to `status.json.judge`.** Like the 5-Whys, an unreadable verdict (parse failure, judge spawn error, timeout) falls back to **`uncertain` — never a fabricated `met`** (the sacred fallback, §VI). **Exit 7 is distinct from exit 6** so the two oracle failures are distinguishable: 6 = the check was attacked or the tests went red; 7 = the tests are green but the implementation misses what was asked. The judge runs ONLY behind the deterministic gate (a tamper/red test still exits 6 *before* the judge), so a non-deterministic judge can only ever *block for human review* — never wave through a tamper or a red test. See [ADR-028](./docs/adr/028-llm-judge-behavioral-oracle.md).
7. **BLAST** — after the judge passes, MMD writes the **blast radius** to `status.json.blast_radius`. As of v0.4.c this is **import-graph accurate** (not the old grep stub): MMD parses every file's module specifiers, resolves each relative one to a concrete file (`./` vs `../` not conflated; comment-only mentions excluded), builds the import graph, and records the **transitive reverse closure** (`transitive`) — every file that imports a changed file directly or through a chain — alongside the direct `importers`. As of **v0.8.0 → v0.8.1** the import graph is **POLYGLOT** (constitution §VIII): a language-neutral core dispatches each file to a per-language **import-edge adapter** (`lib/code-graph/adapters/` — JavaScript + Python today), so a Python repo gets a real closure and a file whose language has no adapter (Rust/Go/C) is listed honestly in `unanalyzed` rather than silently dropped. JS is byte-for-byte unchanged (the sealed-gate regression lock). See [ADR-043](./docs/adr/043-polyglot-import-graph.md).

The TESTER → SEAL → VERIFY → re-run → JUDGE → BLAST steps are **surface-agnostic** (`runSealedPipeline`, with the coder injected as a callback); only the coder differs between greenfield and `--here`. The **reflexive payoff** of v0.4.b: the same anti-P-04 oracle that guards a generated app now guards **MMD modifying itself** — a self-dev slice can be launched with `mmdream --here --sealed` so an independent sealed oracle verifies its own correctness.

Honesty is non-negotiable (constitution §VI): a tester that fails or writes nothing, an empty seal, a coder error, a tamper, a failing sealed test, or a judge that finds a behavioral gap each surface **explicitly** — never a silent "sealed OK". `--sealed` composes with the engine flags and `--here` (`mmdream --here --sealed --fast "<change>"`). The **default path (no `--sealed`) is byte-for-byte unchanged** on both surfaces. With v0.4.d, Bundle B has **both** oracles: the deterministic sealed-test gate (P-04) *and* the behavioral judge against what-was-asked (P-09).

Deferred to a follow-up: `--sealed` as a Standard-engine default (see [ADR-026](./docs/adr/026-sealed-test-oracle.md)); a **`--judge-advisory`** warn-only judge mode and a **multi-judge majority vote** to dampen the single judge's non-determinism (see [ADR-028](./docs/adr/028-llm-judge-behavioral-oracle.md)). The blast radius graduated from grep stub to import-graph accurate in v0.4.c ([ADR-027](./docs/adr/027-import-graph-blast-radius.md)) with **zero new dependencies** (vanilla-stack); its documented residual gap is computed/runtime specifiers, re-export aliasing, and non-JS importers. Enforcement lives entirely at the **MMD layer** because the BMAD auto-dev workflow is gitignored — see the ADRs for why.

### Conductor notifications (`MMD_NOTIFY_URL`) — *new in v0.5.a*

MMD runs auto-dev **detached** (`setsid … mmdream --here "<dream>"`), so a run can churn for 30–90 minutes while you do something else. The cost was **silence** — you came back and polled `git log` / `status.json` to find out it had finished. v0.5.a adds an **opt-in, best-effort notification fan-out**: set `MMD_NOTIFY_URL` and MMD **POSTs** a small JSON payload to your own sink when a run ends.

```bash
# ntfy (zero-setup): pick any topic, subscribe on your phone, then —
export MMD_NOTIFY_URL=https://ntfy.sh/my-mmd-runs-8f3a
setsid mmdream --here "add a dark-mode toggle" &   # walk away
#  … 40 minutes later your phone buzzes:
#  ✅ slice/here-add-dark-mode-toggle-… finished (here-add-dark-mode-toggle-… (v0.5.0))
#  …or on failure:
#  ❌ slice/here-… failed (auto-dev exited with code 6)
```

The payload body is `{ event, slice, state, summary, ts, message }` — `event ∈ {run_done, run_failed}`, and a `message` one-liner so **ntfy** (which renders the request body) reads nicely. It also suits generic webhooks (Slack/Discord/custom). It carries **run metadata only** — slice id, state, a short summary, a timestamp — **never** secrets, env, code, or file contents (this is egress to *your* sink, so least-disclosure applies). It works on **both** the greenfield and `--here` completion paths, on `done` and `failed`.

It is **opt-in and best-effort, by design**: with `MMD_NOTIFY_URL` **unset** there is **no payload and no network call** (zero overhead, the default, byte-for-byte unchanged behavior); with it set, a **delivery failure** (dead URL, non-2xx, timeout, network down) logs one stderr line and is **dropped** — the run's exit code and `status.json` are **never** affected, and the send is bounded by a short timeout (default 5 s) so a slow sink can't delay the run's exit. This is the **first brick of the v0.5 Conductor** (the orchestration/observability layer) and the direct fix for the "I keep having to ask where things are" feedback. The `stream-json` live context monitor + the 70% auto-handoff are the **v0.5.b** follow-up (they change the auto-dev spawn — riskier). See [ADR-029](./docs/adr/029-conductor-notifications.md) and [L-026](./docs/lessons-learned.md).

### Live context monitor (`--monitor`) — *new in v0.5.b*

The second brick of the Conductor: an **opt-in** flag that lets MMD **see** how full the orchestrator's context window is during a long auto-dev run — the precursor to the eventual auto-handoff (start a fresh context before the current one degrades).

```bash
mmdream --monitor "a tiny counter app"          # greenfield
mmdream --here --monitor "add a dark-mode toggle" # in-place, incl. MMD itself
```

With `--monitor`, MMD spawns auto-dev as `claude -p … --output-format stream-json --verbose`, parses each event's `usage` as it streams, and computes the **% of the context window** consumed (`input_tokens + cache_read_input_tokens + cache_creation_input_tokens` ÷ the window). It writes the running **max** to `status.json.context = {model, window, tokens, pct, estimated}`, and re-renders **human-readable** progress to the tee — the assistant's text plus periodic `[monitor] context X% (tokens/window)` lines, **not** the raw JSON stream (`MMD_QUIET=1` still silences the terminal tee while keeping the log). The window is looked up from the model id the stream reports: a `[1m]` suffix (e.g. `claude-opus-4-8[1m]`) → **1,000,000**; a known model → **200,000**; an unrecognized one → 200,000 flagged `estimated:true` (an honest default, never a fabricated exact %).

When the context first crosses **`MMD_HANDOFF_THRESHOLD`** (default `0.70`; a custom value in `(0,1]` is honored), MMD writes a `READY_FOR_HANDOFF` marker into `status.json`, logs a line, and — if `MMD_NOTIFY_URL` is set — fires a **`context_70`** notification **exactly once** (debounced), reusing the v0.5.a fan-out. With plain `--monitor` it does **not** stop the run (observability + early warning); **v0.13.a's `--auto-handoff`** turns that signal into an action (below).

**Opt-in is deliberate and safety-critical.** The default text-spawn path is the one `mmdream --here` uses to build everything *including MMD itself* (the reflexive bootstrap) — so `--monitor` leaves it **byte-for-byte untouched** (the default args carry no `--output-format`, pinned by a test). It is **the orchestrator's** context, not per-sub-agent (the Phase 1–4 sub-agents run in their own fresh contexts the top-level stream can't see). Deferred: per-sub-agent accounting and making `--monitor` the default. The serve-UI gauge that displays `status.json.context` landed in **v0.5.c** (below); the actual auto-handoff/resume landed in **v0.13.a** (below). See [ADR-030](./docs/adr/030-live-context-monitor.md) and [L-027](./docs/lessons-learned.md).

### Auto-handoff at 70% (`--auto-handoff`) — *cooperative in v0.13.a, HYBRID (incite + enforce) in v0.14.b*

The Conductor finally **acts** on the 70% signal it has been able to **see** since v0.5.b. For a long run that may fill the orchestrator's context, `--auto-handoff` hands off to a fresh successor instead of letting the macro-context degrade or hit a wall.

```bash
mmdream --here --auto-handoff "a big multi-AC refactor"   # in-place, incl. MMD itself
mmdream --auto-handoff "a large greenfield app"           # greenfield
```

**Why HYBRID (v0.14.b).** v0.13.a was cooperative-*only*: at the threshold MMD's monitor writes the **handoff-request marker** (`.mmd/local/handoff-request`) and the orchestrator is asked to stop cleanly at the next phase boundary. The instruction is correct, but a live run proved the LLM **does not obey it** — it ran past ≥2 boundaries to ~120% context with 0 handoffs (a `claude -p` agent has no reliable self-terminate primitive). So v0.14.b keeps the gentle ask **and** adds a backstop:

- **Incite (Path A, unchanged).** If the orchestrator **obeys** — exits cleanly at a boundary (incomplete checkpoint + marker) — MMD relaunches a fresh successor in resume mode (the v0.12.a `--resume` machinery). No force.
- **Enforce (Path B, new).** If it **ignores** the incitation — it advances the checkpoint a **new** phase while **over** the threshold and is **still alive** — MMD waits a short **grace** (`MMD_HANDOFF_GRACE_MS`, default `15000` ms — a last chance to exit on its own), then **terminates the orchestrator process group (SIGTERM → SIGKILL) at that checkpoint** and relaunches resume.

**The enforce is safe.** Termination happens **only at a phase checkpoint** — the phase just completed and its per-AC commits (L-019) are already in git, so **no committed work is lost**; only the un-checkpointed reasoning since the last boundary, which the fresh successor re-derives. MMD kills the **process group** (auto-dev's `claude -p` spawns children) of a detached spawn, never orphaning. This is the §4.2 "killed → recreated from the files" property, done at a safe point, as a backstop, after asking nicely first.

It is **bounded + honest**: handoffs (cooperative or enforced) are capped by **`MMD_MAX_HANDOFFS`** (default `3`); at the cap MMD launches **one final un-enforced successor** (it runs to done or fails naturally) and logs the cap — progress is never infinitely deferred. A **`handoff`** notification fires per handoff (reusing the v0.5.a fan-out). The v0.11 alignment gate runs **once** on true completion, not per successor. The log honestly distinguishes a clean stop (Path A) from an **enforced** terminate (Path B).

**Opt-in by construction.** `--auto-handoff` **implies `--monitor`** (the context usage only exists in the stream-json spawn) and the abort seam is inert without it — the spawn is detached **only** when the predicate is supplied. Without the flag — and even with plain `--monitor` — **no marker is written and nothing is terminated**, so the default text spawn (the reflexive-bootstrap path that builds MMD itself) and the single-spawn flow are **byte-for-byte unchanged** (pinned by a test). It reuses the v0.12.a resume + checkpoint, the v0.13.a `decideHandoff` + its v0.13.1 gate, and the v0.5.a notify — the only new code is an **abort seam** on `invokeAutodev`, the pure `shouldForceHandoff` gate, and the grace.

**Honesty (§VI).** The enforce (SIGTERM at a checkpoint) is deterministic + fully tested; the **resume after a forced kill is still LLM-dependent and proven only by an operator/live run** (a resume failure is reported as a wall, never a green-by-fakes "done" — the exact trap that hid the cooperative bug). Deferred: enforce mid-phase (before any checkpoint), sub-phase granularity, adaptive thresholds, parallel handoff. (The transparent flip — making this the default — shipped in v0.15.a, below.) See [ADR-053](./docs/adr/053-hybrid-auto-handoff-enforce.md), [ADR-051](./docs/adr/051-cooperative-auto-handoff.md), [ADR-050](./docs/adr/050-stateless-resumable-orchestrator.md), and [L-027](./docs/lessons-learned.md).

### The transparent Conductor — auto-handoff is now the DEFAULT — *new in v0.15.a*

The hybrid auto-handoff above was **proven live** in v0.14.b, so v0.15.a makes it **transparent**: the monitored spawn **and** the hybrid handoff loop now run **by default** on `mmdream --here`, the greenfield path, and `serve` — **no flag, no checkbox**. The Conductor's job (vision §4.2) is to be **invisible**, and a non-technical `serve`/Dream-Catcher user will never pass `--auto-handoff`; opt-in meant the people who most need an invisible context manager never got one.

```bash
mmdream --here "a big multi-AC refactor"     # monitored + hybrid handoff, automatically
mmdream "a large greenfield app"             # same — no flag needed
MMD_NO_AUTO_HANDOFF=1 mmdream --here "…"      # the single opt-out: pre-v0.15 behavior exactly
```

This is a **defaults flip + a single opt-out + back-compat** — **no handoff logic is re-implemented** (the entire v0.14.0 machinery is reused unchanged). **`MMD_NO_AUTO_HANDOFF=1`** restores the pre-v0.15 behavior *exactly*: a plain text spawn, one un-looped auto-dev invocation, no monitor, no loop (the bootstrap/cost escape hatch). The legacy **`--auto-handoff` / `--monitor` flags become accepted-but-inert no-ops** (kept so old scripts never hit an "unknown flag" error; they change nothing — the Conductor is already on). The `serve` "Monitor context (advanced)" checkbox is **retired** — the gauge now shows transparently whenever context data exists.

**Why the retired byte-for-byte-default-spawn contract is safe.** `stream-json` changes only the **output format**, not the agent's work (the monitor re-renders human-readable progress), so the reflexive bootstrap self-build runs monitored by default with the suite green and the result unaffected. The v0.13.1 **no-false-handoff** gate is preserved (a run that crosses the threshold but reaches no new boundary is never killed — proven by default-on integration tests covering both the cooperative and enforce paths with no flag), and the opt-out restores today's exact path. The spawn-pin tests are **inverted** (default has stream-json; the opt-out is byte-for-byte historical). **Noted open question** (not blocking): whether the orchestrator genuinely saturates on a real slice is unmeasured — it delegates phases to fresh sub-agents, so it may stay light; default-on is safe regardless (the hybrid only acts at the threshold) and reversible. See [ADR-054](./docs/adr/054-transparent-conductor-default.md).

### Context gauge in `mmdream serve` (now automatic) — *v0.5.c, transparent since v0.15.a*

The monitor above is great in a terminal, but `mmdream serve` exists for the non-technical user — who never sees a JSON file. v0.5.c made it **visible** with a context gauge; **since v0.15.a it is automatic** — the Conductor is on by default, so the progress view shows the live **context gauge** with no checkbox to tick: a bar (% of the model's context window), the humanized token count (`337k / 1.0M`), the model, a 70% threshold marker, and a "⚠️ ready for handoff" badge once the threshold is crossed.

```
   ▓▓▓▓▓░░░░░  34%  (337k / 1.0M tokens · claude-opus-4-8[1m])   ┊70%
```

The page polls `GET /api/status/<slug>` every ~3 s and re-draws the gauge from the response's `.context`. Polling (not SSE-push) keeps the gauge **decoupled** from the progress feed — a failed/slow poll is swallowed and **never breaks the page or the SSE stream** — and the gauge auto-hides when there is no context to show. The monitored run re-renders readable text to stdout, so the SSE contract is untouched. The gauge markup is CSP-safe (a native `<progress>` bar + an external-CSS 70% marker — the page runs under `style-src 'self'`). The pre-v0.15 "Monitor context (advanced)" checkbox was **retired** when the Conductor became transparent (`MMD_NO_AUTO_HANDOFF=1` opts the whole machine out). See [ADR-031](./docs/adr/031-serve-ui-context-gauge.md), [ADR-054](./docs/adr/054-transparent-conductor-default.md), and [L-027](./docs/lessons-learned.md).

### The autonomous Documentalist — `mmdream document` — *new in v0.19.0*

The Documentalist shipped as **six** separate commands (`handover`, `document-readme`, `document-review`, `document-compact` + the two mis-filed `document-lessons`/`document-release`), but the vision (`MAKE_MY_DREAMS.md` §6.4) was always **one** agent. `mmdream document` is that agent: ONE autonomous maintenance pass over the whole doc set, **reusing** the already-built capabilities (no detection/render/plan logic re-implemented) and **auto-committing the lossless/mechanical work**.

```bash
mmdream document             # the fixer — one pass, auto-commit the lossless changes
mmdream document --check     # the CI/pre-push GATE — exit 1 on any conformance drift, 0 clean
mmdream document --dry-run   # preview the whole pass; change nothing (clean tree after)
mmdream document --no-commit # write the changes but create no commit
```

One pass runs four maintenance hats and prints **one unified report**:

1. **met à jour** — refresh HANDOVER.md's State block + README.md's Status + Changelog blocks (lossless → auto-committed).
2. **détecte** — write the coherence/drift/conformance dashboard to `docs/coherence-review.md` (DETECT only — the auto-corrector is v0.20).
3. **consolide** — archive shipped root `SPEC_V*.md` → `docs/specs/` with an index and rewritten references (lossless → auto-committed).
4. **liens** — report the doc↔code↔ADR coupling for the files changed this pass.

Only **lossless/mechanical** changes are committed (regenerable blocks, the dashboard, the SPEC archival) — **no prose is cut** (the risky semantic conciseness pass is the deferred v0.21 branch+oracle work). The four maintenance commands become **deprecated aliases** (each prints a one-line `[DEPRECATED]` notice pointing at `mmdream document` and still runs unchanged — back-compat); `document-lessons` + `document-release` are untouched (autolearning + generation are different agents). See [ADR-058](./docs/adr/058-document-orchestrator.md).

### The Documentalist's 5 blind-spots, closed — `mmdream document-review --check` — *new in v0.18.0*

The Documentalist's job is to keep the docs TRUE; it had failed at that — it missed a stale `install-mmd.sh` recommendation, a stale README promise, and called a capability 🟡 *partial* because a tag NUMBER matched. v0.18.0 closes all five gaps, staying **deterministic** (no `claude`), **precision-first**, and **read-only beyond `docs/coherence-review.md`**:

1. **Honest roadmap reconciliation** — a `partial`/`built` verdict now requires a real capability-**NAME** match; a weak token or a shipped-tag NUMBER alone reads ❓ *unknown* ("can't tell from names alone"), never a falsely-comforting *partial*.
2. **A wider scan surface** — the conformance scan now reaches beyond markdown into `install-mmd.sh` `printf`/`echo` output and the CLI `--help`/USAGE text (a new pure `lib/documentalist/ux-text-surface.js`), exactly where the stale `/bmad-adv-auto-dev` "try this" lived.
3. **A deterministic deprecated-surface check** — a curated stale token recommended as the current entry (`/bmad-adv-auto-dev` instead of `mmdream`, a bare `mmd <command>` recommendation) is flagged, with the deliberately-kept `MMD_*`/`.mmd/`/`bin/mmd.js` surfaces never tripping it.
4. **A version-pinned-promise check** — a forward promise pinned to a version that came due (the README License-promise case) is flagged; a still-future promise and historical narrative are not.
5. **Teeth** — `mmdream document-review --check` exits **1** on any conformance drift (dangling refs / stale facts / stale promises / deprecated-surface), **0** when clean (the `secret-scan`/`deps-gate` gate contract — pre-push / CI). The roadmap heuristic is advisory and does NOT gate. The plain `document-review` stays report-only + read-only.

See [ADR-057](./docs/adr/057-documentalist-close-5-blind-spots.md).

### Align the result to the ORIGINAL expectation — frozen oracle + dual-face verify — *new in v0.17.0*

MMD now guarantees the delivered result matches **what was originally asked**, and corrects it when it doesn't. At run start, the **original expectation is frozen** into `.mmd/shared/expectation.md` (the dream + any Dream-Catcher scope) — written **once, never overwritten** (anti-drift: the build may rewrite `slice.md`/spec, but the oracle the gate verifies against can't move). The completion gate is **dual-face**, both anchored to that frozen oracle: the **semantic** judge (v0.11, now grading against `expectation.md` not the mutable `slice.md`) asks *"does it fulfil the ask?"*, and the **deterministic** Reality Check — **un-skipped on `--here`** (it runs the project's tests via a technology-agnostic detector + a `run.json`-kind "does it run" check) — asks *"does it actually work?"*. A gap on **either** face drives the bounded iterate loop (`MMD_ALIGN_MAX_ITERS`) with feedback naming the failing face; an unresolved gap → **exit 7**, with `status.json.judge.face` recording which face failed (`semantic`/`deterministic`/`both`). `MMD_SKIP_ALIGN=1` opts the whole gate out (back-compat). Honest at every branch — never a fabricated pass. See [ADR-056](./docs/adr/056-align-to-original-expectation.md).

### Model-per-task — the Conductor allocates a model to each role — *new in v0.16.a*

Each task now runs on a model matched to its cognitive demand instead of one global default. A **pure, env-overridable policy** (`lib/conductor/model-policy.js`) maps each Conductor **role** to a model: the **orchestrator** runs LIGHT (`sonnet` — it coordinates, delegates, and hands off at 70% so it never needs a 1M window), while the **workers** that do the real reasoning run STRONG (`spec` + `impl` → `opus`); critique/grade roles (`review`/`judge`/`tester`/`unblock`) sit on `sonnet`. Any role is overridable via **`MMD_MODEL_<ROLE>`** (e.g. `MMD_MODEL_IMPL=sonnet`); `MMD_AUTODEV_MODEL` still globally overrides the orchestrator.

The policy is applied at **two layers**: **L1** — MMD's own `claude -p` calls (the behavioral judge, the sealed tester, the `unblock` 5-Whys session) each pass `--model modelForRole(<role>)` (MMD owns the spawn, so `--model` is honored). **L2** — the auto-dev parent runs as the `orchestrator` role, and the phase workers are **named sub-agents** (`.claude/agents/mmd-spec.md`/`mmd-impl.md`/`mmd-review.md`, materialized by `install-mmd.sh`) whose model is **pinned in frontmatter**; the workflow routes spec→`mmd-spec`, impl→`mmd-impl`, the reviewers→`mmd-review`. Per-subagent models are honored only **DETACHED** (MMD's `setsid` launch path; a Claude Code host forces Haiku when *attached* — bug #47488), so the per-role models are **live-verified** (a green suite can't prove it — the fakes don't spawn real models). See [ADR-055](./docs/adr/055-model-per-task-role-policy.md).

### Bench mode (`mmdream bench`) — *new in v0.2b*

`mmdream bench` runs a fixed corpus of 5 canonical dreams (3 kid + 2 pro, see [`bench/dreams/`](./bench/dreams/) and the [schema reference](./bench/dreams/SCHEMA.md)) end-to-end, captures per-dream metrics, and aggregates a deterministic report. It is the regression harness for the reflexive bootstrap: any future MMD version is only promotable if its `mmdream bench` output beats the previous version's.

**v0.2b scope (design vs current implementation — per [L-009](./docs/lessons-learned.md))**:
- **Design** (per [MAKE_MY_DREAMS.md §8.3](./MAKE_MY_DREAMS.md)): a hands-off CI-runnable harness that gates every MMD release with measurable signals (time-to-MVP, reality-check pass rate, cost). v0.5b will additionally feed bench output into the autolearning loop.
- **Current implementation** (v0.2b): the loader, runner, metrics serializer, aggregator, and CLI dispatch all ship. The reality-check integration in real runs is deferred to a follow-up slice — for now `mmdream bench` in real mode marks `reality_check.ran=false` while the user runs the reality check manually after the bench. `--dry-run` writes a stub screenshot so the metric shape is faithful to the design.

```bash
# Validate the harness itself (no auto-dev invoked, no env var needed):
mmdream bench --dry-run

# Run for real (takes hours — opt-in gate):
MMD_BENCH_REAL=1 mmdream bench

# Filter to one or two dreams:
mmdream bench --dry-run --dreams kid-01-drawing-camera-overlay,pro-01-csv-viewer

# Override output dir:
mmdream bench --dry-run --out-dir /tmp/my-bench-run

mmdream bench --help
```

**Opt-in gate.** A real `mmdream bench` runs the auto-dev pipeline 5× sequentially, which typically takes several hours. The harness refuses to start without `MMD_BENCH_REAL=1` (exit 2) unless `--dry-run` is also passed. This is a constitution `security.md` §A04 (insecure-design) safeguard: the more expensive default must require an explicit acknowledgement.

**Output layout** (under `bench/runs/<run-id>/`, gitignored except the README):
- `summary.json` — machine-readable aggregate (totals, pass rate, MMD version + git SHA).
- `report.md` — human-readable aggregate (deterministic — no LLM call).
- `<dream-id>/metrics.json` — per-dream AC-4 fields.
- `<dream-id>/run.log` — subprocess capture.
- `<dream-id>/screenshot.png` — reality-check screenshot (stub PNG in `--dry-run`).
- `<dream-id>/demo/<slug>/` — isolated working dir that auto-dev modified.
- `bench/runs/latest/` — symlink to the freshest run.

**Exit codes**: `0` all green, `2` user/gate error, `6` reality-check failed (no crash), `7` auto-dev crashed.

**Why these 5 dreams, why sequential, why no $-cost metric?** See [ADR-006](./docs/adr/006-dream-bench-v0-design.md).

### Discover mode (`mmdream discover`) — *new in v0.2c*

`mmdream discover [<path>]` is the Project Onboarder: it scans an existing target repo, ingests Spec Kit / BMAD / OpenSpec artifacts into `.mmd/shared/`, infers conventions deterministically, and writes `mmd-discovery-report.md` at the target root for human validation. Until the report is approved, `mmdream --here` and `mmdream <dream>` refuse to run on the same target (exit 5) — the **v0.2c validation gate** that catches "auto-dev hallucinates a stack" failures at the cheapest possible moment.

```bash
cd /your/project
mmdream discover .                # SCAN → INGEST → INFER → REPORT (exit 0)
# review mmd-discovery-report.md
mmdream discover --approve .      # flip Status: → VALIDATED
mmdream --here "small change"     # now allowed
```

Flags: `--approve` (mark VALIDATED), `--refresh` (re-run from scratch), `--infer-with-claude` (LLM augmentation — stub in v0.2c), `--no-report-update` (scan only), `--force-non-git`, `--skip-onboarding` (top-level bypass — not recommended). Exit codes: `0` ok / `2` user error / `3` path missing / `4` not a git repo / `5` gate fired.

Non-intrusion guarantee: writes ONLY in `<target>/.mmd/`, `<target>/docs/` (NEW files), and `<target>/mmd-discovery-report.md`. Every write goes through `assertSafeWritePath` (path-traversal + symlink defenses). See [docs/specs/SPEC_V02C.md](./SPEC_V02C.md) for the 8 ACs and [ADR-008](./docs/adr/008-project-onboarder-walking-skeleton.md) for the design rationale.

### Brownfield install + onboarding

```bash
cd /your/project
bash ~/Documents/make-my-dreams/install-mmd.sh .
mmdream discover .
# review mmd-discovery-report.md
mmdream discover --approve .
mmdream --here "your first small change"
```

### Using MMD on your own repo — *new in v0.6.a*

You don't have to run the installer by hand. On a real app that MMD has never touched, `mmdream discover` now **names the stack it scanned** — a Node/Python/Go/Rust project comes back as **`brownfield-app`** (not the old, misleading `blank`; a genuinely empty repo still reports `blank`). And the first time you run `mmdream --here` on a repo that isn't set up yet, MMD **offers to set it up for you**:

```bash
cd /your/project
mmdream discover .                       # detected case = brownfield-app
mmdream discover --approve .
mmdream --here "your first small change"
#  MMD isn't set up in this repo yet. Missing:
#    • the project constitution (.specify/memory/constitution.md)
#    • the MMD auto-dev workflow (…)
#  Run setup now? [o/N] o          ← one confirmation; then it runs install-mmd.sh,
#                                     prints the env-var cheat-sheet, and continues
```

In a terminal you confirm once; under `mmdream serve` / CI (no TTY) the setup runs automatically with a logged line. Declining (or a setup failure) aborts with **exit 8** and a pointer to `install-mmd.sh .` — MMD never launches inert. **If your repo already has a `.specify/memory/constitution.md`, MMD leaves it untouched** — it never overwrites your project's own rules. After setup you'll see the cheat-sheet of the non-obvious operational rules (`MMD_TIMEOUT_MS=0` for real slices, the "spec is frozen, go directly to implementation" dream directive, commit-per-AC, and the opt-in `--sealed` / `--monitor` / `MMD_NOTIFY_URL` switches). Bypass the guard with `MMD_SKIP_SETUP=1`. See [ADR-032](./docs/adr/032-transparent-first-run-setup.md).

### Constitution suggestions + frictionless discover→`--here` — *new in v0.6.b*

When your repo **already has** a `.specify/memory/constitution.md`, `mmdream discover` adds an advisory **"Constitution suggestions"** section to the report: a deterministic, keyword-based checklist of common governance themes (testing, commit/git workflow, security, error-handling, design principles, documentation, AI-coding hygiene) that flags which look present and which look missing. It is **a heuristic, not an audit** (the report says so), and your constitution is **never modified** — *"elle reste"*. No constitution present → no section (the first-run setup materializes a sane default instead). An LLM-enriched mode is a future opt-in; the deterministic checklist (pure, free, offline) ships first.

The documented "run discover, read the suggestions, then `mmdream --here`" flow now works **without a manual stash**: `mmdream discover` gitignores its own scratch (`.mmd/`, `mmd-discovery-report.md`) and the first-run setup preflight treats a tree dirtied *only* by MMD-managed paths as clean. Any **real** uncommitted change of yours still refuses with **exit 4** — MMD's setup commit can never sweep your work. The Layer-C composer rework once pencilled in for v0.6.b was **retired**: `--here` is already governed by *your* constitution via Layer B (the auto-dev workflow reads `.specify/memory/constitution.md` directly); the composer only runs on the greenfield `demo/` path where there is no project constitution to read. See [ADR-033](./docs/adr/033-constitution-suggestions-and-discover-friction.md).

### Ship mode (`mmdream ship`) — *new in v0.2.f*

`mmdream ship` invokes the gStack [`ship`](https://github.com/garrytan/gstack) skill on the current slice branch via `claude -p`. It replaces the manual `git merge --ff-only && git tag && git push --tags && git push --tags` chain that has been used for v0.1.0 → v0.2.2 releases with a richer workflow: merge-base verify, semver bump from diff, CHANGELOG update, squash WIP commits, push, PR creation, analytics persist.

**Prerequisites** (installed by `install-mmd.sh` as of v0.2.f — functional verification, not file presence):
- `bun` on `PATH` or at `~/.bun/bin/bun`
- gStack ship skill at `~/.claude/skills/gstack/ship/SKILL.md`
- `claude` (Claude Code CLI) on `PATH`

**Usage:**

```bash
# On a slice/* or feat/* branch:
mmdream ship                       # ship the current branch
mmdream ship slice/feat-foo        # ship a specific branch
mmdream ship --dry-run             # build prompt + env, print plan, do NOT spawn claude
mmdream ship --help                # full usage
```

**What the ship skill does** (5-line summary):
1. Reads the slice branch + base + tip SHA from the MMD-supplied prompt.
2. Runs the 20-step gStack ship workflow: merge-base verify, semver bump, CHANGELOG, squash WIP, tag, push, PR.
3. Tees stdout/stderr to `.mmd/local/ship-runs/<timestamp>.log`.
4. After exit, MMD runs [`scripts/audit-pillars.sh main..<branch>`](./scripts/audit-pillars.sh) and includes the pillar-invocation table in the summary (advisory — never gates the ship).
5. Returns the subprocess exit code as the `mmdream ship` exit code.

**Exit codes** (per `error-handling.md` §II):
- `0` success
- `2` environment / dependency missing (claude, bun, gStack)
- `3` cwd is not a git repo
- `4` protected branch (main/master) or invalid branch prefix
- `<code>` subprocess passthrough on a real ship run

**Env vars:**
- `MMD_SHIP_TIMEOUT_MS` — subprocess timeout in ms (default 1800000, 30 min)
- `MMD_SHIP_CMD` — override the `claude` executable (testing only)
- `MMD_QUIET=1` — suppress terminal tee of subprocess output (log file preserved)

See [ADR-007](./docs/adr/007-gstack-effective-via-ship-subcommand.md) for the design rationale (why a wrapper rather than direct claude invocation, why install functional rather than file-presence, why `audit-pillars.sh` is advisory not gating).

### Other gStack skill wrappers — *new in v0.2.g*

Three more gStack-skill wrappers, all modelled on `mmdream ship`. Same architecture (thin CLI coordinator → `claude -p` with `PATH=$HOME/.bun/bin:$PATH` forced → tees to `.mmd/local/<skill>-runs/<ts>.log`). All three are **read-only / advisory** — they never commit, never push, never create tags. They bypass the v0.2c Project Onboarder validation gate so a fresh brownfield can run `mmdream cso` to learn about itself.

#### QA mode (`mmdream qa`)

`mmdream qa [<branch>] [--dry-run]` invokes the gStack [`qa`](https://github.com/garrytan/gstack) skill on the current (or named) branch: test stratification `@smoke`/`@unit`/`@integration`/`@e2e`, adversarial test pass, failure classification T1..T4 (in-branch new / pre-existing flake / infra / obsolete-deleted-spec). Output is tee'd to `.mmd/local/qa-runs/<timestamp>.log`. Expected wall-clock: 5-20 minutes.

```bash
mmdream qa                       # qa the current branch
mmdream qa slice/feat-foo        # qa a specific branch
mmdream qa --dry-run             # build prompt + env, print plan
mmdream qa --help                # full usage
```

Unlike `mmdream ship`, `mmdream qa` does NOT enforce the slice/feat/fix/... branch-prefix list — qa is advisory and may run on `main` too.

Env vars: `MMD_QA_TIMEOUT_MS` · `MMD_QA_CMD` · `MMD_GSTACK_SKILLS_DIR` · `MMD_QUIET=1`.

#### CSO mode (`mmdream cso`)

`mmdream cso [<branch>] [--dry-run]` invokes the gStack [`cso`](https://github.com/garrytan/gstack) (Chief Security Officer) skill on the current (or named) branch: secret scanning, dependency audit (incl. slopsquatting risk), lethal-trifecta check, sandbox / `settings.json` configuration validation — the Bundle A security audit per `.specify/memory/constitution/security.md`.

```bash
mmdream cso                      # security review of the current branch
mmdream cso slice/feat-foo       # security review of a specific branch
mmdream cso --dry-run            # build prompt + env, print plan
mmdream cso --help               # full usage
```

Env vars: `MMD_CSO_TIMEOUT_MS` · `MMD_CSO_CMD` · `MMD_GSTACK_SKILLS_DIR` · `MMD_QUIET=1`.

#### Release notes (`mmdream document-release`)

`mmdream document-release [<from>] [<to>] [--dry-run]` invokes the gStack [`document-release`](https://github.com/garrytan/gstack) skill to auto-generate a release-notes draft from a commit range. Defaults: `<from> = git describe --tags --abbrev=0` (last tag), `<to> = HEAD`. The draft is written to `.mmd/local/document-release-runs/<timestamp>.md` — a markdown file the user reviews and edits before publishing. Inputs the skill consults: `git log`, ADRs in `docs/adr/`, and the diff of `docs/lessons-learned.md`.

```bash
mmdream document-release                       # range = last-tag..HEAD
mmdream document-release v0.2.4 v0.2.6         # explicit refs
mmdream document-release --dry-run             # build prompt + env, print plan
mmdream document-release --help                # full usage
```

Exit codes for all three: same shape as `mmdream ship` — `0` ok / `2` user/argv error / `3` not a git repo / `4` spawn failure or (for `document-release`) invalid refs / `<code>` subprocess passthrough.

> **`MMD_GSTACK_SKILLS_DIR` is a test-only knob.** Leave it unset in production — the default `~/.claude/skills/gstack` is correct. The variable's value flows into the LLM prompt and into a filesystem `existsSync` check, so it must never be pointed at an untrusted directory. See [ADR-009](./docs/adr/009-medium-gstack-integration-pattern.md) and `lib/skills/_common/skill-path.js` for the security rationale.

**Why these subcommands rather than folding the skills inside `auto-dev`?** Standalone CLI subcommands teach the user where each skill lives, can be composed with shell `&&`, and stay independently auditable in `audit-pillars.sh`. Folding inside `auto-dev` is the "Heavy option" from L-012 — deferred to v0.5+ once the Conductor design is mature. See [ADR-009](./docs/adr/009-medium-gstack-integration-pattern.md) for the full rationale.

### Lessons & composer — *new in v0.2e*

Every `mmdream` subprocess invocation (autodev, ship, qa, cso, document-release) now passes its prompt through the **composer** before spawning `claude -p`. The composer reads `docs/lessons-learned.md`, finds the lessons whose keywords appear in the prompt (case-insensitive, word-boundary), and prepends a deterministic `## Active lessons (auto-injected by composer v0.2e)` section to the prompt. The autolearning loop from [MAKE_MY_DREAMS.md §6.5](./MAKE_MY_DREAMS.md) is now operational end-to-end: failures captured as new lessons reach every future prompt automatically.

```bash
mmdream lessons                        # list every active lesson + injection count
mmdream lessons match "git checkout"   # preview which lessons would inject for an input
mmdream lessons match "git checkout" --context mmd-qa   # same, pre-filtered by context (v0.2.l)
mmdream lessons --show L-008           # print one lesson's title + status + rule
mmdream lessons --help
```

**Category + Applies to + context filtering** (*new in v0.2.l*). Each lesson now carries two optional annotations — `**Category**:` (a comma-list folksonomy, e.g. `git, subprocess-control`) and `**Applies to**:` (a comma-list of subcommands like `mmdream --here, mmdream ship`, or `*` for universal). Before keyword matching, the composer **filters by context**: a `mmdream qa` invocation only considers lessons whose `Applies to` includes `mmdream qa` or `*`, so a brownfield-only lesson never pollutes a qa prompt and vice-versa. Each spawn site passes its own context (`mmdream --here`, `mmdream <skill>`, `mmdream unblock`); legacy callers that pass no context get the pre-v0.2.l full-file behavior unchanged. The fields are parser-tolerant (absent → `uncategorized` / `*`). Use `mmdream lessons match "<prompt>" --context <subcommand>` to introspect the filtered result — it prints `Filtered N of M (context: …)` and returns a strict subset of the un-contextual match. This mirrors the constitution's per-context `constitution-bindings.yaml` model and keeps the composer scale-resilient as the lessons count grows — see [ADR-012](./docs/adr/012-composer-categorization.md).

Each composed run drops two sidecar files next to its `.mmd/local/<*>-runs/<ts>.log`:
- `<ts>.composer.json` — audit trail: which lessons matched, which keywords hit, file SHA, elapsed_ms, plus the v0.2.l context metrics (`context`, `filtered_out_by_context`, `matched_by_keyword`, `injected`)
- `[composer] injected …` line at the top of the run log itself

To roll up adoption across a slice: `scripts/audit-pillars.sh --with-composer main..HEAD` reports total runs, auto-injected runs, average lessons per run, and the top-5 lessons by injection count.

Knobs:
- `MMD_COMPOSER_DISABLED=1` — bypass composition (escape hatch — composer.json still written with `disabled: true`)
- `MMD_LESSONS_FILE` — point `mmdream lessons` at a non-default file (testing)
- A missing `docs/lessons-learned.md` is a no-op (brownfield targets without `install-mmd.sh` are not penalized)

Matching is deterministic, sub-100ms on the live `docs/lessons-learned.md` regardless of size, capped at 5 injections per prompt by score with ties broken by id ascending. No LLM call, no embedding model — see [ADR-010](./docs/adr/010-composer-minimal-keyword-overlap.md) for why keyword-overlap over semantic matching.

### Document lessons (`mmdream document-lessons`) — *new in v0.2.i; autolearning loop CLOSED in v0.9.0*

The composer (above) injects lessons; `mmdream document-lessons` closes the *other*
half of the autolearning loop — **promotion**. It scans every
`.mmd/local/**/*.composer.json` audit, increments each lesson's reuse counter in
`docs/lessons-learned.md`, and **promotes** any lesson that reaches its own
`**To promote if**: N` threshold — appending its Rule to the right constitution
module, removing it from `docs/lessons-learned.md`, and writing a promotion ADR.

**v0.9.0 closed the loop on the right signal (differentiator #2).** The counter
no longer rises on **raw injections** — ADR-010 itself had named that the wrong
signal ("the composer matching keywords is not the same as a validated re-use"),
so a lesson that merely *appeared* in prompts used to climb toward MMD's own
constitution with no evidence it ever helped. Now:

- **The counter rises on a deterministic VALIDATED REUSE** — a lesson injected
  into a run that completed `state=done`, counted **once per distinct run** (a
  cheap, reproducible, weak-but-honest proxy). A lesson injected only into
  **failed** runs gets nothing. Each run writes a durable `<runId>.outcome.json`
  next to its composer audit; `validatedReuses` joins the two. Crediting is
  **idempotent** (a `.mmd/local/credited-runs.json` record) so re-running never
  double-counts a run.
- **Promotion is gated by an injected LLM validation** — because promotion edits
  MMD's own constitution. At threshold, an injected judge (the
  `MMD_PROMOTE_GATE_CMD` `claude -p` seam) reviews the rule + its reusing runs:
  **only an explicit `validated` promotes**; `not-validated` / `uncertain` /
  unparseable / **gate-absent** all **HOLD** the lesson (counter preserved, an
  honest note) — the **sacred fallback, never a fabricated constitution change**.
- **Raw injections (INJ) vs validated reuses (VR) are shown distinctly** in
  `mmdream lessons` and in this command's summary, so the two are never conflated.

```bash
mmdream document-lessons --dry-run            # preview: per-lesson deltas + gate verdicts, no writes
mmdream document-lessons                      # apply increments; gate-validated lessons promote
mmdream document-lessons --since 2026-05-01   # only audits newer than <ts>
mmdream document-lessons --help
```

The destination module is taken from the lesson's own `**To promote if**` line
(e.g. "promote to testing.md"), defaulting to `ai-coding.md`. Milestone lessons
(`Status: milestone`) are never touched. Promotion is best-effort across its
three file ops; a partial failure exits `6` and reports on stderr rather than
pretending success. Exit codes: `0` ok / `2` user-argv error / `5` no
composer.json found at all / `6` partial failure. Pure-function libraries
(`lib/autolearn/{validated-reuse,promote-gate,run-outcome}.js`,
`lib/documentalist/{aggregate-injections,mutate-counters,promote-lesson,serialize-lessons}.js`),
with a byte-identity round-trip guarantee on `docs/lessons-learned.md`. See
[ADR-045](./docs/adr/045-autolearning-loop-closed.md) (the closed loop) and
[ADR-014](./docs/adr/014-documentalist-lite-counter-incrementer.md) (the original
counter). **Archival** (a lesson unused for M months → archived) is the deferred
§6.5 tail.

### Unblock mode (`mmdream unblock`) — *new in v0.2.j*

When a slice looks stuck — no commit for a while, the same operation retried over and over, a recurring error in the logs, or a `claude -p` run killed by a timeout — do **not** retry blindly. Run a structured **5-Whys** stuck-recovery session instead:

```bash
mmdream unblock                      # detector + 5-Whys on the current slice/* branch
mmdream unblock slice/foo            # diagnose a named slice branch
mmdream unblock --dry-run            # detector only: print signals + evidence, never call claude
mmdream unblock --force              # skip the detector, run the session unconditionally
mmdream unblock --help
```

`mmdream unblock` first runs a deterministic, sub-100ms **stall detector** over `.mmd/shared/status.json`, the slice's last-commit age, and recent run-log error patterns. It emits signals from a closed enum (`no-commit-since-N-min`, `retry-count-exceeded`, `error-pattern-matched`, `duration-exceeded-budget`, `state-failed-explicit`, `heartbeat-stale`, `wip-uncommitted-since-N-min`). The last of these (*new in v0.2.n*) fires when the slice worktree is dirty (`git status --porcelain` non-empty) **and** the last commit is older than `MMD_STALL_WIP_UNCOMMITTED_MIN` (default 15 min) — the WIP-loss-on-kill risk (L-019): an auto-dev run killed mid-flight that left uncommitted work. When it fires, the 5-Whys prompt recommends `escalate-to-user` with the non-destructive salvage step `git stash push -u`. A clean stale branch or a fresh never-committed branch never fires it. If stalled (or `--force`), it spawns a **BMAD Party Mode** session: Mary (analyst) leads the 5-why chain while Winston (architect), Quinn (QA), Amelia (PO), and Christie (CSO) add their lens at each "why". Past lessons are auto-injected via the composer, so each session is smarter than the last.

The session writes `.mmd/shared/5-whys/<ts>.md` (full why-chain + evidence + parsed result) and prints one of five recommended actions:

| action | exit | what to do |
| --- | --- | --- |
| `continue-with-hint` | 8 | apply the hint, resume the slice |
| `abandon-approach` | 7 | pivot to a different approach |
| `escalate-to-user` | 6 | a human decision is needed (also the safe fallback on unparseable output) |
| `task-actually-complete` | 8 | the work is done — verify DoD and ship |
| `false-positive-stall` | 8 | no real stall — keep running |

`mmdream unblock` does **not** auto-execute the action — you read the summary and act. Auto-trigger and auto-execution are a Conductor concern (see [MAKE_MY_DREAMS.md §4](./MAKE_MY_DREAMS.md)). Knobs: `MMD_STALL_MIN_NOCOMMIT` (default 10 min), `MMD_STALL_MAX_RETRIES` (3), `MMD_STALL_DURATION_BUDGET_FACTOR` (2.0), `MMD_STALL_ERROR_PATTERN_REGEX`, `MMD_STALL_WIP_UNCOMMITTED_MIN` (default 15 min), `MMD_FIVEWHYS_TIMEOUT_MS` (default 30 min). See [ADR-011](./docs/adr/011-five-whys-escalation.md) and [ADR-018](./docs/adr/018-wip-uncommitted-stall-signal.md) for the design rationale.

### Handover mode (`mmdream handover`) — *new in v0.2.p*

`HANDOVER.md` carries a session across context switches. Most of it is human **intent** (what's next + why) that no tool can derive — but one block, "State at handover" (latest tag, branch, version, lesson/ADR counts, recent commits), is purely mechanical and drifts when hand-maintained (the live file once claimed "17 active lessons" while the parser counted 13). `mmdream handover` re-derives ONLY that block and rewrites it in place between two markers, leaving every human-authored section byte-for-byte untouched.

```bash
mmdream handover --tests 1055            # refresh the State block; record 1055 passing tests
mmdream handover --tests 1055 --dry-run  # print the rewritten file to stdout, write nothing
mmdream handover --help
```

The active-lessons count comes from the authoritative `parseLessons` (not a hand-tally), the tag/branch/commits from `git`, and the version from `package.json`. The one non-cheap field — the passing-test count — is supplied via `--tests N` or left as an explicit `(run npm test to refresh)` placeholder; the command **never** invents a number, runs the suite, or fabricates intent (constitution universal §VI). A failing git call renders `(unavailable: <reason>)`. If the markers (`<!-- mmd:handover:state:start -->` / `<!-- mmd:handover:state:end -->`) are absent, it refuses to guess where to write and exits 4 with the derived block printed. Running it twice with the same repo state + same `--tests` produces a byte-identical file (idempotent). It never auto-commits — the human reviews and commits (commit-git §I). Exit codes: `0` ok / `2` user-argv error / `3` HANDOVER.md missing / `4` markers absent. See [ADR-020](./docs/adr/020-mmd-handover-subcommand.md) and [L-020](./docs/lessons-learned.md).

### Document-readme mode (`mmdream document-readme`) — *new in v0.3.d*

The README has the same problem `HANDOVER.md` had: it carries human **intent** (the intro, command docs, the prose History) plus a few **mechanical** facts (current version, latest tag, ADR/lesson/release counts, the changelog) that drift the moment a slice lands and nothing refreshes them — for a while this file still claimed "Pre-v0.1" and its History stopped at v0.2e. `mmdream document-readme` applies the proven `mmdream handover` pattern to the README: it re-derives ONLY two marker-bounded mechanical blocks and rewrites them in place, leaving every human-authored byte untouched.

```bash
mmdream document-readme --tests 1309            # refresh the Status + Changelog blocks; record 1309 passing tests
mmdream document-readme --tests 1309 --dry-run  # print the rewritten README.md to stdout, write nothing
mmdream document-readme --help
```

Two managed blocks (each bounded by an HTML-comment marker pair — the `mmd:readme:status` pair around the Status list under [Status](#status), the `mmd:readme:changelog` pair around the [Changelog](#changelog) list):
- **Status**: version (`package.json`), latest tag, ADR count, active-lesson count (via the authoritative `parseLessons`), reflexive-slice count (number of release tags), and the test count.
- **Changelog**: one markdown line per git tag, **newest first**, rendered from each tag's annotation message (`git for-each-ref … %(contents:subject)`). A lightweight (non-annotated) tag renders `(no annotation)`; an empty tag list renders an explicit "no tags yet" line.

It also prints a **doc-drift report** on stdout: any `bin/mmd.js` subcommand (and top-level flag like `--here` / `--catch` / `--label`) that the README doesn't mention. The report is informational (exit 0) and **writes nothing** to the README — surfacing the drift root cause (a new subcommand ships but the prose never mentions it) without ever touching the human narrative.

Like `mmdream handover`, it is honest on every missing source (a failing git call → `(unavailable: <reason>)`), it **never** invents the test count (supply `--tests N` or it leaves an explicit `(run npm test to refresh)` placeholder), it never runs the suite or auto-commits, and running it twice with the same repo state + same `--tests` produces a byte-identical file (idempotent). If a marker pair is absent it refuses to guess where to write and exits 4 with the derived block printed (the handover contract). It **reuses** the handover machinery directly — `lib/handover/rewrite-markers.js` for the marker rewrite and the `lib/handover/build-state-block.js` git/version/count helpers — rather than duplicating them. Exit codes: `0` ok / `2` user-argv error / `3` README.md missing / `4` markers absent.

This is the **lite** doc-sync: the mechanical *meta* is now machine-maintained, while the prose History (the *story*) and the per-command docs stay human-owned. The full event-driven Documentalist (Diataxis coverage, ADR-drift detection, gStack `/document-generate`) lands in v0.5b. See [ADR-025](./docs/adr/025-document-readme-doc-sync.md).

### Coherence review (`mmdream document-review`) — *new in v0.7.a*

The docs drift faster than anyone can hand-track: 33 `SPEC_V*.md` at the repo root, `MAKE_MY_DREAMS.md` long past its own 200-line cap, and a §9 roadmap whose plan diverged from what actually shipped. `mmdream document-review` is the **Documentalist's detection face** — it answers, on demand, *"what did MMD design vs what did MMD become, and where have the docs drifted?"* — and writes the answer to a regenerable dashboard, `docs/coherence-review.md`.

```bash
mmdream document-review              # write docs/coherence-review.md + print a summary
mmdream document-review --dry-run    # print the report to stdout, write nothing
mmdream document-review --with-claude # layer an LLM judgment pass on the heuristic (opt-in)
mmdream document-review --help
```

It works the way every MMD builder does — a **deterministic core, an optional LLM**:
- A **deterministic inventory** (`lib/documentalist/inventory.js`) of MMD's real surface: subcommands, git tags, ADRs + titles, `lib/` modules, per-doc line counts (with a 200-line cap flag per `MAKE_MY_DREAMS.md` §6.4), the root SPEC sprawl count, and the active-lesson count. It reads the filesystem and **never throws** — a missing dir/file degrades that one field, never the whole review.
- A **heuristic roadmap reconciliation** (`lib/documentalist/roadmap-reconcile.js`): it parses the §9 `### vX.Y — Title` headers and classifies each capability **built / partial / unbuilt** by matching its name against the inventory. It is **clearly labelled a heuristic, not an audit** — conservative (no signal → unbuilt, half-matched compound → partial), so it reproduces the hand gap-audit's big rocks (auto-handoff, Dream Expander, Plan-Review, Bundle A Security, full Documentalist, polymorphic Reality Check all come out unbuilt/partial) without over-claiming.
- A pure **render** (`lib/documentalist/coherence-report.js`) of the designed-vs-built table + doc-health flags (length-cap violations, SPEC sprawl) + the inventory summary.

**Drift / conformance — is the doc still TRUE?** (*new in v0.7.b*). The Documentalist's primary value is keeping docs **true**, not short. The report now carries a **"Drift / conformance"** section that scans the operational truth docs and flags where what a doc *claims* no longer matches what was **built** — **flag-only; it never edits a doc** (detect-before-correct):
- **Dangling references** — a doc cites a code file / `mmdream <subcommand>` / `ADR-NNN` / `lib/<module>` that does not exist (`lib/documentalist/doc-refs.js` extracts the claims line-aware; `lib/documentalist/conformance.js` checks them against the inventory + a real `fileExistsFn`).
- **Stale facts** — a **bounded** prose claim (explicit `N subcommands/ADRs/lessons` counts, "current/latest version X") disagreeing with the live inventory; clearly-historical narrative ("as of vX") is ignored.
- Precision-first (a drift section that cries wolf is useless): fenced code blocks + placeholder paths are skipped, subcommands are read only from inline code, negated/hypothetical/future command mentions are not flagged, and counts are checked only on the living current-state docs (ADRs / `lessons-learned.md` are point-in-time records). On MMD itself it reports **3 genuine dangling refs and 0 stale facts** with **zero** false positives — and it dogfooded itself mid-slice, catching two stale ADR counts in this very README + HANDOVER (now corrected). `--with-claude` adds an opt-in **semantic-drift** pass (does a doc's *description* still hold?), with the same honest fallback.

It is **strictly read-only beyond that one file**: it writes EXACTLY `docs/coherence-review.md` and never moves, deletes, or edits anything else (an integration test pins that `git status` shows only that path). `--with-claude` adds an LLM commentary block via the `MMD_DOCUMENT_REVIEW_CMD` seam, falling back honestly to the deterministic report when claude is absent/non-zero/unparseable — never a fabricated classification. This is **detect-before-correct**: v0.7.a/v0.7.b only *report* drift, sprawl, and oversized docs as candidates; v0.7.c will grant the Documentalist the power to *act* on the tidiness half (archive SPECs, shard `MAKE_MY_DREAMS.md`) once its detection is trusted. See [ADR-034](./docs/adr/034-documentalist-coherence-review.md) and [ADR-035](./docs/adr/035-documentalist-conformance-drift.md).

### Active compaction (`mmdream document-compact`) — *new in v0.7.c*

The Documentalist's first **action**. v0.7.a *detected* the root SPEC sprawl and v0.7.b *checked* the docs' truth; `mmdream document-compact` clears the sprawl the dashboard flagged — it archives the root `SPEC_V*.md` files into `docs/specs/` with an index and rewritten references. It is the **safe** half of compaction: *act on the safe thing before the hard thing*. Archiving SPECs is mechanical and fully reversible (`git mv` preserves history); the higher-risk semantic compaction (sharding the over-cap docs like `MAKE_MY_DREAMS.md`) is deliberately deferred until SPEC archival is trusted.

```bash
mmdream document-compact --dry-run   # print the plan (which SPECs move, where); change NOTHING
mmdream document-compact             # git mv root SPECs → docs/specs/ + write the index + rewrite refs
mmdream document-compact --help
```

- A **pure planner** (`lib/documentalist/compact.js`): `planCompaction({specs, existingArchive})` returns the `{moves, indexMarkdown, referenceRewrites}` plan, plus `applyReferenceRewrites`, an **idempotent** exact-token transform that prefixes a root `SPEC_V0XX.md` reference with `docs/specs/` **only when it is not already prefixed** (no `docs/specs/docs/specs/`). Pure, no I/O, never throws.
- The **subcommand** (`bin/documentalist/document-compact.js`) does the I/O: `git mv` each root SPEC into `docs/specs/` (history preserved), write a newest-first index there, and rewrite references (link targets, anchored links, prose mentions, backticked links) across tracked markdown *outside* the archive (a moved SPEC keeps its bare sibling cross-refs).
- **Safety contract**: move-only (it **never** edits doc prose, never deletes), **idempotent** (no root SPECs → a clean no-op; a second run changes nothing), and **reversible** (`git log --follow` reaches a moved SPEC's original history). Preconditions are validated **before any mutation** — a non-git repo or an untracked SPEC is reported non-zero and nothing is half-applied — and it does **not** auto-commit (you review + commit).
- **Validated by its own Drift detector**: after compaction, a `mmdream document-review` must report **no new dangling SPEC references** — detection guards the action.

New SPECs still land at the repo root per slice; a later `mmdream document-compact` archives the shipped ones (the periodic-consolidation model). Shipped SPECs therefore live under `docs/specs/`. See [ADR-036](./docs/adr/036-documentalist-active-compaction.md).

### Coherence graph — staleness-on-diff (`mmdream document-review --since <ref>`) — *new in v0.7.d*

The structural answer to "change one of doc/code/ADR, and the other two silently go stale." `mmdream document-review --since <ref>` takes your slice's diff, walks a **derived** coherence graph from the changed files, and tells you the **coupled neighbors to review** — *"change one node, know which neighbors need a look."*

```bash
mmdream document-review --since main       # what else does my branch's diff touch?
mmdream document-review --since HEAD~1      # couple the last commit's changes
```

The golden rule is **derive, never maintain** — a hand-kept "these relate" map rots the day you write it. The graph is composed from edges that **already exist for free**: `computeBlastRadius` (the resolved import graph, ADR-027 — **polyglot** as of v0.8.1, ADR-043, so the code↔code edges cover Python as well as JS and honestly flag un-adapted languages in the diff) supplies code↔code import edges, the v0.7.b `doc-refs` extractor supplies doc→code references, and a new doc-links extractor supplies doc↔doc links (`[[wiki]]`, `ADR-NNN`, relative `.md` links). Two new **pure** modules — `lib/documentalist/doc-links.js` and `lib/documentalist/coherence-graph.js` — build one **file-level, bidirectional** graph (each edge keeps its kind) and walk it: `coupledNeighbors` returns, per changed file, its neighbors **ranked strong (a direct import/ref/link) before weak (a 2-hop transitive neighbor)**, deduped, excluding the changed set.

It is a **READ-ONLY query**: `--since` prints the "Coupled changes" report to stdout and **writes nothing** — it does NOT rewrite `docs/coherence-review.md` (an integration test pins the clean tree), and the no-flag dashboard is byte-for-byte unchanged. A bad/unknown ref or a non-git repo → an honest non-zero exit, never a crash. **Precision-first** (a graph that cries wolf is useless): edges are kept only to real tracked files (no phantom neighbors), and **hub suppression** stops the walk from transiting *through* a high-degree doc (CLAUDE.md/HANDOVER.md reference dozens of ADRs) so a change near one doesn't weak-flag the whole repo. **Advisory + ranked, never a hard gate** (coupling ≠ certainty — review, don't obey). This is exactly what would have caught the v0.7.c coupled-test break (the moved SPECs ↔ the inventory test) *before* it went red. Symbol-level granularity, the semantic `@mmd:link` anchor, the Mermaid mind-map render, and git co-change edges are deliberately deferred (file-level + the diff check is ~80% of the value). See [ADR-037](./docs/adr/037-coherence-graph-staleness.md).

### `/mmdream` operator slash command — *new in v0.7.5*

Driving MMD correctly means remembering a stack of operational rules — disable the 30-min timeout for a real slice (L-016), detach with `setsid` not `nohup` (L-001), monitor via `status.json` and git commits rather than the buffered log (L-002), tell the dream to commit per AC (L-019), report honestly (ai-coding §I). The **`/mmdream` Claude Code slash command** encodes that whole playbook so a user — or Claude — can drive MMD from a session by intent, without memorizing the incantations.

```
/mmdream add a --json flag to mmdream discover that emits the report as JSON
/mmdream build me a kid-friendly drawing PWA
/mmdream document-review --since main
```

`/mmdream <intent>` instructs the session to **route** the intent to one of three actions and run it with full discipline:

- **(a) a code change for this repo** → launch `mmdream --here` **detached** via `setsid` with every operational rule applied (`MMD_TIMEOUT_MS=0`, bun + node 20 on `PATH`, a human-readable `--label` slug, `MMD_DREAM_MAX_LEN=4000`, a commit-per-AC instruction and the spec-frozen directive when a frozen SPEC is cited), then set up a **per-run watcher** and monitor honestly via `status.json` + git commits; on green it **offers** a fast-forward-only merge plus an annotated tag (never merges silently).
- **(b) a greenfield dream** → run `mmdream "<dream>"` to scaffold a new app under `demo/<slug>/`.
- **(c) a bare subcommand** (`discover`, `serve`, `document-review`, `handover`, …) → run `mmdream <subcommand>` directly.

The single source of truth is the **tracked** template at [`assets/claude-commands/mmdream.md`](./assets/claude-commands/mmdream.md) (not under the gitignored `.claude/`); `install-mmd.sh` materializes it idempotently into `.claude/commands/mmdream.md` alongside the `bmad-adv-auto-dev` command, so opening a session on any installed repo gives you `/mmdream`. It is a prompt template — no change to the `mmdream` CLI. See [ADR-039](./docs/adr/039-mmd-operator-slash-command.md).

### Test-corpus health (`mmdream test-health`) — *new in v0.7.6, polyglot in v0.8.0*

The **Test Curator**: the test analog of the Documentalist, but for tests not docs. Where `mmdream qa` reviews a *single change* and the BMAD TEA designs test *architecture* for a feature, `mmdream test-health` answers a fourth, distinct question — *is the test **corpus** healthy as it grows?* It is **detect-and-report only**: strictly read-only, it **never modifies a test**.

As of **v0.8.0** it is **POLYGLOT** (constitution §VIII technology-agnostic analysis): a **language-neutral core** + per-technology **adapters** instead of a hard-wired JavaScript scanner. `mmdream test-health` detects the target's stack(s) from its manifests (`package.json` → JavaScript/TypeScript, `pyproject.toml`/`setup.py`/`requirements.txt` → Python), runs every matching adapter, and aggregates. **Supported today: JavaScript/TypeScript and Python.** When **no** adapter matches the detected stack (e.g. a Rust-only repo), it **refuses honestly** — naming the detected stack + the supported list, **exit 6, no report written, no fabricated numbers** (running a JS scanner over a Rust repo would fabricate measurements — the gate stops that). Each adapter declares **capability flags**; a stack that can't yet extract test bodies (the Python adapter, v1) has its near-duplicate section marked **honestly unavailable** rather than silently empty. Adding a stack is a new adapter file, not a rewrite.

```bash
mmdream test-health              # write docs/test-health.md + print a summary
mmdream test-health --dry-run    # print the report to stdout, write nothing
mmdream test-health --help
```

It writes one regenerable dashboard, `docs/test-health.md` (the test analog of `docs/coherence-review.md`), surfacing:

- The **stratification distribution** — counts per `@smoke`/`@unit`/`@integration`/`@e2e` (read from each test's title, the project convention testing.md §V mandates).
- The **untagged tests** — every test whose title carries none of the four strata (a §V violation), listed with `file:line`. (On MMD itself the first run flagged **73** — real debt in older files no per-change review would catch.)
- A **smoke-health line** — the `@smoke` count vs the §V 5–10 fast-feedback band (thin / usable / over-budget).
- **Oversized files** — over `MMD_TEST_FILE_MAX_LINES` (default 500) or `MMD_TEST_FILE_MAX_TESTS` (default 60), listed as split candidates (env-overridable, graceful fallback).
- **Redundancy candidates** (*new in v0.7.7*) — tests that likely **overlap**, so the corpus can be pruned. Two deterministic signals: **near-duplicate test pairs** (structural similarity — a token-shingle **Jaccard** over each test body — at or above `MMD_TEST_DUP_SIMILARITY`, default **0.9**) and the **most-tested modules** (test files clustered by the `lib/`/`bin/` module they import — *over-test* candidates). It is **advisory** and **DETECT-BEFORE-CUT**: it **never deletes a test** (a similar-looking test may document a distinct intent — *the human decides*). Method is clustering + structural similarity, **not coverage** (a coverage mode stays a deferred opt-in). Comparison is bounded **within-file** (no quadratic blow-up); precision-first so it doesn't cry wolf (on MMD: 3 real pairs at 0.91–0.95, most-tested `lib/invoke-autodev.js` at 204 tests / 33 files).

It is **deterministic** (no LLM — the corpus signal is exactly computable) and a clearly-labelled **heuristic**, not an audit. The **generic core** is the language-neutral analysis + render — similarity + clustering in `lib/test-curator/redundancy.js`, the report in `lib/test-curator/report.js` (it imports no adapter and contains no language syntax). The **adapters** live in `lib/test-curator/adapters/` — the contract + registry in `index.js`, the JavaScript adapter in `javascript.js` (wrapping the JS-internal `scan.js` + `extract-bodies.js`), the Python adapter in `python.js`. The thin read-only bin in `bin/test-curator/test-health.js` runs the §VIII detect-resolve-or-refuse gate. See [ADR-040](./docs/adr/040-test-curator-test-health.md), [ADR-041](./docs/adr/041-test-curator-redundancy-detection.md) and [ADR-042](./docs/adr/042-polyglot-test-curator-adapters.md).

### Secret scan (`mmdream secret-scan`) — *new in v0.9.1 — the first Bundle A Security brick*

```bash
mmdream secret-scan                 # scan every git-tracked text file (default)
mmdream secret-scan --staged        # scan ONLY the staged diff (the pre-commit gate surface)
mmdream secret-scan --since <ref>   # scan files changed since <ref>
```

A **security GATE for autonomous dev**: catch a leaked credential *before* it is committed. MMD runs an AI agent that writes code and commits for 30–90 minutes — a key pasted into a fixture or a `.env` checked in by accident is one `git push` from being public forever. `mmdream secret-scan` is the cheapest, highest-leverage Bundle A brick (`MAKE_MY_DREAMS.md §6.6`): **vanilla** (no trufflehog, **no new dependency** — regex + Shannon entropy only), **language-agnostic** (it scans *text*, so a `.py`/`.rs`/`.env`/`.yaml`/`.txt` are all scanned identically — secrets are textual patterns, not language constructs, so this honors constitution §VIII *by construction*, no adapter needed), and **READ-ONLY** (it writes nothing).

It detects high-confidence secret formats — private keys, AWS access key ids, GitHub/Slack/Google tokens, JWTs — plus a generic high-entropy assignment heuristic. Every printed match is **REDACTED** (a few leading chars then asterisks; the full secret is **never** echoed — constitution §VI + `security.md` least-disclosure, so the scanner can't itself become a second leak). It **gates**: a high-confidence finding **exits non-zero (1)**; a clean repo exits 0. The generic entropy heuristic is honestly **medium-confidence** — printed as *advisory*, it does **not** change the exit code (gating on the false-positive-prone rule would just train people to bypass the hook).

**Precision-first** (secret scanners are a false-positive nightmare): obvious placeholders/examples (`EXAMPLE`, `your-token-here`, `changeme`, …) are skipped, an inline `mmd-secret-ok` comment on the same or preceding line whitelists a known-safe fixture, and the entropy rule is tuned so prose and base64 images don't trip it. Dogfood: `mmdream secret-scan` on MMD itself scans 527 tracked files **clean**.

**Opt-in pre-commit hook.** `install-mmd.sh` materializes a *non-active* sample hook at `.mmd/hooks/pre-commit` (running `mmdream secret-scan --staged`). It is **never enabled without you**: re-run with `MMD_INSTALL_SECRET_HOOK=1` (it won't clobber an existing hook), or `cp .mmd/hooks/pre-commit .git/hooks/pre-commit && chmod +x` it yourself.

The pure detector is `lib/security/secret-scan.js` (`scanText`); the read-only gate is `bin/security/secret-scan.js`. An **egress-sandbox** is the next Bundle A brick after deps-gate. See [ADR-046](./docs/adr/046-secret-scan-gate.md).

### Dependency / supply-chain gate (`mmdream deps-gate`) — *new in v0.9.2 — the second Bundle A Security brick*

```bash
mmdream deps-gate                   # check every declared dependency across supported manifests
mmdream deps-gate --since <ref>     # check only the dependencies ADDED since <ref> (the real supply-chain surface)
```

A **security GATE** that catches a **poisoned dependency before it is installed** — the supply-chain analog of secret-scan. MMD's autonomous agent decides which third-party libraries to pull in, and the dominant attack is **typosquatting / slopsquatting**: a package whose name is one keystroke from a popular one (`reqeusts` for `requests`, `lodahs` for `lodash`) — or a name an LLM is likely to *hallucinate* — that ships malware in its install script. `mmdream deps-gate` reads each declared dependency and asks its ecosystem registry *"does this exist, how old is it, how adopted is it, and is its name suspiciously close to a popular package?"*

Unlike secret-scan (agnostic *by construction*), deps-gate is **§VIII-agnostic by ADAPTERS** — dependency declaration and registry metadata are genuinely per-ecosystem, so it is a **pure language-neutral risk core** (`lib/security/deps-assess.js` — imports no adapter, contains no ecosystem syntax) plus **per-ecosystem adapters** (`lib/security/deps-adapters/`: **npm** parses `package.json` + queries registry.npmjs.org, **python** parses `requirements.txt`/`pyproject.toml` + queries pypi.org). cargo/go are *named* but unbuilt → when the only manifest is an unsupported stack, deps-gate **refuses honestly** (exit 6, naming the stack + the supported list, no fabricated numbers — the rule that stops the JS-on-Rust mistake).

**Precision-first** (a deps gate that cries wolf gets bypassed): exactly **two** findings gate (exit 1) — `unresolvable` (no such package) and `likely-typosquat`, the **conjunction** of near-a-popular-name **and** brand-new **and** barely-downloaded. Each signal *alone* is a medium **advisory** that does not change the exit. **Network-honest** (`§VI`): the fetch is bounded (~5 s/request) and **offline / a registry blink degrades each dep to an honest `unverified` advisory and exit 0** — never a fabricated pass, never a network-blink block. It is **READ-ONLY** (writes nothing), **zero-dependency** (regex + `JSON.parse` + a hand-rolled Levenshtein + Node's built-in `fetch`), and names which registries it queried (explicit egress). Exit codes mirror secret-scan: `0` clean/advisory · `1` gate · `2` argv · `5` not-a-git-repo/bad-ref · `6` unsupported-only refuse.

**Opt-in pre-commit hook.** The sample hook at `.mmd/hooks/pre-commit` now also runs `mmdream deps-gate --since HEAD` (after secret-scan); enable it with `MMD_INSTALL_DEPS_HOOK=1` (mirrors `MMD_INSTALL_SECRET_HOOK=1`; never auto-enabled, never clobbers an existing hook).

The pure core is `lib/security/deps-assess.js` (`assessDependency` / `gateExit`); the read-only gate is `bin/security/deps-gate.js`. An **egress-sandbox** is the next Bundle A brick. See [ADR-047](./docs/adr/047-deps-gate-supply-chain.md).

### Web mode (no terminal — for non-technical users)  — *new in v0.2.5*

```bash
mmdream serve
```

This starts a local HTTP server on `http://localhost:3000` (configurable) and auto-opens the default browser. A minimalist page lets anyone — including a 13-year-old kid — type a dream description, click "Go", watch progress stream live, and get a link to the generated PWA. Same machine as `mmdream` runs on. No tunnel, no cloud, no account.

> **First launch in a fresh directory sets itself up — no terminal needed.** The dream flow scopes via the BMAD `bmad-product-brief` skill (and builds with auto-dev), both installed per-project. If you launch `mmdream serve` (or greenfield `mmdream "<dream>"`) from a directory without BMAD, MMD **runs first-run setup automatically** (`install-mmd.sh`, with a progress line) and then proceeds — the same guard `mmdream --here` uses, so a non-technical user never has to type a shell command. An already-set-up directory is a no-op; a genuine setup failure aborts honestly (exit 8); `MMD_SKIP_SETUP=1` bypasses.

**Dream Catcher** *(v0.3.a-1, dial + editing in v0.3.a-2, CLI surface + profile threading in v0.3.b — see [ADR-023](./docs/adr/023-dream-catcher-cli-and-profile.md))* — instead of launching your dream verbatim, `mmdream serve` (and, on a TTY, `mmdream "<dream>"` — same core) refines it first through a short, friendly dialogue: you type a dream, pick who it's for (Enfant / Curieux / Pro), then choose **how involved you want to be** — an involvement dial with three levels:

- **Autonome** ("Je te fais confiance") — **0 questions**: one autonomous `bmad-product-brief` call synthesizes the scope straight from your dream + profile (the original a-1 path).
- **Équilibré** (the default) — **1 clarifying question** before the scope.
- **Guidé** — **2 (up to 3) clarifying questions** before the scope.

MMD asks one question at a time (a headless `claude -p` has no stdin, so multi-turn elicitation is MMD-orchestrated stateless calls — see [L-021](./docs/lessons-learned.md)), collects your answers, and synthesizes a small, buildable scope (one capability + at most two extras; Kid profiles get safe-by-default framing). You see the proposed scope on a card and can **✏️ Modifier / Edit** it in place before launching, then **Recommencer** (start over) or **C'est parti !** to launch the existing auto-dev pipeline with the (possibly edited) scope. If BMAD fails or returns nothing usable, the Dream Catcher is honest (universal §VI): it launches your **verbatim dream** with a visible note rather than fabricate a scope. The routes are `POST /api/catch/start|answer|edit|confirm` — `/answer` is **state-driven** (it advances profile → level → clarifying answers → scope and returns `{next}` ∈ `level | question | scope`), `/api/catch/edit` replaces the scope text in place; the legacy one-shot `POST /api/dream` still works unchanged. See [ADR-021](./docs/adr/021-dream-catcher.md), [ADR-022](./docs/adr/022-dream-catcher-dial-and-edit.md) and [L-021](./docs/lessons-learned.md).

```
┌─────────────────────────────────────────────────┐
│  Make My Dreams                                 │
├─────────────────────────────────────────────────┤
│  Décris ton rêve / Describe your dream          │
│  ┌───────────────────────────────────────────┐  │
│  │  une appli pour dessiner sur la caméra    │  │
│  └───────────────────────────────────────────┘  │
│  [ Vas-y / Go ]                                 │
│                                                 │
│  Progress: ▓▓▓▓▓░░░░░ 38%  Phase 3 / 4         │
│  Last update: 14:23:42                          │
│                                                 │
│  ✅ Ton rêve est prêt !                         │
│  [ Open my app ]  [ Start a new dream ]         │
└─────────────────────────────────────────────────┘
```

Env vars:
- `MMD_SERVE_PORT` — server port (default 3000; tries 3000-3010 if 3000 is in use)
- `MMD_SERVE_NO_OPEN=1` — skip auto-opening the browser (useful for CI / SSH)
- `MMD_SERVE_ALLOW_RANDOM=1` — required to allow `MMD_SERVE_PORT=0` (ephemeral, for tests)
- `MMD_SERVE_RATE_LIMIT_PER_HOUR` — successful-run cap per rolling hour (default 10). Only `exitCode == 0` runs consume capacity; failed runs are free retries.

**Working directory**: run `mmdream serve` from the directory where you want `demo/` to live (typically the project root). The server spawns subprocesses with `cwd = process.cwd()` and serves `/demo/<slug>/*` from `<cwd>/demo`.

Stop with `Ctrl+C`. The server prints `À bientôt ! / Bye!` and exits cleanly.

**Security**: the server binds to `127.0.0.1` only (never accessible from another machine on your network or the internet). Path traversal on `/demo/<slug>/*` is blocked. CSP headers locked to `'self'`. No cookies, no tracking. Audited per `.specify/memory/constitution/security.md`.

## History

This repo started as `extend-bmad` — a customization of BMAD that combined quick-dev, party mode, adversarial review loops and Spec Kit-style constitution injection (see `install-mmd.sh`, formerly `install-auto-dev.sh`). After comparative usage of Spec Kit, OpenSpec, BMAD and gStack, the scoping evolved into Make My Dreams: an accessibility and orchestration layer that sits on top of these frameworks rather than replacing them. The full design rationale is in [MAKE_MY_DREAMS.md](./MAKE_MY_DREAMS.md), with 14 versioned iterations documenting how every decision was reached.

**v0.2a (2026-05-17)** delivered the reflexive bootstrap [§7](./MAKE_MY_DREAMS.md) in practice via the `--here` mode flag: the same `mmdream` CLI now works on greenfield (creates `demo/<slug>/`) and on any existing git repo in place (creates a slice branch and modifies cwd). This closes the gap surfaced by [L-009](./docs/lessons-learned.md) — that the walking-skeleton wrapper was silently capping the design's "MMD must work on any project, including itself" intent. See [docs/specs/SPEC_V02A.md](./SPEC_V02A.md) for the 7 ACs and [ADR-005](./docs/adr/005-here-mode-explicit-flag-not-auto-detect.md) for why `--here` is a named flag rather than auto-detected.

**v0.2c (2026-05-17)** delivered the Project Onboarder walking skeleton: a `mmdream discover [<path>]` subcommand that scans/ingests/infers/reports against any existing repo and produces `mmd-discovery-report.md` for human validation. A new constitution-enforced gate blocks `mmdream --here` and `mmdream <dream>` on brownfield targets until the report is `--approve`d (bypassable via `--skip-onboarding` for conscious overrides). This is the operational closure of the L-009 pattern in the brownfield dimension: auto-dev no longer runs blind. See [docs/specs/SPEC_V02C.md](./SPEC_V02C.md), [ADR-008](./docs/adr/008-project-onboarder-walking-skeleton.md), and the L-015 capture in [`docs/lessons-learned.md`](./docs/lessons-learned.md) (fourth reflexive use of `mmdream --here`).

**v0.2.f (2026-05-17)** turned gStack from a documentation claim into a runtime reality. Three coordinated changes: (1) `install-mmd.sh` installs + functionally verifies `bun` and gStack (responds to `--version` / `gstack-config`, not just file presence); (2) `mmdream ship [<branch>] [--dry-run]` invokes the gStack `ship` skill via `claude -p` with PATH forced to include `~/.bun/bin` — the first MMD subcommand that actually calls a non-BMAD pillar; (3) `scripts/audit-pillars.sh` reports `INVOKED (count)` / `NOT INVOKED` per pillar against the slice range and runs automatically inside every `mmdream ship`. This is the operational closure of [L-012](./docs/lessons-learned.md) (gStack named as a pillar but never invoked across 11 slices). See [docs/specs/SPEC_V02F.md](./SPEC_V02F.md) for the 8 ACs and [ADR-007](./docs/adr/007-gstack-effective-via-ship-subcommand.md) for the design rationale.

**v0.2.g (2026-05-18)** delivered the Medium gStack walking skeleton: three more skill wrappers (`mmdream qa`, `mmdream cso`, `mmdream document-release`) sharing a reusable `lib/skills/<name>/*` pattern extracted from v0.2.f's `lib/ship/*`. The shared `lib/skills/_common/invoke-claude.js` carries the PATH-forcing, race-safe log-stream finish (the v0.2.f L-013 fix preserved), heartbeat, and ENOENT-mapping for every current and future skill wrapper. After v0.2.g, adding the next gStack skill (e.g. `/context-save`, `/freeze`) is genuinely a 1-hour exercise rather than a 1-week design problem. `audit-pillars.sh` now reports gStack invocations across 4 distinct skill names (ship + qa + cso + document-release), taking the L-012 gap from "1 of 41 skills used" to "4 of 41". See [docs/specs/SPEC_V02G.md](./SPEC_V02G.md) for the 7 ACs and [ADR-009](./docs/adr/009-medium-gstack-integration-pattern.md) for the design rationale (why extract the shared layer after only one skill, why the new commands bypass the discovery gate, why we did NOT fold the skills inside `auto-dev`'s pipeline — Heavy is still v0.5+).

**v0.2e (2026-05-18)** delivered the **autolearning composer**: every `mmdream` subprocess invocation (autodev, ship, qa, cso, document-release) now passes its prompt through a deterministic keyword-overlap matcher against `docs/lessons-learned.md` BEFORE spawning `claude -p`. Matched lessons' rules are prepended to the prompt; a `composer.json` audit trail is written alongside the run log. A new `mmdream lessons` subcommand lists active lessons + injection counts, previews matches for any input, and prints individual lesson bodies. `scripts/audit-pillars.sh --with-composer` rolls up adoption across a slice. Pure-function library (`lib/composer/{parse-lessons,match,format,audit,usage-stats}.js`), sub-100ms on the live lessons file, no LLM call, no embedding model — see [ADR-010](./docs/adr/010-composer-minimal-keyword-overlap.md) for the design rationale. After v0.2e, the autolearning loop from [§6.5](./MAKE_MY_DREAMS.md) is operational end-to-end: failures captured as new lessons reach every future prompt automatically. Sixth reflexive use of `mmdream --here` after L-010 / L-011 / L-013 / L-015 / L-016.

**v0.2.5 → v0.3.3 (2026-05-18 → 2026-05-31)** — condensed arc (full detail per slice in each `SPEC_V0*.md` + `docs/adr/`): **v0.2.5** the `mmdream serve` web UI (the accessibility unlock — see scoping v14); **v0.2.h–v0.2.13** prompt-grounding precheck (L-015 code-enforced), the Five-Whys `mmdream unblock`, composer categorization, the lite Documentalist (`mmdream document-lessons`, which auto-promoted its first lessons into the constitution), and 3-pillars install hardening (Spec Kit + OpenSpec + Ralph Loop); **v0.2.14** the `wip-uncommitted-since-N-min` stall signal; **constitution v2.1.0** added §VII "Human-readable first"; **v0.2.15** human-readable slice-branch names (`--label`); **v0.2.16** `mmdream handover` (auto-refreshes this file's mechanical State block). Then **v0.3.0 → v0.3.3 — Dream Catcher**: the conversational dream-refinement feature on web *and* CLI (3 involvement levels Autonome/Équilibré/Guidé, editable scope), backed by a headless `bmad-product-brief` elicitation, with audience profiles (Kid/Curious/Pro) threaded into the build and bound to constitution modules via the new Layer-C composer (`lib/constitution-compose.js`). This whole arc was built reflexively — 18 `mmdream --here` slices, 1268 tests.

**v0.10.a (2026-06-03)** carried the §VIII technology-agnostic mandate into the **generation** path (it had only ever been paid down on the analysis tools). The greenfield build prompt was **hardcoded for the original drawing-camera demo** — every dream, including a browser PDF editor, was forced toward `vanilla HTML/CSS/JS + Canvas + getUserMedia` and a fixed `index.html/style.css/app.js/manifest.json` layout. Now the agent **derives** the simplest stack/structure/entry from the dream (`.mmd/shared/slice.md`), MMD imposes only KISS + a **soft** (never hard) preference for a no-build browser-previewable web app, and the agent writes a `.mmd/shared/run.json` descriptor of what it built. Shipped **with** the honesty couple (§VI): Reality Check and `mmdream serve` now read that descriptor and **degrade honestly** for a non-web build (named kind + how to run it) instead of FAILing on / faking a missing `index.html`. Slice 1 of 3 (real per-stack verification + richer non-web previews deferred). See [docs/specs/SPEC_V010A.md](./SPEC_V010A.md) and [ADR-048](./docs/adr/048-technology-agnostic-greenfield-generation.md).

**v0.12.a (2026-06-04)** made the auto-dev orchestrator **stateless and resumable** — the Conductor's **step B** pivot. `/bmad-adv-auto-dev` already delegates each of its 4 phases to a fresh sub-agent, but ran in **one `claude -p` process with no externalized phase checkpoint**: a kill (crash, Ctrl-C, reboot, or the coming 70%-context handoff) lost the whole orchestration, a rerun **restarted from Phase 1 re-doing the spec**, and `--resume` was a stub (printed state, exit 3). Now (purely additively — a fresh no-checkpoint run is byte-for-byte unchanged): new checkpoint primitives (`lib/conductor/checkpoint.js`, injected-fs, never-throws) write a `checkpoint.json` + numbered `handoff/<N>.md` notes under the gitignored `.mmd/local/` run area; the auto-dev heredoc **checkpoints each phase transition** and is **resume-aware on init** (reads the checkpoint, announces the resume, recovers from the handoff notes + branch commits, and **continues from `last_completed_phase + 1`** — never re-opening a frozen spec); and **`mmdream --here --resume`** (or greenfield `<dream> --resume`) **relaunches a fresh auto-dev via the existing `invokeAutodev`** to continue, with an **honest no-op** ("nothing to resume" / "no resumable run found") when the run completed or there is no checkpoint — never a fabricated continuation (§VI). This is the foundation for **step C** (auto-handoff@70% will trigger exactly this resume against a fresh successor). See [docs/specs/SPEC_V012A.md](./SPEC_V012A.md) and [ADR-050](./docs/adr/050-stateless-resumable-orchestrator.md).

The folder will be renamed `make-my-dreams/` after v0.1 is validated. The repo itself can be renamed at any time on the git host.

## Status

<!-- mmd:readme:status:start -->
- **Version**: `0.21.0` (package.json)
- **Latest tag**: `v0.20.0`
- **ADRs**: 59 (ADR-001..ADR-060)
- **Active lessons**: 21 active
- **Reflexive slices (release tags)**: 62
- **Tests**: (run `npm test` to refresh — pass `mmdream document --tests N`)
- _Mechanical block — regenerated by `mmdream document`; the prose History and command docs are human-authored._
<!-- mmd:readme:status:end -->

The bulleted block above (version, tag, counts) is machine-maintained by `mmdream document-readme`; the prose below is the human-owned story.

**v0.3.4** (2026-06-01) — actively developed and **usable today**: the CLI, the `mmdream serve` web UI, and the auto-dev pipeline all work. MMD is built through a **reflexive bootstrap** (MMD develops MMD) — the live slice/test/ADR/lesson counts are in the mechanical block above (they used to drift in this prose until `mmdream document-readme` started maintaining them).

What works now: **Dream Catcher** (conversational dream refinement on web *and* CLI — pick who it's for and how involved you want to be, get a small buildable scope, edit it, launch); `mmdream serve` (local web UI for non-technical users); `mmdream "<dream>"` / `mmdream --here` (greenfield + brownfield auto-dev); plus `mmdream handover`, `mmdream unblock`, `mmdream discover`, `mmdream ship`, `mmdream qa`, `mmdream cso`, `mmdream document-release`, `mmdream document-lessons`, `mmdream lessons`, `mmdream bench`. Audience **profiles** (Kid / Curious / Pro) now shape the generated app via the constitution composer.

Next on the roadmap (see [MAKE_MY_DREAMS.md](./MAKE_MY_DREAMS.md)): a lite doc-sync Documentalist, then v0.4 stateless Orchestrator + auto-handoff, v0.5 Conductor, v0.5b full Documentalist. See [BOOTSTRAP.md](./BOOTSTRAP.md) for the active plan, [docs/adr/](./docs/adr/) for decisions, and [PROBLEMS.md](./PROBLEMS.md) for the 26 documented dev-by-AI problems.

## Changelog

One line per release, newest first, generated from each git tag's annotation by `mmdream document-readme`. This is the *mechanical* release list; the narrative **History** above is the human-owned story of why each slice happened.

<!-- mmd:readme:changelog:start -->
- **v0.20.0** — fix the alignment-gate oracle leak (per-dream expectation)
- **v0.19.0** — mmdream document: the autonomous Documentalist orchestrator
- **v0.18.0** — close the Documentalist's 5 blind-spots
- **v0.17.0** — align the result to the ORIGINAL expectation (frozen oracle + dual-face verify)
- **v0.16.2** — de-flake serve-context-gauge (waitForFile 45s + diagnostic); sonnet window verified correct (no change)
- **v0.16.1** — fix the monitor's 1546% context bug (count only per-message assistant usage, not the cumulative result total)
- **v0.16.0** — model-per-task: the Conductor allocates the model to the role
- **v0.15.0** — the transparent Conductor: auto-handoff default-on
- **v0.14.0** — hybrid auto-handoff (incite, then enforce) — PROVEN LIVE
- **v0.13.2** — MMD_AUTODEV_MODEL override + robust version-pinned tests
- **v0.13.1** — fix the false-handoff (handoff requires a resumable checkpoint)
- **v0.13.0** — cooperative auto-handoff at 70% (Conductor step C)
- **v0.12.0** — the stateless, resumable orchestrator (Conductor step B.1)
- **v0.11.0** — alignment gate on the normal path + iterate-on-gap (Conductor step A)
- **v0.10.0** — technology-agnostic greenfield generation + honest preview (slice 1/3)
- **v0.9.2** — mmd deps-gate: polyglot supply-chain gate (Bundle A Security brick 2)
- **v0.9.1** — Bundle A Security brick 1: mmd secret-scan (vanilla, language-agnostic secret gate)
- **v0.9.0** — the autolearning loop is CLOSED (differentiator #2, §6.5)
- **v0.8.2** — polyglot doc→code refs (§VIII debt complete for code analysis)
- **v0.8.1** — polyglot import graph (§VIII debt: blast-radius + coherence-graph code edges)
- **v0.8.0** — the Test Curator goes POLYGLOT (adapter architecture, constitution §VIII)
- **v0.7.8** — Test Curator cluster precision: count only real-file targets (drop fixture phantoms like lib/a.js/x.js). New pure keepRealTargets filters to modules that resolve to a real repo file; most-tested-modules table is now credible.
- **v0.7.7** — Test Curator redundancy face (mmd test-health): is the corpus bloated?
- **v0.7.6** — the Test Curator (mmd test-health): test-corpus health
- **v0.7.5** — the /mmd Claude Code slash command (operator playbook)
- **v0.7.4** — coherence-graph precision: hub-source neighbor cap
- **v0.7.3** — the coherence graph: staleness-on-diff (mmd document-review --since)
- **v0.7.2** — the Documentalist compacts: SPEC archival (mmd document-compact)
- **v0.7.1** — the Documentalist checks DRIFT (mmd document-review conformance)
- **v0.7.0** — the Documentalist's coherence review (mmd document-review)
- **v0.6.1** — constitution suggestions + discover→--here friction fix
- **v0.6.0** — third-party readiness: transparent first-run setup + brownfield detection
- **v0.5.2** — serve-UI context gauge + opt-in web monitor toggle: surfaces status.json.context (bar/%/tokens/model/70%/handoff badge) in mmd serve. 1444 tests. 26th reflexive --here use.
- **v0.5.1** — live context monitor (opt-in --monitor): stream-json usage → context % in status.json + READY_FOR_HANDOFF/context_70 at 70%. Default spawn (bootstrap path) untouched. 1423 tests. 25th reflexive --here use.
- **v0.5.0** — Conductor brick 1: Layer-6 notification fan-out (opt-in MMD_NOTIFY_URL, best-effort POST on run done/failed). The proactive-feedback fix for detached runs. 1398 tests. 24th reflexive --here use.
- **v0.4.3** — LLM-as-judge behavioral oracle (P-09): after the sealed-test gate, a judge grades the implementation against what was asked; not-met/uncertain → exit 7. Bundle B now has both oracles. 1379 tests. 23rd reflexive --here use.
- **v0.4.2** — import-graph blast radius: computeBlastRadius parses+resolves module specifiers and returns the transitive reverse closure (true P-05 reach). No external parser dep (vanilla-stack). 1362 tests. 22nd reflexive --here use.
- **v0.4.1** — sealed oracle on --here: mmd --here --sealed. Extracted surface-agnostic runSealedPipeline (coder injected); MMD can now seal-test its own slices. Greenfield unchanged. 1343 tests. 21st reflexive --here use.
- **v0.4.0** — Bundle B: sealed-test oracle (mmd --sealed). Two-phase tester→seal→coder→verify catches the agent-rewrites-the-test failure (P-04) + blast-radius stub. First correctness hardening of MMD's auto-dev. 1337 tests. 20th reflexive --here use.
- **v0.3.4** — mmd document-readme (Documentalist-lite): the mmd handover pattern applied to the README. Regenerates Status + Changelog (from git tag annotations) between markers + a drift report. Closes doc drift at the root. 1309 tests. 19th reflexive --here use.
- **v0.3.3** — Layer C: profile→constitution-module composer. MMD_PROFILE now injects real kid.md/pro.md/safe-by-default modules into the build prompt. 1268 tests. 18th reflexive --here use.
- **v0.3.2** — Dream Catcher CLI surface (TTY-gated mmd dream + --catch/--no-catch) + MMD_PROFILE threading (Kid → safe-by-default). v0.3 complete: web + CLI + meaningful profile. 1224 tests. 17th reflexive --here use.
- **v0.3.1** — Dream Catcher involvement dial (Autonome/Équilibré/Guidé) + scope editing. Core complete. 1186 tests. 16th reflexive --here use.
- **v0.3.0** — Dream Catcher walking skeleton: web dream → profile → autonomous bmad-product-brief scope → confirm → auto-dev. First v0.3 milestone. 1145 tests. 15th reflexive --here use.
- **v0.2.16** — mmd handover subcommand (L-020): auto-refresh the mechanical State block, never fabricate intent. 1087 tests. 14th reflexive --here use, 1st with --label.
- **v0.2.15** — human-readable branch names for mmd --here (--label + boilerplate strip). Embodies constitution universal §VII. 1055 tests.
- **v0.2.14** — L-019 closure: WIP-salvage stall signal (wip-uncommitted-since-N-min) + composer L-015 regression-lock. 1043 tests, +18. 13th reflexive mmd --here use.
- **v0.2.13** — Spec Kit + OpenSpec + Ralph Loop install hardening (L-012 fully closed)
- **v0.2.12** — Documentalist lite (autolearning §6.5 fully operational)
- **v0.2.11** — Conductor preconditions hardening (prompt-grounding check)
- **v0.2.10** — Composer categorization (context-aware filter)
- **v0.2.9** — MMD-on-MMD findings closure (L-017 + cso LOW-1/2 + qa High-1/2/3 + e2e t.skip)
- **v0.2.8** — Five Whys Escalation (mmd unblock)
- **v0.2.7** — Composer minimal (lessons auto-injection)
- **v0.2.6** — Medium gStack (mmd qa + mmd cso + mmd document-release)
- **v0.2.5** — mmd serve: accessibility unlocked for non-tech users
- **v0.2.4** — Project Onboarder walking skeleton (mmd discover)
- **v0.2.3** — gStack effective (install hardening + mmd ship + audit-pillars)
- **v0.2.2** — dream-bench v0 (mmd bench)
- **v0.2.1** — --here mode (self / brownfield-in-place)
- **v0.2.0** — FAST engine (trimmed auto-dev)
- **v0.1.0** — v0.1 walking skeleton
<!-- mmd:readme:changelog:end -->

## Components

- [`MAKE_MY_DREAMS.md`](./MAKE_MY_DREAMS.md) — full scoping document (v19, ~1700 lines)
- [`PROBLEMS.md`](./PROBLEMS.md) — annex: 26 documented problems and techniques
- [`BOOTSTRAP.md`](./BOOTSTRAP.md) — step-by-step execution plan
- [`HANDOVER.md`](./HANDOVER.md) — session handover (state + intent); its State block is auto-refreshed by `mmdream handover`
- `SPEC_V0*.md` — one frozen spec per slice (the v0.1 walking skeleton onward); `docs/adr/` holds the project's architecture decision records (see the folder for the live count)
- [`install-mmd.sh`](./install-mmd.sh) — self-contained installer; installs + functionally verifies the pillars (BMAD + adv module + auto-dev workflow, bun, gStack, and — since v0.2.13 — Spec Kit / OpenSpec / Ralph Loop).

## Quick start

```bash
bash install-mmd.sh .            # install the pillars + the auto-dev workflow
npm install -g .                 # put `mmdream` on your PATH
mmdream serve                        # open the web UI (easiest — for anyone)
# …or, from a terminal:
mmdream "une appli pour dessiner"    # interactive Dream Catcher dialogue, then auto-dev
mmdream --here "add a dark-mode toggle"   # modify the current git repo in place
```

## License

MIT — see [LICENSE](./LICENSE).
