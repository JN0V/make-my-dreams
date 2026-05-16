# Make My Dreams — v0.1 Walking Skeleton Spec

> Specification for the first usable version of MMD. To be fed into Extend BMAD `auto-dev` (see [BOOTSTRAP.md](./BOOTSTRAP.md) Step 8). Keep this short and concrete: this is a walking skeleton, not a complete system.

---

## 1. Goal of v0.1

Deliver a `mmd <dream>` CLI command that:
1. Takes a dream description in natural language as argument
2. Orchestrates a minimal pipeline using **Extend BMAD `auto-dev` as the runtime engine** (gStack integration deferred to v0.2)
3. Produces a working PWA in `./demo/<dream-slug>/` that fulfills the dream
4. Validates the output by opening it in a browser via Claude in Chrome (basic Reality Check)

This walking skeleton must validate **end-to-end** the architecture before adding bells and whistles.

The fil-rouge dream to validate v0.1: **"a drawing app that overlays an image on the camera feed"** (Sébastien's primary test case for his daughter).

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: CLI installable

**Given** a fresh clone of the MMD repo with Node.js 20+ installed
**When** the user runs `npm install -g .` from the repo root
**Then** the `mmd` command is available in the user's `$PATH` and `mmd --version` returns `0.1.0`

### AC-2: CLI accepts a dream

**Given** `mmd` is installed
**When** the user runs `mmd "a drawing app that overlays an image on the camera feed"`
**Then** the CLI:
- Prints `Catching your dream…` and the parsed dream description
- Creates a `./demo/drawing-app-camera-overlay/` directory (slug from the dream)
- Initializes `.mmd/shared/vision.md`, `.mmd/shared/slice.md`, `.mmd/shared/status.json` in the demo directory
- Returns exit code 0 on success

### AC-3: Delegates to `auto-dev` for actual implementation

**Given** the dream has been parsed and the demo directory created
**When** the CLI proceeds to implementation
**Then** it invokes `auto-dev` via `bash -c "claude /bmad-adv-auto-dev <prompt>"` with a prompt built from the dream + the vision.md and slice.md
**And** waits for `auto-dev` to complete
**And** captures stdout/stderr into `.mmd/local/runs/<timestamp>.log`

### AC-4: Produces a working PWA

**Given** `auto-dev` has completed successfully on the drawing-app dream
**When** the user opens `./demo/drawing-app-camera-overlay/index.html` in a modern browser (Chrome 120+, Firefox 120+, Safari 17+)
**Then** the page:
- Requests camera permission on first interaction (not on load — per Bundle B safe-by-default)
- Displays the live camera feed once permission is granted
- Shows an upload-image button that lets the user select a local image file
- Overlays the uploaded image semi-transparently on top of the camera feed
- Shows drawing tools (pen, eraser, color picker, clear button) that draw on a canvas on top of the overlay
- Gracefully degrades if camera permission is denied (shows a helpful message + still allows drawing on a blank canvas with the uploaded image as background)

### AC-5: Basic Reality Check via Claude in Chrome

**Given** the PWA has been generated
**When** the CLI proceeds to validation
**Then** it invokes Claude in Chrome (via the `mcp__Claude_in_Chrome__navigate` MCP tool if available, or a Playwright fallback) to:
- Open the PWA in a real browser
- Take a screenshot
- Check that the page loads without console errors
- Save the screenshot to `.mmd/local/reality-checks/<timestamp>.png`
**And** reports `Reality Check: PASS` or `Reality Check: FAIL — <reason>`

### AC-6: Stateless state files

**Given** the CLI has run
**When** the user inspects the demo directory
**Then** the following files exist with the documented format:
- `.mmd/shared/vision.md` (~10 lines, plain markdown, describes the long-term vision)
- `.mmd/shared/slice.md` (~20 lines, describes this v0.1 slice)
- `.mmd/shared/status.json` (JSON with fields: `slice_id`, `state` enum [pending|in_progress|done|failed], `created_at`, `updated_at`, `tasks` array)
- `.mmd/local/runs/<timestamp>.log` (full log of the auto-dev invocation)
- `.gitignore` (auto-managed, ignores `.mmd/local/` only)

### AC-7: Idempotent re-run

**Given** the CLI has run once successfully on a dream
**When** the user re-runs `mmd "<same dream>"`
**Then** the CLI:
- Detects the existing demo directory and `.mmd/shared/status.json`
- Asks the user (interactive prompt): `Existing dream found. [R]esume / [F]resh start / [C]ancel?`
- On `R`: reads status.json and tells the user what state the dream is in, exits 0
- On `F`: deletes the demo directory and restarts from scratch
- On `C`: exits 1

---

## 3. Architecture (minimal)

```
mmd <dream>
   │
   ▼
[1] Parse dream → vision.md + slice.md + status.json
   │
   ▼
[2] Spawn auto-dev sub-process via bash + claude CLI
   │   prompt = vision + slice + constitution + the dream
   │
   ▼
[3] Wait for auto-dev (stream output to .mmd/local/runs/)
   │
   ▼
[4] Reality Check: open PWA in browser, screenshot, check console
   │
   ▼
[5] Report status: ✅ delivered at ./demo/<slug>/ or ❌ <reason>
```

Total components: a single Node.js CLI entry point + a few utility modules. **No Conductor, no Orchestrator, no Workers, no Mode Router yet** — those come in later versions (v0.3+). v0.1 is intentionally as thin as possible.

---

## 4. Out of scope for v0.1

To keep this walking skeleton small:

- ❌ No Dream Catcher conversational UI (CLI argument only)
- ❌ No Dream Expander brainstorming
- ❌ No Tech Architect (the PWA stack is hardcoded: vanilla HTML/CSS/JS + Canvas API + getUserMedia)
- ❌ No Mode Router (always uses auto-dev directly)
- ❌ No Plan-Review
- ❌ No Documentalist
- ❌ No Conductor / Orchestrator (single-process execution)
- ❌ No worktrees parallelization
- ❌ No gStack integration (deferred to v0.2)
- ❌ No autolearning, no dream-bench (deferred to v0.2b)
- ❌ No profiles or engagement modes (always defaults to Pro / Standard / Autonomous-equivalent)
- ❌ No mockup generation
- ❌ No automated deployment to Vercel/Netlify (local only)

All of these are explicitly out of scope for v0.1. The walking skeleton's purpose is to **validate the loop end-to-end** before investing in any of these.

---

## 5. Implementation hints (for auto-dev)

### Project structure

```
make-my-dreams/
├── bin/mmd.js              # CLI entry point
├── lib/
│   ├── parse-dream.js      # Slug, vision.md, slice.md generation
│   ├── invoke-autodev.js   # bash + claude CLI subprocess
│   ├── state.js            # .mmd/shared/ + .mmd/local/ management
│   └── reality-check.js    # Browser screenshot + console check
├── package.json            # name=make-my-dreams, bin={mmd: bin/mmd.js}
├── README.md               # already exists
└── demo/                   # generated PWAs go here (gitignored? — TBD)
```

### Key dependencies (minimal)

- `commander` or built-in `process.argv` parsing (prefer built-in for now)
- `node:child_process` for bash + claude invocation
- `node:fs/promises` for state file management
- No frontend frameworks for the generated PWA (vanilla HTML/CSS/JS)
- Optional: `playwright` for Reality Check fallback if Claude in Chrome MCP not available

### Testing

- **Mandatory integration test**: write a test that runs `mmd "a tiny test app that shows hello world"` and asserts the PWA gets generated and loads. This is the v0.1 dream-bench prototype.
- Use Jest or Vitest — pick whichever auto-dev defaults to.
- Test the idempotent re-run (AC-7) explicitly.

### Constitution compliance

All Bundle A safety items apply from day 1:
- No secrets in code or commits (use env vars if needed — but v0.1 doesn't need any)
- No dependency added without explicit justification (we want minimal install)
- Standard `.gitignore` includes `node_modules/` and `.mmd/local/`
- Commits: Conventional Commits, no AI mention, no AI co-author

---

## 6. Definition of done

v0.1 is done when:

1. All 7 acceptance criteria are met
2. The integration test passes
3. The drawing-app-camera-overlay dream produces a working PWA that Sébastien's daughter can actually use (real-world validation)
4. README is updated with the `mmd <dream>` usage example
5. v0.1.0 git tag created
6. ADR-002 documents the choice of vanilla HTML/CSS/JS for generated PWAs (for v0.1 only; v0.2d Tech Architect will revisit)

---

*Walking skeleton spec — generated 2026-05-16 from MAKE_MY_DREAMS.md v11. Feed this verbatim to `auto-dev` per BOOTSTRAP.md Step 8.*
