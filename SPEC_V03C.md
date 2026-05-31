# Make My Dreams — v0.3.c Spec: profile → constitution-module composition (Layer C)

> The acknowledged v0.3 follow-up. v0.3.b threaded `MMD_PROFILE` into the auto-dev subprocess and consumed it MINIMALLY (the build prompt states the profile + a single hardcoded Kid safe-by-default line). v0.3.c makes it real: a runtime **constitution composer** (`lib/constitution-compose.js`, the long-planned Layer C — see CLAUDE.md "constitution diffusion") that reads `.specify/memory/constitution-bindings.yaml`, resolves `MMD_PROFILE` → the bound module list (`defaults.always` ∪ `profiles[profile]`), reads those `.specify/memory/constitution/*.md` files, and injects their text into the auto-dev prompt. So a Kid build actually carries `universal + ai-coding + safe-by-default + kid` (not a single hand-typed line), and a Pro build carries `universal + ai-coding + pro`. No external YAML dependency — a hand-rolled YAML-lite parser, matching the repo's vanilla-stack convention (`lib/bench/load-dreams.js`). Graceful + honest: if the bindings file or a module is missing/unreadable, it falls back to v0.3.b's minimal behavior rather than crashing.

---

## 1. Goal of v0.3.c

Implement Layer C constitution composition, profile-driven:

```
MMD_PROFILE=Kid → bindings: defaults.always [universal, ai-coding] ∪ profiles.Kid [safe-by-default, kid]
               → read .specify/memory/constitution/{universal,ai-coding,safe-by-default,kid}.md
               → concatenate (with headers) → inject into the auto-dev prompt
```

Deliverables:
1. **`lib/constitution-compose.js`** — pure-ish module (file reads injected for testability):
   - `parseBindings(yamlText)` — hand-rolled YAML-lite parser for the table's `key: [a, b]` shape (one level, no external dep). Mirrors `lib/bench/load-dreams.js`'s hand-rolled approach (KISS, vanilla stack).
   - `resolveModules({ profile }, bindings)` — pure: returns the deduped, deterministically-ordered module list = `defaults.always` ∪ `profiles[profile]`. Unknown/absent profile → `defaults.always` only (never throws).
   - `composeConstitution({ profile, bindingsPath?, moduleDir?, readFileFn? })` — resolves modules, reads each `<moduleDir>/<name>.md`, concatenates with a clear per-module header; a missing/unreadable module is SKIPPED with an inline note (never crashes); returns the constitution text (or `null` when nothing composable, signalling the caller to fall back).
2. **`buildPrompt` integration** (`lib/invoke-autodev.js`) — when `MMD_PROFILE` is set: state the profile (as v0.3.b) AND inject the composed constitution modules; this **supersedes** v0.3.b's single hardcoded Kid line (the `kid.md` + `safe-by-default.md` modules contain it and more). If `composeConstitution` returns `null` (bindings/modules unavailable), fall back to v0.3.b's minimal line (graceful degradation, §VI honesty). Unset `MMD_PROFILE` → prompt unchanged (back-compat).

**Scope = profile dimension only.** The bindings table also has `skills`, `workers`, `engines`, `contexts`, `cli` dimensions; v0.3.c composes by **profile** (the `MMD_PROFILE` ask). Engine/context/skill composition is a future slice (the resolver is built to extend to them).

**Not in this slice**: the full event-driven Documentalist (v0.5b); composing by engine/context/skill; any change to the lessons composer (`lib/composer/`, which is orthogonal — it injects lessons, this injects constitution modules).

**Mission validation**: `buildPrompt({…, env:{MMD_PROFILE:'Kid'}})` contains the actual text of `safe-by-default.md` + `kid.md` (not just a one-liner); `MMD_PROFILE=Pro` contains `pro.md`; an unreadable bindings file degrades to the v0.3.b minimal line without crashing.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: Hand-rolled bindings parser
**Given** the text of `constitution-bindings.yaml`
**When** `parseBindings(text)` runs
**Then**: it returns a structured object exposing at least `defaults.always` (a string[]) and `profiles` (a map of profile → string[]); it tolerates comments (`#`), blank lines, and the `key: [a, b, c]` inline-list shape used by the file; it does NOT require an external YAML package; malformed/missing sections yield empty lists, never a throw.
Tag: `@unit`.

### AC-2: Profile → module resolution (pure)
**Given** parsed bindings
**When** `resolveModules({ profile }, bindings)` runs
**Then**: returns `defaults.always` ∪ `profiles[profile]`, **deduplicated**, in a **deterministic order** (defaults first, then profile additions in listed order); `profile='Kid'` → `[universal, ai-coding, safe-by-default, kid]`; an unknown/absent profile → `defaults.always` only; never throws.
Tag: `@unit`.

### AC-3: composeConstitution reads + concatenates, skips missing, never crashes
**Given** a profile and an injected `readFileFn` (default real fs)
**When** `composeConstitution({ profile })` runs
**Then**: it resolves the modules, reads each `<moduleDir>/<name>.md`, and returns their concatenation with a clear per-module header (e.g. `## Constitution — <name>`); a module file that is missing/unreadable is SKIPPED with an inline note and does NOT crash; if NOTHING is composable (no bindings, no modules) it returns `null`; with the real repo modules and `profile='Kid'`, the output contains text from both `safe-by-default.md` and `kid.md`.
Tag: `@unit` (injected reads) + `@integration` (real module files).

