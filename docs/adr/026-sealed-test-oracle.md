# ADR-026 — Sealed-test oracle (`mmd --sealed`): an MMD-layer guard against the agent-rewrites-the-test failure

**Status**: Accepted
**Date**: 2026-06-01
**Deciders**: MMD core (self-dev, 20th reflexive `mmd --here`, 7th with `--label`)
**Parent design**: [SPEC_V04A.md](../../SPEC_V04A.md) (FROZEN) — Bundle B. Maps to [PROBLEMS.md](../../PROBLEMS.md) P-04 (false-positive "fixes"), P-05 (invisible blast radius), P-09 (weak oracles).

## Context

The single most damaging AI-coding failure is the **false positive**: the agent reports "DONE, tests pass" but made the tests pass by **rewriting the test, not the code**. The published number is stark — roughly a quarter of "verified" SWE-bench-Pro patches are actually wrong. MMD's own auto-dev is not immune: its Phase-3 reviewers and Phase-4 adversarial pass grade *the agent's own tests*, so a test the agent quietly weakened still "passes" its own review. Self-graded tests cannot catch self-serving test edits — you need an **oracle the implementing agent does not control**.

The auto-dev pipeline that does the implementing lives in **`_bmad/`, which is gitignored** (it is materialized by `install-mmd.sh`, not version-controlled here). So we cannot harden the workflow by editing it — any change would be wiped on the next install and is invisible to this repo's history and tests. The enforcement has to live where MMD's own committed code is: the **MMD layer** (`bin/mmd.js` + `lib/`).

Two related gaps ride along: a change's true reach is invisible (P-05 — "what else might this break?"), and MMD's oracles are weak (P-09 — a test the author also wrote is a soft oracle).

## Decision

Ship an **opt-in** `mmd --sealed "<dream>"` that wraps the greenfield path in a **two-phase, two-agent, MMD-orchestrated** flow, plus a blast-radius stub. Default behaviour (no `--sealed`) is **byte-for-byte unchanged**.

### 1. MMD-layer enforcement, not a BMAD-workflow change

Because `_bmad/` is gitignored, the seal/verify logic lives entirely in committed MMD code: `lib/sealed-tests/` (pure) + the `--sealed` branch in `bin/mmd.js` (orchestration). The auto-dev workflow is invoked **unchanged** as the coder; MMD wraps it from the outside. This keeps the guard version-controlled, tested, and independent of whatever `install-mmd.sh` materializes.

### 2. The two-phase tester/coder split (an independent oracle)

- **TESTER** (`claude -p`, reusing `buildSubprocessEnv` + the `MMD_AUTODEV_CMD` test seam) derives acceptance tests from the dream (+ `slice.md`) into `demo/<slug>/.mmd/shared/sealed-tests/`, and is told **not to implement the app**. An oracle that also wrote the implementation is not independent — the blindness is the point.
- **CODER** is the existing auto-dev, handed a prompt that names the sealed directory as a **read-only oracle**. It reads the tests to learn the target behaviour; it must not touch them.

The sealed directory is `.mmd/shared/sealed-tests/` (chosen over `test/sealed/` in the demo root) precisely because it sits **outside the coder's writable surface** — the coder is told to write the app, not to touch `.mmd/`. The seal then enforces what the prompt requests.

### 3. Hash-manifest tamper enforcement (anti-P-04)

After the tester writes the tests, MMD **seals** them: `buildManifest` records `{ relPath: sha256 }` (`lib/sealed-tests/manifest.js`, pure over injected fs). After the coder finishes, `verifyManifest` re-hashes and diffs into `{ tampered, removed, added }`:

- **tampered** (content hash changed) or **removed** (file gone) → **seal broken**. `mmd` exits non-zero **naming the files**, writes `status.state = failed`, and does **not** mark the slice done or merge it. Rewriting a test to pass is a *detected failure*, never a shortcut.
- **added** files (the coder's own helper tests) do **not** break the seal — only weakening/deleting the oracle is forbidden.

On an intact seal, MMD **re-runs** the sealed tests (`node --test`) as the independent oracle; a failure flags the slice. Honesty is enforced at every branch (universal §VI): tester-failed, empty-seal, coder-error, tamper, and sealed-test-failure each surface explicitly — there is no silent "sealed OK".

### 4. Blast-radius stub (P-05)

`computeBlastRadius(changedFiles, { listFiles, readFile })` returns the changed files plus their **direct importers** (grepping `import`/`require` references), written to `status.json.blast_radius`. It is a deliberate stub — text grep over- and under-counts — logged as advisory, never gated on.

## Consequences

- **Positive**: MMD now has the first correctness-hardening of its own auto-dev — an oracle the coder cannot quietly weaken (closes the P-04 vector for opt-in runs). Enforcement is committed, tested (unit + integration with a fake claude that never hits the network), and independent of the gitignored workflow. Blast radius gives a first, honest signal of a change's reach (P-05).
- **Negative / limits**: opt-in only — a default-on guard would protect every run but changes the default path (deferred deliberately). The blast radius is grep-based (false positives/negatives). The sealed re-run is `node --test` over the sealed files, which assumes they are runnable and module-type-compatible with the generated demo (today MMD writes no `package.json`, so CJS test files run; a coder that later writes `"type":"module"` could make a CJS oracle fail to load — a v0.5 hardening: the tester prompt should match the project's module type). All documented, not hidden.

## Alternatives considered

- **Edit the BMAD `_bmad/` workflow to forbid test edits.** Rejected: `_bmad/` is gitignored — the change would be uncommitted, untested, and wiped on reinstall. Enforcement must live in MMD's committed code.
- **Let the coder write its own tests, grade harder in Phase 4.** Rejected: self-graded tests cannot catch self-serving test edits. Independence (a separate blind tester + a hash seal) is the only thing that does.
- **AST-accurate blast radius now.** Deferred to v0.5: the grep stub is enough to surface the signal; AST is a larger, separable upgrade.

## Deferred (explicitly out of scope for v0.4.a)

- `--sealed` on `--here` and as a **Standard-engine default** — the `lib/sealed-tests/` core is surface-agnostic, so these are an easy follow-up, but adopting them changes default behaviour and deserves its own slice.
- **AST-based blast radius** (grep stub here; AST in v0.5).
- Property-based / golden-trace / LLM-as-judge oracles (deeper P-09).
- Modifying the BMAD `_bmad/` auto-dev workflow itself (enforcement stays MMD-layer by design).

See [SPEC_V04A.md](../../SPEC_V04A.md) for the 6 ACs and [`docs/lessons-learned.md`](../lessons-learned.md) L-023 for the captured rule.
