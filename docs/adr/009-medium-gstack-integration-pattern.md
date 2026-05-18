# ADR-009: Medium gStack integration — reusable `lib/skills/<name>/*` pattern + `mmd qa` / `mmd cso` / `mmd document-release` wrappers

Date: 2026-05-18
Status: Accepted

## Context

[L-012](../lessons-learned.md) named MMD's gStack pillar drift: 11+ slices claimed gStack as a foundational dependency while never invoking it. [ADR-007](007-gstack-effective-via-ship-subcommand.md) closed the FIRST gStack-skill invocation by wiring `mmd ship` (v0.2.f) to the gStack `ship` skill via `claude -p` with a forced `PATH=$HOME/.bun/bin:$PATH`. This brought the L-012 INVOKED count from `0` to `1 of 41` gStack skills used in production.

`MAKE_MY_DREAMS.md` §3.1 ("Medium option" from L-012) called for **extending the pattern to 3–4 more gStack skills** so the integration surface becomes a known, repeatable shape rather than a one-off. The remaining work after v0.2.f was:

1. **Refactor** the v0.2.f `lib/ship/*` layout into a reusable `lib/skills/<name>/*` pattern — adding the 5th skill should be a 1-hour exercise, not a 1-week design problem.
2. **Add three new wrappers**: `mmd qa` (test stratification + adversarial pass), `mmd cso` (Bundle A security review), `mmd document-release` (auto-generated release notes from commit range).
3. **Document the choice** so future maintainers know why we wrapped at this layer rather than folding skills inside `auto-dev`.

Three architectural questions had to be answered:

- **Q1.** Why extract a shared `lib/skills/_common/` after only ONE skill (`ship`)? Why not wait for the 2nd or 3rd to surface the duplication "naturally"?
- **Q2.** Should `mmd qa` / `mmd cso` / `mmd document-release` go through the v0.2c Project Onboarder validation gate (`checkGate`) like `mmd --here` does?
- **Q3.** Should these skills be invokable AS PART OF `auto-dev`'s pipeline (the so-called "Heavy" option from L-012), or only as standalone CLI subcommands (Medium)?

## Decision

v0.2.g delivers the Medium option per the L-012 taxonomy: three new subcommands modelled on `mmd ship`, all sharing a single extracted spawn layer.

### Q1 — Extract `lib/skills/_common/invoke-claude.js` BEFORE the duplication arrives

After ADR-007 we had one skill (`ship`) with ~250 lines of spawn logic: PATH-forcing, tee, race-safe log-stream finish (commit `a9d6011`), heartbeat scheduler, ENOENT mapping, AC-2b `assertSkillInstalled`. Adding a second skill (`qa`) by copy-paste would have left us maintaining two near-twins and would have made the v0.2.f race-fix two-things-to-update. Constitution `universal.md §III` says "extract common code only when duplication is proven (not preemptively)" — but the duplication WAS proven the moment we knew the v0.2.g spec called for three new skills with identical spawn shape.

So we extracted the shared layer in AC-1 (one atomic refactor commit) BEFORE adding the three new skills. The pre-AC-1 contract was:
- `mmd ship --help` is byte-identical pre/post (snapshot test guards it).
- All v0.2.f ship tests still pass.

Both held. The result: `bin/skills/<name>.js` is now a thin 200-line coordinator per skill; the 250-line spawn layer is shared. Adding a 5th skill (e.g. `mmd context-save`) is now genuinely a 1-hour exercise: create 4 small files in `lib/skills/<name>/`, 1 file in `bin/skills/`, wire 1 dispatch in `bin/mmd.js`, and write the test pair.

**Alternative considered**: keep `lib/ship/*` unchanged and copy-paste for `lib/qa/*`, etc. Rejected because (a) the race-fix would become 4 places to maintain, (b) the spec EXPLICITLY asked for the extraction, (c) the refactor is small enough to fit in one reviewable commit.

