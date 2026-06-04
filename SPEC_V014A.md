# Make My Dreams — v0.14.0 Spec (slice v0.14.a): the transparent Conductor — auto-handoff default-on

> *(Theme: the Conductor must be INVISIBLE to the user. Make context monitoring + cooperative auto-handoff the DEFAULT, not an opt-in flag. The §9.0 step-C capability, finally transparent.)*
>
> **The product flaw.** Auto-handoff shipped (v0.13.0) behind `--auto-handoff` (which implies `--monitor`). But the whole point of the Conductor (vision §4.2) is that the user NEVER has to think about context limits — a non-technical `serve`/Dream-Catcher user will never know to pass a flag. An opt-in Conductor defeats its own purpose. **It must be transparent: on by default.**
>
> **Why it was opt-in (honest).** A self-imposed caution, not a hard requirement: the monitor switches the spawn to `--output-format stream-json --verbose`, and we kept the default text spawn "byte-for-byte" out of fear of touching the bootstrap path. But stream-json changes only the OUTPUT FORMAT, not the agent's work — the build result is identical; the monitor re-renders human-readable progress. So the contract was over-cautious. We retire it (with a clean opt-out escape hatch).
>
> **Proven before flipped (the 'always verify' order).** The v0.13.1 fix made the common case safe (a run that reaches no phase boundary no longer false-hands-off — proven live). This slice's OWN build is the core proof: it is run with cooperative handoff + a forced threshold on a capable model, so it must actually stop at a phase boundary and resume a fresh successor while building. The default-on flip is merged ONLY if that handoff demonstrably worked during the build (the proof gates the flip).
>
> **The opt-out (bootstrap-purity / cost escape hatch).** A single env, **`MMD_NO_AUTO_HANDOFF=1`**, restores today's EXACT behavior — the text spawn (no stream-json), a single auto-dev invocation, no handoff loop. So anyone who needs the old byte-for-byte spawn (a wary bootstrap, a cost-sensitive batch) has a clean, documented escape. Default = transparent Conductor; opt-out = today.

---

## 1. Goal of v0.14.a

```
BEFORE:  mmdream --here "<dream>"                 → text spawn, no monitor, no handoff (Conductor invisible+inert)
         mmdream --here --auto-handoff "<dream>"  → stream-json, monitor, cooperative handoff (opt-in)

AFTER:   mmdream --here "<dream>"                 → stream-json, monitor, cooperative handoff — BY DEFAULT (transparent)
         mmdream "<dream>" / serve                → same, transparent for the end user (no flag, no checkbox)
         MMD_NO_AUTO_HANDOFF=1 mmdream --here …   → today's EXACT behavior (text spawn, single run, no handoff) — the escape hatch
```

Deliverables:
1. **Monitor + handoff default-on** (`lib/invoke-autodev.js` + `bin/mmd.js`): the auto-dev spawn defaults to the monitored (`stream-json`) form and the handoff loop runs by default in `runHereMode` AND greenfield. The `--auto-handoff` / `--monitor` flags become **no-ops kept for back-compat** (they no longer toggle anything — default is already on). `MMD_NO_AUTO_HANDOFF=1` is the single opt-out that restores the pre-v0.14 behavior exactly (text spawn, one invocation, no loop).
2. **Spawn-pin tests INVERTED** (the retired bootstrap contract): the DEFAULT CLI args now INCLUDE `--output-format stream-json --verbose`; `MMD_NO_AUTO_HANDOFF=1` → the historical `['-p', '/bmad-adv-auto-dev <prompt>']` (now the opt-out path, pinned). Honest comments explain the contract moved (transparency > byte-for-byte default).
3. **End-user paths transparent** (`lib/server.js` serve + greenfield): serve no longer needs the v0.5.c "Monitor context (advanced)" checkbox to get the gauge/handoff — monitoring is always on (the gauge shows whenever context data exists); greenfield + the Dream Catcher build with the Conductor active, no flag. (The checkbox, if kept, only toggles gauge *visibility*, not the underlying monitor.)
4. **Cost honesty**: monitoring adds only parse cost (negligible); an actual handoff only fires at the threshold (rare for small dreams). `MMD_AUTODEV_MODEL` (v0.13.2) still lets a cost-sensitive run pick a cheap engine. Documented.
5. **Docs + ADR**: ADR-052 (transparent Conductor, why opt-in was wrong, the retired byte-for-byte contract + why it was safe, the `MMD_NO_AUTO_HANDOFF` escape hatch, proven-before-flipped); `/mmdream` template updated (handoff is automatic now — no flag to remember; mention the opt-out); README + CLAUDE.md; mechanical blocks; version → 0.14.0.

