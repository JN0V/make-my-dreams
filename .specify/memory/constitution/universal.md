# Constitution Module — Universal (always loaded)

> Core principles that ALWAYS apply, regardless of the skill, profile, context or engine. This is the smallest module — keep it small. Specific concerns go in dedicated modules (testing.md, security.md, commit-git.md, etc.).

## I. SOLID Principles (NON-NEGOTIABLE)

Code MUST follow SOLID principles:
- **S**ingle Responsibility Principle: each class/module has only one reason to change.
- **O**pen/Closed: open for extension, closed for modification.
- **L**iskov Substitution: subtypes must be substitutable for their base types.
- **I**nterface Segregation: prefer multiple specific interfaces over one general-purpose interface.
- **D**ependency Inversion: depend on abstractions, not implementations.

## II. KISS — Keep It Simple, Stupid (NON-NEGOTIABLE)

- Code MUST favor simplicity over cleverness.
- All complexity MUST be justified by a concrete business need.
- Premature abstractions are FORBIDDEN.
- YAGNI: do not implement what is not explicitly required.

## III. DRY — Don't Repeat Yourself

- Avoid duplicating business logic.
- Extract common code only when duplication is proven (not preemptively).
- Prefer duplication over a bad abstraction.

## IV. Separation of Concerns

- Strict separation between business logic, presentation, and infrastructure.
- Layers communicate through clean interfaces.
- No business logic in controllers/handlers.
- No direct database access from the presentation layer.

## V. Language conventions

- Code, variable names, technical comments: **English**.
- Commit messages: **English**.
- User-facing strings: language depends on profile (see profile-specific modules).

## VI. Failure honesty

Anyone (human or AI) who hits a wall reports it clearly rather than working around silently. "I tried X and it didn't work because Y" beats producing broken output that pretends to work. This rule applies to all skills, all engines, all sub-agents.

## VII. Human-readable first (NON-NEGOTIABLE)

Every artifact a human may read — names, phase/step labels, branch names, commit messages, identifiers, technical explanations, specs and docs — MUST be comprehensible to a human FIRST and machine-/AI-friendly second. Being parseable by an AI is welcome but never sufficient. Optimize for the tired human reading the git log at 2 a.m., not for the parser.

- **Coded identifiers are supplements, never the whole meaning.** Short codes (`L-019`, `AC-3`, `v0.2.n`, `P-01`, phase numbers) are fine as stable shorthand ONLY when each is paired — at the point of use, or one obvious lookup away — with a plain-language label (e.g. `L-019 — auto-dev killed mid-run leaves uncommitted WIP at risk`). A code that expands to nothing human-readable anywhere is FORBIDDEN.
- **Names state intention in plain words.** Phases, steps, branches, files and variables say what the thing IS: `slice/wip-salvage-stall-signal`, not `slice/here-implement-…-1780216461`; "Phase 3 — implement the WIP detector", not a bare "Phase 3". Opaque suffixes (timestamps, hashes) MAY be appended for uniqueness but MUST NOT replace the human-readable stem.
- **Commits explain the change to a person.** A reader who does not know the project's internal shorthand must understand WHAT changed and WHY from the message alone. Cite codes for traceability, but never let `fix: AC-3` stand without a plain-language summary.
- **Specs and docs lead with prose a newcomer understands**, then add the codes/tables. If a sentence only parses for someone who already memorized the project's jargon, rewrite it so it doesn't.

This rule binds humans AND AI agents, across every skill, engine and sub-agent. It is the readability counterpart to §VI's honesty: output that is technically correct but humanly opaque has not met the bar.

## VIII. Technology-agnostic analysis (NON-NEGOTIABLE)

MMD's mission is to work on **any** project, in **any** technology — Rust, C, Python, Go, React, a Java back-end, anything. Therefore **any MMD capability that ANALYZES a target project** — its tests, coverage, code structure, imports, dependency graph, test corpus, lint, etc. — MUST be **technology-agnostic by design**, never hard-wired to one language or framework.

- **Adapter-based, orchestrate native tools.** Per MMD's "stand on top of, don't reimplement" philosophy: a generic core + per-technology **adapters** that drive the ecosystem's *native* tooling (pytest + coverage.py, `cargo test` + llvm-cov, `go test -cover`, jest / `node --test`, gcov, …) and parse standard formats (lcov, cobertura) where they exist. Do NOT hand-parse one language's syntax as if it were universal.
- **Detect-and-refuse, never fake it (extends §VI).** When a target's stack has no adapter, the tool MUST detect that and **say so honestly** ("no adapter for <stack> yet — analysis unavailable"). Emitting results from a stack-mismatched analyzer — e.g. running a JavaScript `test()`/`@tag`/`import` scanner over a Rust or Python repo and reporting numbers — is a §VI honesty violation: it fabricates a measurement that doesn't apply.
- **No language assumptions leak into the core.** The MMD-specific `@smoke/@unit/...` tag convention, `import`/`require` module syntax, brace-matched bodies, `node --test` coverage — these belong in the **JS adapter**, never in the shared core. A capability built against only the dogfood repo's stack (MMD is JS) is the L-009/L-018 anti-pattern: design scope leaking into an implementation that's only true for the current case.

This binds every analysis tool MMD builds — Test Curator, coverage, blast-radius / coherence graph, doc→code refs, discover. Building a single-language analyzer when the mission is polyglot is a correctness failure, not a detail.

---

*Version: 1.2.0 (v1.2 adds §VIII technology-agnostic analysis — closes the gap that let a JS-only Test Curator ship) | Always loaded by every binding. See bindings table at `.specify/memory/constitution-bindings.yaml`.*
