// test/unit/documentalist-detect-act.test.js — unit tests for the v0.21.a
// Documentalist detect+act pure modules (SPEC_V021A):
//   • assessDocStructure / inferRole        (AC-3)
//   • checkCapabilityClaims                  (AC-1)
//   • deriveDeprecatedCommands / checkDeprecatedSurface derived set (AC-2)
//   • planExtraction / planRemovals / stubLineFor / destinationForSection (AC-4)
//
// All pure, deterministic, never-throw. Tagged @unit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assessDocStructure, inferRole } from '../../lib/documentalist/doc-structure.js';
import {
  checkCapabilityClaims,
  checkDeprecatedSurface,
  deriveDeprecatedCommands,
  buildDeprecatedSurfaceRules,
} from '../../lib/documentalist/conformance.js';
import {
  planExtraction,
  planRemovals,
  stubLineFor,
  destinationForSection,
} from '../../lib/documentalist/compact-action.js';

// ── AC-3: role-aware structure assessment ───────────────────────────────────

test('@unit inferRole: README is concise, MAKE_MY_DREAMS / ADR / SPEC are reference', () => {
  assert.equal(inferRole('README.md'), 'concise');
  assert.equal(inferRole('docs/README.md'), 'concise');
  assert.equal(inferRole('MAKE_MY_DREAMS.md'), 'reference');
  assert.equal(inferRole('docs/adr/060-x.md'), 'reference');
  assert.equal(inferRole('docs/specs/SPEC_V01.md'), 'reference');
  assert.equal(inferRole('SPEC_V21A.md'), 'reference');
  assert.equal(inferRole('OTHER.md'), 'concise'); // safe default
});

test('@unit assessDocStructure: a CONCISE doc over budget reports overBudget + oversized sections + changelogInline', () => {
  const big = ['# T', ''];
  big.push('## History', '');
  for (let i = 0; i < 100; i += 1) big.push(`history line ${i}`);
  big.push('', '## Changelog', '', '<!-- mmd:readme:changelog -->', '- v1');
  const text = big.join('\n');
  const r = assessDocStructure({ docPath: 'README.md', docText: text });
  assert.equal(r.role, 'concise');
  assert.equal(r.overBudget, false); // ~107 lines < 200 budget
  // Force over-budget with a small budget to exercise the flag.
  const r2 = assessDocStructure({ docPath: 'README.md', docText: text, budget: 50 });
  assert.equal(r2.overBudget, true);
  assert.ok(r2.oversizedSections.some((s) => /history/i.test(s.heading)));
  assert.equal(r2.changelogInline, true);
  assert.equal(r2.heuristic, true);
});

test('@unit assessDocStructure: a REFERENCE doc is EXEMPT from over-budget (role-aware)', () => {
  const long = ['# Ref'];
  for (let i = 0; i < 1000; i += 1) long.push(`reference line ${i}`);
  const r = assessDocStructure({ docPath: 'MAKE_MY_DREAMS.md', docText: long.join('\n') });
  assert.equal(r.role, 'reference');
  assert.equal(r.overBudget, false); // never flagged regardless of length
  assert.deepEqual(r.oversizedSections, []);
});

test('@unit assessDocStructure: never throws on odd input', () => {
  assert.doesNotThrow(() => assessDocStructure(null));
  assert.doesNotThrow(() => assessDocStructure({}));
  assert.doesNotThrow(() => assessDocStructure({ docText: 123 }));
  assert.equal(assessDocStructure({}).overBudget, false);
});

// ── AC-1: capability-lie detection ──────────────────────────────────────────

test('@unit checkCapabilityClaims: present-tense worktrees claim → high + removable; deferred/future → not flagged', () => {
  // list-item claim (whole-line excisable)
  const li = checkCapabilityClaims({ docText: '- adds local parallelization via git worktrees', doc: 'x' });
  assert.equal(li.length, 1);
  assert.equal(li[0].confidence, 'high');
  assert.equal(li[0].removable, true);
  assert.equal(li[0].removalMode, 'whole-line');

  // trailing comma-clause (excisable)
  const tc = checkCapabilityClaims({ docText: 'MMD adds a, b, local parallelization via git worktrees.', doc: 'x' });
  assert.equal(tc.length, 1);
  assert.equal(tc[0].removable, true);
  assert.equal(tc[0].removalMode, 'trailing-clause');

  // deferred / planned / future framings → NOT a claim
  assert.equal(checkCapabilityClaims({ docText: 'worktrees parallelization is deferred to v0.9', doc: 'x' }).length, 0);
  assert.equal(checkCapabilityClaims({ docText: 'MMD will add parallel worktrees in a future release', doc: 'x' }).length, 0);
  assert.equal(checkCapabilityClaims({ docText: 'parallel worktrees are planned (roadmap)', doc: 'x' }).length, 0);
});

test('@unit checkCapabilityClaims: no false positive on a true capability claim; pure + never throws', () => {
  const truth = checkCapabilityClaims({ docText: 'MMD adds reflexive bootstrap and a brownfield onboarder.', doc: 'x' });
  assert.equal(truth.length, 0);
  assert.doesNotThrow(() => checkCapabilityClaims(null));
  assert.doesNotThrow(() => checkCapabilityClaims({}));
  assert.equal(checkCapabilityClaims({}).length, 0);
});

