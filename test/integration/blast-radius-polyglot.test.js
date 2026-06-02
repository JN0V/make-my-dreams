// @integration tests for the POLYGLOT blast radius (SPEC_V081 AC-3/AC-5). Proves
// the import-graph core is language-neutral by driving computeBlastRadius end to
// end through the adapter registry on:
//   - a JS-only repo      → identical reverse closure + empty unanalyzed (the lock)
//   - a Python repo       → a REAL reverse closure from import/from resolution
//   - a mixed JS+Python    → edges for BOTH languages
//   - a repo with a Rust   → the Rust file in `unanalyzed`, NEVER faked
// Pure over an in-memory file map (no real fs) — the same io seam the sealed gate
// uses, so this exercises the real dispatch path.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeBlastRadius } from '../../lib/sealed-tests/blast-radius.js';

function makeIo(files) {
  return {
    listFiles: () => Object.keys(files),
    readFile: (rel) => {
      if (!(rel in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[rel];
    },
  };
}

// ── AC-3: JS-only repo → same closure + empty unanalyzed (regression lock) ──

test('@integration polyglot blast radius: a JS-only repo behaves exactly as before (empty unanalyzed)', () => {
  const io = makeIo({
    'lib/a.js': 'export const a = 1;',
    'lib/b.js': "import { a } from './a.js';",
    'lib/c.js': "import './b.js';",
  });
  const r = computeBlastRadius(['lib/a.js'], io);
  assert.deepEqual(r.importers, ['lib/b.js']); // direct
  assert.deepEqual(r.transitive, ['lib/b.js', 'lib/c.js']); // A←B←C
  assert.deepEqual(r.unanalyzed, []); // all-JS → nothing un-analyzed
});

// ── AC-5: a Python repo → a real reverse closure ────────────────────────────

test('@integration polyglot blast radius: a Python repo yields a real reverse closure', () => {
  // app/models.py is imported by app/service.py (from app.models import …) which
  // is imported by app/main.py (import app.service). A change to models surfaces
  // both service and main.
  const io = makeIo({
    'app/__init__.py': '',
    'app/models.py': 'class User: pass',
    'app/service.py': 'from app.models import User\n\ndef list_users(): return []',
    'app/main.py': 'import app.service\nimport os  # stdlib, dropped\n',
  });
  const r = computeBlastRadius(['app/models.py'], io);
  assert.deepEqual(r.importers, ['app/service.py']); // direct importer
  assert.deepEqual(r.transitive, ['app/main.py', 'app/service.py']); // transitive closure
  assert.deepEqual(r.unanalyzed, []); // Python IS adapted → nothing un-analyzed
});

// ── AC-5: a mixed JS+Python repo → edges for BOTH languages ──────────────────

test('@integration polyglot blast radius: a mixed JS+Python repo produces edges for both', () => {
  const io = makeIo({
    // JS island
    'web/util.js': 'export const u = 1;',
    'web/app.js': "import { u } from './util.js';",
    // Python island
    'svc/models.py': 'class M: pass',
    'svc/api.py': 'from svc.models import M',
  });
  const js = computeBlastRadius(['web/util.js'], io);
  assert.deepEqual(js.transitive, ['web/app.js']);
  assert.deepEqual(js.unanalyzed, []);

  const py = computeBlastRadius(['svc/models.py'], io);
  assert.deepEqual(py.transitive, ['svc/api.py']);
  assert.deepEqual(py.unanalyzed, []);

  // A change spanning both islands surfaces both closures, still no unanalyzed.
  const both = computeBlastRadius(['web/util.js', 'svc/models.py'], io);
  assert.deepEqual(both.transitive.sort(), ['svc/api.py', 'web/app.js']);
  assert.deepEqual(both.unanalyzed, []);
});

// ── AC-5: a Rust file is recorded un-analyzed, NEVER faked ───────────────────

test('@integration polyglot blast radius: a Rust file lands in unanalyzed with no fabricated edges', () => {
  const io = makeIo({
    'lib/a.js': 'export const a = 1;',
    'lib/b.js': "import { a } from './a.js';",
    'src/main.rs': 'mod a;\nuse crate::a;\nfn main() {}', // no Rust adapter
    'src/lib.rs': 'pub mod a;',
  });
  const r = computeBlastRadius(['lib/a.js'], io);
  // The JS closure is unaffected by the presence of Rust files.
  assert.deepEqual(r.transitive, ['lib/b.js']);
  // The Rust files are honestly reported as un-analyzed — NOT silently dropped
  // as if they had no dependencies (§VIII / §VI).
  assert.deepEqual(
    r.unanalyzed.sort((x, y) => (x.file < y.file ? -1 : 1)),
    [
      { file: 'src/lib.rs', language: 'Rust' },
      { file: 'src/main.rs', language: 'Rust' },
    ],
  );
});
