# ADR-017: Three-pillars install hardening (Spec Kit + OpenSpec + Ralph Loop)

Date: 2026-05-30
Status: Accepted

## Context

The README claims MMD "stands on the shoulders of" five pillars: Spec Kit,
OpenSpec, BMAD, gStack, and Ralph Loop. As of v0.2.f the installer
(`install-mmd.sh`) only *functionally* provisioned two of them — `bun` (Phase 0)
and gStack (Phase 4) — plus BMAD (Phase 1). The remaining three were cited in
the README but never installed or verified by the installer. `audit-pillars.sh`
reports each as INVOKED ≥1 only because their patterns appear in MMD's own
source; on a fresh machine, three of the five pillars were simply absent.

This is exactly the L-012 / L-009 failure mode: a documentation claim ("we stand
on these five") that the implementation does not back up. L-012's lite closure
(v0.2.6 `mmd ship`) proved MMD *can* invoke a pillar; its full closure requires
every claimed pillar to be installable + verifiable. v0.2.m closes the install
side. (Runtime invocation of Spec Kit / OpenSpec / Ralph Loop from MMD remains a
future Heavy-integration slice.)

## Decision

Add three new installer phases, each modeled exactly on the existing bun
(Phase 0) and gStack (Phase 4) detect→offer→verify pattern:

- **Phase 5 — Spec Kit**: detect `command -v specify`; install via
  `uv tool install specify-cli` (pip fallback); verify `specify --version`.
- **Phase 6 — OpenSpec**: detect `command -v openspec`; install via
  `npm install -g openspec`; verify `openspec --version` (`openspec help`
  fallback for older builds).
- **Phase 7 — Ralph Loop**: detect via `claude plugin list | grep -q
  ralph-loop`; install via `claude plugin install ralph-loop`; verify by
  re-running the detection. A pre-check skips the phase cleanly (no error) when
  `claude plugin list` itself errors (Claude Code too old for plugins) or
  `claude` is absent.

gStack moved from Phase 6 to Phase 4 so all five pillar detections sit
contiguously; the housekeeping phases (skill manifest, cleanup, validation)
renumbered to 8/9/10. The run ends with a single `═══ Install summary ═══`
banner listing every pillar with a ✓ / ⚠ / ✗ marker and a one-line reason.

### Why each pillar uses its *native* install method (not a custom installer)

Each upstream project documents and maintains exactly one blessed install path
(`uv tool install`, `npm install -g`, `claude plugin install`). Re-implementing
those as a custom MMD installer would duplicate logic we don't own, drift the
moment upstream changes its packaging, and break the trust model (users audit
the *documented* command, not an MMD reinvention). MMD's job is to *orchestrate*
the documented path and verify the result — not to repackage someone else's
tool. This mirrors the bun/gStack `curl | bash` decision in v0.2.f.

### Why functional verify over file-presence

Consistent with v0.2.f (and the L-012 root cause: a binary present on disk but
not callable). "Is the file there?" answers the wrong question; "does the tool
respond?" answers the one that matters. Every phase runs the tool's own
`--version`/list command and reports PRESENT_FUNCTIONAL vs PRESENT_BROKEN vs
NOT_INSTALLED accordingly.

### Why per-pillar env vars, not a single `MMD_AUTO_INSTALL_ALL`

A single blanket toggle is a footgun: it auto-accepts `curl | bash` and global
package installs the operator may not want, all at once, with no granularity.
Per-pillar `MMD_AUTO_INSTALL_<PILLAR>` / `MMD_REQUIRE_<PILLAR>` vars let an
operator (or CI matrix) opt each pillar in or out independently — e.g. require
Spec Kit but skip the Ralph Loop plugin on a headless box with old Claude Code.
It also keeps the consent surface explicit and per-source, matching the
BOOTSTRAP "Trust assumptions" model. A convenience `*_ALL` could be layered on
later without removing the granular vars; the reverse is not true.

### Why the final summary banner

After up to eight phases of interleaved prompts and probes, an operator needs a
single place to read "what do I actually have now?". The banner renders the same
data regardless of which phases installed, skipped, or failed — a mix of
present/absent is the normal case, not an error. It is the human-readable
precursor to a future programmatic `mmd doctor` subcommand (deliberately out of
scope here).

## Consequences

- A fresh `bash install-mmd.sh .` can bring all five pillars to
  present-and-responsive, with explicit messages about what is installed vs
  skipped vs broken.
- Re-running the installer is idempotent: each phase's detection finds the
  pillar present and skips the install step.
- L-012 is closed on the install axis. Runtime invocation of the three new
  pillars from MMD subcommands remains future work (Heavy integration, v0.2.n+).
- Pinning SHA-256 / version digests of the install sources stays out of scope
  (the cso LOW-2 follow-up), as does detecting alternative install methods
  (brew, asdf, manual) per pillar.
- Rollback is a single revert of the v0.2.m slice; the installer's earlier
  phases are unchanged in behavior (only renumbered).
