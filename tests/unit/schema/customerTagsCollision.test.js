// Real-schema proof of the customer_tags manual/system collision (2026-07-27).
//
// The shape-mock tests in tests/unit/lib/customer-tags.test.js can only assert
// the SQL *string* the sweep emits. They cannot tell you whether SQLite would
// actually reject it — which is the entire question here, and precisely the
// class of blind spot tests/helpers/realSchema.js was built for.
//
// The hazard, in four facts:
//   1. PRIMARY KEY (customer_id, tag) — tag_type is NOT in the key (0022:109)
//   2. the nightly sweep INSERTs a 'system' row per (customer, tag)
//   3. it runs as one atomic db.batch(), so ONE conflict rolls back ALL of it
//   4. worker/index.js only .catch()es the sweep to console.error
//
// Net effect of a bare INSERT: a single manual tag named 'vip' freezes
// system-tag refresh for every customer, silently and indefinitely. And it
// arms itself on a delay — system tags are conditional, so a manual 'vip' on a
// $40 customer collides with nothing until their lifetime value crosses $500.
//
// These tests run against the real migrated schema, so they fail if anyone
// removes OR IGNORE, and they fail if a future migration changes the PK in a
// way that alters the interaction.

import { describe, it, expect } from 'vitest';
import { freshSchemaDb } from '../../helpers/realSchema.js';
import { SYSTEM_TAG_NAMES } from '../../../worker/lib/customerTags.js';

const NOW = 1_700_000_000_000;

// better-sqlite3 enables foreign_keys by default (D1 does not enforce them at
// runtime), so customer_tags.created_by -> users(id) is live here. Seed a real
// user rather than disabling the pragma — keeping FKs on means these fixtures
// stay honest about what the schema actually permits.
function seed(db) {
    db.prepare(
        `INSERT INTO users (id, email, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
    ).run('u_owner', 'owner@example.com', 'x', 'owner', NOW);
    db.prepare(
        `INSERT INTO customers (id, email, email_normalized, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('cus_a', 'a@example.com', 'a@example.com', 'Customer A', NOW, NOW);
    return db;
}

const insertManual = (db, tag) => db.prepare(
    `INSERT INTO customer_tags (customer_id, tag, tag_type, created_at, created_by)
     VALUES (?, ?, 'manual', ?, ?)`,
).run('cus_a', tag, NOW, 'u_owner');

const SYSTEM_INSERT_HARDENED = `INSERT OR IGNORE INTO customer_tags (customer_id, tag, tag_type, created_at, created_by)
                                VALUES (?, ?, 'system', ?, NULL)`;
const SYSTEM_INSERT_BARE = `INSERT INTO customer_tags (customer_id, tag, tag_type, created_at, created_by)
                            VALUES (?, ?, 'system', ?, NULL)`;

describe('customer_tags manual/system collision (real schema)', () => {
    it('the hazard is real: a bare INSERT throws when a manual tag shares the name', () => {
        const db = seed(freshSchemaDb());
        insertManual(db, 'vip');

        // This is what the sweep did before the fix. If this ever stops
        // throwing, the PK changed and the OR IGNORE below may be unnecessary.
        expect(() => db.prepare(SYSTEM_INSERT_BARE).run('cus_a', 'vip', NOW))
            .toThrow(/UNIQUE constraint failed|PRIMARY KEY/i);
    });

    it('OR IGNORE absorbs the conflict and leaves the manual row intact', () => {
        const db = seed(freshSchemaDb());
        insertManual(db, 'vip');

        expect(() => db.prepare(SYSTEM_INSERT_HARDENED).run('cus_a', 'vip', NOW)).not.toThrow();

        const row = db.prepare(`SELECT tag_type, created_by FROM customer_tags WHERE customer_id = ? AND tag = ?`)
            .get('cus_a', 'vip');
        // The manual row WINS — it is not silently converted to 'system',
        // which would make the next nightly DELETE wipe operator work.
        expect(row.tag_type).toBe('manual');
        expect(row.created_by).toBe('u_owner');
    });

    it('a manual tag survives the nightly system-tag DELETE', () => {
        const db = seed(freshSchemaDb());
        insertManual(db, 'reunion-2027');
        db.prepare(SYSTEM_INSERT_HARDENED).run('cus_a', 'vip', NOW);

        db.prepare(`DELETE FROM customer_tags WHERE tag_type = 'system'`).run();

        const tags = db.prepare(`SELECT tag FROM customer_tags WHERE customer_id = ?`).all('cus_a').map((r) => r.tag);
        expect(tags).toEqual(['reunion-2027']);
    });

    it('with OR IGNORE, one colliding tag no longer costs the rest of the sweep', () => {
        const db = seed(freshSchemaDb());
        db.prepare(
            `INSERT INTO customers (id, email, email_normalized, name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).run('cus_b', 'b@example.com', 'b@example.com', 'Customer B', NOW, NOW);
        insertManual(db, 'vip');

        // Mirror the real batch: DELETE, then one INSERT per (customer, tag).
        // cus_a/vip collides; cus_a/frequent and cus_b/vip must still land.
        const run = db.transaction(() => {
            db.prepare(`DELETE FROM customer_tags WHERE tag_type = 'system'`).run();
            const stmt = db.prepare(SYSTEM_INSERT_HARDENED);
            stmt.run('cus_a', 'vip', NOW);
            stmt.run('cus_a', 'frequent', NOW);
            stmt.run('cus_b', 'vip', NOW);
        });
        expect(() => run()).not.toThrow();

        expect(db.prepare(`SELECT COUNT(*) c FROM customer_tags WHERE tag_type = 'system'`).get().c).toBe(2);
        expect(db.prepare(`SELECT COUNT(*) c FROM customer_tags WHERE tag_type = 'manual'`).get().c).toBe(1);
    });

    it('every reserved name is genuinely collision-prone (none is a no-op to reserve)', () => {
        for (const tag of SYSTEM_TAG_NAMES) {
            const db = seed(freshSchemaDb());
            insertManual(db, tag);
            expect(() => db.prepare(SYSTEM_INSERT_BARE).run('cus_a', tag, NOW))
                .toThrow(/UNIQUE constraint failed|PRIMARY KEY/i);
            db.close();
        }
    });

    it('tag_type is absent from the primary key — the root cause, pinned', () => {
        const db = freshSchemaDb();
        const pk = db.prepare(`PRAGMA table_info(customer_tags)`).all()
            .filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
        expect(pk).toEqual(['customer_id', 'tag']);
    });
});
