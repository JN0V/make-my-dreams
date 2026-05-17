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

---

*Version: 1.0.0 | Always loaded by every binding. See bindings table at `.specify/memory/constitution-bindings.yaml`.*
