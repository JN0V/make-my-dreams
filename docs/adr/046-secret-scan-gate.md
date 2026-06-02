# ADR-046 — `mmd secret-scan`: the first Bundle A Security brick — a vanilla, language-agnostic secret gate

**Status**: accepted
**Date**: 2026-06-02
**Slice**: v0.9.1 (Bundle A Security — `mmd secret-scan`)

## Context

MMD orchestrates autonomous AI development: an agent reads a repo, writes code,
and commits — for 30–90 minutes, often detached. That loop has a security hole no
other MMD capability closes: **a leaked credential committed by the agent (or the
human) is one `git push` away from being public forever.** An API key pasted into
a fixture, a `.env` checked in by accident, a private key dropped into a config —
once it lands on a remote it must be assumed compromised. `MAKE_MY_DREAMS.md §6.6`
names "Bundle A Security" as the cluster of gates that make autonomous dev safe to
run unattended; a pre-commit **secret gate** is its cheapest, highest-leverage
first brick.

MMD already *mentions* secret scanning in two places that do not actually gate:
`mmd cso` (the gStack Chief-Security-Officer wrapper) lists "secret scanning" among
the things its LLM review *discusses*, and `security.md` mandates least-disclosure.
Neither is a deterministic, fast, **blocking** check that runs at commit time. That
is the gap this slice closes — and per L-009 discipline, it is named as a gap, not
presented as already-solved.

Two constitutional constraints shape the design:

- **§VIII technology-agnostic analysis (NON-NEGOTIABLE).** MMD's mission is any
  language. A secret scanner that only understood JavaScript would be the exact
  L-009/§VIII anti-pattern the Test Curator (ADR-042) and import graph (ADR-043)
  had to be rescued from. **But scanning for secrets is polyglot _by nature_:** a
  secret is a *textual pattern* (a prefix, a shape, an entropy signature), not a
  language construct. So — unlike the Test Curator, which parses language
  structure and therefore needs per-language adapters — the secret scanner needs
  **no adapter at all**: it scans text, and a `.py`, `.rs`, `.env`, `.yaml`, and
  `.txt` are all scanned identically. This is the honest reading of §VIII here:
  agnostic by construction, not agnostic-via-adapters.
- **§VI failure honesty + `security.md` least-disclosure.** A secret scanner that
  *echoes the secret it found* — into stdout, a log, a CI artifact — has leaked it
  a second way. Every finding is therefore **REDACTED**: a few leading chars (the
  rule-identifying prefix) then asterisks, never the full value.

## Decision

Ship `mmd secret-scan` as a **vanilla (zero-new-dependency), language-agnostic,
read-only security gate**.

### 1. A pure core (`lib/security/secret-scan.js`)

`scanText(text, opts) → findings[{rule, line, column, redactedMatch, confidence}]`.
Pure, deterministic, **never throws** (a non-string input → `[]`). No I/O, no
globals, no time/random. Detectors:

| rule | shape |
|------|-------|
| `private-key` | a `-----BEGIN … PRIVATE KEY-----` block header |
| `aws-access-key-id` | `AKIA` + 16 uppercase/digits |
| `github-token` | `ghp_`/`gho_`/`ghs_`/`ghr_` + 36 base62, or `github_pat_…` |
| `slack-token` | `xox` + a letter + `-` + body |
| `google-api-key` | `AIza` + 35 base64url |
| `jwt` | three base64url segments, first anchored on `eyJ` |
| `generic-high-entropy` | a secret-like identifier (`secret`/`password`/`token`/`api[_-]key`/…) assigned a quoted value whose Shannon entropy ≥ threshold and length ≥ min |

**No external tool (trufflehog/gitleaks), no new npm dependency** — regex + a
hand-rolled Shannon-entropy function, exactly the vanilla-stack bar L-024 set for
the import graph (a small, tested, hand-rolled analyzer over a heavyweight dep).

