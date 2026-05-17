# Repository rename procedure — `extend-bmad` → `make-my-dreams`

> **STATUS (2026-05-17): Steps 1, 2, 3 are DONE.** Steps 4 (local folder rename) and 5 (verification) remain to be done by Sébastien at his convenience. The repo is fully renamed on GitHub, the description is set, the topics are set, and the local git remote points to the new URL.

## What was already done (steps 1-3, automated via `gh` CLI on 2026-05-17)

```bash
gh api -X PATCH "/repos/JN0V/extend-bmad" \
  -f name="make-my-dreams" \
  -f description="An accessibility and orchestration layer for AI-driven development..."

gh api -X PUT "/repos/JN0V/make-my-dreams/topics" \
  --input - <<EOF
{"names":["ai-coding","agentic","spec-driven-development","bmad","gstack","claude-code","make-my-dreams"]}
EOF

git remote set-url origin git@github.com:JN0V/make-my-dreams.git
```

GitHub automatically created HTTP redirects from `extend-bmad/*` to `make-my-dreams/*`, so old links and the `install.sh` fallback keep working.

## What remains (steps 4-5, manual, do when convenient)

The local folder is still named `extend-bmad/` and Cowork's workspace selection still points there. Renaming the folder is optional but recommended for clarity.

## Why rename

The repo started as `extend-bmad` — a customization of BMAD. After scoping v10, the project pivoted to "MMD = accessibility and orchestration layer above gStack and friends" and the name "extend-bmad" became actively misleading: it suggests BMAD is the primary, when in fact MMD now orchestrates BMAD, gStack, OpenSpec, Spec Kit, and Ralph Loop equally.

## Pre-rename state (current)

- Local folder: `~/Documents/extend-bmad/`
- GitHub remote: `git@github.com:JN0V/extend-bmad.git`
- Description on GitHub: (currently empty or generic)
- Cowork workspace folder selection: `~/Documents/extend-bmad/`
- `install.sh` already references the new URL (`make-my-dreams`) with a fallback to the old (`extend-bmad`), so the rename can happen at any time without breaking the one-liner installer.

## Procedure (5 steps)

### Step 1 — Rename on GitHub (UI)

Go to https://github.com/JN0V/extend-bmad/settings → field "Repository name" → enter `make-my-dreams` → Rename.

GitHub automatically:
- Creates HTTP redirects from `extend-bmad/*` URLs to `make-my-dreams/*` (so old links and the install.sh fallback keep working).
- Keeps the SSH/HTTPS remote URL working through redirects.

If you have `gh` CLI:

```bash
gh repo rename make-my-dreams --repo JN0V/extend-bmad
```

### Step 2 — Update description and topics on GitHub

Settings → "Description" field — paste:

> An accessibility and orchestration layer for AI-driven development. From a 13-year-old kid to a 30-year veteran — same tool, adapted experience. Built on top of Spec Kit, OpenSpec, BMAD, gStack, and Ralph Loop.

Topics (Settings → About → topics) — add:

- `ai-coding`
- `agentic`
- `spec-driven-development`
- `bmad`
- `gstack`
- `claude-code`
- `make-my-dreams`

### Step 3 — Update local git remote

In your terminal, in the repo's working folder:

```bash
cd ~/Documents/extend-bmad   # or wherever the local folder lives
git remote set-url origin git@github.com:JN0V/make-my-dreams.git
git remote -v  # verify
```

(GitHub's automatic redirect means even without this step, `git push` would keep working — but it's cleaner to update.)

### Step 4 — Rename the local folder (optional but recommended)

```bash
cd ~/Documents
mv extend-bmad make-my-dreams
# Update Cowork workspace folder selection through the app UI:
# Settings → Workspace folder → select ~/Documents/make-my-dreams
```

If you have other tools/scripts pointing at the old path, update them at this point. The `install.sh` does not need any change (it defaults to `~/Documents/make-my-dreams` already).

### Step 5 — Verify

```bash
# In the renamed local folder:
cd ~/Documents/make-my-dreams
git status
git push                                              # should succeed
git fetch                                             # should succeed
git remote -v                                         # should show make-my-dreams URL
node bin/mmd.js --version                             # should print 0.1.0
node --test test/integration/ 2>&1 | tail -10        # 52/52 should pass
```

If all green, the rename is complete.

## Post-rename cleanup (optional, after a week or two)

- Update bookmarks, notes, Obsidian/Notion references pointing at the old name.
- Update any GitHub README badges that hard-code the old path (none currently, but worth checking after future additions).
- The GitHub redirect from `extend-bmad/*` will keep working indefinitely — no need to remove it.

## Rollback

If something breaks (extremely unlikely with GitHub's redirect mechanism), the rename is reversible: go back to Settings → Repository name → enter `extend-bmad` again.

---

*This procedure is the only manual step in MMD's setup that requires Sébastien's GitHub credentials. Recorded in `chore/repo-metadata` branch so it's not lost.*
