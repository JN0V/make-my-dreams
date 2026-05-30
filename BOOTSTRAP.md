# Make My Dreams — Bootstrap Guide

> Step-by-step commands to start the Make My Dreams project, **right here in this repo**. `extend-bmad` is the intellectual origin of MMD (the scoping document, the 12 versions of design rationale, `install-mmd.sh` which is the ancestor of MMD's Standard engine). It now becomes the MMD repo itself. Estimated time: ~1 day for v0.0 + 1–2 days for v0.1.

---

## 0. Why this repo (and not a new one)

The `extend-bmad` repo already contains:
- 12 versions of `MAKE_MY_DREAMS.md` capturing the full design rationale
- `PROBLEMS.md` — the 26 documented problems annex
- `install-mmd.sh` — the proven Extend BMAD `auto-dev` installer that will serve as MMD's **Standard engine** (cf §3.1)
- The complete git history of how MMD's design emerged from real usage of Spec Kit, BMAD and the desire to do better

Starting a separate repo would have meant duplicating all of this and losing the historical thread. **MMD is the natural evolution of Extend BMAD, not a competing project.** The repo `extend-bmad` becomes `make-my-dreams`.

### Optional: rename the folder and remote

If you want the folder name to match the project name (recommended for clarity):

```bash
# Local rename
cd ~/Documents
mv extend-bmad make-my-dreams
cd make-my-dreams

# Update Cowork's workspace folder selection to point at make-my-dreams/

# Update git remote if applicable (e.g., GitHub repo rename)
git remote set-url origin git@github.com:<your-org>/make-my-dreams.git
# Then on GitHub: Settings → Rename repository
```

This rename is **optional** and can wait. The bootstrap below assumes you may or may not have renamed.

---

## Prerequisites

Make sure you have installed on your machine:

- **Node.js** ≥ 20 (for `npx` and BMAD)
- **Bun** ≥ 1.0 (for gStack — `curl -fsSL https://bun.sh/install | bash`)
- **Git** ≥ 2.40 (for worktrees)
- **Claude Code** CLI (`npm install -g @anthropic-ai/claude-code` if not installed)
- A working **Anthropic API key** exported as `ANTHROPIC_API_KEY`

Verify:

```bash
node --version    # v20+
bun --version     # 1.0+
git --version     # 2.40+
claude --version  # latest
echo $ANTHROPIC_API_KEY | wc -c   # > 1
```

---

## Trust assumptions

`install-mmd.sh` provisions third-party tools through each project's own
documented install path. Two pipe a remote script straight into a shell; the
v0.2.m pillar phases (5–7) use each tool's native package manager instead:

- **bun** — `curl -fsSL https://bun.sh/install | bash` (Phase 0)
- **gStack** — `curl -fsSL https://gstack.dev/install.sh | bash` (Phase 4)
- **Spec Kit** ([github.com/github/spec-kit](https://github.com/github/spec-kit)) — `uv tool install specify-cli` (pip fallback) (Phase 5)
- **OpenSpec** ([github.com/Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)) — `npm install -g openspec` (Phase 6)
- **Ralph Loop** (Claude Code plugin) — `claude plugin install ralph-loop` (Phase 7)

What this means, and how to opt out:

1. **Every pillar install is gated by an interactive prompt** (default `N`).
   Each runs non-interactively only when you explicitly export its
   `MMD_AUTO_INSTALL_*=1` toggle: `MMD_AUTO_INSTALL_BUN` (bun),
   `MMD_AUTO_INSTALL_GSTACK` (gStack), `MMD_AUTO_INSTALL_SPEC_KIT` (Spec Kit),
   `MMD_AUTO_INSTALL_OPENSPEC` (OpenSpec), `MMD_AUTO_INSTALL_RALPH_LOOP` (Ralph
   Loop). The matching `MMD_REQUIRE_*=1` vars make a pillar mandatory (absent +
   declined → non-zero exit). In a normal run you are asked first.
2. **The trust roots are the `bun.sh` and `gstack.dev` HTTPS endpoints** (and
   their TLS certificate chain). `curl … | bash` executes whatever those servers
   return at install time — there is no pinned checksum in v0.2.k.
3. **High-assurance environments can skip both steps entirely** by
   pre-installing bun and gStack manually (e.g. from a vendored tarball or your
   own mirror) *before* running `install-mmd.sh`. When both tools are already on
   `PATH`, the installer detects them and never reaches the `curl … | bash` lines.

Pinning known-good SHA-256 digests for the two scripts is tracked as a follow-up
(deliberately out of scope for v0.2.k — see `SPEC_V02K.md` §4).

---

## Phase v0.0 — Repo setup + gStack install + audit (~1 day, blocking)

### Step 1 — Update the README

The current repo has no real README. We add one with the v11 positioning (English, per project rule).

```bash
cd ~/Documents/extend-bmad   # or make-my-dreams if you renamed

cat > README.md << 'EOF'
# Make My Dreams (MMD)

> An accessibility and orchestration layer for AI-driven development. From a 13-year-old kid to a 30-year veteran — same tool, adapted experience.

## What this is

Make My Dreams (MMD) lets any human describe an application need in natural language and see a working MVP delivered quickly, then enriched iteratively.

MMD is built **on the shoulders of** existing frameworks rather than replacing them:

- **[Spec Kit](https://github.com/github/spec-kit)** — versioned constitution + spec-driven workflow
- **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** — lightweight spec-first alternative
- **[BMAD](https://github.com/bmad-code-org/BMAD-METHOD)** — agent personas (Mary, Winston, Amelia…) and structured workflows
- **[gStack](https://github.com/garrytan/gstack)** — 41 mature skills covering the full sprint cycle
- **[Ralph Loop](https://ghuntley.com/loop/)** — minimalist bounded loop pattern

What MMD adds: multi-audience accessibility (Kid → Pro), reflexive bootstrap (MMD improves MMD), stateless hierarchical orchestration, brownfield Project Onboarder, local parallelization via git worktrees.

**MMD's success is the success of the projects it stands on.**

## History

This repo started as `extend-bmad` — a customization of BMAD that combined quick-dev, party mode, adversarial review loops and Spec Kit-style constitution injection (see `install-mmd.sh`). After comparative usage of Spec Kit, OpenSpec, BMAD and gStack, the scoping evolved into Make My Dreams: an accessibility and orchestration layer that sits on top of these frameworks rather than replacing them. The full design rationale is in [MAKE_MY_DREAMS.md](./MAKE_MY_DREAMS.md), with 11+ versioned iterations documenting how every decision was reached.

## Status

Pre-v0.1. See [BOOTSTRAP.md](./BOOTSTRAP.md) for the active dev plan, [docs/adr/](./docs/adr/) for architectural decisions, and [PROBLEMS.md](./PROBLEMS.md) for the catalog of 26 documented dev-by-AI problems and how MMD addresses each.

## Components

- [`MAKE_MY_DREAMS.md`](./MAKE_MY_DREAMS.md) — full scoping document (~1000 lines, 11 versions)
- [`PROBLEMS.md`](./PROBLEMS.md) — annex: 26 documented problems and techniques
- [`BOOTSTRAP.md`](./BOOTSTRAP.md) — this file's sibling: step-by-step dev plan
- [`SPEC_V01.md`](./SPEC_V01.md) — the v0.1 walking skeleton spec to feed to `auto-dev`
- [`install-mmd.sh`](./install-mmd.sh) — the proven `auto-dev` installer that will serve as MMD's **Standard engine** (cf §3.1 of the scoping document)

## Quick start

(Coming with v0.1 — currently the repo is a design + bootstrap workspace, not yet a usable CLI.)

## License

MIT — see [LICENSE](./LICENSE) (to be added in v0.1).
EOF

git add README.md
git commit -m "docs: README — MMD positioning and history"
```

### Step 2 — Verify `install-mmd.sh` runs against this repo

`install-mmd.sh` (formerly `install-auto-dev.sh`, renamed and bumped to v5.0.0 to mark the MMD transition) is already in this repo. It installs BMAD + the `adv` module + the `auto-dev` workflow + the default constitution. The script's header documents the **6 progressive installation phases** (A → F) that will be added with each MMD version. Currently only Phase A (Standard engine) is active; future phases (FAST engine, Security bundle, Project Onboarder, Conductor, worktrees) will be added incrementally as MMD matures.

```bash
cd ~/Documents/extend-bmad   # or make-my-dreams
bash install-mmd.sh .
```

Expected outcome:
- `_bmad/` directory created
- `.specify/memory/constitution.md` exists (or already existed)
- `.claude/commands/bmad-adv-auto-dev.md` created
- No errors

If anything fails, fix `install-mmd.sh` (it's part of MMD now, you own it).

### Step 3 — Install gStack globally

gStack is installed once globally per machine (under `~/.claude/skills/gstack`). Follow the official instructions:

```bash
git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack
bun install
# Follow gStack's setup wizard if any (browser cookies, gbrain, etc.)
```

Verify in Claude Code, **from the MMD repo**, that gStack slash-commands are visible:

```bash
cd ~/Documents/extend-bmad   # or make-my-dreams
claude
> /office-hours --help
> /qa --help
> /context-save --help
```

You should see help output for each. If not, troubleshoot per gStack docs before continuing.

### Step 4 — Run the v0.0 gStack audit

Test the 10 most-critical gStack skills MMD will rely on (per §3.3 of the scoping document). You can do this **directly in this repo** — it's a low-risk read-mostly exercise:

```bash
# Create a throwaway sub-folder for the audit so you don't pollute git
mkdir -p /tmp/mmd-gstack-audit
cd /tmp/mmd-gstack-audit
echo "# gStack audit playground" > README.md
git init && git add . && git commit -m "init"

claude
# Try each skill end-to-end; note what works, what doesn't, what surprises:
> /office-hours        # Dream Catcher dependency
> /design-consultation # Mockup Generator dependency
> /plan-ceo-review     # Plan-Review Worker dependency
> /plan-eng-review     # Plan-Review Worker dependency
> /qa                  # Reality Check dependency
> /cso                 # Security Worker dependency
> /context-save        # Context Worker dependency
> /context-restore     # Context Worker dependency
> /document-release    # Documentalist dependency
> /ship                # Dream Delivery dependency
```

For each: confirm it runs end-to-end, produces the expected output, and matches what §3.3 assumed.

### Step 5 — Write ADR-001

Back in the MMD repo, document the audit result:

```bash
cd ~/Documents/extend-bmad   # or make-my-dreams
mkdir -p docs/adr
```

Create `docs/adr/001-adopt-gstack-as-backbone.md`:

```markdown
# ADR-001: Adopt gStack as the runtime backbone

Date: 2026-05-16
Status: Accepted

## Context

After comparative audit of Spec Kit, OpenSpec, BMAD, gStack and Ralph Loop, gStack covers ~70% of the runtime skills MMD would otherwise have to build from scratch. See MAKE_MY_DREAMS.md §3.2 for the full strategic analysis.

## Decision

MMD will use gStack as its runtime backbone, invoking gStack skills from MMD Workers rather than reimplementing them. MMD focuses its development effort on its 6 real differentiators (cf §3.2):

1. Multi-audience accessibility (Kid → Pro)
2. Reflexive bootstrap + autolearning
3. Worktrees parallelization
4. Brownfield Project Onboarder
5. Stateless hierarchical orchestration
6. 3 engines with Mode Router

`install-mmd.sh` is kept as MMD's Standard engine (existing pipeline, mature, owned by us).

## Audit results (v0.0)

The 10 most critical gStack skills were tested in `/tmp/mmd-gstack-audit` on 2026-05-16:

| Skill | Status | Notes |
|---|---|---|
| `/office-hours` | TODO | |
| `/design-consultation` | TODO | |
| `/plan-ceo-review` | TODO | |
| `/plan-eng-review` | TODO | |
| `/qa` | TODO | |
| `/cso` | TODO | |
| `/context-save` | TODO | |
| `/context-restore` | TODO | |
| `/document-release` | TODO | |
| `/ship` | TODO | |

## Consequences

- MMD development unblocked for v0.1.
- gStack version pinned at (TODO: pin a specific commit or release after Step 3).
- All gStack invocations go through the `mmd-gstack-invoke` wrapper (TBD in v0.2).
- If gStack disappears or breaks compatibility, MMD can fall back to a fork or replacement skill-by-skill.
- `install-mmd.sh` continues to ship with the repo as the Standard engine bootstrap.

## References

- https://github.com/garrytan/gstack
- MAKE_MY_DREAMS.md §3.2 and §3.3
```

Fill in the audit table after Step 4. Commit:

```bash
git add docs/
git commit -m "docs: ADR-001 adopt gStack as runtime backbone"
```

### Step 6 — Validate v0.0 complete

Checklist before moving to v0.1:

- [ ] README.md exists in English with positioning and history
- [ ] `install-mmd.sh` still runs cleanly on this repo
- [ ] gStack installed globally and all 10 critical skills run successfully
- [ ] `docs/adr/001-adopt-gstack-as-backbone.md` committed with filled-in audit table

Once all checked: **v0.0 done**. Proceed to v0.1.

---

## Phase v0.1 — Walking skeleton (1–2 days)

### Step 7 — Hand `auto-dev` the v0.1 spec

The walking skeleton spec is in [`SPEC_V01.md`](./SPEC_V01.md) (right here in this repo).

From inside Claude Code, run:

```bash
cd ~/Documents/extend-bmad   # or make-my-dreams
claude
> /bmad-adv-auto-dev Implement the v0.1 walking skeleton as described in SPEC_V01.md (read it in full and follow it precisely). Goal: a `mmd <dream>` CLI command that delegates to auto-dev (the Standard engine, this repo's existing install-mmd.sh) to deliver a working MVP for the dream "a drawing app that overlays an image on the camera feed". Output: working CLI under bin/mmd.js + a PWA generated under ./demo/drawing-app-camera-overlay/ that runs locally.
```

`auto-dev` will:
1. Generate a full tech-spec via quick-dev + party mode + adversarial review
2. Implement the spec with 3-reviewer adversarial code review
3. Run final adversarial code review

Be patient — the full pipeline takes 30–90 minutes depending on the spec complexity.

### Step 8 — Validate v0.1

After `auto-dev` completes:

```bash
cd ~/Documents/extend-bmad
ls demo/drawing-app-camera-overlay/   # PWA files should be there
ls bin/mmd.js                         # CLI entry should be there
node bin/mmd.js --help                # Or `mmd --help` after global install
node bin/mmd.js "add a red button"    # Should trigger a follow-up round
```

Open `demo/drawing-app-camera-overlay/index.html` in a browser (or `npx serve demo/drawing-app-camera-overlay/`) and verify the drawing-on-camera feature works.

### Step 9 — Commit and tag v0.1

```bash
git add .
git commit -m "feat: v0.1 walking skeleton — mmd CLI + drawing-camera demo"
git tag v0.1.0
```

---

## What's next

After v0.1 is validated:

- **v0.2** — FAST engine (Ralph + 1-page spec)
- **v0.2b** — dream-bench v0 + Bundle A Security
- **v0.2c** — Project Onboarder + `.mmd/shared/` vs `.mmd/local/`
- **v0.2d** — 3 engines (Fast / Standard / Deep)
- **v0.2.5 — ⭐ Accessibility milestone**: `mmd serve` opens a local web page in the browser. This is **the moment Sébastien's daughter can use MMD without a terminal**. She types her dream in a text field on a webpage, clicks a button, gets her PWA. Same machine that runs `mmd`. No tunnel, no cloud, no deployment. ~2-3 days of work.

See [`MAKE_MY_DREAMS.md` §9](./MAKE_MY_DREAMS.md) for the full roadmap.

From v0.2 onwards, **MMD starts developing MMD** (reflexive bootstrap, §7 of the scoping document). The dream-bench from v0.2b is mandatory before promoting any v0.X+1 release.

### Who can use MMD at each milestone

| Version | Sébastien can use it | His daughter can use it |
|---|---|---|
| v0.1 | Yes (CLI) | No (would need terminal) |
| v0.2 → v0.2d | Yes (CLI) | No |
| **v0.2.5** | **Yes (CLI + web)** | **Yes (web page on same machine) ✨** |
| v0.6 | Yes | Yes (web page on her phone via Wi-Fi) |
| v0.10 | Yes | Yes, with full conversational UI |
| v0.11 | Yes | Yes, with voice |

---

## Troubleshooting

**gStack skills not visible in Claude Code**
→ Verify `~/.claude/skills/gstack/` exists and Claude Code skills are enabled. Restart Claude Code.

**`auto-dev` complains about missing constitution**
→ Check `.specify/memory/constitution.md` exists. If not, re-run `bash install-mmd.sh .` from this repo.

**`auto-dev` runs but loops / never converges**
→ Check budget cap. The default party-mode + 3-reviewer flow is expensive. If you're hitting limits, set `MAX_ITERATIONS=3` in the workflow config and retry. Alternatively, escalate the issue and consider running the spec phase only first.

**Drawing-camera demo doesn't get camera permission**
→ Open via `https://localhost:...` or `http://localhost`, not via `file://`. Browser security blocks `getUserMedia` on file:// URLs.

---

*Bootstrap guide — v2 (revised after deciding extend-bmad becomes the MMD repo) — generated 2026-05-16 from MAKE_MY_DREAMS.md v12.*
