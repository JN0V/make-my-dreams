# Make My Dreams — v0.6.a Spec: third-party readiness (transparent first-run setup + brownfield detection)

> MMD is proven on exactly ONE repo: itself. The moment someone runs it on *their* project, three things break the experience: (1) `mmd discover` mis-labels a real Node/Python app as `blank` (its `classify` only knows the SDD methodologies, never the project's stack — even though the scan already detected it); (2) `mmd --here` needs the BMAD auto-dev workflow + a constitution materialized in the target repo, but nothing checks for them — it just launches into an inert setup; (3) the operational env-vars/flags a third party must know (`MMD_TIMEOUT_MS=0`, the spec-frozen directive, `--sealed`/`--monitor`/`MMD_NOTIFY_URL`) are tribal knowledge.
>
> v0.6.a makes MMD *usable on another repo without learning a new command*. No `mmd init` — the existing `mmd --here` detects, at first run, that the target lacks MMD's setup and **offers to run it** (one confirmation in a TTY; automatic + logged in `serve`/CI), then continues. A repo that already has a constitution keeps it untouched — MMD never overwrites the project's own rules. And `mmd discover` finally names the stack it scanned. The slice's Definition of Done requires a **green end-to-end run on a real, non-MMD repo** — the cross-project test the roadmap never actually ran.
>
> The deeper "whose constitution governs the build" architecture (the Layer-C composer reading the *project's* modules instead of MMD's bundled ones, plus a non-destructive "suggest improvements" mode) is deliberately **v0.6.b** — see Out of scope.

---

## 1. Goal of v0.6.a

```
[mmd discover on a Node/Python app]
   before:  detected case = blank          ← wrong, ignores the scanned stack
   after:   detected case = brownfield-app  ← names the language/framework it found
            (a truly empty repo — no manifest, no code — still = blank)

[mmd --here on a repo that lacks MMD's setup]
   detect:  .specify/memory/constitution.md missing? auto-dev workflow / adv command missing?
   TTY:     "MMD isn't set up in this repo yet. Run setup now? [o/N]"
              o → run install-mmd.sh <target>, print the env-var cheatsheet, continue
              N → abort with a clear pointer (exit 8) — NEVER proceed with an inert setup
   serve/CI (non-TTY): auto-run + honest log (no silent inert launch)
   MMD_SKIP_SETUP=1 → bypass the guard (escape hatch, like MMD_SKIP_GROUNDING)

[a repo that ALREADY has a constitution]
   "elle reste" — MMD detects it, does NOT overwrite, continues. (install-mmd.sh
    Phase 2 already honors this; the guard inherits it.)
```

Deliverables:
1. **`classify` learns the stack** (`lib/discover/classify.js`): a new `brownfield-app` case, returned when the scan found a recognized stack (`scanData.frameworks.language` / `scanData.languages` non-empty) but **no** SDD methodology — distinct from `blank` (genuinely empty/unstructured). Priority sits below `rich`/`bmad-alone`, above `blank`. `mmd discover`'s "detected case" line + the report reflect it. Gate behavior unchanged (the gate keys on the report's VALIDATED status, not the case string).
2. **Transparent first-run setup guard** (`lib/onboarding/`): a pure `detectMmdSetup(targetDir) → {ready, missing[]}` probe, wired into `runHereMode` (`bin/mmd.js`) right after the mode line and before the onboarding gate. When not ready: TTY → confirm-then-run; non-TTY → auto-run + log; decline/failure → exit 8 (never an inert launch); `MMD_SKIP_SETUP=1` bypasses. Setup = spawn `install-mmd.sh <target>` (runner injected for tests). An already-set-up repo → no-op, continue.
3. **Onboarding cheatsheet** (`lib/onboarding/cheatsheet.js`): a pure `buildOnboardingCheatsheet() → string` listing the non-evident operational rules (`MMD_TIMEOUT_MS=0`, the spec-frozen dream directive, commit-incrementally, `--sealed`/`--monitor`/`MMD_NOTIFY_URL`), printed once after a successful setup.
4. **A green end-to-end run on a REAL non-MMD repo** is part of the DoD (documented), not just MMD-on-MMD.

