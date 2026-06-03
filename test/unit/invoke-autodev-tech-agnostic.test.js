// @unit tests for the technology-agnostic greenfield prompt (SPEC_V010A AC-1)
// and the regression lock on the --here path + profile/Layer-C block (AC-2).
//
// AC-1: the greenfield branch of buildPrompt must contain NONE of the old
//   drawing-camera hardcoding (getUserMedia / Canvas API / camera permission /
//   manifest.json / the fixed `index.html, style.css, app.js` file list) and
//   MUST instruct the agent to (a) derive the stack from .mmd/shared/slice.md,
//   (b) keep it KISS, (c) prefer a no-build browser-previewable web app as a
//   SOFT preference, (d) write .mmd/shared/run.json.
//
// AC-2: (a) a custom `prompt` (the --here path) is returned byte-for-byte
//   unchanged — the §VIII stack-line change appends nothing; (b) a Kid
//   greenfield run still injects the profile line + the Layer-C composed block
//   (or the minimal Kid fallback) exactly as before.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt } from '../../lib/invoke-autodev.js';

const base = { dream: 'a browser PDF editor', slug: 'browser-pdf-editor', demoDir: '/tmp/demo/pdf' };

// ── AC-1: no camera/canvas hardcoding ────────────────────────────────────────

test('@unit AC-1: greenfield prompt contains NONE of the old camera/canvas strings', () => {
  const p = buildPrompt({ ...base, env: {} });
  assert.doesNotMatch(p, /getUserMedia/, 'no getUserMedia');
  assert.doesNotMatch(p, /Canvas API/, 'no Canvas API');
  assert.doesNotMatch(p, /camera permission/i, 'no camera permission directive');
  assert.doesNotMatch(p, /manifest\.json/, 'no manifest.json');
  // The fixed three-file list must be gone (mentioning index.html as an EXAMPLE
  // entry is allowed; the comma-joined generate-these-files list is not).
  assert.doesNotMatch(p, /index\.html,\s*style\.css,\s*app\.js/, 'no fixed file list');
  assert.doesNotMatch(p, /vanilla HTML\/CSS\/JS \+ Canvas/, 'no hardcoded vanilla+canvas stack constraint');
});

test('@unit AC-1: greenfield prompt instructs the agent to DERIVE the stack from slice.md', () => {
  const p = buildPrompt({ ...base, env: {} });
  assert.match(p, /derive/i, 'tells the agent to derive');
  assert.match(p, /\.mmd\/shared\/slice\.md/, 'points at the scope file');
  // No imposed stack/framework/layout.
  assert.match(p, /NO imposed stack|no imposed stack/i);
});

test('@unit AC-1: greenfield prompt keeps it KISS', () => {
  const p = buildPrompt({ ...base, env: {} });
  assert.match(p, /KISS|as simple as the dream allows|simplest/i);
});

test('@unit AC-1: the web-preview preference is SOFT, not a hard constraint', () => {
  const p = buildPrompt({ ...base, env: {} });
  // It mentions the preference for a no-build browser-runnable web app...
  assert.match(p, /browser/i);
  assert.match(p, /no.?build|without a build|no build step/i);
  // ...AND explicitly frames it as soft / never overriding the dream.
  assert.match(p, /SOFT|soft preference|NEVER overrides|not a constraint/);
});

test('@unit AC-1: greenfield prompt requires writing .mmd/shared/run.json', () => {
  const p = buildPrompt({ ...base, env: {} });
  assert.match(p, /\.mmd\/shared\/run\.json/, 'names the run descriptor path');
  // It names the kind vocabulary the reader understands.
  assert.match(p, /web-static/);
  assert.match(p, /\bcli\b/);
});

// ── AC-2(a): the --here path is byte-for-byte unchanged ──────────────────────

test('@unit AC-2: a custom prompt (--here) is returned byte-for-byte, no stack lines appended', () => {
  const custom = 'CUSTOM --here PROMPT\nwith multiple lines\nand no greenfield directives';
  const out = buildPrompt({ ...base, prompt: custom, env: {} });
  assert.equal(out, custom, 'the --here prompt passes through verbatim');
  // None of the greenfield stack directives leaked into the --here path.
  assert.doesNotMatch(out, /DERIVE the simplest technology/);
  assert.doesNotMatch(out, /run\.json/);
});

test('@unit AC-2: --here passthrough holds even with a profile set', () => {
  const custom = 'CUSTOM HERE';
  const out = buildPrompt({ ...base, prompt: custom, env: { MMD_PROFILE: 'Kid' } });
  assert.equal(out, custom);
});

// ── AC-2(b): profile / Layer-C block still injected on the greenfield path ────

test('@unit AC-2: Kid greenfield run still injects profile + composed Layer-C block', () => {
  const composeFn = ({ profile }) => `## Constitution — fake\n\nCOMPOSED-FOR-${profile}`;
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Kid' }, composeFn });
  assert.match(p, /Audience profile: Kid\./, 'profile line preserved');
  assert.match(p, /Project constitution modules bound to this profile/, 'Layer-C block preserved');
  assert.match(p, /COMPOSED-FOR-Kid/);
  // And the technology-agnostic stack directive still present alongside it.
  assert.match(p, /DERIVE the simplest technology/);
});

test('@unit AC-2: Kid greenfield run with null composer still falls back to the minimal Kid line', () => {
  const p = buildPrompt({ ...base, env: { MMD_PROFILE: 'Kid' }, composeFn: () => null });
  assert.match(p, /Audience profile: Kid\./);
  assert.match(p, /Kid safe-by-default \(NON-NEGOTIABLE\)/);
});
