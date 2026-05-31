# Make My Dreams — v0.3.a-2 Spec: Dream Catcher involvement dial + scope editing

> Second (and final core) phase of the frozen [SPEC_V03A.md](SPEC_V03A.md), built on the v0.3.0 walking skeleton. v0.3.a-1 shipped the Autonome path (one headless `bmad-product-brief` call) on a surface-agnostic core that left explicit seams: the `clarify()` async hook in `session.js` and the `{question}` shape stubbed in `parse-reply.js`. v0.3.a-2 fills those seams to deliver the two remaining frozen-design pieces: (1) the **involvement dial** — Autonome / **Équilibré (default)** / Guidé = **0 / 1 / 2–3** MMD-orchestrated clarifying turns (both modes already de-risked by smoke tests, see SPEC_V03A §1 and L-021), and (2) **scope editing** before launch. The API surface stays exactly what SPEC_V03A froze (`/api/catch/start|answer|edit|confirm`): `/answer` becomes **state-driven** (it advances profile → level → clarifying answers → scope), so the front end just renders whatever `next` the server returns.

---

## 1. Goal of v0.3.a-2

Complete the Dream Catcher flow:

```
dream → profile → LEVEL → [question → answer] × (0|1|2–3) → scope (editable) → confirm → auto-dev
```

Deliverables:
1. **Involvement dial** — new `lib/dream-catcher/level.js`: `Autonome | Équilibré | Guidé`, normalized (default **Équilibré**), with a turn-count mapping `0 | 1 | 2–3`.
2. **Multi-turn elicitation** — fill the `clarify()` seam: for a level with N>0 turns, MMD runs N stateless headless calls that each ask ONE clarifying question, collecting the user's answer between calls; a final stateless call synthesizes the scope from `dream + profile + all Q&A`. Autonome (N=0) keeps the a-1 single-synthesize path unchanged.
3. **Parameterized elicit** — `buildElicitPrompt` gains a `mode` (`autonome` | `ask_question` | `synthesize`) + `previousAnswers`; `parse-reply.js` gains the `{question}` shape (already stubbed).
4. **Scope editing** — `session.editScope(text)` (stays in SCOPE) + a `POST /api/catch/edit` route; the user can revise the synthesized scope before confirming.
5. **State-driven `/answer`** — one route advances the session by its current state; the response `{next, ...}` (`next ∈ level | question | scope`) tells the UI what to render. `/start`, `/edit`, `/confirm` round out the SPEC_V03A API — no new public routes beyond `/edit`.
6. **Web UI** — add a level chooser, a single-question step, and an edit affordance to the existing step-based `bin/serve-ui/`.

**Carried over unchanged** (proven in a-1): CSRF/Host preflight, single-in-flight synthesize guard, honest fallback to verbatim dream, archive to `.mmd/local/dream-catcher/`, the `MMD_AUTODEV_CMD` fake-claude test seam.

**Not in this slice** (→ v0.3.b): CLI/TTY surface; full `MMD_PROFILE` env threading into the auto-dev subprocess.

**Mission validation**: in the web UI, a child picks **Guidé**, answers 2 friendly questions, sees a scope tailored to those answers, edits one line, and launches — and a user who picks **Autonome** still goes straight from profile to scope (the a-1 path), all green and tested.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: Involvement-level enum + turn mapping
**Given** `lib/dream-catcher/level.js`
**When** loaded
**Then**: a frozen `LEVELS` enum exposes `Autonome | Équilibré | Guidé`; `normalizeLevel(input)` accepts canonical + friendly aliases (e.g. `autonome`/`simple`, `équilibré`/`equilibre`/`balanced`, `guidé`/`guide`/`detailed`) and defaults to **Équilibré** on absent/unknown input (never throws); a turn-count mapping returns **0 / 1 / 2** (Guidé MAY ask up to 3 — cap at 3) clarifying turns respectively.
Tag: `@unit`.

