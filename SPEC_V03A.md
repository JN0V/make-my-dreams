# Make My Dreams — v0.3.a Spec: Dream Catcher — refine the dream before launch

> **STATUS: FROZEN (design resolved 2026-05-31).** Captured as a design conversation per the HANDOVER, then resolved: both BMAD modes de-risked by smoke tests, and the six §7 open decisions answered by Sébastien (see §7). Decisions: **3 involvement levels** (Autonome / Équilibré [default] / Guidé), **web-only surface** for v0.3.a, **scope is editable** before launch. Ready to build.

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
2. **Involvement is a dial — 3 levels** (Équilibré is the default). The user chooses how much they steer:
   - **Autonome ("fais simple")** → ONE headless `/bmad-product-brief` call, zero questions → scope. **The proven smoke-test path.**
   - **Équilibré (default)** → exactly ONE clarifying question, then synthesize → scope. Two MMD-orchestrated calls. The gentle middle: a little personalization, minimal friction.
   - **Guidé ("je veux choisir")** → ~2–3 clarifying questions across turns, then synthesize → richer, more tailored scope. N MMD-orchestrated calls.
   The level controls **how many clarifying turns MMD runs** (0 / 1 / 2–3) before the synthesize turn.
   **Important reality (from the smoke test):** a headless `claude -p` subprocess CANNOT run BMAD's own interactive loop — it has no stdin. So the interactivity lives at the **MMD layer** (the web UI collects answers), and BMAD is invoked **statelessly per turn** with the accumulated `dream + answers` as context. "Autonome" = 1 stateless call; "guidé" = N stateless calls driven by MMD. The dial therefore controls *how many turns MMD runs*, not a flag inside one BMAD call.
   **✅ GUIDED MODE DE-RISKED (prototype, 2026-05-31):** two MMD-orchestrated stateless calls worked end-to-end. Turn 1 (prompted "ask exactly ONE question") returned a single clean kid-friendly line — directly displayable, no JSON parsing. Turn 2 (given `dream + question + simulated answer`, prompted "synthesize the scope") returned a scope **tailored to the answer** (the child said "keep my drawings + lots of colors" → scope became draw+SAVE+gallery + rich palette, *different* from the autonomous run's PNG-export scope). **Parsing is trivial because MMD controls each turn's intent**: it tells BMAD "ask a question" vs "synthesize scope" per turn, so it always knows whether the output is a question (show it) or the final scope (confirm + launch) — no fragile classification needed.
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
      [ Recommencer ]   [ ✏️ Modifier ]   [ C'est parti ! ]
  > (optionnel) ✏️ Modifier → le scope est éditable dans un champ texte,
      l'utilisateur ajuste, revalide
  > C'est parti !
      → existing pipeline: update status.json.dream = (edited) refined scope → invokeAutodev
```

The user can **edit the scope text** before launching (a safety net + control), **restart** the whole dialogue, or **launch**. In **guided** mode the same flow runs more turns with more precise questions and a more detailed scope; in **autonome** it skips straight from the dream to the scope card.

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
- `POST /api/catch/edit` `{ sessionId, scope }` → `{ scope }` (replace the synthesized scope text before launch)
- `POST /api/catch/confirm` `{ sessionId }` → launches auto-dev with the (possibly edited) scope, returns the existing `{ jobId, streamUrl }` (then today's SSE stream takes over)
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

### AC-3: Involvement dial — 3 levels change the turn count
**Given** the same dream
**When** the user picks Autonome / Équilibré / Guidé (Équilibré is the default if unset)
**Then** the core runs 0 / 1 / 2–3 clarifying turns respectively before the synthesize turn; all three converge to a walking-skeleton-sized scope (cap: **one primary capability + ≤2 small extras** — the smoke test's natural shape). The level maps to MMD's turn count, not a flag inside one BMAD call.
Tag: `@unit`.

### AC-4: Profile-first + Kid tone
**Given** the dialogue starts
**When** the first question is asked
**Then** it is the profile question; a Kid profile produces simple, playful phrasing and keeps `safe-by-default` bindings; profile is persisted to `status.json.profile`.
Tag: `@unit`.

### AC-5: Web surface end-to-end (with editable scope)
**Given** `mmd serve` running
**When** a client drives `/api/catch/start` → `/answer`×N → (optional `/edit`) → `/confirm`
**Then** the UI walks the steps (dream → profile → level → questions), shows the refined scope card with **Recommencer / ✏️ Modifier / C'est parti !**; editing replaces the scope text; `confirm` launches auto-dev with the (possibly edited) scope via the existing pipeline + SSE stream. Back-compat: the legacy one-shot `POST /api/dream` still works (verbatim dream, no dialogue).
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

## 7. Resolved decisions (design conversation, 2026-05-31)
1. **Involvement levels** → **3 levels**: Autonome / **Équilibré (default)** / Guidé = 0 / 1 / 2–3 clarifying turns.
2. **Surface** → **web-only** for v0.3.a; CLI/TTY deferred to v0.3.b. Core stays surface-agnostic + testable.
3. **BMAD skill** → **`bmad-product-brief`** (smoke-tested: headless, autonomous, convergent, Kid-aware). Feed to auto-dev by passing the synthesized scope into `status.json.dream`; archive the `_bmad-output/.../<slug>.md` artifact under `.mmd/local/dream-catcher/`.
4. **Scope cap** → **one primary capability + ≤2 small extras** (the shape both smoke tests produced naturally). Enforced/checked at synthesize time.
5. **Profile carrier** → **minimal**: a `profile` field on the session, persisted to `status.json.profile`. Full `MMD_PROFILE` env/global config deferred to v0.3.b.
6. **Confirm gate** → **editable scope**: after the scope card, the user can Recommencer / ✏️ Modifier (edit the text) / C'est parti ! (launch).

---

*Spec v0.3.a — FROZEN 2026-05-31 after a design conversation + two BMAD smoke tests. Backbone: BMAD `product-brief` invoked headless (autonomous + MMD-orchestrated guided, both de-risked); centerpiece: a 3-level involvement dial (Autonome / Équilibré / Guidé) controlling MMD's turn count; surface: web-only for the Kid scenario; scope is editable before launch. Ready to build.*