**Mission validation**: take a throwaway repo (`git init` + `package.json` + `index.js`), run `mmd discover` → it reports `brownfield-app` (not `blank`); run `mmd --here "<small change>"` → MMD notices the repo isn't set up, asks once, runs the setup, prints the cheatsheet, and the auto-dev run completes green. A repo that already has `.specify/memory/constitution.md` keeps it byte-for-byte.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `classify` returns `brownfield-app` for a real app with no SDD
**Given** a `scanData` where `frameworks.language` is set (or `languages` is non-empty) — e.g. a `package.json` Node repo, a `pyproject.toml`/`requirements.txt` Python repo, `go.mod`, `Cargo.toml` — and `methodologies.spec_kit`/`bmad` are false and `stories_count < 10`
**When** `classify(scanData)` runs
**Then**: it returns `'brownfield-app'` (a NEW member of `DISCOVERY_CASES`), NOT `'blank'`. A `scanData` with **no** detected language/stack (empty/unstructured repo) still returns `'blank'`. `already_onboarded` still wins (priority 1); `rich`/`bmad-alone` still win over `brownfield-app`. A missing/malformed `scanData` still degrades to `'blank'` (never throws). `mmd discover`'s `detected case = …` line and the written report surface the new label.
Tag: `@unit` (exhaustive classify branches) + `@integration` (discover on a Node fixture prints `brownfield-app`).

### AC-2: `detectMmdSetup` reports readiness honestly
**Given** a target dir
**When** `detectMmdSetup(targetDir)` runs (pure: fs reads only, never throws)
**Then**: it returns `{ ready: boolean, missing: string[] }` where `missing` enumerates the absent pieces MMD needs to run `--here` on this repo — at minimum the constitution (`.specify/memory/constitution.md`) and the auto-dev workflow / adv command (e.g. `_bmad/` or `.claude/commands/bmad-adv-auto-dev.md`). A fully-set-up repo → `{ready: true, missing: []}`. A bare repo → `ready:false` with the specific missing items named (human-readable, universal §VII). An unreadable/odd path degrades to `ready:false` rather than crashing.
Tag: `@unit`.

