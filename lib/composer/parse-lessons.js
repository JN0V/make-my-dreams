// lib/composer/parse-lessons.js — pure parser for docs/lessons-learned.md.
//
// SPEC_V02E AC-2: parse the project-scoped lessons file into structured
// entries:
//
//   { id: "L-001", title, keywords: string[], rule: string, status }
//
// The file format follows the template in scoping §6.5 (L-042 example) but
// is hand-written, so the parser MUST tolerate the existing slight
// inconsistencies (some lessons use `**Rule**:` vs `**Rule** (operative ...)`,
// some have Status `milestone` vs `active`, keywords may be comma- OR
// pipe-separated). Per AC-2 the parser logs warnings for unparseable lessons
// but never throws — best-effort, tolerant.
//
// Pure function: takes raw markdown text + optional onWarn callback, returns
// an array. File I/O lives in the caller (lib/composer/match.js#composeLessons).

/**
 * Parse the project-scoped lessons-learned.md markdown text into structured
 * lessons. Returns all parsed lessons regardless of status — the caller
 * filters (e.g. matchLessons only keeps status==='active').
 *
 * Tolerates:
 *   - **Rule**:    vs   **Rule** (operative implication ...):
 *   - **Status**: active (1 occurrence ...)   → status === 'active' (first word lowercased)
 *   - **Keywords for matching**: foo, bar | baz   → ['foo', 'bar', 'baz']
 *   - Multi-line rules (numbered lists, code blocks, free prose) until the
 *     next `^**FieldName**` line or end of lesson block.
 *
 * @param {string} markdown
 * @param {{ onWarn?: (msg: string) => void }} [opts]
 * @returns {Array<{ id: string, title: string, status: string, rule: string, keywords: string[] }>}
 */
export function parseLessons(markdown, { onWarn = () => {} } = {}) {
  if (typeof markdown !== 'string') {
    throw new TypeError('parseLessons: markdown must be a string');
  }
  const lines = markdown.split('\n');
  const blocks = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(/^## (L-\d+)\s+[—–-]\s+(.+?)\s*$/);
    if (headerMatch) {
      if (current) blocks.push(current);
      current = { id: headerMatch[1], title: headerMatch[2].trim(), body: [] };
      continue;
    }
    // F13 (Phase-4 review): catch malformed `## L-NNN` headers that lack
    // the canonical separator (em-dash, en-dash, or hyphen). F22 (Phase-4
    // re-review): when this happens, ALSO drop the lesson body — otherwise
    // the malformed lesson's **Rule** / **Keywords** etc. would bleed into
    // the PREVIOUS lesson's body and corrupt its parsed fields.
    const malformedHeader = lines[i].match(/^## (L-\d+)\b/);
    if (malformedHeader && !headerMatch) {
      onWarn(`parse-lessons: ${malformedHeader[1]} header is malformed — expected '## ${malformedHeader[1]} — <title>' with a separator. Lesson dropped.`);
      // Push the previous lesson (its body is intact) and stop appending
      // until the next valid header arrives.
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    if (current) current.body.push(lines[i]);
  }
  if (current) blocks.push(current);

  const lessons = [];
  for (const block of blocks) {
    const fields = collectFields(block.body);
    const statusField = fields.find((f) => f.name === 'Status');
    const ruleField = fields.find((f) => f.name === 'Rule');
    const keywordsField = fields.find((f) => f.name === 'Keywords for matching');

    let status = 'unknown';
    if (statusField) {
      const firstToken = statusField.value.trim().split(/\s+/)[0] || '';
      status = firstToken.toLowerCase();
    } else {
      onWarn(`parse-lessons: ${block.id} has no **Status** field — defaulting to 'unknown'`);
    }

    // Trim trailing `---` separator lines off the rule body when the rule
    // happened to be the last field in the lesson block.
    const rule = ruleField
      ? ruleField.value.replace(/\n+---\s*$/m, '').trim()
      : '';
    if (!rule && status === 'active') {
      onWarn(`parse-lessons: ${block.id} (active) has no **Rule** field — skipping rule body`);
    }

    let keywords = [];
    if (keywordsField) {
      // Keywords are a single-line field. Take only the first line and drop
      // any trailing separators (e.g. the `---` that ends each lesson block)
      // and inline parenthetical asides.
      // F24 (Phase-4 re-review): named `keywordLines` to avoid shadowing the
      // outer-scope `lines` from parseLessons.
      const keywordLines = keywordsField.value.split('\n');
      const firstLine = keywordLines[0];
      // F8 (Phase-4 review): warn loudly when a lesson wraps its keywords
      // across multiple lines — everything past line 1 is silently
      // ignored (KISS — comma split + line break is too ambiguous to
      // handle correctly). The warning makes the dropped content visible
      // rather than failing silently. Filter out blank lines, the `---`
      // boundary, and italic file-footer prose (lines starting with `*`).
      const trailingNonEmpty = keywordLines.slice(1).find((l) => {
        const t = l.trim();
        return t.length > 0 && t !== '---' && !t.startsWith('*');
      });
      if (trailingNonEmpty) {
        onWarn(`parse-lessons: ${block.id} has multi-line **Keywords for matching** — only line 1 is parsed (single-line field). Joined: '${trailingNonEmpty.trim()}' was dropped.`);
      }
      keywords = firstLine
        .split(/[,|]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0 && k !== '---');
    } else if (status === 'active') {
      onWarn(`parse-lessons: ${block.id} (active) has no **Keywords for matching** field — will never match`);
    }

    lessons.push({
      id: block.id,
      title: block.title,
      status,
      rule,
      keywords,
    });
  }
  return lessons;
}

/**
 * Collect `**FieldName** [(parenthetical)]:` lines + the multi-line value that
 * follows each one (until the next field-line or end of block).
 *
 * @param {string[]} bodyLines
 * @returns {Array<{ name: string, value: string }>}
 */
function collectFields(bodyLines) {
  const fieldRe = /^\*\*([A-Z][^*]+?)\*\*(?:\s*\([^)]+\))?\s*:\s*(.*)$/;
  const positions = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const m = bodyLines[i].match(fieldRe);
    if (m) {
      positions.push({ name: m[1].trim(), firstLineValue: m[2], lineIdx: i });
    }
  }
  const fields = [];
  for (let fi = 0; fi < positions.length; fi++) {
    const pos = positions[fi];
    let endLine = fi + 1 < positions.length ? positions[fi + 1].lineIdx : bodyLines.length;
    // F19 (Phase-4 re-review): trim the field's value at the FIRST `---`
    // separator AFTER the field-start line. The last field of a lesson
    // would otherwise inherit the lesson's trailing `---` plus any file-
    // footer prose that follows, producing spurious warnings on Keywords
    // multi-line detection and bloated Rule bodies. Stop also at the
    // first blank line followed by a `*...` line (italic footer comment).
    for (let j = pos.lineIdx + 1; j < endLine; j++) {
      if (/^---\s*$/.test(bodyLines[j])) {
        endLine = j;
        break;
      }
    }
    const parts = [pos.firstLineValue];
    for (let j = pos.lineIdx + 1; j < endLine; j++) {
      parts.push(bodyLines[j]);
    }
    fields.push({ name: pos.name, value: parts.join('\n') });
  }
  return fields;
}
