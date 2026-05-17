// test/unit/rate-limit.test.js — AC-3c rate limiter (pure unit, < 100 ms per test).
// Constitution: testing.md §V — every test name carries an @unit tag.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter, parseRateLimitFromEnv } from '../../lib/rate-limit.js';

/* ── parseRateLimitFromEnv ────────────────────────────────────────────────── */

test('@unit parseRateLimitFromEnv: undefined returns default 10', () => {
  assert.equal(parseRateLimitFromEnv(undefined), 10);
});

test('@unit parseRateLimitFromEnv: empty string returns default 10', () => {
  assert.equal(parseRateLimitFromEnv(''), 10);
});

test('@unit parseRateLimitFromEnv: "5" returns 5', () => {
  assert.equal(parseRateLimitFromEnv('5'), 5);
});

test('@unit parseRateLimitFromEnv: "abc" falls back to default 10', () => {
  assert.equal(parseRateLimitFromEnv('abc'), 10);
});

test('@unit parseRateLimitFromEnv: "0" falls back to default 10 (min 1)', () => {
  assert.equal(parseRateLimitFromEnv('0'), 10);
});

test('@unit parseRateLimitFromEnv: "-3" falls back to default 10', () => {
  assert.equal(parseRateLimitFromEnv('-3'), 10);
});

/* ── createRateLimiter ────────────────────────────────────────────────────── */

test('@unit createRateLimiter throws on capacity 0', () => {
  assert.throws(() => createRateLimiter({ capacity: 0 }), TypeError);
});

test('@unit createRateLimiter throws on non-integer capacity', () => {
  assert.throws(() => createRateLimiter({ capacity: 3.14 }), TypeError);
});

test('@unit createRateLimiter check() does NOT consume capacity', () => {
  const rl = createRateLimiter({ capacity: 3, now: () => 1000 });
  for (let i = 0; i < 100; i++) {
    const r = rl.check();
    assert.equal(r.allowed, true);
    assert.equal(r.used, 0);
  }
  rl.recordSuccess();
  assert.equal(rl._state().used, 1, 'only recordSuccess consumes capacity');
});

test('@unit createRateLimiter: 3 successes within window → 4th check denied with retryAfter', () => {
  let clock = 1_000_000;
  const rl = createRateLimiter({ capacity: 3, windowMs: 1000, now: () => clock });
  // Three successes within the window.
  rl.recordSuccess(); clock += 100;
  rl.recordSuccess(); clock += 100;
  rl.recordSuccess(); clock += 100;
  assert.equal(rl._state().used, 3);
  const denied = rl.check();
  assert.equal(denied.allowed, false);
  assert.equal(denied.used, 3);
  assert.equal(denied.capacity, 3);
  assert.ok(denied.retryAfterSeconds >= 1, 'retryAfterSeconds must be >= 1');
});

test('@unit createRateLimiter: window expiry frees capacity', () => {
  let clock = 1_000_000;
  const rl = createRateLimiter({ capacity: 2, windowMs: 1000, now: () => clock });
  rl.recordSuccess();
  rl.recordSuccess();
  assert.equal(rl.check().allowed, false, 'denied while window is full');
  // Advance clock past windowMs.
  clock += 1500;
  const allowed = rl.check();
  assert.equal(allowed.allowed, true, 'allowed after window expiry');
  assert.equal(allowed.used, 0, 'used resets after prune');
});
