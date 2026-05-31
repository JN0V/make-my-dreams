# Make My Dreams — v0.2.n Spec: WIP-salvage stall signal + composer regression-lock (L-019 closure)

> Two L-019 candidates close here. **(a) Composer migration accuracy** turned out to be already-resolved: forensic reproduction (2026-05-31) showed L-015 *does* match the composer today under a `mmd --here` context (score=2, hits `prompt-grounding` + `conductor`). The v0.2.h-launch miss was a *temporal* gap — at that time the composer passed no invocation context and L-015 had no `Applies to` field; both shipped later in v0.2.l (`fda5665` + `451e6e1`), closing it incidentally. There is no live bug to fix, so (a) reduces to a **regression-lock test** that pins this behavior so it can never silently regress. **(b) WIP-salvage stall signal** is real and unbuilt: when an auto-dev run is killed mid-flight it can leave a large uncommitted working tree, and today the rescue is a manual `git stash push`. v0.2.n adds a new `wip-uncommitted-since-N-min` stall signal to the closed enum + detector, wired through `mmd unblock` so the 5-Whys session sees it and recommends `escalate-to-user` with stash-salvage guidance. This makes L-019 prevention (commit-incrementally-per-AC) **code-detectable** instead of prompt-only.

---

## 1. Goal of v0.2.n

Two narrow, independent deliverables:

1. **WIP-salvage stall signal (candidate b)** — a sixth-plus-one entry in the stall-signal closed enum: `wip-uncommitted-since-N-min`. The detector emits it when the slice worktree has uncommitted changes (`git status --porcelain` non-empty) **and** the last commit on the slice branch is older than a threshold (`MMD_STALL_WIP_UNCOMMITTED_MIN`, default 15 min). The signal reuses the existing `lastCommitAgeMin` evidence and adds a `worktreeDirty` boolean + a `wipUncommittedMin` derived age. It flows automatically through `mmd unblock` into the 5-Whys session, whose closed-action set already contains `escalate-to-user` (the sacred fallback). The unblock prompt gains a hint: when this signal fires, recommend `escalate-to-user` with explicit `git stash push -u` salvage instructions.

2. **Composer regression-lock (candidate a)** — a test (no production change) asserting that `composeLessons`, given `context: { subcommand: 'mmd --here' }` and a prompt containing both "Conductor" and "prompt-grounding", injects L-015. Reads the real `docs/lessons-learned.md` so it is a true regression guard against an inaccurate future `Applies to` migration or a matching-logic change.

**Non-features** (deliberately deferred):
- Tracking a precise "dirty-since" timestamp. Git does not record when the tree became dirty; v0.2.n derives WIP age from `lastCommitAgeMin` (dirty tree + last commit N min ago ⇒ WIP has been uncommitted ≥ N min). A precise tracker would need conductor-side bookkeeping in `status.json` — a future slice.
- Auto-stashing on detection. v0.2.n only *detects + recommends*; the actual `git stash push` stays a human (or 5-Whys-recommended) action. No automatic mutation of a user's worktree.
- A broader composer migration-accuracy *audit* (`mmd lessons audit` flagging lessons whose keywords match a context their `Applies to` excludes). Considered and explicitly deferred — (a) is already-resolved, so only the regression-lock is in scope.
- Promotion of the L-018 META-rule (scale assumptions in Out-of-scope) to `ai-coding.md` — its own note defers it to "when v0.5b Documentalist exists".

**Why this exists**: L-019 was surfaced when a v0.2.k auto-dev run was killed mid-run leaving large uncommitted WIP, rescued manually with `git stash push`. The prevention rule ("commit incrementally per AC") currently lives only in launch prompts. A stall signal makes the *failure of that rule* observable: if auto-dev stops committing yet the tree keeps changing, the detector flags it and `mmd unblock` routes it to a human before work is lost. Candidate (a) rides along as a cheap regression-lock now that the forensic conclusion is known.

