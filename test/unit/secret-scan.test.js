// test/unit/secret-scan.test.js — @unit coverage for the PURE secret detector
// (SPEC_V091 AC-1). Tagged @unit.
//
// IMPORTANT (self-scan hygiene): every real-looking secret is assembled at
// RUNTIME by concatenation, so no contiguous secret token ever appears as a
// literal in this source file. That means running `mmd secret-scan` on MMD
// itself stays clean — this test file plants nothing the scanner can match in
// its own bytes (the format regexes need the prefix glued to the body, and the
// generic rule needs a secret-like identifier assigned a long quoted value,
// neither of which survives the `+` splits below).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scanText,
  shannonEntropy,
  redact,
  RULES,
  PLACEHOLDER_MARKERS,
  ALLOW_MARKER,
  DEFAULT_ENTROPY_THRESHOLD,
} from '../../lib/security/secret-scan.js';

// ── Secret builders (split so the literal token never appears in source) ─────
const awsKeyId = () => 'AKIA' + 'ABCD1234EFGH5678'; // AKIA + 16
const ghpToken = () => 'ghp_' + 'wxyz0123456789abcdefghijABCDEFGHIJKL'; // ghp_ + 36
const ghoToken = () => 'gho_' + 'wxyz0123456789abcdefghijABCDEFGHIJKL';
const ghsToken = () => 'ghs_' + 'wxyz0123456789abcdefghijABCDEFGHIJKL';
const ghrToken = () => 'ghr_' + 'wxyz0123456789abcdefghijABCDEFGHIJKL';
const githubPat = () => 'github_pat_' + '11ABCDE0a' + 'bcdefghijklmnopqrstuvwxyz0123';
const slackToken = () => 'xox' + 'b-' + '1234567890-abcdefABCDEF';
const googleKey = () => 'AIza' + 'Sy0123456789abcdefABCDEF_-ghIJKLMNop'.slice(0, 35);
const jwtToken = () => 'eyJ' + 'hbGciOiJIUzI1Ni_-.eyJzdWIiOiIxMjM0NQ.SflKxwRJSMeKKF2Q';
const privateKey = () => '-----BEGIN ' + 'RSA PRIVATE KEY-----';
const openSshKey = () => '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----';
const highEntropyVal = () => 'k3Jx9Qp2Lm7Vn4Rt8Wz1Yb6Dc0Fg5Hh'; // 32 chars, ~5 bits/char

// ── shannonEntropy ───────────────────────────────────────────────────────────
test('@unit shannonEntropy is 0 for empty / non-string', () => {
  assert.equal(shannonEntropy(''), 0);
  assert.equal(shannonEntropy(undefined), 0);
  assert.equal(shannonEntropy(null), 0);
  assert.equal(shannonEntropy(42), 0);
});

test('@unit shannonEntropy: random base64 beats English prose beats a repeated char', () => {
  const repeated = shannonEntropy('aaaaaaaaaaaaaaaaaaaa');
  const prose = shannonEntropy('the quick brown fox jumps over a lazy dog');
  const random = shannonEntropy(highEntropyVal());
  assert.equal(repeated, 0);
  assert.ok(prose > repeated);
  assert.ok(random > prose, `expected ${random} > ${prose}`);
  assert.ok(random >= DEFAULT_ENTROPY_THRESHOLD);
});

// ── redact ───────────────────────────────────────────────────────────────────
test('@unit redact shows a few leading chars then asterisks, never the full value', () => {
  const secret = ghpToken();
  const r = redact(secret);
  assert.ok(r.includes('*'), 'must contain asterisks');
  assert.ok(!r.includes(secret), 'must not echo the full secret');
  assert.ok(secret.startsWith(r.replace(/\*+$/, '')), 'leading chars must be a real prefix');
  assert.ok(r.replace(/\*+$/, '').length <= 4, 'shows at most a few leading chars');
});

test('@unit redact never reveals more than half of a short value', () => {
  assert.equal(redact(''), '');
  const short = 'ab';
  const r = redact(short);
  assert.ok(!r.includes(short));
  assert.ok(r.startsWith('a'));
});

