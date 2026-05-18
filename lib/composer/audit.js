// lib/composer/audit.js — observability sidecar for the composer.
//
// SPEC_V02E AC-6: every `mmd` subprocess invocation that uses the composer
// writes a `composer.json` audit trail alongside its run log AND prepends a
// `[composer]` header line to the run log itself. This makes composition
// inspectable post-hoc:
//
//   <rundir>/<timestamp>-<pid>-<rnd>.log              the regular run log
//   <rundir>/<timestamp>-<pid>-<rnd>.composer.json    sidecar audit trail
//
// Schema (frozen by AC-4):
//   {
//     "composer_version": "v0.2e",
//     "lessons_file_sha": "<12-char hex of utf-8 file content>",
//     "matched": [
//       { "id": "L-003", "score": 4, "keywords_hit": [...], "title": "...", "rule": "..." }
//     ],
//     "injected_count": <N>,
//     "elapsed_ms": <ms>,
//     "disabled": <true | undefined>,
//     "missing":  <true | undefined>,
//     "ts": "<ISO timestamp>"
//   }
//
// The sidecar path is derived by replacing the `.log` suffix with
// `.composer.json` — co-located so audit-pillars.sh --with-composer can
// glob `.mmd/local/*/*.composer.json` cheaply.

import { writeFile, mkdir } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { COMPOSER_VERSION } from './format.js';

/**
 * Translate a run-log path to its sidecar `composer.json` path.
 *
 *   foo/bar/2026-05-18.log              → foo/bar/2026-05-18.composer.json
 *   foo/bar/no-extension                → foo/bar/no-extension.composer.json
 *
 * Pure — no I/O. Exported for unit tests.
 *
 * @param {string} logPath
 * @returns {string}
 */
export function composerJsonPathFor(logPath) {
  if (typeof logPath !== 'string' || logPath.length === 0) {
    throw new TypeError('composerJsonPathFor: logPath must be a non-empty string');
  }
  if (logPath.endsWith('.log')) {
    return logPath.slice(0, -'.log'.length) + '.composer.json';
  }
  return `${logPath}.composer.json`;
}

/**
 * Build the audit-trail object from a composer result. Pure — no I/O. Caller
 * can JSON.stringify and persist.
 *
 * @param {object} composerResult       result returned by composeLessons
 * @param {{ ts?: string }} [opts]
 * @returns {object}
 */
export function buildComposerAudit(composerResult, opts = {}) {
  const matched = Array.isArray(composerResult?.injectedLessons)
    ? composerResult.injectedLessons.map((l) => ({
        id: l.id,
        score: l.score,
        keywords_hit: l.keywords_hit,
        title: l.title,
        rule: l.rule,
      }))
    : [];
  const audit = {
    composer_version: composerResult?.composerVersion || COMPOSER_VERSION,
    lessons_file_sha: composerResult?.lessonsFileSha ?? null,
    matched,
    injected_count: matched.length,
    elapsed_ms: composerResult?.elapsedMs ?? 0,
    total_active_lessons: composerResult?.totalActiveLessons ?? 0,
    ts: opts.ts || new Date().toISOString(),
  };
  if (composerResult?.disabled) audit.disabled = true;
  if (composerResult?.missing) audit.missing = true;
  return audit;
}

/**
 * Build the single-line run-log header that announces the composer's action.
 *
 *   [composer] injected 2 lessons: L-003, L-008 (matched against sha abc123def012)
 *   [composer] no lessons matched (sha abc123def012)
 *   [composer] disabled via MMD_COMPOSER_DISABLED
 *   [composer] lessons file missing — no-op
 *
 * @param {object} composerResult
 * @returns {string}
 */
export function composerLogHeader(composerResult) {
  if (!composerResult) return '[composer] (no result)\n';
  if (composerResult.disabled) return '[composer] disabled via MMD_COMPOSER_DISABLED\n';
  if (composerResult.missing) return '[composer] lessons file missing — no-op\n';
  const matched = Array.isArray(composerResult.injectedLessons)
    ? composerResult.injectedLessons
    : [];
  if (matched.length === 0) {
    return `[composer] no lessons matched (sha ${composerResult.lessonsFileSha || '?'})\n`;
  }
  const ids = matched.map((l) => l.id).join(', ');
  return `[composer] injected ${matched.length} lesson(s): ${ids} (matched against sha ${composerResult.lessonsFileSha || '?'})\n`;
}

/**
 * Persist the composer audit trail next to a run log. Async, creates the
 * parent directory if missing.
 *
 * @param {string} logPath
 * @param {object} composerResult
 * @returns {Promise<string>}     resolves with the composer.json path written
 */
export async function writeComposerAudit(logPath, composerResult) {
  const auditPath = composerJsonPathFor(logPath);
  await mkdir(path.dirname(auditPath), { recursive: true });
  const audit = buildComposerAudit(composerResult);
  await writeFile(auditPath, JSON.stringify(audit, null, 2) + '\n', 'utf8');
  return auditPath;
}

/**
 * Sync variant for callers that can't await (CLI entry points).
 */
export function writeComposerAuditSync(logPath, composerResult) {
  const auditPath = composerJsonPathFor(logPath);
  mkdirSync(path.dirname(auditPath), { recursive: true });
  const audit = buildComposerAudit(composerResult);
  writeFileSync(auditPath, JSON.stringify(audit, null, 2) + '\n', 'utf8');
  return auditPath;
}
