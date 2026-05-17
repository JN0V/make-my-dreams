# `bench/runs/` — generated bench output

> This directory holds the output of every `mmd bench` invocation. Each run produces a subdirectory named `<run-id>/`, where `<run-id>` is `YYYY-MM-DDTHH-MM-SS-<short-suffix>`. The whole tree is `.gitignore`d except this README.

## Layout

```
bench/runs/
├── README.md                          # this file (tracked)
├── latest/                            # symlink to the most recent <run-id>
└── <run-id>/
    ├── summary.json                   # machine-readable aggregate (AC-5)
    ├── report.md                      # human-readable aggregate (AC-5)
    └── <dream-id>/
        ├── metrics.json               # per-dream metrics (AC-4)
        ├── run.log                    # subprocess stdout/stderr capture
        ├── screenshot.png             # reality-check screenshot (or stub in --dry-run)
        └── demo/<slug>/               # the isolated working dir auto-dev modified
```

## Cleanup

Each real run materializes one full PWA plus screenshots plus logs per dream — typically tens to hundreds of megabytes. There is no automatic GC in v0.2b. Recommended hygiene:

```bash
# Keep only the 3 most recent runs:
ls -1dt bench/runs/*/ | tail -n +4 | xargs -r rm -rf
```

The `latest/` symlink always points to the freshest run, so referencing it from scripts is safe even after older runs are pruned.

## See also

- [`bench/dreams/SCHEMA.md`](../dreams/SCHEMA.md) — front-matter schema for the 5 canonical dreams
- [`docs/adr/006-dream-bench-v0-design.md`](../../docs/adr/006-dream-bench-v0-design.md) — why these 5 dreams, why sequential, why deterministic report
- [`SPEC_V02B.md`](../../SPEC_V02B.md) — the spec that shipped this harness