// ── format rules: each secret format is caught with the right rule ───────────
const FORMAT_CASES = [
  ['AWS access key id', awsKeyId(), RULES.AWS_ACCESS_KEY_ID],
  ['GitHub ghp_ token', ghpToken(), RULES.GITHUB_TOKEN],
  ['GitHub gho_ token', ghoToken(), RULES.GITHUB_TOKEN],
  ['GitHub ghs_ token', ghsToken(), RULES.GITHUB_TOKEN],
  ['GitHub ghr_ token', ghrToken(), RULES.GITHUB_TOKEN],
  ['GitHub fine-grained PAT', githubPat(), RULES.GITHUB_TOKEN],
  ['Slack token', slackToken(), RULES.SLACK_TOKEN],
  ['Google API key', googleKey(), RULES.GOOGLE_API_KEY],
  ['JWT', jwtToken(), RULES.JWT],
  ['RSA private key', privateKey(), RULES.PRIVATE_KEY],
  ['OpenSSH private key', openSshKey(), RULES.PRIVATE_KEY],
];

for (const [label, secret, expectedRule] of FORMAT_CASES) {
  test(`@unit detects ${label} with rule ${expectedRule} and a redacted match`, () => {
    const findings = scanText(`const x = "${secret}";`);
    const hit = findings.find((f) => f.rule === expectedRule);
    assert.ok(hit, `expected a ${expectedRule} finding, got ${JSON.stringify(findings)}`);
    assert.equal(hit.confidence, 'high');
    assert.ok(hit.line >= 1 && hit.column >= 1);
    // REDACTION NEVER ECHOES THE FULL VALUE (the headline security property).
    assert.ok(!hit.redactedMatch.includes(secret), 'redactedMatch must not echo the secret');
    assert.ok(hit.redactedMatch.includes('*'));
  });
}

// ── generic high-entropy assignment (medium confidence) ──────────────────────
test('@unit flags a generic high-entropy secret-like assignment as medium', () => {
  const findings = scanText(`apiKey = "${highEntropyVal()}"`);
  const hit = findings.find((f) => f.rule === RULES.GENERIC_HIGH_ENTROPY);
  assert.ok(hit, `expected a generic finding, got ${JSON.stringify(findings)}`);
  assert.equal(hit.confidence, 'medium');
  assert.ok(!hit.redactedMatch.includes(highEntropyVal()));
});

test('@unit generic rule fires for several secret-like identifiers', () => {
  for (const id of ['password', 'client_secret', 'access_key', 'auth_token', 'API_TOKEN']) {
    const findings = scanText(`${id} = "${highEntropyVal()}"`);
    assert.ok(
      findings.some((f) => f.rule === RULES.GENERIC_HIGH_ENTROPY),
      `expected ${id} assignment to flag`,
    );
  }
});

// ── PRECISION: placeholders are NOT flagged ──────────────────────────────────
test('@unit does NOT flag obvious placeholders / example values', () => {
  // AWS's canonical doc key literally ends in EXAMPLE — must be skipped.
  assert.deepEqual(scanText('aws = "AKIA' + 'IOSFODNN7EXAMPLE"'), []);
  for (const marker of PLACEHOLDER_MARKERS) {
    const findings = scanText(`apiKey = "${marker}${marker}${marker}${marker}${marker}value"`);
    assert.deepEqual(findings, [], `placeholder '${marker}' must not flag`);
  }
});

test('@unit does NOT flag a your-token-here style generic value', () => {
  assert.deepEqual(scanText('token = "your-token-here-please-replace"'), []);
});

// ── PRECISION: allow-marker suppresses (same line and preceding line) ────────
test('@unit an inline mmd-secret-ok marker on the SAME line suppresses the finding', () => {
  const text = `const k = "${awsKeyId()}"; // ${ALLOW_MARKER} known fixture`;
  assert.deepEqual(scanText(text), []);
});

test('@unit an mmd-secret-ok marker on the PRECEDING line suppresses the finding', () => {
  const text = `// ${ALLOW_MARKER}\nconst k = "${awsKeyId()}";`;
  assert.deepEqual(scanText(text), []);
});

test('@unit the allow-marker does NOT suppress a secret two lines later', () => {
  const text = `// ${ALLOW_MARKER}\n\nconst k = "${awsKeyId()}";`;
  const findings = scanText(text);
  assert.ok(findings.some((f) => f.rule === RULES.AWS_ACCESS_KEY_ID));
});

