// lib/documentalist/doc-refs.js — the Documentalist's code-artifact reference
// extractor (SPEC_V07B AC-1).
//
// SRP (universal.md §I.S): ONE job — given a doc's text, return the artifacts
// the doc CLAIMS exist (code file paths, `mmdream <subcommand>` mentions, `ADR-NNN`
// references, bare `lib/<module>` names), line-aware, deduped, tagged by kind.
// It gathers refs; it does NOT decide whether they resolve (conformance.js) nor
// render (coherence-report.js). Pure: text in, findings out — no I/O, no state.
//
// DISTINCT IN PURPOSE from the grounding extractor (lib/here-mode/extract-file-refs.js):
//   • That one is INPUT-focused — "which files does the user's dream reference,
//     so we can verify the launch base has them?" — and deliberately IGNORES
//     `.js`/`.ts` (a dream cites SPECs/docs, not source files).
//   • This one is the OPPOSITE — "which code artifacts does a doc ASSERT exist,
//     so we can verify they still do?" — and TARGETS source/doc files across
//     COMMON LANGUAGE EXTENSIONS + subcommands + ADR numbers + lib modules.
// Same surface (regex over text), opposite intent. They are not merged (their
// pattern sets and consumers differ); DRY is about logic, not coincidence.
//
// POLYGLOT BY DESIGN (constitution universal §VIII — technology-agnostic analysis):
// the file-path matcher is NOT JavaScript-only. It matches a doc reference to a
// code/doc file across common SOURCE extensions (js/ts/jsx/tsx/mjs/cjs, py, rs,
// go, java, rb, c/h/cpp/hpp/cc, cs, php, swift, kt, scala, md) under ANY
// top-level directory (src/, app/, pkg/, cmd/, internal/, …), not only the MMD
// lib/bin/test/docs layout. So on a Python/Rust/Go repo a doc citing src/foo.py
// or src/main.rs is now visible to the drift detector instead of silently
// invisible (the §VIII honesty gap that motivated this change). The MMD-specific
// patterns below (mmdream <subcommand>, ADR-NNN, bare lib/<module>) are conventions,
// not language-bound — they simply won't match on a non-MMD repo, which is right.
//
// PRECISION IS ENFORCED AT THE RESOLVE STEP, NOT HERE: a broadened path is only a
// CANDIDATE. conformance.js (checkArtifactConformance) validates each `file` ref
// against a real tracked repo file via the injected fileExistsFn and flags ONLY
// the ones that do NOT resolve (dangling). So a candidate that points at a real
// file is silently fine; only a genuinely-missing artifact is reported. That is
// why broadening recall here does not cry wolf — the oracle filters it.
//
// PRECISION-FIRST (SPEC §5.3, AC-4): a drift section that cries wolf is useless.
// When unsure whether a token is a real "claimed artifact", we lean toward NOT
// capturing it. Two conservative levers:
//   1. Fenced code blocks (``` … ```) are SKIPPED — they routinely hold
//      illustrative / future paths (architecture sketches, example output) that
//      the doc is NOT claiming exist now.
//   2. `mmdream <subcommand>` is captured ONLY inside inline code (backticks) — the
//      way MMD docs format a real command invocation. Bare prose ("we pulled it
//      from the spec") never yields a phantom `from` subcommand.
//
// NEVER THROWS (error-handling §III): non-string / empty input → [].

// --- Pattern set (each is line-local; line numbers come from the outer loop) ---

// Common source/doc file extensions (POLYGLOT — universal §VIII). Broadened from
// the original `js|md` so a doc on a Python/Rust/Go/TS/… repo gets its code
// references checked, not just a JS one. Order is irrelevant: the trailing
// `(?![\w])` lookahead forces the FULL extension (so `.cpp` is never matched as a
// short `.c` with a dangling `pp`, and `.html` matches none of these at all).
const SOURCE_EXT = 'js|ts|jsx|tsx|mjs|cjs|py|rs|go|java|rb|c|h|cpp|hpp|cc|cs|php|swift|kt|scala|md';