### AC-2: Session state machine — level + clarifying turns
**Given** the extended session (`level`, `answers[]` fields added)
**When** it advances
**Then**: the flow is `dream → profile → level → clarify×N → synthesize → scope → confirm`; after `profile` the next expected input is the **level**; for N=0 (Autonome) it synthesizes immediately (the a-1 path, unchanged, still exactly ONE synthesize call); for N>0 it emits one question at a time and records each answer in `answers[]`, synthesizing only after the Nth answer; bad-state inputs are rejected with a clear error. Pure/injected (fake `elicit`), deterministic.
Tag: `@unit`.

### AC-3: Parameterized elicit + `{question}` parsing
**Given** `elicit.js` and `parse-reply.js`
**When** a turn runs
**Then**: `buildElicitPrompt({dream, profile, mode, previousAnswers})` produces — for `mode:'ask_question'` — a prompt that instructs BMAD to return EXACTLY ONE clarifying question (no brief); for `mode:'synthesize'` — a prompt that synthesizes the scope from the dream + all prior Q&A; `mode:'autonome'` is the a-1 prompt unchanged. `parseReply` returns `{question}` when the reply is a single question and `{scope}` when it is a scope (the prompt tags its output so detection is deterministic, not heuristic guessing); unparseable still falls back. The fake fixture (`test/fixtures/fake-claude-elicit.sh`) is extended to branch on mode.
Tag: `@unit` + `@integration` (fake fixture).

### AC-4: Scope editing
**Given** a session in SCOPE state
**When** `POST /api/catch/edit {sessionId, scope}` is called (or `session.editScope(text)`)
**Then**: the scope text is replaced (validated non-empty, length-capped), the session STAYS in SCOPE (no relaunch, no extra BMAD call), and the route returns `{next:"scope", scope}`; editing outside SCOPE state is rejected; the same CSRF/Host preflight as the other catch routes applies. A subsequent `/confirm` launches with the edited scope.
Tag: `@unit` + `@integration`.

### AC-5: State-driven web flow end-to-end (all 3 levels)
**Given** `mmd serve`
**When** a client drives `/api/catch/start` → `/answer`(profile) → `/answer`(level) → `/answer`(clarify)×N → (optional `/edit`) → `/confirm`
**Then**: `/answer` advances by session state and returns `{next}` ∈ `level | question | scope`; **Autonome** reaches `scope` right after the level answer (one synthesize); **Équilibré** asks 1 question then scope; **Guidé** asks 2–3; the single-in-flight guard still serializes synthesize calls; `/confirm` launches auto-dev with the (possibly edited) scope via the existing pipeline + SSE. The legacy one-shot `POST /api/dream` still works.
Tag: `@integration` (fake claude).

### AC-6: Web UI — level chooser, question step, edit affordance
**Given** the served page
**When** the user walks the flow
**Then**: after the profile buttons, a **level** step offers Autonome / Équilibré / Guidé; for guided levels a **question** step shows ONE question + an input and loops until the scope arrives; the scope card gains **✏️ Modifier** (→ an edit textarea pre-filled with the scope → save re-renders the card) alongside Recommencer / C'est parti !. `showStep()` is extended for the new steps; the autonomous path skips the question step.
Tag: `@integration` (served assets present + wired) or `@unit` for the handler logic.

### AC-7: Docs
**Given** v0.3.a-2 ships
**When** docs are read
**Then**: an ADR numbered 022 documents the dial (level → turn count, state-driven `/answer`, `{question}`/`{scope}` tagging) + scope editing, referencing SPEC_V03A and L-021; `README.md`'s Dream Catcher section is updated for the 3 levels + editing.
Tag: `@unit` anchors.

---

## 3. Architecture (incremental)

```
lib/dream-catcher/
  level.js          NEW — Autonome|Équilibré|Guidé enum, normalize (default Équilibré), turn count 0/1/2-3
  session.js        MODIFY — add level + answers[]; fill clarify() seam (N-turn loop); editScope() setter;
                    state-driven advance (profile → level → clarify×N → synthesize → scope)
  elicit.js         MODIFY — buildElicitPrompt({dream,profile,mode,previousAnswers}); modes autonome|ask_question|synthesize
  parse-reply.js    MODIFY — add {question} shape (output-tag based, deterministic)

lib/server.js       MODIFY — /answer becomes state-driven (profile|level|clarify); add /api/catch/edit
bin/serve-ui/       MODIFY — #step-level, #step-question, #step-edit; showStep() + handlers
test/fixtures/fake-claude-elicit.sh   MODIFY — branch on mode (ask_question vs synthesize)
```

