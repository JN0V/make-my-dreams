// Red-Green test for the camera UX failure observed in v0.1:
// when opened via file://, the PWA reports "Camera API not available in this browser"
// even though the API IS available — it's just blocked by the browser's secure-context
// gate. The misleading message led Sébastien to think the app was broken.
//
// Per constitution v1.2 principle IV: "Every failure deserves a red-green pass —
// not just bugs." This test goes red on the old behavior, green on the fix that
// distinguishes "API absent" from "API blocked by non-secure context".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_JS = resolve(__dirname, '../../demo/drawing-app-camera-overlay/app.js');

describe('PWA camera — secure context handling (v0.1 deferred E-Bonus)', () => {
  it('app.js must check window.isSecureContext before claiming "API not available"', async () => {
    const src = await readFile(APP_JS, 'utf8');
    // The fix introduces an explicit isSecureContext branch with a tailored message
    // that mentions http://localhost or https:// as the remedy. Without this branch,
    // users opening via file:// see a misleading "not available in this browser" message.
    assert.match(
      src,
      /isSecureContext/,
      'app.js should check window.isSecureContext to distinguish "API absent" from "blocked by non-secure context"'
    );
    assert.match(
      src,
      /localhost|https/i,
      'app.js should mention the remedy (open via http://localhost or https://) when the API is blocked by a non-secure context'
    );
  });

  it('app.js must still handle the genuinely-absent API case', async () => {
    const src = await readFile(APP_JS, 'utf8');
    // The fix should keep the !navigator.mediaDevices check, but only for the
    // truly-old-browser case — not for non-secure-context blocking.
    assert.match(src, /navigator\.mediaDevices/);
  });
});
