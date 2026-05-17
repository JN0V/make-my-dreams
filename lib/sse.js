// lib/sse.js — Server-Sent Events helpers + per-stream ring buffer.
// SRP (constitution §I.S): owns SSE wire format + the 1000-line backpressure buffer.
//
// Per SPEC_V025.md §3.bis (event types, 15 s keepalive, 1000-line ring buffer
// with deduped truncation warn, 100-line catch-up replay).

/**
 * Closed event-type enum (F8). Tests assert these literals.
 */
export const SSE_EVENT_TYPES = Object.freeze([
  'log', 'status', 'warn', 'done', 'error', 'server_shutdown',
]);

const BUFFER_CAPACITY = 1000;
const CATCHUP_REPLAY = 100;
const KEEPALIVE_MS = 15_000;

/**
 * Serialize one SSE event. Always uses the `data:` line — no `event:` line is sent
 * (the type lives inside the JSON payload per F8). One trailing blank line per spec.
 */
export function serializeEvent(payload) {
  const json = JSON.stringify(payload);
  // SSE requires each line to be prefixed by `data:`; we only emit single-line JSON
  // so a single `data: ...\n\n` is correct. A newline inside `json` would break SSE,
  // but JSON.stringify never emits raw newlines in strings (only `\n` escapes).
  return `data: ${json}\n\n`;
}

/**
 * Create a per-job stream state object (one per dream run).
 * Holds the ring buffer + the set of attached SSE responses.
 */
export function createStream() {
  /** @type {string[]} ring buffer of serialized event strings */
  const buffer = [];
  /** @type {Set<import('node:http').ServerResponse>} attached responses */
  const subscribers = new Set();
  let droppedCount = 0;
  let truncationWarnEmitted = false;
  let done = false;
  let terminalEvent = null;

  function pushBuffer(serialized) {
    buffer.push(serialized);
    if (buffer.length > BUFFER_CAPACITY) {
      buffer.shift();
      droppedCount += 1;
    }
  }

  function broadcast(serialized) {
    for (const res of subscribers) {
      try {
        res.write(serialized);
      } catch {
        // Subscriber socket closed mid-write; cleanup happens in the `close` handler.
        // Documented: silent because the close handler will remove this subscriber.
      }
    }
  }

  return {
    /**
     * Emit a structured event. Adds it to the buffer AND broadcasts to live subscribers.
     */
    emit(payload) {
      const serialized = serializeEvent(payload);
      pushBuffer(serialized);
      broadcast(serialized);
      // Buffer-overflow warn (deduped, F8 / G7).
      if (droppedCount > 0 && !truncationWarnEmitted) {
        truncationWarnEmitted = true;
        const warn = serializeEvent({
          type: 'warn',
          text: 'output truncated',
          ts: new Date().toISOString(),
        });
        pushBuffer(warn);
        broadcast(warn);
      }
      if (payload.type === 'done' || payload.type === 'error' || payload.type === 'server_shutdown') {
        done = true;
        terminalEvent = payload;
      }
    },
    /**
     * Attach a new subscriber. Replays the catch-up tail (last 100 of 1000 lines),
     * starts the keepalive timer, and returns a detach function.
     */
    attach(res) {
      subscribers.add(res);
      // Replay catch-up tail.
      const tail = buffer.slice(-CATCHUP_REPLAY);
      for (const serialized of tail) {
        try { res.write(serialized); } catch { /* socket gone; close handler will clean */ }
      }
      // Keepalive comment every 15 s.
      const keepalive = setInterval(() => {
        try { res.write(': heartbeat\n\n'); } catch { /* socket gone */ }
      }, KEEPALIVE_MS);
      // Detach on close.
      const detach = () => {
        clearInterval(keepalive);
        subscribers.delete(res);
      };
      return detach;
    },
    /**
     * True once a terminal event (done | error | server_shutdown) has been emitted.
     */
    isDone() { return done; },
    terminal() { return terminalEvent; },
    /** Test introspection. */
    _state() {
      return {
        bufferSize: buffer.length,
        droppedCount,
        subscriberCount: subscribers.size,
      };
    },
    /**
     * Iterate every attached subscriber (used by graceful shutdown to emit server_shutdown).
     */
    subscribers,
  };
}

export const SSE_CONSTANTS = Object.freeze({
  BUFFER_CAPACITY,
  CATCHUP_REPLAY,
  KEEPALIVE_MS,
});
