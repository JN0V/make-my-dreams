# Make My Dreams — v0.2.k Spec: MMD-on-MMD findings closure

> Per L-017 + cso (LOW-1, LOW-2) + qa (High-1, High-2, High-3, e2e t.skip) findings surfaced by full-stack dogfood after v0.2.8 ship — running `mmd discover` / `document-release` / `cso` / `qa` / `unblock` on the MMD repo itself produced **7 actionable findings** that none of the v0.2.4 → v0.2.8 Phase 4 reviews caught. The pattern is clean: each gap exists because tests covered "spec literally followed" rather than "spec applied to a real repo or a real failure mode". v0.2.k closes all 7 in one slice — small fixes individually, but together they harden the L-006/L-016 guarantees the system claims, and they bring `mmd discover` from "works on fixtures" to "works on a Node project we know intimately". After v0.2.k, re-running the full-stack dogfood on MMD should produce a clean report on the same 7 dimensions.

---

## 1. Goal of v0.2.k

Deliver 7 coordinated fixes, each tied to a finding from the dogfood session:

1. **L-017 fix — discover SCAN under-detection**:
   - Parse `package.json.scripts` and treat known runner invocations as test-runner signals
   - Walk `test/`, `tests/`, `__tests__/`, `spec/`, `specs/` recursively (bounded depth 4, gitignore-aware) to count `*.test.*`, `*_test.*`, `*.spec.*`
   - Add `test/fixtures/discover-repos/realistic-node/` — a small but real Node project mirroring MMD's shape (package.json with scripts, nested test/ dir)
2. **cso LOW-1 fix — `mmd serve` env allowlist**: route `lib/server.js:536` spawn through `buildSubprocessEnv(process.env)` (then add `MMD_SLUG`) — defense-in-depth consistency
3. **cso LOW-2 docs — `curl|bash` trust note**: add a "Trust assumptions" paragraph to `BOOTSTRAP.md` documenting that `install-mmd.sh` pipes `curl … | bash` for bun and gstack (gated by prompts); optionally pin known-good SHA-256 in a follow-up
4. **qa High-1 fix — spawn-failure escalate coverage**: add `@integration` test that uses `MMD_FAKE_5WHYS_EXIT` to simulate a non-zero spawn exit, asserts `parsed.recommended_action === 'escalate-to-user'`, validates the L-016 sacred-fallback guarantee end-to-end
5. **qa High-2 fix — end-to-end timeout coverage**: add `@integration` test that sets a tiny `MMD_FIVEWHYS_TIMEOUT_MS=200` against a slow fake-claude (sleep 2), asserts the kill fires + `recommended_action === 'escalate-to-user'` with timeout in evidence
6. **qa High-3 fix — logTail wiring assertion**: add `@integration` test that creates a stuck-slice fixture with known content in `.mmd/local/runs/*.log`, runs 5-whys with a fake-claude that **dumps the prompt it received**, asserts the prompt contains the log-tail substring
7. **e2e secondary fix — `assert.fail()` → `t.skip()` in `self-dogfood.test.js:67`**: when `git worktree add … main` is rejected (because the e2e itself runs on main), the test should skip, not fail

