// @unit tests for composeConstitution — SPEC_V03C AC-3 (injected reads).
// File reads are injected so the unit suite never touches real fs: we assert
// resolution → read → concatenation, the skip-missing behaviour, and the
// null-when-nothing-composable contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeConstitution } from '../../lib/constitution-compose.js';

// A fake fs: maps absolute-ish paths to contents. Any other path throws ENOENT,
// exactly like readFileSync would.
function makeReader(files) {
  return (p) => {
    if (Object.prototype.hasOwnProperty.call(files, p)) return files[p];
    const e = new Error(`ENOENT: no such file '${p}'`);
    e.code = 'ENOENT';
    throw e;
  };
}

const BINDINGS_YAML = `defaults:
  always: [universal, ai-coding]
profiles:
  Kid: [safe-by-default, kid]
  Pro: [pro]
`;

const FILES = {
  '/b/bindings.yaml': BINDINGS_YAML,
  '/m/universal.md': '# Universal\nAlways applies.',
  '/m/ai-coding.md': '# AI coding\nHonest failure reporting.',
  '/m/safe-by-default.md': '# Safe-by-default\nNo network, offline only.',
  '/m/kid.md': '# Kid\nNo contact with strangers.',
  '/m/pro.md': '# Pro\nStack richness allowed.',
};

const opts = { bindingsPath: '/b/bindings.yaml', moduleDir: '/m', readFileFn: makeReader(FILES) };

test('@unit AC-3: Kid composes universal+ai-coding+safe-by-default+kid in order', () => {
  const out = composeConstitution({ profile: 'Kid', ...opts });
  assert.ok(out, 'expected a non-null composition');
  // Each module appears under its own header, in resolution order.
  const idxUniversal = out.indexOf('## Constitution — universal');
  const idxAi = out.indexOf('## Constitution — ai-coding');
  const idxSafe = out.indexOf('## Constitution — safe-by-default');
  const idxKid = out.indexOf('## Constitution — kid');
  assert.ok(idxUniversal >= 0 && idxAi >= 0 && idxSafe >= 0 && idxKid >= 0);
  assert.ok(idxUniversal < idxAi && idxAi < idxSafe && idxSafe < idxKid, 'order must be deterministic');
});

test('@unit AC-3: composed output carries each module body verbatim', () => {
  const out = composeConstitution({ profile: 'Kid', ...opts });
  assert.match(out, /No network, offline only\./);     // safe-by-default body
  assert.match(out, /No contact with strangers\./);     // kid body
  assert.match(out, /Honest failure reporting\./);      // ai-coding body
});

test('@unit AC-3: Pro carries pro.md and NOT the kid module', () => {
  const out = composeConstitution({ profile: 'Pro', ...opts });
  assert.match(out, /## Constitution — pro/);
  assert.match(out, /Stack richness allowed\./);
  assert.doesNotMatch(out, /## Constitution — kid/);
  assert.doesNotMatch(out, /No contact with strangers/);
});

test('@unit AC-3: a missing module is skipped with an inline note, never crashes', () => {
  const partial = { ...FILES };
  delete partial['/m/kid.md']; // kid.md vanishes
  const out = composeConstitution({
    profile: 'Kid',
    bindingsPath: '/b/bindings.yaml',
    moduleDir: '/m',
    readFileFn: makeReader(partial),
  });
  assert.ok(out, 'partial composition still returns text');
  assert.match(out, /## Constitution — kid/);
  assert.match(out, /unavailable — skipped/);
  // The modules that DID read are still present.
  assert.match(out, /No network, offline only\./);
});

test('@unit AC-3: unreadable bindings file → null (fall-back signal)', () => {
  const out = composeConstitution({
    profile: 'Kid',
    bindingsPath: '/does/not/exist.yaml',
    moduleDir: '/m',
    readFileFn: makeReader(FILES),
  });
  assert.equal(out, null);
});

test('@unit AC-3: profile resolving to no modules → null', () => {
  // Bindings with empty defaults and an unknown profile → no modules.
  const empty = makeReader({ '/b/bindings.yaml': 'defaults:\n  always: []\n' });
  const out = composeConstitution({
    profile: 'Ghost',
    bindingsPath: '/b/bindings.yaml',
    moduleDir: '/m',
    readFileFn: empty,
  });
  assert.equal(out, null);
});

test('@unit AC-3: every module unreadable → null (nothing composable)', () => {
  // Bindings read fine, but the module dir is empty.
  const onlyBindings = makeReader({ '/b/bindings.yaml': BINDINGS_YAML });
  const out = composeConstitution({
    profile: 'Kid',
    bindingsPath: '/b/bindings.yaml',
    moduleDir: '/m',
    readFileFn: onlyBindings,
  });
  assert.equal(out, null);
});

// Phase-4 review F3: a module name with path separators / `..` must never make
// composeConstitution read outside moduleDir.
test('@unit AC-3 (F3): a traversal module name is skipped, never read outside moduleDir', () => {
  const reads = [];
  const reader = (p) => {
    reads.push(p);
    if (p === '/b/bindings.yaml') return 'defaults:\n  always: [../../../../etc/passwd]\n';
    const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e;
  };
  const out = composeConstitution({
    profile: 'X', bindingsPath: '/b/bindings.yaml', moduleDir: '/m', readFileFn: reader,
  });
  // Nothing composable (the only module is rejected) → null.
  assert.equal(out, null);
  // Critically: we never attempted to read the traversal path.
  assert.ok(!reads.some((p) => p.includes('etc/passwd')), 'must not read the traversal target');
});

test('@unit AC-3 (F3): invalid name skipped with note while valid modules still compose', () => {
  const files = {
    '/b/bindings.yaml': 'defaults:\n  always: [universal, ../evil]\n',
    '/m/universal.md': '# Universal\nApplies.',
  };
  const out = composeConstitution({
    profile: 'X', bindingsPath: '/b/bindings.yaml', moduleDir: '/m', readFileFn: makeReader(files),
  });
  assert.ok(out);
  assert.match(out, /## Constitution — universal/);
  assert.match(out, /invalid module name/);
  assert.match(out, /Applies\./);
});

test('@unit AC-3: unknown profile falls back to defaults.always modules', () => {
  const out = composeConstitution({ profile: 'Nope', ...opts });
  assert.ok(out);
  assert.match(out, /## Constitution — universal/);
  assert.match(out, /## Constitution — ai-coding/);
  assert.doesNotMatch(out, /## Constitution — kid/);
  assert.doesNotMatch(out, /## Constitution — pro/);
});
