# Constitution Module — Error handling & defensive programming

> Loaded for: any skill or worker that writes runtime code, handles inputs, calls external APIs, or processes user data.

## I. Defensive programming (NON-NEGOTIABLE)

- Validate all inputs at system boundaries: user input, external APIs, file reads, env vars, MCP tool outputs.
- **Fail fast**: detect and report errors as early as possible.
- Never trust external data.
- Handle error cases explicitly. **No silent catches** (`try { ... } catch {}` with empty body is FORBIDDEN unless documented with a comment explaining why).

## II. Error classification

When code throws or returns an error, categorize it:

- **User error** (bad input, missing config) → friendly message, exit code 1, no stack trace.
- **Programmer error** (assertion violation, impossible state) → full stack trace, exit code 2, file an issue.
- **Environmental error** (network, FS full, permission) → diagnostic + suggested remedy, exit code 3.
- **Catastrophic** (data corruption, security breach) → halt immediately, exit code 4+, alert user.

## III. Graceful degradation

When a non-critical feature fails, the rest of the system MUST keep working:

- Camera permission refused → drawing PWA still usable for upload-only mode.
- Reality Check unavailable → CLI still delivers, just skips the visual smoke test.
- gStack skill unreachable → fall back to local equivalent or document the gap, never crash.

## IV. Retry policy

- Idempotent operations: retry with exponential backoff (start 1s, max 30s, give up after 5 attempts).
- Non-idempotent operations: NEVER auto-retry without explicit confirmation.
- Network calls: respect `Retry-After` headers when present.

---

*Version: 1.0.0 | Loaded by code-producing skills. See bindings.*
