// lib/bench/load-dreams.js — read and validate bench/dreams/*.md.
//
// Spec: SPEC_V02B AC-2 + AC-3.
// SRP: this module owns the dream-file parser. It does NOT know about runs,
// metrics, or the CLI — those layers compose with the array we return.
//
// Schema (cf bench/dreams/SCHEMA.md):
//   front-matter (YAML-lite, --- delimited):
//     id (string, must equal basename without .md, /^[a-z0-9-]+$/)
//     audience ('kid' | 'pro')
//     complexity ('trivial' | 'simple' | 'moderate')
//     dream (string)
//     reality_check_min_assertions (integer >= 1)
//
// We deliberately use a hand-rolled YAML-lite parser rather than pulling in
// the `yaml` npm package — universal.md §II KISS + the v0.2 vanilla-stack
// constraint (see SPEC_V01 + lib/parse-dream.js). The parser is strict on
// the keys it knows about and silent on the keys it doesn't (forward
// compatibility per universal.md §I.O Open/Closed).

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_AUDIENCE = Object.freeze(['kid', 'pro']);
const ALLOWED_COMPLEXITY = Object.freeze(['trivial', 'simple', 'moderate']);
const ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/**
 * Parse a single dream file's contents. Pure function — given the raw file
 * body and the basename, returns either a validated dream object or throws
 * an Error with a precise diagnostic (error-handling.md §II — every error
 * names the rule that was violated AND the offending value).
 *
 * @param {string} raw       file content
 * @param {string} basename  file basename without `.md` (used to validate id)
 * @returns {{
 *   id: string,
 *   audience: 'kid'|'pro',
 *   complexity: 'trivial'|'simple'|'moderate',
 *   dream: string,
 *   reality_check_min_assertions: number,
 * }}
 */
export function parseDreamFile(raw, basename) {
  if (typeof raw !== 'string') {
    throw new TypeError('parseDreamFile: raw content must be a string');
  }
  if (!raw.startsWith('---')) {
    throw new Error(
      `dream '${basename}': missing front-matter (file must start with '---')`,
    );
  }
  // Find the closing '---' on its own line.
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== '---') {
    throw new Error(
      `dream '${basename}': front-matter must open with '---' on its own line`,
    );
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    throw new Error(
      `dream '${basename}': front-matter is not closed (no terminating '---')`,
    );
  }
  const frontMatter = {};
  for (let i = 1; i < endIdx; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(
        `dream '${basename}': front-matter line ${i + 1} missing ':' (got '${line}')`,
      );
    }
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding single/double quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontMatter[key] = value;
  }

  // --- Validation per SCHEMA.md ---
  const required = ['id', 'audience', 'complexity', 'dream', 'reality_check_min_assertions'];
  for (const k of required) {
    if (!(k in frontMatter)) {
      throw new Error(`dream '${basename}': missing required front-matter key '${k}'`);
    }
  }
  if (frontMatter.id !== basename) {
    throw new Error(
      `dream '${basename}': id ('${frontMatter.id}') must equal basename ('${basename}')`,
    );
  }
  if (!ID_RE.test(frontMatter.id)) {
    throw new Error(
      `dream '${basename}': id must match /^[a-z0-9][a-z0-9-]*[a-z0-9]$/, got '${frontMatter.id}'`,
    );
  }
  if (!ALLOWED_AUDIENCE.includes(frontMatter.audience)) {
    throw new Error(
      `dream '${basename}': audience must be one of ${ALLOWED_AUDIENCE.join('|')}, got '${frontMatter.audience}'`,
    );
  }
  if (!ALLOWED_COMPLEXITY.includes(frontMatter.complexity)) {
    throw new Error(
      `dream '${basename}': complexity must be one of ${ALLOWED_COMPLEXITY.join('|')}, got '${frontMatter.complexity}'`,
    );
  }
  if (typeof frontMatter.dream !== 'string' || frontMatter.dream.length === 0) {
    throw new Error(`dream '${basename}': dream must be a non-empty string`);
  }
  const rc = Number(frontMatter.reality_check_min_assertions);
  if (!Number.isInteger(rc) || rc < 1) {
    throw new Error(
      `dream '${basename}': reality_check_min_assertions must be an integer >= 1, got '${frontMatter.reality_check_min_assertions}'`,
    );
  }
  return {
    id: frontMatter.id,
    audience: frontMatter.audience,
    complexity: frontMatter.complexity,
    dream: frontMatter.dream,
    reality_check_min_assertions: rc,
  };
}

/**
 * Load every dream from `dreamsDir` (defaults to `<cwd>/bench/dreams/`),
 * optionally filtered to a comma-separated id list. The returned array is
 * sorted by id for deterministic ordering in the report (AC-5 "deterministic
 * — no LLM call").
 *
 * @param {object} [opts]
 * @param {string} [opts.dreamsDir]  Directory containing the *.md files.
 * @param {string[]|null} [opts.ids] Optional filter: only these ids are loaded.
 * @returns {Promise<Array>}
 */
export async function loadDreams({ dreamsDir, ids = null } = {}) {
  const dir = dreamsDir || path.join(process.cwd(), 'bench', 'dreams');
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`loadDreams: cannot read '${dir}': ${err.code || ''} ${err.message}`);
  }
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'SCHEMA.md')
    .map((e) => e.name);
  const dreams = [];
  for (const filename of mdFiles) {
    const basename = filename.slice(0, -3); // drop '.md'
    const raw = await readFile(path.join(dir, filename), 'utf8');
    const dream = parseDreamFile(raw, basename);
    dreams.push(dream);
  }
  if (Array.isArray(ids) && ids.length > 0) {
    const wanted = new Set(ids);
    const filtered = dreams.filter((d) => wanted.has(d.id));
    const missing = ids.filter((id) => !dreams.some((d) => d.id === id));
    if (missing.length > 0) {
      throw new Error(
        `loadDreams: requested ids not found in '${dir}': ${missing.join(', ')}`,
      );
    }
    return filtered.sort((a, b) => a.id.localeCompare(b.id));
  }
  return dreams.sort((a, b) => a.id.localeCompare(b.id));
}
