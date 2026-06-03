// @unit anchor tests for two install hygiene fixes (field bugs):
//   Bug 1 — skill-manifest.csv row must have 5 columns (header shape), not 6
//           (a stray trailing "false" broke the BMAD 5-column parser).
//   Bug 2 — the legacy .claude/commands/bmad-<adv>-auto-dev.md is only written
//           when BMAD has NOT provided the skill under .claude/skills/ (else it
//           is a duplicate), and the /mmdream command is materialized GLOBAL-ONLY
//           (a project copy would duplicate it in-session).
//
// Source-content anchors (the project's install-test idiom): fast, deterministic,
// and they pin the exact lines so a future edit can't silently reintroduce the
// extra column or the duplicate command location.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALL_MMD = readFileSync(path.join(REPO_ROOT, 'install-mmd.sh'), 'utf8');

test('@unit Bug 1: the skill-manifest auto-dev row has 5 columns (no trailing "false")', () => {
  const line = INSTALL_MMD.split('\n').find((l) => l.startsWith('MANIFEST_ENTRY='));
  assert.ok(line, 'MANIFEST_ENTRY= line must exist');
  assert.doesNotMatch(line, /,\\"false\\"/, 'the stray 6th column ,"false" must be gone');
  // Count the top-level CSV fields: each is a \"...\" group → 5 of them.
  const fields = line.match(/\\"(?:[^"\\]|\\.)*?\\"/g) || [];
  assert.equal(fields.length, 5, `auto-dev manifest row must have 5 fields, got ${fields.length}: ${line}`);
  // Last field is the workflow path (was previously followed by the bogus "false").
  // The line ends with the field-close \" then the shell-string-close " → \"".
  assert.match(line, /workflows\/auto-dev\/workflow\.md\\""$/, 'row must END at the workflow.md path');
});

test('@unit Bug 2a: the legacy bmad-<adv>-auto-dev command is guarded by the .claude/skills check', () => {
  assert.match(INSTALL_MMD, /SKILL_DIR="\$TARGET\/\.claude\/skills\/bmad-\$\{ADV_CODE\}-auto-dev"/,
    'must compute the BMAD skills dir');
  assert.match(INSTALL_MMD, /if \[ -d "\$SKILL_DIR" \]; then/,
    'the legacy command write must be guarded on the skills dir existing');
  assert.match(INSTALL_MMD, /rm -f "\$COMMAND_FILE"/,
    'a stale legacy command copy must be removed when BMAD provides the skill (de-dup)');
});

test('@unit Bug 2b: /mmdream is materialized GLOBAL-only, with a project-copy de-dup', () => {
  // The materialization block writes the global copy and removes a project copy.
  const block = INSTALL_MMD.slice(
    INSTALL_MMD.indexOf('MMD_SLASH_COMMAND_MATERIALIZE_BEGIN'),
    INSTALL_MMD.indexOf('MMD_SLASH_COMMAND_MATERIALIZE_END'),
  );
  assert.match(block, /cp "\$MMD_CMD_SRC" "\$MMD_CMD_DST_GLOBAL"/, 'writes the global copy');
  assert.match(block, /rm -f "\$MMD_CMD_DST"/, 'removes a stale project copy (de-dup)');
  // It must NOT cp to the project dest anymore.
  assert.doesNotMatch(block, /cp "\$MMD_CMD_SRC" "\$MMD_CMD_DST"\b/, 'must not write a project copy');
});
