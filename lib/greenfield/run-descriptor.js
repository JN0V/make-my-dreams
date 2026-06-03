// lib/greenfield/run-descriptor.js — read the agent-written run descriptor and
// decide whether a finished greenfield build can be previewed in a browser.
//
// Why this exists (SPEC_V010A, ADR-048): the greenfield build prompt is now
// technology-agnostic — the agent DERIVES the stack from the dream instead of
// being forced into a camera/canvas web app. So the downstream preview path
// (Reality Check, serve) can no longer ASSUME an index.html. The agent records
// what it built in `.mmd/shared/run.json`; this module reads that descriptor
// defensively so the preview path can degrade honestly for a non-web build
// (§VIII detect-and-refuse applied to the preview side) instead of FAILing on /
// faking a missing index.html.
//
// Constitution: §II KISS (JSON.parse in a try/catch + existsSync — zero deps,
//               the L-024 vanilla bar), §VI honesty (never throws; a missing or
//               garbage descriptor → null/false, never a fabricated kind).
//
// Public API (both PURE, both NEVER throw):
//   - readRunDescriptor(demoDir)          → { kind, entry, run } | null
//   - isWebPreviewable(descriptor, demoDir) → boolean

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Read `<demoDir>/.mmd/shared/run.json` — the descriptor the build agent writes
 * to declare what it produced.
 *
 * A descriptor is only "valid" when it parses to a plain object carrying a
 * non-empty string `kind` (the field every downstream consumer keys off). A
 * missing file, unreadable file, malformed JSON, a non-object, or an object
 * with no usable `kind` ALL degrade to `null` — never an exception, never a
 * half-built object that would mislead the caller (universal §VI). When `null`
 * is returned, callers fall back to the back-compat bare-`index.html` check.
 *
 * @param {string} demoDir  the finished build directory
 * @returns {{ kind: string, entry: (string|undefined), run: (string|undefined) } | null}
 */
export function readRunDescriptor(demoDir) {
  if (typeof demoDir !== 'string' || demoDir.length === 0) return null;
  const descriptorPath = path.join(demoDir, '.mmd', 'shared', 'run.json');
  let raw;
  try {
    raw = readFileSync(descriptorPath, 'utf8');
  } catch {
    // Absent / unreadable — the common case (older builds, the agent forgot).
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // malformed JSON
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (typeof parsed.kind !== 'string' || parsed.kind.trim().length === 0) return null;
  return {
    kind: parsed.kind,
    entry: typeof parsed.entry === 'string' ? parsed.entry : undefined,
    run: typeof parsed.run === 'string' ? parsed.run : undefined,
  };
}

/**
 * Decide whether a finished build can be opened in a browser as a no-build
 * static web app — the precondition the Reality Check + serve preview paths
 * need before they open `file://…/index.html`.
 *
 * Rules (SPEC_V010A AC-3):
 *   1. Descriptor present + `kind === 'web-static'` + a real `entry` FILE under
 *      demoDir → true. (The agent told us it's a previewable web app and the
 *      entry point actually exists on disk.)
 *   2. No descriptor (null) + a bare `index.html` present in demoDir → true.
 *      This is the BACK-COMPAT path: every pre-v0.10 build (and any build where
 *      the agent forgot the descriptor) still previews exactly as before.
 *   3. Anything else → false. A non-web kind (cli/service/library/other), a
 *      web-static descriptor whose entry file is missing, or no descriptor AND
 *      no index.html all degrade honestly to "not previewable".
 *
 * @param {{ kind: string, entry?: string } | null} descriptor  from readRunDescriptor
 * @param {string} demoDir  the finished build directory
 * @returns {boolean}
 */
export function isWebPreviewable(descriptor, demoDir) {
  if (typeof demoDir !== 'string' || demoDir.length === 0) return false;

  // No descriptor → back-compat: a bare index.html is previewable.
  if (!descriptor || typeof descriptor !== 'object') {
    return entryExists(demoDir, 'index.html');
  }

  // Descriptor present → only an explicit web-static kind with a real entry
  // file is previewable. A descriptor that names a non-web kind is honestly
  // NOT previewable (no silent fall-through to the index.html guess).
  if (descriptor.kind === 'web-static' && typeof descriptor.entry === 'string'
      && descriptor.entry.length > 0) {
    return entryExists(demoDir, descriptor.entry);
  }
  return false;
}

/** Does `<demoDir>/<relEntry>` exist as a real path? Never throws. */
function entryExists(demoDir, relEntry) {
  try {
    return existsSync(path.join(demoDir, relEntry));
  } catch {
    return false;
  }
}
