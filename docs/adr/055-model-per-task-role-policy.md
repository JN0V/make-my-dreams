# ADR-055 — Model-per-task: the Conductor allocates a model to each role

**Status**: accepted
**Date**: 2026-06-04
**Slice**: v0.16.a (a pure env-overridable role→model policy, applied at MMD's own `claude -p` calls and at the auto-dev sub-agents)

## Context — one global model for every task is wrong on both ends

Until now every task in an MMD run used a single model: the auto-dev parent and
all its phase sub-agents ran on the CLI default (or the global `MMD_AUTODEV_MODEL`
override), and MMD's own discrete `claude -p` calls (the behavioral judge, the
sealed tester, the `unblock` 5-Whys session) likewise had no per-call model.

That is wasteful at both ends. The **orchestrator** (vision §4.2) mostly observes
and delegates — it spawns each phase into a fresh sub-agent and hands off at 70%
context, so it never needs a big model or a 1M window; running it on the strong
model is paying for reasoning it does not do. Conversely the **worker** tasks that
carry the real cognition — designing/scoping the spec, writing the implementation —
deserve the strong model, while critique/grading tasks (review, judge, tester,
unblock) sit comfortably on a lighter, cheaper model. Sébastien's design:
*"dynamiquement en fonction des tâches à réaliser par les agents"* — the model
should match the task, not be one global default.

### The gating fact we verified FIRST

