// M5 R13 — offline queue helper tests.
//
// Pure helpers backed by an injected Storage-shaped object. The kiosk
// shell uses these to queue check-in / walkup actions when offline and
// replay them when 'online' fires.
//
// We use a Map-backed mock storage so the tests don't touch the
// vitest jsdom localStorage (which doesn't exist by default in node
// env). The mock is identical-shape to localStorage's getItem/setItem
// surface.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    QUEUE_KEY,
    ALLOWED_KINDS,
    readQueue,
    enqueue,
    dequeue,
    replayQueue,
    addOnlineListener,
    clearQueue,
} from '../../../../src/event-day/offlineQueue.js';

function mockStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        clear: () => map.clear(),
        // Test-only — peek at internal state:
        __raw: map,
    };
}

describe('ALLOWED_KINDS', () => {
    it('exposes the R13 set as a frozen list', () => {
        expect(ALLOWED_KINDS).toEqual(['checkin', 'walkup']);
        expect(Object.isFrozen(ALLOWED_KINDS)).toBe(true);
    });
});

describe('QUEUE_KEY', () => {
    it('uses the namespaced storage key', () => {
        expect(QUEUE_KEY).toBe('aas:event-day:offline-queue');
    });
});

describe('readQueue', () => {
    it('returns [] when no queue persisted', () => {
        const storage = mockStorage();
        expect(readQueue(storage)).toEqual([]);
    });

    it('returns the persisted array', () => {
        const storage = mockStorage();
        storage.setItem(QUEUE_KEY, JSON.stringify([{ id: 'q_1', kind: 'checkin', payload: {}, queuedAt: 1 }]));
        const queue = readQueue(storage);
        expect(queue).toHaveLength(1);
        expect(queue[0].id).toBe('q_1');
    });

    it('returns [] on malformed JSON', () => {
        const storage = mockStorage();
        storage.setItem(QUEUE_KEY, 'not valid json {{{');
        expect(readQueue(storage)).toEqual([]);
    });

    it('returns [] when the persisted value is not an array', () => {
        const storage = mockStorage();
        storage.setItem(QUEUE_KEY, JSON.stringify({ not: 'array' }));
        expect(readQueue(storage)).toEqual([]);
    });

    it('returns [] when storage throws on getItem', () => {
        const broken = { getItem: () => { throw new Error('quota'); } };
        expect(readQueue(broken)).toEqual([]);
    });
});

describe('enqueue', () => {
    it('rejects unknown kinds', () => {
        const storage = mockStorage();
        expect(() => enqueue(storage, { kind: 'evil', payload: {} })).toThrow(/unknown kind/);
    });

    it('rejects non-object actions', () => {
        const storage = mockStorage();
        expect(() => enqueue(storage, null)).toThrow(/object/);
        expect(() => enqueue(storage, 'string')).toThrow(/object/);
    });

    it('appends a checkin entry with id + queuedAt + kind + payload', () => {
        const storage = mockStorage();
        const entry = enqueue(storage, {
            kind: 'checkin',
            payload: { attendeeId: 'a_1', body: { bypassWaiver: false } },
        });
        expect(entry.id).toMatch(/^q_[0-9a-z]{12}$/);
        expect(entry.kind).toBe('checkin');
        expect(entry.payload).toEqual({ attendeeId: 'a_1', body: { bypassWaiver: false } });
        expect(entry.queuedAt).toBeGreaterThan(0);

        const queue = readQueue(storage);
        expect(queue).toHaveLength(1);
        expect(queue[0]).toEqual(entry);
    });

    it('appends a walkup entry', () => {
        const storage = mockStorage();
        enqueue(storage, {
            kind: 'walkup',
            payload: { body: { buyer: { fullName: 'X', email: 'x@e.com' }, attendees: [] } },
        });
        const queue = readQueue(storage);
        expect(queue[0].kind).toBe('walkup');
    });

    it('preserves order across multiple enqueues', () => {
        const storage = mockStorage();
        enqueue(storage, { kind: 'checkin', payload: { i: 1 } });
        enqueue(storage, { kind: 'walkup', payload: { i: 2 } });
        enqueue(storage, { kind: 'checkin', payload: { i: 3 } });
        const queue = readQueue(storage);
        expect(queue.map((q) => q.payload.i)).toEqual([1, 2, 3]);
    });

    it('produces unique ids across many calls', () => {
        const storage = mockStorage();
        const ids = new Set();
        for (let i = 0; i < 50; i++) {
            const e = enqueue(storage, { kind: 'checkin', payload: {} });
            ids.add(e.id);
        }
        expect(ids.size).toBe(50);
    });
});

