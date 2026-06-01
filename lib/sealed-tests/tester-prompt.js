// lib/sealed-tests/tester-prompt.js — the two prompts of the sealed-test oracle
// (v0.4.a). Both are PURE string builders (no fs, no spawn) so the unit suite
// can assert their wording without a real claude (universal §I.S, §II KISS).
//
// The oracle is a two-phase, two-agent split (SPEC_V04A §1):
//   1. TESTER — derives acceptance tests from the dream (+ slice.md) into the
//      sealed dir and is told, emphatically, NOT to implement the app. The
//      oracle must be BLIND to the implementation, or it is no oracle at all.
//   2. CODER  — the existing auto-dev. Its prompt names the sealed dir and
//      states it is a READ-ONLY oracle: read the tests to understand the target
//      behavior, but NEVER edit, weaken, or delete them. MMD enforces this with
//      a hash seal regardless of whether the coder obeys (manifest.js), but the
//      instruction makes the contract explicit (universal §VII — human-readable).
//
// SHARED_MARKER is a stable phrase both prompts (and only these prompts) carry,
// so the integration fake-claude can branch tester-vs-coder on it the way
// fake-claude-elicit.sh branches on its turn mode (SPEC_V04A §5 hint 3).

import { buildPrompt } from '../invoke-autodev.js';

// A distinctive phrase that appears ONLY in sealed-oracle prompts. The tester
// prompt carries it framed as the WRITER of the oracle; the coder prompt as a
// READER bound by it. The verb "SEALED ORACLE" is unlikely to occur in an
// ordinary dream string, so the test fake can detect the tester call reliably.
export const SHARED_MARKER = 'SEALED ORACLE';

/**
 * Build the TESTER `claude -p` prompt.
 *
 * The tester derives acceptance tests from the dream (and the slice spec, when
 * one was provided) and writes them into `sealedDir`. It MUST NOT implement the
 * application — that is the coder's job in the next phase, and an oracle that
 * peeked at (or wrote) the implementation would no longer be independent.
 *
 * @param {{ dream: string, slice?: string|null, sealedDir: string }} args
 *   - dream:     the user's dream (verbatim)
 *   - slice:     optional slice.md / spec text to ground the tests (may be null)
 *   - sealedDir: absolute path the tester MUST write its test files into
 * @returns {string} the prompt body
 */
export function buildTesterPrompt({ dream, slice = null, sealedDir }) {
  if (typeof dream !== 'string' || dream.trim() === '') {
    throw new Error('buildTesterPrompt: a non-empty dream is required');
  }
  if (typeof sealedDir !== 'string' || sealedDir.trim() === '') {
    throw new Error('buildTesterPrompt: a sealedDir path is required');
  }

  const lines = [
    `You are the TESTER phase of MMD's ${SHARED_MARKER} workflow.`,
    '',
    'Your ONE job: DERIVE ACCEPTANCE TESTS from the dream below — the behaviour a',
    'correct implementation MUST exhibit — and write them as test files into the',
    `sealed directory: ${sealedDir}`,
    '',
    'Hard rules (NON-NEGOTIABLE):',
    '- Do NOT implement the application. Write ZERO production code. No index.html,',
    '  no app.js, no styles — ONLY test files. A later, separate agent (the CODER)',
    '  implements the app; if you build it, the oracle is no longer independent.',
    '- Write the tests so they encode the dream\'s observable behaviour (the',
    '  acceptance criteria), not internal implementation details — the CODER is',
    '  free to choose any internal structure that satisfies them.',
    '- Each test file MUST be self-contained and runnable; prefer small, focused',
    '  cases over one giant test.',
    `- Write every file INSIDE ${sealedDir} and nowhere else.`,
    '',
    `Dream (verbatim): ${dream}`,
  ];

  if (typeof slice === 'string' && slice.trim() !== '') {
    lines.push(
      '',
      'Slice spec (authoritative scope — derive your tests from this where it is',
      'more specific than the dream):',
      '',
      slice.trim(),
    );
  }

  lines.push(
    '',
    'When done, the sealed directory should contain only your acceptance tests.',
    'MMD will then SEAL them (hash manifest) and hand the dream to the CODER.',
  );

  return lines.join('\n');
}

/**
 * Build the CODER prompt: the existing greenfield auto-dev prompt PLUS a block
 * naming the sealed dir as a READ-ONLY oracle (SPEC_V04A AC-4).
 *
 * DRY (universal §III): the base body is reused verbatim from
 * invoke-autodev.js#buildPrompt — the coder still gets the full walking-skeleton
 * guidance (stack constraint, files to generate, safe defaults). We only APPEND
 * the sealed-oracle contract so the two prompts never drift.
 *
 * The block states, in plain language: the sealed dir holds the acceptance tests
 * a separate tester wrote; READ them to learn the target behaviour; make them
 * pass by implementing the APP; and NEVER edit, weaken, rename, or delete any
 * file under the sealed dir. MMD verifies the seal afterwards and FAILS the
 * slice on any tamper — so rewriting a test to pass is not a shortcut, it is a
 * detected failure (P-04).
 *
 * @param {{ dream: string, slug: string, demoDir: string, sealedDir: string, engine?: string }} args
 * @returns {string}
 */
export function buildCoderPrompt({ dream, slug, demoDir, sealedDir, engine = 'standard' }) {
  if (typeof sealedDir !== 'string' || sealedDir.trim() === '') {
    throw new Error('buildCoderPrompt: a sealedDir path is required');
  }
  const base = buildPrompt({ dream, slug, demoDir, engine });
  const sealedBlock = [
    '',
    `${SHARED_MARKER} (READ-ONLY — NON-NEGOTIABLE):`,
    `The directory ${sealedDir} holds acceptance tests written by an INDEPENDENT`,
    'tester agent BEFORE you started. They define the behaviour your',
    'implementation must satisfy.',
    '- READ these tests to understand the target behaviour.',
    '- Make them pass by implementing the APPLICATION — write the app code, not the tests.',
    `- You MUST NOT edit, weaken, rename, move, or delete ANY file under ${sealedDir}.`,
    '- MMD re-hashes this sealed directory after you finish. Any change to a sealed',
    '  file is a TAMPER: the slice is marked FAILED and NOT merged. Rewriting a test',
    '  to make it pass is a detected failure, never a shortcut (PROBLEMS.md P-04).',
  ].join('\n');
  return `${base}\n${sealedBlock}`;
}
