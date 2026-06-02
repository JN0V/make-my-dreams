# Make My Dreams — v0.9.0 Spec: close the autolearning loop (validated-reuse counter + LLM promotion gate)

> *(Autolearning, differentiator #2, §6.5 — NOT the roadmap's "v0.9 parallel Conductor"; just the next free minor.)*
>
> **The gap (ADR-010, in MMD's own words):** the composer injects lessons by keyword (v0.2.e) and `mmd document-lessons` already mutates the `**To promote if**: N (counter: c)` lines and auto-promotes a lesson into a constitution module when `counter ≥ N` (it auto-promoted L-002/L-016). **But the counter is incremented by raw INJECTIONS** (`mutateCounters: counter + injCount`) — "the composer matching keywords is not the same as a validated re-use" (ADR-010). So a lesson that merely appeared in prompts climbs toward promotion without evidence it ever *helped*. ADR-010 named the Documentalist (now BUILT) as the piece that closes this.
>
> **The fix (the hybrid Sébastien chose):** make the counter rise on a **deterministic validated-reuse** signal — a lesson **injected into a run that completed successfully (`status.json.state === 'done'`)**, counted **once per run** — instead of raw injections (cheap, always-on, reproducible; a weak-but-honest proxy). Then, because promoting into MMD's **own constitution** is a heavy, rule-changing act, gate the **promotion** itself behind an **LLM/Documentalist validation**: when a lesson reaches its threshold, a judge reviews the reusing runs and confirms the lesson's rule was genuinely applicable + honored; only then promote. **Uncertain / not-validated → the lesson stays in `lessons-learned.md` (the sacred fallback — never a fabricated promotion).** Deterministic where it's cheap, LLM where it matters.
>
> Scope = the **counter signal swap** + the **promotion validation gate**. **Archival** (a lesson unused for M months → archived, no longer injected) is the §6.5 tail and a deferred follow-up.

---

## 1. Goal of v0.9.0

```
composer injects L-019 into a run  →  run completes state=done  →  +1 validated reuse for L-019 (deduped per run)
                                       run completes state=failed →  no increment

L-019 counter reaches its `To promote if: N`  →  Documentalist/judge VALIDATES across the reusing runs:
    "was L-019's rule genuinely applicable + honored in these runs?"
      VALIDATED   → promote into the constitution module (existing document-lessons promotion) + remove from lessons-learned.md
      UNCERTAIN / NOT-VALIDATED → HOLD in lessons-learned.md (counter stays; never a fabricated promotion — sacred fallback)
```

Deliverables:
1. **Deterministic validated-reuse counter** (`lib/autolearn/validated-reuse.js`, pure): given the per-run composer-audit records (each: the injected lesson ids + that run's outcome state) → a per-lesson **validated-reuse count** = number of **distinct runs** in which the lesson was injected **AND** the run reached `state === 'done'`. Pure, deterministic, never throws; a run with no outcome / a failed run contributes nothing; dedup is per-run (one run = at most +1 per lesson).
2. **Wire the new signal into the counter** (`bin/documentalist/document-lessons.js` + `lib/composer/usage-stats.js` / `lib/documentalist/mutate-counters.js`): `document-lessons` increments each lesson's `counter` by its **validated reuses since the last run**, NOT by raw injection count. The run-outcome needed to compute it is recorded durably (see hint 3) so the count is reproducible and only-counts-once-per-run across repeated `document-lessons` runs (idempotent — no double-counting a run already credited).
3. **LLM promotion-validation gate** (`lib/autolearn/promote-gate.js` + wiring): before `document-lessons` promotes a lesson that reached threshold, an **injected** Documentalist/judge pass (the `claude -p` seam, like the v0.4.d judge) reviews the lesson's rule + the reusing runs and returns `validated | not-validated | uncertain`. **Only `validated` proceeds to promotion**; `not-validated`/`uncertain`/unparseable → the lesson is **held** (stays active, counter preserved, an honest note logged) — never promoted on a fabricated/绝 unparseable verdict. `--dry-run` shows the plan (which lessons hit threshold + the gate verdicts) without writing.
4. **Honest reporting**: `mmd document-lessons` and `mmd lessons` distinguish **injection count** (raw, today's column) from **validated-reuse count** (the new promotion signal) so the two are never conflated again (the ADR-010 confusion, surfaced in the UI).
5. **Docs + ADR**: the closed loop (deterministic counter + LLM gate), why injections were the wrong signal (ADR-010), the sacred-fallback on the gate, archival deferred.

**Mission validation**: a lesson injected into 5 distinct `done` runs reaches its threshold on the **validated-reuse** count (not inflated by re-injections within one run or by failed runs); at threshold, the LLM gate runs — a genuinely-applied lesson is promoted into its constitution module, an unproven/uncertain one is **held** in `lessons-learned.md` with an honest note. Re-running `document-lessons` does not double-count an already-credited run. `mmd lessons` shows injection vs validated-reuse distinctly.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: deterministic validated-reuse counter (pure)
**Given** per-run records `[{ runId, injectedLessonIds: [...], state }]`
**When** `validatedReuses(records)` runs
**Then**: it returns per-lesson the count of **distinct runs** where the lesson was injected AND `state === 'done'`; a `failed`/missing-state run contributes 0; multiple injections within one run count once; pure, deterministic, never throws; empty/odd input → empty result.
Tag: `@unit` (done vs failed vs missing; per-run dedup; multiple lessons).

### AC-2: the counter rises on validated reuses, not raw injections (idempotent)
**Given** composer audits + run outcomes
**When** `mmd document-lessons` updates `lessons-learned.md`
**Then**: each active lesson's `counter` increases by its **validated reuses not yet credited** (a run already counted in a prior `document-lessons` run is NOT counted again — idempotent, via a durable "credited runs" record); raw injection count NO LONGER drives the counter. A lesson injected only into failed runs gets **no** increment. `--dry-run` prints the deltas without writing.
Tag: `@unit` (mutate logic on validated-reuse input; already-credited run not re-counted) + `@integration` (document-lessons on a fixture lessons file + fixture audits/outcomes).

### AC-3: LLM promotion-validation gate (sacred fallback)
**Given** a lesson whose `counter` reaches its `To promote if: N`
**When** `document-lessons` considers promoting it
**Then**: an **injected** judge (`claude -p` seam, e.g. `MMD_PROMOTE_GATE_CMD`) reviews the lesson + its reusing runs and returns `validated | not-validated | uncertain`; **only `validated` promotes** (append to the constitution module + remove from `lessons-learned.md`, the existing flow); `not-validated`/`uncertain`/unparseable → the lesson is **HELD** (stays active, counter preserved, an honest "held: gate <verdict>" note) — a fabricated or unparseable verdict NEVER promotes. With the gate command absent, the slice's tests use the seam; document-lessons does not promote on a missing gate (honest: it reports "promotion gate unavailable — holding").
Tag: `@unit` (gate parse: validated→promote, not-validated/uncertain/garbage→hold) + `@integration` (threshold lesson + fake gate: validated promotes, uncertain holds).

### AC-4: injection vs validated-reuse surfaced honestly
**Given** `mmd lessons` / `mmd document-lessons` output
**When** read
**Then**: the **raw injection count** (today's column) and the **validated-reuse count** (the promotion signal) are shown as **distinct** values, clearly labelled, so they are never conflated (the ADR-010 confusion made visible). The existing `mmd lessons` behavior is otherwise back-compat.
Tag: `@unit`/`@integration` (both numbers present + labelled).

### AC-5: docs + ADR
**Given** v0.9.0 ships
**When** docs are read
**Then**: a new ADR documents the closed autolearning loop — validated reuse = injected-into-a-`done`-run (deterministic proxy) vs raw injections (ADR-010's wrong signal); the LLM promotion gate + the sacred fallback (uncertain → hold, never fabricate a constitution change); idempotent per-run crediting; archival deferred. `README.md` + `CLAUDE.md` note the closed loop. `mmd document-readme --tests N` + `mmd handover --tests N` refresh.
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/autolearn/validated-reuse.js   NEW — pure validatedReuses(records) → per-lesson done-run reuse count (per-run dedup)
lib/autolearn/promote-gate.js      NEW — pure parse of a judge verdict (validated|not-validated|uncertain; unparseable→uncertain) + the prompt builder
lib/composer/usage-stats.js        MODIFY — also surface validated-reuse counts (read run outcomes alongside injection audits)
lib/composer/audit.js              MAYBE — stamp a runId/sliceId so an audit can be tied to its run outcome (durable correlation)
lib/documentalist/mutate-counters.js  MODIFY — increment by validated reuses (not injCount); track credited runs (idempotent)
bin/documentalist/document-lessons.js MODIFY — feed validated reuses; run the promote-gate before promoting; hold on non-validated
bin/mmd.js (runHereMode completion) MAYBE — record the run's {runId, injectedLessonIds, state} durably so the counter is reproducible
bin/lessons.js                     MODIFY — show injection vs validated-reuse columns distinctly
docs/adr/0NN-*.md  NEW · README.md / CLAUDE.md / HANDOVER.md / package.json  MODIFY — 0.9.0
```

### Files modified / added
```
make-my-dreams/
├── lib/autolearn/{validated-reuse,promote-gate}.js          # NEW — pure counter + pure gate parse/prompt
├── lib/composer/usage-stats.js                              # modified — validated-reuse alongside injections
├── lib/documentalist/mutate-counters.js                     # modified — increment by validated reuses, idempotent
├── bin/documentalist/document-lessons.js                    # modified — gate before promote, hold on non-validated
├── bin/lessons.js                                           # modified — injection vs validated-reuse columns
├── bin/mmd.js / lib/composer/audit.js                        # modified (if needed) — durable run-outcome correlation
├── test/unit/autolearn-{validated-reuse,promote-gate}.test.js  # NEW — AC-1/AC-3
├── test/integration/document-lessons-validated-reuse.test.js   # NEW — AC-2/AC-3/AC-4
├── docs/adr/0NN-autolearning-loop-closed.md                 # NEW
├── README.md / CLAUDE.md / HANDOVER.md                       # modified
└── package.json                                             # modified — 0.9.0
```

---

## 4. Out of scope for v0.9.0 (→ follow-ups)
- ❌ **Archival** (lesson unused M months → archived, composer skips it) — the §6.5 tail; a focused follow-up.
- ❌ **Stronger validated-reuse than "done run"** (e.g. "the run had a Phase-4 finding in L's category that L would have prevented") — the `done`-run proxy is the honest first cut; the LLM gate covers the rigor at promotion. A richer per-run signal is a later refinement.
- ❌ **Auto-running `document-lessons` on every slice** (event-driven) — stays a manual/operator step for now.
- ❌ **Scale assumption**: dozens of lessons, hundreds of run audits — a bounded scan.

## 5. Implementation hints (for auto-dev)
1. Read this SPEC + ADR-010 (the wrong-signal diagnosis) + `lib/documentalist/mutate-counters.js` (today's `counter + injCount` — the line to change), `bin/documentalist/document-lessons.js` (the promotion flow to gate), `lib/composer/{audit,usage-stats}.js` (the injection audits — `matched:[{id}]` + `context` + `ts`), and the v0.4.d judge (`lib/sealed-tests/judge.js`) for the injected-`claude -p` gate pattern + the sacred uncertain-fallback.
2. The correlation (injection ↔ run outcome) is the crux: the composer.json records WHICH lessons were injected but NOT the run's final state (it's written at injection time). Pick a durable, reproducible mechanism — e.g. stamp a `runId`/`sliceId` in the composer.json and have the run-completion path record `{runId, state}` (or write a `reuse-event` when a run reaches `done`), then `validatedReuses` joins them. Keep it idempotent (a run credited once stays credited — a "credited runs" set).
3. The gate is where the constitution gets changed — treat it like the v0.4.d judge: injected seam, parse to `validated|not-validated|uncertain`, **unparseable → uncertain → HOLD**, never promote on anything but an explicit `validated`. Promotion is irreversible-ish (edits the constitution + deletes the lesson) — the gate MUST be conservative.
4. Idempotency + honesty: re-running `document-lessons` must not double-count a run; a held lesson logs WHY (gate verdict); `--dry-run` shows the full plan.
5. Operational rules for the slice launch: `MMD_TIMEOUT_MS=0`, commit incrementally per AC, spec-frozen directive; do NOT cite a to-be-created `docs/adr/*.md` path literally.
6. Constitution bindings: universal (§I SRP — pure counter + pure gate vs the I/O command, §VI honesty — the sacred fallback + injection-vs-reuse distinction, §VII), ai-coding (§I honest AI failure, §V verification), commit-git, testing (tag every test; red-green; done/failed/idempotent + gate-verdict fixtures), error-handling (pure fns never throw; gate-absent → honest hold), documentation, security (promotion changes the constitution — conservative gate), observability (the audit trail).

## 6. Definition of done
1. All 5 ACs met (AC-3 the sacred-fallback gate is the safety gate).
2. Full suite passes (current 1817 + new tests).
3. The lesson counter rises on validated reuses (injected-into-a-`done`-run, per-run-deduped, idempotent), not raw injections; at threshold the LLM gate decides; `validated`→promote, else **hold** (never a fabricated constitution change). `mmd lessons` shows injection vs validated-reuse distinctly.
4. README + CLAUDE.md + the new ADR in place; `mmd document-readme --tests N` + `mmd handover --tests N` run.
5. Version bumped to `0.9.0`.
6. Slice merged (ff-only) + tag `v0.9.0`.
7. The autolearning loop is CLOSED on the differentiator #2: lessons climb toward the constitution on evidence (validated reuse), not mere mention, and the irreversible promotion is LLM-gated with a sacred fallback. Archival is the remaining §6.5 tail.

---

*Spec v0.9.0 — close the autolearning loop: the lesson counter rises on a deterministic validated-reuse signal (injected into a `done` run, per-run-deduped, idempotent) instead of raw injections (ADR-010's wrong signal), and promotion into the constitution is gated by an injected LLM/Documentalist validation with the sacred uncertain→hold fallback (never a fabricated rule change). The Documentalist finally closes differentiator #2. Archival deferred.*
