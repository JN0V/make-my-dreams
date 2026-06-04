# Make My Dreams — v0.16.0 Spec (slice v0.16.a): model-per-task — the Conductor allocates the model to the role

> *(The model is no longer a single global default — each task/role runs on a model matched to its cognitive demand. Sébastien's design: "dynamiquement en fonction des tâches à réaliser par les agents" — and the conductor/orchestrator, which mostly observes + delegates, doesn't need a big model.)*
>
> **What we VERIFIED first (the gating fact).** Per-subagent model override is IGNORED when `claude -p` runs ATTACHED to a Claude Code host (sub-agents forced to Haiku — bug #47488), but is **HONORED when launched DETACHED via `setsid`** — which is exactly how MMD launches auto-dev. Proven empirically: a sub-agent pinned `model: opus` ran on `claude-opus-4-8[1m]` in the detached run, on Haiku in the attached run. So model-per-subagent is feasible **in MMD's real launch path**, and must be **live-verified** (AC-4) because it silently fails attached.
>
> **The shape (per the Agent-tool reality).** You cannot pass a model per Task call from a prompt; the model is **baked into a named subagent's frontmatter** (`.claude/agents/<name>.md`, `model:`), selected by `subagent_type`. So "dynamic per task" = the orchestrator **routes each phase to the named agent whose pinned model fits** — driven by a pure, env-overridable **model policy**.
>
> **Two layers.** L1 = MMD's OWN discrete `claude -p` calls (judge / sealed-tester / unblock) — MMD owns each spawn → pass `--model` directly (proven to work). L2 = auto-dev's phase sub-agents — define named agents with pinned models (materialized by `install-mmd.sh`), rewrite the workflow to invoke them by name. The auto-dev PARENT (the orchestrator) gets a lighter model (it coordinates + delegates — §4.2), the WORKER sub-agents get the strong model where the real cognition is.

---

## 1. Goal of v0.16.a

```
A pure policy maps role → model (env-overridable). Applied at both layers:

L1 (MMD's own claude -p calls):      judge → MMD_MODEL_JUDGE   · tester → MMD_MODEL_TESTER   · unblock → MMD_MODEL_UNBLOCK
L2 (auto-dev parent + sub-agents):   orchestrator(parent --model) → MMD_MODEL_ORCHESTRATOR
                                     spec sub-agent  → MMD_MODEL_SPEC     (named agent, pinned)
                                     impl sub-agent  → MMD_MODEL_IMPL     (named agent, pinned)
                                     review sub-agent→ MMD_MODEL_REVIEW   (named agent, pinned)

Sensible cost-aware defaults (the conductor/orchestrator is light; the workers do the real work):
  orchestrator → sonnet   (coordinates + delegates; hands off at 70% so it never needs 1M)
  spec         → opus     (design/scoping — high reasoning)
  impl         → opus     (the real coding)
  review       → sonnet   (critique)
  judge        → sonnet   (grading the ask — modest)
  tester       → sonnet   · unblock → sonnet
Any role overridable via its MMD_MODEL_<ROLE> env var; MMD_AUTODEV_MODEL (global) still overrides the orchestrator.
```

Deliverables:
1. **Pure model policy** (`lib/conductor/model-policy.js`, never throws): `modelForRole(role, env)` → a model alias string (or `null` = "use the CLI default") with the cost-aware defaults above; `MMD_MODEL_<ROLE>` (upper-cased role) overrides a role; an unknown role → `null` (CLI default, never throws). Pure, deterministic. Exports the role list + defaults.
2. **L1 wiring** (`bin/mmd.js`): `invokeJudge`, `invokeSealedTester`, and the unblock 5-whys spawn pass `--model modelForRole('judge'|'tester'|'unblock', env)` (omit `--model` when the policy returns null). These are MMD's own `claude -p` calls — `--model` is honored (proven). No behavior change to the prompts.
3. **L2 named sub-agents + workflow rewrite** (`install-mmd.sh`): materialize `.claude/agents/mmd-spec.md` / `mmd-impl.md` / `mmd-review.md` (frontmatter `model:` from the policy defaults; a faithful copy of the general-purpose behavior + the constitution-injection contract); rewrite the auto-dev workflow's phase invocations from `subagent_type: "general-purpose"` to the named agents (spec→mmd-spec, impl→mmd-impl, the reviewers→mmd-review). The auto-dev PARENT spawn gets `--model modelForRole('orchestrator')` (via the existing `buildAutodevArgs` model path). Fresh-context discipline + per-phase checkpoint/handoff (v0.12-v0.15) are PRESERVED.
4. **Live verification (AC-4, REQUIRED)**: a real DETACHED `mmdream --here` run's `modelUsage` shows the expected models per role (e.g. the orchestrator on sonnet, an impl sub-agent on opus) — confirming the per-subagent models are honored in MMD's launch path (they silently fail attached, so green fakes are NOT enough — captured honestly; a mismatch is a wall).
5. **Docs + ADR**: ADR-055 (model-per-role, the attached-vs-detached finding + #47488, the named-subagent mechanism, the orchestrator-light/workers-strong rationale, env overrides, the cost angle); README + CLAUDE.md; `/mmdream` note (the env overrides); mechanical blocks; version → 0.16.0.

**Mission validation**: each role runs on its policy-assigned model (overridable via `MMD_MODEL_<ROLE>`); MMD's own calls pass `--model`; the auto-dev orchestrator runs lighter (sonnet) while impl/spec sub-agents run strong (opus) — proven in a real detached run's modelUsage (AC-4); the default (no overrides) is the sensible cost-aware mapping; nothing breaks the fresh-context + checkpoint/handoff machinery.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: pure model policy (env-overridable, never throws)
**Given** a role + an env
**When** `modelForRole(role, env)` runs
**Then**: returns the cost-aware default for known roles (orchestrator→sonnet, spec/impl→opus, review/judge/tester/unblock→sonnet); `MMD_MODEL_<ROLE>` overrides that role; an unknown/empty role → `null` (CLI default); pure, deterministic, never throws on odd/null input.
Tag: `@unit` (each role default; env override; unknown→null; null-safe).

### AC-2: L1 — MMD's own calls pass the role model
**Given** `invokeJudge` / `invokeSealedTester` / the unblock spawn
**When** invoked
**Then**: each passes `--model modelForRole(<role>, env)` to its `claude -p` (omitted when the policy returns null); the prompt/behavior is otherwise unchanged; `MMD_MODEL_JUDGE` etc. override per role.
Tag: `@unit`/`@integration` (the spawned argv carries the policy model; override respected; null → no --model).

### AC-3: L2 — named sub-agents materialized + workflow invokes them; orchestrator model set
**Given** `install-mmd.sh` run on a temp target
**When** the workflow + agents are materialized
**Then**: `.claude/agents/mmd-spec.md`/`mmd-impl.md`/`mmd-review.md` exist with a `model:` frontmatter (the policy defaults) and preserve the constitution-injection + fresh-context contract; the auto-dev workflow invokes them by name (no remaining `subagent_type: "general-purpose"` for the spec/impl/review phases); the parent auto-dev spawn passes the orchestrator model. The per-phase checkpoint/handoff instructions (v0.12-v0.15) remain.
Tag: `@integration` (materialize → grep the named agents + their model frontmatter + the workflow invoking them by name; checkpoint/handoff still present).

### AC-4: live model-per-role proof (REQUIRED, operator/live)
**Given** MMD itself after this slice, a real DETACHED `mmdream --here` run
**When** it runs through phases
**Then**: the run's `modelUsage` (stream-json result) shows the orchestrator on its policy model AND at least one sub-agent on its distinct policy model (e.g. impl on opus while orchestrator on sonnet) — confirming per-subagent models are honored in the detached launch path. **If the models do NOT match the policy (e.g. all forced to one model), it's a reported wall, NOT done** (the override silently fails attached — green fakes don't prove this; universal §VI, [[always-verify-live]]).
Tag: operator/live (no automated assertion — the explicit per-role-model proof).

### AC-5: docs
**Then**: ADR-055 lands; README + CLAUDE.md + `/mmdream` (the `MMD_MODEL_<ROLE>` overrides) updated; mechanical blocks; version → 0.16.0.
Tag: `@unit`/`@integration` (ADR-055 exists; env overrides documented; version bumped).

---

## 3. Out of scope (deferred)

- **Truly adaptive selection** (the orchestrator reasons about a task's complexity at runtime and dials the model) — v1 is a per-role policy (static defaults + env overrides), which is "per task" at role granularity. Complexity-adaptive is a later refinement.
- **Party-mode persona models** (the BMAD agents inside Phase 1) — keep them on the orchestrator default for now; per-persona models are a follow-up.
- **`contextWindowFor('sonnet')` accuracy** — still a separate small fix; with the orchestrator now defaulting to sonnet, this becomes more relevant (track it).
- **A cost report** (per-run modelUsage surfaced to the user) — nice follow-up, not this slice.

---

## 4. Operational notes for the implementer

- REUSE the v0.13.2 `buildAutodevArgs` `model` path for the orchestrator parent `--model`; add the `--model` to the L1 `invoke*` spawns the same way.
- The named sub-agents (`.claude/agents/mmd-*.md`) MUST faithfully carry the existing general-purpose behavior + the MANDATORY constitution-injection block (per the workflow's "CONSTITUTION INJECTION" section) — do not lose any contract. Keep fresh-context discipline.
- **Per-subagent model only works DETACHED** (the host forces Haiku when attached — #47488). MMD launches via `setsid` (detached) so this holds, but AC-4 MUST verify it live (a green test suite cannot — the fakes don't spawn real models).
- Defaults are cost-aware (orchestrator/review/judge on sonnet; spec/impl on opus). Every role is `MMD_MODEL_<ROLE>`-overridable; `MMD_AUTODEV_MODEL` remains the global orchestrator override.
- Commit incrementally per AC (L-019). Tests tagged per stratum. AC-4 is live — never mark done on green fakes alone.
