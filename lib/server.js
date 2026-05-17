// lib/server.js — HTTP routing for `mmd serve` (v0.2.5).
// SRP (constitution §I.S): routing + request validation + subprocess orchestration.
// SSE wire format lives in lib/sse.js. Security headers in lib/security-headers.js.
// Rate-limit bucket in lib/rate-limit.js.
//
// Per SPEC_V025.md §3 + AC-1 through AC-10.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, stat, realpath } from 'node:fs/promises';
import {
  createReadStream, openSync, writeSync, closeSync,
  readFileSync, mkdirSync, existsSync, lstatSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { slugify } from './parse-dream.js';
import { applySecurityHeaders, isAllowedOrigin, isAllowedHost } from './security-headers.js';
import { createRateLimiter, parseRateLimitFromEnv } from './rate-limit.js';
import { createStream } from './sse.js';

const UI_DIR = path.resolve(fileURLToPath(new URL('../bin/serve-ui/', import.meta.url)));
const PKG_PATH = path.resolve(fileURLToPath(new URL('../package.json', import.meta.url)));
const PKG_VERSION = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;

// MIME allowlist per AC-7. Anything else → 415.
const MIME_ALLOWLIST = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
});

// UUID v4 shape check (cheap; full validation not required, just disambiguation from slug).
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Inline 1x1 transparent SVG favicon (silences 404 per F20).
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

const MAX_BODY_BYTES = 4096;
const MAX_DREAM_LEN = 500;

/* ──────────────────────────── Structured logging ───────────────────────────── */

function logEvent(level, message, context) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    context: context || {},
  });
  process.stdout.write(line + '\n');
}

/* ─────────────────────────────── Audit log ─────────────────────────────────── */
// G17 — append-only JSONL at .mmd/audit.log. Opened in O_APPEND, never truncated.

const AUDIT_EVENTS = new Set([
  'dream_submitted', 'dream_rejected', 'subprocess_exit', 'path_traversal_blocked',
]);

function makeAuditAppender(cwdRoot) {
  const auditDir = path.join(cwdRoot, '.mmd');
  const auditPath = path.join(auditDir, 'audit.log');
  let fd = null;
  let openError = null;
  try {
    // Best-effort directory creation. mkdirSync is sync on purpose: we want the FD
    // ready before any request comes in.
    mkdirSync(auditDir, { recursive: true });
    // O_APPEND keeps concurrent writes atomic per POSIX (we only have one writer though).
    fd = openSync(auditPath, 'a');
  } catch (err) {
    openError = err;
    logEvent('error', 'audit_log_unavailable', { error: err.message, path: auditPath });
  }
  return {
    append(event, ctx) {
      if (!AUDIT_EVENTS.has(event)) return;
      if (fd === null) return;
      const line = JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        actor: 'local-user',
        ...ctx,
      }) + '\n';
      try {
        writeSync(fd, line);
      } catch (err) {
        logEvent('error', 'audit_write_failed', { error: err.message });
      }
    },
    close() {
      if (fd !== null) {
        try { closeSync(fd); } catch { /* best-effort */ }
        fd = null;
      }
    },
    _path: auditPath,
    _openError: openError,
  };
}

/* ─────────────────────────── Path-traversal defense ────────────────────────── */
// AC-7 algorithm.

/**
 * Validate a /demo/* URL. Returns either {ok: true, absolutePath, ext} or
 * {ok: false, status, error, attackVector}.
 * @param {string} rawUrl       e.g. "/demo/<slug>/index.html?foo=bar"
 * @param {string} demoRoot     resolved DEMO_ROOT (already realpath'd at boot)
 */
