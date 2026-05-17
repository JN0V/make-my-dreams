# Constitution Module — Brownfield (Layer E)

> Loaded ONLY when MMD detects an existing codebase (cf scoping §6.7 Project Onboarder). Additive on top of whatever profile is active.

## I. Respect existing patterns

When modifying existing code, MATCH the surrounding style: naming, indentation, error handling, test structure, file organization. A consistent codebase beats an opinionated-but-mixed one.

## II. No dependency added without justification

A new dependency on a brownfield project:
- Requires an ADR.
- Must verify license compatibility.
- Must justify why no existing dependency or stdlib suffices.

(Greenfield projects have more latitude — they're still defining their stack.)

## III. Regression tests mandatory

Before changing any existing function, a regression test capturing the current behavior MUST exist (write it first if absent). This catches "orthogonal damage" (P-05) where an AI fixes X and breaks Y.

## IV. Migration plan documented

Any breaking change (renamed function, changed signature, removed feature) requires:
- ADR explaining the change.
- Migration steps for existing callers.
- Deprecation period (if the project has external consumers).

## V. Phase 0 discovery before any code

The Project Onboarder (`mmd discover`) MUST run before the first slice on a brownfield project. Its `mmd-discovery-report.md` MUST be validated by the user before any code modification.

This is the brownfield-specific application of the general "specs before code" principle.

---

*Version: 1.0.0 | Loaded ONLY when brownfield detected. See bindings.*
