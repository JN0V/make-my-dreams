# Constitution Module — Pro profile (Layer D)

> Loaded ONLY when the active profile is Pro. Additive on top of `universal.md`. Does NOT load `safe-by-default.md` by default; if Pro wants safe-by-default rules anyway, the binding can list both.

## I. Stack richness allowed

- Frameworks, bundlers, transpilers, microservices, Docker — all allowed when justified.
- TypeScript preferred over plain JS for non-trivial projects.
- Linters + formatters configured by default (ESLint, Prettier, Ruff, etc.).

## II. CI/CD expected

- A `.github/workflows/` (or equivalent) MUST exist for any project beyond v0.1.
- Test stratification (testing.md §V) wired in: `pull_request` runs smoke+unit+integration, `nightly` runs full + e2e.
- Pre-commit hooks installed.

## III. Documentation depth

- README plus a `docs/` tree with Diataxis quadrants (see documentation.md).
- ADRs for structural decisions, no exception.
- API documentation auto-generated from code annotations where possible.

## IV. Internationalization

- i18n library wired from day 1 (no hardcoded user-facing strings).
- Even if only one language is shipped, the infrastructure is in place.

## V. Observability wired

- Structured logging (observability.md §I) configured.
- Audit logging on every business action.
- Metrics endpoint or telemetry stream defined (even if no dashboard yet).

## VI. Override of safe-by-default

A Pro project MAY include analytics, signup, paid features — but each requires an ADR with rationale, plus user-facing transparency (a privacy policy, a clear consent flow).

---

*Version: 1.0.0 | Loaded ONLY for profile=Pro. See bindings.*