export function resolveStaticPath(rawUrl, demoRoot) {
  // Step 1: reject null bytes in raw URL (before decode).
  if (rawUrl.includes('\x00')) {
    return { ok: false, status: 403, error: 'forbidden_path', attackVector: 'null_byte_raw' };
  }
  // Step 2: reject backslashes (Windows traversal vector).
  const rawPathOnly = rawUrl.split('?')[0];
  if (rawPathOnly.includes('\\')) {
    return { ok: false, status: 403, error: 'forbidden_path', attackVector: 'backslash' };
  }
  // Step 3: decode exactly once.
  let decoded;
  try {
    decoded = decodeURIComponent(rawPathOnly);
  } catch {
    return { ok: false, status: 400, error: 'invalid_path_encoding', attackVector: 'malformed_encoding' };
  }
  if (decoded.includes('\x00')) {
    return { ok: false, status: 403, error: 'forbidden_path', attackVector: 'null_byte_decoded' };
  }
  // Strip the /demo prefix.
  if (!decoded.startsWith('/demo/') && decoded !== '/demo') {
    // Caller's responsibility to only call this for /demo* paths.
    return { ok: false, status: 403, error: 'forbidden_path', attackVector: 'prefix_mismatch' };
  }
  const sub = decoded.slice('/demo'.length); // "/<rest>" or ""
  // Step 4: normalize + reject `..` segments.
  const normalized = path.posix.normalize(sub || '/');
  if (normalized === '.' || normalized === '/') {
    // Listing /demo itself is 403 (no directory listings).
    return { ok: false, status: 403, error: 'forbidden_path', attackVector: 'root_listing' };
  }
  if (normalized.split('/').some((seg) => seg === '..')) {
    return { ok: false, status: 403, error: 'forbidden_path', attackVector: 'parent_segment' };
  }
  // Step 5: resolve.
  const resolved = path.resolve(demoRoot, '.' + normalized);
  // Step 6: prefix check (canonical containment).
  if (!resolved.startsWith(demoRoot + path.sep)) {
    return { ok: false, status: 403, error: 'forbidden_path', attackVector: 'prefix_escape' };
  }
  // Step 7: MIME lookup (extension allowlist).
  const ext = path.extname(resolved).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(MIME_ALLOWLIST, ext)) {
    return { ok: false, status: 415, error: 'unsupported_file_type', attackVector: 'mime_reject', extension: ext };
  }
  // Step 8: per-component symlink check. lstat each segment from demoRoot down to resolved.
  const relParts = path.relative(demoRoot, resolved).split(path.sep);
  let cursor = demoRoot;
  for (const part of relParts) {
    cursor = path.join(cursor, part);
    let st;
    try {
      st = lstatSync(cursor);
    } catch (err) {
      // If the path simply doesn't exist (ENOENT), the regular file-serve will 404 below.
      // We're not failing security here for ENOENT.
      if (err && err.code === 'ENOENT') break;
      return { ok: false, status: 403, error: 'forbidden_path', attackVector: 'lstat_failed' };
    }
    if (st.isSymbolicLink()) {
      return { ok: false, status: 403, error: 'forbidden_path', attackVector: 'symlink_in_path' };
    }
  }
  return { ok: true, absolutePath: resolved, ext, mime: MIME_ALLOWLIST[ext] };
}

/* ──────────────────────────────── Routing ──────────────────────────────────── */

/**
 * Boot the HTTP server. Resolves with a server-control object once listening.
 *
 * @param {Object} opts
 * @param {number} opts.port            requested port (0 = random if MMD_SERVE_ALLOW_RANDOM=1)
 * @param {boolean} opts.explicitPort   true if user set MMD_SERVE_PORT (disables retry)
 * @param {string} opts.cwd             current working directory (for demo/, .mmd/, etc.)
 */
