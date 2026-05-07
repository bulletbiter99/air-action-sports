// Readiness tests — covers the deploy-ordering window where the Worker
// has shipped but the operator hasn't yet run
//   `npx wrangler d1 migrations apply air-action-sports-db --remote`
// to apply migration 0021_feature_flags.sql.
//
// During this window, the Worker's lib/featureFlags.js sees D1 errors
// of the form "no such table: feature_flags" (and the same for
// feature_flag_user_overrides). The reader functions degrade gracefully
// (false / []) so the UI doesn't crash; the writer re-throws loudly so
// the operator can see something is wrong if they trigger a write.

import { describe, it, expect } from 'vitest';
import {
    isEnabled,
    listFlags,
    setUserOverride,
} from '../../../worker/lib/featureFlags.js';
import { createMockD1 } from '../../helpers/mockD1.js';

// Note: regex patterns avoid `.*` between SELECT and FROM because `.`
// doesn't match newlines by default — the lib's SQL is multi-line.
// We anchor on the table name directly.

function makeTableMissingEnv() {
    const db = createMockD1();
    // Both reads against feature_flags table throw "no such table"
    db.__on(/FROM feature_flags\b/, () => {
        throw new Error('D1_ERROR: no such table: feature_flags: SQLITE_ERROR');
    }, 'first');
    db.__on(/FROM feature_flags\b/, () => {
        throw new Error('D1_ERROR: no such table: feature_flags: SQLITE_ERROR');
    }, 'all');
    // Read against the overrides table also throws
    db.__on(/FROM feature_flag_user_overrides/, () => {
        throw new Error('D1_ERROR: no such table: feature_flag_user_overrides: SQLITE_ERROR');
    }, 'first');
    // Write against overrides also throws
    db.__on(/INSERT OR REPLACE INTO feature_flag_user_overrides/, () => {
        throw new Error('D1_ERROR: no such table: feature_flag_user_overrides: SQLITE_ERROR');
    }, 'run');
    return { DB: db };
}

const MANAGER = { id: 'u_mgr', role: 'manager' };

describe('feature-flag readiness — table missing (Worker deployed before migration applied)', () => {
    it('isEnabled returns false when feature_flags table is missing', async () => {
        const env = makeTableMissingEnv();
        expect(await isEnabled(env, 'density_compact', MANAGER)).toBe(false);
    });

    it('listFlags returns [] when feature_flags table is missing', async () => {
        const env = makeTableMissingEnv();
        expect(await listFlags(env, MANAGER)).toEqual([]);
    });

    it('isEnabled handles a successful flags read but missing overrides table (state=user_opt_in)', async () => {
        // Subtle: feature_flags exists but feature_flag_user_overrides
        // doesn't. The lib should fall back to user_opt_in_default.
        const db = createMockD1();
        db.__on(/FROM feature_flags\b/, {
            key: 'density_compact',
            state: 'user_opt_in',
            user_opt_in_default: 1,
        }, 'first');
        db.__on(/FROM feature_flag_user_overrides/, () => {
            throw new Error('D1_ERROR: no such table: feature_flag_user_overrides: SQLITE_ERROR');
        }, 'first');

        expect(await isEnabled({ DB: db }, 'density_compact', MANAGER)).toBe(true);  // falls back to default=1
    });

    it('setUserOverride throws loudly (writes do NOT degrade gracefully)', async () => {
        const env = makeTableMissingEnv();
        await expect(
            setUserOverride(env, 'density_compact', 'u_mgr', true),
        ).rejects.toThrow(/no such table/);
    });
});

describe('feature-flag readiness — non-table errors bubble up', () => {
    it('isEnabled re-throws a connection error from feature_flags read', async () => {
        const db = createMockD1();
        db.__on(/FROM feature_flags\b/, () => {
            throw new Error('D1_ERROR: connection lost');
        }, 'first');
        await expect(isEnabled({ DB: db }, 'foo', MANAGER)).rejects.toThrow(/connection lost/);
    });

    it('listFlags re-throws a non-table error', async () => {
        const db = createMockD1();
        db.__on(/FROM feature_flags\b/, () => {
            throw new Error('D1_ERROR: connection lost');
        }, 'all');
        await expect(listFlags({ DB: db }, MANAGER)).rejects.toThrow(/connection lost/);
    });

    it('isEnabled re-throws a non-table error from the overrides read', async () => {
        const db = createMockD1();
        db.__on(/FROM feature_flags\b/, {
            key: 'foo',
            state: 'user_opt_in',
            user_opt_in_default: 0,
        }, 'first');
        db.__on(/FROM feature_flag_user_overrides/, () => {
            throw new Error('D1_ERROR: connection lost');
        }, 'first');
        await expect(isEnabled({ DB: db }, 'foo', MANAGER)).rejects.toThrow(/connection lost/);
    });
});