**Cost paid**: One extra commit ordering rule — the refactor MUST land before the new subcommands so a regression in the shared layer doesn't co-mingle with the new-skill diff. The v0.2.g slice respects this: commits land as AC-1 (refactor) → AC-2 (qa) → AC-3 (cso) → AC-4 (document-release) → tests → docs.

### Q2 — qa / cso / document-release BYPASS the discovery gate (read-only / advisory)

The v0.2c Project Onboarder validation gate (`checkGate`) is designed to block **commands that MODIFY code** when the target dir is a brownfield without a VALIDATED discovery report. The rationale (per ADR-008) is to force the user to acknowledge that an unfamiliar codebase is involved before unleashing auto-dev on it.

`mmd qa`, `mmd cso`, `mmd document-release` are NOT modifying commands. They:

- `qa` — runs tests + classifies failures. Reads source; never writes.
- `cso` — scans for secrets / deps / lethal trifecta. Reads source + dependencies; never writes.
- `document-release` — reads `git log` + ADRs + lessons-learned; writes a single markdown DRAFT to `.mmd/local/document-release-runs/` (a gitignored local working dir). Never touches the working tree or committed files.

Forcing a discovery-report gate on these would be UX-hostile: a user with a fresh brownfield wants to RUN `mmd cso` precisely to learn what's there, not to be told "first do a discovery report" — because `mmd cso` IS itself a form of discovery (security-focused).

**Implementation**: the bypass is purely STRUCTURAL — `bin/mmd.js` dispatches `qa` / `cso` / `document-release` BEFORE the `--here`-path `checkGate` call (lines around `bin/mmd.js:390-412`), so the gate cannot fire for these subcommands. There is no separate config flag or marker constant: the dispatch ordering IS the contract.

> v0.2.g initially shipped a vestigial `skipDiscoveryGate: true` export from each `validate-input.js` as a "forward-compat marker for a future gate-aware dispatcher". F5 in the Phase-4 adversarial review identified those exports as dead code (never consulted by any caller) and they were removed (KISS / YAGNI per `universal.md §II`). If a future gate-aware dispatcher needs to consult per-subcommand intent, it should re-introduce a typed metadata object — not a single boolean — at that point.

