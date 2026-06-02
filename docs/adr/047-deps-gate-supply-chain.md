# ADR-047 — `mmd deps-gate`: the second Bundle A Security brick — a polyglot, adapter-based, vanilla supply-chain gate

**Status**: accepted
**Date**: 2026-06-02
**Slice**: v0.9.2 (Bundle A Security — `mmd deps-gate`)

## Context

MMD runs an autonomous agent that writes code for 30–90 minutes, and **that agent
decides which third-party libraries to pull in.** The dominant supply-chain attack
today is **typosquatting / slopsquatting**: an attacker pre-registers a package
whose name is one keystroke from a popular one (`reqeusts` for `requests`, `lodahs`
for `lodash`) — or a name an LLM is *likely to hallucinate* — and ships malware in
its install script. An autonomous coder that adds `reqeusts` to `requirements.txt`
and runs `pip install` has just executed attacker code with the developer's
privileges. `MAKE_MY_DREAMS.md §6.6` names "Bundle A Security"; brick 1 was
`mmd secret-scan` (catch a leaked credential before it is committed, ADR-046). This
brick catches a **poisoned dependency before it is installed.**

MMD already *mentions* dependency risk in one place that does not actually gate:
`mmd cso` (the gStack security wrapper) *discusses* it through its LLM. Nothing in
MMD **deterministically verifies a dependency before it lands.** That is the gap
this slice closes — and per L-009 discipline, it is named as a gap, not presented
as already-solved.

Two constitutional constraints shape the design:

- **§VIII technology-agnostic analysis (NON-NEGOTIABLE).** Unlike secret-scan —
  where a secret is a language-neutral *textual pattern* needing **no** adapter —
  dependency declaration and registry metadata are genuinely **per-ecosystem**
  (npm's `package.json` + registry.npmjs.org, PyPI's `requirements.txt` /
  `pyproject.toml` + pypi.org, crates.io, the Go proxy). So deps-gate is the
  **adapter-based** §VIII shape, exactly like the Test Curator (ADR-042) and the
  import graph (ADR-043): a **generic, language-neutral risk core** plus
  **per-ecosystem adapters**. The honest reading of §VIII differs per capability:
  *agnostic by construction* (secret-scan) vs *agnostic by adapters* (deps-gate) —
  the deciding question is whether the thing being analyzed is a textual pattern or
  a language/ecosystem structure.
- **§VI failure honesty.** A deps gate that **fabricates a pass** when the network
  is down, or **hard-blocks a build because the network blinked**, is worse than no
  gate: the first hides risk, the second trains people to bypass it. A fetch
  failure must degrade to an honest **`unverified` advisory** (printed, exit 0) —
  never a fabricated green, never a network-blink red.

## Decision

Ship `mmd deps-gate`, a **read-only**, **polyglot (adapter-based)**, **vanilla
(zero-dependency)** supply-chain gate, in four layers with a strict dependency
direction (§VIII): **core ← adapters ← registry ← bin**.

1. **Pure language-neutral risk core** (`lib/security/deps-assess.js`).
   `assessDependency({ name, declared, metadata, popularNames, opts })` operates
   ONLY on the normalized facts an adapter produces — it contains **no ecosystem
   syntax** and **imports no adapter** (a structural test pins this). Exactly two
   findings **GATE** (`severity:'high'`): `unresolvable` (the registry has no such
   package) and `likely-typosquat` — the **conjunction**: within edit-distance
   `MMD_DEPS_TYPO_DISTANCE` (default 2) of a popular name **AND** first published <
   `MMD_DEPS_MIN_AGE_DAYS` (default 30) ago **AND** fewer than
   `MMD_DEPS_MIN_DOWNLOADS` (default 1000) downloads. Each of those three signals
   **alone** is a `medium` advisory (`near-popular-name` / `very-new` /
   `low-adoption`). A null/failed `metadata` → a single `unverified` `medium`. Pure,
   deterministic, never throws. `gateExit(results) → 1` iff any `high`. Edit
   distance is a hand-rolled bounded Levenshtein (no `semver`, no string-distance
   lib).

2. **Polyglot adapter contract + pure registry** (`lib/security/deps-adapters/`).
   `index.js` documents the contract (`id`, `displayName`, `registryName`,
   `matches(signals)` by manifest presence, `parseDependencies(...)`,
   `fetchMetadata(name, { fetchJson, now, timeoutMs })`, a static `popularNames`
   seed, capability flags) and the pure registry (`resolveAdapters` /
   `detectStackNames` / `supportedStackNames` — copied from ADR-042). `npm.js`
   (package.json deps+devDeps; registry.npmjs.org for existence+age, api.npmjs.org
   for downloads) and `python.js` (requirements.txt + pyproject.toml; pypi.org +
   pypistats) are the two real adapters — the proof of genericity. cargo/go are
   **named** by `detectStackNames` but have no adapter yet.