test('@unit checkCapabilityClaims: a fenced code block is not scanned (precision)', () => {
  const text = ['```', 'mmd adds local parallelization via git worktrees', '```'].join('\n');
  assert.equal(checkCapabilityClaims({ docText: text, doc: 'x' }).length, 0);
});

// ── AC-2: deprecated-surface DERIVED from real notices ──────────────────────

test('@unit deriveDeprecatedCommands: parses the real [DEPRECATED] notices', () => {
  const src = [
    "stderr.write('[DEPRECATED] mmdream handover is deprecated — use: mmdream document');",
    "stderr.write('[DEPRECATED] mmdream document-readme is deprecated — use: mmdream document');",
    "[DEPRECATED] mmdream document-review is deprecated — use: mmdream document",
    "[DEPRECATED] mmdream document-compact is deprecated — use: mmdream document",
  ].join('\n');
  const cmds = deriveDeprecatedCommands(src);
  assert.deepEqual(cmds.sort(), ['document-compact', 'document-readme', 'document-review', 'handover']);
  // array form + dedup
  assert.deepEqual(deriveDeprecatedCommands(['[DEPRECATED] mmdream handover is deprecated', '[DEPRECATED] mmdream handover is deprecated']), ['handover']);
  // never throws
  assert.doesNotThrow(() => deriveDeprecatedCommands(null));
  assert.deepEqual(deriveDeprecatedCommands(null), []);
});

test('@unit checkDeprecatedSurface: derived document-* flagged when taught as primary; alias/comparative suppressed', () => {
  const cmds = ['handover', 'document-readme', 'document-review'];

  // usage line → flagged + removable + high confidence
  const usage = checkDeprecatedSurface([{ path: 'README.md', text: 'mmdream document-readme --tests 5   # refresh' }], { derivedCommands: cmds });
  assert.equal(usage.length, 1);
  assert.equal(usage[0].confidence, 'high');
  assert.equal(usage[0].removable, true);
  assert.equal(usage[0].token, 'mmdream document-readme');

  // comparative mid-prose → NOT flagged
  assert.equal(checkDeprecatedSurface([{ path: 'x', text: 'Like `mmdream handover`, it is honest on every source.' }], { derivedCommands: cmds }).length, 0);
  // deprecated-alias narration → NOT flagged
  assert.equal(checkDeprecatedSurface([{ path: 'x', text: 'mmdream handover is now a deprecated alias of mmdream document' }], { derivedCommands: cmds }).length, 0);
  // instead-of → NOT flagged
  assert.equal(checkDeprecatedSurface([{ path: 'x', text: 'use mmdream document instead of mmdream handover' }], { derivedCommands: cmds }).length, 0);
});

test('@unit buildDeprecatedSurfaceRules: each command matches its own exact name only', () => {
  const rules = buildDeprecatedSurfaceRules(['document', 'document-review']);
  const docRule = rules.find((r) => r.token === 'mmdream document');
  // `mmdream document` must NOT match inside `mmdream document-review`.
  assert.equal(docRule.match.test('mmdream document-review --check'), false);
  assert.equal(docRule.match.test('mmdream document --check'), true);
  assert.doesNotThrow(() => buildDeprecatedSurfaceRules(null));
});

// ── AC-4: the two actions — the CONTENT-MATCHED-DESTINATION invariant ────────

test('@unit destinationForSection: History → docs/<stem>-history.md, NEVER CHANGELOG.md', () => {
  assert.equal(destinationForSection('History', 'README.md'), 'docs/readme-history.md');
  assert.equal(destinationForSection('Usage', 'README.md'), 'docs/readme-usage.md');
  assert.equal(destinationForSection('Quick start', 'README.md'), 'docs/readme-quick-start.md');
  // ONLY the genuine changelog targets CHANGELOG.md (via the isChangelog flag).
  assert.equal(destinationForSection('Changelog', 'README.md', { isChangelog: true }), 'CHANGELOG.md');
  assert.notEqual(destinationForSection('History', 'README.md'), 'CHANGELOG.md');
});

test('@unit stubLineFor: the stub link TEXT is the section heading, never "changelog" for a History section', () => {
  const hist = stubLineFor('History', 'docs/readme-history.md');
  assert.match(hist, /\[History\]\(docs\/readme-history\.md\)/);
  assert.match(hist, /for the full history/);
  assert.doesNotMatch(hist, /changelog/i); // THE bug guard
  const cl = stubLineFor('Changelog', 'CHANGELOG.md', { isChangelog: true });
  assert.match(cl, /\[CHANGELOG\.md\]\(CHANGELOG\.md\)/);
  assert.match(cl, /for the full changelog/);
});

