// @unit tests for lib/conductor/expectation.js — the frozen-expectation oracle
// (v0.17.a, SPEC_V017A AC-1). The pure builder + the write-once writer are
// asserted with a FAKE fs (no real disk), mirroring the rest of the conductor's
// pure-core / injected-edge shape. NEVER throws on odd input; never overwrites.
//
// NOTE on placement: the unit suite glob is `test/unit/*.test.js` (flat), so this
// file lives at test/unit/expectation.test.js (NOT test/unit/conductor/…) to be
// actually executed by `npm test` (§V verification — a test the runner skips is
// no test at all).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildExpectationContent,
  writeExpectation,
  resolveAlignmentAnchor,
} from '../../lib/conductor/expectation.js';

// ── buildExpectationContent (PURE) ───────────────────────────────────────────

test('@unit AC-1: buildExpectationContent embeds the dream verbatim under the frozen header', () => {
  const out = buildExpectationContent('build a counter app', undefined);
  assert.match(out, /# Original expectation \(frozen oracle — do NOT edit\)/);
  assert.match(out, /Immutable — this file is the alignment oracle/);
  assert.match(out, /## Original dream/);
  assert.match(out, /build a counter app/);
  // No scope section when no scope.
  assert.doesNotMatch(out, /## Dream-Catcher scope/);
});

test('@unit AC-1: buildExpectationContent includes the Dream-Catcher scope section when present', () => {
  const out = buildExpectationContent('original ask', 'refined scope text');
  assert.match(out, /original ask/);
  assert.match(out, /## Dream-Catcher scope \(if present\)/);
  assert.match(out, /refined scope text/);
});

test('@unit AC-1: buildExpectationContent never throws on empty/odd inputs', () => {
  assert.doesNotThrow(() => buildExpectationContent());
  assert.doesNotThrow(() => buildExpectationContent(null, null));
  assert.doesNotThrow(() => buildExpectationContent(42, {}));
  const out = buildExpectationContent('', '');
  // Degrades gracefully: header is still present, no scope section on empty scope.
  assert.match(out, /## Original dream/);
  assert.doesNotMatch(out, /## Dream-Catcher scope/);
});

// ── writeExpectation (write-once, injected fs) ───────────────────────────────

function fakeFs(initial = {}) {
  const files = { ...initial };
  return {
    files,
    deps: {
      fs: {
        writeFileSync(p, content) {
          files[p] = content;
        },
      },
      existsSync(p) {
        return Object.prototype.hasOwnProperty.call(files, p);
      },
    },
  };
}

test('@unit AC-1: writeExpectation writes the oracle once → { written: true }', () => {
  const { files, deps } = fakeFs();
  const res = writeExpectation('/shared', 'my dream', undefined, deps);
  assert.equal(res.written, true);
  const target = path.join('/shared', 'expectation.md');
  assert.ok(files[target], 'expectation.md written to the shared dir');
  assert.match(files[target], /my dream/);
});

test('@unit AC-1: writeExpectation is a NO-OP when expectation.md already exists (immutable, resume-safe)', () => {
  const target = path.join('/shared', 'expectation.md');
  const { files, deps } = fakeFs({ [target]: '# Original expectation\nfirst ask\n' });
  const res = writeExpectation('/shared', 'a DIFFERENT later ask', 'scope', deps);
  assert.equal(res.written, false);
  assert.match(res.reason, /already exists/);
  // The original content is untouched — the goalposts cannot move.
  assert.match(files[target], /first ask/);
  assert.doesNotMatch(files[target], /DIFFERENT later ask/);
});

test('@unit AC-1: writeExpectation second call no-ops (write-once invariant)', () => {
  const { files, deps } = fakeFs();
  const first = writeExpectation('/shared', 'dream one', undefined, deps);
  assert.equal(first.written, true);
  const second = writeExpectation('/shared', 'dream two (an attempt to redefine)', undefined, deps);
  assert.equal(second.written, false);
  const target = path.join('/shared', 'expectation.md');
  assert.match(files[target], /dream one/);
  assert.doesNotMatch(files[target], /dream two/);
});

test('@unit AC-1: writeExpectation never throws + degrades honestly without a usable fs seam', () => {
  assert.doesNotThrow(() => writeExpectation('/shared', 'd', undefined, {}));
  assert.equal(writeExpectation('', 'd', undefined, {}).written, false);
  // A writeFileSync that throws → { written: false, reason } (never propagates).
  const throwingDeps = {
    fs: { writeFileSync() { throw new Error('EACCES'); } },
    existsSync() { return false; },
  };
  const res = writeExpectation('/shared', 'd', undefined, throwingDeps);
  assert.equal(res.written, false);
  assert.match(res.reason, /write failed/);
});

// ── resolveAlignmentAnchor (AC-2: judge anchored to the FROZEN oracle) ────────

test('@unit AC-2: resolveAlignmentAnchor returns the frozen expectation.md content when present', () => {
  const oracle = '# Original expectation\n\n## Original dream\nthe ORIGINAL ask\n';
  const anchor = resolveAlignmentAnchor('/shared', 'the MUTABLE in-memory dream', {
    readExpectation: () => oracle,
  });
  assert.equal(anchor, oracle);
  // It is the frozen oracle, NOT the (possibly drifted) in-memory dream.
  assert.doesNotMatch(anchor, /MUTABLE in-memory dream/);
});

test('@unit AC-2: resolveAlignmentAnchor reads from expectation.md (not slice.md)', () => {
  let readPath = null;
  resolveAlignmentAnchor('/shared', 'dream', {
    readExpectation: (p) => { readPath = p; return 'oracle'; },
  });
  assert.match(readPath, /expectation\.md$/);
  assert.doesNotMatch(readPath, /slice\.md/);
});

test('@unit AC-2: resolveAlignmentAnchor falls back to the dream when expectation.md is absent/empty/unreadable', () => {
  // Absent (reader throws) → dream.
  assert.equal(
    resolveAlignmentAnchor('/shared', 'fallback dream', {
      readExpectation: () => { throw new Error('ENOENT'); },
    }),
    'fallback dream',
  );
  // Empty oracle → dream.
  assert.equal(
    resolveAlignmentAnchor('/shared', 'fallback dream', { readExpectation: () => '   ' }),
    'fallback dream',
  );
  // No reader / no dir → dream.
  assert.equal(resolveAlignmentAnchor('/shared', 'fallback dream', {}), 'fallback dream');
  assert.equal(resolveAlignmentAnchor('', 'fallback dream', { readExpectation: () => 'x' }), 'fallback dream');
});

test('@unit AC-2: resolveAlignmentAnchor never throws and returns a string', () => {
  assert.doesNotThrow(() => resolveAlignmentAnchor());
  assert.equal(typeof resolveAlignmentAnchor(), 'string');
  assert.equal(resolveAlignmentAnchor(null, null, null), '');
});
