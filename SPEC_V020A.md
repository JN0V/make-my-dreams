# Make My Dreams — v0.20.0 Spec (slice v0.20.a): fix the alignment-gate oracle leak (per-dream expectation, not write-once-forever)

> *(Found live during the v0.19.a merge, 2026-06-05. The `mmdream document` orchestrator slice came back `state=done` with the v0.11/v0.17 alignment gate reporting "all ACs met" — but the judge was grading the **v0.18.a** ACs, not the orchestrator's. Caught only by a manual cross-check. This is the exact [[always-verify-live]] trap: a green gate that verified nothing.)*
>
> **The bug:** the v0.17 "align to the ORIGINAL expectation" gate (`lib/conductor/expectation.js` `writeExpectation`, wired in `bin/mmd.js` ~L689) freezes `.mmd/shared/expectation.md` at run start and is **write-once: if the file exists, it no-ops**. The intent was anti-drift — a resume must not move the goalposts. **The flaw: it never checks whether the existing oracle is for the SAME dream.** `.mmd/shared/` persists across slices on a repo, so a genuinely-NEW dream finds the PRIOR slice's `expectation.md` and the semantic judge (`resolveAlignmentAnchor`) grades the new work against the OLD dream's criteria — which "pass" because the prior slice was merged into this slice's base. **The gate gives zero real verification.**
>
> **Impact:** until fixed, no "done" on a repo that already ran a prior slice is trustworthy — every slice is graded against whichever dream first wrote the oracle. This defeats the entire v0.17 guarantee.
>
> **The fix:** distinguish a **new dream** from a **resume of the same dream**. Stamp a dream identity into `expectation.md`; on run start, if the existing oracle's dream ≠ the current dream AND this is **not** a resume → **overwrite** (a fresh oracle for the new dream). Same dream, OR an explicit resume → **preserve** (anti-drift intact — the goalposts still cannot move within one dream). A resume whose recovered dream mismatches the frozen oracle → an **honest warning**, never a silent wrong-grade.
>
> Stays **pure-core + injected-edge** (the conductor shape), **never throws**, **KISS** (a dream-id stamp + a three-way decision; no new dependency — Node's built-in `crypto` for the hash).

---

## 1. Goal of v0.20.a

```
mmdream --here "<NEW dream>"   (no --resume, on a repo with a stale expectation.md from a prior slice)
   → expectation.md is OVERWRITTEN with the NEW dream → the alignment gate grades THIS dream. (the fix)

mmdream --here --resume         (auto-handoff successor or manual resume, SAME dream)
   → expectation.md is PRESERVED → anti-drift intact, goalposts unmoved.

mmdream --here "<same dream re-run>" (no --resume, oracle already this dream)
   → expectation.md PRESERVED (same dream) → anti-drift intact.

resume whose recovered dream ≠ the frozen oracle's dream
   → honest warning logged; oracle kept (resume never moves goalposts); the mismatch is never silent.
```

Deliverables:
1. **Stamp a dream identity into the oracle** (`lib/conductor/expectation.js`): `buildExpectationContent` adds a stable, machine-readable `dream-id` line (a short `sha256` of the normalized dream, via Node's built-in `crypto` — zero new dep) near the top, keeping the human-readable dream text below it (universal §VII). A pure `expectationDreamId(dream)` (normalize → hash, never throws) + a pure `readExpectationDreamId(content)` (extract the stamped id, null when absent/malformed) are exported.
2. **Per-dream write logic** (`writeExpectation`): given the injected fs seam + a `readFileSync` (or `readExpectation`) reader + an `isResume` boolean, decide three-way (pure helper `decideExpectationWrite({existing, currentDreamId, isResume})` → `write-fresh | preserve | preserve-with-mismatch-warning`): no existing file → write; existing oracle's id === current → preserve (same dream / re-run); existing id !== current AND not resume → **overwrite** (new dream); existing id !== current AND resume → preserve **but** flag `mismatch:true` so the caller warns. Never throws; any read/parse error degrades to the safe "treat as same / preserve" with an honest reason (the gate must never crash a run).
3. **Wire `isResume` + the warning** (`bin/mmd.js` ~L689 and the greenfield path): pass whether the launch is a resume (the existing `--resume` flag / the auto-handoff successor's resume relaunch) into `writeExpectation`; on `write-fresh` for a new dream over a stale oracle, log "New dream — wrote a fresh alignment oracle (previous oracle was for a different dream)"; on `preserve-with-mismatch-warning`, log an honest "⚠️ resume dream differs from the frozen oracle — keeping the original oracle; verify this is the intended resume". The auto-handoff successor (same dream, resume) preserves correctly.
4. **Regression lock — the exact v0.19 bug** (`test/...`): two DIFFERENT dreams in sequence on the same `.mmd/shared/` → the second run's `expectation.md` holds the SECOND dream (not the first); `resolveAlignmentAnchor` returns the second dream's oracle. A resume of the same dream → the oracle is unchanged (anti-drift). A resume with a mismatched dream → preserved + the mismatch flag set.
5. **Docs + ADR + version**: ADR-059 (the leak, the per-dream-vs-resume fix, why anti-drift is still intact within a dream, the auto-handoff-successor case); README + CLAUDE.md note; mechanical blocks; version → 0.20.0. **AC-live:** none required beyond the deterministic regression (the bug is fully reproducible without a live LLM — the fix is in pure write logic); optionally capture that a fresh new-dream run logs the "wrote a fresh oracle" line.

**Mission validation**: a new dream on a repo that already ran a prior slice now grades against ITS OWN expectation (the v0.19 bug cannot recur); a resume / auto-handoff successor still preserves the frozen oracle (the v0.17 anti-drift guarantee survives within a dream); a mismatched resume warns honestly instead of silently grading the wrong dream. The alignment gate verifies the right thing again.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: dream-id stamp (pure)
**Given** a dream
**When** `buildExpectationContent(dream, scope)` runs
**Then**: the output carries a stable machine-readable `dream-id` line (sha256 of the normalized dream) AND the human-readable dream text; `expectationDreamId(dream)` is deterministic + never throws (odd/empty → a stable id for ""); `readExpectationDreamId(content)` round-trips the stamp and returns null when absent/malformed.
Tag: `@unit` (stamp present + round-trips; deterministic; null-safe).

### AC-2: three-way write decision (pure)
**Given** an existing oracle's id, the current dream id, and `isResume`
**When** `decideExpectationWrite({existing, currentDreamId, isResume})` runs
**Then**: no existing → `write-fresh`; same id → `preserve`; different id & not resume → `write-fresh` (overwrite); different id & resume → `preserve` with `mismatch:true`. Pure, never throws, unknown input → a safe `preserve`.
Tag: `@unit` (all four branches + null-safe).

### AC-3: `writeExpectation` overwrites on a new dream, preserves on resume/same-dream
**Given** a `.mmd/shared/` with an existing `expectation.md` for dream A
**When** `writeExpectation` runs for dream B with `isResume:false`
**Then**: the file is overwritten with dream B (returns `{written:true, reason:'new dream'}`); for dream A again, or any dream with `isResume:true`, it is preserved (`{written:false}`), a resume+mismatch sets `mismatch:true`. Never throws (write/read error → honest `{written:false, reason}`).
Tag: `@unit` (overwrite-on-new; preserve-on-same; preserve-on-resume; mismatch flag; error degrades).

### AC-4: regression — the exact v0.19 leak cannot recur
**Given** two DIFFERENT dreams run in sequence against the same shared dir (non-resume)
**When** the second run freezes its expectation
**Then**: `expectation.md` holds the SECOND dream and `resolveAlignmentAnchor` returns the second dream's oracle (NOT the first). A same-dream resume leaves the oracle byte-for-byte unchanged.
Tag: `@integration`/`@unit` (the two-different-dreams sequence; the resume-preserves case).

### AC-5: wiring + honest logging (no silent wrong-grade)
**Given** the `bin/mmd.js` run-start freeze
**When** a new dream overwrites a stale oracle / a mismatched resume preserves one
**Then**: the new-dream overwrite logs a clear "wrote a fresh oracle" line; the mismatched-resume preserves + logs an honest ⚠️ warning; the auto-handoff successor (same dream, resume) preserves silently as today. The `--resume` / successor resume state is correctly threaded as `isResume`.
Tag: `@integration` (new-dream → fresh-oracle log; resume → preserved; mismatch → warning).

### AC-6: docs + version
**Then**: ADR-059 lands; README + CLAUDE.md note the per-dream oracle + the preserved anti-drift; mechanical blocks; version → 0.20.0.
Tag: `@unit`/`@integration` (ADR-059 exists; docs mention the fix; version bumped).

---

## 3. Out of scope (deferred)

- **Re-verifying past "done" slices** — this fix is forward-only; prior runs graded against a stale oracle are not retro-audited (they were manually checked where it mattered).
- **Keying the oracle PATH per dream** (e.g. `expectation-<id>.md`) — KISS: one path + a stamped id + overwrite-on-new is sufficient and keeps resume's fixed-path lookup simple.
- **A live LLM AC** — the bug is fully reproducible in pure write logic; no live judge run is needed to prove the fix (contrast the v0.17 live confirm).
- **The Documentalist "corrige" (drift corrector) and "concise" slices** — resume after this fix (v0.21 / v0.22 per [[documentalist-one-agent]]).

## 4. Operational notes for the implementer

- **Anti-drift MUST stay intact WITHIN a dream**: same dream (re-run or resume) NEVER overwrites — only a genuinely different dream on a non-resume launch does. The v0.17 guarantee ("the build cannot redefine its own success mid-run") is preserved; this fix only stops the oracle leaking ACROSS dreams.
- **The auto-handoff successor (v0.13/v0.14) is a resume of the SAME dream** — it must preserve the oracle. Thread its resume relaunch as `isResume:true` (it already runs the resume path).
- **Never throw** (the gate cannot crash a run): every read/parse/write error degrades to a safe `preserve` + an honest reason. A failure to determine identity errs toward PRESERVE (the conservative anti-drift default), and the caller logs it.
- **Zero new dependency** — Node's built-in `crypto.createHash('sha256')` for the stamp (the L-024 vanilla-stack bar).
- Pure decision (`decideExpectationWrite`) separated from the I/O (`writeExpectation`) — SRP, fully unit-testable. Commit incrementally per AC (L-019). Tag tests per stratum.
