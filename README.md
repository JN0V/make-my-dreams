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

## Install

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/JN0V/make-my-dreams/main/install.sh | bash
```

This clones MMD into `~/Documents/make-my-dreams/` (override with `MMD_HOME=/path`), installs Phase A (BMAD + adv module + auto-dev workflow + project constitution), and offers to install gStack as the next step. Prerequisites: `git`, `node` (v20+), `npx`, `claude` (Claude Code CLI). `bun` is required only for gStack and can be installed later.

Manual install (if you prefer to read the script first or operate offline):

```bash
git clone https://github.com/JN0V/make-my-dreams.git
cd make-my-dreams
bash install-mmd.sh .
```

## Usage

### CLI mode (terminal)

```bash
cd ~/Documents/make-my-dreams
mmd "a drawing app that overlays an image on the camera feed"
# → creates ./demo/drawing-app-overlays-image-camera-feed/ with a working PWA
```

Env vars: `MMD_AUTODEV_CMD` (override subprocess for testing), `MMD_TIMEOUT_MS` (default 1800000), `MMD_REALITY_CHECK_BACKEND` (`mcp` | `playwright` | `skip`), `MMD_DREAM_MAX_LEN` (default 500).

### Web mode (no terminal — for non-technical users)  — *new in v0.2.5*

```bash
mmd serve
```

This starts a local HTTP server on `http://localhost:3000` (configurable) and auto-opens the default browser. A minimalist page lets anyone — including a 13-year-old kid — type a dream description, click "Go", watch progress stream live, and get a link to the generated PWA. Same machine as `mmd` runs on. No tunnel, no cloud, no account.

```
┌─────────────────────────────────────────────────┐
│  Make My Dreams                                 │
├─────────────────────────────────────────────────┤
│  Décris ton rêve / Describe your dream          │
│  ┌───────────────────────────────────────────┐  │
│  │  une appli pour dessiner sur la caméra    │  │
│  └───────────────────────────────────────────┘  │
│  [ Vas-y / Go ]                                 │
│                                                 │
│  Progress: ▓▓▓▓▓░░░░░ 38%  Phase 3 / 4         │
│  Last update: 14:23:42                          │
│                                                 │
│  ✅ Ton rêve est prêt !                         │
│  [ Open my app ]  [ Start a new dream ]         │
└─────────────────────────────────────────────────┘
```

Env vars:
- `MMD_SERVE_PORT` — server port (default 3000; tries 3000-3010 if 3000 is in use)
- `MMD_SERVE_NO_OPEN=1` — skip auto-opening the browser (useful for CI / SSH)
- `MMD_SERVE_ALLOW_RANDOM=1` — required to allow `MMD_SERVE_PORT=0` (ephemeral, for tests)
- `MMD_SERVE_RATE_LIMIT_PER_HOUR` — successful-run cap per rolling hour (default 10). Only `exitCode == 0` runs consume capacity; failed runs are free retries.

**Working directory**: run `mmd serve` from the directory where you want `demo/` to live (typically the project root). The server spawns subprocesses with `cwd = process.cwd()` and serves `/demo/<slug>/*` from `<cwd>/demo`.

Stop with `Ctrl+C`. The server prints `À bientôt ! / Bye!` and exits cleanly.

**Security**: the server binds to `127.0.0.1` only (never accessible from another machine on your network or the internet). Path traversal on `/demo/<slug>/*` is blocked. CSP headers locked to `'self'`. No cookies, no tracking. Audited per `.specify/memory/constitution/security.md`.

## History

This repo started as `extend-bmad` — a customization of BMAD that combined quick-dev, party mode, adversarial review loops and Spec Kit-style constitution injection (see `install-mmd.sh`, formerly `install-auto-dev.sh`). After comparative usage of Spec Kit, OpenSpec, BMAD and gStack, the scoping evolved into Make My Dreams: an accessibility and orchestration layer that sits on top of these frameworks rather than replacing them. The full design rationale is in [MAKE_MY_DREAMS.md](./MAKE_MY_DREAMS.md), with 14 versioned iterations documenting how every decision was reached.

The folder will be renamed `make-my-dreams/` after v0.1 is validated. The repo itself can be renamed at any time on the git host.

## Status

Pre-v0.1. See [BOOTSTRAP.md](./BOOTSTRAP.md) for the active dev plan, [docs/adr/](./docs/adr/) for architectural decisions, and [PROBLEMS.md](./PROBLEMS.md) for the catalog of 26 documented dev-by-AI problems and how MMD addresses each.

## Components

- [`MAKE_MY_DREAMS.md`](./MAKE_MY_DREAMS.md) — full scoping document (v14, ~1000 lines)
- [`PROBLEMS.md`](./PROBLEMS.md) — annex: 26 documented problems and techniques
- [`BOOTSTRAP.md`](./BOOTSTRAP.md) — step-by-step execution plan
- [`SPEC_V01.md`](./SPEC_V01.md) — the v0.1 walking skeleton spec
- [`install-mmd.sh`](./install-mmd.sh) — self-contained installer; currently installs Phase A (BMAD + adv module + auto-dev workflow), MMD's **Standard engine**. Future phases (B–F) added incrementally with each MMD version.

## Quick start

(Coming with v0.1 — currently the repo is a design + bootstrap workspace, not yet a usable CLI.)

## License

MIT — see [LICENSE](./LICENSE) (to be added in v0.1).
