---
id: pro-02-markdown-preview
audience: pro
complexity: moderate
dream: "a markdown editor with side-by-side live preview"
reality_check_min_assertions: 3
---

# pro-02 — Markdown editor with live preview

A markdown editor with side-by-side live preview. Exercises `<textarea>` input, a markdown renderer (vendored library or a small in-repo parser per constitution `kid.md` if the engine elects to avoid dependencies), and a synchronized split-pane layout. Pairs well with pro-01 for the v0 bench — both are "pro" patterns that surface bundler/dependency drift when the engine reaches for npm packages it shouldn't.