export async function createServer({ port, explicitPort, cwd }) {
  // Compute DEMO_ROOT with realpath check (AC-7 step 9).
  const demoRootPlain = path.resolve(cwd, 'demo');
  let demoRoot = demoRootPlain;
  try {
    // Only attempt realpath if the directory exists.
    if (existsSync(demoRootPlain)) {
      const real = await realpath(demoRootPlain);
      if (real !== demoRootPlain) {
        logEvent('warn', 'demo_root_is_symlink', { plain: demoRootPlain, real });
        demoRoot = real;
      }
    }
  } catch (err) {
    logEvent('warn', 'demo_root_realpath_failed', { error: err.message });
  }

  // Audit appender — open .mmd/audit.log in O_APPEND.
  const audit = makeAuditAppender(cwd);

  // Rate-limiter (AC-3c).
  const rateLimit = createRateLimiter({
    capacity: parseRateLimitFromEnv(process.env.MMD_SERVE_RATE_LIMIT_PER_HOUR),
  });

  // In-memory jobs map (G18 — volatile on restart, documented in spec).
  /** @type {Map<string, {jobId, slug, dream, startedAt, status, stream, child?}>} */
  const jobs = new Map();
  let inflightJobId = null; // F6 — single in-flight constraint.

  const startedAt = Date.now();

  // Pre-load UI files (small, served many times) — we'll always stat on each request
  // anyway for Content-Length, but having them resolved is convenient.
  const uiFiles = {
    '/': { fsPath: path.join(UI_DIR, 'index.html'), mime: MIME_ALLOWLIST['.html'] },
    '/style.css': { fsPath: path.join(UI_DIR, 'style.css'), mime: MIME_ALLOWLIST['.css'] },
    '/app.js': { fsPath: path.join(UI_DIR, 'app.js'), mime: MIME_ALLOWLIST['.js'] },
  };

  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.requestId = requestId; // attach for downstream handlers
    try {
      await dispatch(req, res, requestId);
    } catch (err) {
      logEvent('error', 'unhandled_request_error', {
        request_id: requestId,
        url: req.url,
        method: req.method,
        error: err.message,
        stack: err.stack,
      });
      if (!res.headersSent) {
        const headers = { 'Content-Type': 'application/json; charset=utf-8' };
        applySecurityHeaders(res, 'default', req.headers.origin, currentPort());
        res.writeHead(500, headers);
        res.end(JSON.stringify({ error: 'internal_error' }));
      } else {
        try { res.end(); } catch { /* socket may be gone */ }
      }
    }
  });

  // AC-10: request/header timeouts.
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;

  function currentPort() {
    const a = server.address();
    return typeof a === 'object' && a ? a.port : port;
  }

  /* ───────────────────────── dispatcher ───────────────────────── */

  async function dispatch(req, res, requestId) {
    const method = req.method || 'GET';
    const url = req.url || '/';
    const pathname = url.split('?')[0];

    // Common: always set security headers (default profile). /demo/* will override below.
    applySecurityHeaders(res, 'default', req.headers.origin, currentPort());

    if (method === 'GET' && (pathname === '/' || uiFiles[pathname])) {
      return serveUiFile(req, res, pathname, requestId);
    }
    if (method === 'GET' && pathname === '/favicon.svg') {
      res.writeHead(200, {
        'Content-Type': MIME_ALLOWLIST['.svg'],
        'Content-Length': Buffer.byteLength(FAVICON_SVG),
      });
      res.end(FAVICON_SVG);
      return;
    }
    if (method === 'GET' && pathname === '/api/health') {
      const body = JSON.stringify({ ok: true, version: PKG_VERSION });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    if (method === 'POST' && pathname === '/api/dream') {
      return handlePostDream(req, res, requestId);
    }
    if (method === 'GET' && pathname.startsWith('/api/dream/stream/')) {
      const key = pathname.slice('/api/dream/stream/'.length);
      return handleSseStream(req, res, requestId, key);
    }
    if (method === 'GET' && pathname.startsWith('/api/status/')) {
      const slug = pathname.slice('/api/status/'.length);
      return handleStatus(req, res, requestId, slug);
    }
    if (method === 'GET' && pathname.startsWith('/demo/')) {
      return handleStatic(req, res, requestId);
    }
    // 404.
    const body = JSON.stringify({ error: 'not_found' });
    res.writeHead(404, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  /* ───────────────────────── handlers ───────────────────────── */

  async function serveUiFile(req, res, pathname, requestId) {
    const entry = uiFiles[pathname] || uiFiles['/'];
    let buf;
    try {
      buf = await readFile(entry.fsPath);
    } catch (err) {
      logEvent('error', 'ui_file_read_failed', { request_id: requestId, path: entry.fsPath, error: err.message });
      const body = JSON.stringify({ error: 'ui_unavailable' });
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    res.writeHead(200, {
      'Content-Type': entry.mime,
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  }

  async function handlePostDream(req, res, requestId) {
    // Origin + Host validation (F4 — DNS rebinding defense).
    const portNow = currentPort();
    if (!isAllowedHost(req.headers.host, portNow)) {
      return jsonResponse(res, 403, { error: 'forbidden_host' }, () => {
        audit.append('dream_rejected', { request_id: requestId, reason: 'forbidden_host', status_code: 403 });
        logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'forbidden_host', status_code: 403 });
      });
    }
    if (!isAllowedOrigin(req.headers.origin, portNow)) {
      // Origin MAY be missing on same-origin (some browsers do, some don't). We REQUIRE it
      // for POST per the spec — this is the CSRF defense.
      return jsonResponse(res, 403, { error: 'forbidden_origin' }, () => {
        audit.append('dream_rejected', { request_id: requestId, reason: 'forbidden_origin', status_code: 403 });
        logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'forbidden_origin', status_code: 403 });
      });
    }
    // Content-Type must be application/json (F36).
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (!ct.startsWith('application/json')) {
      return jsonResponse(res, 415, { error: 'unsupported_media_type' }, () => {
        audit.append('dream_rejected', { request_id: requestId, reason: 'unsupported_media_type', status_code: 415 });
        logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'unsupported_media_type', status_code: 415 });
      });
    }
    // Content-Length fail-fast (F3).
    const declaredLen = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
      return jsonResponse(res, 413, { error: 'body_too_large', max_bytes: MAX_BODY_BYTES }, () => {
        audit.append('dream_rejected', { request_id: requestId, reason: 'too_large', status_code: 413 });
        logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'too_large', status_code: 413 });
      });
    }
    // Read body (cap mid-stream too in case Content-Length was missing/lying).
    let body;
    try {
      body = await readBodyCapped(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err.code === 'BODY_TOO_LARGE') {
        return jsonResponse(res, 413, { error: 'body_too_large', max_bytes: MAX_BODY_BYTES }, () => {
          audit.append('dream_rejected', { request_id: requestId, reason: 'too_large', status_code: 413 });
          logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'too_large', status_code: 413 });
        });
      }
      throw err;
    }
    // Parse JSON.
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      return jsonResponse(res, 400, { error: 'invalid_json' }, () => {
        audit.append('dream_rejected', { request_id: requestId, reason: 'invalid_json', status_code: 400 });
        logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'invalid_json', status_code: 400 });
      });
    }
    if (!payload || typeof payload !== 'object' || !('dream' in payload)) {
      return jsonResponse(res, 400, { error: 'dream_missing' }, () => {
        audit.append('dream_rejected', { request_id: requestId, reason: 'dream_missing', status_code: 400 });
        logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'dream_missing', status_code: 400 });
      });
    }
    const dream = payload.dream;
    if (typeof dream !== 'string' || dream.trim().length === 0) {
      return jsonResponse(res, 400, { error: 'dream_empty' }, () => {
        audit.append('dream_rejected', { request_id: requestId, reason: 'empty', status_code: 400 });
        logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'empty', status_code: 400 });
      });
    }
    if (dream.length > MAX_DREAM_LEN) {
      return jsonResponse(res, 400, { error: 'dream_too_long', max_chars: MAX_DREAM_LEN }, () => {
        audit.append('dream_rejected', { request_id: requestId, reason: 'too_long', status_code: 400 });
        logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'too_long', status_code: 400 });
      });
    }
    // In-flight check (F6).
    if (inflightJobId !== null) {
      return jsonResponse(res, 409, { error: 'another_dream_in_progress' }, () => {
        audit.append('dream_rejected', { request_id: requestId, reason: 'in_flight', status_code: 409 });
        logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'in_flight', status_code: 409 });
      });
    }
    // Rate limit (AC-3c).
    const rl = rateLimit.check();
    if (!rl.allowed) {
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': String(rl.retryAfterSeconds),
      };
      applySecurityHeaders(res, 'default', req.headers.origin, portNow);
      const respBody = JSON.stringify({ error: 'rate_limited', retry_after_s: rl.retryAfterSeconds });
      res.writeHead(429, headers);
      res.end(respBody);
      audit.append('dream_rejected', {
        request_id: requestId,
        reason: 'rate_limit',
        status_code: 429,
        bucket_used: rl.used,
        bucket_capacity: rl.capacity,
      });
      logEvent('warn', 'dream_rejected', {
        request_id: requestId,
        reason: 'rate_limit',
        status_code: 429,
        bucket_used: rl.used,
        bucket_capacity: rl.capacity,
      });
      return;
    }
    // Slug computation (F26). slugify throws TypeError on empty result.
    let slug;
    try {
      slug = slugify(dream);
    } catch {
      return jsonResponse(res, 400, { error: 'unsluggable_dream' }, () => {
        audit.append('dream_rejected', { request_id: requestId, reason: 'unsluggable', status_code: 400 });
        logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'unsluggable', status_code: 400 });
      });
    }
    // Slug defense-in-depth (G10).
    if (path.basename(slug) !== slug || slug.startsWith('.') || slug.length === 0) {
      audit.append('path_traversal_blocked', {
        request_id: requestId,
        url: '(slug)',
        attack_vector: 'slug_escape',
      });
      logEvent('warn', 'path_traversal_blocked', {
        request_id: requestId,
        url: '(slug)',
        attack_vector: 'slug_escape',
      });
      return jsonResponse(res, 400, { error: 'unsluggable_dream' });
    }
    // Duplicate check (F26).
    const targetDir = path.join(cwd, 'demo', slug);
    let dirExists = false;
    try {
      const st = await stat(targetDir);
      dirExists = st.isDirectory();
    } catch (err) {
      if (err && err.code !== 'ENOENT') throw err;
    }
    if (dirExists) {
      return jsonResponse(res, 409, {
        error: 'duplicate_dream',
        message: 'a dream with similar wording exists; try different words',
      }, () => {
        audit.append('dream_rejected', { request_id: requestId, reason: 'duplicate', status_code: 409 });
        logEvent('warn', 'dream_rejected', { request_id: requestId, reason: 'duplicate', status_code: 409 });
      });
    }

    // All good — create job + spawn subprocess.
    const jobId = randomUUID();
    const stream = createStream();
    const job = {
      jobId,
      slug,
      dream,
      startedAt: Date.now(),
      status: 'pending',
      stream,
      requestId,
    };
    jobs.set(jobId, job);
    inflightJobId = jobId;
    audit.append('dream_submitted', {
      request_id: requestId,
      job_id: jobId,
      slug,
      dream_length: dream.length,
    });
    logEvent('info', 'dream_submitted', {
      request_id: requestId,
      job_id: jobId,
      slug,
      dream_length: dream.length,
    });

    // Spawn subprocess (AC-3 / F5 — arg-array, shell: false).
    let child;
    try {
      const fakeCmd = process.env.MMD_AUTODEV_CMD;
      // Forward the slug to test fixtures via env so they create demo/<slug>/.
      const childEnv = { ...process.env, MMD_SLUG: slug };
      if (fakeCmd) {
        child = spawn('bash', [fakeCmd, dream], {
          shell: false,
          cwd,
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } else {
        // Default: spawn `node bin/mmd.js <dream>` from the project root.
        const mmdEntry = path.resolve(fileURLToPath(new URL('../bin/mmd.js', import.meta.url)));
        child = spawn(process.execPath, [mmdEntry, dream], {
          shell: false,
          cwd,
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      }
    } catch (err) {
      jobs.delete(jobId);
      inflightJobId = null;
      logEvent('error', 'spawn_failed', { request_id: requestId, job_id: jobId, error: err.message });
      return jsonResponse(res, 500, { error: 'spawn_failed' });
    }
    job.child = child;
    job.status = 'running';
    logEvent('info', 'subprocess_spawned', {
      request_id: requestId, job_id: jobId, slug, pid: child.pid,
    });

    // Wire subprocess stdio → SSE log events.
    wireSubprocessToStream(child, stream);

    child.on('exit', (exitCode, signal) => {
      const duration = Date.now() - job.startedAt;
      job.status = exitCode === 0 ? 'done' : 'failed';
      if (exitCode === 0) {
        rateLimit.recordSuccess();
      }
      const resultUrl = `http://localhost:${currentPort()}/demo/${encodeURIComponent(slug)}/index.html`;
      if (exitCode === 0) {
        stream.emit({
          type: 'done',
          exitCode,
          demoPath: path.join('demo', slug),
          resultUrl,
          ts: new Date().toISOString(),
        });
      } else {
        stream.emit({
          type: 'done',
          exitCode: exitCode ?? -1,
          demoPath: path.join('demo', slug),
          resultUrl,
          ts: new Date().toISOString(),
        });
      }
      audit.append('subprocess_exit', {
        request_id: requestId, job_id: jobId, slug,
        exit_code: exitCode, duration_ms: duration, signal,
      });
      logEvent('info', 'subprocess_exit', {
        request_id: requestId, job_id: jobId, slug,
        exit_code: exitCode, duration_ms: duration, signal,
      });
      if (inflightJobId === jobId) inflightJobId = null;
    });
    child.on('error', (err) => {
      stream.emit({
        type: 'error',
        code: err.code || 'subprocess_error',
        message: err.message,
        ts: new Date().toISOString(),
      });
      logEvent('error', 'subprocess_error', {
        request_id: requestId, job_id: jobId, error: err.message,
      });
      if (inflightJobId === jobId) inflightJobId = null;
    });

    // 202 Accepted with {jobId, streamUrl} (F21).
    const respBody = JSON.stringify({
      jobId,
      streamUrl: `/api/dream/stream/${jobId}`,
    });
    res.writeHead(202, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(respBody),
    });
    res.end(respBody);
  }

  function handleSseStream(req, res, requestId, key) {
    // Look up by UUID first, then by slug (G16).
    let job = null;
    if (UUID_V4_RE.test(key)) {
      job = jobs.get(key) || null;
    }
    if (!job) {
      // Slug lookup — linear scan; the jobs map is small (single in-flight + history).
      for (const j of jobs.values()) {
        if (j.slug === key) { job = j; break; }
      }
    }
    if (!job) {
      const body = JSON.stringify({ error: 'unknown_job' });
      res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    // Open SSE stream.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // AC-10: disable per-request timeout on the long-lived SSE socket.
    res.setTimeout(0);
    logEvent('debug', 'sse_client_connected', { request_id: requestId, job_id: job.jobId });
    const attachedAt = Date.now();
    const detach = job.stream.attach(res);
    req.on('close', () => {
      detach();
      logEvent('debug', 'sse_client_disconnected', {
        request_id: requestId,
        job_id: job.jobId,
        duration_ms: Date.now() - attachedAt,
      });
    });
  }

  async function handleStatus(req, res, requestId, slug) {
    if (!slug || slug.includes('/') || slug.includes('..')) {
      return jsonResponse(res, 400, { error: 'invalid_slug' });
    }
    const statusPath = path.join(cwd, 'demo', slug, '.mmd', 'shared', 'status.json');
    let parsed = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await readFile(statusPath, 'utf8');
        parsed = JSON.parse(raw);
        break;
      } catch (err) {
        if (err.code === 'ENOENT') {
          // No status file yet — still try to return a jobId if we have one.
          parsed = null;
          lastErr = err;
          break;
        }
        // SyntaxError on mid-write — retry with 100 ms backoff.
        if (err instanceof SyntaxError) {
          lastErr = err;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 100));
            continue;
          }
        } else {
          lastErr = err;
          break;
        }
      }
    }
    if (parsed === null && lastErr && lastErr.code !== 'ENOENT') {
      logEvent('warn', 'status_unavailable', { request_id: requestId, slug, parse_attempts: 3 });
      const body = JSON.stringify({ error: 'status_unavailable', retry_after_ms: 1000 });
      res.writeHead(503, {
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': '1',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    // Find matching job to merge jobId (G16).
    let jobId = null;
    for (const j of jobs.values()) {
      if (j.slug === slug) { jobId = j.jobId; break; }
    }
    const out = parsed === null ? {} : parsed;
    if (jobId) out.jobId = jobId;
    const body = JSON.stringify(out);
    res.writeHead(parsed === null && !jobId ? 404 : 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  async function handleStatic(req, res, requestId) {
    const result = resolveStaticPath(req.url, demoRoot);
    if (!result.ok) {
      if (result.attackVector !== 'mime_reject' && result.attackVector !== 'malformed_encoding') {
        audit.append('path_traversal_blocked', {
          request_id: requestId, url: req.url, attack_vector: result.attackVector,
        });
        logEvent('warn', 'path_traversal_blocked', {
          request_id: requestId, url: req.url, attack_vector: result.attackVector,
        });
      } else if (result.attackVector === 'mime_reject') {
        logEvent('warn', 'static_unsupported_mime', {
          request_id: requestId, url: req.url, extension: result.extension,
        });
      }
      return jsonResponse(res, result.status, { error: result.error });
    }
    // Override CSP to the relaxed `demo` variant.
    applySecurityHeaders(res, 'demo', req.headers.origin, currentPort());
    let st;
    try {
      st = await stat(result.absolutePath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return jsonResponse(res, 404, { error: 'not_found' });
      }
      throw err;
    }
    if (!st.isFile()) {
      return jsonResponse(res, 403, { error: 'forbidden_path' });
    }
    res.writeHead(200, {
      'Content-Type': result.mime,
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(result.absolutePath).pipe(res);
  }

  /* ───────────────────────── helpers ───────────────────────── */

  function jsonResponse(res, status, body, sideEffect) {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
    if (typeof sideEffect === 'function') sideEffect();
  }

  function wireSubprocessToStream(child, stream) {
    pipeStream(child.stdout, 'stdout', stream);
    pipeStream(child.stderr, 'stderr', stream);
  }

  function pipeStream(src, label, stream) {
    let buf = '';
    src.setEncoding('utf8');
    src.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.length === 0) continue;
        stream.emit({
          type: 'log',
          text: line,
          stream: label,
          ts: new Date().toISOString(),
        });
      }
    });
    src.on('end', () => {
      if (buf.length > 0) {
        stream.emit({
          type: 'log',
          text: buf,
          stream: label,
          ts: new Date().toISOString(),
        });
        buf = '';
      }
    });
  }

  /* ───────────────────────── bind ───────────────────────── */

  await new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && !explicitPort && port !== 0) {
        // Port-retry logic in caller helper below.
        retryListen(server, port, reject, resolve);
      } else if (err.code === 'EADDRINUSE' && explicitPort) {
        const e = new Error(`Port ${port} is in use. Pick a different port via MMD_SERVE_PORT.`);
        e.mmdExitCode = 3;
        reject(e);
      } else {
        reject(err);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const realPort = typeof addr === 'object' && addr ? addr.port : port;
      logEvent('info', 'server_started', { port: realPort, host: '127.0.0.1', version: PKG_VERSION });
      // §3.ter.1 — single non-JSON plain line for tests to parse.
      process.stdout.write(`MMD_SERVE_LISTENING port=${realPort} host=127.0.0.1\n`);
      resolve();
    });
  });

  function retryListen(server, startPort, reject, resolve) {
    let attempt = 0;
    const maxAttempts = 10;
    const tryNext = (next) => {
      server.removeAllListeners('error');
      server.removeAllListeners('listening');
      const onErr = (err) => {
        if (err.code === 'EADDRINUSE' && attempt < maxAttempts) {
          logEvent('warn', 'port_retry', {
            attempted_port: next, next_port: next + 1, errno: err.code,
          });
          attempt += 1;
          tryNext(next + 1);
        } else if (err.code === 'EADDRINUSE') {
          const e = new Error(
            `No free port available in range ${startPort}-${startPort + maxAttempts - 1}. ` +
              'Set MMD_SERVE_PORT to a known-free port.'
          );
          e.mmdExitCode = 3;
          reject(e);
        } else {
          reject(err);
        }
      };
      server.once('error', onErr);
      server.once('listening', () => {
        server.removeListener('error', onErr);
        const addr = server.address();
        const realPort = typeof addr === 'object' && addr ? addr.port : next;
        logEvent('info', 'server_started', { port: realPort, host: '127.0.0.1', version: PKG_VERSION });
        process.stdout.write(`MMD_SERVE_LISTENING port=${realPort} host=127.0.0.1\n`);
        resolve();
      });
      server.listen(next, '127.0.0.1');
    };
    tryNext(startPort + 1);
  }

  /* ───────────────────────── shutdown ───────────────────────── */

  async function shutdown(reason) {
    logEvent('info', 'server_shutdown', { reason, uptime_ms: Date.now() - startedAt });
    // Stop accepting new connections.
    await new Promise((resolve) => server.close(() => resolve()));
    // Emit server_shutdown event to every open SSE subscriber.
    for (const job of jobs.values()) {
      job.stream.emit({ type: 'server_shutdown', ts: new Date().toISOString() });
      for (const res of job.stream.subscribers) {
        try { res.end(); } catch { /* socket may already be gone */ }
      }
    }
    // Wait up to 5 s for in-flight subprocess(es), then SIGKILL.
    const grace = 5000;
    const aliveChildren = [...jobs.values()].map((j) => j.child).filter((c) => c && c.exitCode === null);
    if (aliveChildren.length === 0) {
      audit.close();
      return;
    }
    await Promise.race([
      Promise.all(aliveChildren.map((c) => new Promise((r) => c.once('exit', r)))),
      new Promise((r) => setTimeout(r, grace)),
    ]);
    for (const c of aliveChildren) {
      if (c.exitCode === null) {
        try { c.kill('SIGKILL'); } catch { /* already dead */ }
      }
    }
    audit.close();
  }

  return {
    address: () => server.address(),
    shutdown,
    /** Test introspection: counts of in-memory state. */
    _state: () => ({
      jobCount: jobs.size,
      inflightJobId,
      rateLimit: rateLimit._state(),
      auditPath: audit._path,
      demoRoot,
    }),
    /** Underlying http.Server — exposed for tests that need server.address(). */
    _httpServer: server,
  };
}

/* ─────────────────── body reader with hard cap ─────────────────── */
// Defensive against missing/lying Content-Length (F3).

function readBodyCapped(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const e = new Error('body too large');
        e.code = 'BODY_TOO_LARGE';
        req.destroy();
        reject(e);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

