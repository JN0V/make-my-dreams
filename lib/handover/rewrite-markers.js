// lib/handover/rewrite-markers.js — pure marker-bounded in-place rewriter
// (SPEC_V02P AC-3).
//
// SRP (universal.md §I.S): replace ONLY the text between the two state markers
// with a freshly-derived block, preserving every byte outside the markers
// exactly. It does not read or write files (the entry point owns I/O) and does
// not derive the block (build-state-block.js owns that) — it is a pure string
// transform, so the AC-3 unit test drives it with plain strings.
//
// The markers are the CONTRACT (SPEC §5 key risk): if either is absent the
// rewriter does NOT guess an insertion point. It returns { ok: false } and the
// caller exits non-zero and prints the block, instructing the user to add the
// markers where they want the State block (AC-3). This keeps the rewrite
// deterministic and safe — we never silently corrupt a hand-authored file.

export const MARKER_START = '<!-- mmd:handover:state:start -->';
export const MARKER_END = '<!-- mmd:handover:state:end -->';

/**
 * Rewrite the marker-bounded region of `fileText` with `block`.
 *
 * Contract:
 *   - Everything up to and INCLUDING the start marker is preserved byte-for-byte.
 *   - Everything from the end marker onward (INCLUDING it) is preserved
 *     byte-for-byte.
 *   - Between them the canonical form is `\n` + block + `\n`, so the markers
 *     keep their own lines and re-running with an identical block produces a
 *     byte-identical result (idempotency, AC-3).
 *   - If either marker is missing, or they appear out of order, returns
 *     { ok: false, missing } WITHOUT mutating anything.
 *
 * @param {string} fileText  the current HANDOVER.md contents
 * @param {string} block     the freshly-derived State block (no surrounding markers)
 * @returns {{ ok: true, text: string } | { ok: false, missing: string[] }}
 */
export function rewriteMarkers(fileText, block) {
  if (typeof fileText !== 'string') {
    throw new TypeError('rewriteMarkers: fileText must be a string');
  }
  if (typeof block !== 'string') {
    throw new TypeError('rewriteMarkers: block must be a string');
  }

  const startIdx = fileText.indexOf(MARKER_START);
  const endIdx = fileText.indexOf(MARKER_END);

  const missing = [];
  if (startIdx === -1) missing.push(MARKER_START);
  if (endIdx === -1) missing.push(MARKER_END);
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  // Out-of-order markers are as untrustworthy as a missing one — refuse rather
  // than produce a scrambled file. Report both so the user re-adds them cleanly.
  if (endIdx < startIdx) {
    return { ok: false, missing: [MARKER_START, MARKER_END] };
  }

  const head = fileText.slice(0, startIdx + MARKER_START.length);
  const tail = fileText.slice(endIdx); // from the end marker onward (inclusive)
  return { ok: true, text: `${head}\n${block}\n${tail}` };
}