3. **The read-only gate** (`bin/security/deps-gate.js`): detect the stack(s) →
   resolve adapters (or **refuse honestly**, exit 6) → parse declared deps → fetch
   metadata behind the **injected `fetchJson` seam** (real `fetch` in the bin, a
   fake in tests; bounded ~5 s/request, concurrency 6, capped at 200 deps/run,
   logged honestly if it bites) → assess (pure) → render grouped by severity,
   **naming the queried registries** → exit per `gateExit`. `--since <ref>`
   restricts to dependencies **added** relative to `<ref>` (re-parsing the
   manifest at `<ref>` via `git show`). It writes **nothing** (asserted). The
   bin's `cwd` / `fetchJson` / `now` / streams are injectable, so the integration
   tests run fully **offline**.

4. **Opt-in pre-commit wiring + docs.** The v0.9.1 sample hook materialized by
   `install-mmd.sh` now ALSO runs `mmd deps-gate --since HEAD` (after secret-scan);
   it stays non-active unless `MMD_INSTALL_DEPS_HOOK=1` (mirrors
   `MMD_INSTALL_SECRET_HOOK=1`) and refuses to clobber an existing hook. Dispatch +
   USAGE + `SUBCOMMANDS` mirror the secret-scan contract.

**Exit codes** (mirror secret-scan): `0` clean / advisory-only / nothing to gate ·
`1` GATE (any HIGH) · `2` bad argv · `5` not a git repo / bad ref · `6`
only-unsupported-stacks-present (refuse: name stacks + supported list, NO report,
NO numbers).

## Consequences

**Positive.**
- A poisoned dependency (unresolvable, or the slopsquat conjunction) is caught
  **before it is installed**, deterministically, with the same precision-first and
  honest-degradation discipline as the secret-scan brick.
- Polyglot by adapters per §VIII: the JS-on-Rust fabrication bug (ADR-042) is
  structurally impossible — the core has no ecosystem knowledge, and an
  unsupported-only stack is **refused**, not silently mis-scanned.
- Zero new dependencies (regex + `JSON.parse` + a hand-rolled Levenshtein + Node's
  built-in `fetch`) — the L-024 vanilla-stack bar held.
- The network is **explicit and bounded** (the report names the registries; each
  request times out); offline degrades to honest `unverified`, so the gate never
  blocks a build on a network blink nor fabricates a green.

**Negative / limits (named honestly, §VI).**
- The typosquat radar is only as good as each adapter's **static `popularNames`
  seed** — a small top-N, documented as a heuristic, not an exhaustive index. A
  squat of an unlisted-but-popular name is missed (widen the seed to improve).
- `pyproject.toml` parsing is a pragmatic **regex heuristic** (PEP 621 array +
  Poetry table), not a full TOML parse — it does not resolve optional-dependency
  group tables or dynamic deps. `setup.py` deps are not parsed (arbitrary code).
- Each run queries the **live** registry (no cache); the per-run cap bounds it.
- Known-CVE / advisory-database lookups, install-script static analysis, a
  `--strict` mode (gate on the medium advisories), cargo/go adapters, and response
  caching are all **out of scope** — follow-ups. The next Bundle A brick is the
  worker-sandbox **egress allowlist** (brick 3).

## Alternatives considered

- **Shell out to a third-party scanner (e.g. `pip-audit`, `npm audit`,
  Socket/Snyk).** Rejected: a heavy/networked dependency or a paid service, against
  the zero-dep vanilla-stack convention, and `npm audit` targets known CVEs (a
  different axis than squat-suspicion).
- **A full AST / lockfile resolver.** Rejected (L-024 precedent): for a
  declared-dependency gate, parsing the manifest's declared names is enough; a full
  resolver is more dependency and more surface for no gating benefit.
- **Gate on a single squat signal (just name-similarity, or just newness).**
  Rejected as FP-prone — it would cry wolf and train bypassing (the L-023
  fight-the-harness trap). Only the three-signal **conjunction** gates; single
  signals stay advisory, exactly as secret-scan's generic-entropy rule stays
  advisory.
- **Hard-block when the registry is unreachable.** Rejected: that blocks a build on
  a network blink. Offline → honest `unverified` advisory + exit 0 (§VI).
