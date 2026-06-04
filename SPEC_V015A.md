# Make My Dreams — v0.15.0 Spec (slice v0.15.a): the transparent Conductor — auto-handoff default-on

> *(Supersedes the pre-hybrid draft `SPEC_V014A.md`. The hybrid auto-handoff (v0.14.0, ADR-053) is now PROVEN LIVE — so making it transparent is justified.)*
>
> **Why.** The Conductor's job (vision §4.2) is to be INVISIBLE — the user should never think about context limits. Today auto-handoff is opt-in behind `--auto-handoff`; a non-technical `serve`/Dream-Catcher user will never pass a flag. So the proven hybrid handoff (incite + enforce, v0.14.0) must become the DEFAULT: monitored spawn + handoff loop on by default, with one clean opt-out.
>
> **Safe because.** stream-json changes only the OUTPUT FORMAT, not the agent's work (the monitor re-renders human-readable progress); the hybrid is proven (cooperative + enforce, both live); a run that never crosses the threshold or reaches no new boundary is never killed (the v0.13.1 gate); and `MMD_NO_AUTO_HANDOFF=1` restores today's EXACT text-spawn single-run behavior (the bootstrap/cost escape hatch). The earlier byte-for-byte-default-spawn contract was self-imposed caution; we retire it (escape hatch preserved).
>
> **Open question, noted (not blocking).** Whether the orchestrator genuinely saturates on a real slice is unmeasured (it delegates phases to fresh sub-agents → may stay light). Default-on is SAFE regardless (the hybrid only acts at the threshold; below it, it's a no-op + the negligible stream-json parse cost). If real runs never approach the threshold, a later slice may downscope — but default-on with an opt-out is the correct, reversible product default now.

---

## 1. Goal of v0.15.a

```
BEFORE:  mmdream --here "<dream>"                 → text spawn, no handoff (Conductor inert)
         mmdream --here --auto-handoff "<dream>"  → monitored + hybrid handoff (opt-in)
AFTER:   mmdream --here "<dream>" / serve / greenfield → monitored + hybrid handoff BY DEFAULT (transparent, no flag)
         MMD_NO_AUTO_HANDOFF=1 mmdream …          → today's EXACT behavior (text spawn, one run, no loop) — the escape hatch
```

Deliverables:
1. **Default-on** (`lib/invoke-autodev.js` + `bin/mmd.js`): the auto-dev spawn defaults to the monitored (stream-json) form and the hybrid handoff loop runs by default in `runHereMode` AND greenfield. `--auto-handoff` / `--monitor` become accepted-but-inert no-ops (back-compat — no argv error, change nothing). `MMD_NO_AUTO_HANDOFF=1` is the single opt-out restoring the pre-v0.15 behavior exactly (text spawn, one invocation, no loop, no monitor).
2. **Spawn-pin tests INVERTED**: the DEFAULT CLI args now INCLUDE `--output-format stream-json --verbose`; `MMD_NO_AUTO_HANDOFF=1` → the historical `['-p', '/bmad-adv-auto-dev <prompt>']`, pinned. Honest comments explain the contract moved (transparency > byte-for-byte default; stream-json changes only output format).
3. **End-user paths transparent** (`lib/server.js` serve + greenfield): both run with the Conductor active, no `--auto-handoff` flag and no serve "advanced" checkbox required; the serve gauge shows whenever context data exists. `MMD_NO_AUTO_HANDOFF=1` opts the whole machine out.
4. **Reuse, don't reinvent**: the hybrid loop, `decideHandoff` (+ v0.13.1 gate), `shouldForceHandoff`, the abort seam, the monitor, the resume relaunch, the alignment gate (runs once on true completion) are all UNCHANGED — this slice only flips DEFAULTS + adds the opt-out + back-compat no-op handling. `MMD_AUTODEV_MODEL` still composes.
5. **Docs + ADR**: ADR-054 (transparent Conductor, why opt-in was wrong, the retired default-spawn contract + why safe, the `MMD_NO_AUTO_HANDOFF` escape hatch, the noted saturate-question); `/mmdream` template (handoff is automatic now — no flag; document the opt-out); README + CLAUDE.md; mechanical blocks; version → 0.15.0.

**Mission validation**: `mmdream --here "<dream>"` (NO flag) monitors + cooperatively-or-forcibly hands off at the threshold, transparently; serve/greenfield get the Conductor with no flag/checkbox; `MMD_NO_AUTO_HANDOFF=1` restores today's exact text-spawn single-run; a run below threshold / with no new boundary is never killed; the bootstrap self-build still produces correct results under the monitored default. The Conductor is invisible to the user — the §4.2 intent.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: monitored spawn + handoff loop are the DEFAULT; opt-out restores today
**Given** `buildAutodevArgs` / the loop wiring + the default env
**When** built/run with NO flag
**Then**: default CLI args INCLUDE `--output-format stream-json --verbose` and the hybrid loop is active; with `MMD_NO_AUTO_HANDOFF=1` the args are the historical `['-p','/bmad-adv-auto-dev <prompt>']` and exactly one un-looped invocation runs (today's behavior). `MMD_AUTODEV_MODEL` still composes into both.
Tag: `@unit` (default has stream-json; opt-out byte-for-byte historical; model composes) + `@integration` (default loops on a resumable checkpoint; opt-out → single spawn).

### AC-2: `--auto-handoff` / `--monitor` are accepted-but-inert (back-compat)
**Given** a run passing the now-legacy `--auto-handoff` or `--monitor`
**When** parsed
**Then**: accepted (no argv error), change nothing (default already on); `MMD_NO_AUTO_HANDOFF=1` still wins. No script passing the old flags breaks.
Tag: `@unit` (legacy flags inert; opt-out wins).

### AC-3: end-user paths (serve + greenfield) transparent
**Given** a serve launch + a greenfield run with no monitor/handoff flag
**Then**: both run with the Conductor active (monitored spawn + hybrid loop) — no flag, no serve checkbox; the gauge surfaces context when present; `MMD_NO_AUTO_HANDOFF=1` opts out.
Tag: `@integration` (serve launch body needs no flag for the Conductor; greenfield default monitored).

### AC-4: the v0.13.1/v0.14.0 safety properties hold under default-on
**Given** the default-on path
**Then**: a run below the threshold OR reaching no new boundary is NEVER killed (no false handoff — v0.13.1); the cooperative path still works when the agent obeys; the enforce backstop still fires when it doesn't; the alignment gate runs ONCE on true completion. No regression vs v0.14.0 (the same loop, just default-on).
Tag: `@integration` (no-new-boundary → no kill; cooperative + enforce both still reachable by default).

### AC-5: docs
**Then**: ADR-054 lands; `/mmdream` says auto-handoff is automatic + documents `MMD_NO_AUTO_HANDOFF=1`; README + CLAUDE.md; mechanical blocks; version → 0.15.0.
Tag: `@unit`/`@integration` (ADR-054 exists; template mentions automatic + opt-out; version bumped).

---

## 3. Out of scope (deferred)

- **Removing the legacy `--auto-handoff`/`--monitor` flags** — kept inert for back-compat; a future major may drop them.
- **`contextWindowFor('sonnet')` accuracy** — separate small fix (the monitor mis-estimates Sonnet's window); tracked separately, not blocking the flip (the default model is correctly detected).
- **Measuring whether the orchestrator saturates on real slices** — noted open question; default-on is safe + reversible regardless.
- **Parallel Conductor (D), Bundle C (E).**

---

## 4. Operational notes for the implementer

- WITHOUT `MMD_NO_AUTO_HANDOFF=1`, the spawn is now monitored (stream-json) and the loop runs. WITH it, byte-for-byte today's behavior — PIN both (invert the existing spawn-pin tests; keep an opt-out pin).
- REUSE the entire v0.14.0 hybrid machinery unchanged — this is a DEFAULTS flip + opt-out + back-compat, not new handoff logic.
- The bootstrap self-build now runs monitored by default — verify the suite stays green + the build result is unaffected (stream-json is output-format only). `MMD_NO_AUTO_HANDOFF=1` remains for any wary bootstrap/cost case.
- Commit incrementally per AC (L-019). Tests tagged per stratum.
