# Make My Dreams — v0.3.b Spec: Dream Catcher CLI surface + profile threading

> Final v0.3 piece. v0.3.0/v0.3.1 built Dream Catcher on a surface-agnostic core (`lib/dream-catcher/`) and wired it to the **web** (`mmd serve`). v0.3.b wires the SAME core to the **CLI/TTY** (a terminal dialogue, for Pro users running `mmd "<dream>"`) and makes the chosen **profile actually reach the build** via an `MMD_PROFILE` env var that the auto-dev prompt consumes. The core's public API (`setDream → setProfile → setLevel → answerClarify… → confirm`) is identical to what `lib/server.js` calls over HTTP, so the CLI driver is a thin readline loop over it — no new dialogue logic. Two product decisions taken this session: the CLI dialogue is **TTY-gated by default** for greenfield `mmd "<dream>"` (with `--catch`/`--no-catch` overrides, and non-interactive contexts skip it — CI-safe); and `MMD_PROFILE` is threaded into the subprocess **with minimal-but-real consumption** (the auto-dev prompt states the profile and, for Kid, injects the safe-by-default directive), with the full bindings-table module injection deferred to a later composer slice. After v0.3.b, Dream Catcher works from both the browser AND the terminal, and the profile is no longer a dead `status.json` field.

---

## 1. Goal of v0.3.b

Two deliverables on the existing core:

1. **CLI/TTY surface** — a readline driver (`lib/dream-catcher/cli-driver.js`) that runs the SAME session the web does, turn by turn, in a terminal:
   ```
   mmd "une appli pour dessiner"     (on a TTY)
     → C'est pour qui ?  [enfant/curieux/pro]
     → Niveau ?          [auto/équilibré/guidé]
     → (guided) Q1 → réponse → Q2 → réponse …
     → ✨ Scope  → [R]ecommencer / [M]odifier / [Entrée]=C'est parti
     → existing auto-dev launch with the refined scope
   ```
   - **Trigger**: `shouldCatch = flags.catch || (stdin.isTTY && !flags['no-catch'])`, and NEVER under `--here` (brownfield self-modification is a dev flow, not an end-user dream). Non-TTY without `--catch` → skip the dialogue, launch the verbatim dream (today's behavior, CI-safe). `--catch` on a non-TTY → exit 2 (can't run an interactive dialogue without a terminal).
   - The refined scope replaces the dream fed to auto-dev; the profile is persisted to `status.json.profile` (as the web path already does).
   - **Edit**: best-effort — `[M]odifier` opens `$EDITOR` on the scope if set, else falls back to a single-line replacement prompt; `[R]ecommencer` restarts; Enter confirms.

2. **`MMD_PROFILE` threading + minimal consumption** — the profile reaches the auto-dev subprocess and does something:
   - Set `MMD_PROFILE` in the subprocess env on BOTH launch paths (CLI greenfield in `bin/mmd.js`, and the web `/api/catch/confirm` in `lib/server.js`). The `buildSubprocessEnv` allowlist already passes all `MMD_*` vars, so this is just setting the var.
   - In `buildPrompt` (`lib/invoke-autodev.js`): when `MMD_PROFILE` is present, the prompt states the profile, and when `profile === 'Kid'` it injects the **safe-by-default** directive (no network / no third-parties / offline / age-appropriate). This makes the profile meaningful in the actual build, not a dead variable (observability — never thread an env var nothing consumes).

**Not in this slice** (deferred): the FULL runtime constitution binding (reading `constitution-bindings.yaml` to inject `kid.md`/`pro.md` modules) — a composer evolution, its own slice. Scope editing in the CLI is best-effort, not a rich editor.

**Mission validation**: `mmd "une appli pour dessiner"` in a terminal walks the same dialogue as the web, ends with a refined scope, and launches auto-dev with `MMD_PROFILE=Kid` so the build prompt carries the safe-by-default directive; `mmd "…" | cat` (no TTY) and CI still launch directly, unchanged.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `--catch` / `--no-catch` flags
**Given** `lib/argv-parser.js`
**When** parsed
**Then**: `--catch` and `--no-catch` are recognized boolean flags (added to `KNOWN_FLAGS`), default false; they are **mutually exclusive** (both set → exit 2 with a clear message); they compose with engine/session flags. `parseArgv`'s returned `flags` shape gains `catch` and `'no-catch'`.
Tag: `@unit`.

