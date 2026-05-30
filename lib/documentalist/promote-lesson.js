// lib/documentalist/promote-lesson.js — promotion executor (SPEC_V02I AC-4).
//
// When a lesson's counter reaches its `**To promote if**: N` threshold, this
// module moves it out of the dynamic Layer F (docs/lessons-learned.md) into the
// appropriate constitution module and records the event as an ADR. It is the
// ONLY module here that performs file mutations; everything upstream is pure.
//
// Promotion = three best-effort file ops (SPEC_V02I §5 "Promotion atomicity"):
//   1. Append the lesson (header + Rule) to .specify/memory/constitution/<mod>.md
//   2. Remove the lesson block from docs/lessons-learned.md (serialize-lessons)
//   3. Write docs/adr/<NNN>-lesson-L-<XXX>-promoted.md
// Each step is wrapped so a later failure does not undo earlier ones; the caller
// surfaces partial failures (exit 6).

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { removeLessonBlock, resolveTargetModule } from './serialize-lessons.js';

const PROMOTED_HEADING = '## Promoted from lessons-learned';

/**
 * Next ADR number = max existing leading number + 1, zero-padded to 3 digits.
 * Pure. Ignores filenames without a leading number.
 *
 * @param {string[]} filenames  contents of docs/adr/
 * @returns {string} e.g. "014"
 */
