# ADR-011: Five Whys Escalation — the stuck-recovery primitive

**Date**: 2026-05-18
**Status**: Accepted
**Authors**: Sébastien (project owner), auto-dev (Standard engine, v0.2.j slice)

## Context

The recurring failure mode of nested agentic systems is **silent stuck-and-burn**: a sub-agent hits a wall, retries blindly, or pivots into over-engineering, while the outer orchestrator has nothing better than "retry" or "kill". Every one of L-004 (auto-dev stops at ~80%), L-006 (`claude -p` sleeps forever), and L-016 (timeout + spec-polish trap) is a flavor of this. Each cost 30+ minutes of wasted wall-clock and required manual root-cause analysis.

v0.2.j transposes the **5 Whys** technique from crisis post-mortems into the Conductor's stuck-recovery toolkit. When a slice looks stalled, the user runs `mmd unblock <slice>`. A deterministic detector confirms the stall and gathers evidence; a structured BMAD Party Mode 5-Whys session diagnoses the root cause; the session emits one of five recommended actions. v0.2.j ships the walking skeleton — detector + session runner + manual `mmd unblock` subcommand. The auto-trigger from a running Worker and the auto-execution of the recommended action are deferred to the v0.5+ Conductor.

Several design choices had to be settled.

## Decision

### Why 5 Whys specifically (vs other root-cause methods)?

5 Whys is cheap, well-validated, and naturally produces a *chain* of reasoning rather than a single verdict — which is exactly what a human reviewer needs to trust (or override) the recommendation. Fishbone/Ishikawa diagrams and fault-tree analysis are heavier and assume a known taxonomy of causes; a stalled agentic run rarely fits a fixed taxonomy. 5 Whys is open-ended, fits a single LLM session, and the visible why-chain doubles as the audit trail (it is written verbatim into `.mmd/shared/5-whys/<ts>.md`).

### Why BMAD Party Mode (multi-persona) rather than a single analyst?

A single persona tends to anchor on the first plausible cause. Mary (analyst) leads the why-chain, but at each "why" Winston (architect), Quinn (QA), Amelia (PO), and Christie (CSO) add their lens — system design, verification, scope, and security/risk respectively. This orthogonal coverage surfaces causes a single analyst would miss (e.g. "the approach is sound but the *acceptance criteria* were misread" is a PO catch, not an analyst catch). It also exercises the gStack/BMAD pillar on a real workflow (cf L-012 — pillars must be invoked, not merely claimed).

### Why composer integration (auto-inject lessons into the session)?

The composer (v0.2e, ADR-010) already injects matched lessons into auto-dev/ship/qa prompts. Wiring it into the 5-Whys runner closes a new loop: the system **uses its own captured lessons when diagnosing new stalls**. A timeout-themed stall context auto-matches L-016 ("MMD_TIMEOUT_MS", "timeout", "30 min") and the session receives L-016's rule before it even starts reasoning — so each session is smarter than the last. This is verified by `test/integration/unblock-composer-injection.test.js`.

### Why NO auto-execution in v0.2.j?

Executing the recommended action (relaunch with a hint, abandon, escalate) is a *Conductor* concern — it requires lifecycle management, single-active-run enforcement (L-006), and safe worktree handling (L-003) that the Conductor will own in v0.5+. Shipping auto-execution now would couple the diagnostic primitive to an orchestration layer that does not yet exist, violating KISS/YAGNI (universal.md §II). v0.2.j keeps the human in the loop: `mmd unblock` diagnoses and recommends; the user reads `.mmd/shared/5-whys/<ts>.md` and acts. The exit code encodes the recommendation so a future Conductor can branch on it without re-parsing.

### The closed `recommended_action` enum + rationale

| action | exit | meaning |
| --- | --- | --- |
| `continue-with-hint` | 8 | approach is sound; a concrete hint unblocks it |
| `abandon-approach` | 7 | dead end; pivot to a different approach |
| `escalate-to-user` | 6 | ambiguous / needs a human decision (also the **sacred fallback**) |
| `task-actually-complete` | 8 | the work is in fact done; the stall is illusory |
| `false-positive-stall` | 8 | the detector misfired; no real stall |

The enum is closed so a downstream consumer (today the exit-code map; tomorrow the Conductor) can switch exhaustively. **`escalate-to-user` is the sacred fallback** (L-016): if `claude` emits malformed/prose-only output, or the spawn fails, the parser NEVER throws — it returns `escalate-to-user` with the parse error captured in `evidence[]`. A human always gets a safe, actionable result.

### Detector design

The detector (`lib/conductor/stall-detector.js`) is a pure function: clock injected (no ambient `Date.now()`), fs/git reads injectable, deterministic, sub-100ms. It reads `.mmd/shared/status.json`, the slice branch's last-commit epoch (`git log <branch> --format=%at -1`), and the head+tail of recent run logs, emitting signals from a closed enum (`lib/conductor/stall-signals.js`): `no-commit-since-N-min`, `retry-count-exceeded`, `error-pattern-matched`, `duration-exceeded-budget`, `state-failed-explicit`, `heartbeat-stale`. Thresholds default from env (`MMD_STALL_MIN_NOCOMMIT=10`, `MMD_STALL_MAX_RETRIES=3`, `MMD_STALL_DURATION_BUDGET_FACTOR=2.0`, `MMD_STALL_ERROR_PATTERN_REGEX`) and are overridable per call.

## Consequences

- The next time a slice stalls (and there will be a next time), `mmd unblock` gives a structured root-cause + action in ~2 min instead of 30 min of head-scratching.
- The 5-Whys session log is an append-only audit trail under `.mmd/shared/5-whys/` — no DB, no history command (deliberately out of scope, §4).
- The exit-code contract (6/7/8) is forward-compatible with the v0.5+ Conductor auto-execution layer.
- The composer now has a third consumer (auto-dev → skills → 5-Whys), strengthening the autolearning loop.
