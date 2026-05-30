# Constitution Module — AI coding hygiene

> Loaded for: any skill or worker run by an LLM (so, essentially everything in MMD). Captures AI-specific patterns that don't fit elsewhere.

## I. Honest AI failure reporting

When an LLM-driven Worker hits a wall — context exceeded, tool unavailable, prompt ambiguous, hallucinated output — it MUST report the wall explicitly rather than fabricating success or producing plausible-but-fake output.

Examples of dishonest AI behavior to forbid:
- Returning "DONE" when tests don't pass.
- Claiming a file was created when the write failed silently.
- Inventing a function signature to make code compile.
- Reciting documentation from memory instead of reading the actual file.

When in doubt: produce a partial result + an explicit "I could not complete X because Y" block.

## II. Tool-choice discipline

When multiple skills/tools could accomplish a task, prefer the one most narrowly scoped:

- `/qa-only` over `/qa` when you don't need fixes applied, just a report.
- `grep` over a vector RAG when you have a likely string to search.
- A single targeted Worker over the full auto-dev pipeline when the task is trivial.
- A read-only tool over a write tool when you only need to inspect.

The Documentalist observes tool choices (scoping §6.5b) and proposes lessons-learned when it sees recurring mismatches.

## III. Prompt hygiene

When composing prompts for sub-agents:

- Quote and clearly delimit untrusted content (file contents, web fetches, MCP outputs).
- Restate the goal and the acceptance criteria at both the start AND end of the prompt (counters constraint decay — P-02).
- Reference files by path, not by paraphrase. Let the agent read them.
- Avoid embedding large fixed blobs (e.g. the whole constitution as text); use the bindings system to load only relevant modules.

## IV. Context discipline

- Sub-agents are launched in fresh contexts when the parent's context risks pollution (P-01 context rot).
- State that must survive a context handoff goes in externalized files (`vision.md`, `slice.md`, `status.json`), not in agent memory.
- An agent at >70% context budget signals `READY_FOR_HANDOFF` rather than continuing.

## V. Verification before delivery

Before declaring "done":

- An agent MUST run the tests it just wrote (and pass them).
- An agent MUST diff its work and explain each meaningful change.
- An agent SHOULD verify behavior through an independent oracle when one exists (Reality Check, /qa, external lint).

"I think it works" is not "it works".

## VI. Stuck-recovery (v0.2.j)

When an agent run shows any stall signal (no commit > N min, retry count > M, recurring error pattern), do NOT retry blindly. Invoke `mmd unblock <slice>` to run a 5-Whys session. Apply the recommended action.

The 5-Whys session (BMAD Party Mode: Mary leads, Winston/Quinn/Amelia/Christie augment) returns one of five closed actions: `continue-with-hint`, `abandon-approach`, `escalate-to-user`, `task-actually-complete`, `false-positive-stall`. On unparseable session output the action is always `escalate-to-user` (the sacred fallback — never fabricate a confident verdict). See [ADR-011](../../../docs/adr/011-five-whys-escalation.md).

**Prompt-grounding** (extends §VI from v0.2.j): every file path cited in a dream MUST exist on the launch base. The `lib/here-mode` precheck enforces this automatically since v0.2.h; the rule remains in case someone bypasses via `MMD_SKIP_GROUNDING`. Honor the spirit even when the check is bypassed — pasting a SPEC file path that doesn't exist is a 30-min-of-auto-dev mistake. See [ADR-013](../../../docs/adr/013-prompt-grounding-check.md).

---

*Version: 1.2.0 | Loaded by every LLM-driven skill/worker (essentially everything). See bindings.*
