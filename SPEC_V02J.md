# Make My Dreams — v0.2.j Spec: Five Whys Escalation pattern

> Per L-004 (auto-dev stops at ~80%) + L-015 (Conductor pre-conditions gap) + L-016 (spec polish trap) + Sébastien's direct ask — the recurring failure mode of nested agentic systems is silent stuck-and-burn: a sub-agent hits a wall, retries blindly, or pivots into over-engineering, while the outer orchestrator has nothing better than "retry" or "kill". This is true across MMD's slices (every one of L-004/L-006/L-016 is a flavor of this) and across the broader Cowork experience Sébastien has seen elsewhere. **Solution**: transpose the **5 Whys** technique from crisis post-mortems into the Conductor's stuck-recovery toolkit. When a Worker (today: auto-dev) is detected as stalled, the Conductor pauses it, spawns a structured 5-Whys session via BMAD Party Mode (Mary leads the chain; Winston, Quinn, Amelia, Christie augment with their lenses), parses the structured output, and takes one of five recommended actions: `continue-with-hint`, `abandon-approach`, `escalate-to-user`, `task-actually-complete`, `false-positive-stall`. v0.2.j ships the walking-skeleton: detector + session runner + manual `mmd unblock` subcommand. The auto-trigger from the Conductor lands later (v0.5+ when Conductor itself becomes a first-class loop). For v0.2.j, the user can invoke 5-Whys on demand against any slice that looks stuck, and the composer (v0.2.7) automatically injects relevant past lessons into the session prompt — closing the §6.5 autolearning loop in a new dimension (the system learns *from* and *uses* its own stuck-recovery sessions).

---

## 1. Goal of v0.2.j

Deliver three coordinated pieces:

1. **Stall detector** (`lib/conductor/stall-detector.js`) — pure function `detectStall({ statusJsonPath, sliceBranch, repoRoot, thresholds })` returning `{ stalled: boolean, signals: string[], evidence: { lastCommitAgeMin, retryCount, errorPatternMatched, ... } }`. Reads `.mmd/shared/status.json` + `git log` + `.mmd/local/runs/*.log` headers. Configurable thresholds via env (`MMD_STALL_MIN_NOCOMMIT=10`, `MMD_STALL_MAX_RETRIES=3`, `MMD_STALL_ERROR_PATTERN_REGEX=...`). Deterministic, no LLM, sub-100ms.

2. **Five-Whys session runner** (`lib/conductor/five-whys.js`) — function `runFiveWhys({ context, claudePath, env })` that spawns `claude -p` with a structured BMAD Party Mode prompt asking Mary (analyst persona) to lead a 5-why chain on the provided context, augmented by Winston (architect), Quinn (QA), Amelia (PO), Christie (CSO). Output is structured markdown that the runner parses into JSON: `{ root_cause: string, recommended_action: "continue-with-hint" | "abandon-approach" | "escalate-to-user" | "task-actually-complete" | "false-positive-stall", action_hint: string, confidence: 0-1, evidence: string[] }`. Composer (v0.2.7) automatically injects matched past lessons into the session prompt before claude -p spawn.

3. **`mmd unblock [<slice-branch>] [--dry-run]`** subcommand — manual trigger: validates input, runs the detector, if stalled (or `--force`) runs the 5 Whys session, writes the session log to `.mmd/shared/5-whys/<ts>.md`, prints summary + recommended action. Does NOT auto-execute the action — that's v0.5+ Conductor work. The user reads and acts.

**Non-features** (deliberately deferred):
- No auto-trigger from a running Worker. v0.5+ Conductor.
- No automatic execution of the recommended action. v0.5+ Conductor.
- No multi-Worker coordination (only diagnoses one slice at a time).
- No mid-run intervention without explicit user invocation.

**Why this exists**: every one of L-004, L-006, L-016 cost 30+ minutes of wasted wall-clock and required manual root-cause analysis by Sébastien or me. A 5 Whys session at minute 10 of v0.2.g would have surfaced "you're stuck in spec-polishing because the prompt's 'authoritative' is being misread" and unblocked in 2 min instead of 30. The technique is well-validated in crisis post-mortems; the value-add here is **automating its invocation + the BMAD Party Mode persona structure** + **composer injection of past lessons into the session itself**.

**Mission validation**: after v0.2.j, `mmd unblock <stuck-slice>` produces a `.mmd/shared/5-whys/<ts>.md` file with the 5 why-chain visible, a clear root-cause line, and a recommended action. Validated end-to-end against a fixture "stuck slice" (a recorded stall scenario) in `test/integration/`.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `lib/conductor/stall-detector.js` pure function

