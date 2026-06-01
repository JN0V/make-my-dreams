// lib/onboarding/cheatsheet.js — the operational cheat-sheet a third party needs
// once MMD is set up in their repo.
//
// SRP (universal.md §I.S): a single PURE string builder — no I/O, no env reads,
// no formatting state. The caller (setup.js) decides WHEN to print it (once,
// after a successful first-run setup); this module decides only WHAT it says.
//
// Spec: SPEC_V06A AC-4. The rules below are the tribal knowledge that was never
// written down: the timeout that keeps a real slice from being killed, the
// dream directive that stops the spec-polishing loop, the commit cadence that
// protects work-in-progress, and the three opt-in switches. Per universal §VII
// every code/flag is paired with a plain-language one-liner so the cheat-sheet
// is comprehensible to a human first.

/**
 * Build the human-readable onboarding cheat-sheet.
 *
 * Pure: same output every call, no side effects. Unit-testable in isolation.
 *
 * @returns {string} a multi-line block ready to print to stdout
 */
export function buildOnboardingCheatsheet() {
  const lines = [
    'MMD is set up in this repo. A few operational rules worth knowing:',
    '',
    'Running a real slice (`mmd --here "<change>"`):',
    '  • MMD_TIMEOUT_MS=0   — disable the 30-min default timeout for real',
    '                         implementation slices, or auto-dev gets killed',
    '                         mid-pipeline (only the trivial/--fast path is safe',
    '                         under the default).',
    '  • Dream directive    — when you hand MMD a frozen spec, say it plainly:',
    '                         "SPEC IS FROZEN, do NOT edit it. Go DIRECTLY to',
    '                         implementation." It short-circuits the endless',
    '                         spec-polishing loop.',
    '  • Commit per AC      — commit incrementally, one commit per acceptance',
    '                         criterion. Uncommitted work that a crash wipes did',
    '                         not exist; small commits keep the slice recoverable.',
    '',
    'Opt-in switches (off by default — your normal run is unchanged):',
    '  • --sealed           — an independent tester writes blind acceptance tests',
    '                         that auto-dev cannot edit; the slice fails if they',
    '                         are weakened or deleted.',
    '  • --monitor          — watch the orchestrator\'s context fill up live and',
    '                         signal at 70% (ready for handoff).',
    '  • MMD_NOTIFY_URL=…    — POST a small JSON to your own sink (ntfy/Slack/…)',
    '                         when a detached run finishes or fails.',
  ];
  return lines.join('\n');
}
