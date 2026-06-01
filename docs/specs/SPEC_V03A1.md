# Make My Dreams — v0.3.a-1 Spec: Dream Catcher walking skeleton (Autonome mode, web)

> First phase of the frozen [SPEC_V03A.md](SPEC_V03A.md). This is the THINNEST end-to-end path (walking skeleton, L-009): in the `mmd serve` web UI, a dream is refined by ONE autonomous `bmad-product-brief` call (profile-aware) into a small scope, the user confirms, and auto-dev launches with that scope. It deliberately ships only the **Autonome** path of the 3-level dial; the **Équilibré / Guidé** multi-turn modes and **scope editing** come in v0.3.a-2. Both the autonomous and guided BMAD invocations were already de-risked by smoke tests (SPEC_V03A §1). The point of this slice is to prove the WHOLE chain — web input → profile → headless BMAD → scope card → confirm → existing auto-dev pipeline — works through one clean, tested vertical, with a surface-agnostic core ready for v0.3.a-2 to extend.

---

## 1. Goal of v0.3.a-1

The minimal vertical, web-only:

```
[web] dream  →  [web] profile (1 question)  →  ONE autonomous /bmad-product-brief call
      →  [web] scope card  →  [web] "C'est parti !"  →  existing auto-dev pipeline
```

Deliverables:
1. **Surface-agnostic core** `lib/dream-catcher/` (pure where possible, all I/O injected):
   - `session.js` — a minimal state machine for THIS slice: `dream → profile → synthesize(autonomous) → scope → confirm`. Built so v0.3.a-2 can insert clarifying turns between `profile` and `synthesize` without a rewrite.
   - `elicit.js` — build the autonomous `bmad-product-brief` prompt (profile-aware) and invoke `claude -p` headless; return the synthesized scope text. Reuses the env-allowlist + spawn pattern from `lib/invoke-autodev.js`.
   - `parse-reply.js` — pure: take the BMAD reply, return `{ scope }` or `{ unparseable }`. Trivial for autonomous (the reply IS the scope) but isolated so v0.3.a-2 can add the `{ question }` shape.
   - `profile.js` — `Kid | Curious | Pro` enum + tone hints; default `Curious`.