**Alternative considered**: route through `checkGate` and let it return ok-when-skill-is-advisory. Rejected because (a) it inverts the responsibility (the gate should not know about every subcommand's read/write semantics), (b) the dispatch-ordering approach is already in place from v0.2.f's `mmd ship` (also bypassing the gate, since shipping a slice is also non-modifying of the BRANCH it ships, even though it pushes).

### Q3 — Skills are STANDALONE CLI subcommands, NOT folded inside `auto-dev` (Heavy deferred to v0.5+)

The L-012 closure taxonomy had three options:

- **Light** (v0.2.f, ADR-007): one wrapper, one skill — proves the integration mechanism.
- **Medium** (this ADR, v0.2.g): four wrappers, four skills — proves the PATTERN is reusable.
- **Heavy** (v0.5+): skills folded inside `auto-dev`'s pipeline so the Conductor orchestrates `auto-dev → /qa → /cso → /ship` as one measured sequence.

We deliberately chose Medium and NOT Heavy for v0.2.g because:

1. **Each user-facing subcommand teaches the user where the skill lives**. `mmd qa --help` mentions `~/.claude/skills/gstack/qa/SKILL.md` explicitly. A user who runs `mmd qa` once knows they could also invoke that skill directly from `claude` if needed. Folding inside `auto-dev` would make the skills invisible to users.

2. **Composition by shell `&&` is fine for v0.2.g**. The user can run `mmd qa && mmd cso && mmd ship` if they want a chain; orchestrated composition (with shared state, intermediate analysis, conditional skipping) is a Conductor concern that needs its own spec (deferred to v0.5+).

3. **The Heavy option has unresolved questions**: Should `auto-dev` BLOCK on `/qa` failures? Should `/cso` findings be advisory-only or auto-trigger a remediation cycle? Should the Conductor run skills in parallel where independent? None of these are answered by v0.2.g's spec, and answering them in code now would lock in choices we'd regret. Defer until the Conductor design is mature.

4. **Standalone subcommands are independently auditable**. `audit-pillars.sh` counts skill invocations per slice. With Heavy, the count would always be the same (every slice that runs auto-dev would show all skills "invoked"), so the audit loses its early-warning value. With Medium, a user's choice to invoke (or skip) `mmd cso` shows up in the slice's pillar table and the cumulative gStack/L-012 picture stays honest.

**Alternative considered**: deliver Heavy directly (skip Medium). Rejected because Heavy requires a Conductor that doesn't exist yet, and L-012 closure does NOT require Heavy — only that the gStack drift gap shrinks meaningfully. Medium takes that gap from `1 of 41` to `4 of 41` (10%) which is a defensible-by-itself improvement.

## Consequences

### Positive

- **L-012 gap shrinks 4×**: `audit-pillars.sh` now reports gStack invocations across 4 distinct skill names (ship + qa + cso + document-release), proving the pillar is no longer documentation-only.
- **5th skill is a 1-hour exercise**: the `lib/skills/<name>/*` pattern + `_common/invoke-claude.js` make adding `/context-save`, `/freeze`, `/qa-only`, etc. a templated change rather than a design exercise.
- **L-013 race-fix preserved through refactor**: `_common/invoke-claude.js` keeps the v0.2.f `logStream.once('finish')` wait. A new `@unit` test (`skills-common-invoke-claude.test.js`) explicitly covers the race by spawning a fake-claude that emits a FINAL marker before exit and asserting the marker is in the log when the promise resolves.
- **Per-skill PATH forcing is one line of code**: `buildSkillEnv(skillName, parentEnv)` prepends `$HOME/.bun/bin` idempotently. Every wrapper inherits the gStack-PATH guarantee without duplicating the logic.
- **MMD_GSTACK_SKILLS_DIR override works for all skills**: tests can point at fake-skills directories; production users keep the canonical `~/.claude/skills/gstack/<name>/SKILL.md` resolution.

### Negative

- **More surface area, more places skills can go wrong**: each new skill is a new exit-code contract, a new help text to keep in sync, a new prompt file to audit. Mitigated by the test stratification (every wrapper has @unit + @integration coverage that runs in <1s each).
- **Help-output drift risk**: `mmd ship --help`, `mmd qa --help`, `mmd cso --help`, `mmd document-release --help` are now four near-identical templates. Future skills will tempt copy-paste. Mitigated by the @integration tests that pin each help output's anchors (slug, env vars, gStack path).
- **`validate-input.js` is duplicated across qa / cso**: both are git-probe-only validators. We deliberately kept them as twins (DRY says "extract when duplication is proven" — three copies is still below threshold). Refactor candidate for v0.3 if a 5th git-probe-only skill arrives.

### Follow-up work

- **v0.5+ Conductor (Heavy)**: orchestrate `auto-dev → /qa → /cso → /ship` as a measured sequence. Will likely fold these CLI subcommands INTO the pipeline rather than replace them.
- **CI integration**: wire `audit-pillars.sh --ci` into GitHub Actions so any PR that adds a pillar claim without invoking it fails. v0.2.g's per-skill `gStack.skills[]` metadata in `patterns.json v2` is the foundation for this.
- **`mmd qa && mmd cso` shell composition** is documented in the README but never tested end-to-end. Worth a smoke test in v0.3.

## Related

- L-012 — the gStack drift failure that motivated this slice.
- L-013 — the wrapper-modifying slice meta-rule + race-fix that v0.2.g must preserve.
- L-016 — spec-polishing trap: v0.2.g auto-dev went direct-to-implementation instead of re-iterating SPEC_V02G.md.
- ADR-001 — adopt gStack as backbone (the original commitment that this ADR continues to operationalize).
- ADR-007 — `mmd ship` wrapper + functional install + pillar audit (the precursor that this ADR extends).
- ADR-008 — Project Onboarder walking skeleton (defines the discovery gate that this ADR's AC-5 deliberately bypasses for read-only skills).
- SPEC_V02G.md — the frozen spec implemented by this ADR.
