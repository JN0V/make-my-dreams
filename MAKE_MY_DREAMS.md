# Make My Dreams — Scoping Document (v14)

> **Objective**: enable any human — from a 13-year-old kid to a pro developer — to describe an application need in natural language and see a **MVP delivered quickly**, then enriched iteratively, by an autonomous AI. The tool must work equally well in **greenfield** and **brownfield** modes, and must itself stay up to date with the latest advances in the AI-dev ecosystem through an **automated watch**.
>
> **Initial target use cases**:
> 1. A drawing app that overlays an image on the camera feed.
> 2. A Subway Surfers-style video game.
> 3. (Implicit) Any of Sébastien's pro needs — features on existing code, prototypes, internal tools.
>
> **Status**: scoping v14 — **new v0.2.5 milestone added**: a minimal `mmd serve` command that starts a local HTTP server and opens a simple web page in the browser, making MMD accessible to non-technical users (Sébastien's daughter being the primary motivation) **without any IDE, terminal, or CLI knowledge**. This restores priority to MMD's differentiator #1 (multi-audience accessibility) which was scheduled too late in v13's roadmap (v0.10). The implementation is intentionally trivial (~300 lines: simple Node server + vanilla HTML page + SSE for progress + `mmd serve` CLI subcommand that opens the browser). No tunnel, no cloud, no deployment — same machine that runs `mmd` also serves the page. Remote access (phone via Wi-Fi, or Cloudflare Tunnel for true public access) deferred to v0.6+. Otherwise unchanged from v13.

---

## 1. Context and existing assets

Sébastien has travelled a progressive path:

- Windsurf → ChatGPT → Claude direct
- Adoption of Spec-Driven Development (SDD)
- Trying **Spec Kit** (strong appreciation for the *constitution*)
- Trying **BMAD** (strong appreciation for the *agent-personas* and the *modular structure* — but a "V-cycle" feel that slows down going to production)
- Creation of **Extend BMAD** / `auto-dev` (originally `install-auto-dev.sh`, renamed `install-mmd.sh` in v13 — see lineage in script header): 4-phase orchestrator combining BMAD's quick-dev + party mode + adversarial review loops + constitution injection. Already a highly polished Spec Kit ⇄ BMAD hybrid.

**Make My Dreams** is the next step: producing a usable MVP in minutes (not hours of ceremony), keeping the long-term vision in mind at every iteration, working on new as well as existing code, and remaining accessible to a non-technical human without sacrificing power for a pro.

**MMD lives in the `extend-bmad` repo itself** (this very repo) — it is not a separate project. The repo started as an Extend BMAD customization, the scoping document captures 12 versions of design rationale, and `install-mmd.sh` (already at the repo root) becomes MMD's **Standard engine** (cf §3.1). Folder rename `extend-bmad/` → `make-my-dreams/` is optional and can wait. Git history preserves the full thread.

---

## 1bis. Positioning and credits

**MMD does not replace existing frameworks. MMD stands on their shoulders.**

Make My Dreams is the direct fruit of accumulated hands-on experience with **Spec Kit**, **OpenSpec**, **BMAD** and **gStack**. Each of these frameworks brought a piece of the answer:

- **Spec Kit** (GitHub) — showed the value of a versioned **constitution** that travels with every prompt, and the discipline of treating specs as the real source of truth.
- **OpenSpec** ([Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)) — showed how Spec-Driven Development can be lightweight and adaptable, an alternative spec-first workflow that complements heavier approaches.
- **BMAD** ([bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)) — showed that named agent personas with distinct identities (Mary, Winston, Amelia, Quinn…) dramatically improve engagement, and that **real brainstorming workflows** (CIS with Carson, Maya, Dr Quinn, Victor, Sophia) belong in the developer's toolbox.
- **gStack** ([garrytan/gstack](https://github.com/garrytan/gstack)) — showed that an opinionated **catalogue of 41 mature skills** covering the full sprint (think → plan → build → review → test → ship → reflect) can move a developer from idea to deployed product with discipline.
- **Ralph Loop** ([Geoffrey Huntley](https://ghuntley.com/loop/)) — showed that a minimalist bounded loop sometimes beats an elaborate ceremony for fast iteration on a clear goal.

**What MMD adds is not technology. It is accessibility and orchestration.** Specifically:
1. Bridging the gap between a 13-year-old who wants to draw on a camera feed and a 30-year veteran who wants to validate an architecture decision — same tool, adapted experience.
2. Stitching these frameworks together so users don't have to learn each one individually.
3. Adding what none of them quite have: **reflexive bootstrap** (MMD improves MMD), **stateless hierarchical orchestration**, **brownfield Project Onboarder** that imports from any of the above frameworks, and **local parallelization via worktrees**.

The MMD README will reaffirm this positioning prominently. Every dependency on these projects is honored with explicit attribution. None of them is forked without a clear reason. **MMD's success is their success.**

---

## 2. Comparative analysis of reference frameworks

### 2.1 GitHub Spec Kit

**Identity**: GitHub toolkit for SDD. `specify` CLI + slash-commands (`/speckit.constitution`, `/speckit.specify`, `/speckit.clarify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.analyze`, `/speckit.implement`). Versioned artifacts. Philosophy: the spec IS the source code; generated code is disposable.

**Strengths**: the **constitution** is the flagship innovation. Clear linear structure. Agent-agnostic.

**Weaknesses**: too heavy for small projects. No agents with personality. No native adversarial review. CLI/Git/Markdown friction for a non-technical audience. **Rigid pipeline, little incremental capability.**

### 2.2 OpenSpec (Fission-AI/OpenSpec)

**Identity**: lightweight Spec-Driven Development framework, alternative to Spec Kit. Positions itself as easier-to-adopt and more adaptable than heavier SDD frameworks. Focuses on minimal ceremony while keeping the spec-first discipline.

**Strengths**: low friction to start, easy to learn, complements Spec Kit and BMAD when projects don't justify their weight. Active development community in 2025-2026.

**Weaknesses**: less rich than BMAD on agent personas, less mature than gStack on the full ship cycle. Best seen as a complement, not a replacement.

**Relevance for MMD**: candidate for the **FAST engine** spec amount (1-page minimal spec) when its lightweight philosophy fits MMD's "deliver an MVP in minutes" goal. The Project Onboarder (§6.7) will also detect and import OpenSpec specs alongside Spec Kit and BMAD when present.

### 2.3 BMAD (bmad-code-org/BMAD-METHOD)

**Identity**: modular ecosystem (BMM, BMB, CIS, TEA, BMGD). Concepts: modules / YAML workflows / reusable skills (e.g. party mode).

**Strengths**: distinct agent personalities (Winston, Amelia, Quinn, Christie, Mary, John, Sally, Bob), context embedded in stories (~90% token savings in v6), unique party mode. Strong extensibility through BMB.

**Weaknesses**: **too V-cycle** for fast MVPs — that's precisely the pain point to fix. Steep learning curve. No mass-market UI. Assumes Git/terminal/IDE.

### 2.4 gStack (garrytan/gstack)

**Identity**: ~30 slash commands for Claude Code (and 9 other AI agents), created by Garry Tan. *Virtual engineering team*: CEO, Designer, Eng Manager, QA Lead, CSO, Release Engineer. Pipeline Think → Plan → Build → Review → Test → Ship → Reflect.

**Unique strengths vs Spec Kit / BMAD**:
- **Actually deployed output** (`/land-and-deploy` + `/canary`) — closes the loop all the way to verified prod.
- **Executive QA** (`/qa`): opens a real browser, clicks, screenshots, fixes.
- **Forcing questions** (`/office-hours`): rephrases the need before any code.
- **Cross-model verification** (`/codex`).

**Weaknesses**: CLI-only, technical prerequisites (Bun, Node, Git), YC vocabulary, no formal agent tree.

### 2.5 Ralph Loop (Geoffrey Huntley — *"Ralph Wiggum as a Software Engineer"*)

**Identity**: minimalist pattern — not a framework, a shell loop. Concretely:

```bash
while :; do
  cat prompt.md | agent-cli  # Claude Code, Codex, Amp, etc.
done
```

The same prompt, executed in a loop, until convergence. The agent decides at each iteration what to improve by reading the repo state. Named after Ralph Wiggum (Simpsons) — the apparent stupidity of the pattern hides its effectiveness.

**Strengths**:
- **Absolute anti-V-cycle**: you get a deliverable on the 1st round, and each round enriches it.
- **Evolutionary pressure**: the agent sees a slightly better repo each time.
- **Crash-robust**: if an iteration fails, the next one picks up.
- **Low cost of errors**: you can stop at any time; intermediate code is usable.
- **Ideal for brownfield**: no heavy analysis phase — the agent inspects the repo on each round.

**Weaknesses**:
- No guarantee of convergence (can spin in circles).
- Potentially huge LLM cost (must be capped).
- No native user checkpoints — risk of drift if unguarded.
- No agent-personas, no editorial structure.

### 2.6 Enriched comparative summary

| Dimension | Spec Kit | BMAD | gStack | Ralph Loop |
|---|---|---|---|---|
| Structure | Strong, linear | Very strong, modular | Strong, sprint | **Minimal** |
| MVP speed | Medium | Slow (V-cycle) | Good | **Excellent** |
| Native iterative | Low | Low | Medium | **Excellent** |
| Greenfield | Good | Very good | Very good | Good |
| Brownfield | Medium | Medium | Good | **Very good** |
| Persona richness | Low | **Very high** | High | None |
| Constitution / principles | **Flagship innovation** | Possible | Implicit | To force in the prompt |
| Real browser QA | No | No | **Yes** | Possible |
| Loop to prod | No | No | **Yes** | To be added |
| LLM cost per project | Moderate | High | Moderate | **Must be capped** |
| Non-technical friendly | Low | Very low | Very low | Low |

**Reading**: no single framework covers the whole. The **mix** is unavoidable. Ralph Loop precisely fills the "MVP-first + iterative" gap missing from the other three, and is also the best native tool for brownfield.

---

## 3. Strategic recommendation

### 3.1 Guiding principle: **three engines, one brain**

Make My Dreams exposes **a single interface** to the human, but embeds **three execution engines** that a *Mode Router* chooses based on context. Moving from 2 to 3 engines (v8) addresses a finding: pure Ralph Loop does not always converge, and full `auto-dev` is sometimes excessive — an intermediate tier is needed.

- **FAST engine (Ralph Loop with minimal upfront spec)**: to iterate fast on clear brownfield, add a small feature, experiment. A 1-page **minimal spec** (constraints + acceptance criteria) is produced by the Dream Catcher in under 1 minute, then a bounded Ralph Loop iterates with capped budget/rounds. Without this upfront spec, Ralph diverges — that's what's observed in practice.
- **STANDARD engine (accelerated auto-dev)**: lightweight version of the 4-phase pipeline. Phase 1 Spec + Party Mode (1× instead of 3×), Phase 2 opportunistic adversarial review (skipped if Phase 1 robust), Phase 3 Implementation with 3 reviewers, Phase 4 final review. This is the **default mode** for requests that are neither trivial nor ambitious — i.e. the majority.
- **DEEP engine (full BMAD process)**: for ambitious greenfield projects or poorly known domains. Mobilizes the **full BMAD personas** — Mary (Analyst), John (PM), Winston (Architect), Sally (UX), Bob (SM) create detailed stories with embedded context; Amelia (Dev) implements; Quinn (QA) + Christie (Reviewer) validate. It's slow but the most robust on complex problems.

The **Mode Router** decides at launch (and can switch mid-flight). Heuristics:

| Signal | Recommended engine |
|---|---|
| Request fits in 1 sentence, project < 500 lines, clear brownfield | FAST |
| Medium-complexity request, reasonably clear context | STANDARD (default) |
| Ambitious greenfield ("a Subway Surfers-style video game") | DEEP |
| Unknown domain, many constraints, multiple stakeholders | DEEP |
| FAST failure after N rounds (stagnation) | Escalate to STANDARD |
| Repeated STANDARD failure on same case | Escalate to DEEP |

**Mapping with the Engagement Modes (§5.3)**:

| Engagement mode | Default engine | Override possible |
|---|---|---|
| Autonomous | FAST | yes (toward STANDARD or DEEP if Mode Router insists) |
| Intermediate | STANDARD | yes (both directions) |
| Guided | DEEP | rarely (a Guided user wanting FAST is suspicious) |

The mapping is a bias, not a rule: a technically complex project will remain DEEP even in Autonomous mode — but without the useless upfront questions (the Dream Catcher stays minimal).

### 3.2 Implementation strategy: **MMD on top of gStack**

#### Acknowledged finding (v10)

Honest comparative audit v9: gStack (Garry Tan, MIT) **is mature** and **already covers ~70%** of what MMD ambitioned to build from scratch. 41 operational skills, deployed, tested in YC production. Wanting to reimplement everything would be:
- a loss of at least 4-6 months
- an obsolescence risk before existence (ecosystem moves fast)
- a waste: these skills are MIT, may as well use them

#### Decision

**MMD = accessibility and orchestration layer on top of gStack**. MMD does not reimplement `/qa`, `/document-release`, `/cso`, `/context-save`, `/canary`, etc. — MMD **invokes those gStack skills** from its Workers, and builds *only* what does not exist elsewhere.

#### What MMD builds (its 6 real differentiators)

| # | Differentiator | Why gStack doesn't do it | Impact |
|---|---|---|---|
| 1 | **Multi-audience accessibility (Kid→Pro)**: Dream Catcher web/voice, profiles, engagement modes, adaptive vocabulary | gStack = CLI-only, English, founder/tech-lead tone | ⭐⭐⭐⭐⭐ — raison d'être of MMD |
| 2 | **Reflexive bootstrap + Compounding autolearning**: dream-bench, rule extraction from errors, conditional injection, promotion to constitution | gStack has `/learn` but not the full loop nor self-improvement | ⭐⭐⭐⭐ — long-term bet, cumulative effect |
| 3 | **Local parallelization via worktrees + Worker merger**: independence pre-flight, P-16 semantic conflicts, orchestrated merge | gStack has the primitives but not the orchestration | ⭐⭐⭐⭐ — solves a real pain point |
| 4 | **Brownfield Project Onboarder (3 cases)**: Spec Kit import, BMAD spec-sprawl consolidation, blank-project inference | Gap in all existing frameworks | ⭐⭐⭐⭐ — unique catch-up value |
| 5 | **Stateless hierarchical orchestration + auto-handoff**: Conductor/Orchestrator/Worker, externalized state, transparent handoff at 70% | gStack has `/context-save` but not the full architecture | ⭐⭐⭐ — scales long projects |
| 6 | **3 execution engines + Mode Router**: Fast (Ralph+spec) / Standard (lightweight auto-dev) / Deep (full BMAD) | gStack has a single sprint pattern | ⭐⭐⭐ — execution flexibility |

All other "additions" considered in v8/v9 (Diataxis Documentalist, DESIGN.md Mockup, polymorphic Reality Check, multi-layer Constitution, etc.) are **achieved by orchestrating gStack**, not by reimplementing.

#### Consequences on the roadmap

The §9 roadmap is **compressed by about 40%**: versions that "carried" a gStack skill disappear or transform into "integrates such-and-such gStack skill". MMD remains an ambitious but focused project.

### 3.3 MMD ↔ gStack orchestration map

Detailed table of each MMD component: which part is **built by MMD** and which part **invokes a gStack skill**.

| MMD component | Built by MMD | Invokes gStack |
|---|---|---|
| **Profile & Mode Selector (§4 box 0)** | Everything: profiles, engagement modes, brownfield detection | — |
| **Dream Catcher (§4 box 1)** | Conversational UI, voice, profile adaptation | `/office-hours` (6 YC forcing questions) in Autonomous/Intermediate mode for clarification |
| **Dream Expander (§4 box 1b)** | Detection of "to be expanded", routing to BMAD/CIS | BMAD `*brainstorm` workflow or CIS `/cis-brainstorm` (not gStack) |
| **Mockup Generator (§4 box 1c)** | Graduated adaptation by profile, MCP image-gen integration | `/design-consultation` (DESIGN.md), `/design-shotgun` (N variants) |
| **Plan-Review (§4 box 1d)** | Activation decision by profile | `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/plan-devex-review` |
| **Tech Architect (§4 box 2)** | Stack choice adapted to profile + Reality Check strategy selection | `/plan-tune` for auto-calibration |
| **Mode Router (§4 box 3)** | 3-engine routing logic + escalation heuristics | — (no gStack equivalent) |
| **Fast Engine (§4 box 3a)** | 1-page minimal spec, bounded Ralph loop | `/investigate` for in-loop debug |
| **Standard Engine (§4 box 3b)** | Lightweight auto-dev (existing Extend BMAD) | — |
| **Deep Engine (§4 box 3c)** | Orchestration of BMAD personas | — (pure BMAD process) |
| **Reality Check (§4 box 4)** | Multi-mode choice by deliverable, aggregation | `/qa`, `/qa-only`, `/design-review`, `/devex-review`, `/cso`, `/health`, `/canary` |
| **Dream Delivery (§4 box 5)** | Profile adaptation (kid-friendly notif vs Pro PR) | `/ship`, `/land-and-deploy`, `/canary`, `/setup-deploy` |
| **Retro & Trend (§4 box 5b)** | Profile-adapted retro format | `/retro`, `/health` |
| **Conductor (§4.2)** | Stateless 3-level architecture, `status.json` monitoring, parallelization | `/context-save`, `/context-restore` (primitives) |
| **Orchestrator (§4.2)** | Systematic delegation, auto-handoff at 70% | `/context-save` for handoff snapshot |
| **Worker merger (§4.3)** | P-16 semantic conflict detection | `/landing-report`, `/careful`, `/freeze`, `/guard` |
| **Project Onboarder (§6.7)** | SCAN/INGEST/INFER/REPORT protocol, 3 cases (Spec Kit / BMAD / blank) | `/scrape` for brownfield discovery |
| **Documentalist (§6)** | Event triggers, autolearning, lessons-learned | `/document-generate` (Diataxis), `/document-release` (post-ship sync), `/learn`, `/setup-gbrain` + `/sync-gbrain` (v0.9b) |
| **Automated watch `dev-ai-watch` (§8)** | Curated sources (GitHub trending, HN, Reddit, arXiv), scoring, digest, auto-PR | `/scrape` (collection) + `/skillify` (permanent codification of detected patterns) |
| **Multi-layer Constitution (§5.2)** | Dynamic composition by profile/mode/context + layer F autolearning | `/cso` for runtime security layer |

#### Invocation mechanism

Each MMD Worker that has to invoke a gStack skill does so through a **shell wrapper command** (`mmd-gstack-invoke <skill> <args>`) that:
- checks gStack skill availability
- formats arguments to what gStack expects
- retrieves and parses output
- injects it into `status.json` / `decisions.log` / MMD artifacts

The wrapper centralizes any necessary adjustments (error handling, retry, fallback). If gStack evolves (`/qa` changes its API), only the wrapper is impacted.

#### Controlled risk

Dependency on an external project → mitigation:
- Pinned gStack versions in MMD config
- Wrapper isolates the contact (gStack API change = targeted patch)
- If gStack disappears or diverges, MMD can fall back to a fork (Option 3 of the v10 debate) — not ideal but possible
- MIT license compatible

---

### 3.4 Long-term vision injected into each MVP

The "V-cycle" feeling disappears with **2 living artifacts** maintained side by side:

1. **`vision.md`**: the horizon — what the app will be in 6 months, what we're ultimately building. Maintained and updated at each user interaction.
2. **`slice.md`**: what we deliver **now** — this round's MVP. Seen as a slice of the complete cake.

Each Ralph round (and each BMAD phase) receives in its context **vision.md** AND **slice.md**, plus the constitution. Consequence: the MVP is delivered in 5 minutes, but it is architecturally compatible with the long-term vision — not a disposable prototype. It's the *walking skeleton* concept (Cockburn) applied to AI.

### 3.5 Reuse strategy (legacy v3 — partially superseded by §3.2/§3.3)

> Note: this table predates the v10 decision to use gStack as a runtime backbone. Many "Steal → skill X" entries are now realized via gStack invocation (cf §3.3 orchestration map). Kept for historical traceability.

| Building block | Origin | Status |
|---|---|---|
| `auto-dev` 4-phase pipeline | Existing Extend BMAD | **Keep** as DEEP engine fallback |
| Constitution injection | Extend BMAD + Spec Kit | **Keep + extend** (multi-profile) |
| Party mode | BMAD | **Keep** (DEEP mode only) |
| `/office-hours` (forcing questions) | gStack | **Invoke gStack** (was: steal) |
| `/qa` (real browser) | gStack | **Invoke gStack** (was: steal) |
| `/land-and-deploy` (real deliverable) | gStack | **Invoke gStack** (was: steal) |
| Bounded while loop | Ralph Loop | **Implement** → FAST engine |
| Mode Router | New | **Create** (MMD differentiator) |
| Dream Catcher (conversational UI) | New | **Create** (MMD differentiator) |
| Tech Architect (stack decider) | New | **Create** (MMD differentiator) |
| Automated watch | New | **Create** (MMD differentiator) |

---

## 4. Proposed architecture

The architecture is now structured into **3 stateless orchestration levels** + an application pipeline. The detail of each level is in §4.2; let's start with the overview:

```
╔════════════════════════════════════════════════════════════════╗
║  LEVEL 3 — CONDUCTOR (meta-orchestrator, minimal context)       ║
║  ────────────────────────────────────────────────────────────  ║
║  • NEVER writes code, NEVER reads large artifacts               ║
║  • Reads only: status.json + handoff/*.md (always light)        ║
║  • Spawn / monitor / handoff of orchestrators                   ║
║  • Coordinates parallelism between independent slices           ║
║  • Detects context saturation → triggers handoff                ║
╚══════════════════════════════════════╤═════════════════════════╝
                                       ▼  spawn / monitor
╔════════════════════════════════════════════════════════════════╗
║  LEVEL 2 — ORCHESTRATOR(S) (one per slice, light context)       ║
║  ────────────────────────────────────────────────────────────  ║
║  • Does not dev either — delegates everything via Agent tool    ║
║  • Maintains status.json + decisions.log + slice.md             ║
║  • At 70% of context: generates handoff.md and signals READY    ║
║  • Drives the application pipeline below                        ║
╚══════════════════════════════════════╤═════════════════════════╝
                                       ▼  spawn fresh subagents
╔════════════════════════════════════════════════════════════════╗
║  LEVEL 1 — APPLICATION PIPELINE (subagents with fresh contexts) ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  0. SESSION SETUP                                              ║
║     • Profile: Kid / Curious / Pro / Custom                    ║
║     • Engagement: Autonomous / Intermediate / Guided           ║
║     • Greenfield vs Brownfield (auto-detection)                ║
║                            │                                   ║
║                            ▼                                   ║
║  1. DREAM CATCHER (adaptive conversational UI)                 ║
║     • Chat (voice+text), vocabulary adapted to profile         ║
║     • Dialogue intensity by Engagement:                        ║
║       — Autonomous: 0–1 question, rephrasing, validation       ║
║       — Intermediate: 2–4 questions on real ambiguities        ║
║       — Guided: deep exploration, user stories, workshop       ║
║     • Skill dream-clarifier — inspired by gStack /office-hours ║
║     • Output: vision.md + slice.md                             ║
║                            │                                   ║
║                            ▼                                   ║
║  1b. DREAM EXPANDER (real BMAD/CIS brainstorming)              ║
║      • Port of BMAD brainstorming mode (Mary the Analyst) or   ║
║        CIS (Carson, Maya, Dr Quinn, Victor, Sophia)            ║
║      • Pattern: FACILITATOR COACH, not generator               ║
║        ("you ask the questions, not the answers")              ║
║      • 4 modes: User-Selected / AI-Recommended / Random /      ║
║        Progressive Flow (default)                              ║
║      • ~60 techniques (SCAMPER, 6 Hats, How Might We, What-If, ║
║        Reverse Brainstorming, Yes-And, mind mapping, etc.)     ║
║      • Anti-Bias Protocol every 10 ideas:                      ║
║        pivot perspective Tech → UX → Business                  ║
║      • Target 100+ ideas in Pro, 30-50 in Curious, 10-15 in Kid║
║      • Activated if Engagement ∈ {Intermediate if fuzzy, Guided}║
║      • Output: brief.md (feeds the PM agent / spec)            ║
║                            │                                   ║
║                            ▼                                   ║
║  1c. MOCKUP GENERATOR (optional — depends on engagement)       ║
║      • Always in Guided, on request in Intermediate,           ║
║        ASCII wireframe even in Fast (cost ~zero)               ║
║      • Graduated outputs by profile/time:                      ║
║        — ASCII / Mermaid wireframes (instant, Pro/Fast mode)   ║
║        — Clickable static HTML (PWA preview, ~30s)             ║
║        — Generated images via MCP image-gen if available (~1m) ║
║      • Also produces a DESIGN.md (port of gStack /design-      ║
║        consultation): typo, color, motion, aesthetic           ║
║      • Consumed by all downstream Workers                      ║
║      • Output: .mmd/shared/mockups/ + .mmd/shared/DESIGN.md    ║
║      • Checkpoint #1 (visual): "Is this what you want?" y/n    ║
║                            │                                   ║
║                            ▼                                   ║
║  1d. PLAN-REVIEW (quality gate before Tech Architect)          ║
║      • Port of gStack /plan-ceo-review + /plan-eng-review      ║
║         (+ /plan-design-review + /plan-devex-review if relevant)║
║      • 4 CEO modes: EXPAND / SELECTIVE / HOLD / REDUCE         ║
║        → decision on scope before locking the tech             ║
║      • Eng review: architecture, data flow, edge cases, perf   ║
║      • Design review: UX critique of the plan BEFORE impl      ║
║      • Devex review: if deliverable = product for developers   ║
║      • Output: plan-review.md + go/no-go to Tech Architect     ║
║                            │                                   ║
║                            ▼                                   ║
║  2. TECH ARCHITECT (stack decider AND Reality Check decider)   ║
║     • Reads vision + slice + plan-review + DESIGN.md +         ║
║       (if brownfield) repo state                               ║
║     • Chooses stack/framework, justifies at profile level      ║
║     • ALSO chooses Reality Check strategy (cf §4 box 4)        ║
║     • Auto-calibration of upcoming questions (port of gStack   ║
║       /plan-tune) — sensitivity tuning by profile              ║
║     → Output: tech-decision.md + reality-check.config.md       ║
║                            │                                   ║
║                            ▼                                   ║
║  3. MODE ROUTER (execution engine choice)                      ║
║         ┌───────────────────┼───────────────────┐              ║
║         ▼                   ▼                   ▼              ║
║  3a. FAST            3b. STANDARD          3c. DEEP            ║
║   (Ralph + minimal  (lightweight         (full BMAD:           ║
║    1-page spec)      auto-dev: 1×party,  PM Mary, Architect    ║
║   • bounded loop     opportunistic p2,    Winston, UX Sally,   ║
║   • capped budget    3 reviewers, p4)     SM Bob, stories,     ║
║   • stagnation       • default mode       Dev Amelia, QA Quinn,║
║     → escalation     • escalation DEEP    Christie reviewer)   ║
║         └───────────────────┬───────────────────┘              ║
║                             ▼                                  ║
║  4. REALITY CHECK (POLYMORPHIC — strategy chosen in §2)        ║
║                                                                ║
║     [a] Functional mode (always active)                        ║
║         • Web → Playwright (main) or Claude in Chrome          ║
║         • Mobile → iOS/Android simulators + Maestro / Appium   ║
║         • Browser game → Playwright + canvas perceptual diff   ║
║         • Game/native app → headless + screenshots + perceptual║
║         • CLI → exec + stdout/stderr/exitcode assertions       ║
║         • API → HTTP calls + schema+content assertions         ║
║         • Lib → generated unit tests + integration tests       ║
║                                                                ║
║     [b] Visual mode (port of gStack /design-review)            ║
║         Designer's eye QA: slop patterns, spacing, contrast,   ║
║         alignment with DESIGN.md — fix + re-screenshot         ║
║                                                                ║
║     [c] Devex mode (port of gStack /devex-review)              ║
║         Boomerang plan↔reality: promised TTHW vs measured,     ║
║         real onboarding errors. If deliverable = dev-tool.     ║
║                                                                ║
║     [d] Security mode (Security Worker — port of gStack /cso)  ║
║         OWASP + STRIDE + secrets archaeology + supply chain.   ║
║         2 levels: daily (fast) / comprehensive (deep).         ║
║                                                                ║
║     [e] Canary mode (port of gStack /canary) — POST-DEPLOYMENT ║
║         Monitoring: console errors, perf, screenshots vs       ║
║         baseline. Actually part of §5 Delivery.                ║
║                                                                ║
║     Runs enabled modes in parallel, aggregates, gap →          ║
║     immediate patch or return loop to Mode Router.             ║
║                            │                                   ║
║                            ▼                                   ║
║  5. DREAM DELIVERY (gStack /ship + /canary)                    ║
║     • Web → URL + QR  /  Mobile → APK or PWA                   ║
║     • Profile-adapted notification                             ║
║     • Visual Checkpoint #2: "Does it work? Change anything?"   ║
║                            │                                   ║
║                            ▼                                   ║
║  5b. RETRO & TREND (port of gStack /retro + /health)           ║
║      • Analyzes commits, diffs, patterns, slice velocity       ║
║      • Trend tracking: code quality, perf, error rates         ║
║      • Comparison vs previous slices (regression / progress)   ║
║      • Output: retro.md + feeds lessons-learned.md             ║
║      • Conditions Iterate relevance (continue? pivot?)         ║
║                            │                                   ║
║                            ▼                                   ║
║  6. ITERATE (re-entry through Dream Catcher in brownfield)     ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝

         Cross-cutting Workers (used at all levels)
         ─────────────────────────────────────────────────
         CONTEXT Worker — port of gStack /context-save + /context-restore
           State snapshot + cross-workspace restore primitives.
           Critical for: parallel worktrees, post-crash resume,
           handoff (§4.2). Exposed to all Workers.
         SECURITY Worker — port of gStack /cso (cf Reality Check [d])
         SAFETY HOOKS — ports of /careful + /freeze + /guard
           PreToolUse hooks against destructive ops (rm -rf, DROP, force-push)
           Activated on Conductor in parallelism mode (worktrees).

         Externalized state (source of truth, readable by all)
         ────────────────────────────────────────────────────
         /vision.md         the horizon — what we're ultimately building
         /slice.md          current round's MVP
         /status.json       where we are: tasks done/wip/blocked
         /decisions.log     choices made + their rationale
         /handoff/N.md      summary for a successor (if saturation)
         /constitution/     layers assembled at session start

         Consolidated documentation (maintained by Documentalist)
         ────────────────────────────────────────────────────
         /docs/architecture.md     living schema, updated on ADR
         /docs/features/*.md       one file per delivered feature
         /docs/user-guide.md       user doc (profile-adapted)
         /docs/adr/NNN-*.md        Architecture Decision Records
         /docs/lessons-learned.md  autolearning (deduced rules)
         /CHANGELOG.md             readable journal of changes


         ┌─────────────────────────────────────────────────┐
         │  DOCUMENTALIST (event-driven Worker, side-car)  │
         │  Triggered by: slice DONE, ADR, error fixed     │
         │  → Updates /docs/* by consolidating             │
         │  → Autolearning loop §6                         │
         └─────────────────────────────────────────────────┘
```

### 4.2 Stateless hierarchical orchestration + auto-handoff

For some time Sébastien has been using a manual pattern: launching a Claude "orchestrator" that only delegates (`Agent` tool), to preserve his context and keep an overall view. The problem: despite this, the orchestrator ends up saturating its context and he has to `/compact` manually. Make My Dreams **automates this pattern** across 3 levels and adds **transparent context handoff**.

#### Principle: *stateless* + *externalized state*

No level (Conductor, Orchestrator, Worker) maintains critical internal state. **All truth is in the files** (`vision.md`, `slice.md`, `status.json`, `decisions.log`). Consequence: any level can be **killed and recreated from scratch**; a fresh new agent reads the artifacts and continues exactly where the previous one stopped. This is the property that makes handoff trivial.

#### The Conductor (level 3) — ultra-light context

Role: **observe without participating**. It never reads code, never reads `vision.md` or `slice.md` in full — it consults only `status.json` (a few KB) and the latest `handoff/N.md` (1 page max). Its context stays under 10k tokens even on long projects.

Its 4 exclusive responsibilities:

1. **Spawn**: launch an Orchestrator at the start of each slice.
2. **Monitor**: poll `status.json` and the token-count reported by the Orchestrator.
3. **Handoff**: when the Orchestrator signals `READY_FOR_HANDOFF`, spawn a fresh successor that picks up.
4. **Parallel**: if several independent slices are identified (e.g. "drawing app" AND "video game" requested in parallel), spawn multiple concurrent Orchestrators.

The Conductor itself can be recreated at any time — its only knowledge is in `status.json`.

#### The Orchestrator (level 2) — light context, never devs

Role: **drive the application pipeline** without ever writing code itself. It uses exclusively the `Agent` tool to delegate each step to a sub-agent in fresh context. This is exactly the pattern of the current `install-mmd.sh`, but formalized and systematized.

On each delegation: it writes a prompt that injects `vision.md` + `slice.md` + `constitution.md` (bundle assembled per §5) + the task-specific context. The sub-agent does the real work and returns a compact summary. The Orchestrator updates `status.json` and moves on.

**Auto-handoff mechanism**:

```python
# pseudo-code of the Orchestrator loop
def orchestrator_tick():
    token_used = get_current_context_tokens()
    if token_used > HANDOFF_THRESHOLD * MAX_TOKENS:  # e.g. 70%
        write_handoff(
            file=f"handoff/{next_id}.md",
            content=summarize_state(),  # 1 page: where we are, next step
        )
        update_status_json(state="READY_FOR_HANDOFF")
        return  # the Conductor will see and spawn a successor
    next_task = pick_next_task_from_status_json()
    if next_task is None:
        update_status_json(state="DONE")
        return
    result = delegate_via_agent_tool(next_task)
    update_status_json(task=next_task, result=result)
```

The **handoff threshold** (70% by default) is conservative: it leaves 30% margin to generate a clean summary. Configurable per profile (tighter on Kid, larger on Pro where fewer interruptions are wanted).

#### The Workers (level 1) — fresh contexts, never survive

Each sub-agent spawned by the Orchestrator (and each sub-sub-agent spawned internally by `auto-dev` Phase 1-4) has an **isolated fresh context**. It does its task, returns its result, dies. No saturation problem at this level since lifespan is short.

The Workers themselves can follow the stateless pattern: if a very heavy Worker (e.g. full implementation of a complex feature) approaches the ceiling, **it too can trigger a mini-handoff** to its parent Orchestrator, which will re-spawn a successor.

#### Recursive composition

The pattern is intentionally recursive. An Orchestrator can spawn an `auto-dev`, which is itself a mini-orchestrator, which spawns its 3 reviewers, etc. At each level, the same `status.json` + `handoff/*.md` protocol can apply in a subfolder. This uniformity allows scaling without adding complexity.

#### Practical implementation

- **MVP (v0.4)**: Orchestrator alone, with auto-handoff. No formal Conductor yet — Sébastien plays the role (he observes `status.json`, restarts manually if needed).
- **v0.5**: Conductor introduced, `status.json` monitoring, automatic handoff.
- **v0.6+**: Conductor able to parallelize multiple Orchestrators on independent slices.

The existing `install-mmd.sh` already provides 80% of the Orchestrator building blocks — what's mainly needed is to add (1) `status.json` read/write, (2) token-count monitoring, (3) handoff protocol.

### 4.3 Local parallelization via git worktrees

Sébastien hits a recurring pain point: he's forced to sequence his evolutions because he works on a single repo locally and can't test multiple independent changes at the same time. The Conductor parallelization (§4.2) solves this on the orchestration side; it now needs to be materialized on the **filesystem** side: MMD must be able to have **multiple parallel workspaces** as if it were a team of developers on the same project.

#### Pattern: git worktree per slice

`git worktree` lets you have N copies of the same repo on different branches, sharing the same `.git/`. It's very disk-light (no duplication of git objects), instant to create, and natively managed by git. That's precisely what Cursor 2.0 adopted (cf P-15 in the appendix).

#### Mechanism

```
mmd dream --parallel "add a dark mode" "add a sharing feature"
            │
            ▼
Conductor detects --parallel mode
            │
            ▼
Conductor runs the PRE-FLIGHT CHECK: are the two slices
independent? (module/file dependency analysis via Worker explorer)
            │
            ▼
If YES → continue. If NO → clear error ("these slices touch
the same files — sequence them or split them differently").
            │
            ▼
Conductor creates 2 git worktrees:
  ../<repo>-slice-dark-mode      (branch slice/dark-mode)
  ../<repo>-slice-sharing         (branch slice/sharing)
            │
            ▼
Conductor spawns 2 concurrent Orchestrators, one per worktree.
Each Orchestrator drives its pipeline in its isolated worktree.
            │
            ▼
When a slice reaches DONE:
  - Reality Check in its worktree
  - Dream-bench
  - If OK → opens a PR on the main branch of the primary repo
            │
            ▼
If both slices reach DONE, ORCHESTRATED MERGE:
  - Semantic conflict detection (P-16, bundle E below)
  - If clean → automatic merge (configurable squash)
  - If conflict → "merger" Worker resolves or escalates to human
```

#### Promotion of P-15 and P-16 to default bundles

With parallelization as a first-class feature, two issues so far "out of bundle" become critical:

- **P-15 (file-level parallel conflicts)**: handled by construction thanks to worktrees (each Worker edits in its isolated worktree, no race).
- **P-16 (semantic conflicts)**: cannot be handled by worktrees — two slices may touch different files but break a shared contract (e.g. API renamed on one side, called from the other). Requires a cross-cutting **`merger` Worker** to validate consistency before merge.

These two issues are promoted into a **Bundle E "Parallelism"** automatically enabled as soon as `--parallel` is used (or the Conductor auto-detects independent slices in auto mode).

#### Guardrails

- **Blocking independence detection**: no parallel if slices touch the same files / modules / contracts. The pre-flight is strict.
- **Parallelism limit**: max 3 concurrent slices by default (configurable). Beyond that, LLM cost explodes and orchestrated merging becomes a headache.
- **Worktrees auto-cleaned** after merge (success or abort).
- **Short-lived branches**: each worktree = an ephemeral branch, never long-lived.

#### Implication for the reflexive bootstrap (§7)

When MMD develops itself, the parallel mode is particularly valuable: Sébastien can launch "improve the Documentalist" and "add voice mode" in parallel without blocking one on the other. The MMD repo itself becomes a premium use case for parallelization.

### 4.4 Bounded Ralph loop — detailed spec

```python
# pseudo-code
def ralph_engine(vision, slice, constitution, repo_state):
    tour = 0
    budget_used = 0
    while tour < MAX_TOURS and budget_used < MAX_BUDGET:
        # Minimal prompt injected at every round
        prompt = f"""
        VISION (long-term horizon): {vision}
        SLICE (this round's deliverable): {slice}
        CONSTITUTION (non-negotiable): {constitution}
        CURRENT REPO STATE: (the agent reads the repo each round)

        Make a significant improvement that brings the repo
        closer to SLICE, while staying compatible with VISION and
        CONSTITUTION. If SLICE is complete, say "DONE" and stop.
        """
        result, cost = run_agent(prompt)
        budget_used += cost
        tour += 1
        if "DONE" in result and tests_pass():
            return SUCCESS
        if same_state_as_previous_tour():
            return STAGNATION  # triggers STRUCTURED escalation
    return TIMEOUT
```

**Guardrails**: round cap (e.g. 10), cost cap (e.g. 5 USD), stagnation detection (same diff 2 rounds in a row), user checkpoint beyond N=3 if on a Kid profile.

---

## 5. User experience customization

Three orthogonal axes allow tailoring the experience without changing the engine:

| Axis | Question it answers | Main influence |
|---|---|---|
| **Profile** (§5.1) | Who is the user? | Vocabulary, guardrails, presentation |
| **Engagement** (§5.3) | How much do they want to exchange? | Dialogue intensity, number of checkpoints |
| **Constitution** (§5.2) | Which rules apply? | Additive layers by profile + context |

These axes are **independent**: a Pro can be Autonomous (they know what they want, "do it"), a Kid can be Guided (the AI helps them formulate their dream step by step), but the inverse exists too (a Pro in Guided mode on an unknown domain; an Autonomous Kid who knows *exactly* the game they want).

### 5.1 Profiles

| Profile | Audience | Vocabulary | Checkpoints | Agent verbosity |
|---|---|---|---|---|
| **Kid** | Child 8–14 years | Very simple, image-rich, emojis | Visual, frequent | Minimal, encouraging |
| **Curious** | Non-dev adult, advanced teen | Casual, no jargon | Visual + textual | Moderate, pedagogical |
| **Pro** | Sébastien and all devs | Assumed technical | Text/diff/PR | Rich, shows detail |
| **Custom** | Special cases (boss, demo client…) | To configure | To configure | To configure |

The profile **influences the UI** (vocabulary, mockups), **the checkpoints** (visuals vs diffs), and **certain constitution rules** (see below), but **does not influence technical quality** — a Kid benefits from the same rigorous pipeline as a Pro.

### 5.2 Multi-layer constitution

A constitution structured in additive layers — all common layers apply to all profiles:

**Layer A — Universal (always active)**: SOLID, KISS, DRY, OWASP, secrets in env vars, audit logging, conventional commits, no AI mention in commits, separation of concerns, observability. *(this is what you already have in `install-mmd.sh`)*

**Layer B — Safe-by-default (always active, except explicit Pro override)**:
- No third-party tracking or analytics by default.
- Hardware permissions (camera/mic/geoloc) requested at use time.
- Failsafe: the app must degrade gracefully.
- No mandatory signup by default.
- Minimal accessibility (AA contrast, tap targets ≥ 48px).

**Layer C — Kid profile (additive if profile = Kid)**:
- No chat / social network / contact with strangers.
- No ads, no in-app purchases.
- Delivered UI vocabulary in simple words ("Save" not "Submit").
- Hosted on an adult account (Sébastien).
- No AI in the delivered app (unless explicit parental request).

**Layer D — Pro profile (additive if profile = Pro)**:
- Mandatory integration tests.
- API documentation.
- TDD enabled by default.
- Permission to use complex stacks (Docker, microservices, etc.) if justified.

**Layer E — Brownfield (additive if brownfield detected)**:
- Strict respect of existing code patterns.
- No added dependency without justification.
- Mandatory non-regression tests.
- Documented migration plan for any breaking change.

The system assembles the layers at session start and injects the bundle into each sub-agent — exactly as `install-mmd.sh` already does, but with dynamic composition. **A dynamic layer F** (see §6) is automatically added as autolearning extracts validated rules.

### 5.3 Engagement modes

Not all users want the same level of exchange before delivery. Sébastien himself, in his typical case, has a precise idea and just wants it executed — he doesn't want to be bombarded with 6 clarification questions. Conversely, other users will want to use Make My Dreams as a design workshop to mature their need. Three modes cover this spectrum:

| Mode | For whom | Upfront questions | Checkpoints | Default engine |
|---|---|---|---|---|
| **Autonomous** ("Just do it") | User who knows precisely what they want | 0–1 (simple rephrasing) | Minimal (result + 1 final y/n) | FAST (Ralph) |
| **Intermediate** ("Collaborate") | Default case, reasonably clear request | 2–4 on real detected ambiguities | Mockup before code + checkpoint after delivery | Auto (Mode Router decides) |
| **Guided** ("Explore") | Fuzzy need, exploration, workshops, teens discovering | Deep conversation, user stories, examples | Multiple mockups, validations at each step | STRUCTURED (BMAD spec + party mode) |

#### Interactions with other components

- **Dream Catcher**: the intensity of the `dream-clarifier` skill is parameterized by Engagement Mode (0–1 / 2–4 / N questions).
- **Mode Router**: Engagement influences (without imposing) the choice between FAST and STRUCTURED. Autonomous biases toward FAST, Guided biases toward STRUCTURED. The Mode Router can override if the nature of the need requires it (a technically complex project will remain STRUCTURED even in Autonomous — but without unnecessary upfront questions).
- **Reality Check / Dream Delivery**: in Autonomous, the intermediate visual checkpoint is skipped (the result is presented directly). In Guided, the mockup is shown before code, then the intermediate app, then the final version.
- **Conductor**: can send a notification at different times depending on Engagement (Autonomous: only at the end; Guided: at every milestone).

#### Mode detection — hybrid strategy

Four complementary mechanisms, from fastest to smartest:

1. **Explicit configuration** (default): CLI flag (`--engagement autonomous|intermediate|guided`) or persistent setting in user profile. Sébastien sets `autonomous` once and for all for his personal/pro use.
2. **Single initial question** (if no config): a single question on the very first message — *"Do you know precisely what you want and I just go, or do we build together step by step, or something in between?"* Three choices, no "Other". No time penalty: it's a question, not a questionnaire.
3. **Heuristic on initial message** (fallback in "smart-default" mode): signals such as message length (short + imperative → Autonomous; long + full of "maybe" → Guided), presence of questions returned to the AI (the user is looking for a sparring partner → Guided), technical specificity of vocabulary.
4. **In-session adaptation**: the user can switch at any time by natural command (*"just go"*, *"ask me more questions"*, *"let's explore more"*). The system confirms and adjusts for the rest. The current mode is tracked in `status.json`.

Recommendation for v0.3 (Dream Catcher introduction): implement (1) and (2). Keep (3) and (4) for v0.7+ when UX is more mature.

#### Storage and persistence

The current mode is:
- Memorized per user profile (`~/.mmd/profile.json`) — a Pro who has never changed their mode stays in Autonomous.
- Overridable by CLI flag or session command.
- Tracked in `status.json` at each slice — useful for the Conductor and for analyzing afterwards whether the mode was relevant.

---

## 6. Documentalist and autolearning

### 6.1 The problem

After several months of AI-dev, a recurring finding: **lots of specs generated, little consolidation**. Each `auto-dev` produces its spec, its plan, its tasks, its review… but no one maintains a *coherent catalog* of what the project has become. BMAD plans for a `project-brief` but (1) it's often forgotten, (2) it takes a while to initialize, (3) it ages fast. Consequence: after N slices, no one (neither human nor AI) really knows what the app does, nor why a given decision was made.

Make My Dreams addresses this with a dedicated **Documentalist role**.

### 6.2 Architectural positioning

The Documentalist is **not a 4th orchestration level**: it orchestrates nothing. It's an **event-driven specialized Worker**, triggered by the Conductor (or the Orchestrator) on precise events. It runs in a fresh context, reads what it needs, updates consolidated docs, and dies. This choice preserves the Conductor's lightness (which must stay under 10k tokens — see §4.2).

```
Event detected (e.g. slice DONE)
        │
        ▼
Conductor reads status.json, sees the change
        │
        ▼
Conductor spawns Documentalist-Worker (fresh context)
        │
        ▼
Documentalist reads: precise change, current state of /docs/
        │
        ▼
Updates ONLY what actually changed
        │
        ▼
Saves, signals DONE, context dies
```

### 6.3 Maintained documents

| Document | Content | Update trigger | Format |
|---|---|---|---|
| `docs/tutorials/*.md` | **Diataxis — learning by practice** (port of gStack /document-generate) | New feature delivered requiring learning | Narrative markdown |
| `docs/how-to/*.md` | **Diataxis — recipes for specific problems** | Explicit request or recurrent usage detection | Procedural markdown |
| `docs/reference/*.md` | **Diataxis — exhaustive technical reference (API, schemas)** | Slice DONE modifying a public contract | Structured markdown |
| `docs/explanation/*.md` | **Diataxis — conceptual explanations ("why")** | ADR or structural change | Discursive markdown |
| `docs/architecture.md` | Living schema + main components + flows | ADR created (structural decision) | Mermaid + prose |
| `docs/adr/NNN-title.md` | Architecture Decision Records — one per structural decision, immutable | Detection of a `decision.structural=true` tag in `decisions.log` | Michael Nygard ADR format |
| `docs/lessons-learned.md` | Rules deduced from corrected errors (§6.5) | Phase 4 finding marked `fixed=true` | List of rules with context |
| `CHANGELOG.md` | Readable journal of changes (Keep a Changelog) | Any slice delivery | Standard markdown |

**Adopted Diataxis discipline** (port of gStack): doc is structured in 4 quadrants — Tutorials (learning) / How-to (problems) / Reference (information) / Explanation (understanding). Avoids the classic trap of doc that mixes everything and helps no one.

**Post-ship doc sync pattern** (port of gStack `/document-release`): on each slice delivery, the Documentalist is triggered with these mandatory substeps: (a) Diataxis coverage map (which new screens/APIs have their doc?), (b) ADR drift detection (ADRs no longer reflecting reality), (c) CHANGELOG polish (editorial passes), (d) TODOs cleanup. This is a more mature discipline than my initial "fuzzy event-driven trigger" design.

**Optional RAG backend: gbrain** (port of gStack `/setup-gbrain` + `/sync-gbrain`) — for large brownfield projects where the Worker explorer (grep+AST) hits its scalability limits, gbrain provides a semantic index of the repo as a complement. Optionally activated after v0.9, never as first intent (cf decision P-13: grep+AST first).

### 6.4 Anti-proliferation guardrails

The Documentalist has an unusual mission: **consolidate more than produce**. To prevent it from becoming a source of spec sprawl itself:

1. **No regeneration without substantial change**: it diffs existing content before writing, doesn't touch a document if nothing has really changed.
2. **Periodic consolidation**: a periodic trigger (or manual) runs a coherence review — detects duplicates between features, superseded ADRs, obsolete sections of user guide.
3. **Active compaction**: it has permission to **delete or shorten** obsolete content, not just add.
4. **Length cap per document**: `architecture.md` stays under 200 lines, each `features/*.md` under 100 lines. If exceeded, forced split or consolidation.
5. **No generated document that no one reads**: no 50-page exhaustive spec — the golden rule is "if it doesn't serve the next iteration or a future human reader, we don't write it".

### 6.5 Autolearning loop

This is probably the most differentiating feature of Make My Dreams compared to all existing frameworks.

#### Mechanism

```
1. Worker writes defective code (e.g. forgets to handle null video stream)
        │
        ▼
2. Phase 4 review (auto-dev) or Reality Check detects the defect
        │
        ▼
3. Corrective Worker applies the fix, marks finding 'fixed=true'
        │
        ▼
4. Conductor triggers Documentalist with event 'error_fixed'
        │
        ▼
5. Documentalist analyzes:
   - what was the precise error?
   - what error class does it represent?
   - what generalizable rule would prevent it?
        │
        ▼
6. Extraction of a rule (e.g.:
   "Any read of an external media stream must verify availability
    before processing and degrade gracefully if absent")
        │
        ▼
7. Added to /docs/lessons-learned.md with:
   - unique id
   - origin context
   - generalizable rule
   - reuse counter
        │
        ▼
8. The rule is INJECTED into future Workers' prompts
   (added to the constitution as a "dynamic layer F")
        │
        ▼
9. If the rule effectively prevents N later errors (N=5 by
   default), it is PROMOTED to a permanent layer of the constitution.
   Otherwise, after M months without reuse, it is ARCHIVED
   (kept for memory, no longer injected).
```

#### Structure of a lesson

```markdown
## L-042 — Every external media stream read must handle absence

**Status**: active (3 validated reuses)
**Date**: 2026-05-20
**Origin**: Slice "camera drawing app", finding F3 Phase 4
**Context**: Worker had coded `videoStream.getVideoTracks()[0]` without checking that `getUserMedia` succeeded → crash on permission refused.
**Rule**: Before any access to an external media stream (camera, mic, uploaded file), verify its availability and plan for graceful degradation (user message + functional fallback when possible).
**To promote if**: 5 validated reuses (current counter: 3)
**Keywords for matching**: getUserMedia, videoStream, audioStream, MediaRecorder, file upload
```

#### Conditional injection

Not all lessons are injected into all prompts — that would be noise. The Documentalist (or a mini-agent at prompt composition time) selects relevant lessons based on the **keywords of the upcoming Worker's context** (e.g. if the Worker is going to work on a camera feature, L-042 is injected; otherwise not).

#### Promotion / archival

- **Promotion to permanent constitution (layer A)**: after N validated reuses (default N=5) AND no contraindication. Requires user validation if Pro profile.
- **Archival**: if a lesson is not reused for M months (default 6), it is archived — kept in a `lessons-archived.md` subfile for memory, but no longer injected. Avoids noise accumulation.

#### Project scope vs global scope

Two possible scopes, to clarify (decision §10.13):

- **Local lessons**: `lessons-learned.md` versioned in the current project's repo — useful for this project only.
- **Global lessons**: `~/.mmd/lessons-learned.md` — accumulated over all the user's projects. More powerful but requires caution (a rule valid for your pro project may be noise for your daughter's project).

Recommendation: both scopes, with precedence rule (local > global) and origin tag.

### 6.6 Integration of external issues (4 bundles)

A structured watch (delegated to a sub-agent in v5→v6) identified 26 classical and emerging issues of AI-dev, grouped into 4 bundles. Detail is in the [PROBLEMS.md](./PROBLEMS.md) appendix. Rather than activating everything permanently (heavy, costly), each bundle has a **contextual activation rule**:

| Bundle | Content | Default activation | Where it integrates |
|---|---|---|---|
| **A — Security** (P-03, P-06, P-07, P-08) | Slopsquatting, lethal trifecta, prompt injection via deps, secrets leak | **Always active** (no override possible) | Constitution layer B + Worker sandbox (egress allowlist) + "deps gate" Worker + pre-commit hooks |
| **B — Correctness & sealed tests** (P-04, P-05, P-09) | Independent oracle, orthogonal damage detection, behavioral correctness | **Active if profile ≠ Autonomous+Kid** (Pro always, Kid intermediate/guided always) | "tester" Worker distinct from "coder" Worker, spawned by Orchestrator; sealed tests issued in Spec phase |
| **C — Observability + HITL tiered** (P-10, P-17, P-18, P-20) | Eval harness, approval gates by risk-score, trust calibration, OpenTelemetry GenAI | **Always active on Conductor and Orchestrator**; adaptive HITL by engagement mode | Cross-cutting Observability module + Conductor (per-action risk-scoring) + Worker output schema `{result, confidence, alternatives}` |
| **D — Living Specs + advanced context engineering** (P-01, P-02, P-21, P-22) | Context rot, constraint decay, spec drift, granular rollback | **Always active** (MMD arch foundations) | Documentalist (post-slice reconciliation) + Worker prompt template (constitution reminder at start AND end) + granular commits |

**Out-of-bundle A-D issues** (P-11 cost, P-12 model routing, P-13 RAG vs grep, P-14 onboarding, P-15/16 parallel conflicts, P-19 recovery, P-23 a11y, P-24 i18n, P-25 perf, P-26 reproducibility): activated on demand by profile, context (brownfield, parallelism, etc.) or explicit decision. Documented in the appendix.

**Architecture decision to enact immediately (P-13)**: Cursor, Claude Code and Devin have abandoned vector RAG on the brownfield repo side. Make My Dreams follows this finding: the "explorer" Worker (brownfield mode) will be based on **grep + AST + follow-imports**, not vector RAG. Saves at least 2 versions of expensive detour.

### 6.7 Brownfield onboarding: `mmd discover`

Any existing project must go through a **mandatory onboarding phase** before MMD can do anything in it. This is the concrete implementation of P-14 (onboarding on existing repo), embodied by a specialized Worker: the **Project Onboarder**.

#### Auto-trigger by the Tech Architect

The Tech Architect refuses to run on a brownfield without a validated `mmd-discovery-report.md` — **but instead of blocking brutally, it itself triggers the Project Onboarder as a sub-agent, presents the report, asks for validation, then continues**. The user doesn't need to know the `mmd discover` command: it triggers itself the first time. This is consistent with the autonomy philosophy (Autonomous mode must remain autonomous) and with MVP-first (no learning friction).

The user can also trigger manually via `mmd discover <path>` when they just want an inventory without starting a dev.

#### Protocol in 4 steps (universal)

```
1. SCAN   — passive inventory of existing
   Methodologies detected (.specify/, _bmad/, docs/stories/, ADR…)
   Code (language, framework, structure, tests)
   Git (age, commit frequency, branches)

2. INGEST — structured import
   Spec Kit constitution → .mmd/shared/constitution/imported.md
   BMAD stories → .mmd/shared/status.json consolidated
   Specs/plans → .mmd/shared/vision.md candidate

3. INFER  — reverse-engineering the rest
   Worker explorer (grep + AST + follow-imports — not vector RAG, cf P-13)
   Generates inferred docs/architecture.md
   Detects contradictions between sources if multiple

4. REPORT — human report to validate (blocking)
   mmd-discovery-report.md = "here's what I understood,
   here are my hypotheses, here are the contradictions, validate / amend"
```

#### Three concrete cases

**Case A — Rich project (Spec Kit then BMAD)**

Found: `.specify/memory/constitution.md`, `.specify/spec.md|plan.md|tasks.md`, `_bmad/`, `docs/stories/`, `_bmad-output/`.

Specific behavior:
- Spec Kit constitution imported verbatim as layer A, tagged `imported-from: spec-kit`. Diff visible vs standard MMD constitution to spot project-specific principles.
- Spec Kit specs → `vision.md` candidate. `plan.md` annotated as architecture context.
- BMAD stories → `status.json` consolidated (each story = entry with its status).
- Overlap detection `tasks.md` Spec Kit ↔ BMAD stories → listed for human arbitration.

**Case B — BMAD alone, spec sprawl**

Found: `_bmad/`, `docs/stories/` (50+ files, mix of done/draft/obsolete), `_bmad-output/` (old runs), dated `PROJECT.md`.

Specific behavior — this is where MMD provides the **catch-up value**:
- **Retrospective consolidation** by the Documentalist: classifies the N stories into 3 buckets (delivered and valid / delivered but probably overwritten / never delivered).
- **Cross-check stories ↔ real code**: for each "done" story, the explorer verifies the mentioned code still exists. Output: *true done* / *partially present* / *missing*.
- **Implicit ADR extraction** from `decision:` commits or "rationale" sections of stories.
- **Synthesized `vision.md`** by thematic grouping of delivered stories.
- The report proposes an archival plan for dormant stories to stop spec sprawl at the root.

**Case C — Blank project (no SDD methodology)**

Found: `package.json` (or equivalent), `src/`, possibly `README.md`, possibly `tests/`.

Specific behavior:
- **No import** (nothing to import).
- **Pure inference** by Worker explorer: stack, structure, conventions, repo maturity level, presence/absence of tests.
- **Reading README + CHANGELOG** if they exist to extract declared intent.
- **Reverse-engineered `vision.md`** as a hypothesis to validate: *"here's what I believe this project is trying to do"*.
- **Standard MMD constitution** applied (layers A + B + default-enabled bundles), no import.
- **Explicit request for long-term vision**: without pre-existing spec, MMD must ask the user *"where do you want to take this project?"* before any smart routing.

#### Non-intrusion guarantee

The Project Onboarder **doesn't touch any existing code**. It writes only in:
- `.mmd/shared/` (team-shared artifacts, see §6.8)
- `.mmd/local/` (scratchpad, gitignored)
- `docs/` (inferred architecture, ADR, lessons-learned — new files, never overwriting)
- `mmd-discovery-report.md` at the root for visible validation

Until the report is validated (`mmd discover --approve` or UI checkbox), any dev trigger is blocked.

### 6.8 What to commit vs ignore: `.mmd/shared/` vs `.mmd/local/`

The commit/ignore split is crucial as soon as one works in a team. **Not everything in `.mmd/` should be gitignored** — otherwise the shared state that makes the value of stateless orchestration is lost. Conversely, some artifacts (traces, runs, token budgets) are strictly personal and would pollute the repo.

#### Proposed structure

```
.mmd/
├── shared/                          ← COMMIT (team artifacts)
│   ├── vision.md                    long-term direction reference
│   ├── slice.md                     current round deliverable
│   ├── status.json                  shared progress state
│   ├── decisions.log                audit trail of choices
│   ├── handoff/N.md                 continuity summaries (team-useful)
│   ├── constitution/imported.md     imported project constitution
│   └── project-onboarder/last.md    latest validated onboarding report
│
└── local/                           ← IGNORE (personal scratchpad)
    ├── traces/                      OpenTelemetry, execution logs
    ├── prompts/                     resolved prompts injected to Workers
    ├── tokens-budget.json           budget consumption per session
    ├── runs/                        intermediate run snapshots
    └── cache/                       various caches

docs/                                ← COMMIT (already existing)
├── architecture.md
├── adr/NNN-*.md
├── features/*.md
├── user-guide.md (or -kid/-pro)
├── lessons-learned.md               PROJECT-LOCAL → commit
└── CHANGELOG.md

~/.mmd/                              ← never commit (personal to user)
├── profile.json                     global user profile
├── lessons-learned.md               GLOBAL lessons across projects
└── credentials/                     API tokens, etc.
```

#### Simple rule to remember

| Data | Scope | Commit? |
|---|---|---|
| Vision, slice, status, decisions, handoff | Project | YES (`.mmd/shared/`) |
| Project-imported constitution | Project | YES (`.mmd/shared/constitution/`) |
| Architecture, ADR, features, user-guide, CHANGELOG | Project | YES (`docs/`) |
| Project lessons-learned | Project | YES (`docs/lessons-learned.md`) |
| Traces, resolved prompts, runs, cache | Personal session | NO (`.mmd/local/`) |
| User profile, global lessons, credentials | Personal global | NO (`~/.mmd/`) |

#### `.gitignore` auto-generated by `mmd discover`

`mmd discover` detects the absence of `.gitignore` or of an MMD section, and adds (without touching the rest):

```gitignore
# Make My Dreams — local artifacts (scratchpad, not for team)
.mmd/local/

# Make My Dreams — runtime files
mmd-discovery-report.md  # ephemeral report, validated one is in .mmd/shared/
```

Everything else (`.mmd/shared/`, `docs/`) remains explicitly committable.

#### Implication for team work

With this scheme, two developers on the same branch automatically share:
- Progress state (`status.json`)
- Decisions (`decisions.log`, `adr/`)
- Vision and current slice (`vision.md`, `slice.md`)
- Handoffs (one dev can pick up another's session)
- Project lessons

And each keeps their traces / runs / prompts / budgets in their `.mmd/local/`. No conflict, no noise in PRs.

---

## 7. Self-improvement: MMD develops MMD (reflexive bootstrap)

### 7.1 The bet

From v0.2, Make My Dreams is used to develop Make My Dreams itself. Every new project feature is treated as a *dream* injected into the system. It's the **self-hosting compiler** pattern (gcc compiles gcc) applied to an agentic system.

The bet: if MMD cannot improve itself, it has a fundamental design problem — and we'll detect it early. If MMD can improve itself, we have an enormous leverage effect (each MMD improvement improves the ability to improve MMD).

### 7.2 Three existing mechanisms that converge

Self-improvement is **not a feature to build**, it's the **side effect of three mechanisms already planned** in the scoping:

1. **Automated watch (§8)**: detects new external patterns (a new tool, an emerging technique, a relevant arXiv paper), produces a digest with PR proposals.
2. **Autolearning (§6.5)**: extracts rules from errors corrected in **any project** (including MMD itself, which is a project like any other).
3. **Documentalist (§6)**: maintains documentation coherence and proposes ADRs.

Combined, these three mechanisms form a self-improvement loop:

```
External watch discovers technique X (e.g. new Anthropic pattern)
            │
            ▼
Documentalist notes in WATCH_DIGEST.md + proposes PR on MMD repo
            │
            ▼
Sébastien validates → dream issued in MMD: "integrate technique X"
            │
            ▼
MMD (current version) implements the feature in the MMD repo itself
            │
            ▼
Phase 4 review + Reality Check + dream-bench
            │
            ▼
If dream-bench passes without regression → release MMD v0.X+1
            │
            ▼
v0.X+1 will be used for the next cycle (capacity ↑)
```

Autolearning also works on MMD's errors on MMD: if MMD makes a mistake modifying MMD, the correction generates a lesson that makes MMD better at modifying similar projects (and MMD itself).

### 7.3 Critical guardrails (otherwise silent drift)

Reflexive bootstrap is powerful **but dangerous without guardrails**. Three mandatory protections, to enable **before** the first use of MMD on MMD:

1. **Eval harness (P-10 dream-bench) — MANDATORY from v0.3**: suite of reproducible "dream tests" (10 kid dreams + 10 pro dreams) with `time-to-MVP`, `cost`, `reality-check-pass-rate`, `dream-bench-pass-rate` scoring. No MMD release can be promoted without passing the previous version's dream-bench.
2. **Tiered HITL (P-17) on structural changes — MANDATORY**: no modification of permanent constitution, Conductor, handoff protocol or Mode Router without explicit human validation. The risk-score of any action on the MMD repo itself is forced to "approval required".
3. **Granular rollback (P-22) on the MMD repo — MANDATORY**: commits-per-step, ephemeral branches per slice, `rollback-mmd-to-vN` command. If a release regresses on dream-bench, automatic return to the previous one.

These three protections are precisely three elements of the Top 5 identified in the watch (§6.6). **This is not a coincidence**: self-improvement *amplifies* safety needs, and bundles A/B/C/D were partly designed to make it possible.

### 7.4 Roadmap implications

- **v0.1 (walking skeleton)**: developed MANUALLY with current `install-mmd.sh` + Sébastien's editing. This is the only fully manual artifact.
- **v0.2+**: MMD is used to develop MMD. Every future feature = a dream. Sébastien remains HITL validator.
- **v0.3 (dream-bench v0)**: initial suite of 5 reproducible dreams + CI harness. Every post-v0.3 release must pass.
- **v0.5 (Conductor)**: risk-scoring on MMD repo actions forced to "approval required".
- **v0.5b → v1.0**: each version is a "MMD vN develops MMD vN+1, validates on dream-bench, releases if pass" cycle.
- **Long term**: as `lessons-learned.md` (global) grows, MMD progressively becomes better at modifying MMD. External watch feeds the evolution.

### 7.5 What this is NOT

To avoid fantasies: this bootstrap is **not** an unbounded self-evolving AGI. It's a system:
- **Bounded**: Sébastien validates each structural change (HITL mandatory).
- **Measured**: dream-bench detects regressions and blocks releases.
- **Reversible**: granular rollback to any previous version.
- **Slow (deliberately)**: no auto-deployment, no auto-modification without validation.

It's the *recursive self-improvement under human oversight* pattern, not the Bostrom-paranoid version. Closer to Emacs modifying itself than to Skynet.

---

## 8. Automated watch

### 8.1 Why

The AI-dev ecosystem moves very fast (gStack is one year old, Spec Kit too, Ralph Loop has existed since ~2024). Make My Dreams must stay aligned without Sébastien having to monitor GitHub by hand.

### 8.2 Skill `dev-ai-watch` (scheduled task)

**Frequency**: weekly (configurable).

**Scanned sources**:
- GitHub Trending (filters: `agent`, `coding`, `ai-coding`, `mcp`, `claude`, `agentic`, various languages).
- GitHub stars deltas on a curated list (Spec Kit, BMAD, gStack, Cline, Aider, Roo Code, Continue, Plandex, OpenHands…).
- HackerNews tags `ai-coding`, `agents`.
- Reddit `r/ChatGPTCoding`, `r/LocalLLaMA`, `r/ClaudeAI`.
- arXiv categories `cs.SE` + filters "LLM agent", "code generation".
- Newsletters / blogs: Geoffrey Huntley, Simon Willison, latent.space, Sourcegraph blog.

**Pipeline**:
1. Fetch sources.
2. Filtering: new project OR major update of a tracked project.
3. Automatic summary (1 paragraph per item).
4. Relevance scoring vs Make My Dreams (5 criteria: SDD, agentic, multi-agent, deploy-to-prod, non-tech-friendly).
5. Weekly digest sent (Markdown or Slack/email, to wire).
6. For items > relevance threshold: integration proposal ("this new pattern X from tool Y could replace/enrich our component Z").

**Implementation**: uses the `schedule` skill (already available in Cowork setup) for scheduling, and delegates fetch+summary to a general sub-agent.

### 8.3 Link with self-improvement (§7)

The digest is not just informational: it proposes **PRs on the Make My Dreams repo** to integrate detected patterns. Sébastien validates or rejects. It's a meta-Ralph loop on the project itself.

---

## 9. MVP-first Roadmap

Each version delivers something usable. No "foundation phase" lasting 3 weeks before the first deliverable.

### v0.0 — gStack install + audit  *(1 day)*
- Install gStack in a test project per https://github.com/garrytan/gstack
- Test the 41 skills on a real case to validate the scope
- Validate coverage vs §3.3 and identify any unforeseen gaps
- Document in `docs/adr/001-adopt-gstack-as-backbone.md`

### v0.1 — Walking skeleton  *(1–2 days)*
- A single CLI command: `mmd "<dream>"`.
- No UI. Sébastien drives, we observe the behavior.
- Reuses current `auto-dev` as STRUCTURED ENGINE as-is.
- Just adds `vision.md` + `slice.md` as injected artifacts.
- **Test**: `mmd "a drawing app that overlays an image on the camera"` produces a functional PWA.

### v0.2 — FAST engine + v0.1 CLI polish backlog  *(3–4 days)*
- Implements the bounded Ralph loop (§4.1).
- Adds Mode Router with simple rules.
- **Test**: `mmd --fast "add a button to change the stroke color"` on the v0.1 project → enriched MVP in < 5 min.

**Deferred-from-v0.1 cluster (from `_bmad-output/implementation-artifacts/deferred-work.md`, 5 items, pulled into v0.2 because they all touch the CLI surface that v0.2 will modify anyway)**:
- **B2**: replace heuristic `claude` CLI detection (`cmd === 'claude' || /\/claude$/.test(cmd)`) with explicit `MMD_AUTODEV_MODE=cli|test` env var, so user wrappers like `claude-wrapper` are handled cleanly.
- **B4**: add `MMD_QUIET=1` to suppress terminal stdout tee under `node --test` and CI, preserving the log-file tee.
- **B8**: consolidate the redundant `EACCES` short-circuit in `bin/mmd.js`'s top-level catch (cosmetic, but worth doing before the v0.2 CLI grows).
- **E7**: add a parallel `lstat` check on the `--resume` path so a symlinked `demo/<slug>` cannot social-engineer a misleading "state: done" message.
- **E13/E14**: stop silently dropping unknown `--foo` flags. Either error on unknown flags or implement POSIX `--` end-of-flags separator (preferably both).

### v0.2c — Brownfield onboarding + shared/local structure  *(3–4 days)*
- Worker `project-onboarder` + `mmd discover <path>` command.
- Auto-trigger by Tech Architect if no validated report.
- `.mmd/shared/` (commit) vs `.mmd/local/` (ignore) structure with auto-managed `.gitignore`.
- Implementation of the 3 concrete cases (Spec Kit+BMAD, BMAD spec sprawl, blank project).
- **Blocking for bootstrap §7**: MMD becomes brownfield after v0.1, so v0.2c must be able to auto-discover itself.
- **Test**: run `mmd discover` on the Extend BMAD repo (rich in Spec Kit+BMAD) and get a relevant report to validate.

### v0.2b — Dream-bench v0 + Bundle A Security + v0.1 deferred-A1  *(3–4 days)*
- **Dream-bench v0** (P-10): 5 reproducible dreams (3 kid + 2 pro), CI harness measuring `time-to-MVP`, `cost`, `reality-check-pass-rate`. **Blocking for bootstrap §7**: without dream-bench, no safe self-improvement.
- **Bundle A Security activated permanently**: Worker sandbox (egress allowlist), `deps-gate` Worker (verify existence + age + downloads before install), pre-commit hooks `trufflehog`/`git-secrets`.
- **Test**: no post-v0.2b release can be promoted without passing the previous version's dream-bench.

**Deferred-from-v0.1 cluster (1 item, pulled into v0.2b because it IS the seed of dream-bench)**:
- **A1** (Acceptance Auditor): write `test/integration/pwa-drawing.test.js` — a Playwright-driven test for the v0.1 fil-rouge PWA that exercises the camera-permission flow with `--use-fake-ui-for-media-stream`. Skips cleanly when Playwright is absent. This test becomes one of the 5 reference dreams of the dream-bench v0.

### v0.2.5 — `mmd serve` minimal web UI for non-tech users  *(2–3 days)*

**Why this version exists**: differentiator #1 (multi-audience accessibility) needs an experience for users who don't open a terminal. Without this, MMD's mission for users like Sébastien's 13-year-old daughter is purely theoretical. Pulled earlier in the roadmap from the original v0.10.

**What gets built**:
- `mmd serve` CLI subcommand that:
  - Starts a local HTTP server on `localhost:3000` (configurable port)
  - Automatically opens the default browser to that URL (`open` on macOS, `xdg-open` on Linux, `start` on Windows)
  - Serves a single static HTML page (~200 lines vanilla HTML/CSS/JS, no framework)
  - Exposes a small JSON API: `POST /api/dream { "dream": "..." }` returns a stream of progress events (SSE)
- The HTML page is intentionally minimalist:
  - One big text input: "Décris ton rêve" / "Describe your dream" (language follows profile)
  - One big button: "Vas-y" / "Go"
  - Progress area that streams the backend events as friendly messages ("Je réfléchis…", "Je construis ton appli…", "J'essaie ton appli…")
  - Result area: link to the generated PWA + a screenshot
- Backend invokes `mmd "<dream>"` as a subprocess, captures stdout/stderr, parses milestones, streams them as SSE events.

**What it is NOT**:
- ❌ No tunnel, no Cloudflare, no Vercel, no cloud deployment (all local)
- ❌ No authentication (single-user local tool)
- ❌ No conversational back-and-forth (just one shot per dream — that comes with v0.3 Dream Catcher conversational)
- ❌ No voice (comes with v0.11)
- ❌ No multi-user, no sharing, no persistence beyond the local filesystem

**Acceptance**:
- Sébastien runs `mmd serve` in a terminal.
- The browser opens on `http://localhost:3000` automatically.
- Sébastien's daughter types "an app to draw on the camera" and clicks the button.
- She sees progress messages stream in.
- After a few minutes, she sees the result: a link to a PWA she can open and use.
- She didn't touch a terminal, an IDE, or a CLI. Mission accomplished for v0.2.5.

**Deferred to later**:
- Remote access from her phone over Wi-Fi → v0.6 (announce local IP `192.168.x.y:3000`)
- Public access from anywhere → Cloudflare Tunnel optional addon, v0.7 or later
- Rich conversational UI → v0.3 (Dream Catcher CLI conversational) then v0.10 (full Web Dream Catcher)

### v0.2d — 3 engines (Fast/Standard/Deep) + Ralph upfront spec  *(3–4 days)*
- Mode Router rework: 3 engines instead of 2.
- **FAST** = Ralph Loop + 1-page minimal spec produced by Dream Catcher upstream (solves pure Ralph divergence).
- **STANDARD** = lightweight auto-dev (1× party mode instead of 3×, opportunistic Phase 2).
- **DEEP** = full BMAD process (PM/Architect/SM/stories/Dev/QA).
- Engagement→Engine default mapping + possible override.
- **Test**: 3 dreams (one trivial, one medium, one ambitious) routed correctly and delivered within expected budgets.

### v0.3a — Dream Expander (real BMAD/CIS brainstorming)  *(4–5 days)*
- Rename/refactor `brainstormer` → `dream-expander`.
- Implement Carson/Mary FACILITATOR pattern (never generator).
- 4 modes (User-Selected / AI-Recommended / Random / Progressive Flow by default).
- 10-15 essential techniques first (SCAMPER, 6 Hats, How Might We, What-If, Yes-And), extension to ~60 later.
- Anti-Bias Protocol pivot Tech→UX→Business every 10 ideas.
- Adaptation to the 3 profiles (Kid: 3-5 visual techniques; Curious: 5-8 AI-Recommended; Pro: full Progressive Flow).
- Output: `brief.md` consumed by PM agent / spec.
- **Test**: dream "camera drawing app" in Guided Pro mode → 100+ ideas explored, deliverable brief.md.

### v0.3b — Plan-Review Worker  *(3 days)*
- 4 sub-modes: CEO (EXPAND/SELECTIVE/HOLD/REDUCE) / Eng / Design / Devex.
- Blocking quality gate between 1c Mockup and 2 Tech Architect.
- Auto-skip Design if no UI, auto-skip Devex if no dev-tool.
- Output: `plan-review.md` + go/no-go.

### v0.3 — Dream Catcher conversational CLI  *(3–4 days)*
- Conversational mode in the same CLI (no web UI yet).
- Skill `dream-clarifier` (4–6 kid-friendly questions).
- Tech Architect agent.
- Selectable profile (`mmd --profile kid|pro`).
- Multi-layer constitution activated.

### v0.4 — Stateless Orchestrator + auto-handoff + Bundle B  *(4–5 days)*
- Formalize the Orchestrator pattern (never devs, delegates everything via `Agent`).
- Set up externalized state: `status.json`, `decisions.log`, `handoff/`.
- Token-count monitoring and auto-handoff at 70%.
- **Bundle B activated** (P-04, P-05, P-09): `tester` Worker distinct from `coder` Worker, sealed tests issued in BMAD Spec phase, regression suite at each commit, blast radius computation for brownfield.
- At this stage, Sébastien manually plays the Conductor role.
- **Test**: launch a long project, verify that successive handoffs preserve continuity AND that sealed tests detect a Worker that would try to rewrite a test to make defective code pass.

### v0.5 — Conductor + Bundle C Observability/HITL  *(3–4 days)*
- Level-3 Conductor, reads only `status.json` + latest `handoff/N.md`.
- Automatic spawn / monitor / handoff.
- No parallelism yet — one slice at a time.
- **Bundle C activated** (P-10, P-17, P-18, P-20): OpenTelemetry GenAI semconv, per-action risk-scoring on Conductor, Worker output schema = `{result, confidence, alternatives}`, dream-bench wired into nightly CI.
- **Bootstrap §7 active**: risk-score on MMD-repo actions forced to `approval_required`.

### v0.5b — Documentalist (integrates gStack) + Context Worker  *(4-5 days)*
- Worker `documentalist` triggerable on events `slice_done`, `structural_decision`, `error_fixed`.
- Delegates to gStack: `/document-generate` (Diataxis), `/document-release` (post-ship sync — coverage map + ADR drift + CHANGELOG polish + TODOs cleanup), `/learn` (lessons API).
- MMD adds: event routing → right gStack skills, autolearning lessons (v0.8b), profile-adapted user-guide.
- **Cross-cutting Context Worker**: MMD orchestrates `/context-save` + `/context-restore` gStack, adds systematic handoff logic at 70% and event sourcing per session.
- **Bundle D activated** (P-01, P-02, P-21, P-22).
- **Test**: 3 slices → coherent Diataxis docs; Worker crash → clean resume via Context.

### v0.6 — Polymorphic Reality Check + Mockup (integrates gStack)  *(4-5 days)*
- **Reality Check**: MMD orchestrator that **invokes gStack skills** based on deliverable type (cf §3.3) — `/qa`, `/design-review`, `/devex-review`, `/cso`, `/canary`. No reimplementation: MMD aggregates.
- Tech Architect produces `reality-check.config.md` listing the activated modes.
- **Mockup Generator** invokes `/design-consultation` (DESIGN.md) and `/design-shotgun` (N variants), with graduated adaptation by profile (the MMD value = the adaptation, not the mockup).
- Automatic return loop if gap vs `slice.md`.

### v0.7 — Dream Delivery + Retro & Trend (integrates gStack)  *(3 days)*
- Dream Delivery invokes gStack `/ship`, `/land-and-deploy`, `/setup-deploy`. MMD adds profile adaptation (kid-friendly notif vs Pro PR) + QR code.
- Phase 5b Retro & Trend invokes gStack `/retro` + `/health`. MMD adds the routing that feeds `lessons-learned.md`.

### v0.8 — Automated watch + Autolearning  *(1 week)*
- Automated watch `dev-ai-watch` (scheduled): curated sources (GitHub trending, HN, Reddit, arXiv) + scoring + digest + auto-PR. Invokes `/scrape` (gStack) for collection and `/skillify` (gStack) to codify patterns into permanent skill.
- **Complete Autolearning** (differentiator #2): rule extraction from `error_fixed`, addition to `lessons-learned.md` with counter, conditional keyword-based injection, promotion to permanent layer after 5 reuses, archival at 6 months without usage.
- Local scope (project, commit) + global (`~/.mmd/`, personal).

### v0.9 — Parallel Conductor + worktrees + Bundle E + Safety Hooks  *(2 weeks)*
- Conductor able to spawn multiple Orchestrators on independent slices.
- **`git worktree` implementation**: one worktree per slice, ephemeral branches.
- **Independence pre-flight check**: refuses `--parallel` if slices touch the same files/modules/contracts.
- **Cross-cutting `merger` Worker**: P-16 semantic conflict detection before merge, human escalation if non-resolvable conflict.
- **Safety hooks** (port of gStack `/careful` + `/freeze` + `/guard`) enabled on Conductor in parallelism mode: PreToolUse against destructive ops (rm -rf, DROP, force-push), Edit/Write restriction per worktree.
- **`landing-report`** (port of gStack) integrated in Worker merger: dashboard view of the multi-worktree PR queue.
- **Bundle E "Parallelism" activated** (P-15 worktrees, P-16 semantic conflicts) automatically when `--parallel` or auto-detection.
- Default limit: 3 max concurrent slices (configurable).
- **Premium use case**: MMD itself developing several features in parallel (bootstrap §7).

**Deferred-from-v0.1 cluster (1 item, pulled into v0.9 because parallelism makes it critical)**:
- **E8** (Edge Case Hunter): `.gitignore` append race condition in `lib/state.js#ensureGitignore`. Two parallel `mmd` invocations can both read an empty `.gitignore`, both decide the pattern is absent, both append → duplicate `# MMD v0.1` section. Self-healing on next single-process run but breaks under v0.9 parallelism. Fix: `fs.open(..., 'a')` with `O_APPEND` + content-marker scan, or per-repo lock-file.

### v0.9b — Optional gbrain RAG (large brownfield)  *(3–5 days)*
- Port of gStack `/setup-gbrain` + `/sync-gbrain`: repo embeddings indexed.
- Enabled only after v0.9, never as first intent (cf decision P-13).
- RAG backend for Worker explorer when grep+AST+follow-imports hits scalability limits (very large repos).
- Documentalist can also consume it for cross-cutting docs/code queries.

### v0.10 — Full Dream Catcher Web UI  *(1–2 weeks)*
- Evolves the minimalist v0.2.5 page into a real conversational Dream Catcher (multi-turn dialog, profiles surfaced, mockup previews inline, brainstorming sessions interactive, visual checkpoints).
- Next.js frontend (graduation from vanilla HTML).
- Already accessible to Sébastien's daughter since v0.2.5 — this version enriches the UX, not unlocks it.

### v0.11 — Voice mode  *(1 week)*
- Whisper for input.
- TTS for responses (Kid mode).

### v0.12 — Video-game target  *(2 weeks)*
- Tech Architect learns Phaser / Three.js.
- Reference templates (endless runner, platformer).

### v1.0 — Explicit brownfield-friendly  *(1 week)*
- Brownfield mode documented + tested on 2-3 of Sébastien's pro projects.
- Automated migration-plan mechanisms.

---

## 10. Risks and mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Ralph Loop spins in circles, burns budget | High | High | Round+budget caps, stagnation detection, STRUCTURED escalation |
| MVP delivered but incompatible with long-term vision | Medium | High | `vision.md` injected at each round; Reality Check also checks vision constraints |
| User waits too long (frustration) | High | Medium | Streaming of steps; duration estimation; FAST mode by default |
| The dream is misunderstood | Medium | High | Visual mockup at checkpoint #1 before any code |
| Unsuitable technical decisions | Medium | Medium | Tech Architect heuristics; PWA by default unless reason otherwise |
| LLM cost per project | Medium | Medium | Profile-dependent budgets; measure after v0.2; cache of recurrent patterns |
| Generation of inappropriate content (Kid profile) | Low | High | Strict constitution layer C + Dream Catcher content filter |
| BMAD upstream dependency breaks | Medium | Medium | Pinned versions in `install-mmd.sh` (already in place) |
| Brownfield: modification breaks existing | High | High | Constitution layer E (mandatory non-regression tests) + systematic `git diff` review |
| Automated watch produces noise | Medium | Low | Relevance scoring + adjustable threshold; iterate on filters |
| Handoff loses critical information | Medium | High | Exhaustive externalized state (`status.json` + `decisions.log` = source of truth, not agent context); continuity tests at v0.4 |
| Conductor itself eventually saturates | Low | Medium | It reads only small files — by construction its context stays under 10k tokens. Auto audit at v0.5. |
| Too-frequent handoffs = overhead | Medium | Low | 70% threshold conservative but adjustable; measure handoff/useful-task ratio |
| Documentalist itself generates spec sprawl | Medium | Medium | §6.4 guardrails (diff before writing, length caps, allowed to delete/compact) |
| Lessons-learned add noise to prompts | Medium | Medium | Conditional keyword-matching injection; archival at 6 months without use |
| Auto-promotion of a bad rule to constitution | Low | High | Threshold of 5 validated reuses; explicit validation for Pro profile before promotion |
| Consolidated docs partially desynchronized from code | Medium | Low | Periodic coherence-review trigger (Documentalist audit); CHANGELOG as reference |
| Reflexive bootstrap: MMD regresses by self-modifying | High | High | Mandatory dream-bench before promotion + granular rollback + mandatory HITL on structural changes (§7.3) |
| Worker prompt-injected via dep README or third-party content | Medium | High | Bundle A always active: sandbox egress allowlist + `untrusted` tagging + two-LLM pattern |
| Generated tests pass but don't validate the need | High | High | Bundle B: separate tester Worker, sealed tests in Spec Phase, derived from `slice.md` independently |
| Constitution forgotten across Ralph rounds (constraint decay) | High | Medium | Bundle D: constitution re-reminder at start AND end of every Worker prompt + post-step constitutional linter |
| Global lessons-learned pollute unrelated projects | Medium | Low | Local > global precedence; option to disable global injection per project; explicit scope tag |
| Discovery misses a project (wrong case A/B/C) | Medium | Medium | Blocking report to validate by human before any dev — user can correct hypotheses |
| `.mmd/shared/status.json` conflict between devs in a team | High | Medium | Merge-friendly structured JSON; CRDT considered v1.x; optimistic lock with retry for simple case |
| Parallel worktrees break a shared contract (P-16) | High | High | Mandatory `merger` Worker before merge; strict independence pre-flight; integration tests on merge branch before push |
| "Independent" slices not so independent | Medium | Medium | Conservative pre-flight (refuse if doubt); `--force-parallel` option reserved for Pro with warning |
| LLM cost x3 in parallel mode | High | Medium | 3-slice limit; per-dream budget split across slices; prior estimate displayed |
| Ralph Loop diverges without upfront spec | High | Medium | v8: 1-page minimal spec ALWAYS produced before Ralph (solves by construction); otherwise escalate to STANDARD |
| Mode Router systematically picks wrong engine | Medium | Medium | Heuristics measured on dream-bench; possibility to force (`--engine fast|standard|deep`); continuous calibration |
| Brainstormer adds irrelevant noise | Medium | Low | Auto-decides via vision.md matching, ignores off-topic recommendations; decisions traced in `decisions.log` |
| Decorated mockup doesn't match final render | Medium | Medium | Spec includes mockup as reference in the slice; Reality Check validates visual coherence; perceptual diff on final render |
| Reality Check Playwright unstable on some sites | Medium | Low | Claude in Chrome fallback; retry policy + screenshots for debug |
| Deliverable type misidentified → wrong Reality Check | Medium | High | Tech Architect produces explicit `reality-check.config.md`, validatable by human in Guided mode |
| Dream Expander generates instead of facilitating (misses its mission) | High | Medium | Golden rule coded in the prompt: "you ask questions, you don't answer for the user"; mandatory Anti-Bias Protocol; Documentalist audit on N sessions |
| Plan-Review becomes a bottleneck (4 systematic sub-reviews) | Medium | Medium | Auto-skip Design if no UI, Devex if not dev-tool; Fast mode skips CEO if scope clear; review budget capped |
| Diataxis misapplied (wrong quadrant) | Medium | Low | Periodic Documentalist audit; coverage map at each slice; possibility of automatic reclassification |
| Security Worker noisy with false positives (OWASP daily mode) | Medium | Low | 2 levels daily/comprehensive; trend tracking to distinguish signal vs noise; project allowlist for exceptions |
| gbrain expensive in embeddings + sync | Medium | Medium | Optional after v0.9, never default; activated only if Worker explorer reports scalability limit |
| **gStack disappears or changes license** | Low | Very high | Pinned versions in MMD; preventive fork possible (Option 3); wrappers isolate contact |
| **gStack abruptly changes API of a key skill** | Medium | High | MMD wrappers centralize adjustments; integration tests on dream-bench detect regressions; version pinning |
| **gStack skill doesn't do what we thought** (gap discovered late) | Medium | Medium | v0.0 dedicated to gStack audit before any MMD dev; ADR-001 documents verified coverage |
| **gStack becomes a perf bottleneck** (slow Bun subprocess) | Low | Medium | Profiling from v0.6; possibility to cache gStack results; parallel calls when possible |
| **Double dependency gStack + BMAD** (BMAD for Deep engine) | Medium | Medium | Pinned versions for both; cross integration tests; option to disable Deep engine if BMAD causes issues |

---

## 11. Decisions to make before v0.1

1. **Name the assistant**: *Luna*, *Pixel*, *Mira*, or no name? Editorial choice that influences engagement (especially Kid profile).
2. **Default Dream Delivery hosting**: Vercel (simple, generous free tier) / Netlify / self-hosted (sovereign but friction)?
3. **Ralph caps**: initial values for MAX_TOURS and MAX_BUDGET (suggestion: 10 rounds / 5 USD for Pro profile, 5 rounds / 1 USD for Kid profile).
4. **Profile detection**: explicit at launch (`--profile`) or heuristic detection (vocabulary, contextual signals)? Recommendation: explicit, with Pro default for you and profile saved per session.
5. **Mode Router**: deterministic implementation (rules in a function) or a sub-agent that decides? Recommendation: deterministic for v0.2, agentic later.
6. **Automated watch**: digest in a `WATCH_DIGEST.md` file versioned in the repo, or Slack/email notification?
7. **Handoff threshold**: 70% default acceptable, or do you want tighter (60% — more frequent handoffs, larger margin) or wider (80% — fewer interruptions, tighter margin)?
8. **Conductor implementation**: Claude agent looping (reading `status.json` every N seconds) or external orchestration (`bash`/`python` script that spawns agents)? The first is more "agentic" but costs tokens even at rest; the second is more economical but less flexible.
9. **`status.json` granularity**: very fine (each subtask appears) or aggregated (one state per phase)? Fine granularity helps resumption but weighs down the file — which must remain readable by a minimal-context Conductor.
10. **Default engagement mode**: Intermediate (recommended, reasonable bias for a new user) or Autonomous (consistent with your personal use but may frustrate a user who would have liked guidance)? With what memorization strategy per profile?
11. **Wording of the initial question**: if we implement detection by single question in v0.3, what's the right phrasing? Suggestion: *"Do you prefer me to ask a few questions first, or that I just go?"* — short, neutral, 3 possible answers with an implicit 4th ("in between").
12. **In-session override**: should there be a set of recognized natural commands (*"just go"*, *"explore more"*) or rather explicit slash-commands (`/autonomous`, `/guided`)? The first is more natural but requires intent-detection; the second is less ambiguous.
13. **Lessons scope (autolearning)**: local only (versioned in repo), global only (`~/.mmd/lessons-learned.md`), or both with local > global precedence rule? Recommendation: both, but with explicit origin tag (`scope: local|global`) and possibility to disable global injection per project.
14. **Documentalist triggers**: event-driven only (recommended for reactivity) or also nightly periodic for audit/consolidation? The 2nd option costs tokens but improves long-term coherence.
15. **ADR format**: classic Michael Nygard (Context / Decision / Status / Consequences) or MADR (Markdown Architectural Decision Records, more modern)? Recommendation: MADR for richness, unless BMAD has already adopted a format to respect.
16. **User-doc profile in multi-audience mode**: if an app is delivered in Kid mode but Sébastien also wants his own Pro doc of the same app, should two versions of user-guide be generated or a single adaptive one? Recommendation: two files (`user-guide-kid.md`, `user-guide-pro.md`) generated on demand, simpler than adapting dynamically.
17. **Composition of dream-bench v0**: which initial 5 dreams to choose as reference suite? Suggestions: (a) "camera drawing app" (the leitmotif case), (b) "simple tap counter", (c) "local todo list", (d) "scientific calculator", (e) "memory card game". Mix kid/pro, mix greenfield/brownfield. To be adjusted.
18. **Promotion threshold lesson → permanent constitution**: 5 validated reuses by default (cf v0.8b). Too low → hasty promotions; too high → dynamic layer grows indefinitely. To calibrate after v0.8b.
19. **Technical sandbox (Bundle A)**: Docker per-Worker, Firecracker microVM, or bwrap/nsjail? Isolation/perf/complexity trade-off. Initial recommendation: bwrap (light, sufficient for egress allowlist + FS scoping).
20. **Dream-bench format**: pure nightly CI (pass/fail + metrics), or visual report (dashboard with diff between versions)? Recommendation: start with text CI, add dashboard when v0.9+ (parallelism).
21. **Team vs solo view in `.mmd/shared/`**: is the §6.8 commit/ignore split enough, or do we need a specific mechanism (e.g. custom git merge driver on `status.json` to handle concurrents)? Recommendation: start simple (natural JSON merge + retry), instrument when v1.x.
22. **Worktrees location**: next to the repo (`../<repo>-slice-X`) or in a conventional subfolder (`.mmd/worktrees/X`)? The 1st is more git-standard but pollutes the parent; the 2nd is tidier but unusual. Recommendation: 2nd option (consistent with everything-in-`.mmd/` philosophy).
23. **Automatic merge strategy**: squash (1 commit per slice), merge commit (preserves history), or rebase? Recommendation: squash by default (more readable for bootstrap §7 where each slice = a MMD feature).
24. **Discovery Report validation level**: implicit (UI checkbox) or explicit (`mmd discover --approve` command or manual file edit)? Recommendation: explicit for Pro profile (validation is an act), implicit for Kid (an "OK that's good" button).
25. **Format of the Ralph upfront minimal spec (v0.2d)**: just the acceptance criteria (3-5 lines) or a structured mini-template (objective / constraints / definition of done)? Recommendation: short template (10 lines max) — less ambiguous than free lines, faster than a real spec.
26. **Brainstormer activation in Intermediate**: automatic on any subject (may frustrate a hurried user) or only on explicitly fuzzy subjects (heuristic detection by Dream Catcher)? Recommendation: option 2 — detected fuzziness = brainstormer suggested with opening "this could help you, shall I continue?" (yes/no).
27. **Mockup strategy in Fast mode**: no mockup (to stay fast) or ASCII wireframe in 2 seconds (useful for visual validation even when fast)? Recommendation: ASCII wireframe systematically unless overridden — costs ~nothing and improves validation a lot.
28. **MCP image-gen for mockup**: integrate a DALL-E/SD/Midjourney MCP as preferred (visual richness) or stick with static HTML by default (deterministic, free)? Recommendation: static HTML by default, MCP image-gen enabled for Kid profile if available (visual richness has more impact for the child).
29. **Playwright vs Cypress vs Selenium choice** for web Reality Check: Recommendation Playwright (native multi-browser, better maintained in 2025-2026, modern API, MCP supported).
30. **BMAD Core (Mary) vs CIS (Carson + 4 others) for Dream Expander**: Core is shipped by default, CIS requires a separate module but offers 36 techniques and 5 personas. Recommendation: start with Core (Mary) in v0.3a for simplicity, add CIS in v0.6 or v0.7 when Pro profile and Guided engagement are mature.
31. **Target number of ideas per profile in Dream Expander**: 10-15 Kid / 30-50 Curious / 100+ Pro recommended (source BMAD: "real value arrives between 50 and 100"). To calibrate empirically after v0.3a.
32. **Default Plan-Review activation**: on all engagements or only Intermediate/Guided? Recommendation: skip in Autonomous (user knows what they want), active in Intermediate/Guided. Possible `--review` override forcing.
33. **Adoption of gbrain in v0.5b or wait v0.9b**: Recommendation v0.9b (wait until grep+AST Worker explorer shows its limits, otherwise over-engineering).
34. **Phase 5b Retro & Trend composition**: at each slice or periodic (weekly)? Recommendation: at each slice (consistent with MVP-first philosophy), but with an additional "weekly trend" mode for bootstrap §7.
35. **gStack version to pin**: latest stable at v0.0 start or most recently tested version? Recommendation: latest stable + quarterly bump process with mandatory dream-bench pass before promotion.
36. **gStack wrapper strategy**: individual wrappers per skill (one per `/qa`, `/cso`, etc.) or a generic `mmd-gstack-invoke <skill> <args>` wrapper? Recommendation: generic with per-skill hooks for specific transformations (simplicity/flexibility balance).
37. **Preventive gStack fork**: should we fork gStack from the start to secure (not dependent on an external living project) or wait for a signal (blocking skill that changes, license that moves)? Recommendation: wait — fork is a reaction, not an initial investment.
38. **If a gStack skill is missing for MMD**: fork only that skill (cherry-pick + custom), propose an upstream PR, or implement in pure MMD? Recommendation: upstream PR first (community contribution), custom MMD fallback if refused/slow.

---

## 12. Immediate next step

The repo is ready, the bootstrap is documented, the v0.1 spec is written. Concretely:

1. **Read [BOOTSTRAP.md](./BOOTSTRAP.md)** end to end (~10 min). It contains the exact commands for v0.0 and v0.1, with troubleshooting.
2. **Optionally rename** the folder `extend-bmad/` → `make-my-dreams/` (and update git remote if applicable). Not blocking.
3. **Execute v0.0** (BOOTSTRAP.md Steps 1–6, ~1 day): README update, verify `install-mmd.sh` still runs, install gStack, run the 10-skill audit, write and commit ADR-001.
4. **Execute v0.1** (BOOTSTRAP.md Steps 7–9, 1–2 days): launch `auto-dev` with [`SPEC_V01.md`](./SPEC_V01.md) as input, validate the drawing-app-camera-overlay demo, commit and tag `v0.1.0`.
5. **From v0.2 onwards**: MMD starts developing MMD (reflexive bootstrap, §7). The dream-bench from v0.2b becomes mandatory before promoting any new release.

Decisions in §11 can be deferred — most of them only matter from v0.3+. The exception: decision #35 (gStack version to pin) must be made during Step 5 when writing ADR-001.

**No more design. Time to execute.**

---

*Scoping document — v14 — generated on 2026-05-16.*

*Changes v1→v2: addition of the Ralph Loop pattern, reworking of the strategy around "two engines one brain" (FAST + STRUCTURED), introduction of multi-audience user profiles (Kid/Curious/Pro/Custom), multi-layer constitution, explicit brownfield mode, automated watch, MVP-first roadmap.*

*Changes v2→v3: introduction of a **stateless hierarchical orchestration architecture** across 3 levels (Conductor / Orchestrator / Workers) with **externalized state** as the single source of truth (`vision.md`, `slice.md`, `status.json`, `decisions.log`, `handoff/*.md`) and **transparent auto-handoff** when an agent approaches the context ceiling (70% threshold). The Conductor also introduces the possibility of parallelizing several independent slices. Roadmap reorganized to deliver the stateless Orchestrator in v0.4 and the Conductor in v0.5.*

*Changes v3→v4: addition of **Engagement Modes** (Autonomous / Intermediate / Guided) as a 3rd customization axis, orthogonal to Profile and Constitution. Hybrid detection in 4 mechanisms: explicit configuration, single initial question, heuristic on first message, in-session adaptation. The mode influences Dream Catcher intensity, Mode Router bias, and checkpoint frequency — without ever imposing a technical choice. Sébastien sets default Autonomous for his personal/pro use; Intermediate mode remains the default value for a new profile. 3 new decisions to make (§10 #10, #11, #12).*

*Changes v4→v5: introduction of the **Documentalist**, event-driven Worker (not a 4th orchestration level) triggered by the Conductor on `slice_done`, `structural_decision`, `error_fixed` events. Maintains a set of consolidated docs (`architecture.md`, `features/`, `user-guide.md`, `adr/`, `lessons-learned.md`, `CHANGELOG.md`) with anti-proliferation guardrails (diff before writing, length caps, allowed to compact and delete). Introduces the **autolearning loop**: corrected errors are extracted into rules, added to `lessons-learned.md` with reuse counter, conditionally injected (keyword matching) into future Workers' prompts as dynamic constitution layer F, then promoted to permanent layer after 5 validated reuses (or archived after 6 months without use). Roadmap enriched with v0.5b (base Documentalist) and v0.8b (full Documentalist + Autolearning). 4 new decisions (§10 #13–#16).*

*Changes v5→v6: integration of the **4 bundles of classical/emerging issues** identified by structured watch ([PROBLEMS.md](./PROBLEMS.md) appendix with 26 sourced sheets) — Security (A), Correctness & sealed tests (B), Observability + HITL tiered (C), Living Specs + advanced context engineering (D) — with **contextual activation** by default on each roadmap version (A→v0.2b, B→v0.4, C→v0.5, D→v0.5b). Formalization of **reflexive bootstrap §7**: from v0.2, MMD is used to develop MMD itself, with three mandatory guardrails (dream-bench, tiered HITL on structural changes, granular rollback). Architecture decision enacted: abandoning vector RAG for brownfield mode in favor of grep+AST+follow-imports (P-13). Roadmap enriched with v0.2b (dream-bench v0 + Bundle A). Risks extended with 5 new lines (bootstrap regression, deps prompt injection, dummy tests, constraint decay, polluting global lessons). 4 new decisions §11 #17–#20.*

*Changes v6→v7: three concrete additions in response to operational questions. (1) **§6.7 Brownfield onboarding**: Worker `project-onboarder`, `mmd discover` command, auto-trigger by Tech Architect (no frustrating block), universal 4-step protocol (SCAN/INGEST/INFER/REPORT), 3 concrete cases detailed (Spec Kit+BMAD / BMAD spec sprawl / blank project) with specific behavior for each, guarantee of non-intrusion on existing code. (2) **§6.8 `.mmd/shared/` vs `.mmd/local/`**: clear separation between team artifacts (vision, slice, status, decisions, handoff, ADR, project lessons — all committable) and personal artifacts (traces, prompts, runs, cache, global lessons — gitignored), with simple rule and auto-managed `.gitignore`. (3) **§4.3 Local parallelization via git worktrees**: Conductor can spawn multiple Orchestrators in isolated git worktrees (Cursor 2.0 pattern), strict independence pre-flight check, `merger` Worker to resolve semantic conflicts (P-16), 3 concurrent slices limit by default. **P-15 and P-16 promoted to a new Bundle E "Parallelism"** automatically activated. Roadmap enriched with v0.2c (onboarding + shared/local structure) and v0.9 extended (worktrees + Bundle E). Risks + 6 lines. 4 new decisions §11 #21–#24.*

*Changes v7→v8: four operational refinements in response to a usage return. (1) **§3.1 transition from 2 to 3 engines**: FAST (Ralph + 1-page minimal spec produced by Dream Catcher upstream — solves pure Ralph divergence), STANDARD (lightweight auto-dev: 1× party instead of 3×, opportunistic Phase 2) **= default mode**, DEEP (full BMAD process: PM Mary, Architect Winston, UX Sally, SM Bob, stories, Dev Amelia, QA Quinn, Christie reviewer). Explicit Engagement→Engine default mapping. (2) **Worker `brainstormer`** in pipeline §4: dedicated port of BMAD party mode, auto-triggered in Intermediate/Guided on subjects identified as "to expand", auto-decides by retaining recommendations matching the vision and ignoring the rest. (3) **Worker `mockup-generator`** between Dream Catcher and Tech Architect: ASCII/Mermaid wireframes (instant, fast mode/Pro), clickable static HTML (~30s, default), images generated via MCP image-gen if available (~1 min, Kid profile). Always active in Guided, on request in Intermediate, ASCII wireframe even in Fast (recommended). Materializes visual checkpoint #1. (4) **Polymorphic Reality Check**: Tech Architect chooses the strategy at the time of the tech decision, produces `reality-check.config.md`. Web → Playwright (main) or Claude in Chrome (fallback). Mobile → simulators + Maestro. Game → Playwright + perceptual diff. CLI → exec+assert. API → HTTP+assert. Lib → tests. Roadmap: v0.2d (3 engines) and v0.6 extended (polymorphic Reality Check + brainstormer + mockup-generator). Risks + 7 lines. 5 new decisions §11 #25–#29.*

*Changes v8→v9: (1) **Brainstorming correction** — I had confused with party mode. The real Dream Expander carries the BMAD/CIS pattern: facilitator (Mary the Analyst or Carson) who ASKS questions, ~60 techniques (SCAMPER, 6 Hats, How Might We, etc.), 4 modes (Progressive Flow by default), Anti-Bias Protocol every 10 ideas (pivot Tech→UX→Business), target 100+ ideas in Pro / 30-50 Curious / 10-15 Kid, output `brief.md`. Renaming `brainstormer → dream-expander` in the diagram. (2) **3 new Workers from gStack**: **Plan-Review** (between Mockup and Tech Architect, 4 sub-modes CEO/Eng/Design/Devex), **Context** (cross-cutting, save/restore primitives exposed to all Workers — critical for parallel worktrees and post-crash resume), **Security** (mode of polymorphic Reality Check — OWASP/STRIDE/secrets/supply chain). (3) **5 strengthened Workers**: Documentalist adopts **Diataxis discipline** (tutorials/how-to/reference/explanation) + post-ship doc sync pattern; Mockup Generator also produces `DESIGN.md`; Reality Check extended to **5 modes** (functional/visual/devex/security/canary); Worker merger integrates `landing-report` + safety hooks; Mode Router integrates `/plan-tune` auto-calibration. (4) **New Phase 5b Retro & Trend** (port of `/retro` + `/health`) between Delivery and Iterate. (5) **Optional gbrain RAG** in v0.9b for very large brownfield. Roadmap: v0.3a (Dream Expander), v0.3b (Plan-Review), v0.5b enriched (Diataxis + Context), v0.6 enriched (5 Reality Check modes + Security), v0.7 enriched (Retro & Trend), v0.9 enriched (safety hooks + landing-report), new v0.9b (gbrain). Risks + 6 lines. 5 new decisions §11 #30–#34.*

*Changes v9→v10: **major strategic pivot**. After an honest comparative audit, I realized that gStack already covers ~70% of what MMD ambitioned to build from scratch, with a production maturity MMD couldn't match in the short term. Decision enacted: **MMD = accessibility and orchestration layer on top of gStack**, not a from-scratch system. Focus on the **6 serious differentiators**: (1) multi-audience accessibility Kid→Pro, (2) reflexive bootstrap + autolearning, (3) worktrees parallelization, (4) brownfield Project Onboarder, (5) stateless hierarchical orchestration, (6) 3 engines with Mode Router. All other "additions" considered are **achieved by invoking gStack skills** rather than reimplementing. New content: **§3.2 Implementation strategy** (enacts the decision and lists the 6 differentiators), **§3.3 MMD ↔ gStack orchestration map** (table detailed per component of what is built vs invoked), `mmd-gstack-invoke` wrapper mechanism. Roadmap compressed by about 40%: versions that "carried" a gStack skill disappear or transform into "integrates" (e.g.: v0.5b Documentalist goes from 1 week to 4-5 days, v0.6 Reality Check goes from 1.5 weeks to 4-5 days, v0.7 Dream Delivery + Retro from 5 to 3 days). New v0.0 gStack install + audit (1 day, blocking). Estimated gain: **4-6 months** of avoided effort. Risks + 5 new lines (gStack dependency, API breaks, gap discovered late, subprocess perf, double BMAD+gStack dependency). 4 new decisions §11 #35–#38.*

*Changes v10→v11: (1) **Language switch to English for all documents**, including working and reflection notes (was: French scoping, English deliverables). Full translation of MAKE_MY_DREAMS.md by a sub-agent + renaming PROBLEMATIQUES.md → PROBLEMS.md with translation. Old French file deleted. (2) **New §1bis Positioning and credits**: explicit statement that MMD does NOT replace Spec Kit, OpenSpec, BMAD, gStack or Ralph Loop — MMD stands on their shoulders. Each contribution is acknowledged. The future MMD README will carry this positioning prominently. (3) **OpenSpec added as 5th reference framework** in §2.2 (Fission-AI/OpenSpec, lightweight SDD alternative to Spec Kit, candidate for the FAST engine 1-page minimal spec). Renumbering §2.3→§2.4 (gStack), §2.4→§2.5 (Ralph), §2.5→§2.6 (comparative summary). Project Onboarder updated to detect and import OpenSpec specs alongside Spec Kit and BMAD. (4) **Cleanup**: legacy §3.2/§3.3 (long-term vision and reuse strategy from v3) renumbered §3.4/§3.5 to remove duplication with new v10 §3.2/§3.3. Reuse strategy table annotated as partially superseded by §3.3. (5) **Implementation phase starts now**: two new files created in the workspace — `BOOTSTRAP.md` (exact commands to run for v0.0 and v0.1) and `SPEC_V01.md` (walking skeleton spec to feed into Extend BMAD `auto-dev`). The dev work begins with `auto-dev`, per the recommendation in §12.*

*Changes v11→v12: **the `extend-bmad` repo IS the MMD repo**, not a separate project. Recognized that MMD is the natural evolution of Extend BMAD — same intellectual lineage (12 scoping versions, 26 documented problems, `install-auto-dev.sh` becoming the Standard engine), same git history, no fork, no duplication. Updates: (1) **§1 Context** expanded to make this explicit. (2) **§12 Immediate next step** rewritten — no more "create separate repo", just "read BOOTSTRAP.md and execute". (3) **BOOTSTRAP.md substantially revised** (v2): the first 6 steps now operate on this very repo (README update, verify install-auto-dev.sh, install gStack globally, run audit, write ADR-001) rather than creating and bootstrapping a new repo. Optional folder rename `extend-bmad/` → `make-my-dreams/` documented but not required. No structural change to architecture, roadmap, risks, decisions — this is a workflow simplification, not a design change.*

*Changes v12→v13: continuation of the v12 logic — if the script is becoming MMD's installer, it should be named accordingly. **`install-auto-dev.sh` renamed to `install-mmd.sh`** via `git mv` (preserves history). Script header rewritten: title, lineage paragraph, **6-phase installation roadmap** (A Standard engine active, B FAST engine, C Bundle A Security, D Project Onboarder, E Conductor + Observability, F Worktrees + Bundle E parallelism) progressively activated with each MMD version. INSTALLER_VERSION bumped **4.0.0 → 5.0.0** to mark the transition. Welcome banner and final usage message updated to reflect MMD context with the coming-phases roadmap shown to users. All scoping-document references updated except for the historical lineage mention in §1 Context (where the original name is kept for traceability). BOOTSTRAP.md and SPEC_V01.md references updated. No structural change to architecture — this is a workflow naming alignment.*

*Changes v13→v14: Sébastien raised a fundamental question — without an IDE, how does his daughter actually use MMD? Realized that the roadmap delivered the accessibility experience (full Web Dream Catcher) at v0.10, far too late given that differentiator #1 (multi-audience accessibility) is MMD's whole reason to exist. Added a new **v0.2.5 milestone** to deliver a minimal usable web UI early: `mmd serve` command starts a local HTTP server, opens the default browser, and serves a deliberately simple HTML page (~200 lines vanilla, no framework). Sébastien's daughter opens the page on the same machine running MMD, types her dream, clicks a button, watches streamed progress, and gets a link to her PWA. **No tunnel, no cloud, no deployment** — purely local. Implementation is intentionally trivial (~2-3 days, ~300 lines total: CLI subcommand + Node HTTP server + vanilla HTML page + SSE for progress). Remote access (Wi-Fi + Cloudflare Tunnel) deferred to v0.6+. v0.10 (Full Dream Catcher Web UI) clarified as an enrichment of v0.2.5, not the unlock — the unlock for the daughter happens in v0.2.5. BOOTSTRAP.md updated to surface v0.2.5 as the "accessibility milestone" between v0.2d and v0.3a.*