### AC-3: the first-run guard is wired into `mmd --here` — confirm/auto/decline, never inert
**Given** `runHereMode` on a target where `detectMmdSetup` reports `ready:false`
**When** `--here` is invoked
**Then**:
- **TTY**: MMD prints what's missing and asks once (`Run setup now? [o/N]`). On **yes** → it runs the setup (spawns `install-mmd.sh <target>` via an **injected runner** so tests don't shell out), prints the cheatsheet (AC-4), and proceeds with the run. On **no** → it aborts with a clear message pointing to `install-mmd.sh .` and returns **exit 8** (a new, distinct code — NOT a silent inert launch).
- **Non-TTY** (`serve`/CI): it auto-runs the setup with an honest log line (no prompt), then proceeds; if the setup runner fails (non-zero), it reports the failure and returns exit 8 (never proceeds inert).
- **`MMD_SKIP_SETUP=1`**: the guard is bypassed with a warning (escape hatch, mirrors `MMD_SKIP_GROUNDING`).
- **Already ready**: the guard is a no-op — the run proceeds exactly as today, and an **existing `.specify/memory/constitution.md` is never overwritten** ("elle reste").
The guard runs **before** the onboarding/discovery gate and the git checks (a repo with no setup can't pass them meaningfully anyway).
Tag: `@integration` (injected runner + injected prompt/tty + injected `detectMmdSetup`; assert: yes→runner-called→proceed, no→exit 8, non-TTY→auto, skip→bypass, ready→no-op).

### AC-4: the onboarding cheatsheet is surfaced (pure builder)
**Given** a successful first-run setup (or a `--here` on a freshly-set-up repo)
**When** `buildOnboardingCheatsheet()` runs and MMD prints it
**Then**: it returns a human-readable string covering the non-evident operational rules — `MMD_TIMEOUT_MS=0` for real slices, the "SPEC IS FROZEN, go directly to implementation" dream directive, commit-incrementally-per-AC, and the opt-in switches `--sealed` / `--monitor` / `MMD_NOTIFY_URL` — each code paired with a plain-language one-liner (universal §VII). It is a pure function (unit-testable, no I/O) and is printed once after setup, not on every run.
Tag: `@unit` (the builder) + `@integration` (printed after setup, not on a ready repo).

### AC-5: docs + ADR
**Given** v0.6.a ships
**When** docs are read
**Then**: a new ADR documents the transparent first-run setup decision (why no `mmd init`: minimize commands to learn; why a confirm in TTY but auto in serve/CI; why decline → exit 8 rather than an inert launch; the `brownfield-app` case; "elle reste" — never overwrite an existing constitution; and that the Layer-C "project owns its constitution" architecture is the deferred v0.6.b). `README.md` + `CLAUDE.md` gain a short "Using MMD on your own repo" note (run `mmd --here`, accept the one-time setup, the env-var cheatsheet). `mmd document-readme --tests N` and `mmd handover --tests N` are run so the mechanical blocks don't drift. A lesson-learned is recorded if the end-to-end surfaces a third-party gotcha.
Tag: `@unit` anchors (ADR/README markers).

### AC-6: green end-to-end on a REAL non-MMD repo (DoD gate)
**Given** a throwaway repo created outside MMD (`git init`; `package.json` + `index.js`; no `.specify/`, no `_bmad/`)
**When** the full flow is run there — `mmd discover` then `mmd --here "<trivial change>"` accepting the setup
**Then**: `discover` reports `brownfield-app`; the setup runs; the cheatsheet prints; auto-dev completes and produces a committed change on a slice branch — **green, on a repo that is not MMD**. The run (commands + result) is captured in the slice's closure notes / HANDOVER. This is the cross-project validation the roadmap never executed and is REQUIRED for done.
Tag: `@e2e` (manual/scripted, documented — not a CI-gated automated test, since it shells out to `install-mmd.sh` + `npx`/`bun` + a real `claude -p`).

---

## 3. Architecture (incremental)

```
lib/discover/classify.js     MODIFY — add 'brownfield-app' to DISCOVERY_CASES + the stack-aware branch
                             (reads scanData.frameworks.language / scanData.languages — already in the scan output)
lib/onboarding/              NEW dir
  detect.js                  NEW — pure detectMmdSetup(targetDir) → {ready, missing[]} (fs reads, never throws)
  setup.js                   NEW — runFirstRunSetup({targetDir, tty, confirmFn, runnerFn, env, out}) — orchestration:
                                    detect → (confirm | auto) → spawn install-mmd.sh <target> → cheatsheet → result
                                    runnerFn + confirmFn injected (DIP) so it's testable without a shell/TTY
  cheatsheet.js              NEW — pure buildOnboardingCheatsheet() → string
bin/mmd.js                   MODIFY — runHereMode: call the guard after the "Mode: --here" line, before checkGate;
                                    honor MMD_SKIP_SETUP; exit 8 on decline/failure; no-op when ready
docs/adr/0NN-*.md            NEW — the transparent first-run setup ADR (number assigned from the ADR folder)
README.md / CLAUDE.md        MODIFY — "Using MMD on your own repo" note
HANDOVER.md                  MODIFY — refresh state + the AC-6 e2e result
package.json                 MODIFY — 0.6.0
```

### Files modified / added
```
make-my-dreams/
├── lib/discover/classify.js                     # modified — brownfield-app case
├── lib/onboarding/{detect,setup,cheatsheet}.js  # NEW
├── bin/mmd.js                                    # modified — first-run guard in runHereMode
├── test/unit/classify-brownfield.test.js         # NEW — AC-1 branches
├── test/unit/onboarding-detect.test.js           # NEW — AC-2
├── test/unit/onboarding-cheatsheet.test.js        # NEW — AC-4 builder
├── test/integration/here-first-run-setup.test.js  # NEW — AC-3 (injected runner/tty/detect)
├── test/integration/discover-brownfield.test.js   # NEW — AC-1 discover surface
├── docs/adr/0NN-transparent-first-run-setup.md    # NEW
├── README.md / CLAUDE.md / HANDOVER.md            # modified
└── package.json                                   # modified — 0.6.0
```

---

## 4. Out of scope for v0.6.a (deferred to v0.6.b unless noted)
- ❌ **Layer-C composer reads the PROJECT's constitution** instead of MMD's bundled modules (`lib/constitution-compose.js` hardcodes `REPO_ROOT` = MMD's own install dir). This is the real "whose constitution governs" fix — **v0.6.b**.
- ❌ **"Suggest improvements" mode** on an existing constitution (non-destructive proposals) — **v0.6.b** (the user's "on peut faire des suggestions d'amélioration, mais sinon elle reste").
- ❌ **A new `mmd init` command** — explicitly rejected (minimize commands to learn; the guard is transparent inside `--here`).
- ❌ **First-run guard on `mmd <dream>` greenfield / `mmd serve`** — greenfield builds a *fresh* app in `demo/` using MMD's bundled setup; it doesn't operate on the user's repo, so the third-party gap doesn't apply there. Guard is `--here`-only this slice.
- ❌ **Fixing `install-mmd.sh` itself** beyond invoking it (e.g. materializing the *modular* constitution + bindings into the target) — it already writes a monolithic constitution + the BMAD workflow, which is enough for `--here` to run. Modular materialization is part of the v0.6.b composer work.
- ❌ **Scale assumption**: one target repo, one interactive `--here` at a time; the setup is a one-shot per repo. No concurrency concerns.

---

## 5. Implementation hints (for auto-dev)
1. Read this SPEC, `lib/discover/classify.js` (the four-case enum + the `scanData` JSDoc — note `runScan` in `lib/discover/scan.js:471` already returns `frameworks.{language,…}` and `languages`), and `runHereMode` in `bin/mmd.js:341` (insert the guard right after the `Mode: --here` line at ~356, before `checkGate` at ~364).
2. `classify`: add `'brownfield-app'` to `DISCOVERY_CASES`; the new branch goes **after** the `rich`/`bmad-alone` checks and **before** `return 'blank'` — `if (a recognized stack was detected) return 'brownfield-app'`. Treat "recognized stack" as `frameworks.language` truthy OR `languages` non-empty. Keep it pure; keep the malformed-input → `blank` guard.
3. `detectMmdSetup`: probe the minimum set `--here` needs. Constitution = `.specify/memory/constitution.md`. Auto-dev workflow = check for `_bmad/` and/or the adv command file install-mmd.sh materializes (`.claude/commands/…`). Return named, human-readable `missing[]` entries. Never throw — wrap fs in try/catch, unknown → treat as missing.
4. `runFirstRunSetup`: inject `confirmFn` (prompt) and `runnerFn` (the `install-mmd.sh` spawn) so the integration test drives yes/no/auto and asserts the runner is/isn't called WITHOUT shelling out. TTY detection via `process.stdin.isTTY` (already used elsewhere for the Dream Catcher CLI gate). Honesty (universal §VI): on a runner failure, report it and return a non-ok result → caller exits 8; never proceed with `ready:false`.
5. Exit codes are a closed ladder in `runHereMode` (3 cwd, 4 git, 5 gate/branch, 6 grounding, 7 judge). Use **8** for "setup missing and declined-or-failed" — document it next to the others.
6. The cheatsheet is a pure string builder — pair every code with a plain-language line (universal §VII); print it once after setup, not on a ready repo.
7. Operational rules apply to the **launch of this slice** itself (it's an `mmd --here` run): `MMD_TIMEOUT_MS=0`, commit incrementally per AC, spec-frozen directive. The slice does NOT cite to-be-created `.md` paths literally in its dream (grounding false-trip on output paths) — describe the new ADR as "a new ADR under the ADR folder", let auto-dev read the exact path from §3.
8. Constitution bindings: universal (§I SRP for the new modules, §II KISS — no premature `mmd init`, §VI honesty, §VII readable cheatsheet/case names), ai-coding, commit-git, testing (tag every test; red-green), error-handling (detect never throws; runner failure → exit 8 not a crash), security (the setup spawns `install-mmd.sh` against a path — validate/quote the target; don't run setup on an untrusted path without the user's confirm), documentation, brownfield (we're literally onboarding a brownfield repo).

---

## 6. Definition of done
1. All 6 ACs met (AC-6 is the cross-project gate — not optional).
2. Full suite passes (current 1444 + new tests).
3. On a real non-MMD repo: `mmd discover` → `brownfield-app`; `mmd --here "<trivial change>"` → one-time setup prompt → setup runs → cheatsheet prints → auto-dev completes green with a committed slice. Captured in HANDOVER.
4. On a repo with a pre-existing `.specify/memory/constitution.md`: the guard is a no-op and the file is untouched ("elle reste").
5. README + CLAUDE.md + the new ADR in place; `mmd document-readme --tests N` + `mmd handover --tests N` run (no drift).
6. Version bumped to `0.6.0`.
7. Slice merged (ff-only) + tag `v0.6.0`.
8. 27th reflexive use of `mmd --here`. **MMD is now usable on a repo other than itself** — the first crossing of the "works on exactly one project" wall, with the project's own constitution respected and the operational tribal knowledge surfaced. v0.6.b takes the composer the rest of the way (the build reads the *project's* constitution, with non-destructive suggestions).

---

*Spec v0.6.a — third-party readiness: `classify` names the scanned stack (`brownfield-app`), a transparent first-run setup guard inside `mmd --here` (confirm in TTY, auto in serve/CI, never an inert launch, never overwriting an existing constitution), and an env-var cheatsheet — validated by a green end-to-end on a REAL non-MMD repo. No new command to learn. The "whose constitution governs the build" composer rework is the deferred v0.6.b.*
