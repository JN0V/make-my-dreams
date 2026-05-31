# ADR-018: WIP-uncommitted stall signal (`wip-uncommitted-since-N-min`)

Date: 2026-05-31
Status: Accepted

## Context

L-019 was surfaced when a v0.2.k auto-dev run was killed mid-flight, leaving a
large uncommitted working tree. The rescue was a manual `git stash push`. The
prevention rule — "commit incrementally per AC" (commit-git.md §III) — lived
only in launch prompts, so its *failure* was invisible: if auto-dev stopped
committing yet the tree kept changing, nothing observed it and the work was one
worktree-cleanup away from oblivion.

The conductor already runs a deterministic stall detector
(`lib/conductor/stall-detector.js`, ADR-011 / SPEC_V02J) over a closed signal
enum. It had a `no-commit-since-N-min` signal, but that signal fires for a
*clean* stale branch too (a legitimately paused slice with nothing at risk). It
could not distinguish "paused, nothing to lose" from "dirty, work at risk".

A second, independent item rode along: a forensic re-check of the v0.2.h L-015
"composer miss" (candidate a). See ADR-012 and the L-019 lesson entry — the
conclusion was that it is *already-resolved* (the context filter + `Applies to`
shipped in v0.2.l), so it reduces to a regression-lock test, not a code change.

## Decision

Add a new closed-enum stall signal `wip-uncommitted-since-N-min`. The detector
emits it when **both** hold:

1. The slice worktree is dirty (`git status --porcelain` non-empty), via a new
   injectable `gitWorktreeDirtyFn(repoRoot, sliceBranch)` accessor that defaults
   to a `git status --porcelain` spawn returning a boolean and **never throws**
   (failure → `worktreeDirty: null` + an `evidence.errors[]` entry, mirroring
   the existing `gitLastCommitEpochFn` contract).
2. The last commit on the slice branch is older than `wipUncommittedMin`
   (default 15 min, env `MMD_STALL_WIP_UNCOMMITTED_MIN`).

Evidence gains `worktreeDirty` (boolean|null) and `wipUncommittedMin` (the
derived WIP age). The signal flows automatically through `mmd unblock` into the
5-Whys session; when present, the session prompt gains an additive hint
recommending `escalate-to-user` with the salvage step
`git stash push -u -m "wip-salvage <slice>"`.

### Why derive WIP age from `lastCommitAge` + dirty-tree, not a precise "dirty-since" timestamp

Git records no timestamp for *when* a working tree became dirty. A precise
tracker would need conductor-side bookkeeping in `status.json` (write a
`dirty_since` field on every poll). That is real state, real I/O, and a new
failure surface — unjustified for v0.2.n (KISS, universal.md §II). The
derivation "dirty tree + last commit N min ago ⇒ WIP has been uncommitted ≥ N
min" is a sound lower bound: if you committed N min ago and the tree is dirty
now, the uncommitted delta is at most N min old, and in the kill-mid-run case it
is exactly the gap since the last atomic commit. Precise tracking is deferred
(SPEC_V02N §4, non-feature).

### Why detect-and-recommend, not auto-stash

The signal only *detects + recommends*. The actual `git stash push` stays a
human (or 5-Whys-recommended) action. Auto-mutating a user's worktree on a
heuristic is exactly the kind of surprising, hard-to-reverse action MMD avoids —
a false positive that auto-stashes mid-edit would itself cause the data loss it
was meant to prevent. Detect, surface, route to a human.

### Why `escalate-to-user` is the recommended action

A dirty stale tree is ambiguous by construction: the detector cannot know
whether the uncommitted delta is precious half-finished work or disposable
scratch. That ambiguity is the textbook `escalate-to-user` case (ADR-011). The
hint is **additive prompt text only** — it does NOT add a new closed action and
does NOT hardcode the verdict. The action is still produced by the 5-Whys
parser, and the sacred unparseable-output fallback to `escalate-to-user`
(L-016) is untouched.

### Negative + boundary cases (locked by tests)

- **Clean tree** (`worktreeDirty === false`) → no signal, `wipUncommittedMin:
  null`, even when the last commit is stale (that is the legitimate
  `no-commit-since-N-min` case, not a WIP-loss risk).
- **Fresh branch** (no commits, `lastCommitAgeMin === null`) → no signal,
  `wipUncommittedMin: null` (a never-committed slice is a different state).
- **Recent dirty work** (last commit younger than the threshold) → no signal
  (work in progress is healthy, not stalled).
- A dirty stale branch raises BOTH `no-commit-since-N-min` and
  `wip-uncommitted-since-N-min` (different remedies), each emitted once in
  canonical enum order.

## Consequences

- The L-019 prevention rule ("commit incrementally per AC") is now
  **code-detectable**: when auto-dev stops committing while the tree keeps
  changing, `mmd unblock` flags it and routes it to a human before work is lost.
  This slice fittingly builds the detector for the very failure of its own
  governing rule.
- One extra `git status --porcelain` runs per `unblock` invocation. Fine at
  MMD's one-slice-at-a-time scale; parallel multi-slice scanning would need
  batching (SPEC_V02N §4, explicit scale assumption — pre-empting the L-018 /
  L-009 "unstated scale assumption" echo).
- The composer's L-015 `mmd --here` match is regression-locked
  (`test/integration/composer-l015-regression.test.js`) so the v0.2.l fix
  cannot silently regress.

See [ADR-011](./011-five-whys-escalation.md) for the 5-Whys escalation design
and [SPEC_V02N.md](../../SPEC_V02N.md) for the acceptance criteria.