### Files modified / added
```
make-my-dreams/
├── lib/dream-catcher/level.js                              # NEW
├── lib/dream-catcher/{session,elicit,parse-reply}.js       # modified
├── lib/server.js                                           # modified — state-driven /answer + /edit
├── bin/serve-ui/{index.html,app.js,style.css}              # modified — level/question/edit steps
├── test/unit/dream-catcher-level.test.js                   # NEW
├── test/unit/dream-catcher-{session,elicit,parse-reply}.test.js  # modified — extend
├── test/integration/dream-catcher-web.test.js              # modified — 3-level + edit flows
├── test/fixtures/fake-claude-elicit.sh                     # modified — mode-aware
├── docs/adr/022-dream-catcher-dial-and-edit.md             # NEW
├── README.md                                               # modified
└── package.json                                            # modified — 0.3.1
```

---

## 4. Out of scope for v0.3.a-2
- ❌ CLI/TTY surface — v0.3.b.
- ❌ Full `MMD_PROFILE` env threading into the auto-dev subprocess — v0.3.b.
- ❌ Editing the scope AFTER launch, or re-running elicitation from an edit (edit is a plain text replace).
- ❌ Branching/divergent brainstorming — convergence only (unchanged from a-1).
- ❌ **Scale assumption**: Guided caps at 3 turns; in-memory single session; one in-flight synthesize — fine for single-user localhost.

## 5. Implementation hints (for auto-dev)
1. Read SPEC_V03A2.md (this file), the parent [SPEC_V03A.md](SPEC_V03A.md), and [SPEC_V03A1.md](SPEC_V03A1.md).
2. The seams are real and commented: `clarify()` in `lib/dream-catcher/session.js` and the `{question}` note in `lib/dream-catcher/parse-reply.js`. EXTEND, don't rewrite — the a-1 Autonome path (level=Autonome → 0 turns → one synthesize) MUST keep passing its existing tests.
3. Keep `/answer` state-driven: the session decides whether `answer` is a profile, a level, or a clarifying answer based on its current state; respond `{next}` ∈ `level|question|scope`. This preserves the SPEC_V03A API (no `/level` or `/clarify` public routes).
4. Make `{question}` vs `{scope}` detection DETERMINISTIC: have the `ask_question`/`synthesize` prompts tag their output (e.g. a leading marker) so `parse-reply` keys off the tag, not a fragile heuristic (L-021 spirit — MMD controls each turn's intent).
5. Reuse everything proven in a-1: CSRF/Host preflight, single-in-flight guard, honest fallback (universal §VI), `MMD_AUTODEV_CMD` fake seam. Extend the fixture to answer differently per mode.
6. Constitution bindings: universal (§VI, §VII), ai-coding, commit-git, testing, error-handling, security (untrusted web input), safe-by-default (Kid).

## 6. Definition of done
1. All 7 ACs met.
2. Full suite passes (current 1145 + new tests).
3. `mmd serve`: Autonome → scope after profile+level (one synthesize); Équilibré → 1 question → scope; Guidé → 2–3 questions → scope; ✏️ edit replaces the scope; `/confirm` launches with the edited scope. Legacy `/api/dream` still works.
4. Honest fallback intact (BMAD failure on any turn → verbatim dream + note, no fabrication).
5. README + ADR-022 in place.
6. Version bumped to `0.3.1`.
7. Slice merged (ff-only) + tag `v0.3.1`.
8. 16th reflexive use of `mmd --here` (3rd with `--label`). Dream Catcher core complete; v0.3.b (CLI surface + profile threading) is the only remaining v0.3 work.

---

*Spec v0.3.a-2 — completes the Dream Catcher core: the involvement dial (Autonome/Équilibré/Guidé = 0/1/2–3 MMD-orchestrated turns, both modes smoke-tested) + scope editing, filling the seams the walking skeleton left. State-driven `/answer` keeps the frozen SPEC_V03A API. CLI surface + profile threading remain for v0.3.b.*
