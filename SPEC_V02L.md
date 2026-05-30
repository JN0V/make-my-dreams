# Make My Dreams — v0.2.l Spec: Composer categorization + context-aware filtering

> Per L-018 — predictive capture by Sébastien before scale becomes painful. The v0.2.7 composer keyword-matches across the whole lessons file with no awareness of *what we're doing right now*. With 17 lessons this is fine; at 50+ the `topN=5` cap starts excluding genuinely-relevant lessons in favor of lexical-coincidence ones (the keyword "git" already collides across L-003/L-008/L-017). v0.2.l adopts the exact architecture the constitution adopted in v2.0: light per-item annotations (`Category` + `Applies to`) + a context-aware filter that runs *before* keyword matching. Backward-compatible by default (legacy callers passing no context get the v0.2.7 behavior). Mechanical migration of the 17 existing lessons takes minutes. After v0.2.l, the composer becomes scale-resilient: a session calling `mmd qa` doesn't pollute its prompt with brownfield-only lessons, and a brownfield discover call doesn't get spammed with ship-only ones.

---

## 1. Goal of v0.2.l

Deliver four coordinated changes:

1. **Per-lesson annotations** — `Category:` (comma-list, taxonomy) + `Applies to:` (comma-list of subcommand or `*`) added to the lessons file format. Parser-tolerant: missing fields → defaults (`uncategorized`, `*`). One-line addition per lesson.
2. **Context-aware composer** — `composeLessons(prompt, lessonsPath, { context })` filters by `Applies to` before keyword matching. Context is `{ subcommand: 'mmd --here' | 'mmd ship' | 'mmd qa' | 'mmd cso' | 'mmd document-release' | 'mmd unblock' | 'mmd discover', phase?: 'planning' | 'implementation' | 'review', engine?: 'fast' | 'standard' | 'deep' }`. Backward-compat: omitting `context` keeps the v0.2.7 full-file keyword-match-only behavior.
3. **Migration of the 17 existing lessons** — mechanical pass adding `Category` + `Applies to` to each. Documented taxonomy (see §5).
4. **Wiring** — `lib/invoke-autodev.js` passes `{ subcommand: "mmd --here", engine: <engine> }`; each `lib/skills/<name>/invoke-claude.js` passes `{ subcommand: "mmd <name>" }`; `lib/conductor/five-whys.js` passes `{ subcommand: "mmd unblock", phase: "review" }`. `bin/lessons.js`'s `match` subcommand gains a `--context <subcommand>` flag to introspect filtered output.

