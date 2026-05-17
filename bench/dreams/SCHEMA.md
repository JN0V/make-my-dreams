# Dream-bench dream-file schema (reference)

> Loaded by `lib/bench/load-dreams.js`. Each `bench/dreams/<id>.md` MUST conform to this schema. Validation failure aborts the bench run with exit code 2.

## Front matter (YAML-lite)

A dream file begins with a `---`-delimited front-matter block. The parser accepts only the keys below; unknown keys are ignored. All keys are REQUIRED unless noted.

| Key | Type | Description |
|-----|------|-------------|
| `id` | string | Stable identifier. MUST equal the file basename (without `.md`). Lowercase, `[a-z0-9-]+`. |
| `audience` | `kid` \| `pro` | Drives expected complexity floor and tone of the generated PWA. |
| `complexity` | `trivial` \| `simple` \| `moderate` | Coarse estimate used to interpret duration / cost outliers. |
| `dream` | string | The natural-language dream description passed to auto-dev verbatim. Single line preferred. |
| `reality_check_min_assertions` | integer >= 1 | The minimum number of reality-check assertions the harness expects to see. Documentation-only in v0.2b — the v0 bench does not enforce this number; v0.2b+ may. |

## Body

After the front-matter block, the body MAY contain free-form Markdown explaining the dream's intent, the kinds of regressions it is designed to surface, and links to past runs. The body is informational; the bench harness ignores it.

## Example

```markdown
---
id: kid-01-drawing-camera-overlay
audience: kid
complexity: moderate
dream: "a drawing app that overlays an image on the camera feed"
reality_check_min_assertions: 3
---

# kid-01 — Drawing camera overlay

The v0.1 fil-rouge dream. Exercises `getUserMedia`, the Canvas API, the gesture-gated permission flow, and the offline manifest.
```

## Why this schema is small

KISS (constitution §II): the v0.2b harness only needs enough metadata to (a) filter dreams by id (`--dreams`), (b) decide which engine flag to pass to auto-dev (none yet — engine is global per run), and (c) annotate the aggregate report. Adding fields here couples future runs to today's interpretation — DRY pressure (§III) without proven need. Extension hooks (e.g. `expected_artifacts`, `cost_budget_seconds`) are explicitly deferred to v0.2b+ when the autolearning loop §6.5 surfaces a real reason.
