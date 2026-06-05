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
  expectationDreamId,
  readExpectationDreamId,
  buildExpectationContent,
  decideExpectationWrite,
  writeExpectation,
  resolveAlignmentAnchor,
} from '../../lib/conductor/expectation.js';

// ── expectationDreamId (PURE, v0.20.a AC-1) ──────────────────────────────────

test('@unit AC-1: expectationDreamId is deterministic — same dream → same id', () => {
  assert.equal(expectationDreamId('build a counter app'), expectationDreamId('build a counter app'));
});

test('@unit AC-1: expectationDreamId normalizes whitespace — extra spaces collapse', () => {
  assert.equal(expectationDreamId('dream  one'), expectationDreamId('dream one'));
  assert.equal(expectationDreamId('  trim me  '), expectationDreamId('trim me'));
});

test('@unit AC-1: expectationDreamId never throws on odd inputs and always returns a string', () => {
  for (const bad of [null, 42, undefined, {}, []]) {
    let id;
    assert.doesNotThrow(() => { id = expectationDreamId(bad); });
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0);
  }
});

test('@unit AC-1: expectationDreamId returns a stable id for the empty string (not null/undefined)', () => {
  const a = expectationDreamId('');
  const b = expectationDreamId('   ');
  assert.equal(typeof a, 'string');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{16}$/);
});

// ── readExpectationDreamId (PURE, v0.20.a AC-1) ──────────────────────────────

test('@unit AC-1: readExpectationDreamId round-trips a stamped oracle', () => {
  const content = buildExpectationContent('hello', undefined);
  assert.equal(readExpectationDreamId(content), expectationDreamId('hello'));
});

test('@unit AC-1: readExpectationDreamId returns null when no stamp is present', () => {
  assert.equal(readExpectationDreamId('# Original expectation\n\n## Original dream\nno stamp here\n'), null);
});

test('@unit AC-1: readExpectationDreamId returns null for non-string input', () => {
  assert.equal(readExpectationDreamId(null), null);
  assert.equal(readExpectationDreamId(42), null);
  assert.equal(readExpectationDreamId(undefined), null);
});

// ── buildExpectationContent (PURE) ───────────────────────────────────────────

