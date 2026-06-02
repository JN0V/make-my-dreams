// lib/readme-sync/detect-drift.js — pure doc-drift detector (SPEC_V03D AC-5).
//
// SRP (universal.md §I.S): given the CLI's registered subcommands + top-level
// flags and the README text, return the ones the README does NOT mention. It is
// a PURE compare — no git, no fs, no I/O — so the AC-5 unit test drives it with
// plain strings, and the entry point feeds it the real SUBCOMMANDS + README.
//
// It is INFORMATIONAL only (the entry point prints the result on stdout, exit 0,
// and writes nothing to the README). The point is to surface the recurring
// doc-drift root cause (a new subcommand ships but the README never mentions it)
// at the cheapest possible moment, without ever touching the human prose.
//
// Matching rule (KISS): a subcommand/flag is "mentioned" iff its literal token
// appears as a substring of the README text. A subcommand is checked as the
// whole `mmdream <name>` invocation first, then as a bare `<name>` token, so a doc
// that writes ``mmdream qa`` or just mentions the `qa` skill both count as covered.
// Substring is deliberately permissive — drift detection should under-report
// (avoid false "undocumented" noise), not over-report.

/**
 * @param {{
 *   subcommands?: string[],   // e.g. argv-parser's SUBCOMMANDS
 *   flags?: string[],         // top-level flags incl. leading '--', e.g. '--here'
 *   readmeText?: string,
 * }} opts
 * @returns {{ subcommands: string[], flags: string[] }} the MISSING tokens
 */
export function detectDrift(opts) {
  const { subcommands = [], flags = [], readmeText = '' } = opts || {};
  const text = typeof readmeText === 'string' ? readmeText : '';

  const missingSubcommands = subcommands.filter((name) => {
    if (typeof name !== 'string' || name.length === 0) return false;
    // Covered if the README mentions `mmdream <name>` OR the bare token.
    return !text.includes(`mmdream ${name}`) && !text.includes(name);
  });

  const missingFlags = flags.filter((flag) => {
    if (typeof flag !== 'string' || flag.length === 0) return false;
    return !text.includes(flag);
  });

  return { subcommands: missingSubcommands, flags: missingFlags };
}
