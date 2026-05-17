# Constitution Module — Testing

> Loaded for: any skill or worker that writes, runs, or reasons about tests. Also loaded for the FAST / STANDARD / DEEP engines because tests are produced at every stage.

## I. Test types

- **Integration tests are mandatory**: every change MUST include integration tests.
- **Unit tests**: required only when isolated business logic warrants it.
- Tests MUST cover API contracts (inputs/outputs).
- No code is merged without passing tests.

## II. Red-Green-Refactor

- Write the test → verify it fails → implement → verify it passes → refactor.
- **TDD by default**: test-driven development is the standard working method.

## III. Every failure deserves a red-green pass — not just bugs (NON-NEGOTIABLE)

ANY failure encountered during development MUST trigger a red-green sequence. "Failure" is interpreted broadly: failing test, crashing install script, misbehaving pipeline phase, tool not producing expected output, integration handshake mismatch, Worker returning wrong shape, autodev convergence loop, Reality Check failing — all of these are failures and all follow the same protocol:

1. **RED**: write or run an explicit, deterministic, repeatable test/check that demonstrates the failure. An ad-hoc reproduction does NOT count.
2. **GREEN**: implement the fix and verify the test now passes.
3. **Document** the failure + fix in a lessons-learned entry (when MMD autolearning is active, this becomes automatic per scoping §6.5).

Even when the failure is in the installer, the workflow file, the constitution itself, or a config glitch (e.g. BMAD's unresolved `{output_folder}` variable), the same protocol applies. **There is no "just fix it" — there is always a test or check that proves the failure was understood and corrected.**

## IV. Bug fix = test first

A specific application of principle III. Every bug fix MUST start with a non-regression test that reproduces the bug (red), then the fix (green). This ensures the bug never resurfaces.

## V. Test stratification (NON-NEGOTIABLE — new in MMD)

AI-driven TDD produces test corpora that explode in size and runtime (40+ minutes in real projects). To keep the loop fast AND safe, every test MUST belong to exactly one stratum:

| Tag | When run | Typical contents | Budget |
|---|---|---|---|
| `@smoke` | pre-commit hook | 5-10 critical-path tests | < 10s |
| `@unit` | pre-push hook | All unit tests (pure logic, no I/O) | < 60s |
| `@integration` | every PR (CI) | Unit + integration (cross-module, FS, subprocess) | < 5 min |
| `@e2e` | nightly CI or pre-release | Reality-Check style, full browsers, slow | unbounded but reported |
| `@mutation` | manual or weekly | Mutation testing to assess corpus quality | hours, on-demand |
| `@slow` | opt-in (`MMD_TEST_INCLUDE_SLOW=1`) | Anything that intentionally exceeds its stratum budget | unbounded |

### Constraints

- A `@unit` test that exceeds 100 ms MUST be re-tagged `@integration` or `@slow`.
- A `@smoke` test that exceeds 1 s MUST be re-tagged.
- The test runner exposes `npm test:smoke`, `npm test:unit`, `npm test:integration`, `npm test:e2e`, `npm test:full` (all).
- Default `npm test` = `unit`.
- CI fast lane = `npm test:integration`. CI nightly = `npm test:full`.

### Test impact analysis (preferred when available)

- If `git diff` is available, pre-push SHOULD use `jest --findRelatedTests` (or equivalent) on changed files, not the full corpus.
- Workers that produce tests MUST set the right tag based on what the test exercises (the test's content, not just its file location).

### Anti-pattern

- An AI Worker that writes 100 `@unit` tests where 10 `@integration` tests would have done is violating principle II of `universal.md` (KISS) AND wasting future runtime budget. Prefer expressive integration tests over exhaustive unit tests for high-fan-out features.

---

*Version: 1.0.0 | Loaded by every coding-touching skill, every engine. See bindings.*
