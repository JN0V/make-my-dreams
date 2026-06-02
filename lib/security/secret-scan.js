// lib/security/secret-scan.js — the PURE, language-agnostic secret detector
// (SPEC_V091 AC-1). The first Bundle A Security brick (MAKE_MY_DREAMS §6.6).
//
// `scanText(text, opts)` returns findings {rule, line, column, redactedMatch,
// confidence} for high-confidence secret formats (private keys, AWS access key
// ids, GitHub/Slack/Google tokens, JWTs) plus a generic high-entropy assignment
// heuristic. It is:
//   - PURE: no I/O, no globals, no time/random — deterministic. NEVER throws
//     (a non-string input → []), so a caller can scan untrusted bytes safely.
//   - LANGUAGE-AGNOSTIC (constitution universal §VIII): it scans TEXT. A `.py`,
//     `.rs`, `.env`, `.yaml`, `.txt` are all scanned the same — scanning text is
//     polyglot by nature, so this needs no per-language adapter (contrast the
//     Test Curator / import-graph, which parse language structure).
//   - REDACT-NEVER-ECHO (universal §VI + security.md least-disclosure): every
//     finding's `redactedMatch` shows only a few leading chars then asterisks —
//     the full secret is NEVER returned, logged, or printed.
//   - PRECISION-FIRST (secret scanners are a false-positive nightmare): obvious
//     placeholders/examples are skipped, an inline `mmd-secret-ok` allow-marker
//     on the same or preceding line suppresses a finding, and the generic
//     entropy rule is tuned (threshold + min length) so prose and base64 images
//     do not trip it. The format rules are `confidence: 'high'`; the generic
//     entropy heuristic is honestly `confidence: 'medium'` (the FP-prone one).
//
// Zero dependencies — regex + Shannon entropy only (no trufflehog, no new dep;
// the vanilla-stack bar, cf L-024).

/** Default Shannon-entropy threshold (bits/char) for the generic rule. A random
 * base64/hex secret sits ~4.5–6 bits/char; English prose ~3.5–4.2; so 4.0 keeps
 * prose and most natural text below the bar while catching real key material. */
export const DEFAULT_ENTROPY_THRESHOLD = 4.0;

/** Minimum length of a quoted value before the generic entropy rule considers
 * it. Short high-entropy strings (a hex color, a short id) are too common to
 * flag; real secrets are long. */
export const DEFAULT_MIN_GENERIC_LENGTH = 20;

/** The inline allow-marker. A comment containing this token on the SAME line as
 * a match, or on the line immediately BEFORE it, suppresses the finding — so a
 * known-safe fixture/example can be whitelisted in place. */
export const ALLOW_MARKER = 'mmd-secret-ok';

/** Substrings (case-insensitive) that mark a value as a placeholder/example, not
 * a real secret. AWS's own docs use `…EXAMPLE`; `your-token-here`/`changeme`/
 * `redacted` are the canonical "fill me in" stand-ins. Used for the FP-prone
 * generic rule (override via opts.placeholders). */
export const PLACEHOLDER_MARKERS = Object.freeze([
  'example', 'xxxx', '0000', 'your-token-here', 'redacted', 'changeme',
]);

/** Placeholder markers applied to HIGH-confidence FORMAT matches. Only the
 * "word" stand-ins that essentially never occur by chance inside a real random
 * token are here — `xxxx`/`0000` are DELIBERATELY excluded, because a genuine
 * AWS/GitHub key can contain `0000` or `xxxx` by chance, and suppressing it on
 * that basis would silently wave a real leak through the gate (a false negative
 * is far worse than a false positive for a format-precise rule). Fixtures that
 * happen to collide use the inline `mmd-secret-ok` allow-marker instead. */
const FORMAT_PLACEHOLDER_MARKERS = Object.freeze([
  'example', 'your-token-here', 'redacted', 'changeme',
]);

/** Stable rule ids (also the `rule` field on a finding). */
export const RULES = Object.freeze({
  PRIVATE_KEY: 'private-key',
  AWS_ACCESS_KEY_ID: 'aws-access-key-id',
  GITHUB_TOKEN: 'github-token',
  SLACK_TOKEN: 'slack-token',
  GOOGLE_API_KEY: 'google-api-key',
  JWT: 'jwt',
  GENERIC_HIGH_ENTROPY: 'generic-high-entropy',
});

/**
 * Shannon entropy in bits per character of `str` (0 for empty/non-string).
 * H = -Σ p(c)·log2 p(c) over the character frequency distribution. Pure.
 *
 * @param {string} str
 * @returns {number}
 */
