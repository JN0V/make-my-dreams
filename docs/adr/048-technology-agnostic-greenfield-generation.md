# ADR-048 — Technology-agnostic greenfield generation + honest preview degradation

**Status**: accepted
**Date**: 2026-06-03
**Slice**: v0.10.a (§VIII applied to the GENERATION path — the technology-agnostic build prompt + the honest preview couple)

## Context

MMD's mission is to build a person's dream in **any** technology. We already paid
the §VIII (technology-agnostic analysis, NON-NEGOTIABLE) debt for the **analysis**
tools — the Test Curator (ADR-042), the import graph (ADR-043), the doc→code ref
extractor (ADR-044) all became adapter-based and detect-and-refuse. But the
**generation** path stayed secretly web-only, and worse, secretly *drawing-camera*-only.

`lib/invoke-autodev.js buildPrompt()` — the prompt for every **greenfield** dream —
injected three hardcoded lines, verbatim, for ANY dream:

```
Stack constraint: vanilla HTML/CSS/JS + Canvas API + getUserMedia. NO framework, NO bundler.
Generate index.html, style.css, app.js, manifest.json in the target directory.
Bundle B safe-default: camera permission MUST be requested on user gesture only, not on page load.
```

For the original v0.1 drawing-camera demo that was exactly right. For **every other
dream** it is **actively wrong**. Sébastien's first real `mmdream serve` build — a
browser PDF editor — was forced toward a camera, forbidden `pdf-lib`/`pdf.js`, and
handed a file layout (`app.js`/`manifest.json`) that does not fit. The Dream
Catcher produces a good scope, then it is poured into a camera-app template. This
was never caught because we only ever dogfooded **the drawing-camera demo** (the
hardcoded case) and **`--here`** (which short-circuits `buildPrompt` entirely). The
"works on my machine" trap, sitting at the very core of the generator.

There was a second, quieter copy of the same bias: `lib/parse-dream.js
initStateFiles()` wrote the SAME camera/canvas lines into `.mmd/shared/slice.md` —
the very file the new prompt delegates stack-derivation to. Fixing only
`buildPrompt` while leaving `slice.md` polluted would have left the agent reading
a camera-biased scope. So this slice fixes both producers of the bias.

### The honesty couple (§VI — do NOT ship the prompt alone)

If only `buildPrompt` changed and the **preview** path stayed web-only, a non-web
dream would *build* but then:

- **Reality Check** would `page.goto(file://…/index.html)` on a file that doesn't
  exist → navigation failed → **FAIL** — punishing a perfectly good CLI build for
  not being a web app.
- **serve** would hand the user a `…/demo/<slug>/index.html` link that 404s — a
  **phantom** preview that *pretends* to work.

That would make serve **worse** and **dishonest** — the opposite of the goal. So
the prompt change ships **with** the honest degradation of both preview surfaces:
detect "this is not a previewable web app" and **say so honestly** (name the kind +
how to run it), never fake or FAIL. This is the §VIII detect-and-refuse pattern,
applied to the preview path.

## Decision

Stop imposing a stack. The agent **derives** the stack/structure/entry point from
the dream + scope; MMD injects only KISS, the profile/safe-defaults, and a **soft**
preference for a previewable no-build web app. The agent records what it built in a
small machine-readable **run descriptor**, which the preview path reads instead of
guessing.

1. **Technology-agnostic greenfield prompt** (`lib/invoke-autodev.js buildPrompt`):
   the three hardcoded camera/canvas/manifest lines are **removed** and replaced by
   a stack-DERIVING directive — derive the simplest stack/structure/entry from
   `.mmd/shared/slice.md`; keep it KISS; **soft** preference (worded as a
   preference, never a hard constraint) for a no-build browser-previewable web app
   *only when the dream allows it*; write `.mmd/shared/run.json`. The
   `prompt`-provided early return (`--here`) and the profile/Layer-C constitution
   block are **byte-for-byte unchanged** — the §VIII change touches ONLY the stack
   lines (regression-locked by the AC-2 tests).

2. **Technology-agnostic slice scope** (`lib/parse-dream.js initStateFiles`): the
   `slice.md` template drops the hardcoded vanilla/Canvas/getUserMedia/camera lines
   for a neutral "derive the stack from the dream; KISS; soft web-preview
   preference" scope, so the file the agent reads to derive its stack is no longer
   camera-biased. (Not named in the SPEC's 5 ACs but necessary for AC-1 to actually
   take effect — leaving it would re-pollute the input. Flagged honestly, L-009.)

