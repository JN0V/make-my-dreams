# Constitution Module — Architecture

> Loaded for: Tech Architect, Plan-Review (Eng mode), Security Worker, anything that decides structural shape of code.

## I. Architectural decisions live in ADRs

Any non-trivial structural decision MUST land in an ADR (see `documentation.md` §II). Examples requiring an ADR:

- Choosing a framework (React vs Vue, Express vs Fastify).
- Choosing a data store (Postgres vs SQLite vs file-based).
- Choosing a runtime (Node vs Bun vs Deno).
- Adding or removing a Worker / engine / skill.
- Changing the constitution's structure.

Examples NOT requiring an ADR:

- Picking between two equally-good naming conventions.
- Choosing where in an existing module to put a new function.
- Bumping a dependency patch version.

## II. Separation of concerns

(See also `universal.md` §IV)

- Domain logic separate from infrastructure (DB, HTTP, FS).
- Side effects pushed to the edges.
- Pure functions in the middle.
- Tests at every boundary.

## III. Avoid premature distributed-system thinking

- Single-process until proven insufficient.
- Local file persistence until proven insufficient.
- Synchronous until proven insufficient.
- Each "promotion" (single → multi-process, file → DB, sync → async) requires an ADR with concrete pain point evidence.

## IV. Stateless preferred

When a component CAN be stateless (no in-memory state surviving across requests/calls), it SHOULD be. State lives in identified persistence layers (files, DB, externalized cache). This makes the system resumable, debuggable, scalable, and aligned with MMD's Conductor/Orchestrator/Worker pattern (scoping §4.2).

## V. Contract-first for cross-component APIs

Before two components talk to each other, define their contract explicitly:

- Function signatures with types (TypeScript, JSDoc, or equivalent).
- HTTP APIs: OpenAPI spec.
- File formats: JSON Schema.
- Worker outputs: documented shape (e.g. `{result, confidence, alternatives}`).

A contract change is a breaking change → bumps minor or major version.

---

*Version: 1.0.0 | Loaded by architecture-deciding skills. See bindings.*
