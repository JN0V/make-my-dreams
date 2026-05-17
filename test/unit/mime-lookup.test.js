// test/unit/mime-lookup.test.js — AC-7 MIME allowlist (pure unit, < 100 ms per test).
// Constitution: testing.md §V — every test name carries an @unit tag.
//
// Note: resolveStaticPath runs MIME lookup (step 7) BEFORE per-component symlink
// check (step 8). For non-existent demoRoot paths, lstat ENOENT breaks out
// cleanly at step 8 (treated as a regular 404 case, not a security failure).
// All MIME-shape inputs below therefore return ok:true even with a non-existent
// demoRoot. The actual file-existence check happens later in the request handler.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveStaticPath } from '../../lib/server.js';

// Stable fake demoRoot path. resolveStaticPath only calls fs.lstat on existing
// components; ENOENT breaks out at step 8 without changing ok:true.
const FAKE_DEMO_ROOT = '/tmp/mmd-mime-test-nonexistent-' + Date.now();

const ALLOWLIST = [
  ['/demo/foo/x.html',   '.html',  'text/html; charset=utf-8'],
  ['/demo/foo/x.js',     '.js',    'application/javascript; charset=utf-8'],
  ['/demo/foo/x.css',    '.css',   'text/css; charset=utf-8'],
  ['/demo/foo/x.json',   '.json',  'application/json; charset=utf-8'],
  ['/demo/foo/x.svg',    '.svg',   'image/svg+xml'],
  ['/demo/foo/x.png',    '.png',   'image/png'],
  ['/demo/foo/x.jpg',    '.jpg',   'image/jpeg'],
  ['/demo/foo/x.jpeg',   '.jpeg',  'image/jpeg'],
  ['/demo/foo/x.webp',   '.webp',  'image/webp'],
  ['/demo/foo/x.gif',    '.gif',   'image/gif'],
  ['/demo/foo/x.ico',    '.ico',   'image/x-icon'],
  ['/demo/foo/x.woff2',  '.woff2', 'font/woff2'],
  ['/demo/foo/x.txt',    '.txt',   'text/plain; charset=utf-8'],
];

for (const [url, expectedExt, expectedMime] of ALLOWLIST) {
  test(`@unit MIME allowlist: ${url} -> ${expectedMime}`, () => {
    const r = resolveStaticPath(url, FAKE_DEMO_ROOT);
    assert.equal(r.ok, true, `expected ok:true for ${url}, got ${JSON.stringify(r)}`);
    assert.equal(r.ext, expectedExt);
    assert.equal(r.mime, expectedMime);
    // absolutePath is rooted under demoRoot (canonical containment, AC-7 step 6).
    assert.ok(
      r.absolutePath.startsWith(FAKE_DEMO_ROOT + path.sep),
      `absolutePath must be under demoRoot, got ${r.absolutePath}`,
    );
  });
}

test('@unit MIME allowlist: unknown extension returns 415 unsupported_file_type', () => {
  const r = resolveStaticPath('/demo/foo/payload.exe', FAKE_DEMO_ROOT);
  assert.equal(r.ok, false);
  assert.equal(r.status, 415);
  assert.equal(r.error, 'unsupported_file_type');
  assert.equal(r.attackVector, 'mime_reject');
  assert.equal(r.extension, '.exe');
});

test('@unit MIME allowlist: no extension returns 415 unsupported_file_type', () => {
  const r = resolveStaticPath('/demo/foo/README', FAKE_DEMO_ROOT);
  assert.equal(r.ok, false);
  assert.equal(r.status, 415);
  assert.equal(r.error, 'unsupported_file_type');
  // path.extname('README') === ''
  assert.equal(r.extension, '');
});
