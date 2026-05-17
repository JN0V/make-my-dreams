// lib/security-headers.js — AC-9 response headers.
// SRP (constitution §I.S): only owns the security-header policy.
//
// Two CSP profiles:
//   - default (UI + API responses): strict, no 'unsafe-inline'.
//   - demo (responses under /demo/*): relaxed to allow inline JS/CSS in generated PWAs
//     (v0.6 hardening — see SPEC AC-9).
//
// Per SPEC_V025.md AC-9.

const STRICT_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; " +
  "script-src 'self'; connect-src 'self'";

const DEMO_CSP =
  "default-src 'self'; img-src 'self' data: blob:; " +
  "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
  "media-src 'self' blob:; connect-src 'self'";

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

/**
 * Return the headers object for a given route variant.
 * @param {'default'|'demo'} variant
 * @param {string|undefined} originForCors — when set AND matches the local-loopback origin
 *   of the server, emit Access-Control-Allow-Origin echoing the same value (NEVER '*').
 * @param {number} port — server port (for origin validation).
 */
export function buildSecurityHeaders(variant, originForCors, port) {
  const headers = {
    ...BASE_HEADERS,
    'Content-Security-Policy': variant === 'demo' ? DEMO_CSP : STRICT_CSP,
  };
  if (originForCors && isAllowedOrigin(originForCors, port)) {
    headers['Access-Control-Allow-Origin'] = originForCors;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

/**
 * Apply headers to a node:http ServerResponse before writeHead.
 * Used as a middleware-style helper.
 */
export function applySecurityHeaders(res, variant, originForCors, port) {
  const h = buildSecurityHeaders(variant, originForCors, port);
  for (const [k, v] of Object.entries(h)) {
    res.setHeader(k, v);
  }
}

/**
 * Check whether an Origin header value is one of the two accepted local-loopback origins.
 */
export function isAllowedOrigin(origin, port) {
  if (!origin) return false;
  return (
    origin === `http://localhost:${port}` ||
    origin === `http://127.0.0.1:${port}`
  );
}

/**
 * Check whether a Host header value is one of the two accepted local-loopback hosts.
 * (DNS-rebinding defense per AC-3 / F4.)
 */
export function isAllowedHost(host, port) {
  if (!host) return false;
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
}