test('@unit AC-1: buildExpectationContent stamps a machine-readable dream-id line that round-trips', () => {
  const out = buildExpectationContent('a dream worth grading', undefined);
  assert.match(out, /<!-- dream-id: [a-f0-9]{16} -->/);
  assert.equal(readExpectationDreamId(out), expectationDreamId('a dream worth grading'));
});

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
      readFileSync(p) {
        if (!Object.prototype.hasOwnProperty.call(files, p)) {
          const err = new Error(`ENOENT: ${p}`); err.code = 'ENOENT'; throw err;
        }
        return files[p];
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

test('@unit AC-3: writeExpectation OVERWRITES when an existing (unstamped) oracle is for a different dream', () => {
  const target = path.join('/shared', 'expectation.md');
  // Old v0.17 oracle with NO dream-id stamp → id null → treated as a different dream.
  const { files, deps } = fakeFs({ [target]: '# Original expectation\nfirst ask\n' });
  const res = writeExpectation('/shared', 'a DIFFERENT later ask', 'scope', deps);
  assert.equal(res.written, true);
  assert.equal(res.reason, 'new dream');
  // The new dream now lives in the oracle — the gate grades THIS dream (the fix).
  assert.match(files[target], /DIFFERENT later ask/);
  assert.doesNotMatch(files[target], /first ask/);
});

test('@unit AC-3: writeExpectation second call with a DIFFERENT dream OVERWRITES (per-dream, not write-once)', () => {
  const { files, deps } = fakeFs();
  const first = writeExpectation('/shared', 'dream one', undefined, deps);
  assert.equal(first.written, true);
  const second = writeExpectation('/shared', 'dream two (a genuinely new ask)', undefined, deps);
  assert.equal(second.written, true);
  assert.equal(second.reason, 'new dream');
  const target = path.join('/shared', 'expectation.md');
  assert.match(files[target], /dream two/);
  assert.doesNotMatch(files[target], /dream one/);
});

test('@unit AC-3: writeExpectation PRESERVES on a same-dream re-run (anti-drift within a dream)', () => {
  const { files, deps } = fakeFs();
  const first = writeExpectation('/shared', 'my dream', undefined, deps);
  assert.equal(first.written, true);
  const target = path.join('/shared', 'expectation.md');
  const after = files[target];
  const second = writeExpectation('/shared', 'my dream', undefined, deps);
  assert.equal(second.written, false);
  assert.equal(second.reason, 'same dream');
  // Byte-for-byte unchanged — the goalposts cannot move within a dream.
  assert.equal(files[target], after);
});

test('@unit AC-3: writeExpectation PRESERVES a different dream on a RESUME and flags the mismatch', () => {
  const target = path.join('/shared', 'expectation.md');
  // A stamped oracle for dream A.
  const { files, deps } = fakeFs({ [target]: buildExpectationContent('dream A', undefined) });
  const res = writeExpectation('/shared', 'dream B (resumed but different)', undefined, { ...deps, isResume: true });
  assert.equal(res.written, false);
  assert.equal(res.reason, 'resume-mismatch');
  assert.equal(res.mismatch, true);
  // The original oracle survives — resume never moves the goalposts.
  assert.match(files[target], /dream A/);
  assert.doesNotMatch(files[target], /dream B/);
});

test('@unit AC-3: writeExpectation PRESERVES the SAME dream on a resume (no mismatch flag)', () => {
  const target = path.join('/shared', 'expectation.md');
  const { files, deps } = fakeFs({ [target]: buildExpectationContent('same dream', undefined) });
  const res = writeExpectation('/shared', 'same dream', undefined, { ...deps, isResume: true });
  assert.equal(res.written, false);
  assert.equal(res.reason, 'same dream');
  assert.ok(!res.mismatch);
});

test('@unit AC-3: writeExpectation degrades honestly when the write throws (never propagates)', () => {
  const throwingDeps = {
    fs: { writeFileSync() { throw new Error('EACCES'); } },
    existsSync() { return false; },
    readFileSync() { return ''; },
  };
  let res;
  assert.doesNotThrow(() => { res = writeExpectation('/shared', 'd', undefined, throwingDeps); });
  assert.equal(res.written, false);
  assert.match(res.reason, /write failed/);
});

test('@unit Phase-4 F1: writeExpectation — no readFileSync seam + existing file → safe PRESERVE (never overwrite an oracle we cannot read)', () => {
  const target = path.join('/shared', 'expectation.md');
  const files = { [target]: 'old oracle, no reader available' };
  const deps = {
    fs: { writeFileSync(p, c) { files[p] = c; } },
    existsSync(p) { return Object.prototype.hasOwnProperty.call(files, p); },
    // NO readFileSync → existing content unknown → anti-drift default: preserve.
  };
  const res = writeExpectation('/shared', 'a new ask', undefined, deps);
  assert.equal(res.written, false);
  assert.match(res.reason, /no reader seam.*preserved|preserved/);
  // The existing oracle survives byte-for-byte — we never overwrite a file whose
  // dream-id we could not read (could have been the SAME dream).
  assert.equal(files[target], 'old oracle, no reader available');
});

test('@unit Phase-4 F1: writeExpectation — no readFileSync seam, existing file, RESUME → preserve', () => {
  const target = path.join('/shared', 'expectation.md');
  const files = { [target]: 'old oracle, no reader available' };
  const deps = {
    fs: { writeFileSync(p, c) { files[p] = c; } },
    existsSync(p) { return Object.prototype.hasOwnProperty.call(files, p); },
    isResume: true,
  };
  const res = writeExpectation('/shared', 'a new ask', undefined, deps);
  assert.equal(res.written, false);
  // Resume never moves the goalposts, even when the reader is unavailable.
  assert.match(files[target], /old oracle/);
});

test('@unit Phase-4 F1: writeExpectation — readFileSync THROWS (EACCES/race) + existing file → safe PRESERVE (never overwrite)', () => {
  const target = path.join('/shared', 'expectation.md');
  const files = { [target]: buildExpectationContent('the original dream', undefined) };
  const deps = {
    fs: { writeFileSync(p, c) { files[p] = c; } },
    existsSync(p) { return Object.prototype.hasOwnProperty.call(files, p); },
    readFileSync() { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; },
  };
  let res;
  assert.doesNotThrow(() => { res = writeExpectation('/shared', 'a genuinely new ask', undefined, deps); });
  // Read failed → we cannot tell if the oracle is for THIS dream → preserve, NOT overwrite.
  assert.equal(res.written, false);
  assert.match(res.reason, /could not read/);
  // The original oracle is untouched (the F1 bug would have overwritten it).
  assert.match(files[target], /the original dream/);
  assert.doesNotMatch(files[target], /genuinely new ask/);
});

test('@unit Phase-4 F3/AC-5: writeExpectation on a RESUME with a different dream returns mismatch:true (caller logs the warning)', () => {
  const target = path.join('/shared', 'expectation.md');
  // Stamped oracle for dream A; a resume arrives with a different dream B.
  const { files, deps } = fakeFs({ [target]: buildExpectationContent('dream A — the original', undefined) });
  const res = writeExpectation('/shared', 'dream B — resumed but different', undefined, { ...deps, isResume: true });
  // The return contract the bin/mmd.js finishResume warning branch keys off:
  assert.equal(res.mismatch, true);
  assert.equal(res.written, false);
  assert.equal(res.reason, 'resume-mismatch');
  // The original oracle survives — resume never moves the goalposts.
  assert.match(files[target], /dream A — the original/);
});

// ── decideExpectationWrite (PURE, v0.20.a AC-2) ──────────────────────────────

test('@unit AC-2: decideExpectationWrite — no existing oracle → write-fresh', () => {
  assert.deepEqual(decideExpectationWrite({ existing: null, currentDreamId: 'x', isResume: false }), { action: 'write-fresh' });
  assert.deepEqual(decideExpectationWrite({ existing: undefined, currentDreamId: 'x', isResume: false }), { action: 'write-fresh' });
  assert.deepEqual(decideExpectationWrite({ existing: '   ', currentDreamId: 'x', isResume: false }), { action: 'write-fresh' });
});

test('@unit AC-2: decideExpectationWrite — same dream-id → preserve', () => {
  const id = expectationDreamId('same');
  const existing = buildExpectationContent('same', undefined);
  assert.deepEqual(decideExpectationWrite({ existing, currentDreamId: id, isResume: false }), { action: 'preserve' });
  // Same id on a resume too → preserve, no mismatch.
  assert.deepEqual(decideExpectationWrite({ existing, currentDreamId: id, isResume: true }), { action: 'preserve' });
});

test('@unit AC-2: decideExpectationWrite — different id, NOT a resume → write-fresh (the fix)', () => {
  const existing = buildExpectationContent('dream A', undefined);
  const idB = expectationDreamId('dream B');
  assert.deepEqual(decideExpectationWrite({ existing, currentDreamId: idB, isResume: false }), { action: 'write-fresh' });
});

test('@unit AC-2: decideExpectationWrite — different id ON a resume → preserve + mismatch', () => {
  const existing = buildExpectationContent('dream A', undefined);
  const idB = expectationDreamId('dream B');
  assert.deepEqual(decideExpectationWrite({ existing, currentDreamId: idB, isResume: true }), { action: 'preserve', mismatch: true });
});

test('@unit AC-2: decideExpectationWrite never throws on junk input and returns a valid action', () => {
  let r;
  assert.doesNotThrow(() => { r = decideExpectationWrite(); });
  // No args → existing undefined → no oracle → write-fresh; the guarantee is it never throws.
  assert.ok(r.action === 'write-fresh' || r.action === 'preserve');
  assert.doesNotThrow(() => { r = decideExpectationWrite({ existing: undefined, currentDreamId: undefined, isResume: undefined }); });
  assert.ok(r.action === 'write-fresh' || r.action === 'preserve');
});

test('@unit Phase-4 F4: decideExpectationWrite — non-string non-null existing → safe PRESERVE (unknown oracle)', () => {
  // A non-string truthy existing (e.g. 42, {}) cannot yield a dream-id → unknown
  // oracle → preserve (never overwrite what we cannot read), even on a non-resume.
  assert.equal(decideExpectationWrite({ existing: 42, currentDreamId: 'abc', isResume: false }).action, 'preserve');
  assert.equal(decideExpectationWrite({ existing: {}, currentDreamId: 'abc', isResume: false }).action, 'preserve');
  assert.equal(decideExpectationWrite({ existing: [], currentDreamId: 'abc', isResume: false }).action, 'preserve');
  // Even on a resume → preserve (consistent).
  assert.equal(decideExpectationWrite({ existing: 42, currentDreamId: 'abc', isResume: true }).action, 'preserve');
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