**Mission validation**: `mmdream --here "<dream>"` (NO flag) monitors context and cooperatively hands off at the threshold, transparently; the end-user `serve`/greenfield path gets the Conductor with no flag or checkbox; `MMD_NO_AUTO_HANDOFF=1` restores today's exact text-spawn single-run behavior; the bootstrap self-build still produces correct results under the monitored default (verified). The Conductor is now invisible to the user — exactly the §4.2 intent.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: the auto-dev spawn is monitored BY DEFAULT; the opt-out restores the text spawn
**Given** `buildAutodevArgs` and the default env
**When** args are built
**Then**: the DEFAULT CLI args INCLUDE `--output-format stream-json --verbose` (monitor on); with the opt-out active (e.g. a `monitor:false` derived from `MMD_NO_AUTO_HANDOFF=1`) the args are the historical `['-p', '/bmad-adv-auto-dev <prompt>']`. The `MMD_AUTODEV_MODEL` override still composes. Pure/deterministic.
Tag: `@unit` (default has stream-json; opt-out is byte-for-byte historical; model still composes).

### AC-2: the handoff loop runs by default; MMD_NO_AUTO_HANDOFF=1 disables it
**Given** a completed run via the fake auto-dev seam (no flag)
**When** `mmdream --here` runs with NO `--auto-handoff`
**Then**: the handoff loop is active (a cooperative-stop fake with a resumable checkpoint → a relaunch happens, bounded by `MMD_MAX_HANDOFFS`); with `MMD_NO_AUTO_HANDOFF=1` → exactly one spawn, the historical flow, no loop. The v0.13.1 fix still holds (no resumable checkpoint → finish, no false handoff). The alignment gate still runs once on true completion.
Tag: `@unit`/`@integration` (default loops on a real checkpoint; opt-out → single spawn; no-checkpoint → no false handoff).

### AC-3: end-user paths (serve + greenfield) are transparent
**Given** a serve launch and a greenfield run
**When** started with no monitor/handoff flag
**Then**: both run with the Conductor active (monitored spawn + handoff loop) — no `--auto-handoff` flag, no serve "advanced" checkbox required; the serve status/gauge surfaces context whenever present. `MMD_NO_AUTO_HANDOFF=1` opts the whole machine out.
Tag: `@integration` (serve launch body needs no monitor flag to get the Conductor; greenfield default is monitored).

### AC-4: the `--auto-handoff`/`--monitor` flags are back-compat no-ops + opt-out documented
**Given** a run passing the now-legacy `--auto-handoff` or `--monitor`
**When** parsed
**Then**: they are accepted (no argv error — back-compat) but change nothing (the default is already on); `MMD_NO_AUTO_HANDOFF=1` is the documented way to disable. No user script that passed the old flags breaks.
Tag: `@unit` (legacy flags accepted + inert; opt-out wins).

### AC-5: docs + the core-proof capture
**Then**: ADR-052 lands; `/mmdream` template says auto-handoff is automatic (no flag) + documents `MMD_NO_AUTO_HANDOFF=1`; README + CLAUDE.md updated; mechanical blocks refreshed; version → 0.14.0. **The slice's own build (run with cooperative handoff + a forced threshold on a capable model) is the live proof that the core stop-at-boundary + resume works on a real multi-phase run** — captured honestly in the slice notes (if the build did NOT actually hand off + resume, that is reported as a wall, and the default-on flip is NOT merged).
Tag: `@unit`/`@integration` (ADR-052 exists; template mentions automatic + opt-out; version bumped).

---

## 3. Out of scope (deferred)

- **Removing the legacy flags entirely** — kept as inert no-ops for back-compat; a future major may drop them.
- **Per-surface threshold tuning** — `MMD_HANDOFF_THRESHOLD` stays one global default (0.70).
- **Forced-kill fallback** when the orchestrator overruns before a boundary — still deferred (cooperative-only).
- **Parallel Conductor (step D)** and **Bundle C (step E)**.

---

## 4. Operational notes for the implementer

- The retired contract: the DEFAULT spawn was historically text-only "byte-for-byte" for bootstrap safety. This slice INVERTS that — stream-json is the default. Keep `MMD_NO_AUTO_HANDOFF=1` as the exact-old-behavior escape hatch and PIN it (the inverse of the old pin). Explain the move in comments (transparency is the product requirement; stream-json changes only output format, not the build).
- REUSE everything from v0.13.x: the handoff loop, `decideHandoff` (incl. the v0.13.1 resumable-checkpoint gate), the monitor, the resume relaunch. This slice only flips the DEFAULTS + adds the single opt-out + the back-compat flag handling. Do NOT re-implement the loop.
- `MMD_NO_AUTO_HANDOFF=1` must restore the pre-v0.14 behavior EXACTLY (text spawn, single invocation, no loop) — it is the bootstrap/cost escape hatch.
- Keep the alignment gate (v0.11) running ONCE on true completion (unchanged).
- Commit incrementally per AC (L-019). Tests tagged per stratum.