### 2. Precision-first (secret scanners are a false-positive nightmare)

A noisy gate gets disabled; precision is the product. Three filters, all in the
pure core so they are unit-testable:

- **Placeholder/example skip** — a value containing (case-insensitive) `EXAMPLE`,
  `xxxx`, `0000`, `your-token-here`, `redacted`, or `changeme` is not a real
  secret. (AWS's own docs key ends in `…EXAMPLE` precisely so scanners skip it.)
- **Inline allow-marker** — a comment containing `mmd-secret-ok` on the same line
  as a match, or the line immediately before it, suppresses the finding, so a
  known-safe fixture can be whitelisted in place (language-agnostic: it is a
  substring check, not tied to any comment syntax).
- **Tuned entropy** — the generic rule requires both a secret-like *identifier*
  and a high-entropy, sufficiently-long quoted *value*, so prose and base64 image
  data (which lack the identifier) do not trip it.

### 3. The gate (`bin/security/secret-scan.js`)

Three READ-ONLY surfaces over a git repo:

- default — every git-tracked text file (binary detected by a NUL byte and
  skipped; gitignored files are already excluded by `git ls-files`);
- `--staged` — only the **staged blobs** (`git show :path`), the pre-commit surface;
- `--since <ref>` — files changed since a ref.

**Gating rule:** the six format rules are `confidence: 'high'` and a high-confidence
finding **exits non-zero (1)** — the gate. The `generic-high-entropy` heuristic is
honestly `confidence: 'medium'`: it is **printed as advisory and does NOT change
the exit code**. This is a deliberate precision-first stance — gating a commit on
the FP-prone entropy heuristic would train developers to bypass the hook entirely
(L-023's "fight the harness" anti-pattern), defeating the gate for the *high*-
confidence cases where it is reliable. A `--strict` mode that also gates on
mediums is a documented, deferred opt-in.

It writes **nothing** (an integration test asserts a clean `git status` after a
run). Exit codes: `0` clean · `1` gate (high-confidence secret) · `2` argv · `5`
not a git repo / bad ref.

### 4. Opt-in pre-commit hook (never enabled without the user)

`install-mmd.sh` always materializes a **non-active sample** hook at the gitignored
`.mmd/hooks/pre-commit` (idempotent, sentinel-bounded for a test to extract,
mirroring the `/mmd` slash-command materialization). It is **never enabled** by
default — a pre-commit gate is a workflow change the developer must opt into.
`MMD_INSTALL_SECRET_HOOK=1` installs it into `.git/hooks/pre-commit`, and even then
it **refuses to clobber** an existing hook (reports + skips). Otherwise the install
just prints how to enable it.

## Consequences

- **The first Bundle A brick lands, and it gates for real** — unlike the
  LLM-discussed "secret scanning" in `mmd cso`, this is deterministic, fast, and
  blocking. Dogfood: `mmd secret-scan` on MMD itself scans 527 tracked files clean
  (exit 0).
- **Agnostic by construction honors §VIII** without the adapter machinery the Test
  Curator / import graph needed — because secrets are textual patterns, not
  language structure. (Coverage/blast-radius style analysis still needs adapters;
  this one genuinely does not.)
- **Redaction is the security heart** — a finding never echoes the secret, so the
  scanner cannot itself become a second disclosure path.
- **Follow-up bricks (deferred):** a dependency/slopsquatting **deps-gate** and an
  **egress-sandbox** are the next Bundle A bricks; a `--strict` mode (gate on
  mediums) and entropy-tuning per file type are deferred refinements; an
  org-specific custom-rule file is a YAGNI until asked for.
- **Honest residual:** regex + entropy is not a semantic analyzer — it can miss a
  bespoke credential format with no recognizable shape, and the generic rule is a
  heuristic (hence advisory). A documented limit is not a bug (universal §VI); an
  undocumented one erodes trust.
