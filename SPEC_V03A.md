# Make My Dreams — v0.3.a Spec (DRAFT): Dream Catcher — refine the dream before launch

> **STATUS: DRAFT for design review.** This is a v0.3 design conversation captured as a spec, per the HANDOVER ("draft SPEC_V03A.md collaboratively, then launch"). Sections marked **[OPEN]** are decisions Sébastien still wants to make on the document. Nothing here is frozen and nothing is built yet.

> Dream Catcher is THE end-user feature: it turns a vague one-line dream ("une appli pour dessiner") into a small, buildable scope BEFORE auto-dev runs — through a short, friendly dialogue. Today `mmd "<dream>"` (and the `mmd serve` web form) take the dream verbatim and launch immediately; a 13-year-old's "une appli pour dessiner" goes straight to auto-dev with no clarification, so the result is a guess. Dream Catcher inserts a refinement step. Two design pillars, both from this session's design conversation: (1) it **stands on a BMAD elicitation skill** rather than reinventing question-generation (MMD's whole philosophy — `bmad-product-brief`, invoked headless); (2) the user picks their **involvement level** — a dial from "fais simple pour moi" (autonomous, minimal questions) to "je veux guider" (verbose, precise, many questions) — which maps directly onto product-brief's native *guided ↔ autonomous* spectrum.

---

## 1. Goal of v0.3.a

A refinement dialogue between dream-submission and auto-dev launch:

```
dream  →  profile (1st question)  →  involvement level  →  BMAD elicitation (N turns by level)
       →  refined scope shown back  →  user confirms  →  auto-dev (existing pipeline)
```

Design pillars:

1. **BMAD-backed, not reinvented.** Each elicitation turn is a headless `claude -p "/bmad-product-brief …"` call (the exact invocation pattern MMD already uses for `/bmad-adv-auto-dev` at [invoke-autodev.js:284](lib/invoke-autodev.js#L284)). MMD orchestrates; BMAD facilitates. We do NOT write a custom question generator.
   **✅ DE-RISKED (smoke test, 2026-05-31):** `claude -p "/bmad-product-brief <dream>"` ran fully headless/autonomous (zero questions, exit 0) and produced an 81-line structured brief — core capability + 2 small extras, explicit out-of-scope, and it **auto-applied the Kid safe-by-default profile** (no network/third-parties/offline) without being told the profile. Output: a friendly markdown summary on stdout (French) + a richer artifact at `_bmad-output/planning-artifacts/<slug>.md` (gitignored). Confirms the backbone is real, convergent, and Kid-aware out of the box.
2. **Involvement is a dial.** The user chooses how much they steer:
   - **Autonome ("fais pour moi")** → ONE headless `/bmad-product-brief` call in autonomous mode → small scope shown for a yes/no. **This is exactly the proven smoke-test path** (one call, no questions, structured brief out).
   - **Guidé ("je veux choisir")** → MMD orchestrates the turns itself: each turn is a SEPARATE headless call that asks BMAD to either emit the *next single clarifying question* or, once enough is known, *synthesize the scope*. The user answers in the web UI between calls.
   **Important reality (from the smoke test):** a headless `claude -p` subprocess CANNOT run BMAD's own interactive loop — it has no stdin. So the interactivity lives at the **MMD layer** (the web UI collects answers), and BMAD is invoked **statelessly per turn** with the accumulated `dream + answers` as context. "Autonome" = 1 stateless call; "guidé" = N stateless calls driven by MMD. The dial therefore controls *how many turns MMD runs*, not a flag inside one BMAD call.
   - (A middle "équilibré" default is **[OPEN]** — see §7.)
3. **Profile-first, Kid-aware.** The first question is "c'est pour qui ?" (Kid / Curious / Pro). The profile tailors TONE (simple+playful for Kid, technical for Pro) and, per the constitution, which modules bind. No runtime profile carrier exists yet ([constitution-bindings.yaml:88](.specify/memory/constitution-bindings.yaml#L88) is binding-only) — v0.3.a introduces a minimal one (see §3).
4. **Surface: web-first.** For the Kid scenario it MUST be the web page (`mmd serve`), not a terminal. The refinement LOGIC lives in a surface-agnostic, testable core (`lib/dream-catcher/`); v0.3.a wires it to the **web** surface. CLI/TTY is **[OPEN]** (§7) — likely v0.3.b.
5. **Converge, never explode.** The dialogue NARROWS toward one walking-skeleton-sized scope (L-009). It is explicitly NOT divergent brainstorming (which would multiply features and blow scope). The refined scope is capped (e.g. one primary capability + a couple of small extras).
6. **Honest + safe.** No fabricated scope: if BMAD output can't be parsed into questions/scope, fall back to launching the verbatim dream (today's behavior) with a clear note — never invent. Kid profile keeps `safe-by-default` bindings.

**Mission validation**: a child opens the web page, types "une appli pour dessiner", picks "c'est pour moi, j'ai 13 ans" and "fais simple", answers ≤2 friendly questions, sees "✨ Voici ton appli : une toile de dessin avec des couleurs et un bouton Sauver", clicks "C'est parti !", and auto-dev builds exactly that.

---

## 2. The flow (concrete, web surface)

```
[Web] Qu'est-ce que tu veux construire ?
  > une appli pour dessiner
[Web] C'est pour qui ?           ← profile, 1st question (Kid / Curious / Pro)
  > pour moi, j'ai 13 ans        → profile = Kid
[Web] Tu préfères que je te guide, ou que je fasse au plus simple ?   ← involvement dial
  > fais au plus simple          → autonomous mode
[Web] (headless /bmad-product-brief, autonomous) → 1 question:
      "On doit pouvoir GARDER tes dessins, ou c'est juste pour s'amuser ?"
  > les garder
[Web] ✨ Voici ton appli :
      « Une toile de dessin web : 6 couleurs, une gomme, un bouton
        "Sauver mon dessin" (1 dessin gardé sur ton ordi). »
      [ Recommencer ]   [ C'est parti ! ]
  > C'est parti !
      → existing pipeline: update status.json.dream = refined scope → invokeAutodev
```

In **guided** mode the same flow runs more turns with more precise questions and a more detailed scope.

---

## 3. Architecture (incremental)

```
Surface-agnostic core (NEW, pure where possible, all I/O injected):
  lib/dream-catcher/
    session.js          — state machine: dream → profile → level → elicit(N) → scope → confirm
    elicit.js           — build the BMAD prompt for a turn; invoke claude -p headless; parse reply
    parse-reply.js      — pure: BMAD text → { questions[] } | { scope } | { unparseable }
    profile.js          — Kid|Curious|Pro enum + tone hints (minimal runtime carrier)

Web surface (MODIFY mmd serve):
  lib/server.js         — new conversational routes (see below); single-user localhost
  bin/serve-ui/         — multi-step UI (replaces one-shot textarea with a guided flow)

Hand-off (unchanged pipeline):
  bin/mmd.js / lib/invoke-autodev.js — receive the REFINED dream/scope, launch as today

Reused: lib/invoke-autodev.js#buildSubprocessEnv (env allowlist), lib/state.js (status.json),
        the /bmad-... claude -p invocation pattern.
```

### Proposed web API (conversational, replaces the one-shot POST /api/dream)
- `POST /api/catch/start` `{ dream }` → `{ sessionId, next: "profile" }`
- `POST /api/catch/answer` `{ sessionId, answer }` → `{ next: "level" | "question" | "scope", payload }`
- `POST /api/catch/confirm` `{ sessionId }` → launches auto-dev, returns the existing `{ jobId, streamUrl }` (then today's SSE stream takes over)
- Session state stashed server-side (in-memory map keyed by sessionId; single-user localhost — no auth, matching today's model). Dialogue archived to `.mmd/local/dream-catcher/<ts>.md`.

### Profile carrier (minimal)
A `profile` field added to the session + written into `status.json.profile` at launch, so downstream (and the constitution binding) can read it. Full `MMD_PROFILE` env + global config is **[OPEN]** / v0.3.b.

---

## 4. Acceptance criteria (Given / When / Then) — DRAFT, will firm up after design freeze

### AC-1: Surface-agnostic session state machine
**Given** an injected elicitation runner + an injected I/O channel
**When** a session runs dream → profile → level → elicit → scope → confirm
**Then** the core advances deterministically through the states, asks the profile question first, branches on the involvement level (autonomous vs guided → turn count + BMAD mode), and ends with a refined-scope object + a confirm/restart decision. Pure/injected — testable with no real claude/web.
Tag: `@unit`.

### AC-2: BMAD elicitation invocation (headless, parsed, honest fallback)
**Given** a dream + profile + level
**When** `elicit` builds and runs the BMAD prompt (`claude -p "/bmad-product-brief …"`, autonomous|guided per level)
**Then** the reply is parsed into `{ questions[] }` (mid-dialogue) or `{ scope }` (final); an **unparseable** reply yields a clean fallback to the verbatim dream with a logged note (no fabrication, §VI). Invocation uses the existing env-allowlist + timeout handling.
Tag: `@unit` (injected spawn) + `@integration` (fake claude fixture, like `MMD_AUTODEV_CMD`).

### AC-3: Involvement dial changes the dialogue
**Given** the same dream
**When** the user picks "autonome" vs "guidé"
**Then** autonomous runs ≤1 question and a concise scope; guided runs several precise questions and a richer scope; both converge to a walking-skeleton-sized result (scope cap enforced).
Tag: `@unit`.

### AC-4: Profile-first + Kid tone
**Given** the dialogue starts
**When** the first question is asked
**Then** it is the profile question; a Kid profile produces simple, playful phrasing and keeps `safe-by-default` bindings; profile is persisted to `status.json.profile`.
Tag: `@unit`.

### AC-5: Web surface end-to-end
**Given** `mmd serve` running
**When** a client drives `/api/catch/start` → `/answer`×N → `/confirm`
**Then** the UI walks the steps, shows the refined scope with "Recommencer / C'est parti !", and `confirm` launches auto-dev via the existing pipeline + SSE stream. Back-compat: a direct/non-interactive submission still works (verbatim dream).
Tag: `@integration`.

### AC-6: Docs + ADR + lesson
ADR for the Dream Catcher design (BMAD-backed, involvement dial, web-first); README + a lesson on "converge-not-diverge for end-user dreams". Tag: `@unit` anchors.

---

## 5. Out of scope for v0.3.a (proposed)
- ❌ CLI/TTY surface (web-first; CLI is **[OPEN]**, likely v0.3.b).
- ❌ Full runtime profile system (`MMD_PROFILE` env + global config) — only the minimal session/status carrier.
- ❌ Multi-session / multi-user / auth on the web server (stays single-user localhost).
- ❌ Persisting/replaying past dialogues beyond the `.mmd/local` archive.
- ❌ Divergent brainstorming mode (Carson) — convergence only; a "fun ideas" mode is a possible v0.3.x.
- ❌ **Scale assumption**: in-memory session map, one in-flight dream (today's constraint) — fine for single-user; multi-user would need real session storage.

## 6. Implementation hints (for later)
- Reuse the `/bmad-…` `claude -p` pattern + `buildSubprocessEnv` ([invoke-autodev.js](lib/invoke-autodev.js)); mirror the fake-runner test seam (`MMD_AUTODEV_CMD`) for `@integration`.
- Keep `parse-reply.js` pure; treat BMAD output defensively (it's an LLM — validate before trust, ai-coding §III).
- The 5-Whys ([five-whys.js](lib/conductor/five-whys.js)) is the reference for "invoke a BMAD facilitation headless and parse a closed result, with a sacred fallback on unparseable output" — Dream Catcher's fallback-to-verbatim-dream mirrors that discipline.
- Constitution bindings: universal, ai-coding, safe-by-default + kid (when profile=Kid), documentation, error-handling, security (untrusted web input — validate/escape).

## 7. [OPEN] decisions for Sébastien (resolve on this doc)
1. **Involvement levels**: two (autonome / guidé) or three (+ équilibré default)? What's the default if the user doesn't choose?
2. **Surface scope**: web-only for v0.3.a (recommended), or web + CLI together?
3. ~~**BMAD skill**~~ **— RESOLVED (smoke test 2026-05-31):** `bmad-product-brief` is installed, headless-invocable, autonomous, convergent, and Kid-aware. Confirmed as the backbone. (Open sub-point: how to feed the result to auto-dev — pass the stdout summary as the enriched dream, or hand auto-dev the `_bmad-output/.../<slug>.md` artifact directly? Leaning: archive the artifact, pass its scope to `status.json.dream`.)
4. **Scope cap**: how do we define "walking-skeleton-sized"? e.g. "one primary capability + ≤2 small extras" — concrete enough?
5. **Profile carrier**: minimal session/status field now (recommended) vs introduce `MMD_PROFILE` properly now.
6. **Confirm gate**: after showing the refined scope, is a single "C'est parti !" enough, or do we want an edit-the-scope step before launch?

---

*Spec v0.3.a — DRAFT, drafted 2026-05-31 as a design conversation. Backbone: BMAD `product-brief` invoked headless; centerpiece: an involvement dial mapping onto guided↔autonomous; surface: web-first for the Kid scenario. Not frozen — resolve §7 then firm up §4 and freeze.*