3. **Run-descriptor reader** (`lib/greenfield/run-descriptor.js`, pure, never
   throws): `readRunDescriptor(demoDir)` → `{kind, entry, run}` or `null`;
   `isWebPreviewable(descriptor, demoDir)` → boolean (web-static kind with a real
   entry file, OR — back-compat — a bare `index.html` when no descriptor exists).
   Missing / malformed / non-object / no-kind → `null`/`false`, never a fabricated
   kind. Zero deps (`JSON.parse` in a try/catch + `existsSync` — the L-024 bar).

4. **Reality Check honest degradation** (`lib/reality-check.js`): before the
   playwright path opens `file://…/index.html` (and before it even launches a
   browser), it consults the descriptor / `isWebPreviewable`. A non-web build →
   `{status:'SKIPPED', reason}` naming the kind + the run instruction — **never a
   FAIL** on a missing `index.html`. A web-previewable build (descriptor web-static
   with a real entry, or a bare `index.html`) follows today's open+screenshot path.
   The `--here` short-circuit and the forced-backend semantics are unchanged.

5. **serve honest degradation** (`lib/server.js`): the new pure `buildPreviewResult`
   reads the descriptor on a successful build and emits, in the `done` SSE event,
   either today's preview URL (web build — unchanged; back-compat bare `index.html`
   and a web-static `entry:index.html` both yield `…/index.html`) **or** an honest
   `{previewable:false, resultUrl:null, kind, runInstruction, message}` — "Built a
   `<kind>` project — browser preview not available yet. To run it: `<run>`". The
   serve UI (`app.js`) consumes the new fields (producer + consumer shipped
   together, L-022): on a non-web success it shows the message and hides the
   open-app link instead of offering a broken one.

### Why a soft web preference (not "no preference at all")

The greenfield/serve audience is a possibly **non-technical** person who will try
to open the result **in a browser**. A no-build static web app is the only thing
today's preview can actually show. So the prompt keeps a *soft* nudge toward that —
but as a preference that **never** overrides fitting the dream. A PDF editor (web,
previewable) and a bulk-file-renamer CLI (non-web, honestly reported) are both
first-class outcomes.

### Why an agent-written descriptor (not heuristic file-sniffing)

Guessing the stack from the produced files (is there an `index.html`? a
`package.json`?) is the §VIII anti-pattern — a heuristic that is wrong for the long
tail. The agent **knows** what it built; it writes one small JSON. The reader
treats a missing descriptor as the common legacy case and falls back to the
bare-`index.html` check, so nothing regresses.

## Scope — slice 1 of 3 (the rest deferred, named so scope can't creep)

- **(this slice)** tech-agnostic prompt + run descriptor + honest degradation of
  Reality Check & serve.
- **(slice 2, deferred)** Reality Check **adapter-based real verification** per
  stack (web→browser already exists; CLI→run + exit-code; service→health-check).
  This slice only *degrades honestly* (SKIPPED with a reason); it does not yet
  *verify* a non-web build.
- **(slice 3, deferred)** serve preview **adapter-based richness** (web→iframe,
  non-web→render artefacts/logs/instructions nicely). This slice only shows an
  honest text message for non-web.
- **Build-step support** (npm install / bundler / dev-server) is out of scope — the
  soft-web preference exists precisely because today's preview is no-build static.
- **New kinds** beyond `web-static`/`cli`/`service`/`library`/`other` are additive
  later (L-018 — no multi-artefact / monorepo descriptor yet).

## Consequences

- A "browser PDF editor" dream now yields a previewable web app built with PDF
  libraries — **not** a camera app — and Reality Check/serve preview it as today. A
  non-web dream yields the right project + `run.json`, and Reality Check/serve
  **report it honestly** instead of crashing on / faking a missing `index.html`.
- The drawing-camera demo, if re-dreamt, still yields a camera app — because the
  agent *derives* it from that dream, not because it's hardcoded. The capability is
  preserved without the bias.
- `--here` is wholly unaffected (it never reaches the greenfield branch).
- Honest residual: a non-web build is **detected and reported**, not yet
  **verified** or **richly previewed** — that is slices 2-3, named above.

See SPEC_V010A (`docs/specs/SPEC_V010A.md`), the constitution §VIII (`universal.md`), and the
preview/honesty couple in §VI. Related: ADR-042/043/044 (the analysis-side §VIII
reckonings this mirrors on the generation side).