2. **Web wiring** (`lib/server.js`): new conversational routes `/api/catch/start`, `/api/catch/answer` (profile), `/api/catch/confirm`. The legacy one-shot `POST /api/dream` keeps working untouched (back-compat).
3. **Web UI** (`bin/serve-ui/`): a small multi-step flow (dream textarea → 3 profile buttons → scope card with **Recommencer / C'est parti !**), reusing the existing SSE progress view after launch.
4. **Honest fallback**: if the BMAD call fails or returns nothing usable, fall back to launching the VERBATIM dream (today's behavior) with a visible note — never fabricate a scope (universal §VI; mirrors the 5-Whys sacred fallback).

**Not in this slice** (→ v0.3.a-2): the involvement dial (Équilibré/Guidé multi-turn), scope editing, CLI/TTY surface.

**Mission validation**: with `mmd serve` running, a user types "une appli pour dessiner", clicks "Pour un enfant", sees a small scope card (drawing canvas + ≤2 extras, Kid safe-by-default), clicks "C'est parti !", and auto-dev builds that scope — the whole chain green and tested.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: Surface-agnostic session state machine (autonomous path)
**Given** an injected elicitation runner + injected I/O
**When** a session runs `dream → profile → synthesize → scope → confirm`
**Then** the core advances deterministically, asks the profile question after the dream, performs exactly ONE synthesize call (autonomous), and ends with a `{ scope, profile }` result plus a confirm/restart decision. The state machine exposes a seam where v0.3.a-2 can insert clarifying turns. Pure/injected — no real claude/web/fs.
Tag: `@unit`.

### AC-2: Autonomous BMAD invocation + honest fallback
**Given** a dream + profile
**When** `elicit` builds the autonomous `bmad-product-brief` prompt (profile-aware) and runs `claude -p` headless
**Then** it returns the synthesized scope text; the prompt instructs headless/autonomous (no questions) and a walking-skeleton cap (one capability + ≤2 extras); a failed/empty/unparseable reply triggers a clean fallback to the verbatim dream with a logged note (no fabrication). Uses the existing env allowlist + timeout handling; testable via a fake-claude fixture (`MMD_AUTODEV_CMD`-style seam).
Tag: `@unit` (injected spawn) + `@integration` (fake claude).

### AC-3: Profile-first, Kid-aware, persisted
**Given** the dialogue
**When** the profile step runs
**Then** the profile question is asked right after the dream; `Kid` keeps `safe-by-default` framing in the prompt; the chosen profile is written to `status.json.profile`; an absent/invalid profile defaults to `Curious`.
Tag: `@unit`.

### AC-4: Web surface end-to-end
**Given** `mmd serve` running
**When** a client calls `POST /api/catch/start {dream}` → `POST /api/catch/answer {sessionId, answer:profile}` → `POST /api/catch/confirm {sessionId}`
**Then** `start` returns `{sessionId, next:"profile"}`; `answer` runs the autonomous synthesize and returns `{next:"scope", scope}`; `confirm` writes the scope into `status.json.dream`, launches auto-dev via the existing pipeline, and returns the existing `{jobId, streamUrl}` (SSE takes over). Session state is held server-side (in-memory map, single-user localhost). The dialogue is archived to `.mmd/local/dream-catcher/<ts>.md`. The legacy `POST /api/dream` path still works unchanged.
Tag: `@integration`.

### AC-5: Web UI multi-step flow
**Given** the served page
**When** the user walks dream → profile → scope
**Then** `bin/serve-ui/` presents: a dream input, then 3 profile buttons (Enfant / Curieux / Pro), then a scope card with **Recommencer** (restart) and **C'est parti !** (confirm → launch → existing SSE progress view). No involvement-level chooser and no scope editor in this slice.
Tag: `@integration` (served assets present + wired) or `@unit` for the route/handler logic.

### AC-6: Docs + ADR + lesson
**Given** v0.3.a-1 ships
**When** the docs are read
**Then**: an ADR numbered 021 documents the Dream Catcher design (BMAD-backed, headless autonomous + the MMD-orchestrated guided model deferred to a-2, web-first, honest fallback) and references SPEC_V03A; `docs/lessons-learned.md` gains a formal **L-021** entry (with `Category`/`Applies to`/`Keywords`) capturing "headless `claude -p` has no stdin, so multi-turn elicitation must be MMD-orchestrated stateless calls"; `README.md` mentions Dream Catcher in `mmd serve`.
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/dream-catcher/            (NEW — surface-agnostic core)
  session.js                  state machine: dream → profile → synthesize → scope → confirm
  elicit.js                   build autonomous bmad-product-brief prompt + headless claude -p
  parse-reply.js              pure: reply → { scope } | { unparseable }
  profile.js                  Kid|Curious|Pro + tone hints (default Curious)

lib/server.js                 MODIFY — add /api/catch/start|answer|confirm; keep /api/dream
bin/serve-ui/                 MODIFY — multi-step flow (dream → profile → scope card)
lib/state.js                  reuse — status.json (+ profile field), .mmd/local archive
lib/invoke-autodev.js         reuse — buildSubprocessEnv + the existing launch on confirm
```

### Files modified / added
```
make-my-dreams/
├── lib/dream-catcher/{session,elicit,parse-reply,profile}.js   # NEW
├── lib/server.js                                               # modified — catch routes
├── bin/serve-ui/{index.html,app.js,style.css}                  # modified — multi-step UI
├── test/unit/dream-catcher-{session,elicit,parse-reply,profile}.test.js  # NEW
├── test/integration/dream-catcher-web.test.js                  # NEW
├── docs/lessons-learned.md                                     # modified — L-021
├── docs/adr/021-dream-catcher.md                               # NEW
├── README.md                                                   # modified
└── package.json                                                # modified — 0.3.0
```

---

## 4. Out of scope for v0.3.a-1 (→ v0.3.a-2 unless noted)
- ❌ Involvement dial (Équilibré / Guidé multi-turn) — a-2.
- ❌ Scope editing before launch — a-2.
- ❌ CLI/TTY surface — v0.3.b.
- ❌ Full `MMD_PROFILE` env/global config — only the `status.json.profile` field here.
- ❌ Multi-user / auth on the server (stays single-user localhost).
- ❌ **Scale assumption**: one in-flight dream + in-memory session map (today's server constraint) — fine for single-user.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V03A1.md (this file) and the parent [SPEC_V03A.md](SPEC_V03A.md) §1–3 for the full design context.
2. Read `lib/server.js` (existing routes + `handlePostDream` + SSE wiring) and `bin/serve-ui/{index.html,app.js}` to extend, not rewrite.
3. Read `lib/invoke-autodev.js` for the `claude -p` spawn + `buildSubprocessEnv` env allowlist + timeout handling — reuse it in `elicit.js`; mirror the `MMD_AUTODEV_CMD` fake-runner seam for `@integration` tests (do NOT call the real `claude` in tests).
4. The autonomous prompt that the smoke test proved works: instruct headless + autonomous + "no questions" + walking-skeleton cap (one capability + ≤2 extras) + profile awareness. Keep `parse-reply.js` defensive (LLM output — validate before trust, ai-coding §III).
5. Honest fallback to verbatim dream on any BMAD failure (universal §VI), like the 5-Whys sacred fallback.
6. Constitution bindings: universal (§VI, §VII), ai-coding, commit-git, testing, error-handling, security (untrusted web input — validate/escape), safe-by-default (Kid).

## 6. Definition of done
1. All 6 ACs met.
2. Full suite passes (current 1087 + new tests).
3. `mmd serve` → web flow dream → profile → autonomous scope → confirm → auto-dev launches with the scope; legacy `/api/dream` still works.
4. Honest fallback verified (BMAD failure → verbatim dream + note, no fabricated scope).
5. README + ADR-021 + L-021 in place.
6. Version bumped to `0.3.0`.
7. Slice merged (ff-only) + tag `v0.3.0`.
8. 15th reflexive use of `mmd --here` (2nd with `--label`). Surface-agnostic core leaves a clean seam for v0.3.a-2 (dial + edit).

---

*Spec v0.3.a-1 — the Dream Catcher walking skeleton: one autonomous BMAD call, web-only, profile-first, honest fallback. Carves the thinnest vertical out of the frozen SPEC_V03A; the involvement dial + scope editing follow in v0.3.a-2.*