### AC-2: CLI driver over the session core
**Given** an injected I/O channel (readline-like: `ask(prompt) → Promise<string>`, `print(text)`) and an injected `elicit` runner
**When** `runCliDreamCatcher({dream, io, elicit})` runs
**Then**: it drives the session `setDream → setProfile(ask) → setLevel(ask) → [answerClarify(ask) loop while next==='question'] → scope`, prints each question/the scope, offers restart/edit/confirm, and returns `{scope, profile, confirmed: boolean}`; restart re-runs from profile; the autonomous level skips the question loop. Pure over injected I/O — testable with a scripted fake stdin (no real TTY/claude).
Tag: `@unit`.

### AC-3: TTY-gated trigger in the greenfield path
**Given** `bin/mmd.js` greenfield `mmd "<dream>"`
**When** it resolves whether to catch
**Then**: `shouldCatch = flags.catch || (stdin.isTTY && !flags['no-catch'])` AND never under `--here`; when catching, it runs the CLI driver (real readline + real `runElicit`), replaces the dream with the refined scope, and persists `profile` to `status.json`; non-TTY without `--catch` skips (direct launch, verbatim dream); `--catch` on a non-TTY exits 2 with a clear "needs a terminal" message. If the user aborts the dialogue (restart→cancel / EOF), no launch happens.
Tag: `@unit` (logic with injected isTTY) + `@integration` (scripted stdin).

### AC-4: `MMD_PROFILE` reaches the subprocess
**Given** a confirmed profile (CLI or web)
**When** auto-dev is launched
**Then**: `MMD_PROFILE` is set in the child env on both paths and survives `buildSubprocessEnv` (assert it appears in the allowlisted output); an absent profile defaults to `Curious` (never empty).
Tag: `@unit`.

### AC-5: Minimal profile consumption in the prompt
**Given** `buildPrompt` in `lib/invoke-autodev.js`
**When** `MMD_PROFILE` is set
**Then**: the built prompt states the profile; for `MMD_PROFILE=Kid` it injects the safe-by-default directive (no network, no third parties, offline, age-appropriate, no accounts/UGC); for Curious/Pro it states the profile without the Kid constraints; an unset `MMD_PROFILE` leaves the prompt unchanged (back-compat).
Tag: `@unit`.

### AC-6: Docs + ADR + lesson
**Given** v0.3.b ships
**When** docs are read
**Then**: an ADR numbered 023 documents the CLI surface (TTY-gated trigger, the shared-core driver) + the profile-threading-with-consumption decision (and why full bindings injection is deferred); `docs/lessons-learned.md` gains a formal **L-022** entry (with `Category`/`Applies to`/`Keywords`) on "don't thread an env var nothing consumes — observability"; `README.md` documents `mmd "<dream>"` interactive mode + `--catch`/`--no-catch` + `MMD_PROFILE`.
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/dream-catcher/
  cli-driver.js      NEW — readline loop over the session core (injected io + elicit)
  session.js         (unchanged — its public API already supports a CLI driver)

bin/mmd.js           MODIFY — greenfield path: shouldCatch gate → runCliDreamCatcher →
                     refined scope + status.json.profile; set process.env.MMD_PROFILE before invokeAutodev