// ── PRECISION: prose / base64 images / low-entropy do not trip ───────────────
test('@unit does NOT flag ordinary prose or markdown', () => {
  const prose =
    'The quick brown fox jumps over the lazy dog. This is a sentence about ' +
    'tokens and passwords in the abstract, with no actual key assigned anywhere.';
  assert.deepEqual(scanText(prose), []);
});

test('@unit does NOT flag a base64 image data URI (not a secret-like assignment)', () => {
  const img =
    'background: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")';
  assert.deepEqual(scanText(img), []);
});

test('@unit does NOT flag a low-entropy secret-like assignment (precision)', () => {
  assert.deepEqual(scanText('password = "aaaaaaaaaaaaaaaaaaaaaa"'), []);
});

test('@unit does NOT flag a ${...} template interpolation as a secret (precision)', () => {
  // A secret-like identifier assigned a template-literal interpolation is code,
  // not a literal secret (dogfood-surfaced FP in our own note strings).
  assert.deepEqual(scanText("secretLabel = `MMD_SECRET='${env.MMD_SECRET_VALUE}'`"), []);
});

// ── line / column accuracy ───────────────────────────────────────────────────
test('@unit reports the correct 1-based line for a match on line 3', () => {
  const text = `line one\nline two\nconst k = "${awsKeyId()}";`;
  const hit = scanText(text).find((f) => f.rule === RULES.AWS_ACCESS_KEY_ID);
  assert.equal(hit.line, 3);
  assert.ok(hit.column >= 1);
});

// ── F2 regression: a real format key containing filler chars is NOT suppressed ─
test('@unit a real AWS key containing 0000 / xxxx is still flagged (no false negative)', () => {
  // '0000' and 'xxxx' occur by chance in real random keys — suppressing a
  // format hit on them would silently wave a leak through the gate.
  for (const body of ['0000ABCDEFGHIJKL', 'XXXX1234ABCD5678']) {
    const findings = scanText(`key = "AKIA${body}"`);
    assert.ok(
      findings.some((f) => f.rule === RULES.AWS_ACCESS_KEY_ID),
      `AKIA${body} must still be flagged`,
    );
  }
  // …but the documented '…EXAMPLE' fake is still skipped.
  assert.deepEqual(scanText('key = "AKIA' + 'IOSFODNN7EXAMPLE"'), []);
});

// ── F3: unquoted .env-style assignments are detected ─────────────────────────
test('@unit flags an unquoted secret-like .env assignment (KEY=value)', () => {
  const findings = scanText(`API_SECRET=${highEntropyVal()}`);
  assert.ok(findings.some((f) => f.rule === RULES.GENERIC_HIGH_ENTROPY), JSON.stringify(findings));
});

// ── F1/F4 regression: no catastrophic backtracking on repeated keyword runs ───
test('@unit completes quickly on a long repeated-keyword run (no ReDoS)', () => {
  // The pathological input class for the generic rule: many keyword substrings,
  // no '=' terminator. With unbounded quantifiers this was O(n²) and hung past
  // 60s on ~500 KB. Bounded quantifiers must keep it well under budget.
  const start = process.hrtime.bigint();
  assert.doesNotThrow(() => scanText('token'.repeat(200000))); // ~1 MB
  assert.doesNotThrow(() => scanText('apikey'.repeat(150000)));
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 1000, `expected < 1000 ms, took ${ms.toFixed(0)} ms`);
});

// ── purity / never throws ────────────────────────────────────────────────────
test('@unit is pure and never throws on odd input', () => {
  assert.deepEqual(scanText(undefined), []);
  assert.deepEqual(scanText(null), []);
  assert.deepEqual(scanText(123), []);
  assert.deepEqual(scanText(''), []);
  // a huge low-information string must not throw or hang pathologically
  assert.doesNotThrow(() => scanText('x'.repeat(50000)));
});

test('@unit a clean file yields no findings', () => {
  const clean = 'export function add(a, b) {\n  return a + b;\n}\n';
  assert.deepEqual(scanText(clean), []);
});

test('@unit findings are sorted by (line, column)', () => {
  const text = `a = "${ghpToken()}"\nb = "${awsKeyId()}"`;
  const findings = scanText(text);
  for (let i = 1; i < findings.length; i++) {
    const prev = findings[i - 1];
    const cur = findings[i];
    assert.ok(prev.line < cur.line || (prev.line === cur.line && prev.column <= cur.column));
  }
});
