# Make My Dreams — v0.10.0 Spec (slice v0.10.a): technology-agnostic greenfield generation + honest preview

> *(New theme: §VIII applied to the GENERATION path, not just analysis. The biggest user-visible fix in the backlog — HANDOVER's "honest reckoning" priority #1.)*
>
> **The gap (verified in code).** The greenfield build prompt is **hardcoded for the original v0.1 drawing-camera demo**. `lib/invoke-autodev.js buildPrompt()` injects, for ANY greenfield dream, three lines:
> ```
> Stack constraint: vanilla HTML/CSS/JS + Canvas API + getUserMedia. NO framework, NO bundler.
> Generate index.html, style.css, app.js, manifest.json in the target directory.
> Bundle B safe-default: camera permission MUST be requested on user gesture only, not on page load.
> ```
> For a PDF editor (Sébastien's first real `mmdream serve` build) that is **actively wrong**: it forces a camera, forbids `pdf-lib`/`pdf.js`, and imposes a file layout that doesn't fit. Every non-drawing dream is mis-framed. The Dream Catcher scope is good, then it's poured into a camera-app template. Never caught because we only ever dogfooded the drawing-camera demo (the hardcoded case) and `--here` (which short-circuits `buildPrompt` entirely). The "works on my machine" trap at the CORE.
>
> **Why this is a §VIII violation.** MMD's mission is any-technology. We already paid this debt for the ANALYSIS tools (Test Curator, import-graph, doc-refs → adapters + detect-and-refuse). The GENERATION + PREVIEW path stayed secretly web-only — same fault, other face: a camera/canvas template fabricated for every dream.
>
> **The fix Sébastien chose (option 2 + §VIII).** Stop imposing a stack. The agent **derives** the stack/structure/entry point from the dream+scope; MMD injects only the profile + safe-defaults. The agent writes a small machine-readable **run descriptor** (`.mmd/shared/run.json`) so the downstream preview path no longer has to *guess* the stack. Because the greenfield/serve audience is a possibly non-technical person in a browser, the prompt keeps a **soft preference** for a previewable web app *with no build step* **when the dream allows** — never a hard constraint, never camera-specific.
>
> **The honesty couple (§VI — do NOT ship the prompt alone).** If only `buildPrompt` changes and Reality Check + serve stay web-only, a non-web dream would *build* but then serve would open a phantom `index.html` and Reality Check would FAIL on a missing file — making serve **worse** and *pretending*. So this slice ships the prompt change **with** the honest degradation of Reality Check and serve: detect "no web app here" and **say so honestly** (name the kind + how to run it) instead of faking a broken preview. This is the §VIII detect-and-refuse pattern applied to the preview path.
>
> **Scope = slice 1 of 3.** (1, this slice) tech-agnostic prompt + run descriptor + honest degradation. (2, deferred) Reality Check **adapter-based** real verification per stack (web→browser, CLI→exit code…). (3, deferred) serve preview **adapter-based** richness (web→iframe, non-web→artefacts). Slice 1 alone already unblocks the PDF editor (web, previewable) AND stops MMD lying about a non-web build.

---

## 1. Goal of v0.10.a

```
Dream Catcher scope (e.g. "a browser PDF editor")
   →  buildPrompt (greenfield branch): NO camera/canvas/manifest hardcoding.
      "Derive the simplest stack that fulfils the dream. Prefer a web app runnable
       in a browser WITHOUT a build step when the dream allows (so it can be
       previewed); otherwise produce the right project + a clear way to run it.
       Write .mmd/shared/run.json describing what you built."
      (+ profile/safe-defaults preserved; --here unchanged.)
   →  agent builds the PDF editor (pdf-lib via ESM/CDN, index.html) + run.json {kind:"web-static", entry:"index.html"}
   →  Reality Check reads run.json: web-static + index.html present → preview/screenshot (as today)
   →  serve shows the running app.

Counter-case ("a CLI that renames files in bulk", a non-web dream):
   →  agent builds the CLI project + run.json {kind:"cli", run:"node rename.js ..."}
   →  Reality Check: no web entry → SKIPPED, honest reason ("built a cli project — open run.json / run `<run>` to verify", NOT a FAIL on missing index.html)
   →  serve result view: "Built a cli project — browser preview not available for this kind yet. To run it: <run>" (no phantom index.html link)
```

Deliverables:
1. **Technology-agnostic greenfield prompt** (`lib/invoke-autodev.js buildPrompt`): the three hardcoded camera/canvas/manifest lines are **removed** and replaced by a stack-deriving directive (derive from the scope in `.mmd/shared/slice.md`; KISS — simplest stack that fulfils the dream; soft preference for a no-build browser-previewable app **only when the dream allows**; write the run descriptor). Profile + Layer-C constitution injection (lines 261-297) **preserved unchanged**. The `prompt`-provided early return (line 228) — the `--here` path — is **byte-for-byte unchanged** (regression-locked).
2. **Run-descriptor reader** (`lib/greenfield/run-descriptor.js`, pure): `readRunDescriptor(demoDir)` → `{ kind, entry, run }` (or `null` if absent/malformed); `isWebPreviewable(descriptor, demoDir)` → boolean (web-static kind with a real entry file, OR — back-compat — a bare `index.html` present when there's no descriptor). Pure, never throws, missing/garbage → null/false.
3. **Reality Check honest degradation** (`lib/reality-check.js`): before opening `file://…/index.html`, consult the descriptor / `isWebPreviewable`. Web-previewable → today's Playwright open+screenshot. Not web-previewable → `{status:'SKIPPED', reason}` naming the kind + the run instruction — **never a FAIL caused by a missing `index.html`**. The existing `--here` short-circuit and the existing web behavior are unchanged.
4. **serve preview honest degradation** (`lib/server.js` result presentation): when the finished build is not web-previewable, the result surfaced to the user is an honest "built a `<kind>` project — browser preview not available yet; to run it: `<run>`" instead of a (broken) `…/index.html` link. Web builds are unchanged (today's `index.html` result URL).
5. **Docs + ADR**: ADR-048 (the §VIII generation reckoning, the run-descriptor contract, the soft-web-preference rationale, the honesty couple, slices 2-3 deferred), README + CLAUDE.md notes, mechanical blocks refreshed (`mmdream document-readme --tests N`, `mmdream handover --tests N`), version bumped to 0.10.0.

**Mission validation**: a "browser PDF editor" dream produces a previewable web app using PDF libraries (NOT a camera app), and Reality Check/serve preview it as today. A non-web dream produces the appropriate project + `run.json`, and Reality Check/serve **report it honestly** (named kind + how to run) instead of crashing on / faking a missing `index.html`. The drawing-camera demo, if re-dreamt, still yields a camera app — because the agent *derives* it from that dream, not because it's hardcoded.

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: greenfield prompt is technology-agnostic (no camera/canvas hardcoding)
**Given** `buildPrompt({dream, slug, demoDir})` with no `prompt` provided (the greenfield branch) and `MMD_PROFILE` unset
**When** the prompt is built
**Then**: the output contains **none** of the strings `getUserMedia`, `Canvas API`, `camera permission`, `manifest.json`, nor the fixed `index.html, style.css, app.js` file list; it **does** instruct the agent to (a) derive the stack/structure/entry from the scope in `.mmd/shared/slice.md`, (b) keep it as simple as the dream allows (KISS), (c) prefer a no-build, browser-previewable web app **when the dream allows it** (worded as a soft preference, not a hard constraint), and (d) write `.mmd/shared/run.json` describing what was built. Pure/deterministic.
Tag: `@unit` (absence assertions + presence of the derive/run.json directives).

### AC-2: profile/safe-defaults and the `--here` path are preserved (regression lock)
**Given** (a) `buildPrompt` with a non-empty `prompt` (the `--here` path), and (b) `buildPrompt` greenfield with `MMD_PROFILE=Kid`
**When** the prompt is built
**Then**: (a) the `prompt`-provided output is returned **byte-for-byte unchanged** (no greenfield lines appended); (b) the Kid run still injects the profile line + the Layer-C constitution modules (or the minimal Kid safe-default fallback) exactly as before — the §VIII change touches ONLY the stack lines, not the profile block.
Tag: `@unit` (prompt passthrough identity; Kid block still present).

### AC-3: run-descriptor reader (pure, never throws)
**Given** a `demoDir` with/without `.mmd/shared/run.json` (valid, malformed JSON, missing)
**When** `readRunDescriptor(demoDir)` / `isWebPreviewable(...)` run
**Then**: a valid descriptor parses to `{kind, entry, run}`; missing or malformed → `null` (reader) / `false` (previewable), never throws; `isWebPreviewable` is true for `kind:'web-static'` with a real `entry` file present, true for a bare `index.html` when no descriptor exists (back-compat), false otherwise.
Tag: `@unit` (valid / malformed / missing / web vs non-web / back-compat bare index.html).

### AC-4: Reality Check degrades honestly for a non-web build
**Given** a finished `demoDir` that is NOT web-previewable (e.g. `run.json {kind:'cli'}`, no `index.html`)
**When** `realityCheck({demoDir})` runs (greenfield mode, real backend selected)
**Then**: it returns `{status:'SKIPPED', reason}` where `reason` names the build kind and points to `run.json` / the run instruction — it does **NOT** return `FAIL` and does **NOT** attempt to open a missing `index.html`. A web-previewable `demoDir` (descriptor web-static or bare `index.html`) still follows today's open+screenshot path. The `--here` short-circuit is unchanged.
Tag: `@unit`/`@integration` (non-web → SKIPPED honest; web → unchanged path; missing index.html no longer FAILs).

### AC-5: serve surfaces a non-web build honestly + docs
**Given** a completed serve/greenfield build that is not web-previewable
**When** the result is surfaced to the user (the result URL / status the serve UI shows)
**Then**: the user sees an honest "built a `<kind>` project — browser preview not available yet; to run it: `<run>`" message instead of a phantom `…/index.html` link; a web build is unchanged (today's `index.html` result URL). **And** docs land: ADR-048, README + CLAUDE.md, mechanical blocks refreshed, version bumped to 0.10.0.
Tag: `@integration` (non-web result message; web result URL unchanged) + docs presence.

---

## 3. Out of scope (deferred — named so the scope can't silently creep)

- **Reality Check adapter-based *real* verification** per stack (web→browser already exists; CLI→run+exit-code; service→health-check). This slice only **degrades honestly** (SKIPPED with a reason); it does not yet *verify* a non-web build. → slice 2.
- **serve preview adapter-based richness** (web→iframe, non-web→render artefacts/logs/instructions nicely). This slice only shows an honest text message for non-web. → slice 3.
- **Build-step support** (npm install / bundler / dev-server / non-web servers in serve). Out of scope; the soft-web preference exists precisely because today's preview is no-build static.
- **Heuristic stack detection from produced files** — rejected in favor of the agent-written `run.json` descriptor (the agent knows what it built; guessing is the §VIII anti-pattern).
- **Scale assumptions (L-018):** the run descriptor is a single small JSON; no multi-artefact / monorepo descriptor. New kinds beyond `web-static`/`cli`/`service`/`library`/`other` are additive later.

---

## 4. Operational notes for the implementer

- Touch ONLY the greenfield branch of `buildPrompt` (lines ~232-249). The `prompt`-provided early return (line 228) and the profile/Layer-C block (lines ~261-297) MUST stay as they are — pin them with the AC-2 regression test.
- `.mmd/shared/run.json` is written by the *agent during the build*, so this slice's job is (a) instruct the agent to write it (prompt) and (b) read it defensively downstream (reader). Treat a missing descriptor as the common case (older builds, the agent forgot) → fall back to the bare-`index.html` check so nothing regresses.
- Keep it vanilla / zero new deps (the L-024 bar): `JSON.parse` in a try/catch, `fs.existsSync` for the entry file.
- Commit incrementally per AC (L-019).