// A doc reference to a code/doc file: a path-like token with at least one
// DIRECTORY segment (a `/` before the filename) and one of the source/doc
// extensions, under ANY top-level directory (not only lib/bin/test/docs — §VIII).
//   • The leading lookbehind `(?<![\w./-])` prevents gluing onto a preceding
//     path/word char: `foo/lib/x.js` is not split mid-token, AND a leading-dot
//     directory like `.specify/memory/x.md` is NOT half-captured as a phantom
//     `specify/memory/x.md` (the char before `specify` is `.`, which the
//     lookbehind rejects) — a key precision guard against new false positives.
//   • The first char class `[A-Za-z0-9_-]` (no `.`/`/`) anchors the start on a
//     real segment, and the required `\/` enforces "has a directory segment" (a
//     bare `main.py` with no dir is NOT a code-artifact claim).
//   • A URL is not captured: the `:` after a scheme (`https:`) is not a path
//     char, so the token cannot start at `https`, and the `//` blocks a mid-URL
//     start via the lookbehind.
//   • The char class stops at the first `)`, backtick, quote, comma or space, so
//     trailing punctuation is never swallowed; the lazy `*?` + non-word lookahead
//     keep the path tight.
// These are CANDIDATES only — conformance.js resolves each against a real tracked
// file and flags ONLY the dangling ones (precision is enforced at resolve time).
const FILE_PATH = new RegExp(
  `(?<![\\w./-])([A-Za-z0-9_-][A-Za-z0-9_./-]*?\\/[A-Za-z0-9_./-]*?\\.(?:${SOURCE_EXT}))(?![\\w])`,
  'g',
);

// A source extension in a NON-FINAL segment (`…\.<ext>\/…`) means the token is not
// a real file path — a real path's only extension is terminal. This catches a
// slash-joined LIST of files written as prose (`CLAUDE.md/HANDOVER.md`,
// `kid.md/pro.md`): the matcher would otherwise read `CLAUDE.md` as a directory.
// Pure + language-agnostic precision guard (no false "X.md is a dir" claims).
const MIDPATH_EXT = new RegExp(`\\.(?:${SOURCE_EXT})\\/`);

// `ADR-NNN` reference. Captures the digits; the value is the parsed number so
// conformance can match it against inventory.adrs[].number regardless of how the
// doc zero-pads it (ADR-7 / ADR-007 → 7).
const ADR_REF = /\bADR-(\d{1,4})\b/g;

// Bare `lib/<module>` reference — a module/dir name, NOT a deeper file path. The
// trailing lookahead leaves `lib/conductor/notify.js` (a deeper path) and
// `lib/server.js` (a top-level file) to FILE_PATH, while capturing `lib/conductor`,
// `lib/here-mode`, and a sentence-final `lib/conductor.` (period, not extension):
//   • `(?!\.[A-Za-z])` rejects a file extension (`.js`/`.md`) but allows a plain
//     sentence period (`.` + space/EOL).
//   • `(?![\w/-])` rejects a deeper path (`/`), a word-char continuation, or a
//     trailing hyphen the name pattern didn't already consume.
const LIB_MODULE = /(?<![\w./-])lib\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?!\.[A-Za-z])(?![\w/-])/g;

// A path/ref carrying an obvious PLACEHOLDER token is illustrative, not a claim
// that the artifact exists: `docs/adr/0NN-slug.md`, `lib/<module>/x.js`, `XXX`.
// (HANDOVER.md literally documents the `0NN-slug.md` placeholder convention —
// flagging it as "missing" would be the extractor mis-reading instructions as a
// claim.) `N{2,}` / `X{2,}` catch the `NN`/`NNN`/`XXX` template runs; `[<>]`
// catches angle-bracket placeholders. Real MMD paths are lowercase-kebab.
const PLACEHOLDER = /[<>]|N{2,}|X{2,}/;