A per-subagent model override is **IGNORED when `claude -p` runs ATTACHED** to a
Claude Code host (the host forces sub-agents to Haiku — bug #47488), but is
**HONORED when launched DETACHED via `setsid`** — which is exactly how MMD launches
auto-dev. Proven empirically: a sub-agent pinned `model: opus` ran on
`claude-opus-4-8[1m]` in the detached run and on Haiku in the attached run. So
model-per-subagent is feasible **in MMD's real launch path** — but it silently
fails attached, so it MUST be live-verified (AC-4); a green test suite (whose fakes
do not spawn real models) cannot prove it.

### The shape forced by the Agent-tool reality

You cannot pass a model per `Task` call from a prompt; the model is **baked into a
named sub-agent's frontmatter** (`.claude/agents/<name>.md`, `model:`), selected by
`subagent_type`. So "dynamic per task" becomes: the orchestrator **routes each
phase to the named agent whose pinned model fits the role** — driven by a pure,
env-overridable policy.

## Decision — a pure role→model policy, applied at two layers

A single pure module, `lib/conductor/model-policy.js`, maps a **role** to a model
alias (or `null` = "use the CLI default"), with cost-aware defaults and a
`MMD_MODEL_<ROLE>` override per role. It is pure (no fs/spawn/Date), deterministic,
and never throws — an unknown/empty role returns `null`. It exports `ROLES` and
`DEFAULTS` as the single source of truth.

**Cost-aware defaults** (light orchestrator/critique, strong workers):

| Role | Default | Why |
|------|---------|-----|
| `orchestrator` | `sonnet` | coordinates + delegates; hands off at 70% → never needs 1M |
| `spec` | `opus` | design / scoping — high reasoning |
| `impl` | `opus` | the real coding — highest reasoning |
| `review` | `sonnet` | adversarial critique |
| `judge` | `sonnet` | grading the ask — modest |
| `tester` | `sonnet` | deriving sealed acceptance tests |
| `unblock` | `sonnet` | a short 5-Whys session |

The policy is applied at **two layers**:

**L1 — MMD's OWN `claude -p` calls.** `invokeJudge` / `invokeSealedTester`
(`bin/mmd.js`) and the `unblock` 5-Whys spawn (`lib/conductor/five-whys.js`) each
pass `--model modelForRole('judge'|'tester'|'unblock', env)` to their spawn
(omitted when the policy returns `null`). MMD owns each spawn, so `--model` is
honored directly (no #47488 caveat). The flag is appended **after** the positional
prompt so the strict fake-claude arg contracts (and the real CLI) are preserved;
prompts and behavior are otherwise unchanged.

**L2 — the auto-dev parent + phase sub-agents.** The auto-dev **parent** is the
`orchestrator` role: it gets `--model modelForRole('orchestrator')` via the
existing `buildAutodevArgs` model path (resolution: `MMD_AUTODEV_MODEL` global
override → else the policy → `sonnet`). The phase **workers** are named sub-agents
materialized by `install-mmd.sh` — `.claude/agents/mmd-spec.md` (opus),
`mmd-impl.md` (opus), `mmd-review.md` (sonnet) — each a faithful general-purpose
agent PLUS the mandatory constitution-injection contract and fresh-context
discipline. The auto-dev workflow's phase invocations are rewritten from
`subagent_type: "general-purpose"` to the named agents (spec→`mmd-spec`,
impl→`mmd-impl`, the reviewers→`mmd-review`). The agents' `model:` frontmatter
**mirrors** `model-policy.js`'s `DEFAULTS` — the JS module is the canonical source
(it drives L1); the bash materialization is the L2 mirror (a consistency-by-design
comment + the AC-3 grep keep them aligned).

**Overrides.** Any role is overridable via `MMD_MODEL_<ROLE>` (e.g.
`MMD_MODEL_IMPL=sonnet`, `MMD_MODEL_JUDGE=opus`). `MMD_AUTODEV_MODEL` remains the
global orchestrator override (it wins over the policy for the parent spawn). An
L2 sub-agent's model is frozen at install time; re-run `install-mmd.sh` (with the
env override visible to a future materialization slice) to change it — the env
override is live today for L1 and the orchestrator parent.

## Consequences

- **Cheaper + better-fit runs by default.** The orchestrator and the critique/grade
  tasks run light (sonnet); spec + impl run strong (opus). No flag required — the
  default IS the cost-aware mapping.
- **Reuse, not reinvention.** L1 reuses each existing `invoke*` spawn (one
  `--model` push); L2 reuses `buildAutodevArgs`'s model path. `buildAutodevArgs`
  itself is UNCHANGED — the orchestrator model is resolved by its caller — so the
  spawn-pin tests still hold. The only behavior change to the default *real* spawn
  is the added `--model sonnet` for the orchestrator (test-fixture mode is `[dream]`
  and carries no `--model`, so the fake-based suite is unaffected).
- **Live verification is REQUIRED (AC-4, §VI).** Because per-subagent models
  silently fail attached, a green suite is not proof. AC-4 is an operator/live run
  whose `modelUsage` must show the orchestrator on its policy model AND at least one
  sub-agent on a distinct policy model (e.g. impl on opus while the orchestrator is
  on sonnet). A mismatch (e.g. all forced to one model) is a reported wall, NOT
  done — [[always-verify-live]].
- **Negative / limits.** "Per task" is at **role granularity** (static defaults +
  env overrides), not yet runtime complexity-adaptive selection. An L2 sub-agent's
  model is fixed at install time (no live env override for the named agents yet).
  Party-mode persona models stay on the orchestrator default. `contextWindowFor`
  accuracy for `sonnet` becomes more relevant now that the orchestrator defaults to
  it (tracked separately).

## Alternatives considered

- **One global model with a single override (status quo)** — rejected: it overpays
  for the orchestrator and underpowers nothing it can tune; the whole point is to
  match model to task.
- **Truly adaptive selection (the orchestrator reasons about a task's complexity at
  runtime and dials the model)** — deferred: v1 is a per-role policy, which is "per
  task" at role granularity; complexity-adaptive is a later refinement on top.
- **Pass `--model` per Task call from the orchestrator prompt** — impossible: the
  Agent tool bakes the model into the named sub-agent's frontmatter; you select the
  model by selecting the agent, which is exactly what the workflow rewrite does.
- **Hardcode the L2 models in install-mmd.sh with no link to the policy** — rejected
  as drift-prone: the values mirror `model-policy.js` `DEFAULTS` with a documented
  canonical-source comment + an AC-3 assertion against `DEFAULTS`.

See docs/specs/SPEC_V016A.md, ADR-050 (the resumable orchestrator the parent model rides on),
ADR-051/053/054 (the Conductor handoff machinery the light orchestrator complements),
ADR-028 (the judge), ADR-026 (the sealed tester), ADR-011 (the unblock 5-Whys),
L-027 (the detached-vs-attached / `[1m]` window finding), §VI / [[always-verify-live]]
(why AC-4 is a live proof, not a green-by-fakes pass).