**Given** a `.mmd/shared/status.json` + a slice branch + a repo root path
**When** `detectStall({ statusJsonPath, sliceBranch, repoRoot, thresholds })` is called
**Then** the function:
- Reads status.json (`state`, `engine_metrics.duration_seconds`, `tasks[]`)
- Reads `git log <sliceBranch> --format='%at' -1` → seconds since last commit
- Reads `.mmd/local/runs/*.log` headers + tails for error-pattern matches
- Returns `{ stalled: bool, signals: string[], evidence: {...} }` where signals come from a closed enum: `"no-commit-since-N-min"`, `"retry-count-exceeded"`, `"error-pattern-matched"`, `"duration-exceeded-budget"`, `"state-failed-explicit"`, `"heartbeat-stale"`
- Thresholds default: `MMD_STALL_MIN_NOCOMMIT=10` (min), `MMD_STALL_MAX_RETRIES=3`, `MMD_STALL_DURATION_BUDGET_FACTOR=2.0` (2× the engine's expected budget). Each is overridable via env or thresholds arg.
- Pure: same inputs → same output. Mock-friendly for tests (injectable fs reads).

Tag: `@unit` exhaustive — empty status, missing slice, fresh slice (no commits), commits within threshold, exceeding threshold, error pattern hit, multiple signals stacked.

### AC-2: `lib/conductor/five-whys.js` session runner

**Given** a `StallContext` (slice branch, repo path, signals, evidence, latest run log tail, dream text, lessons-learned path)
**When** `runFiveWhys({ context, claudePath, env, timeoutMs })` is called
**Then** the function:
- Builds a structured prompt that includes:
  - The BMAD Party Mode invocation with persona assignments (Mary leads the 5-why chain, Winston/Quinn/Amelia/Christie add their lens at each "why")
  - The stuck context (signals, evidence, last commits, last log lines, dream verbatim)
  - The closed enum of `recommended_action` values + a strict output schema (markdown sections + JSON block at the end)
  - The composer auto-injection of matched lessons (calls `composeLessons(prompt, lessonsPath)` from v0.2.7's lib)
- Spawns `claude -p --output-format text` with `env.PATH=$HOME/.bun/bin:...` forced (per L-016 + v0.2.f shim pattern)
- Tee'd to `.mmd/local/five-whys-runs/<ts>.log`
- Parses the response: extracts the trailing JSON block via regex, validates against schema, falls back to `recommended_action: "escalate-to-user"` if parse fails (with the parse error as evidence)
- Returns `{ sessionLog: string, parsed: { root_cause, recommended_action, action_hint, confidence, evidence[] }, parseOk: bool }`

Tag: `@unit` for prompt building + JSON parsing + fallback. `@integration` with fake-claude fixture producing each of the 5 action types.

### AC-3: `mmd unblock [<slice-branch>] [--dry-run] [--force]` subcommand

**Given** MMD v0.2.j installed
**When** the user runs `mmd unblock`, `mmd unblock <branch>`, `mmd unblock --dry-run`, `mmd unblock --force`, `mmd unblock --help`
**Then** the CLI:
- Routes to `bin/conductor/unblock.js` (or in-line in `bin/mmd.js` like other subcommands)
- `--help` prints usage, signal types, exit codes, link to `docs/adr/011-five-whys-escalation.md`
- Default branch = current branch (must be a `slice/*` branch, else exit 4)
- `--dry-run`: runs detector only, prints signals + evidence, does NOT call claude. Exit 0 if not stalled, exit 8 if stalled (informative).
- `--force`: skip detector, run 5-Whys session unconditionally
- Without `--dry-run` and `--force`: detector first → if stalled, run session; else print "no stall detected" and exit 0
- After session: writes `.mmd/shared/5-whys/<ts>.md` (the full session log) + prints summary (root_cause, recommended_action, action_hint) + the recommended next user action ("run X" or "stop and ask Y")
- Exit codes: 0 ok / 2 user-argv error / 4 not a slice branch / 5 detector found nothing wrong (without --force) / 6 session ran, action = escalate-to-user / 7 session ran, action = abandon-approach / 8 session ran, action = continue-with-hint or task-actually-complete or false-positive-stall

Tag: `@unit` for routing + exit-code mapping. `@integration` for end-to-end dry-run + full session with fake-claude.

### AC-4: Composer integration — 5-Whys benefits from past lessons

**Given** v0.2.7 composer is in place
**When** the 5-Whys session runner builds its prompt
**Then**:
- The prompt body (BMAD party mode + stuck context) is passed through `composeLessons(prompt, lessonsPath)` BEFORE spawning claude
- Matched lessons appear at the top of the session prompt (composer's `## Active lessons` section)
- The session log records which lessons were matched (composer.json sibling file)
- Test: a stall context mentioning "claude -p timeout" auto-matches L-016 (keyword "MMD_TIMEOUT_MS", "timeout", "30 min") and injects its rule into the session

This means the system **uses its own captured lessons** when diagnosing new stalls — closes a loop the composer alone couldn't close (composer was wired into invoke-autodev + skills/_common; now also wired into five-whys).

Tag: `@integration` with the live lessons file + a synthetic stall context.

### AC-5: Documentation + ADR + constitution rule

**Given** v0.2.j ships
**When** the user reads `README.md`, `docs/adr/011-five-whys-escalation.md`, and `.specify/memory/constitution/ai-coding.md`
**Then**:
- README has `### Unblock mode (mmd unblock)` subsection under `## Usage`, explaining: when to invoke, what 5-Whys does, the 5 recommended actions, link to scoping §4 (Conductor)
- ADR-011 covers: why 5-Whys specifically (vs other root-cause methods), why BMAD Party Mode (multi-persona augments the why-chain better than single-persona), why composer integration (auto-inject lessons makes each session smarter than the last), why NO auto-execution in v0.2.j (Conductor concern v0.5+), the closed enum of recommended_action values + rationale
- `MAKE_MY_DREAMS.md` §4 (Conductor / Orchestrator) gets a paragraph noting v0.2.j delivered the stuck-recovery primitive
- `ai-coding.md` gets a new rule: "**Stuck-recovery**: when an agent run shows any stall signal (no commit > N min, retry count > M, recurring error pattern), do NOT retry blindly. Invoke `mmd unblock <slice>` to run a 5-Whys session. Apply the recommended action."

Tag: `@unit` for README + ADR + constitution anchor presence.

---

## 3. Architecture (incremental)

```
mmd unblock [<branch>] [--dry-run|--force]
   │
   ▼
[1] validate input (slice branch, git repo)
   │
   ▼
[2] detectStall(...) → { stalled, signals[], evidence }
   │
   ▼
[3] if --dry-run: print + exit. Else if not stalled and not --force: print + exit.
   │
   ▼
[4] buildFiveWhysContext(...) → StallContext
   │
   ▼
[5] runFiveWhys({ context, ... })
       → composeLessons injects matched lessons at top of prompt
       → spawn claude -p --output-format text with PATH=~/.bun/bin forced
       → tee to .mmd/local/five-whys-runs/<ts>.log
       → parse trailing JSON block → fallback escalate-to-user if invalid
   │
   ▼
[6] write .mmd/shared/5-whys/<ts>.md (full session log + parsed JSON)
   │
   ▼
[7] print summary + recommended_action + action_hint + exit with mapped code
```

### Project structure (additions only)

```
make-my-dreams/
├── bin/
│   ├── mmd.js                                # modified — unblock dispatch
│   └── conductor/
│       └── unblock.js                        # NEW
├── lib/
│   └── conductor/
│       ├── stall-detector.js                 # NEW
│       ├── stall-signals.js                  # NEW — closed enum + signal labels
│       ├── five-whys.js                      # NEW — session runner
│       ├── five-whys-prompt.js               # NEW — pure prompt builder (BMAD party mode template)
│       └── five-whys-parser.js               # NEW — pure JSON extraction
├── test/
│   ├── unit/
│   │   ├── stall-detector.test.js            # NEW
│   │   ├── stall-signals.test.js             # NEW
│   │   ├── five-whys-prompt.test.js          # NEW
│   │   ├── five-whys-parser.test.js          # NEW
│   │   └── unblock-argv.test.js              # NEW
│   ├── integration/
│   │   ├── unblock-dry-run.test.js           # NEW — fixture stuck slice + dry-run
│   │   ├── unblock-five-whys-fake.test.js    # NEW — fake-claude returning each action type
│   │   └── unblock-composer-injection.test.js # NEW — verify L-016 lessons injected on timeout-themed context
│   └── fixtures/
│       └── stuck-slices/                     # NEW
│           ├── timeout-stall/                # status.json + run.log mimicking L-016
│           ├── retry-loop/                   # status.json + log mimicking N retries on same op
│           ├── no-commit-30min/              # baseline stall
│           └── fresh-not-stalled/            # negative control
└── docs/adr/
    └── 011-five-whys-escalation.md           # NEW
```

---

## 4. Out of scope for v0.2.j

- ❌ Auto-trigger from a running Worker (Conductor concern, v0.5+).
- ❌ Auto-execution of the recommended action (Conductor concern, v0.5+).
- ❌ Multi-slice coordination (only diagnoses one slice).
- ❌ Mid-run intervention without explicit user invocation.
- ❌ Streaming of the 5-Whys session as it happens (the result is written at the end).
- ❌ Cross-project escalation chains.
- ❌ A "5 Whys" history that lets you ask "show me past stalls" — the per-session markdown files are the audit trail, no DB.

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation checks

1. Read SPEC_V02J.md (this file).
2. Read L-004, L-006, L-015, L-016 from `docs/lessons-learned.md`.
3. Read scoping §4 + §4.5 for the Conductor context.
4. Verify v0.2.7 composer functions are importable: `lib/composer/match.js` exposes `composeLessons`.
5. Verify v0.2.6 `_common/invoke-claude.js` exists as the canonical spawn pattern to mirror.

### Key risks to handle

- **JSON parse fallback is sacred**: if claude returns malformed JSON (which happens — they sometimes emit prose only), the runner MUST fall back to `recommended_action: "escalate-to-user"` with the parse error as evidence. Never crash, never assume well-formed output.
- **Composer integration**: import `composeLessons` from `lib/composer/match.js`. Pass `repoRoot + '/docs/lessons-learned.md'` as the lessons path. Honor `MMD_COMPOSER_DISABLED=1`.
- **PATH forcing**: same pattern as `lib/skills/_common/invoke-claude.js`. `env.PATH = $HOME/.bun/bin:` + parentEnv.PATH.
- **Fixture realism**: the "stuck slice" fixtures need real `.mmd/shared/status.json` shapes (mirror the actual schema written by here-mode). For "timeout-stall", use the L-016 reproduction (`engine_metrics.duration_seconds: 1800.6`, `state: "failed"`, last-commit-age > threshold).
- **Detector deterministic**: no `Date.now()` inside the pure function — inject a clock arg (default `Date.now`) for testability.
- **Don't run real claude in tests**: every test path uses `MMD_AUTODEV_CMD` style override or fixture stub.

### Apply lessons L-001..L-016

- **L-016 in particular**: this slice REQUIRES `MMD_TIMEOUT_MS=0` for its launch. The prompt should also be spec-frozen ("SPEC_V02J.md is AUTHORITATIVE and FROZEN, go directly to implementation"). The launch script must do both.
- **L-015**: the dream prompt references SPEC_V02J.md — verify file exists on base via `git show base:SPEC_V02J.md`.
- **L-004**: explicit DoD verification after auto-dev exits.
- All others as standard.

### Constitution module bindings

Active: universal, ai-coding (with the new stuck-recovery rule added), commit-git, testing, security, error-handling, documentation, observability. The new rule goes in `ai-coding.md` per AC-5.

---

## 6. Definition of done

v0.2.j is done when:

1. All 5 ACs met.
2. Full test suite passes (current 768 + new tests, expected ~830-860).
3. `mmd unblock --dry-run` on a fixture stuck slice prints signals + evidence + exit 8.
4. `mmd unblock --force` on a fixture slice with fake-claude returns each of the 5 action types (5 separate fixture tests).
5. The composer-injection integration test verifies L-016 keywords match a timeout-stall fixture and inject the rule.
6. README + ADR-011 + ai-coding.md rule in place.
7. `MAKE_MY_DREAMS.md` §4 paragraph noting v0.2.j delivery.
8. Version bumped to `0.2.8`.
9. Slice merged to main via `mmd ship` (or manual if ship has any issue).
10. Tag `v0.2.8` created.
11. `scripts/audit-pillars.sh main..HEAD` reports BMAD + gStack INVOKED ≥ 1 each (regression).
12. Seventh reflexive use of `mmd --here`. Capture L-017 if any new failure surfaces. The pattern is now established enough that "mmd --here is the supported workflow" can land in `commit-git.md` constitution (deferred to a future slice).

---

*Spec v0.2.j — generated 2026-05-18 from L-004/L-015/L-016 root-cause analysis + Sébastien's direct ask. Seventh reflexive use of mmd --here. After this lands, the next time auto-dev stalls (and there WILL be a next time), `mmd unblock` gives a structured root-cause + action in 2 min instead of 30 min of head-scratching.*
