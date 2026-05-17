# Constitution Module — Documentation

> Loaded for: documentation skills (Documentalist, `/document-generate`, `/document-release`), code review skills (they verify doc compliance), and anything that produces user-facing artifacts.

## I. Diataxis discipline

Documentation MUST be structured in the 4 Diataxis quadrants:

- `docs/tutorials/` — learning by doing (narrative, hand-holding).
- `docs/how-to/` — recipes for specific problems (procedural).
- `docs/reference/` — exhaustive technical information (structured).
- `docs/explanation/` — conceptual ("why") (discursive).

Mixing categories in one file is the most common Diataxis failure. When in doubt, create a new file in the right quadrant.

## II. ADR (Architecture Decision Records)

Any structural decision MUST be recorded as an ADR in `docs/adr/NNN-short-title.md`:

```markdown
# ADR-NNN: <title>
Date: YYYY-MM-DD
Status: Accepted | Superseded by ADR-XXX | Deprecated

## Context
<what's going on, why we need to decide>

## Decision
<what we decided>

## Consequences
<positive and negative outcomes, follow-up work>
```

ADRs are IMMUTABLE once Accepted. To change a decision, write a new ADR that supersedes the old one.

## III. Post-ship doc sync (gStack `/document-release` pattern)

After every slice ships, the Documentalist MUST verify:

- **Coverage map**: every new/changed feature has its `docs/features/<feature>.md` or quadrant entry.
- **ADR drift**: no existing ADR contradicts the code as it now stands.
- **CHANGELOG polish**: entries follow Keep a Changelog format and are reader-friendly.
- **TODOs cleanup**: TODO comments that match resolved work get removed.

## IV. Doc concision rules

- `architecture.md` MUST stay under 200 lines (split into modules above that).
- Each `features/*.md` MUST stay under 100 lines.
- README MUST stay under 150 lines (link to deeper docs).
- "If it doesn't serve the next iteration or a future human reader, don't write it."

## V. Code comments

- Comments explain **why**, not **what** (the code already shows what).
- Public interfaces (exported functions, public APIs) MUST have a JSDoc/TSDoc/docstring.
- Internal helpers MAY skip docs if the name is self-explanatory.
- A comment that contradicts the code is worse than no comment — delete it on sight.

---

*Version: 1.0.0 | Loaded by documentation-producing skills. See bindings.*