test('@unit planExtraction: byte-lossless move, content-matched destination, idempotent, reference untouched', async () => {
  const { splitSections } = await import('../../lib/documentalist/doc-structure.js');
  const doc = ['# T', '', '## Intro', '', 'x', '', '## History', '', 'h1', 'h2', 'h3', ''].join('\n');
  const secs = splitSections(doc).filter((s) => /history/i.test(s.heading));
  const plan = planExtraction({ docPath: 'README.md', docText: doc, role: 'concise', sections: secs });
  assert.equal(plan.moves.length, 1);
  assert.equal(plan.moves[0].dst, 'docs/readme-history.md');
  assert.equal(plan.moves[0].isChangelog, false);
  // LOSSLESS: moved content is byte-identical to the original section span.
  const orig = doc.split('\n').slice(secs[0].startLine - 1, secs[0].endLine).join('\n');
  assert.equal(plan.moves[0].content, orig);
  // The doc now holds a truthful stub.
  assert.match(plan.newDocText, /See \[History\]\(docs\/readme-history\.md\) for the full history\./);
  // IDEMPOTENT: re-run on the stubbed text → no move.
  const secs2 = splitSections(plan.newDocText).filter((s) => /history/i.test(s.heading));
  assert.equal(planExtraction({ docPath: 'README.md', docText: plan.newDocText, role: 'concise', sections: secs2 }).moves.length, 0);
  // REFERENCE role → never moved.
  assert.equal(planExtraction({ docPath: 'MAKE_MY_DREAMS.md', docText: doc, role: 'reference', sections: secs }).moves.length, 0);
});

test('@unit planExtraction: the genuine changelog (marker) → CHANGELOG.md, never a History file', async () => {
  const { splitSections } = await import('../../lib/documentalist/doc-structure.js');
  const doc = ['# T', '', '## Changelog', '', '<!-- mmd:readme:changelog -->', '- v1', '- v2', ''].join('\n');
  const secs = splitSections(doc);
  const plan = planExtraction({ docPath: 'README.md', docText: doc, role: 'concise', sections: secs });
  const mv = plan.moves.find((m) => m.isChangelog);
  assert.ok(mv, 'changelog identified');
  assert.equal(mv.dst, 'CHANGELOG.md');
  assert.match(mv.stub, /for the full changelog/);
});

test('@unit planExtraction: a section that only MENTIONS the changelog marker in prose is NOT the changelog (the v0.21-v1 misroute bug)', async () => {
  const { splitSections } = await import('../../lib/documentalist/doc-structure.js');
  // A Usage section that DESCRIBES the markers in prose (backticked) — it must NOT
  // be routed to CHANGELOG.md. Only a section carrying the real HTML-comment
  // START marker is the changelog.
  const doc = [
    '# T', '',
    '## Usage', '',
    'Two managed blocks: the `mmd:readme:status` pair and the `mmd:readme:changelog` pair.',
    'more usage prose here describing things at length',
    '',
    '## Changelog', '',
    '<!-- mmd:readme:changelog:start -->',
    '- v1', '- v2',
    '<!-- mmd:readme:changelog:end -->', '',
  ].join('\n');
  const secs = splitSections(doc);
  const plan = planExtraction({ docPath: 'README.md', docText: doc, role: 'concise', sections: secs });
  const usageMove = plan.moves.find((m) => m.heading === 'Usage');
  const clMove = plan.moves.find((m) => m.heading === 'Changelog');
  assert.ok(usageMove, 'Usage moved');
  assert.equal(usageMove.dst, 'docs/readme-usage.md', 'Usage must NOT go to CHANGELOG.md');
  assert.equal(usageMove.isChangelog, false);
  assert.ok(clMove, 'Changelog moved');
  assert.equal(clMove.dst, 'CHANGELOG.md', 'only the real marker-block changelog → CHANGELOG.md');
  assert.equal(clMove.isChangelog, true);
});

test('@unit planRemovals: whole-line + trailing-clause excision; mid-sentence flagged; pure', () => {
  // whole-line list item
  const r1 = planRemovals({
    docText: ['- true a', '- adds local parallelization via git worktrees', '- true b'].join('\n'),
    findings: [{ line: 2, confidence: 'high', removable: true, removalMode: 'whole-line', capability: 'worktrees' }],
  });
  assert.equal(r1.removals.length, 1);
  assert.doesNotMatch(r1.newDocText, /worktrees/);
  assert.match(r1.newDocText, /- true a\n- true b/);

  // trailing comma-clause
  const r2 = planRemovals({
    docText: 'MMD adds a, b, local parallelization via git worktrees.',
    findings: [{ line: 1, confidence: 'high', removable: true, removalMode: 'trailing-clause', matchText: 'local parallelization via git worktrees', capability: 'worktrees' }],
  });
  assert.equal(r2.newDocText, 'MMD adds a, b.');

  // mid-sentence (removable:false) → flagged, NOT removed
  const r3 = planRemovals({ docText: 'a worktrees claim mid sentence', findings: [{ line: 1, confidence: 'high', removable: false, capability: 'x' }] });
  assert.equal(r3.removals.length, 0);
  assert.equal(r3.flagged.length, 1);
  assert.equal(r3.newDocText, 'a worktrees claim mid sentence');

  // never throws
  assert.doesNotThrow(() => planRemovals(null));
  assert.equal(planRemovals(null).removals.length, 0);
});