**Non-features** (deliberately deferred):
- Optional `lessons-bindings.yaml` (the explicit prefer-list mirroring `constitution-bindings.yaml`). Captured in L-018 §5 but not needed for the scale fix itself — defer to v0.2.l+ if usage shows the per-lesson `Applies to` annotation is too granular or too rigid.
- A "category tree" / hierarchy (e.g., `subprocess-control` → `subprocess-control.timeout`). Flat list in v0.2.l; folksonomy first, taxonomy later.
- Auto-classification of new lessons (the Documentalist v0.5b's job).
- `composer.json` schema bump to v2 — fields are added but the version stays `v0.2e` (additive, not breaking).

**Why this exists**: L-018 is the 5th L-009-pattern echo on a walking-skeleton scope. The composer's SPEC_V02E §4 deferred semantic matching and scoring — both genuinely big features — but never said "categorization is also deferred". That silent omission is the gap. v0.2.l closes it before pain, on the same model as the constitution did.

**Mission validation**: after v0.2.l, calling `mmd lessons match "<dream>"` with `--context mmd-qa` returns a STRICT subset of what `mmd lessons match "<dream>"` (no context) returns, AND every returned lesson's `Applies to` includes "mmd qa" or `*`. End-to-end: a `mmd qa` invocation's `composer.json` records `filtered_out_by_context: N, matched_by_keyword: M, injected: K` with K ≤ M ≤ (total_active − N).

---

## 2. Acceptance criteria (Given / When / Then)

### AC-1: Parser tolerates `Category:` / `Applies to:` fields

**Given** a lessons-learned.md with a mix of lessons (some with new fields, some without)
**When** `parseLessons(lessonsPath)` runs
**Then** each parsed lesson includes:
- `category: string[]` — list parsed from `**Category**:` line (split on comma, trimmed), or `["uncategorized"]` if the field is absent
- `appliesTo: string[]` — list parsed from `**Applies to**:` line (split on comma, trimmed), or `["*"]` if absent
- `keywords: string[]` — unchanged from v0.2.7
- All other existing fields unchanged

Tag: `@unit` exhaustive — present, absent, malformed, quoted commas, case-insensitive field names, fields after Keywords vs before, etc.

### AC-2: Context-aware filtering in composer

**Given** a parsed lessons set with mixed `Applies to` values + a context `{ subcommand: 'mmd qa' }`
**When** `composeLessons(prompt, lessonsPath, { context })` runs
**Then**:
- Pre-filter: only lessons whose `appliesTo` includes `'mmd qa'` OR `'*'` are considered for matching
- Keyword match runs on the filtered subset only
- topN cap applied as before on the matched subset
- Composer.json adds metrics: `filtered_out_by_context: N`, `matched_by_keyword: M`, `injected: K` (all integers, K ≤ M ≤ active − N)
- Without `context` (legacy call), full set is considered (backward-compat)

Tag: `@unit` with fixtures of varied `Applies to` values + multiple contexts. `@integration` against the live lessons file with each subcommand context.

### AC-3: All 17 existing lessons migrated

**Given** the live `docs/lessons-learned.md` post-v0.2.k merge
**When** v0.2.l's commit completes
**Then** every active lesson (status ≠ `promoted`) has a `**Category**:` and `**Applies to**:` line. The taxonomy is documented in `docs/adr/012-composer-categorization.md` (§5 of this spec). Migration mappings (proposed, auto-dev may refine):

| Lesson | Category | Applies to |
|---|---|---|
| L-001 | subprocess-control, observability | mmd --here, mmd ship, mmd qa, mmd cso, mmd document-release, mmd unblock |
| L-002 | subprocess-control, observability | mmd --here, mmd ship, mmd qa, mmd cso, mmd document-release, mmd unblock |
| L-003 | git, concurrency | mmd --here, mmd ship |
| L-004 | subprocess-control, definition-of-done | mmd --here |
| L-005 | testing, version-management | mmd --here |
| L-006 | subprocess-control, observability | mmd --here, mmd ship, mmd qa, mmd cso, mmd document-release, mmd unblock |
| L-007 | testing | mmd --here |
| L-008 | git | mmd --here, mmd ship |
| L-009 | design-vs-implementation, documentation | * |
| L-010 | reflexive-bootstrap, milestone | * |
| L-011 | reflexive-bootstrap, milestone | * |
| L-012 | pillar-audit, design-vs-implementation | * |
| L-013 | reflexive-bootstrap, milestone | * |
| L-014 | reflexive-bootstrap, milestone | * |
| L-015 | conductor, pre-conditions | mmd --here |
| L-016 | subprocess-control, prompt-engineering | mmd --here |
| L-017 | discover, scanner, testing | mmd discover |
| L-018 | composer, design-vs-implementation, scale | * |

Tag: `@unit` for the parser confirming each lesson now has both fields. `@integration` confirming the count of "uncategorized" lessons drops to 0.

### AC-4: Wiring — every claude -p spawn passes its context

**Given** v0.2.l's wiring changes are in place
**When** `mmd --here`, `mmd ship`, `mmd qa`, `mmd cso`, `mmd document-release`, `mmd unblock`, `mmd discover` invoke the composer
**Then** each passes its specific context. Specifically:
- `lib/invoke-autodev.js`: `{ subcommand: 'mmd --here', engine: <engine> }`
- `lib/skills/<name>/invoke-claude.js` (or `_common`): `{ subcommand: 'mmd <name>' }`
- `lib/conductor/five-whys.js`: `{ subcommand: 'mmd unblock', phase: 'review' }`
- `bin/discover.js`: `{ subcommand: 'mmd discover' }` (if/when discover calls composer — currently doesn't, but plumbing ready)

Tag: `@integration` for each wiring site, using a fake-claude that dumps the composer.json and asserts the recorded `context.subcommand` value.

### AC-5: `mmd lessons match --context <subcommand>` introspection

**Given** v0.2.l adds the `--context` flag to `mmd lessons match`
**When** the user runs `mmd lessons match "git checkout" --context mmd-qa`
**Then**:
- The matched output is a STRICT subset of `mmd lessons match "git checkout"` (no context)
- Each shown lesson's `Applies to` includes "mmd qa" or "*"
- A summary line shows: `Filtered N of M (context: mmd qa). Showing top K matched by keyword.`

Tag: `@integration` against the live lessons file.

### AC-6: Documentation + ADR

**Given** v0.2.l ships
**When** the user reads `README.md`, `docs/adr/012-composer-categorization.md`, and the relevant constitution module updates
**Then**:
- README's `### Lessons & composer` subsection gains a paragraph on the new `Category` / `Applies to` fields + the `--context` flag
- ADR-012 covers: why categorization mirrors constitution-bindings.yaml's per-context model (proven pattern), why annotation-on-lesson instead of separate bindings file (lower friction; bindings file is v0.2.l+ if needed), the taxonomy choices and how to extend it (folksonomy first, formalization later), the backward-compat rationale (no breaking change for legacy callers)
- `MAKE_MY_DREAMS.md` §6.5 (autolearning) gets a paragraph noting v0.2.l added scale-resilience

Tag: `@unit` for README/ADR anchor presence.

### AC-7: composer.json schema additions

**Given** any composer-augmented run completes
**When** the user inspects the run's `composer.json`
**Then** it contains the new fields:
- `context: { subcommand: string, phase?: string, engine?: string } | null` — the context arg
- `filtered_out_by_context: number` — count of lessons that didn't pass the `Applies to` filter (0 if no context)
- `matched_by_keyword: number` — count after keyword matching
- `injected: number` — count after topN cap (unchanged from v0.2.7)
- All existing fields preserved (additive bump)

Tag: `@unit` for the metrics, `@integration` for one full run per subcommand.

---

## 3. Architecture (incremental)

```
caller (mmd --here / mmd ship / mmd qa / ...)
   │ passes { subcommand, phase?, engine? }
   ▼
composeLessons(prompt, lessonsPath, { context })
   │
   ▼
[1] parseLessons(lessonsPath) — now extracts category + appliesTo
   │
   ▼
[2] filterByContext(lessons, context) — if context: keep lessons where appliesTo ∋ subcommand OR '*'
   │
   ▼
[3] matchByKeywords(filtered, prompt) — same as v0.2.7
   │
   ▼
[4] topN cap — same as v0.2.7
   │
   ▼
[5] composer.json — adds context + filtered_out_by_context + matched_by_keyword
```

### Project structure (additions/modifications)

```
make-my-dreams/
├── docs/
│   ├── lessons-learned.md                 # modified — 17 lessons get Category + Applies to
│   └── adr/
│       └── 012-composer-categorization.md # NEW
├── lib/
│   ├── composer/
│   │   ├── match.js                       # modified — accept context, run filter
│   │   ├── parse-lessons.js               # modified — extract category + appliesTo
│   │   ├── filter-by-context.js           # NEW — pure fn
│   │   └── format.js                      # unchanged (or minor — add category badge?)
│   ├── invoke-autodev.js                  # modified — passes context
│   ├── skills/_common/invoke-claude.js    # modified — passes context (subcommand from caller)
│   ├── conductor/five-whys.js             # modified — passes context
│   └── (rest unchanged)
├── bin/
│   └── lessons.js                         # modified — adds --context flag to match subcommand
└── test/
    ├── unit/
    │   ├── composer-parse-lessons-fields.test.js   # NEW
    │   ├── composer-filter-by-context.test.js      # NEW
    │   └── composer-match-with-context.test.js     # NEW
    └── integration/
        ├── composer-context-wiring.test.js         # NEW — one assertion per subcommand
        └── lessons-cmd-context.test.js             # NEW — --context flag e2e
```

---

## 4. Out of scope for v0.2.l

- ❌ `lessons-bindings.yaml` (separate prefer-list file mirroring constitution-bindings.yaml). Captured in L-018 §5. Add later if per-lesson annotation proves too granular.
- ❌ Category hierarchy / tree. Flat list in v0.2.l.
- ❌ Auto-classification of new lessons (v0.5b Documentalist).
- ❌ Semantic matching (still deferred per SPEC_V02E).
- ❌ Score weighting by category (e.g., "subprocess-control matters 2× when subcommand is mmd unblock"). All matches still scored by keyword overlap count.
- ❌ Promotion of a META-rule to `ai-coding.md` ("walking-skeleton specs must enumerate scale assumptions"). Captured in L-018 §"To promote if". v0.5b job.

---

## 5. Implementation hints (for auto-dev)

### Pre-implementation
1. Read this SPEC_V02L.md fully — authoritative.
2. Read L-018 in `docs/lessons-learned.md` for full context.
3. Read SPEC_V02E (composer original) + `lib/composer/match.js` + `lib/composer/parse-lessons.js` to understand current shape.
4. Read `.specify/memory/constitution-bindings.yaml` for the parallel pattern.

### Taxonomy reference (proposed — auto-dev may refine during AC-3 migration)

**Categories** (folksonomy, extendable): `subprocess-control`, `observability`, `git`, `concurrency`, `testing`, `version-management`, `definition-of-done`, `design-vs-implementation`, `documentation`, `reflexive-bootstrap`, `milestone`, `pillar-audit`, `conductor`, `pre-conditions`, `prompt-engineering`, `discover`, `scanner`, `composer`, `scale`.

**Applies-to values** (closed enum + `*`): `mmd --here`, `mmd ship`, `mmd qa`, `mmd cso`, `mmd document-release`, `mmd unblock`, `mmd discover`, `mmd lessons`, `mmd bench`, `mmd serve`, `any-claude-spawn`, `*`.

If a lesson genuinely applies to many subcommands, prefer listing them explicitly over `*` (more honest, lets future filtering work better).

### Key risks
- **Migration accuracy**: AC-3's table is *proposed* — auto-dev should READ each lesson's content and refine the `Category`/`Applies to` choice before applying. A wrong classification is a future composer miss.
- **Parser tolerance**: legacy lessons MUST keep working with no changes. Test with the pre-migration file as a regression fixture.
- **Wiring consistency**: AC-4 says every spawn site passes context. Easy to forget one. Add an assertion in each wiring site's test.

### Apply L-001..L-018
All standard. L-018 itself is the genesis — the meta-loop is closing again.

### Constitution module bindings
Active: universal, ai-coding, commit-git, testing, documentation, observability. Particularly observability — the new composer.json fields ARE observability data.

---

## 6. Definition of done

v0.2.l is done when:

1. All 7 ACs met.
2. Full test suite passes (current 880-910 from v0.2.k + new tests, expected ~920-960).
3. `mmd lessons match "any dream" --context mmd-qa` returns a strict subset of the un-contextualized version.
4. A live run of `mmd qa` produces a `composer.json` showing `filtered_out_by_context` > 0 (proving the filter actually fires).
5. All 17 lessons have `Category` + `Applies to` lines (grep verification).
6. README + ADR-012 in place.
7. `MAKE_MY_DREAMS.md` §6.5 paragraph noting v0.2.l delivered scale-resilience.
8. Version bumped to `0.2.10`.
9. Slice merged via `mmd ship` (or manual ff-only).
10. Ninth reflexive use of `mmd --here`. Composer will match L-018 + L-009/L-012/L-015/L-017 with high probability (all "walking-skeleton scope" pattern lessons) — should accelerate execution per the v0.2.j precedent.

---

*Spec v0.2.l — generated 2026-05-30 from L-018 (predictive capture). Ninth reflexive use of mmd --here. After v0.2.l lands, the composer is scale-resilient and the 5-time L-009-pattern echo is structurally closed for the lessons-system axis. Other axes (constitution already done; future scanners, parsers, registries) inherit the META-rule: "specs must enumerate scale assumptions in Out-of-scope".*
