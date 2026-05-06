// In-memory D1 mock — implements the prepare/bind/first/all/run interface
// without executing any SQL. Tests register handlers that match by SQL
// substring or regex and return canned responses.
//
// This is a SHAPE mock, not a SQL engine. Authoritative SQL behavior testing
// belongs in real-D1 integration tests (future milestone). The point of this
// mock is to assert (a) what SQL strings the worker issues, (b) what binds
// it passes, and (c) that worker logic correctly handles the response shapes
// we know D1 returns.
//
// Usage:
//   import { createMockD1 } from './mockD1.js';
//
//   const db = createMockD1();
//   db.__on(/SELECT \* FROM events WHERE/, { id: 'op-night', title: 'Op Night' }, 'first');
//   const row = await db.prepare('SELECT * FROM events WHERE id = ?').bind('op-night').first();
//   // row === { id: 'op-night', title: 'Op Night' }
//
//   const writes = db.__writes();
//   // [{ sql: 'SELECT * FROM events WHERE id = ?', args: ['op-night'], kind: 'first' }]

export function createMockD1() {
    const handlers = [];
    const writeLog = [];

    function matchHandler(sql, args, kind) {
        writeLog.push({ sql, args, kind });

        for (const h of handlers) {
            const matches =
                typeof h.pattern === 'string'
                    ? sql.includes(h.pattern)
                    : h.pattern.test(sql);
            if (!matches) continue;
            if (h.kind && h.kind !== kind) continue;

            const out =
                typeof h.response === 'function'
                    ? h.response(sql, args, kind)
                    : h.response;
            if (out !== undefined) return out;
        }

        // Default returns for unmatched queries — match D1's documented shape:
        //   first() → null when no row
        //   all()   → { results: [], meta: { ... } }
        //   run()   → { meta: { changes: 0, last_row_id: null }, success: true }
        if (kind === 'first') return null;
        if (kind === 'all') return { results: [], meta: { rows_read: 0 } };
        if (kind === 'run') return { meta: { changes: 0, last_row_id: null }, success: true };
        return null;
    }

    function prepare(sql) {
        let bindArgs = [];
        return {
            bind: (...args) => {
                bindArgs = args;
                return {
                    first: async () => matchHandler(sql, bindArgs, 'first'),
                    all: async () => matchHandler(sql, bindArgs, 'all'),
                    run: async () => matchHandler(sql, bindArgs, 'run'),
                };
            },
            // Statements without bind() — rare, but supported.
            first: async () => matchHandler(sql, [], 'first'),
            all: async () => matchHandler(sql, [], 'all'),
            run: async () => matchHandler(sql, [], 'run'),
        };
    }

    return {
        prepare,

        // ─── Test-only API (underscored to signal not-real-D1) ───

        // Register a handler. `pattern` is a string substring or RegExp.
        // `response` is the value (or a function (sql, args, kind) → value)
        // returned to the caller. `kind` filters to 'first' | 'all' | 'run';
        // omit to match all kinds.
        __on: (pattern, response, kind) => {
            handlers.push({ pattern, response, kind });
        },

        // All prepare/bind invocations captured during the test, in order.
        __writes: () => writeLog.slice(),

        // Wipe handlers + log. Useful between phases of a single test.
        __reset: () => {
            handlers.length = 0;
            writeLog.length = 0;
        },
    };
}
