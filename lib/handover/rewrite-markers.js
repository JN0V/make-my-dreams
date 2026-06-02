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
//
// v0.3.d: the rewriter is now parameterized over the marker PAIR so the exact
// same machinery serves `mmdream document-readme`'s two README blocks (Status +
// Changelog) — it passes its own `mmd:readme:status:*` / `mmd:readme:changelog:*`
// markers — while `mmdream handover` keeps calling it with the two-arg form and the
// default HANDOVER markers below (REUSE, not duplicate; SPEC_V03D §3).

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
 * @param {string} fileText  the current file contents (HANDOVER.md / README.md / …)
 * @param {string} block     the freshly-derived block (no surrounding markers)
 * @param {{ start: string, end: string }} [markers]  the marker pair to rewrite
 *        between. Defaults to the HANDOVER state markers so existing two-arg
 *        callers (`mmdream handover`) are unchanged.
 * @returns {{ ok: true, text: string } | { ok: false, missing: string[] }}
 */
export function rewriteMarkers(fileText, block, markers = { start: MARKER_START, end: MARKER_END }) {
  if (typeof fileText !== 'string') {
    throw new TypeError('rewriteMarkers: fileText must be a string');
  }
  if (typeof block !== 'string') {
    throw new TypeError('rewriteMarkers: block must be a string');
  }
  const start = markers && markers.start;
  const end = markers && markers.end;
  if (typeof start !== 'string' || typeof end !== 'string') {
    throw new TypeError('rewriteMarkers: markers must be { start: string, end: string }');
  }

  const startIdx = fileText.indexOf(start);
  const endIdx = fileText.indexOf(end);

  const missing = [];
  if (startIdx === -1) missing.push(start);
  if (endIdx === -1) missing.push(end);
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  // Out-of-order markers are as untrustworthy as a missing one — refuse rather
  // than produce a scrambled file. Report both so the user re-adds them cleanly.
  if (endIdx < startIdx) {
    return { ok: false, missing: [start, end] };
  }

  const head = fileText.slice(0, startIdx + start.length);
  const tail = fileText.slice(endIdx); // from the end marker onward (inclusive)
  return { ok: true, text: `${head}\n${block}\n${tail}` };
}
