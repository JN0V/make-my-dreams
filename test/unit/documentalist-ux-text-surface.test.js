// @unit tests for lib/documentalist/ux-text-surface.js (SPEC_V018A AC-2).
//
// The "UX-text surface" builder collects the user-facing strings BEYOND the
// markdown truth docs — shell printf/echo output + the CLI --help/USAGE text —
// so the conformance checks reach where a stale claim actually hides (the
// install-mmd.sh `/bmad-adv-auto-dev` recommendation lived in printf output).
// Pure beyond the injected reader, never throws. < 100ms (testing.md §V).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractShellUxText,
  extractUsageText,
  buildUxTextSurface,
} from '../../lib/documentalist/ux-text-surface.js';

test('@unit ux-surface: extracts the quoted string of printf/echo, line-positioned', () => {
  const script = [
    '#!/usr/bin/env bash', // 1
    'set -e', // 2
    'echo "To get started, try /bmad-adv-auto-dev"', // 3
    'x=5', // 4
    'printf "Installed at %s\\n" "$DIR"', // 5
  ].join('\n');
  const out = extractShellUxText(script);
  const lines = out.split('\n');
  // The emitted string sits at its SOURCE line number (3 / 5), gaps blank.
  assert.match(lines[2], /To get started, try \/bmad-adv-auto-dev/);
  assert.match(lines[4], /Installed at %s/);
  assert.equal(lines[0], '');
  assert.equal(lines[1], '');
  assert.equal(lines[3], '');
});

test('@unit ux-surface: single-quoted echo is captured too', () => {
  const out = extractShellUxText("echo 'use mmd serve to begin'");
  assert.match(out, /use mmd serve to begin/);
});

test('@unit ux-surface: a non-printf/echo line yields no text (precision)', () => {
  const out = extractShellUxText('grep "pattern" file.txt\nVAR="value"');
  assert.equal(out.trim(), '', 'grep/assignment quoted strings are not UX text');
});

test('@unit ux-surface: extractShellUxText never throws on odd input', () => {
  assert.equal(extractShellUxText(null), '');
  assert.equal(extractShellUxText(undefined), '');
  assert.equal(extractShellUxText(42), '');
  assert.equal(extractShellUxText(''), '');
});

test('@unit ux-surface: extractUsageText pulls the const USAGE template literal', () => {
  const bin = [
    'const FOO = 1;',
    'const USAGE = `mmdream document-review — the coherence review',
    '',
    'Usage:',
    '  mmdream document-review [--check]',
    '`;',
    'doStuff();',
  ].join('\n');
  const usage = extractUsageText(bin);
  assert.match(usage, /mmdream document-review/);
  assert.match(usage, /--check/);
  assert.ok(!usage.includes('doStuff'), 'stops at the closing backtick');
});

test('@unit ux-surface: extractUsageText → "" when no USAGE; never throws', () => {
  assert.equal(extractUsageText('const X = 1;'), '');
  assert.equal(extractUsageText(null), '');
  assert.equal(extractUsageText(undefined), '');
});

test('@unit ux-surface: buildUxTextSurface collects scripts + --help as {path,text}', () => {
  const files = {
    'install-mmd.sh': 'echo "try /bmad-adv-auto-dev to start"',
    'install.sh': 'printf "run mmd serve\\n"',
    'bin/mmd.js': 'const USAGE = `mmdream serve — start the web mode`;',
  };
  const readFile = (rel) => {
    if (!(rel in files)) throw new Error('ENOENT');
    return files[rel];
  };
  const surface = buildUxTextSurface({ readFile });
  const byPath = Object.fromEntries(surface.map((s) => [s.path, s.text]));
  assert.match(byPath['install-mmd.sh'], /\/bmad-adv-auto-dev/);
  assert.match(byPath['install.sh'], /run mmd serve/);
  assert.match(byPath['bin/mmd.js --help'], /mmdream serve/);
});

test('@unit ux-surface: an absent script/bin is skipped honestly (never throws, no fabricated entry)', () => {
  const readFile = (rel) => {
    if (rel === 'install-mmd.sh') return 'echo "hi from installer"';
    throw new Error('ENOENT'); // install.sh + bin/mmd.js absent
  };
  const surface = buildUxTextSurface({ readFile });
  assert.equal(surface.length, 1);
  assert.equal(surface[0].path, 'install-mmd.sh');
});

test('@unit ux-surface: no reader / odd args → [] (never throws)', () => {
  assert.deepEqual(buildUxTextSurface({}), []);
  assert.deepEqual(buildUxTextSurface(null), []);
  assert.deepEqual(buildUxTextSurface(undefined), []);
  assert.doesNotThrow(() => buildUxTextSurface({ readFile: 42 }));
});

test('@unit ux-surface: a script with no printf/echo output is omitted (no empty {path,text})', () => {
  const readFile = (rel) => (rel === 'install-mmd.sh' ? 'set -e\nVAR=1\n' : (() => { throw new Error('x'); })());
  const surface = buildUxTextSurface({ readFile });
  assert.deepEqual(surface, [], 'a script that emits nothing user-facing is not a surface entry');
});
