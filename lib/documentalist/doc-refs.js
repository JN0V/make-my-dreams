// lib/documentalist/doc-refs.js — the Documentalist's code-artifact reference
// extractor (SPEC_V07B AC-1).
//
// SRP (universal.md §I.S): ONE job — given a doc's text, return the artifacts
// the doc CLAIMS exist (code file paths, `mmd <subcommand>` mentions, `ADR-NNN`
// references, bare `lib/<module>` names), line-aware, deduped, tagged by kind.
// It gathers refs; it does NOT decide whether they resolve (conformance.js) nor
// render (coherence-report.js). Pure: text in, findings out — no I/O, no state.
//
// DISTINCT IN PURPOSE from the grounding extractor (lib/here-mode/extract-file-refs.js):
//   • That one is INPUT-focused — "which files does the user's dream reference,
//     so we can verify the launch base has them?" — and deliberately IGNORES
//     `.js`/`.ts` (a dream cites SPECs/docs, not source files).
//   • This one is the OPPOSITE — "which code artifacts does a doc ASSERT exist,
//     so we can verify they still do?" — and TARGETS `.js`/`.md` source +
//     subcommands + ADR numbers + lib modules.
// Same surface (regex over text), opposite intent. They are not merged (their
// pattern sets and consumers differ); DRY is about logic, not coincidence.
//
// PRECISION-FIRST (SPEC §5.3, AC-4): a drift section that cries wolf is useless.
// When unsure whether a token is a real "claimed artifact", we lean toward NOT
// capturing it. Two conservative levers:
//   1. Fenced code blocks (``` … ```) are SKIPPED — they routinely hold
//      illustrative / future paths (architecture sketches, example output) that
//      the doc is NOT claiming exist now.
//   2. `mmd <subcommand>` is captured ONLY inside inline code (backticks) — the
//      way MMD docs format a real command invocation. Bare prose ("we pulled it
//      from the spec") never yields a phantom `from` subcommand.
//
// NEVER THROWS (error-handling §III): non-string / empty input → [].

// --- Pattern set (each is line-local; line numbers come from the outer loop) ---

// Code file paths under lib/ bin/ test/ docs/ ending in .js or .md. The leading
// lookbehind prevents gluing onto a preceding path/word char (so `foo/lib/x.js`
// is not split mid-token); the char class stops at the first `)`, backtick,
// quote, comma or space, so trailing punctuation is never swallowed.
const FILE_PATH = /(?<![\w./-])((?:lib|bin|test|docs)\/[A-Za-z0-9_./-]*?\.(?:js|md))(?![\w])/g;

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

// Inline-code spans on a line (content between single backticks). We only look
// for subcommand invocations INSIDE these spans (precision lever #2).
const INLINE_CODE = /`([^`]+)`/g;
// A `mmd <name>` invocation: the name must be subcommand-shaped (lowercase,
// hyphen-joined, ≥2 chars). A leading `-` (flag) or `"` (dream arg) is excluded
// by the `[a-z]` start, so `mmd --here` and `mmd "<dream>"` are NOT subcommands.
const MMD_SUBCMD = /\bmmd\s+([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\b/g;

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
      MMD_SUBCMD.lastIndex = 0;
      let sm;
      while ((sm = MMD_SUBCMD.exec(code)) !== null) {
        const name = sm[1];
        add(out, { ref: `mmd ${name}`, kind: 'subcommand', line: lineNo, value: name });
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
