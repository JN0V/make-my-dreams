# Make My Dreams — v0.9.2 Spec: `mmd deps-gate` — the second Bundle A Security brick (polyglot dependency / supply-chain gate)

> *(Bundle A Security, `MAKE_MY_DREAMS.md §6.6` — brick 2. Brick 1 was `mmd secret-scan` (v0.9.1, ADR-046): catch a leaked credential before it is committed. This brick catches a **poisoned dependency before it is installed**.)*
>
> **The gap:** MMD runs an autonomous agent that writes code for 30–90 min, and that agent decides which third-party libraries to pull in. The dominant supply-chain attack today is **typosquatting / slopsquatting**: an attacker pre-registers a package whose name is one keystroke from a popular one (`reqeusts` for `requests`, `lodahs` for `lodash`) — or registers a name an LLM is likely to *hallucinate* — and ships malware in its install script. An autonomous coder that adds `reqeusts` to `requirements.txt` and runs `pip install` has just executed attacker code with the developer's privileges. `mmd cso` only *discusses* dependency risk through its LLM; nothing in MMD **deterministically verifies a dependency before it lands**.
>
> **The fix:** a read-only **gate** — `mmd deps-gate` — that reads a project's declared dependencies and, per dependency, asks the ecosystem's own registry "does this exist, how old is it, how adopted is it, and is its name suspiciously close to a popular package?" A **broken/unresolvable** dependency or a **high-confidence slopsquat** (near a popular name AND brand-new AND barely-downloaded — the conjunction, never one signal alone) **gates** (exit 1). FP-prone single signals are **advisory only** (they do not change the exit code — gating on them would train people to bypass the hook, the L-023 "fight the harness" trap, exactly as secret-scan's generic-entropy rule stays advisory).
>
> **§VIII (technology-agnostic, NON-NEGOTIABLE) by ADAPTERS:** dependency declaration + registry metadata are genuinely **per-ecosystem** (npm's `package.json` + registry.npmjs.org, PyPI's `requirements.txt`/`pyproject.toml` + pypi.org, crates.io, the Go proxy). So — unlike secret-scan, where a secret is a language-neutral textual pattern needing **no** adapter — deps-gate is the **adapter-based** §VIII shape (like the Test Curator ADR-042 and the import graph ADR-043): a **generic, language-neutral core** (the risk assessment + gate logic + report) plus **per-ecosystem adapters** (manifest parse + registry metadata fetch). **The core imports NO adapter and contains NO ecosystem syntax.** When a repo's only manifest is an unsupported stack → **detect-and-refuse honestly** (name the stack + the supported list, exit 6, NO report, NO fabricated numbers — the rule that stopped the JS-on-Rust bug).

---

## 1. Goal of v0.9.2

```
mmd deps-gate                       →  read every declared dependency in the repo's manifest(s)
mmd deps-gate --since <ref>         →  only the dependencies ADDED since <ref> (the real supply-chain surface:
                                        what THIS slice would newly install)

per dependency, via its ecosystem adapter:
    registry says it does NOT exist            →  finding: unresolvable        (HIGH → gate, exit 1)
    near a popular name AND new AND low-adopted →  finding: likely-typosquat   (HIGH → gate, exit 1)   ← the conjunction
    only one of {near-popular, very-new, low-adoption}  →  advisory            (MEDIUM → printed, exit unchanged)
    registry unreachable / fetch failed         →  finding: unverified         (MEDIUM advisory — NEVER a fabricated pass)
    healthy                                      →  clean

NO adapter for the only manifest present  →  REFUSE honestly (exit 6, name stack + supported list, no report)
```

Deliverables:
1. **Pure dependency-risk core** (`lib/security/deps-assess.js`): `assessDependency({ name, declared, metadata, popularNames, opts }) → { name, findings: [{ rule, severity, detail }] }`. Rules: `unresolvable` (registry has no such package) and `likely-typosquat` (the conjunction: edit-distance ≤ `MMD_DEPS_TYPO_DISTANCE` (default 2, >0) to a popular name **and** published < `MMD_DEPS_MIN_AGE_DAYS` (default 30) ago **and** downloads < `MMD_DEPS_MIN_DOWNLOADS` (default 1000)) are `severity:'high'`; the individual `near-popular-name` / `very-new` / `low-adoption` signals are `severity:'medium'`; a `null`/failed `metadata` → a single `unverified` `medium` finding (honest, never a silent pass). Pure, deterministic, never throws; an exact match to a popular name is NOT a typosquat (distance 0); empty/odd input → no findings. Plus `gateExit(results) → 1` iff any `high` finding exists, else `0`.
2. **Polyglot adapter contract + registry** (`lib/security/deps-adapters/`): `index.js` documents the contract (`id`, `displayName`, `matches(signals)` by **manifest presence**, `parseDependencies({ repoRoot, files, readFile }) → [{ name, version, manifestFile }]`, `fetchMetadata(name, { fetchJson }) → { existsInRegistry, firstPublishedDaysAgo|null, downloads|null } | null`, a static `popularNames` seed list, capability flags) + the pure registry (`resolveAdapters(signals)` → all adapters whose manifest is present; `detectStackNames`, `supportedStackNames` — mirrors ADR-042's registry). `deps-adapters/npm.js` (parse `package.json` deps/devDeps; metadata via `https://registry.npmjs.org/<pkg>`) and `deps-adapters/python.js` (parse `requirements.txt` + `pyproject.toml`; metadata via `https://pypi.org/pypi/<pkg>/json`) are the two real adapters — the **proof of genericity** (the v0.8.x JS-then-Python pattern). cargo/go are **named by `detectStackNames`** but have no adapter yet → detect-and-refuse, honestly.
3. **The read-only gate** `bin/security/deps-gate.js`: detect the stack(s) → for each supported adapter, parse deps → fetch metadata (the **injected `fetchJson` seam** — real `fetch` in the bin, a fake in tests; **bounded by a ~5 s per-request timeout**; a failed/timed-out fetch → `unverified` advisory, never a fabricated pass) → assess → render findings grouped by severity → exit per `gateExit`. `--since <ref>` restricts to deps added in `git diff <ref> -- <manifest>`. Writes **nothing** (asserted by a clean `git status` test). When NO adapter matches the present manifest(s) → refuse (exit 6); a mixed repo analyzes the supported stacks and **names** the unsupported ones.
4. **Precision + honesty + least-disclosure**: workspace/local/path/git deps and obvious placeholders are skipped (not "unresolvable" false positives); the network calls are **explicit** (the report names which registries were queried) and **bounded**; offline / registry-down degrades to `unverified` advisory (honest, exit 0) — MMD must never *block a build because the network blinked* nor *fabricate a green*. The heuristic is clearly **labelled a heuristic, not an audit**. Long lists capped with an honest `+N more` (no silent truncation, universal §VI).
5. **Opt-in pre-commit wiring + docs + ADR**: extend the v0.9.1 sample pre-commit hook materialized by `install-mmd.sh` so it can also run `mmd deps-gate --since HEAD` (still **never auto-enabled**; `MMD_INSTALL_DEPS_HOOK=1` mirrors `MMD_INSTALL_SECRET_HOOK=1`, refuses to clobber an existing hook). New ADR; `README.md` + `CLAUDE.md` note the brick; `mmd document-readme --tests N` + `mmd handover --tests N` refresh.

**Mission validation**: on a fixture repo whose `requirements.txt` lists `reqeusts` (a typosquat of `requests`: distance 1, brand-new, ~0 downloads via the fake fetcher) → `mmd deps-gate` reports `likely-typosquat` HIGH and **exits 1**; the same repo with the correct `requests` (exists, old, millions of downloads) → clean, **exit 0**. A fixture npm repo with a dep the fake registry returns 404 for → `unresolvable` HIGH, exit 1. A fixture whose only manifest is `Cargo.toml` → **refuse**, exit 6, names "Rust" + the supported list, **no fabricated numbers**. With the fetcher made to fail → every dep `unverified` MEDIUM advisory, **exit 0** (honest, not a fabricated pass and not a network-blink block). `mmd deps-gate` on MMD itself runs and reports honestly.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: pure dependency-risk core (never throws, conjunction-gated)
**Given** a dependency `{ name, declared, metadata, popularNames, opts }`
**When** `assessDependency(...)` runs
**Then**: `metadata.existsInRegistry === false` → an `unresolvable` `high` finding; a name within edit-distance ≤ `typoDistance` of a popular name (and not equal to one) **AND** `firstPublishedDaysAgo < minAgeDays` **AND** `downloads < minDownloads` → a `likely-typosquat` `high` finding; each of those three signals **alone** → a `medium` finding (`near-popular-name` / `very-new` / `low-adoption`); `metadata` null/failed → a single `unverified` `medium`; an exact popular-name match or a healthy dep → no findings. Pure, deterministic, **never throws**; empty/odd input → `{ name, findings: [] }`. `gateExit(results)` → `1` iff any finding is `high`, else `0`.
Tag: `@unit` (unresolvable; typosquat conjunction vs each-signal-alone; exact-match-not-squat; unverified; gateExit high-vs-none; never-throws on garbage).

### AC-2: polyglot adapter contract + registry; detect-and-refuse (§VIII)
**Given** a repo's manifest signals
**When** `resolveAdapters(signals)` runs and an adapter parses + fetches
**Then**: `package.json` present → the npm adapter; `requirements.txt`/`pyproject.toml` → the python adapter; both → both; `Cargo.toml`/`go.mod` only → `[]` (no adapter) while `detectStackNames` still **names** Rust/Go. Each adapter's `parseDependencies` returns `{name,version,manifestFile}[]` (npm: deps+devDeps; python: requirements + pyproject), skipping local/path/workspace/git specifiers; `fetchMetadata` uses the **injected** `fetchJson` (no live network in tests) and maps the registry response → `{existsInRegistry, firstPublishedDaysAgo, downloads}` (404 → `existsInRegistry:false`; fetch throw/timeout → `null`). The **core (`deps-assess.js`) imports NO adapter**; adapters import no core. Pure where pure; fetch isolated behind the seam.
Tag: `@unit` (resolveAdapters per-manifest; npm + python parse incl. skip-local; metadata map incl. 404 + throw) + `@integration` (fixture repos).

### AC-3: the `mmd deps-gate` gate — surfaces, exit codes, read-only
**Given** `mmd deps-gate [--since <ref>]`
**When** run in a repo
**Then**: default scans all declared deps across supported manifests; `--since <ref>` restricts to deps **added** in `git diff <ref> -- <manifest>`; findings are grouped by severity and rendered with the manifest file + the queried registry named; **exit codes** mirror secret-scan: `0` clean (incl. advisory-only), `1` any `high` (gate), `2` bad argv (`--since` with no value), `5` not-a-git-repo / bad ref, `6` only-unsupported-stacks-present (refuse: name stacks + supported list, NO report, NO numbers). It writes **nothing** (a clean `git status` after a run is asserted). A high finding gates; medium findings are advisory and do **not** change the exit.
Tag: `@integration` (typosquat→exit1; healthy→exit0; 404→exit1; unsupported-only→exit6; --since added-dep only; clean git status) + `@unit` (argv → exit 2/5 paths).

### AC-4: precision, bounded network, honest degradation
**Given** real-world manifests and an unreliable network
**When** `mmd deps-gate` runs
**Then**: workspace/local/path/git/placeholder deps are **skipped** (no `unresolvable` false positive); each registry request is **bounded** (~5 s timeout, injectable); a failed/timed-out/offline fetch → `unverified` **medium advisory** and **exit 0** (never a fabricated pass, never a network-blink hard-block — universal §VI); the report **names which registries were queried** (explicit egress) and **labels itself a heuristic, not an audit**; long finding lists are capped with an honest `+N more`. No dependency name is echoed in a way that leaks a private-registry token (deps-gate reads names, not credentials — but it must not print any auth header it was given).
Tag: `@unit` (skip-local; unverified-on-fetch-fail keeps exit 0; cap note) + `@integration` (fetcher forced to fail → all unverified, exit 0).

### AC-5: opt-in hook + docs + ADR
**Given** v0.9.2 ships
**When** `install-mmd.sh` runs and docs are read
**Then**: the materialized **sample** pre-commit hook (gitignored `.mmd/hooks/pre-commit`, v0.9.1) can also invoke `mmd deps-gate --since HEAD`; it stays **non-active** unless `MMD_INSTALL_DEPS_HOOK=1` (mirrors `MMD_INSTALL_SECRET_HOOK=1`) and **refuses to clobber** an existing hook. A new ADR documents the brick (why adapters here but not in secret-scan; the conjunction-gating precision design; bounded explicit egress; detect-and-refuse §VIII); `README.md` + `CLAUDE.md` note it; `mmd document-readme --tests N` + `mmd handover --tests N` refresh. Dispatch + USAGE + `SUBCOMMANDS` mirror the secret-scan / document-* contract.
Tag: `@unit` (hook sample contains the deps-gate line, sentinel-bounded; SUBCOMMANDS includes deps-gate) + `@integration` (install materializes the sample; clobber-refusal).

---

## 3. Architecture (incremental)

```
lib/security/deps-assess.js              NEW — pure assessDependency(...) + gateExit(...); NO adapter import, NO ecosystem syntax
lib/security/deps-adapters/index.js      NEW — the adapter contract + pure registry (resolveAdapters / detectStackNames / supportedStackNames)
lib/security/deps-adapters/npm.js        NEW — package.json parse + registry.npmjs.org metadata (via injected fetchJson) + popularNames seed
lib/security/deps-adapters/python.js     NEW — requirements.txt + pyproject.toml parse + pypi.org metadata + popularNames seed
bin/security/deps-gate.js                NEW — the read-only gate: detect → parse → fetch(seam, bounded) → assess → render → exit
bin/mmd.js                               MODIFY — dispatch `deps-gate`, USAGE line, SUBCOMMANDS entry (mirror secret-scan @1409)
install-mmd.sh                           MODIFY — sample hook gains the deps-gate line; MMD_INSTALL_DEPS_HOOK opt-in; clobber-refusal
docs/adr/0NN-deps-gate.md                NEW
README.md / CLAUDE.md / HANDOVER.md / package.json   MODIFY — 0.9.2
test/unit/deps-assess.test.js            NEW — AC-1
test/unit/deps-adapters.test.js          NEW — AC-2 (resolve + parse + metadata-map)
test/integration/deps-gate.test.js       NEW — AC-3/AC-4 (fixtures: typosquat, healthy, 404, unsupported-only, --since, fetch-fail, clean git status)
test/integration/install-deps-hook.test.js  NEW — AC-5 (sample materialization + clobber-refusal)
```

**Dependency direction (§VIII):** core (`deps-assess.js`) ← adapters (`npm.js`/`python.js`) ← registry (`index.js`) ← bin (`deps-gate.js`). The core imports nothing ecosystem-specific; an adapter never imports the core. The network lives ONLY behind the injected `fetchJson` seam in the bin; adapters receive it, the core never touches it.

**Zero new dependencies** (the L-024 vanilla-stack bar): manifest parsing is regex/`JSON.parse`/the existing YAML-lite style, registry calls use Node 20's built-in global `fetch` — no `axios`, no `semver`, no registry-client lib. Edit distance is a hand-rolled Levenshtein (small, bounded).

---

## 4. Out of scope for v0.9.2 (→ follow-ups)
- ❌ **cargo / go / other-ecosystem adapters** — `detectStackNames` names them; building their adapters is a follow-up (the registry makes adding one = one file). npm + python prove the polyglot shape (ADR-042 pattern).
- ❌ **Known-CVE / advisory-database lookup** (osv.dev, GitHub advisories) — a different axis (known-vulnerable vs squat-suspicious); a later brick.
- ❌ **Install-script / postinstall static analysis** — heavier; deferred.
- ❌ **`--strict`** (gate on the medium advisories too) — a deferred opt-in, like secret-scan's deferred `--strict`.
- ❌ **Caching registry responses** — each run queries live; a cache is a perf follow-up. Keep the scan bounded (cap the number of deps queried per run, logged honestly if capped).
- ❌ **Worker-sandbox egress allowlist** — Bundle A brick 3 (heavier, OS-level), the next brick after this.

## 5. Implementation hints (for auto-dev)
1. Read this SPEC + ADR-046 (`mmd secret-scan` — the sibling gate: read-only, gate-vs-advisory exit semantics, exit-code table, the opt-in hook materialization in `install-mmd.sh`, the sentinel-bounded sample) + ADR-042 (the Test Curator adapter contract + registry + detect-and-refuse — **copy this shape** for `deps-adapters/index.js`) + ADR-043 (the import-graph adapter registry, for the per-file-vs-manifest distinction).
2. **The §VIII line is the heart**: `deps-assess.js` must contain NO `package.json`/`requirements.txt` knowledge and import NO adapter — it operates only on the normalized `{name, declared, metadata}` an adapter produces. The JS-on-Rust bug (ADR-042) is the thing this design exists to prevent; an integration test MUST prove the Cargo-only repo is **refused** (exit 6), not silently scanned as if it were npm.
3. **Precision is the priority** (a deps gate that cries wolf gets bypassed — L-023). The HIGH/gate findings are exactly two: `unresolvable` and the `likely-typosquat` **conjunction** (near-popular AND very-new AND low-adoption — all three). Every single-signal case is MEDIUM advisory and does NOT change the exit. This mirrors secret-scan's "format rules gate, generic-entropy stays advisory" precisely.
4. **Network honesty (§VI)**: the fetch is an injected seam (`fetchJson(url, {timeoutMs})`), bounded by ~5 s, used ONLY in the bin (real `fetch`) — tests inject a fake map `{ '<pkg>': metadata }` and a failing fake. A fetch failure → `unverified` MEDIUM + **exit 0**: MMD must neither fabricate a green nor hard-block on a network blink. The report must name which registries were contacted (explicit egress, like the v0.5.a `MMD_NOTIFY_URL` least-disclosure framing).
5. The `popularNames` seed lists live IN each adapter (ecosystem-specific) — a small static top-N (e.g. the 200 most-downloaded npm/PyPI names). Document it as a seed/heuristic, not an exhaustive index. The typosquat check is distance-to-this-seed.
6. Operational rules for the slice launch: `MMD_TIMEOUT_MS=0`, commit incrementally per AC, this SPEC is FROZEN; do NOT cite a to-be-created `docs/adr/*.md` path literally (describe it as "a new ADR under the ADR folder").
7. Constitution bindings: universal (§I SRP — pure core vs adapters vs bin; §VI honesty — unverified-not-fabricated-pass + detect-and-refuse; §VII human-readable findings; **§VIII technology-agnostic — the non-negotiable adapter design**), ai-coding (§I honest AI failure, §V verification), commit-git, testing (tag every test; red-green; fixture repos per ecosystem; the seam keeps tests offline), security (this IS a security gate — least-disclosure egress, no token echo, bounded network), error-handling (pure fns never throw; fetch failure → honest unverified), documentation.

## 6. Definition of done
1. All 5 ACs met (AC-2 §VIII detect-and-refuse + AC-4 honest-unverified are the safety gates).
2. Full suite passes (current 1906 + new tests).
3. `mmd deps-gate` deterministically gates a broken/unresolvable dep and a high-confidence slopsquat (exit 1), stays advisory on FP-prone single signals (exit 0), refuses an unsupported-only stack honestly (exit 6), and degrades to `unverified` advisory on a network failure (exit 0) — never a fabricated pass, never a network-blink block. The core is adapter-free; npm + python adapters prove the polyglot shape.
4. The opt-in sample hook can run deps-gate (never auto-enabled, refuses to clobber); README + CLAUDE.md + the new ADR in place; `mmd document-readme --tests N` + `mmd handover --tests N` run.
5. Version bumped to `0.9.2`.
6. Slice merged (ff-only) + tag `v0.9.2`.
7. Bundle A Security brick 2 is shipped: a poisoned dependency is caught before it is installed, polyglot by adapters per §VIII, with the same precision-first / honest-degradation discipline as the secret-scan brick. Brick 3 (worker-sandbox egress allowlist) remains the next.

---

*Spec v0.9.2 — `mmd deps-gate`: a read-only, polyglot (adapter-based, §VIII), vanilla (zero-dep) supply-chain gate that verifies each declared dependency against its ecosystem registry (existence / age / adoption / typosquat-distance) before it is installed. HIGH (unresolvable or the slopsquat conjunction) gates (exit 1); FP-prone single signals stay advisory; a network failure degrades to honest `unverified` (never a fabricated pass); an unsupported-only stack is refused honestly (exit 6). The second Bundle A Security brick after secret-scan (v0.9.1).*
