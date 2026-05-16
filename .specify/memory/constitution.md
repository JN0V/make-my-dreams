# Project Constitution

## Core Principles

### I. SOLID Principles (NON-NEGOTIABLE)

Code MUST follow SOLID principles:

- **S - Single Responsibility Principle (SRP)**: Each class/module has only one reason to change
- **O - Open/Closed Principle**: Open for extension, closed for modification
- **L - Liskov Substitution Principle**: Subtypes must be substitutable for their base types
- **I - Interface Segregation Principle**: Prefer multiple specific interfaces over one general-purpose interface
- **D - Dependency Inversion Principle**: Depend on abstractions, not implementations

**Rationale**: These principles ensure maintainable, testable, and evolvable code over the long term.

### II. KISS - Keep It Simple, Stupid (NON-NEGOTIABLE)

- Code MUST favor simplicity over cleverness
- All complexity MUST be justified by a concrete business need
- Premature abstractions are FORBIDDEN
- YAGNI (You Ain't Gonna Need It): do not implement what is not explicitly required

**Rationale**: Simplicity reduces bugs, eases maintenance, and accelerates onboarding.

### III. DRY - Don't Repeat Yourself

- Avoid duplicating business logic
- Extract common code only when duplication is proven (not preemptively)
- Prefer duplication over a bad abstraction

**Rationale**: DRY reduces inconsistencies, but must be applied with judgment (cf. KISS/YAGNI).

### IV. Test-First & Integration Testing (NON-NEGOTIABLE)

- **Integration tests are mandatory**: Every change MUST include integration tests
- **Unit tests**: Required only when isolated business logic warrants it
- **Red-Green-Refactor**: Write the test → Verify it fails → Implement → Verify it passes → Refactor
- **Bug fix = test first**: Every bug fix MUST start with a non-regression test that reproduces the bug (red), then fix the bug (green). This ensures the bug never resurfaces
- Tests MUST cover API contracts (inputs/outputs)
- No code is merged without passing tests
- **TDD by default**: Test-driven development is the standard working method

**Rationale**: Integration tests validate the real behavior of the system and catch regressions.

### V. Security & OWASP Top 10 (NON-NEGOTIABLE)

Code MUST follow security best practices and guard against OWASP Top 10 vulnerabilities:

- **A01:2021 - Broken Access Control**: Strict access control, principle of least privilege
- **A02:2021 - Cryptographic Failures**: Encrypt sensitive data, no plaintext secrets
- **A03:2021 - Injection**: Validate and sanitize all inputs, use parameterized queries
- **A04:2021 - Insecure Design**: Threat modeling, security by design
- **A05:2021 - Security Misconfiguration**: Secure defaults, no default credentials
- **A06:2021 - Vulnerable Components**: Keep dependencies up to date, regular vulnerability scanning
- **A07:2021 - Authentication Failures**: Robust authentication, secure session management
- **A08:2021 - Software and Data Integrity**: Integrity verification, secure CI/CD pipelines
- **A09:2021 - Security Logging and Monitoring**: Log security events
- **A10:2021 - Server-Side Request Forgery**: URL validation, network restrictions

**Mandatory measures**:
- Secrets managed via environment variables or a secrets manager
- HTTP security headers configured (CORS, CSP, etc.)
- Rate limiting on sensitive endpoints

**Rationale**: Security is not optional. Any exposed service must be protected against common attacks.

### VI. Separation of Concerns

- Strict separation between business logic, presentation, and infrastructure
- Layers MUST communicate through clean interfaces
- No business logic in controllers/handlers
- No direct database access from the presentation layer

**Rationale**: Separation of concerns eases testing, maintenance, and independent evolution of layers.

### VII. Defensive Programming

- Validate all inputs at system boundaries (user input, external APIs)
- Fail fast: detect and report errors as early as possible
- Never trust external data
- Handle error cases explicitly (no silent catches)

**Rationale**: Defensive programming prevents undefined behavior and eases diagnosis.

### VIII. Comprehensive Documentation

- **Code documentation**: Public interfaces documented
- **Architecture documentation**: Diagrams and decisions documented
- **README** kept up to date with setup and contribution instructions
- Each business entity documented (purpose, relations, constraints)

**Rationale**: Documentation ensures sustainability and knowledge transfer.

### IX. Commit Control (NON-NEGOTIABLE)

- **No commit without explicit user approval**
- Each commit must be atomic and correspond to an identifiable task
- Conventional Commit messages:
  - `feat:` for new features
  - `fix:` for bug fixes
  - `docs:` for documentation
  - `test:` for tests
  - `refactor:` for refactoring
- **AI attribution policy (OPTIONAL, honest)**: mentioning AI involvement in commits, PRs or code comments is **permitted and even encouraged** when it adds useful traceability (e.g. `feat: generate drawing-camera PWA (auto-dev v0.X)`, `refactor: simplify state.js per Christie review`). It is NOT required for every commit. Authors should not contort messages to either hide AI usage (dishonest) or showcase it gratuitously (noise) — focus on clarity of what changed and why. The previous "FORBIDDEN to mention AI" rule (constitution v1.0) was dropped in v1.1 because it pushed both humans and AI to write misleading commits.

**Rationale**: Commit control ensures traceability and code quality. Honesty about authorship — including AI co-authorship — is part of that traceability.

### X. Audit Logging

**Every business action in the system MUST be audit-logged.**

- **Covered actions**: Creation, modification, deletion, status changes, permission changes
- **Mandatory fields**: Entity, action, changed fields, before/after values, user identity, UTC timestamp
- **Non-deletion**: Audit logs MUST NEVER be deleted or modified

**Rationale**: Complete traceability is essential for compliance, debugging, and accountability.

### XI. Observability & Structured Logging

- Structured logs (JSON) with appropriate levels (debug, info, warn, error)
- Performance metrics on critical operations
- Request correlation (request ID / trace ID)
- Error and anomaly monitoring

**Rationale**: Observability enables fast diagnosis of production issues.

### XII. Least Privilege & Defense in Depth

- Each component must have only the minimum permissions necessary
- Multiple independent security layers (authentication, authorization, validation, encryption)
- Component isolation (no implicit trust between services)

**Rationale**: Defense in depth limits the impact of a compromise.

## Development Workflow

### Quality Gates

1. **Before implementation**: Tests written and failing
2. **After implementation**: All tests pass
3. **Before commit**: User approval required
4. **Documentation**: Code documented, API documented
5. **Review**: SOLID, KISS, and security verification

### Conventions

- Code, variable names, technical comments in **English**
- Commit messages in **English** (Conventional Commits)

## Governance

- This constitution **takes precedence over all other practices**
- Any amendment to the constitution requires:
  1. Documented rationale for the change
  2. Explicit approval
  3. Migration plan if existing code is impacted
- Code reviews MUST verify compliance with these principles
- Any violation MUST be justified and documented

**Version**: 1.1.0 | **Generated by install-mmd.sh, amended in MMD repo**
**Changes 1.0.0 → 1.1.0**: principle IX softened — "FORBIDDEN to mention AI in commits" replaced by an honest-attribution policy that permits and encourages AI mentions when they add traceability, while not requiring them. The strict prohibition led both humans and AI to write misleading commits in practice.
