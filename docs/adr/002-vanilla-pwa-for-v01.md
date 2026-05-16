# ADR-002: Vanilla HTML/CSS/JS for generated PWAs (v0.1 only)

**Date**: 2026-05-16
**Status**: Accepted (scope-limited to v0.1)
**Authors**: Sébastien

## Context

v0.1 is a walking skeleton. We need the simplest possible PWA stack so that:
- `auto-dev` can generate it reliably in a single round
- No bundler/transpilation step blocks the build
- The output is a flat folder that opens in any modern browser via `file://`
- Reality Check can probe it cheaply (no dev server)

## Decision

The v0.1 PWA stack is **vanilla HTML5 + CSS + ES2022 JS + Canvas API + getUserMedia + Web App Manifest**.

- No framework (React, Vue, Svelte, …)
- No bundler (Vite, Webpack, …)
- No transpiler (Babel, TypeScript, …)
- No package manager for generated PWAs (the PWAs have no `package.json`)
- Native browser APIs only

## Consequences

**Pros**:
- Zero install time
- Instant Reality Check
- No dependency-vuln surface (constitution §V.A06)
- Trivially auditable

**Cons**:
- Verbose drawing code
- No component model
- Manual DOM updates

**Mitigations**:
- v0.2d **Tech Architect** will revisit this decision per-dream — some dreams (a Subway-Surfers-style game) will demand a richer stack
- The vanilla constraint is a v0.1-only simplification

## References

- [SPEC_V01.md §5 Implementation hints](../../SPEC_V01.md)
- [MAKE_MY_DREAMS.md §3.1 Three engines (Standard engine default)](../../MAKE_MY_DREAMS.md)
- [ADR-001 Adopt gStack as runtime backbone](./001-adopt-gstack-as-backbone.md)
- [Tech-spec v0.1 §4.7 Vanilla PWA](../../_bmad-output/implementation-artifacts/v01-techspec.md)