### AC-4: buildPrompt injects the composed constitution (supersedes the v0.3.b line), with graceful fallback
**Given** `buildPrompt` in `lib/invoke-autodev.js`
**When** `MMD_PROFILE` is set
**Then**: the prompt states the profile AND includes the composed constitution modules for that profile (replacing v0.3.b's single hardcoded Kid directive — which now lives in the injected `safe-by-default.md`/`kid.md`); if `composeConstitution` returns `null`, the prompt falls back to v0.3.b's minimal line (no crash); an unset `MMD_PROFILE` leaves the prompt byte-for-byte unchanged (back-compat). For `MMD_PROFILE=Kid` the prompt contains the safe-by-default constraints; for `Pro` it contains `pro.md`'s content and NOT the Kid constraints.
Tag: `@unit`.

### AC-5: Docs + ADR
**Given** v0.3.c ships
**When** docs are read
**Then**: an ADR numbered 024 documents Layer C composition (why a runtime profile→module composer, why hand-rolled YAML over a dependency, why it supersedes the v0.3.b stopgap, the graceful-fallback contract, and the deferral of engine/context/skill dimensions); `README.md` / `CLAUDE.md`'s "constitution diffusion" note is updated to reflect that Layer C (`lib/constitution-compose.js`) now EXISTS (it was described as "planned").
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/constitution-compose.js   NEW — parseBindings (YAML-lite) + resolveModules (pure) + composeConstitution
lib/invoke-autodev.js         MODIFY — buildPrompt: inject composeConstitution({profile}) when MMD_PROFILE set;
                              fall back to the v0.3.b minimal line when it returns null
.specify/memory/              READ-ONLY — constitution-bindings.yaml + constitution/*.md (inputs, not modified)
```

### Files modified / added
```
make-my-dreams/
├── lib/constitution-compose.js                         # NEW
├── lib/invoke-autodev.js                               # modified — buildPrompt Layer C injection
├── test/unit/constitution-compose-parse.test.js        # NEW — AC-1
├── test/unit/constitution-compose-resolve.test.js      # NEW — AC-2
├── test/unit/constitution-compose.test.js              # NEW — AC-3 (injected reads)
├── test/integration/constitution-compose-real.test.js  # NEW — AC-3 real modules + AC-4 buildPrompt
├── test/unit/invoke-autodev-profile.test.js            # modified — AC-4 (extend the v0.3.b profile test)
├── docs/adr/024-constitution-composer-layer-c.md       # NEW
├── README.md / CLAUDE.md                               # modified — Layer C now exists
└── package.json                                         # modified — 0.3.3
```

---

## 4. Out of scope for v0.3.c
- ❌ Composing by engine / context / skill / worker dimensions (the resolver is built to extend; this slice does profile only).
- ❌ The full event-driven Documentalist (v0.5b) — unrelated.
- ❌ Any change to the lessons composer (`lib/composer/`) — orthogonal.
- ❌ Adding an external YAML dependency (hand-rolled parser, vanilla-stack §II KISS).
- ❌ **Scale assumption**: reads ≤ ~6 small module files (~10–20 KB total) per build; fine. A huge bindings table or hundreds of modules would warrant caching — not now.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V03C.md (this), and `lib/invoke-autodev.js#buildPrompt` (the v0.3.b `MMD_PROFILE` block to supersede).
2. Hand-rolled YAML-lite: study `lib/bench/load-dreams.js` for the repo's existing hand-rolled-parser pattern + the KISS/vanilla-stack rationale comment. The bindings shape is `key: [a, b]` one level deep under section headers (`defaults:`, `profiles:`) — a small line-by-line state machine suffices. Do NOT add the `yaml` npm package.
3. Keep `parseBindings` and `resolveModules` PURE; inject `readFileFn` into `composeConstitution` so tests don't touch real fs (mirror the detector/elicit injection style).
4. Graceful + honest (universal §VI): missing bindings file or module → skip/return null, caller falls back to the v0.3.b minimal line; never crash a build over a missing doc.
5. The v0.3.b hardcoded Kid line is REPLACED by injecting `safe-by-default.md` + `kid.md` (which contain that rule and more) — but keep it as the fallback path. Don't double-inject.
6. Constitution bindings for THIS slice: universal (§VI, §VII), ai-coding, commit-git, testing, error-handling, documentation, architecture.

## 6. Definition of done
1. All 5 ACs met.
2. Full suite passes (current 1224 + new tests).
3. `buildPrompt` with `MMD_PROFILE=Kid` contains the real `safe-by-default.md` + `kid.md` text; `Pro` contains `pro.md`; unset → unchanged; unreadable bindings → graceful fallback (no crash).
4. README/CLAUDE.md updated: Layer C composer now EXISTS.
5. ADR-024 in place.
6. Version bumped to `0.3.3`.
7. Slice merged (ff-only) + tag `v0.3.3`.
8. 18th reflexive use of `mmd --here` (5th with `--label`). The profile now drives the ACTUAL constitution modules in the build — closing the v0.3 profile story end to end.

---

*Spec v0.3.c — the long-planned Layer C: a runtime profile→constitution-module composer (`lib/constitution-compose.js`), hand-rolled YAML, injected into the auto-dev prompt, superseding v0.3.b's stopgap line with a graceful fallback. Profile dimension only; engine/context/skill composition and the full Documentalist remain future.*