// Inline-code spans on a line (content between single backticks). We only look
// for subcommand invocations INSIDE these spans (precision lever #2).
const INLINE_CODE = /`([^`]+)`/g;
// A `mmdream <name>` invocation: the name must be subcommand-shaped (lowercase,
// hyphen-joined, ≥2 chars). A leading `-` (flag) or `"` (dream arg) is excluded
// by the `[a-z]` start, so `mmdream --here` and `mmdream "<dream>"` are NOT subcommands.
// Matches both the current `mmdream <sub>` and the legacy `mmdream <sub>` (kept so
// historical ADRs/lessons — which still say `mmd` — keep validating). `mmdream`
// is listed FIRST so it wins on `mmdream serve` (else `mmd` matches the prefix
// then fails on `ream`).
const MMD_SUBCMD = /\b(?:mmdream|mmd)\s+([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\b/g;

// A design doc frequently NAMES a command it is explicitly saying does NOT exist
// or is hypothetical/future: "no standalone `mmdream judge`", "No `mmdream init`", a
// "future `mmdream doctor`", "e.g. `mmdream context-save`", or a "v0.7.c — … `mmd
// document-compact`" plan. The doc is NOT claiming the artifact exists, so
// flagging it would be the crying-wolf the SPEC warns against. When one of these
// cues appears in the line text BEFORE the code span, we skip subcommand capture
// for that span. (A cue AFTER the mention — "`mmdream teleport` was never built" —
// does NOT suppress: that IS an affirmative dangling claim. Precision-first:
// suppress on a clear pre-mention not-a-claim cue, keep recall for plain refs.)
// The version cue matches a LETTERED sub-version plan marker ("v0.7.c", "v0.7c")
// but never a released "v0.7.0" (the letter slot needs an actual letter).
const SUBCOMMAND_NOT_A_CLAIM = /\b(?:no|not|never|future|planned|proposed|hypothetical|someday|eventually|rejected|removed|retired|deprecated|renamed)\b|e\.g\.|v\d+\.\d+(?:\.?[a-z])/i;

// A git commit-log line rendered inside a backtick span is `<hash> <subject>`: a
// 7-to-40 lowercase-hex commit hash, whitespace, then the human subject. HANDOVER.md
// auto-generates a recent-commits block of exactly these spans, and a subject like
// "rename command mmd to mmdream across all surfaces" would otherwise make MMD_SUBCMD
// read `mmdream across` (and `mmdream collision`, `mmdream global`, …) as phantom
// subcommands — which conformance.js then flags as false-positive dangling refs.
// A span that STARTS WITH a commit hash is a log entry, NOT a command the doc claims
// exists, so it yields NO subcommand reference. Precision holds in BOTH directions:
// a genuine invocation span (`mmdream serve`, `mmd serve`) never starts with a 7+ hex
// run, so recall is preserved (a real subcommand stem like `mmd`/`mmdream` is non-hex).
const COMMIT_LOG_SPAN = /^[0-9a-f]{7,40}\s/;

/**
 * Push a ref onto the accumulator (dedup is handled later, on the flat list).
 * @param {Array} acc
 * @param {{ ref: string, kind: string, line: number, value: any }} entry
 */
function add(acc, entry) {
  acc.push(entry);
}

/**
 * Extract the code artifacts a doc CLAIMS exist (AC-1). Pure, line-aware.
 *
 * @param {string} text the doc's full text
 * @returns {Array<{ ref: string, kind: 'file'|'subcommand'|'adr'|'lib-module', line: number, value: string|number }>}
 *   de-duplicated by `kind+value`, ordered by first appearance (line, then the
 *   order kinds are scanned). `[]` for empty / non-string input.
 */
export function extractDocRefs(text) {
  if (typeof text !== 'string' || text.length === 0) return [];

  const out = [];
  const lines = text.split('\n');
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;

    // A ``` (or ~~~) line toggles fenced-block state. The fence line itself is
    // not scanned. Everything between an open and close fence is skipped.
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Reset each global regex's lastIndex defensively (shared objects retain it).
    FILE_PATH.lastIndex = 0;
    let m;
    while ((m = FILE_PATH.exec(line)) !== null) {
      const p = m[1];
      if (PLACEHOLDER.test(p)) continue; // illustrative template path, not a claim
      if (MIDPATH_EXT.test(p)) continue; // slash-joined file list (`a.md/b.md`), not a path
      add(out, { ref: p, kind: 'file', line: lineNo, value: p });
    }

    ADR_REF.lastIndex = 0;
    while ((m = ADR_REF.exec(line)) !== null) {
      const num = Number(m[1]);
      const padded = `ADR-${String(num).padStart(3, '0')}`;
      add(out, { ref: padded, kind: 'adr', line: lineNo, value: num });
    }

    LIB_MODULE.lastIndex = 0;
    while ((m = LIB_MODULE.exec(line)) !== null) {
      const mod = m[1];
      add(out, { ref: `lib/${mod}`, kind: 'lib-module', line: lineNo, value: mod });
    }

    // Subcommands: only inside inline-code spans.
    INLINE_CODE.lastIndex = 0;
    let span;
    while ((span = INLINE_CODE.exec(line)) !== null) {
      const code = span[1];
      // Skip a span that is a git commit-log entry (`<hash> <subject>`) — its
      // subject text routinely mentions `mmd`/`mmdream` + a word, which is narration,
      // not a command claim (see COMMIT_LOG_SPAN).
      if (COMMIT_LOG_SPAN.test(code)) continue;
      // Skip a span whose preceding line text marks the command as not-a-claim
      // (negated / hypothetical / future) — see SUBCOMMAND_NOT_A_CLAIM.
      if (SUBCOMMAND_NOT_A_CLAIM.test(line.slice(0, span.index))) continue;
      MMD_SUBCMD.lastIndex = 0;
      let sm;
      while ((sm = MMD_SUBCMD.exec(code)) !== null) {
        const name = sm[1];
        // `ref` is the VERBATIM command as the doc wrote it (`mmd serve` in a
        // historical doc, `mmdream serve` in a current one) — never a hardcoded
        // prefix. `value` is the bare subcommand name conformance checks.
        add(out, { ref: sm[0], kind: 'subcommand', line: lineNo, value: name });
      }
    }
  }

  // Dedup by kind+value, keeping the first occurrence (earliest line). The push
  // order already follows line order, so a single forward pass preserves "first
  // line wins".
  const seen = new Set();
  const deduped = [];
  for (const r of out) {
    const key = `${r.kind}::${r.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  return deduped;
}