**Non-features** (deliberately deferred):
- Pinning curl|bash SHA-256 in install-mmd.sh (LOW-2's optional second half) — separate slice if/when the trust assumption needs hardening
- A "scanner-realism" lint rule enforcing the L-017 generalization across all future scanners — captured in L-017's rule itself, enforceable when v0.5b Documentalist promotes the rule to constitution

**Why this exists**: dogfood produced real findings. Each fix is small and well-scoped. Bundling them lets v0.2.k be a "closure slice" (no new feature, only debt) which is a healthy rhythm in any project. Plus, fixing the qa High-1/2/3 gaps means the L-006/L-016 guarantees on which v0.2.j was built become **test-enforced**, not just claimed in the lessons file.

**Mission validation**: after v0.2.k, re-running the dogfood (`mmd discover . && mmd cso && mmd qa`) on MMD itself should produce:
- discover: detects `node --test` runner + counts real test files
- cso: no LOW-1 (env allowlist consistent), LOW-2 still present but documented
- qa: 0 High findings (was 3), Medium count may shift, Low count likely similar

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: L-017 fix — discover SCAN reads package.json.scripts

**Given** a target directory with a `package.json` whose `scripts` block contains `"test": "node --test test/unit/*.test.js"`
**When** `mmd discover .` runs the SCAN phase
**Then** the report's "Test runner" line names `node --test` (not "none detected"). The detection regex matches at least: `node --test`, `jest`, `vitest`, `mocha`, `tap`, `tape`, `ava`, `pytest`, `playwright`, `cypress`. Implementation reads `package.json.scripts` ONLY (no `pyproject.toml` / `Cargo.toml` in v0.2.k — those are L-017+ follow-ups).

Tag: `@unit` for the runner-detection pure function with 10+ script fixtures. `@integration` against the new `realistic-node` fixture.

### AC-2: L-017 fix — discover SCAN walks test dirs recursively

**Given** a target with `test/unit/foo.test.js`, `test/integration/bar.test.js`, `test/e2e/baz.test.js`, `tests/qux_test.py`, `__tests__/quux.spec.ts`
**When** `mmd discover .` runs the SCAN phase
**Then** the report's "Tests" section counts all 5 (not 0). Walks bounded to depth 4. Respects `.gitignore` (no count of files under `node_modules/`, `.git/`, etc.). Glob pattern: `**/*.{test,spec}.{js,ts,jsx,tsx,py,rs,go}` + `**/*_test.{py,go}`.

Tag: `@unit` for the recursive counter with fixtures of varied depths/extensions. `@integration` against `realistic-node` fixture asserting count > 5.

### AC-3: cso LOW-1 fix — `mmd serve` spawn uses allowlist

**Given** `lib/server.js`'s `/api/dream` handler at line ~536
**When** spawning the intermediate `node bin/mmd.js <dream>` subprocess
**Then** the env arg is `{ ...buildSubprocessEnv(process.env), MMD_SLUG: slug }` (not `{ ...process.env, MMD_SLUG: slug }`). All other spawn sites already use this pattern.

Tag: `@unit` for a regression test spawning a tiny capture-env script, asserting that arbitrary parent env vars (e.g. `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`) don't leak into the child.

### AC-4: cso LOW-2 docs — `curl|bash` trust note in BOOTSTRAP.md

**Given** `install-mmd.sh` pipes `curl -fsSL https://bun.sh/install | bash` (line ~161) and `curl -fsSL https://gstack.dev/install.sh | bash` (line ~1214)
**When** the user reads `BOOTSTRAP.md`
**Then** a new "Trust assumptions" subsection documents: (a) the two `curl|bash` invocations exist and are gated by user prompt unless `MMD_AUTO_INSTALL_*=1`, (b) the trust is in `bun.sh` and `gstack.dev` HTTPS endpoints, (c) for high-assurance environments, users may pre-install bun + gstack manually before running the installer to skip those steps entirely.

Tag: `@unit` for README/BOOTSTRAP anchor presence (grep for the subsection title).

### AC-5: qa High-1 fix — spawn-failure escalate coverage

**Given** the 5-Whys runner spawns claude and claude exits non-zero (or the spawn itself fails)
**When** an `@integration` test sets `MMD_AUTODEV_CMD` (or equivalent for the 5-whys path) to a fake-claude that exits 1
**Then** the test asserts `parsed.recommended_action === 'escalate-to-user'`, `parsed.evidence[]` contains a spawn-error description, and the function returns without throwing.

Tag: `@integration`. New file `test/integration/five-whys-spawn-failure.test.js`.

### AC-6: qa High-2 fix — end-to-end timeout coverage

**Given** `MMD_FIVEWHYS_TIMEOUT_MS=200` is set and the fake-claude script sleeps 2 seconds before exiting
**When** an `@integration` test runs the 5-Whys runner
**Then** the test asserts the kill fires within ~500ms, `parsed.recommended_action === 'escalate-to-user'`, `parsed.evidence[]` mentions "timeout".

Tag: `@integration`. New file `test/integration/five-whys-timeout-e2e.test.js`.

### AC-7: qa High-3 fix — logTail wiring assertion

**Given** a stuck-slice fixture with a known string `MARKER_LOG_TAIL_42` in its latest `.mmd/local/runs/*.log`
**When** an `@integration` test runs the 5-Whys runner with a fake-claude that dumps the received prompt to its log
**Then** the test asserts the dumped prompt contains `MARKER_LOG_TAIL_42`, proving `safeReadLogTail` → `context.logTail` → prompt is wired end-to-end and won't silently regress to `''`.

Tag: `@integration`. New file `test/integration/five-whys-logtail-wired.test.js`.

### AC-8: e2e secondary fix — `assert.fail()` → `t.skip()`

**Given** `test/e2e/self-dogfood.test.js:67` currently uses `assert.fail(...)` when `git worktree add … main` is rejected (which happens when the e2e itself runs on main, NOT a code defect, just an environment incompatibility)
**When** the test encounters this case
**Then** it calls `t.skip('git worktree add main rejected — pre-condition not met (running on main itself)')` instead of failing. `npm run test:e2e` still passes when the e2e runs from a non-main checkout.

Tag: `@e2e` (unchanged) — but no new test needed, just the fix.

---

## 3. Architecture (incremental)

Pure additions/modifications to existing modules. No new top-level structure.

```
make-my-dreams/
├── lib/
│   ├── discover/
│   │   ├── scan.js                          # modified — readPackageJsonScripts() + walkTestDirs()
│   │   └── test-runner-detector.js          # NEW — pure fn: scripts → runner | null
│   └── server.js                            # modified — buildSubprocessEnv at line 536
├── test/
│   ├── unit/
│   │   ├── discover-test-runner-detector.test.js   # NEW
│   │   ├── discover-scan-recursive-walk.test.js    # NEW
│   │   └── server-env-allowlist.test.js            # NEW
│   ├── integration/
│   │   ├── discover-realistic-node.test.js         # NEW
│   │   ├── five-whys-spawn-failure.test.js         # NEW (AC-5)
│   │   ├── five-whys-timeout-e2e.test.js           # NEW (AC-6)
│   │   └── five-whys-logtail-wired.test.js         # NEW (AC-7)
│   ├── e2e/
│   │   └── self-dogfood.test.js                    # modified (AC-8)
│   └── fixtures/discover-repos/
│       └── realistic-node/                          # NEW (AC-1+AC-2)
│           ├── package.json   (with scripts.test = "node --test test/unit/*.test.js")
│           ├── test/unit/foo.test.js
│           ├── test/integration/bar.test.js
│           └── src/index.js
└── BOOTSTRAP.md                              # modified (AC-4)
```

---

## 4. Out of scope for v0.2.k

- ❌ Pinning curl|bash SHA-256 in install-mmd.sh (cso LOW-2 optional second half — separate slice)
- ❌ Extending L-017 fix to `pyproject.toml`, `Cargo.toml`, `go.mod` (Node-only in v0.2.k — L-017+ follow-ups)
- ❌ Closing the 8 Medium + 13 Low qa findings — they're real but they don't break a load-bearing guarantee. Can be addressed slice-by-slice as priorities allow.
- ❌ Promoting L-017's rule to ai-coding.md §VII — that's the v0.5b Documentalist's job.

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation checks
1. Read this SPEC_V02K.md fully — authoritative.
2. Read L-017 in `docs/lessons-learned.md` for the full context of finding #1.
3. Read the cso report at `.mmd/local/cso-runs/2026-05-30T15-04-48-525Z-83553-49bb.log` for LOW-1 + LOW-2 exact context.
4. Read the qa report at `.mmd/local/qa-runs/2026-05-30T15-34-16-875Z-85050-6991.log` for the High-1/2/3 exact context.
5. Read the relevant existing modules: `lib/discover/scan.js`, `lib/server.js`, `lib/conductor/five-whys.js`, `lib/invoke-autodev.js` (for `buildSubprocessEnv`).

### Key risks to handle
- **AC-3 (server env)**: `buildSubprocessEnv` may strip env vars the child legitimately needs. Verify against the actual `bin/mmd.js` paths — what env it reads. The shim already exports PATH for bun; that should pass through the allowlist.
- **AC-5/6/7 (qa fixes)**: the existing fake-claude fixtures for 5-Whys may need extension. Either add new fixtures or new env-driven branches in the existing one. Keep deterministic.
- **AC-1/2 (discover)**: the recursive walker must NOT follow symlinks (security) and must respect `.gitignore` (correctness). Use `node:fs.promises.readdir({ withFileTypes: true })` and a simple gitignore parser (likely already exists in repo via `git check-ignore` calls in scan.js).
- **`MMD_TIMEOUT_MS=0`** for the launch (per L-016). Spec-frozen prompt per L-016 rule.

### Apply lessons L-001..L-017
All standard. L-017 itself is the genesis of one of the ACs — the meta-loop is closing.

### Constitution module bindings
Active: universal, ai-coding, commit-git, testing, security (for AC-3 — env allowlist), error-handling, documentation, observability.

---

## 6. Definition of done

v0.2.k is done when:

1. All 8 ACs met.
2. Full test suite passes (current 858 + new tests, expected ~880-910).
3. Re-running `mmd discover .` on MMD reports a real test-runner + a non-zero test count.
4. Re-running `mmd cso` on MMD no longer flags LOW-1 (env allowlist consistent).
5. Re-running `mmd qa` on MMD's main no longer flags High-1/2/3.
6. README/BOOTSTRAP updates in place.
7. Version bumped to `0.2.9`.
8. Slice merged via `mmd ship` (or manual ff-only).
9. Tag `v0.2.9` created.
10. Eighth reflexive use of `mmd --here`. Composer should match L-017/L-016/L-006/L-002 → fast execution expected (~30-45 min wall-clock).

---

*Spec v0.2.k — generated 2026-05-30 from the v0.2.8 dogfood session. The closure slice that turns "MMD-on-MMD works (with caveats)" into "MMD-on-MMD works cleanly". Eighth reflexive use of mmd --here.*