export function shannonEntropy(str) {
  if (typeof str !== 'string' || str.length === 0) return 0;
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let entropy = 0;
  const len = str.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Redact a secret for display: keep a few leading chars (rule-identifying, e.g.
 * the `AKIA`/`ghp_` prefix) then a fixed run of asterisks. NEVER returns the
 * full value — at least the trailing portion is always masked, and at most a few
 * leading chars (capped at half the length for short values) are ever shown.
 *
 * @param {string} value
 * @param {{ lead?: number }} [opts]
 * @returns {string}
 */
export function redact(value, { lead = 4 } = {}) {
  if (typeof value !== 'string' || value.length === 0) return '';
  // Never reveal more than half of a short value; cap leading chars at `lead`.
  const visible = Math.max(1, Math.min(lead, Math.floor(value.length / 2)));
  const prefix = value.slice(0, visible);
  // A fixed-ish run of asterisks (3..8) — does not encode the exact length.
  const stars = '*'.repeat(Math.min(8, Math.max(3, value.length - visible)));
  return `${prefix}${stars}`;
}

/** Format-based detectors. Each owns a global regex; the captured token (group 1
 * when present, else the whole match) is the secret to redact/placeholder-check.
 * Ordered most-specific-first; all are `confidence: 'high'`. */
const FORMAT_RULES = Object.freeze([
  // A PEM private-key block header (RSA/EC/OPENSSH/DSA/PGP/generic). We report
  // the BEGIN marker (not the key body) — enough to locate it, and the redaction
  // keeps even that from echoing in full.
  {
    rule: RULES.PRIVATE_KEY,
    re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g,
  },
  // AWS access key id: AKIA + 16 uppercase letters/digits.
  {
    rule: RULES.AWS_ACCESS_KEY_ID,
    re: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  // GitHub personal-access / OAuth / server / refresh tokens: gh{p,o,s,r}_ + 36+
  // base62; plus the fine-grained github_pat_ form.
  {
    rule: RULES.GITHUB_TOKEN,
    re: /\bgh[posr]_[A-Za-z0-9]{36,255}\b/g,
  },
  {
    rule: RULES.GITHUB_TOKEN,
    re: /\bgithub_pat_[A-Za-z0-9_]{30,255}\b/g,
  },
  // Slack token: xox + a letter + a dash + the body.
  {
    rule: RULES.SLACK_TOKEN,
    re: /\bxox[a-zA-Z]-[A-Za-z0-9-]{8,}\b/g,
  },
  // Google API key: AIza + 35 base64url chars.
  {
    rule: RULES.GOOGLE_API_KEY,
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  // JWT: three base64url segments; the first decodes from `{"…` so it starts
  // with `eyJ`. Anchoring on `eyJ` keeps arbitrary dotted base64 from matching.
  {
    rule: RULES.JWT,
    re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
  },
]);

// Generic high-entropy assignment: an identifier that LOOKS secret-bearing
// (contains secret/password/token/api[_-]key/access[_-]key/client[_-]secret/
// auth/key) assigned a value, EITHER quoted (group 3) OR unquoted (group 4 — the
// canonical `.env` leak: KEY=value up to whitespace). `key` is intentionally
// last/loosest; the entropy gate is what makes it precise.
//
// ReDoS-safe: the identifier's surrounding char classes are BOUNDED ({0,64} /
// {0,32}) — an UNbounded `[A-Za-z0-9_]*` around the keyword caused O(n²)
// catastrophic backtracking on a long run of repeated keyword substrings (e.g. a
// 500 KB blob of "token"). `\b` only matches at word boundaries, so inside one
// giant word run the engine fails cheaply per position; the bound caps the
// prefix/suffix work to a constant per start. The value branches are bounded too.
// The UNQUOTED value branch (group 4) is deliberately a TIGHT secret charset —
// base64url/hex/standard-base64-minus-slash only (`[A-Za-z0-9_+=-]`). A real
// .env secret is a contiguous opaque token; code expressions on the RHS of `=`
// (`humanizeTokens(x)`, a `/\b(…)/` regex literal, `input.trim()`) contain `(`,
// `/`, `.` and are therefore NOT matched — that loose `[^\s'"]+` form flagged 15
// real-code false positives on MMD's own tree (precision-first). Residual: a
// standard-base64 secret containing `/` in an unquoted assignment is missed
// (documented; the quoted form and all format rules still catch it).
const GENERIC_ASSIGN_RE =
  /\b([A-Za-z0-9_]{0,64}(?:secret|password|passwd|pwd|api[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?token|token|apikey|authkey|key)[A-Za-z0-9_]{0,32})\s*[:=]\s*(?:(['"])([^'"\n]{1,4096})\2|([A-Za-z0-9_+=-]{20,4096}))/gi;

/**
 * Precompute the byte offset at which each line starts, so a match index can be
 * turned into a 1-based {line, column} in O(log n). Pure.
 */
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** Map an absolute index to {line, column} (both 1-based) via the line table. */
function locate(starts, index) {
  // Binary search for the greatest line start <= index.
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: index - starts[lo] + 1 };
}

/** True if the value is an obvious placeholder/example (case-insensitive). */
function isPlaceholder(value, placeholders) {
  const lower = value.toLowerCase();
  return placeholders.some((p) => lower.includes(p));
}

/** True if the allow-marker appears on `lineNo` (1-based) or the line before it. */
function allowMarked(lines, lineNo, marker) {
  const cur = lines[lineNo - 1];
  const prev = lineNo >= 2 ? lines[lineNo - 2] : '';
  return (cur && cur.includes(marker)) || (prev && prev.includes(marker));
}

/**
 * Scan `text` for secrets. PURE; never throws.
 *
 * @param {string} text
 * @param {{
 *   entropyThreshold?: number,   // bits/char for the generic rule
 *   minGenericLength?: number,   // min quoted-value length for the generic rule
 *   placeholders?: string[],     // case-insensitive placeholder substrings to skip
 *   allowMarker?: string,        // inline allow-marker token
 * }} [opts]
 * @returns {Array<{rule:string,line:number,column:number,redactedMatch:string,confidence:'high'|'medium'}>}
 *   sorted by (line, column); empty for a non-string / clean input.
 */
export function scanText(text, opts = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];

  const entropyThreshold =
    typeof opts.entropyThreshold === 'number' && Number.isFinite(opts.entropyThreshold)
      ? opts.entropyThreshold
      : DEFAULT_ENTROPY_THRESHOLD;
  const minGenericLength =
    typeof opts.minGenericLength === 'number' && opts.minGenericLength > 0
      ? opts.minGenericLength
      : DEFAULT_MIN_GENERIC_LENGTH;
  const placeholders = Array.isArray(opts.placeholders) ? opts.placeholders : PLACEHOLDER_MARKERS;
  const allowMarker = typeof opts.allowMarker === 'string' ? opts.allowMarker : ALLOW_MARKER;

  const starts = lineIndex(text);
  const lines = text.split('\n');
  const findings = [];

  const push = (rule, confidence, index, secret) => {
    const { line, column } = locate(starts, index);
    // HIGH-confidence format hits use the narrow word-only placeholder set so a
    // real key containing '0000'/'xxxx' is NOT silently suppressed (F2); the
    // FP-prone generic rule uses the full (overridable) set.
    const phSet = confidence === 'high' ? FORMAT_PLACEHOLDER_MARKERS : placeholders;
    if (isPlaceholder(secret, phSet)) return; // precision: example/placeholder
    if (allowMarked(lines, line, allowMarker)) return; // precision: whitelisted in place
    findings.push({ rule, line, column, redactedMatch: redact(secret), confidence });
  };

  // ── Format rules (high confidence) ──────────────────────────────────────
  for (const { rule, re } of FORMAT_RULES) {
    re.lastIndex = 0; // defensive: these are module-level /g regexes, reset state
    let m;
    while ((m = re.exec(text)) !== null) {
      const secret = m[1] !== undefined ? m[1] : m[0];
      push(rule, 'high', m.index, secret);
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard (never throws)
    }
  }

  // ── Generic high-entropy assignment (medium confidence) ─────────────────
  GENERIC_ASSIGN_RE.lastIndex = 0;
  let g;
  while ((g = GENERIC_ASSIGN_RE.exec(text)) !== null) {
    // The value is either the quoted capture (group 3) or the unquoted one
    // (group 4 — the `.env` KEY=value form). Guard against a degenerate empty match.
    const value = g[3] !== undefined ? g[3] : g[4];
    if (value === undefined || value.length === 0) {
      if (g.index === GENERIC_ASSIGN_RE.lastIndex) GENERIC_ASSIGN_RE.lastIndex++;
      continue;
    }
    // The match index points at the identifier; the secret is the value.
    // Report the value's column (where the secret begins) for usefulness.
    const valueIndex = g.index + g[0].lastIndexOf(value);
    if (
      value.length >= minGenericLength &&
      // Precision: a `${…}` value is a template interpolation / variable
      // reference (code), never a literal secret — skip it (dogfood-surfaced FP).
      !value.includes('${') &&
      shannonEntropy(value) >= entropyThreshold
    ) {
      push(RULES.GENERIC_HIGH_ENTROPY, 'medium', valueIndex, value);
    }
    if (g.index === GENERIC_ASSIGN_RE.lastIndex) GENERIC_ASSIGN_RE.lastIndex++;
  }

  findings.sort((a, b) => (a.line - b.line) || (a.column - b.column) || a.rule.localeCompare(b.rule));
  return findings;
}