export function nextAdrNumber(filenames) {
  let max = 0;
  for (const name of filenames || []) {
    const m = String(name).match(/^(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return String(max + 1).padStart(3, '0');
}

/**
 * Build the markdown block appended to the target constitution module. Pure.
 *
 * @param {{ id: string, title?: string, rule?: string }} lesson
 * @returns {string}
 */
export function buildModuleAppendBlock(lesson) {
  const title = lesson.title || '(untitled)';
  const rule = (lesson.rule || '').trim() || '(no rule recorded)';
  return `### ${lesson.id} — ${title}\n\n**Rule**: ${rule}\n`;
}

/**
 * Append a promoted lesson to a constitution module's markdown, adding the
 * "Promoted from lessons-learned" section once. Inserts before a trailing
 * `*Version: ...*` footer when present so the footer stays last; otherwise
 * appends at end. Pure.
 *
 * @param {string} moduleMarkdown
 * @param {{ id: string, title?: string, rule?: string }} lesson
 * @returns {string}
 */
export function appendPromotion(moduleMarkdown, lesson) {
  const block = buildModuleAppendBlock(lesson);
  const hasSection = moduleMarkdown.includes(PROMOTED_HEADING);
  const addition = hasSection ? `\n${block}` : `\n${PROMOTED_HEADING}\n\n${block}`;

  // Keep a trailing `---\n\n*Version: ...*` footer last when one exists.
  const footerRe = /\n---\n\n\*[^\n]*\*\s*\n?$/;
  const footerMatch = moduleMarkdown.match(footerRe);
  if (footerMatch) {
    const idx = moduleMarkdown.length - footerMatch[0].length;
    const head = moduleMarkdown.slice(0, idx);
    const footer = moduleMarkdown.slice(idx);
    return `${head.replace(/\s*$/, '')}\n${addition}\n${footer}`;
  }
  return `${moduleMarkdown.replace(/\s*$/, '')}\n${addition}`;
}

/**
 * Build the auto-generated promotion ADR markdown. Pure.
 *
 * @param {{
 *   adrNumber: string, lesson: { id: string, title?: string, rule?: string, promoteLine?: string|null },
 *   targetModule: string, date: string,
 * }} args
 * @returns {string}
 */
export function buildPromotionAdr({ adrNumber, lesson, targetModule, date }) {
  const title = lesson.title || '(untitled)';
  const rule = (lesson.rule || '').trim() || '(no rule recorded)';
  const trigger = (lesson.promoteLine || '').trim();
  return `# ADR-${adrNumber}: Promote ${lesson.id} into ${targetModule}

Date: ${date}
Status: Accepted

## Context

Lesson ${lesson.id} — "${title}" — reached its promotion threshold via the
deterministic counter mechanism shipped in v0.2.i (\`mmd document-lessons\`,
SPEC_V02I). Per scoping §6.5, once a lesson's validated-reuse counter reaches
its \`**To promote if**: N\` threshold it graduates from the dynamic Layer F
(\`docs/lessons-learned.md\`) into the relevant constitution module.

${trigger ? `Trigger line: \`${trigger}\`\n` : ''}
## Decision

Appended the lesson's Rule to \`.specify/memory/constitution/${targetModule}\`
(under a "Promoted from lessons-learned" section) and removed the lesson block
from \`docs/lessons-learned.md\`. The destination module is taken from the
lesson's own \`**To promote if**\` line (else defaults to \`ai-coding.md\`) — the
lesson, not the Documentalist, decides where it belongs.

This promotion was applied automatically (no LLM judgment, no human-in-the-loop
beyond the explicit \`mmd document-lessons\` invocation). The full Documentalist
Worker (v0.5b) will add cron-like triggering and semantic judgment.

## Consequences

- The rule is now load-bearing constitution, injected by binding rather than by
  the keyword composer.
- The lesson no longer appears in \`mmd lessons\` (it is no longer an
  auto-injection candidate).
- Rollback, if ever needed, is manual: revert this ADR's commit.

## Promoted content

### ${lesson.id} — ${title}

**Rule**: ${rule}
`;
}

/**
 * Promote one lesson. dryRun returns the plan without touching files.
 *
 * @param {{
 *   id: string, title?: string, rule?: string,
 *   promoteLine?: string|null, targetModule?: string,
 * }} lesson
 * @param {string} repoRoot
 * @param {{ dryRun?: boolean, lessonsPath?: string, date?: string }} [opts]
 * @returns {Promise<{
 *   action: 'promote'|'promoted', targetModule: string, lessonId: string,
 *   fromLine: string|null, toFile: string, adrPath: string, errors?: string[],
 * }>}
 */
export async function promoteLesson(lesson, repoRoot, opts = {}) {
  const { dryRun = false, lessonsPath, date } = opts;
  const targetModule = lesson.targetModule || resolveTargetModule(lesson.promoteLine || '');
  const toFile = path.join(repoRoot, '.specify', 'memory', 'constitution', targetModule);
  const lessonsFile = lessonsPath || path.join(repoRoot, 'docs', 'lessons-learned.md');
  const adrDir = path.join(repoRoot, 'docs', 'adr');

  let adrFiles = [];
  try {
    adrFiles = await readdir(adrDir);
  } catch {
    // No ADR dir yet → number from scratch.
  }
  const adrNumber = nextAdrNumber(adrFiles);
  const adrPath = path.join(adrDir, `${adrNumber}-lesson-${lesson.id}-promoted.md`);

  if (dryRun) {
    return {
      action: 'promote',
      targetModule,
      lessonId: lesson.id,
      fromLine: lesson.promoteLine || null,
      toFile,
      adrPath,
    };
  }

  const errors = [];

  // 1. Append to the constitution module.
  try {
    const cur = await readFile(toFile, 'utf8');
    await writeFile(toFile, appendPromotion(cur, lesson), 'utf8');
  } catch (err) {
    errors.push(`module append (${targetModule}) failed: ${err.message}`);
  }

  // 2. Remove the block from lessons-learned.md.
  try {
    const cur = await readFile(lessonsFile, 'utf8');
    await writeFile(lessonsFile, removeLessonBlock(cur, lesson.id), 'utf8');
  } catch (err) {
    errors.push(`lessons-learned removal failed: ${err.message}`);
  }

  // 3. Write the promotion ADR.
  try {
    const resolvedDate = date || new Date().toISOString().slice(0, 10);
    await writeFile(
      adrPath,
      buildPromotionAdr({ adrNumber, lesson, targetModule, date: resolvedDate }),
      'utf8',
    );
  } catch (err) {
    errors.push(`ADR write (${adrPath}) failed: ${err.message}`);
  }

  return {
    action: 'promoted',
    targetModule,
    lessonId: lesson.id,
    fromLine: lesson.promoteLine || null,
    toFile,
    adrPath,
    ...(errors.length ? { errors } : {}),
  };
}