lib/argv-parser.js   MODIFY — add catch / no-catch boolean flags + mutex
lib/invoke-autodev.js MODIFY — buildPrompt consumes MMD_PROFILE (state profile + Kid safe-by-default)
lib/server.js        MODIFY — set MMD_PROFILE on the /api/catch/confirm launch env
```

### Files modified / added
```
make-my-dreams/
├── lib/dream-catcher/cli-driver.js                  # NEW
├── bin/mmd.js                                       # modified — trigger + MMD_PROFILE
├── lib/argv-parser.js                               # modified — --catch/--no-catch
├── lib/invoke-autodev.js                            # modified — buildPrompt profile consumption
├── lib/server.js                                    # modified — MMD_PROFILE on confirm launch
├── test/unit/dream-catcher-cli-driver.test.js       # NEW — scripted-stdin driver
├── test/unit/argv-parser.test.js                    # modified — catch/no-catch
├── test/unit/invoke-autodev-*.test.js               # modified — MMD_PROFILE consumption
├── test/integration/dream-catcher-cli.test.js       # NEW — greenfield trigger + scripted stdin
├── docs/lessons-learned.md                          # modified — L-022
├── docs/adr/023-dream-catcher-cli-and-profile.md    # NEW
├── README.md                                        # modified
└── package.json                                     # modified — 0.3.2
```

---

## 4. Out of scope for v0.3.b
- ❌ Full runtime constitution binding (read `constitution-bindings.yaml` → inject `kid.md`/`pro.md` modules) — a composer evolution, its own slice.
- ❌ Dream Catcher under `--here` (brownfield self-modification is a dev flow, not an end-user dream).
- ❌ A rich in-terminal scope editor (edit is best-effort via `$EDITOR` or a single-line replace).
- ❌ **Scale assumption**: the CLI driver is a single synchronous dialogue per invocation — fine for one user at a terminal.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V03B.md (this), the parent [SPEC_V03A.md](SPEC_V03A.md), and SPEC_V03A1/A2 for the core's API.
2. The session public API is ready (see `lib/dream-catcher/session.js`): `setDream → {next:'profile'}`, `setProfile → {next:'level'}`, `await setLevel → {next:'scope'|'question'}`, `await answerClarify → {next:'question'|'scope'}`, `editScope`, `confirm`. The CLI driver mirrors what `lib/server.js`'s catch routes do — reuse, don't reinvent.
3. Use the existing readline template `promptRfc()` in `bin/mmd.js` (`node:readline/promises`, `input.isTTY` guard). Keep `cli-driver.js` I/O **injected** so tests script stdin (Readable + `isTTY=true`) — mirror the fake-elicit seam (`MMD_AUTODEV_CMD`) for the elicit calls; NEVER hit the real claude in tests.
4. `buildSubprocessEnv` already allowlists `MMD_*` — just set `process.env.MMD_PROFILE` (CLI) / add `MMD_PROFILE` to childEnv (server) before launch. Don't widen the allowlist.
5. Honest fallback is inherited from the core (BMAD failure → verbatim dream). Don't add a second fallback.
6. Constitution bindings: universal (§VI honesty, §VII human-readable), ai-coding, commit-git, testing, error-handling, security, safe-by-default (the Kid directive this slice injects).

## 6. Definition of done
1. All 6 ACs met.
2. Full suite passes (current 1186 + new tests).
3. `mmd "<dream>"` on a TTY runs the dialogue (profile → level → [questions] → scope → confirm) and launches with the refined scope + `MMD_PROFILE`; `mmd "<dream>" | cat` (non-TTY) launches directly, unchanged; `--catch`/`--no-catch` honored; `--catch` on non-TTY → exit 2.
4. `MMD_PROFILE=Kid` makes the auto-dev prompt carry the safe-by-default directive (verified in `buildPrompt` output).
5. README + ADR-023 + L-022 in place.
6. Version bumped to `0.3.2`.
7. Slice merged (ff-only) + tag `v0.3.2`.
8. 17th reflexive use of `mmd --here` (4th with `--label`). **Dream Catcher is now complete on both surfaces (web + CLI) with a meaningful profile** — v0.3 done; the full profile→constitution binding is the only acknowledged follow-up.

---

*Spec v0.3.b — wires the Dream Catcher core to the terminal (TTY-gated `mmd "<dream>"`, `--catch`/`--no-catch`) and threads `MMD_PROFILE` into the build with real consumption (Kid → safe-by-default), reusing the same session API the web uses. Completes v0.3; full constitution-module binding by profile is a deferred composer slice.*
