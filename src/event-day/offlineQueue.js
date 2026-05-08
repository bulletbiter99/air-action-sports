// M5 R13 — Event-day offline queue helpers (Surface 5).
//
// Pure helpers — no React, no DOM beyond an injected storage handle.
// The kiosk shell uses these to queue check-in / walk-up actions when
// the network drops mid-event, then replay them when 'online' fires.
//
// Storage shape (a single localStorage key, JSON-encoded array):
//   [
//     { id: 'q_<random>', kind: 'checkin' | 'walkup', payload: {...},
//       queuedAt: <epoch ms> },
//     ...
//   ]
//
// kinds in R13:
//   - 'checkin'  → POST /api/event-day/checkin/:attendeeId
//                  payload: { attendeeId, body: { bypassWaiver?, bypassReason? } }
//   - 'walkup'   → POST /api/event-day/walkup
//                  payload: { body: { buyer, attendees, paymentMethod, ... } }
//
// Future R-batches can extend the kind enum.

export const QUEUE_KEY = 'aas:event-day:offline-queue';
export const ALLOWED_KINDS = Object.freeze(['checkin', 'walkup']);

// ────────────────────────────────────────────────────────────────────
// Internal: random id generator (no crypto in jsdom; use Math.random
// for queue ids — collision risk is negligible at <1000 queued items)
// ────────────────────────────────────────────────────────────────────

function randomQueueId() {
    const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
    let out = 'q_';
    for (let i = 0; i < 12; i++) {
        out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return out;
}

// ────────────────────────────────────────────────────────────────────
// Read / write
// ────────────────────────────────────────────────────────────────────

/**
 * Returns the current queue. Defensive against missing / malformed
 * localStorage state — returns [] on any parse error.
 *
 * @param {Storage} storage - defaults to window.localStorage
 * @returns {Array<{id, kind, payload, queuedAt}>}
 */
export function readQueue(storage) {
    const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return [];
    let raw;
    try {
        raw = s.getItem(QUEUE_KEY);
    } catch {
        return [];
    }
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeQueue(storage, queue) {
    const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return;
    try {
        s.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch {
        // Storage quota exceeded; nothing useful to do here. The caller
        // will retry on the next online event.
    }
}

/**
 * Appends an action to the queue. Returns the new entry.
 *
 * @param {Storage} storage
 * @param {{ kind: 'checkin' | 'walkup', payload: object }} action
 * @returns {{id, kind, payload, queuedAt}}
 * @throws Error on unknown kind
 */
export function enqueue(storage, action) {
    if (!action || typeof action !== 'object') {
        throw new Error('enqueue: action must be an object');
    }
    if (!ALLOWED_KINDS.includes(action.kind)) {
        throw new Error(`enqueue: unknown kind "${action.kind}"`);
    }
    const queue = readQueue(storage);
    const entry = {
        id: randomQueueId(),
        kind: action.kind,
        payload: action.payload || {},
        queuedAt: Date.now(),
    };
    queue.push(entry);
    writeQueue(storage, queue);
    return entry;
}

/**
 * Removes the entry with the given id. No-op if not found.
 *
 * @param {Storage} storage
 * @param {string} id
 * @returns {boolean} true if removed, false if not found
 */
export function dequeue(storage, id) {
    const queue = readQueue(storage);
    const before = queue.length;
    const next = queue.filter((q) => q.id !== id);
    if (next.length === before) return false;
    writeQueue(storage, next);
    return true;
}

/**
 * Drains the queue by calling `doFetch(entry)` for each item. On a
 * thrown error or a returned `{ ok: false }`, the entry stays in the
 * queue for the next replay. Each successful entry is dequeued.
 *
 * `doFetch` is async and should return either:
 *   - a value with `.ok === true` (or any truthy resolved value not
 *     equal to a `{ ok: false }` shape) → success, dequeue
 *   - throw / reject / `{ ok: false, ... }` → leave in queue
 *
 * Re-reads the queue between iterations so external dequeue calls
 * (e.g., a UI clearing a stale entry) don't cause double-replay.
 *
 * @param {Storage} storage
 * @param {(entry) => Promise<any>} doFetch
 * @returns {Promise<{ replayed: number, failed: number }>}
 */
export async function replayQueue(storage, doFetch) {
    if (typeof doFetch !== 'function') {
        throw new Error('replayQueue: doFetch must be a function');
    }
    const initialQueue = readQueue(storage);
    let replayed = 0;
    let failed = 0;
    for (const entry of initialQueue) {
        try {
            const result = await doFetch(entry);
            if (result && result.ok === false) {
                failed++;
                continue;
            }
            dequeue(storage, entry.id);
            replayed++;
        } catch {
            failed++;
        }
    }
    return { replayed, failed };
}

/**
 * Convenience wrapper for the AttendeeDetail / WalkUpBooking pages:
 * subscribes to the `online` event on `win` and returns a cleanup
 * function. The cleanup must be called from a useEffect cleanup so
 * we don't leak listeners across remounts.
 *
 * @param {() => void} callback
 * @param {Window} win - defaults to globalThis.window when present
 * @returns {() => void} cleanup
 */
export function addOnlineListener(callback, win) {
    const target = win || (typeof window !== 'undefined' ? window : null);
    if (!target || typeof target.addEventListener !== 'function') {
        return () => {};
    }
    target.addEventListener('online', callback);
    return () => target.removeEventListener('online', callback);
}

/**
 * Drop the entire queue. Used by tests + by an explicit "clear queue"
 * UI affordance for the operator.
 */
export function clearQueue(storage) {
    writeQueue(storage, []);
}