describe('dequeue', () => {
    it('removes the entry with the given id', () => {
        const storage = mockStorage();
        const a = enqueue(storage, { kind: 'checkin', payload: { i: 1 } });
        const b = enqueue(storage, { kind: 'checkin', payload: { i: 2 } });
        const removed = dequeue(storage, a.id);
        expect(removed).toBe(true);
        const queue = readQueue(storage);
        expect(queue).toHaveLength(1);
        expect(queue[0].id).toBe(b.id);
    });

    it('returns false when id not found', () => {
        const storage = mockStorage();
        enqueue(storage, { kind: 'checkin', payload: {} });
        expect(dequeue(storage, 'q_nonexistent')).toBe(false);
        expect(readQueue(storage)).toHaveLength(1);
    });

    it('is a no-op on an empty queue', () => {
        const storage = mockStorage();
        expect(dequeue(storage, 'q_anything')).toBe(false);
        expect(readQueue(storage)).toEqual([]);
    });
});

describe('replayQueue', () => {
    it('throws when doFetch is not a function', async () => {
        const storage = mockStorage();
        await expect(replayQueue(storage, null)).rejects.toThrow(/must be a function/);
        await expect(replayQueue(storage, 'string')).rejects.toThrow(/must be a function/);
    });

    it('returns zeros on empty queue', async () => {
        const storage = mockStorage();
        const doFetch = vi.fn().mockResolvedValue({ ok: true });
        const result = await replayQueue(storage, doFetch);
        expect(result).toEqual({ replayed: 0, failed: 0 });
        expect(doFetch).not.toHaveBeenCalled();
    });

    it('replays each entry; dequeues on success', async () => {
        const storage = mockStorage();
        enqueue(storage, { kind: 'checkin', payload: { i: 1 } });
        enqueue(storage, { kind: 'walkup', payload: { i: 2 } });
        const doFetch = vi.fn().mockResolvedValue({ ok: true });

        const result = await replayQueue(storage, doFetch);
        expect(result).toEqual({ replayed: 2, failed: 0 });
        expect(doFetch).toHaveBeenCalledTimes(2);
        expect(readQueue(storage)).toEqual([]);
    });

    it('LEAVES failed entries (return ok:false) in the queue for retry', async () => {
        const storage = mockStorage();
        enqueue(storage, { kind: 'checkin', payload: { i: 1 } });
        enqueue(storage, { kind: 'checkin', payload: { i: 2 } });
        const doFetch = vi.fn()
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, error: 'network' });

        const result = await replayQueue(storage, doFetch);
        expect(result).toEqual({ replayed: 1, failed: 1 });

        const queue = readQueue(storage);
        expect(queue).toHaveLength(1);
        expect(queue[0].payload.i).toBe(2);
    });

    it('LEAVES failed entries (thrown error) in the queue for retry', async () => {
        const storage = mockStorage();
        enqueue(storage, { kind: 'checkin', payload: { i: 1 } });
        const doFetch = vi.fn().mockRejectedValue(new Error('network'));

        const result = await replayQueue(storage, doFetch);
        expect(result).toEqual({ replayed: 0, failed: 1 });

        expect(readQueue(storage)).toHaveLength(1);
    });

    it('treats a truthy non-{ok:false} return as success', async () => {
        const storage = mockStorage();
        enqueue(storage, { kind: 'checkin', payload: {} });
        const doFetch = vi.fn().mockResolvedValue({ status: 'completed' });
        const result = await replayQueue(storage, doFetch);
        expect(result.replayed).toBe(1);
    });
});

describe('addOnlineListener', () => {
    it('returns a no-op cleanup when no window is available', () => {
        const cleanup = addOnlineListener(() => {}, null);
        expect(typeof cleanup).toBe('function');
        cleanup(); // does not throw
    });

    it('subscribes via window.addEventListener and returns a cleanup', () => {
        const events = new Map();
        const fakeWin = {
            addEventListener: vi.fn((evt, cb) => events.set(evt, cb)),
            removeEventListener: vi.fn((evt, cb) => {
                if (events.get(evt) === cb) events.delete(evt);
            }),
        };
        const callback = vi.fn();
        const cleanup = addOnlineListener(callback, fakeWin);
        expect(fakeWin.addEventListener).toHaveBeenCalledWith('online', callback);

        // Simulate firing the event:
        const handler = events.get('online');
        handler();
        expect(callback).toHaveBeenCalled();

        cleanup();
        expect(fakeWin.removeEventListener).toHaveBeenCalledWith('online', callback);
        expect(events.has('online')).toBe(false);
    });
});

describe('clearQueue', () => {
    it('drops all entries', () => {
        const storage = mockStorage();
        enqueue(storage, { kind: 'checkin', payload: { i: 1 } });
        enqueue(storage, { kind: 'walkup', payload: { i: 2 } });
        clearQueue(storage);
        expect(readQueue(storage)).toEqual([]);
    });
});

describe('integration: enqueue -> dequeue -> read', () => {
    let storage;
    beforeEach(() => { storage = mockStorage(); });

    it('full round-trip preserves payload exactly', () => {
        const payload = {
            attendeeId: 'a_xyz',
            body: { bypassWaiver: true, bypassReason: 'Verified ID' },
        };
        const entry = enqueue(storage, { kind: 'checkin', payload });
        const queueAfter = readQueue(storage);
        expect(queueAfter[0].payload).toEqual(payload);
        dequeue(storage, entry.id);
        expect(readQueue(storage)).toEqual([]);
    });
});
