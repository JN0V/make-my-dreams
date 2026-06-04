// lib/conductor/model-policy.js — the PURE, env-overridable model policy
// (SPEC_V016A AC-1, ADR-055). "Model-per-task": the Conductor allocates a model
// to each ROLE instead of running every task on one global default. Each role
// runs on a model matched to its cognitive demand — the orchestrator mostly
// observes + delegates (it hands off at 70% so it never needs a 1M window), so
// it gets a LIGHT model; the workers that do the real reasoning (spec design,
// implementation) get the STRONG model. This is the cost-aware default; every
// role is overridable via its MMD_MODEL_<ROLE> env var.
//
// WHY a separate pure module (universal §I.S SRP, §II KISS): the policy is a
// single role→model mapping consumed at TWO layers — L1 is MMD's own discrete
// `claude -p` spawns (judge / tester / unblock) where bin/mmd.js passes `--model`
// directly, and L2 is the auto-dev orchestrator parent (`buildAutodevArgs`'s
// model path) whose worker sub-agents pin their model in named-agent frontmatter
// materialized by install-mmd.sh. Keeping the mapping here — pure (no fs, no
// spawn, no Date), deterministic, and NEVER throwing on odd/null input, like
// alignment-gate.js / handoff.js — lets the unit suite assert every role + the
// override + the unknown→null fallback without a real claude, and gives both
// layers ONE source of truth (DRY, universal §III).
//
// `null` means "use the CLI default" — the policy declines to pin a model, so the
// caller OMITS `--model` and lets claude pick its configured default. An unknown
// or empty role returns null (never throws, never a fabricated model).

/**
 * The known roles, in a stable order. Exported so callers/tests can enumerate
 * the policy without hard-coding the list (L-009: design-vs-substrate — one
 * source of truth for the role set).
 * @type {readonly string[]}
 */
export const ROLES = Object.freeze([
  'orchestrator',
  'spec',
  'impl',
  'review',
  'judge',
  'tester',
  'unblock',
]);

/**
 * Cost-aware defaults (SPEC_V016A §1). The orchestrator/review/judge/tester/
 * unblock roles are LIGHT (sonnet — they coordinate, critique, grade, or run a
 * short modest session); spec + impl are STRONG (opus — design/scoping and the
 * real coding, the high-reasoning work). Frozen so a consumer cannot mutate the
 * shared policy.
 * @type {Readonly<Record<string, string>>}
 */
export const DEFAULTS = Object.freeze({
  orchestrator: 'sonnet',
  spec: 'opus',
  impl: 'opus',
  review: 'sonnet',
  judge: 'sonnet',
  tester: 'sonnet',
  unblock: 'sonnet',
});

/**
 * Resolve the model alias for a role.
 *
 * Resolution order:
 *   1. unknown / empty / non-string role            → null (CLI default)
 *   2. `MMD_MODEL_<ROLE>` set to a non-empty value   → that value (per-role override)
 *   3. otherwise                                     → the cost-aware DEFAULTS entry
 *
 * Pure + deterministic + NEVER throws (universal §VI): a null/undefined env, a
 * numeric role, a whitespace-only override all degrade to a safe value rather
 * than crash. An empty/whitespace `MMD_MODEL_<ROLE>` is treated as "no override"
 * (falls through to the default) — consistent with buildAutodevArgs treating an
 * empty model string as "no --model".
 *
 * @param {string} role  one of ROLES (case-insensitive); anything else → null
 * @param {object} [env=process.env]  the environment to read overrides from
 * @returns {string|null}  a model alias (e.g. 'sonnet'/'opus'), or null = CLI default
 */
export function modelForRole(role, env = process.env) {
  if (typeof role !== 'string') return null;
  const key = role.trim().toLowerCase();
  if (key === '' || !Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    return null;
  }
  const e = env && typeof env === 'object' ? env : {};
  const override = e[`MMD_MODEL_${key.toUpperCase()}`];
  if (typeof override === 'string' && override.trim() !== '') {
    return override.trim();
  }
  return DEFAULTS[key];
}
