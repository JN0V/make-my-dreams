# Constitution Module — Observability & audit logging

> Loaded for: any skill or worker that runs code in production, processes business actions, or contributes to MMD's own self-improvement (autolearning needs traces).

## I. Structured logging

- Logs MUST be structured (JSON), not free-text strings.
- Required fields per log entry: `timestamp` (ISO 8601 UTC), `level` (debug|info|warn|error), `message`, `context` (object with relevant key-values).
- Optional but recommended: `request_id` / `trace_id`, `user_id` (or anonymous marker), `component`.

## II. Log levels

- `debug`: only useful during development. NEVER ship at default level in production.
- `info`: normal operations (request started, slice transitioned, milestone reached).
- `warn`: something is off but the system kept working (retry happened, fallback used).
- `error`: an operation failed and was reported.
- No `fatal` — use `error` + exit non-zero. The process death is the fatality signal.

## III. Audit logging (NON-NEGOTIABLE)

**Every business action MUST be audit-logged.**

- **Covered actions**: creation, modification, deletion, status changes, permission changes, security-relevant events (login, role change, secret access).
- **Mandatory fields**: entity, action, changed fields, before/after values, user identity, UTC timestamp.
- **Non-deletion**: audit logs MUST NEVER be deleted or modified. Append-only.

## IV. Request correlation

For any cross-process or cross-Worker chain, a `trace_id` (UUID v4) MUST be propagated. Reality Check, Worker spawn, gStack invocation, MCP tool call — all log the same `trace_id`.

## V. Telemetry for self-improvement (MMD-specific)

The autolearning loop (scoping §6.5) and the tool-choice tracking (scoping §6.5b once introduced) MUST receive structured signals:

- Every Worker invocation: `worker_invoked` event with `{worker_name, args_summary, context_keywords, outcome, duration_ms}`.
- Every skill invocation (gStack, MCP, etc.): `tool_invocation` event with same shape.
- Every error fix: `error_fixed` event with `{finding_id, classification, fix_summary}`.

These events feed `lessons-learned/` extraction.

---

*Version: 1.0.0 | Loaded by runtime-code skills and self-improvement-touching components. See bindings.*
