// lib/rate-limit.js — in-memory rolling-window rate limiter (AC-3c).
// SRP (constitution §I.S): only owns the bucket arithmetic.
//
// v0.2.5 design (G6): single GLOBAL counter — acceptable because the server only
// accepts loopback connections (AC-8). v0.6 MUST switch to per-source keying when
// remote exposure ships.
//
// Counting rule (G15): only successful runs consume capacity. Failed runs are FREE.
// The caller signals success via `recordSuccess()` AFTER the subprocess exits with code 0.
// Validation rejections do NOT consume capacity.

/**
 * Create a rolling-window rate limiter.
 * @param {Object} opts
 * @param {number} opts.capacity   max successful runs per window
 * @param {number} opts.windowMs   window size in ms (default 1 hour)
 * @param {() => number} [opts.now] clock injection for tests
 */
export function createRateLimiter({ capacity, windowMs = 3_600_000, now = () => Date.now() }) {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new TypeError(`createRateLimiter: capacity must be integer >= 1, got ${capacity}`);
  }
  /** @type {number[]} timestamps of past successful runs (oldest first) */
  const timestamps = [];

  function prune() {
    const cutoff = now() - windowMs;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
  }

  return {
    /**
     * Check whether another run would be allowed. Does NOT consume.
     * @returns {{allowed: true, used: number, capacity: number}
     *          |{allowed: false, used: number, capacity: number, retryAfterSeconds: number}}
     */
    check() {
      prune();
      if (timestamps.length < capacity) {
        return { allowed: true, used: timestamps.length, capacity };
      }
      // Oldest timestamp will fall out at oldest + windowMs.
      const oldest = timestamps[0];
      const retryAfterMs = Math.max(1, oldest + windowMs - now());
      // RFC 9110: Retry-After integer seconds; round UP to avoid telling client "0 s".
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      return {
        allowed: false,
        used: timestamps.length,
        capacity,
        retryAfterSeconds,
      };
    },
    /**
     * Record a successful run (exitCode === 0). Consumes one capacity unit.
     * Called from subprocess `exit` handler, NOT at POST time (G15).
     */
    recordSuccess() {
      timestamps.push(now());
    },
    /**
     * Test introspection helper.
     */
    _state() {
      prune();
      return { used: timestamps.length, capacity };
    },
  };
}

/**
 * Parse MMD_SERVE_RATE_LIMIT_PER_HOUR. Returns default 10 if unset / invalid.
 * Minimum 1 (a value of 0 is treated as invalid and falls back to default).
 */
export function parseRateLimitFromEnv(value) {
  if (value === undefined || value === '' || value === null) return 10;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 10;
  return n;
}
