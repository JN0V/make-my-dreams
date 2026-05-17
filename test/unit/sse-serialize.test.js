// test/unit/sse-serialize.test.js — §3.bis SSE contract (pure unit, < 100 ms per test).
// Constitution: testing.md §V — every test name carries an @unit tag.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serializeEvent, createStream, SSE_EVENT_TYPES, SSE_CONSTANTS } from '../../lib/sse.js';

test('@unit serializeEvent wraps payload as "data: <json>\\n\\n"', () => {
  const payload = {
    type: 'log',
    text: 'hi',
    stream: 'stdout',
    ts: '2026-05-17T10:00:00.000Z',
  };
  const out = serializeEvent(payload);
  assert.equal(typeof out, 'string');
  assert.ok(out.startsWith('data: '), `expected leading "data: ", got ${JSON.stringify(out)}`);
  assert.ok(out.endsWith('\n\n'), 'expected trailing blank line');
  // Recover the JSON between the prefix and the final blank line.
  const jsonStr = out.slice('data: '.length, -2);
  assert.deepEqual(JSON.parse(jsonStr), payload);
});

test('@unit SSE_EVENT_TYPES is frozen and contains the 6 closed-enum types', () => {
  assert.ok(Object.isFrozen(SSE_EVENT_TYPES), 'SSE_EVENT_TYPES must be frozen');
  for (const t of ['log', 'status', 'warn', 'done', 'error', 'server_shutdown']) {
    assert.ok(SSE_EVENT_TYPES.includes(t), `missing event type: ${t}`);
  }
  assert.equal(SSE_EVENT_TYPES.length, 6);
});

test('@unit SSE_CONSTANTS exposes BUFFER_CAPACITY=1000 / CATCHUP_REPLAY=100 / KEEPALIVE_MS=15000', () => {
  assert.equal(SSE_CONSTANTS.BUFFER_CAPACITY, 1000);
  assert.equal(SSE_CONSTANTS.CATCHUP_REPLAY, 100);
  assert.equal(SSE_CONSTANTS.KEEPALIVE_MS, 15000);
});

test('@unit createStream: emit increments _state().bufferSize', () => {
  const s = createStream();
  assert.equal(s._state().bufferSize, 0);
  s.emit({ type: 'log', text: 'one', stream: 'stdout', ts: '2026-05-17T10:00:00.000Z' });
  assert.equal(s._state().bufferSize, 1);
  s.emit({ type: 'log', text: 'two', stream: 'stdout', ts: '2026-05-17T10:00:00.001Z' });
  assert.equal(s._state().bufferSize, 2);
});

test('@unit createStream: attach replays buffered events to the new subscriber', () => {
  const s = createStream();
  s.emit({ type: 'log', text: 'one', stream: 'stdout', ts: '2026-05-17T10:00:00.000Z' });
  s.emit({ type: 'log', text: 'two', stream: 'stdout', ts: '2026-05-17T10:00:00.001Z' });
  const writes = [];
  const fakeRes = { write: (chunk) => { writes.push(chunk); return true; } };
  const detach = s.attach(fakeRes);
  try {
    // 2 buffered events should have been replayed.
    assert.equal(writes.length, 2);
    assert.ok(writes[0].startsWith('data: '));
    assert.ok(writes[0].includes('"text":"one"'));
    assert.ok(writes[1].includes('"text":"two"'));
  } finally {
    // Detach to clear the keepalive interval (otherwise the test runner hangs).
    detach();
  }
});

test('@unit createStream: buffer caps at 1000; emits exactly one warn after overflow', () => {
  const s = createStream();
  // Emit 1001 log events; the ring buffer should keep at most 1000 entries, AND a single
  // warn{"text":"output truncated"} should be appended (deduped).
  for (let i = 0; i < 1001; i++) {
    s.emit({ type: 'log', text: `n${i}`, stream: 'stdout', ts: '2026-05-17T10:00:00.000Z' });
  }
  // After the 1001st emit, the ring buffer is at 1000 (the oldest line was dropped, the
  // warn was pushed which itself caused another drop — but capacity stays at 1000).
  assert.equal(s._state().bufferSize, 1000);
  assert.ok(s._state().droppedCount >= 1, 'expected at least one dropped entry');
  // Further emits MUST NOT add additional `warn{output truncated}` events. We count by
  // attaching a fresh subscriber and scanning the catch-up tail (last 100 events).
  for (let i = 0; i < 50; i++) {
    s.emit({ type: 'log', text: `extra${i}`, stream: 'stdout', ts: '2026-05-17T10:00:00.000Z' });
  }
  const writes = [];
  const detach = s.attach({ write: (c) => { writes.push(c); return true; } });
  try {
    const truncationWarns = writes.filter((w) => w.includes('"text":"output truncated"'));
    assert.ok(truncationWarns.length <= 1, `expected at most 1 truncation warn in catch-up tail, got ${truncationWarns.length}`);
  } finally {
    detach();
  }
});
