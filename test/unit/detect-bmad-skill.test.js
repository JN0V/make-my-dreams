// @unit tests for the greenfield/serve BMAD preflight detector
// (lib/onboarding/detect-bmad-skill.js). Pure: injected existsDirFn, no real fs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  detectBmadProductBrief,
  bmadMissingMessage,
  PRODUCT_BRIEF_SKILL_REL,
} from '../../lib/onboarding/detect-bmad-skill.js';

const projPath = (cwd) => path.join(cwd, PRODUCT_BRIEF_SKILL_REL);
const globPath = (home) => path.join(home, PRODUCT_BRIEF_SKILL_REL);

test('@unit available when the skill dir exists in the PROJECT (cwd)', () => {
  const cwd = '/work/app';
  const home = '/home/u';
  const r = detectBmadProductBrief({ cwd, home, existsDirFn: (p) => p === projPath(cwd) });
  assert.equal(r.available, true);
  assert.deepEqual(r.checked, [projPath(cwd), globPath(home)]);
});

test('@unit available when the skill dir exists only GLOBALLY (~/.claude)', () => {
  const cwd = '/work/app';
  const home = '/home/u';
  const r = detectBmadProductBrief({ cwd, home, existsDirFn: (p) => p === globPath(home) });
  assert.equal(r.available, true);
});

test('@unit NOT available when neither project nor global has the skill', () => {
  const r = detectBmadProductBrief({ cwd: '/work/app', home: '/home/u', existsDirFn: () => false });
  assert.equal(r.available, false);
  assert.equal(r.checked.length, 2);
});

test('@unit never throws on junk input', () => {
  assert.doesNotThrow(() => detectBmadProductBrief({}));
  assert.doesNotThrow(() => detectBmadProductBrief({ cwd: null, home: undefined }));
  assert.doesNotThrow(() => detectBmadProductBrief());
  const r = detectBmadProductBrief({ cwd: '', home: '', existsDirFn: () => true });
  assert.equal(r.available, false); // nothing checked → not available
  assert.deepEqual(r.checked, []);
});

test('@unit bmadMissingMessage is honest + actionable (names the skill, install path, cwd, bypass)', () => {
  const msg = bmadMissingMessage({
    cwd: '/work/app',
    checked: ['/work/app/.claude/skills/bmad-product-brief', '/home/u/.claude/skills/bmad-product-brief'],
    flow: 'serve',
  });
  assert.match(msg, /bmad-product-brief/);
  assert.match(msg, /install-mmd\.sh \./);
  assert.match(msg, /\/work\/app/);
  assert.match(msg, /MMD_SKIP_SETUP=1/);
  assert.match(msg, /mmdream serve/); // flow-specific phrasing
});

test('@unit bmadMissingMessage greenfield flow phrasing differs from serve', () => {
  const g = bmadMissingMessage({ cwd: '/x', checked: [], flow: 'greenfield' });
  assert.match(g, /greenfield/);
  assert.doesNotMatch(g, /mmdream serve/);
});
