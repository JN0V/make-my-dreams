# Make My Dreams — v0.2.h Spec: Conductor preconditions hardening (prompt-grounding check)

> Per L-015 — the Conductor (today: `lib/here-mode.js`) currently validates only git-domain-general preconditions (clean tree, branch protection, clean ancestry). It does NOT introspect the dream/prompt content for file references that auto-dev will rely on. The first L-015 occurrence cost ~30 min of wasted auto-dev when SPEC_V02G.md was referenced in the dream but absent from the slice's base. The operational mitigation (manual `git show base:<file>` before launch) works but is human-in-the-loop. v0.2.h ships the **automated check**: before `spawn`, parse the dream for paths matching documented patterns, verify each exists on the base SHA via `git cat-file`, exit non-zero with the list of missing files if any. Same architecture as v0.2.l's composer (a small pure function + a single wiring point + tests + escape hatch via env var). Walking-skeleton: regex on a closed set of patterns (SPEC_*.md, docs/*.md, .specify/*.md, ADR-*.md), no semantic / LLM-based extraction. Future hardening (broader detection, fuzzy paths) deferred.

---

## 1. Goal of v0.2.h

Deliver three coordinated pieces:

1. **Pure extractor** `lib/here-mode/extract-file-refs.js` — `extractFileRefs(dreamText): string[]` returns the list of repo-relative paths referenced in the dream. Closed-pattern (SPEC_*.md, docs/*.md, docs/adr/*.md, .specify/memory/*.md, MAKE_MY_DREAMS.md, PROBLEMS.md, BOOTSTRAP.md, CLAUDE.md, README.md, package.json). Deterministic, no I/O.
2. **Verifier** `lib/here-mode/verify-grounding.js` — `verifyGrounding({ files, baseSha, repoRoot }): { missing: string[] }` runs `git cat-file -e <baseSha>:<file>` for each. Returns the missing subset. Mock-friendly (injectable git runner).
3. **Wiring in `lib/here-mode.js`** — between clean-tree check and slice-branch creation, call `extractFileRefs(dream) → verifyGrounding(...)`. If `missing.length > 0`, exit code 6 with a clear message listing each missing file + suggested remediation ("commit/push these files to main before `mmd --here`, or remove the references from the dream"). Escape hatch: `MMD_SKIP_GROUNDING=1` bypasses the check (for cases where the file lives somewhere the regex doesn't know about — temporary opt-out, not recommended).

**Non-features** (deliberately deferred):
- LLM-based / semantic file reference extraction (the closed pattern set handles 95% of cases; semantic in v0.5+).
- Fuzzy / case-insensitive path matching (deterministic exact match in v0.2.h).
- Recursive verification (does this file's referenced files also exist?) — out of scope.
- Cross-slice or cross-worktree verification — only the launch base of THIS `mmd --here` invocation.

**Why this exists**: L-015 captured the gap and gave a manual mitigation that works but is fragile (I or the user could forget). The operational pain was already paid (v0.2.g launch chaos before we noticed SPEC_V02G.md wasn't on main). v0.2.h closes the loop in code so the next time someone references a file that isn't on the base, the check fires in <100ms and exits with a friendly error instead of consuming 30+ minutes of auto-dev on a nonsensical prompt.

**Mission validation**: after v0.2.h, running `mmd --here "implement v9.9.9 per SPEC_V99X.md"` (file that doesn't exist) exits with code 6, prints the path of the missing file, and suggests remediation. Test-enforced.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: `extractFileRefs` extracts paths from documented patterns

**Given** a dream string referencing zero, one, or many files matching the documented patterns
**When** `extractFileRefs(dream)` is called
**Then** the returned list contains the exact repo-relative paths (no duplicates, deterministic order). Patterns to match:
- `\bSPEC_[A-Z0-9_]+\.md\b` (e.g., `SPEC_V02H.md`)
- `\bdocs/[a-z0-9/\-_]+\.md\b` (e.g., `docs/lessons-learned.md`)
- `\bdocs/adr/[0-9]+-[a-z0-9-]+\.md\b` (e.g., `docs/adr/012-composer-categorization.md`)
- `\b\.specify/memory/[a-z0-9/\-_]+\.md\b`
- Whole-name tokens: `MAKE_MY_DREAMS.md`, `PROBLEMS.md`, `BOOTSTRAP.md`, `CLAUDE.md`, `README.md`, `package.json`

If the same path appears twice in the dream → returned once. If the dream has no matches → returns `[]`.

Tag: `@unit` exhaustive: zero refs, single ref, multiple, duplicate, edge cases (path inside backticks, inside quotes, with surrounding punctuation).

### AC-2: `verifyGrounding` runs `git cat-file -e` per file

**Given** a list of files + a base SHA + a repo root
**When** `verifyGrounding({ files, baseSha, repoRoot, runGit? })` is called
**Then**:
- For each file, calls `runGit(['cat-file', '-e', `${baseSha}:${file}`])` (or the injected default)
- Returns `{ missing: string[] }` containing files where `cat-file` exited non-zero
- Returns `{ missing: [] }` if all files exist
- Pure shape: no `process.exit`, no console writes — caller decides what to do

Tag: `@unit` with injected mock runner returning configurable exit codes per file. `@integration` against the live repo with a known-existing + a known-missing file.

### AC-3: Wiring in `lib/here-mode.js`

**Given** a `mmd --here "<dream>"` invocation
**When** the pre-checks run after clean-tree validation and before slice-branch creation
**Then** the flow is:
- `files = extractFileRefs(dream)`
- If `files.length === 0` → continue normally (no check needed)
- Else `{ missing } = await verifyGrounding({ files, baseSha: HEAD_SHA, repoRoot })`
- If `missing.length === 0` → continue normally
- If `missing.length > 0` → write to stderr a multi-line message: "Prompt-grounding failed (per L-015) — the following files referenced in your dream do not exist on this slice's base (main @ <SHA>): <list>. Either commit them to main first, or remove the references from the dream. To bypass this check (NOT RECOMMENDED), set MMD_SKIP_GROUNDING=1." Exit code 6.

Tag: `@unit` for the pre-check sequence with mocked extractor + verifier. `@integration` end-to-end with a real git repo fixture.

### AC-4: `MMD_SKIP_GROUNDING=1` escape hatch

**Given** the user sets `MMD_SKIP_GROUNDING=1` in env
**When** `mmd --here` runs with a dream referencing missing files
**Then** the check is skipped entirely (no extractor call, no verifier call). The wrapper prints a warning to stderr: "[mmd] grounding check skipped (MMD_SKIP_GROUNDING=1) — proceeding with possibly nonsense prompt at user's risk." Exit code 0 (slice proceeds).

Tag: `@integration` with the env var set.

### AC-5: Documentation + ADR + constitution rule

**Given** v0.2.h ships
**When** the user reads `README.md`, `docs/adr/013-prompt-grounding-check.md`, and `.specify/memory/constitution/ai-coding.md`
**Then**:
- README has a paragraph under `## Usage` describing the grounding check + the env-var escape hatch + the exit code 6 contract
- ADR-013 covers: why closed-pattern regex over LLM extraction (deterministic, cost-free, sub-100ms; 95% coverage), why exit 6 (consistency with the v0.2.j exit code map), why the escape hatch (defensive — the check WILL have false positives for unusual paths, and blocking entirely is worse than allowing opt-out)
- `ai-coding.md` rule update: "**Prompt-grounding** (extends §VI from v0.2.j): every file path cited in a dream MUST exist on the launch base. The `lib/here-mode` precheck enforces this automatically since v0.2.h; the rule remains in case someone bypasses via MMD_SKIP_GROUNDING. Honor the spirit even when the check is bypassed — pasting a SPEC file path that doesn't exist is a 30-min-of-auto-dev mistake."

Tag: `@unit` for README/ADR/constitution anchor presence.

---

## 3. Architecture (incremental)

```
mmd --here "<dream>"
   │
   ▼
[1] validate cwd is git repo  (unchanged)
   │
   ▼
[2] validate clean working tree  (unchanged)
   │
   ▼
[3] *** NEW *** verify prompt-grounding:
       files = extractFileRefs(dream)
       if files.length > 0:
         { missing } = await verifyGrounding({ files, baseSha, repoRoot })
         if missing.length > 0: exit 6 with friendly message
   │
   ▼
[4] create slice branch  (unchanged)
   │
   ▼
[5] write status.json, spawn claude  (unchanged)
```

### Project structure (additions only)

```
make-my-dreams/
├── lib/
│   └── here-mode/
│       ├── extract-file-refs.js          # NEW — pure
│       └── verify-grounding.js           # NEW — pure (injectable git runner)
├── lib/here-mode.js                       # modified — wires the new precheck
├── test/
│   ├── unit/
│   │   ├── here-mode-extract-file-refs.test.js   # NEW
│   │   └── here-mode-verify-grounding.test.js    # NEW
│   └── integration/
│       └── here-mode-grounding-check.test.js     # NEW — end-to-end with fixture
└── docs/adr/
    └── 013-prompt-grounding-check.md     # NEW
```

---

## 4. Out of scope for v0.2.h

- ❌ LLM / semantic file reference extraction (closed-pattern regex only; semantic v0.5+).
- ❌ Fuzzy / case-insensitive path matching (exact match only).
- ❌ Recursive verification (does X's referenced files also exist).
- ❌ Cross-worktree / cross-slice verification.
- ❌ A registry of "known good" prefixes per project type (Node, Python, etc.) — single closed list in v0.2.h.

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation
1. Read SPEC_V02H.md (this file) — authoritative.
2. Read L-015 in `docs/lessons-learned.md` for full context.
3. Read `lib/here-mode.js` to find the right wiring point (right after clean-tree, before slice-branch creation).
4. Read v0.2.j's `lib/conductor/stall-detector.js` for the "pure function + injected runner" pattern to mirror.

### Key risks
- **Regex false positives**: a dream casually mentioning "docs/SOMETHING.md" might trigger a check on a path the user didn't really intend. Mitigation: log the extracted list at debug level so the user can verify what was checked. The escape hatch covers genuine false positives.
- **Wiring placement**: must be AFTER clean-tree check (cheap, fail-fast) but BEFORE slice-branch creation (no point creating a branch we're about to error out of).
- **L-016 + L-018 interaction**: the composer (v0.2.7) and the context filter (v0.2.l) are upstream of this — they touch the prompt before it reaches the user-facing dream string. v0.2.h's extractFileRefs operates on the USER dream text (what's passed to `mmd --here`), NOT on the composer-augmented final prompt. So no interaction risk.
- **Performance**: `git cat-file -e` per file is one fork per file. For typical dreams (1-3 file refs), <100ms total. If a dream ever references 20+ files, consider batching via `git cat-file --batch-check`.

### Apply L-001..L-018
All standard. Particularly relevant:
- **L-015** is the origin — the rule says "implementation is a slice of its own (~v0.2.h) because it touches here-mode.js core paths and needs careful test coverage to not break existing flows". v0.2.h IS that slice.
- **L-016**: launch with `MMD_TIMEOUT_MS=0` + spec-frozen prompt + incremental commits.
- **L-018**: composer with context will now match this slice's relevant lessons (L-015 has `Applies to: mmd --here` per the migration). Verify in composer.json after launch.

### Constitution module bindings
Active: universal, ai-coding (rule update), commit-git, testing, error-handling (exit code 6), documentation, observability.

---

## 6. Definition of done

v0.2.h is done when:

1. All 5 ACs met.
2. Full test suite passes (current 925 + new tests, expected ~945-965).
3. `mmd --here "implement v9.9.9 per SPEC_V99X.md"` exits 6 with a clear message listing `SPEC_V99X.md` as missing.
4. `MMD_SKIP_GROUNDING=1 mmd --here "..."` bypasses the check with a warning.
5. README + ADR-013 + ai-coding rule update in place.
6. Version bumped to `0.2.11`.
7. Slice merged via `mmd ship` (or manual ff-only).
8. Tag `v0.2.11` created.
9. Tenth reflexive use of `mmd --here`. Composer should match L-015/L-016/L-018 with high confidence.

---

*Spec v0.2.h — generated 2026-05-30 from L-015 (captured 2026-05-18). Tenth reflexive use of mmd --here. After v0.2.h lands, L-015 is closed in code; manual mitigation playbook becomes a backup, not the primary path.*