**Mission validation**: after v0.2.n, `mmd unblock <slice> --dry-run` on a slice with a dirty tree and a stale last commit lists `wip-uncommitted-since-N-min` among its signals with `worktreeDirty: true` + a numeric `wipUncommittedMin` in evidence; and the composer regression test guards L-015's `mmd --here` match in CI.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `wip-uncommitted-since-N-min` joins the closed signal enum

**Given** the closed stall-signal vocabulary in `lib/conductor/stall-signals.js`
**When** the module is loaded
**Then**:
- `STALL_SIGNALS` includes the new label `wip-uncommitted-since-N-min`
- `isStallSignal('wip-uncommitted-since-N-min')` returns `true`
- `unknownSignals(['wip-uncommitted-since-N-min'])` returns `[]`
- The enum remains frozen and every other existing signal is unchanged (no removals, no reordering that breaks the detector's canonical-order filter)

Tag: `@unit`.

### AC-2: Detector emits the signal on a stale, dirty worktree

**Given** a slice branch whose last commit is older than `MMD_STALL_WIP_UNCOMMITTED_MIN` (default 15 min) **and** an injected worktree-status function reporting the tree as dirty
**When** `detectStall({ ... })` runs
**Then**:
- `evidence.worktreeDirty === true`
- `evidence.wipUncommittedMin` is a finite number ≈ `lastCommitAgeMin` (derived: dirty tree + last-commit age)
- `signals` includes `wip-uncommitted-since-N-min`, emitted in canonical enum order
- A new injectable `gitWorktreeDirtyFn(repoRoot, sliceBranch)` is honored (defaults to a `git status --porcelain` spawn that returns a boolean); like the other git accessors it NEVER throws — failure produces `worktreeDirty: null` + an `evidence.errors[]` entry, not a crash
- **Negative case**: a *clean* tree (status function returns `false`) produces `worktreeDirty: false`, `wipUncommittedMin: null`, and NO `wip-uncommitted-since-N-min` signal — even when the last commit is stale (a clean stale branch is the legitimate "no-commit-since-N-min" case, not a WIP-loss risk)
- **Boundary**: a dirty tree whose last commit is *younger* than the threshold does NOT raise the signal (recent work in progress is healthy, not stalled)

Tag: `@unit` (injected clock + injected git accessors, no real filesystem/git).

### AC-3: Threshold + env override

**Given** `resolveThresholds` in `lib/conductor/stall-detector.js`
**When** resolved with and without `MMD_STALL_WIP_UNCOMMITTED_MIN` set
**Then**:
- `DEFAULT_THRESHOLDS.wipUncommittedMin === 15`
- `MMD_STALL_WIP_UNCOMMITTED_MIN=25` ⇒ resolved `wipUncommittedMin === 25`
- A non-numeric / empty env value falls back to the default (same tolerance as the existing `num()` helper)
- An explicit `thresholds.wipUncommittedMin` override arg beats the env (defaults < env < arg, matching the existing precedence)

Tag: `@unit`.

### AC-4: Signal flows through `mmd unblock` into the 5-Whys session

**Given** a stalled slice that raises `wip-uncommitted-since-N-min`
**When** `mmd unblock <slice> --dry-run` runs (detector only, no spawn)
**Then**:
- The `--dry-run` output lists `wip-uncommitted-since-N-min` among the detected signals and prints `worktreeDirty` + `wipUncommittedMin` in the evidence block
- The signal appears in the `## Stall signals` section of the rendered session markdown
- The new signal is listed in the `mmd unblock --help` "Stall signals (closed enum)" block (it iterates `STALL_SIGNALS`, so this is automatic — assert it shows)
- **5-Whys hint**: when this signal is present, the prompt passed to the 5-Whys session includes guidance that `escalate-to-user` is the appropriate action and that the salvage step is `git stash push -u -m "wip-salvage <slice>"`. The closed-action set is unchanged; the sacred unparseable-output fallback to `escalate-to-user` remains intact (L-016 / ADR-011)

Tag: `@integration` (fake 5-Whys runner, no real `claude -p` spawn — mirror `test/integration/unblock-five-whys-fake.test.js`).

### AC-5: Composer regression-lock for L-015 (candidate a)

**Given** the real `docs/lessons-learned.md` and the production composer (`lib/composer/match.js`)
**When** `composeLessons(prompt, lessonsPath, { context: { subcommand: 'mmd --here' } })` runs with a prompt containing both "Conductor" and "prompt-grounding"
**Then**:
- The injected lessons include `L-015`
- L-015 is NOT filtered out by the context filter (its `Applies to` includes `mmd --here`)
- The test documents (in a comment) that this guards the v0.2.l fix (`451e6e1` + `fda5665`) against a future inaccurate `Applies to` migration or matching-logic regression
- No production code changes for candidate (a) — this AC is satisfied by the test alone

Tag: `@integration` (reads the real lessons file so it is a true end-to-end regression guard).

### AC-6: Documentation + ADR + lesson log

**Given** v0.2.n ships
**When** the user reads the docs
**Then**:
- `docs/adr/018-wip-uncommitted-stall-signal.md` is added, covering: why derive WIP age from `lastCommitAge` + dirty-tree rather than a precise dirty-since timestamp (KISS, no conductor bookkeeping yet); why detect-and-recommend rather than auto-stash (never mutate a user's worktree automatically); why `escalate-to-user` is the recommended action; and how this makes the L-019 prevention rule code-detectable
- `docs/lessons-learned.md` gains a formal **L-019** entry (status active) describing the WIP-loss-on-kill pattern, the prevention rule, the new signal, and `Category` / `Applies to` / `Keywords for matching` fields consistent with the v0.2.l migration
- `README.md` (or the relevant conductor/unblock doc) mentions the new signal in its stall-signal list
- The composer regression-lock rationale (candidate a forensic conclusion) is captured in the ADR or the L-019 entry so the "already-resolved" finding is not lost

Tag: `@unit` for README/ADR/lesson anchor presence.

---

## 3. Architecture (incremental)

```
Conductor stall path (modified):
  lib/conductor/stall-signals.js   — closed enum + 'wip-uncommitted-since-N-min' (NEW label)
  lib/conductor/stall-detector.js  — DEFAULT_THRESHOLDS.wipUncommittedMin + env + detection block
                                      + injectable gitWorktreeDirtyFn (default: git status --porcelain)
  bin/conductor/unblock.js         — 5-Whys prompt hint when wip signal present (help block is automatic)

Composer path (test-only):
  lib/composer/match.js            — UNCHANGED (candidate a is already-resolved)
```

### Files modified / added

```
make-my-dreams/
├── lib/conductor/
│   ├── stall-signals.js                          # modified — add enum label
│   └── stall-detector.js                         # modified — threshold + env + detection + git accessor
├── bin/conductor/
│   └── unblock.js                                # modified — 5-Whys hint for wip signal
├── test/
│   ├── unit/
│   │   ├── stall-signals.test.js                 # modified — enum membership for new label
│   │   └── stall-detector.test.js                # modified — AC-2 + AC-3 detection/threshold cases
│   └── integration/
│       ├── unblock-wip-salvage.test.js           # NEW — AC-4 dry-run + session markdown + hint
│       └── composer-l015-regression.test.js      # NEW — AC-5 regression-lock
├── docs/
│   ├── lessons-learned.md                        # modified — formal L-019 entry
│   └── adr/018-wip-uncommitted-stall-signal.md   # NEW
├── README.md                                     # modified — signal list mention
└── package.json                                  # modified — version 0.2.14
```

---

## 4. Out of scope for v0.2.n

- ❌ Precise "dirty-since" timestamp tracking (needs conductor-side `status.json` bookkeeping — future).
- ❌ Auto-stashing on detection (never mutate a worktree automatically; detect + recommend only).
- ❌ A broader `mmd lessons audit` migration-accuracy check (candidate a is already-resolved; only the regression-lock is in scope).
- ❌ L-018 META-rule promotion to `ai-coding.md` (deferred to v0.5b Documentalist per its own note).
- ❌ Any production change to the composer (`lib/composer/*`) — candidate (a) is test-only.
- ❌ **Scale assumption**: the dirty-tree check runs one `git status --porcelain` per `unblock` invocation — fine at MMD's one-slice-at-a-time scale. Parallel multi-slice stall scanning (many worktrees) would need batching; out of scope.

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation
1. Read SPEC_V02N.md (this file).
2. Read `lib/conductor/stall-detector.js` — note the injectable-accessor pattern (`gitLastCommitEpochFn`, `readFileFn`, `readRunLogsFn`) and the canonical-order emit at the end of `detectStall`. Add `gitWorktreeDirtyFn` the same way (default a `git status --porcelain` spawn returning boolean, never throwing).
3. Read `lib/conductor/stall-signals.js` — append the new label; do not reorder existing entries (the detector filters `STALL_SIGNALS` for canonical order).
4. Read `bin/conductor/unblock.js` `renderSessionMarkdown` + the `detectStall` call + the 5-Whys prompt build, and `test/integration/unblock-five-whys-fake.test.js` for the fake-runner pattern.
5. Read `lib/composer/match.js` `composeLessons` + the L-015 entry in `docs/lessons-learned.md` (do NOT edit either for AC-5).

### Key risks
- **WIP-age derivation**: the signal fires on `worktreeDirty === true && lastCommitAgeMin > wipUncommittedMin`. If `lastCommitEpoch` is null (fresh branch, no commits) treat WIP age as null and do NOT fire (a never-committed slice is a different state). Keep `wipUncommittedMin` evidence null in that case.
- **Never throw**: `gitWorktreeDirtyFn` failure → `worktreeDirty: null` + `evidence.errors[]` push, exactly like the `gitLastCommitEpochFn` catch. The detector must always return a well-formed result.
- **Don't double-count**: a dirty stale branch will raise BOTH `no-commit-since-N-min` and `wip-uncommitted-since-N-min`. That's intended (different remedies), but make sure the canonical-order filter emits each once.
- **Sacred fallback**: the 5-Whys hint is additive prompt text only. Do NOT add a new closed action or hardcode an action for this signal — `escalate-to-user` is reached through the existing parser path (ADR-011, L-016).
- **AC-5 is test-only**: resist "improving" the composer. The forensic conclusion is that it already works; the test locks it.

### Apply L-001..L-019 (and the promoted L-002/L-016 in ai-coding.md)
All standard. Particularly:
- **L-016**: launch with `MMD_TIMEOUT_MS=0` + spec-frozen.
- **L-019 (this slice's subject)**: commit incrementally per AC — and note the irony/fitness that this slice *builds the detector for the very failure of this rule*.
- **L-015**: SPEC_V02N.md is verified on base by v0.2.h's prompt-grounding check.

### Constitution module bindings
Active: universal, ai-coding (includes promoted L-002/L-016), commit-git, testing, error-handling (the never-throw accessor contract), documentation.

---

## 6. Definition of done

v0.2.n is done when:

1. All 6 ACs met.
2. Full test suite passes (current 1025 + new tests, expected ~1040-1055).
3. `mmd unblock <slice> --dry-run` on a dirty, stale slice lists `wip-uncommitted-since-N-min` with `worktreeDirty: true` + numeric `wipUncommittedMin`.
4. Composer regression test guards L-015's `mmd --here` match against the real lessons file.
5. README + ADR-018 + L-019 lesson entry in place.
6. Version bumped to `0.2.14`.
7. Slice merged (ff-only) + tag `v0.2.14`.
8. 13th reflexive use of `mmd --here`. Composer should match L-015 + L-019 + the conductor/stall lessons with high confidence.

---

*Spec v0.2.n — drafted 2026-05-31. L-019 closed: WIP-loss-on-kill is now a detectable stall signal routed to a human via `mmd unblock`; the composer's L-015 match is regression-locked after the forensic finding that candidate (a) was already-resolved in v0.2.l. 13th reflexive use of mmd --here.*
