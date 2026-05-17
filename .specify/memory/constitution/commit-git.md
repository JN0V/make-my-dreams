# Constitution Module — Commit & Git workflow

> Loaded for: any skill or worker that creates commits, pushes branches, opens PRs, or otherwise touches the git history. The MMD CLI itself loads this. So does auto-dev (every phase ends with commits).

## I. Commit control

- No commit without explicit user approval (this is the human-in-the-loop gate).
- Each commit MUST be atomic and correspond to one identifiable task.
- Conventional Commits format:
  - `feat:` for new features
  - `fix:` for bug fixes
  - `docs:` for documentation
  - `test:` for tests
  - `refactor:` for refactoring
  - `chore:` for tooling, config, generic maintenance

## II. AI attribution (OPTIONAL, honest)

Mentioning AI involvement in commits, PRs or code comments is **permitted and even encouraged** when it adds traceability (e.g. `feat: generate drawing-camera PWA (auto-dev v0.X)`, `refactor: simplify state.js per Christie review`). It is NOT required for every commit. Authors should not contort messages to either hide AI usage (dishonest) or showcase it gratuitously (noise) — focus on clarity of what changed and why.

The previous "FORBIDDEN to mention AI" rule (constitution v1.0) was dropped in v1.1 because it pushed both humans and AI to write misleading commits.

## III. Commit early, commit often, push always (NON-NEGOTIABLE)

Any meaningful chunk of work — even partial, even broken-on-purpose during a red phase — MUST be committed as soon as it constitutes a recoverable unit. Typically: every passing test, every isolated refactor, every successful step of a multi-step task.

**Uncommitted-and-unpushed work does not exist**: a crash, a forced reboot, a worktree cleanup, a misclick in a file manager — and your work is gone.

1. **Commit early**: do not batch a day's worth of changes into a single end-of-day commit. Atomic commits per logical step.
2. **Commit often**: when in doubt, commit. A messy history is fixable; lost work is not.
3. **Push always**: every commit MUST be followed by `git push` to the remote. A commit that only lives in the local `.git/` is one disk failure away from oblivion.
4. **Worktrees and disposable environments are NOT excuses to delay commits** — they make this rule more critical, not less.

This rule applies to humans AND AI agents. An agent that performs 30 minutes of generation without intermediate commits has produced fragile work, regardless of how well it ran.

## IV. Branch-based workflow (NON-NEGOTIABLE)

Every non-trivial change MUST be developed on a dedicated branch, never directly on `main`. Branches are the prerequisite that makes "commit early, push always" safe (you can push 100 WIP commits on a feature branch without polluting `main`'s history) and that enables MMD's worktrees parallelization.

1. **Naming**: `feat/<slug>`, `fix/<slug>`, `slice/<slice-name>`, `docs/<slug>`, `chore/<slug>`.
2. **Created before any code**: `git checkout -b feat/X` is the FIRST step of any work session.
3. **Pushed early with tracking**: `git push -u origin feat/X` IMMEDIATELY after branch creation, even before the first commit.
4. **Merged via PR (team mode) or fast-forward (solo mode)**: `main` only receives reviewed, tested merges.
5. **Deleted after merge**: `git branch -d feat/X && git push origin --delete feat/X`.
6. **Required for every auto-dev run or MMD slice**: a MMD slice runs on its own `slice/<slice-name>` branch. Isolates a possibly-rogue pipeline from `main`, allows trivial rollback.
7. **Exception**: trivial typo fixes or single-file doc tweaks MAY go directly on `main` under the author's documented responsibility.

Applies to humans AND AI agents. An AI that commits directly on `main` for a non-trivial change triggers a red-green failure pass per testing.md principle III.

---

*Version: 1.0.0 (extracted from constitution v1.3) | Loaded by anything that touches git. See bindings.*
