// Marketing milestone B4 — campaign engagement tracking tests.

import { describe, it, expect } from 'vitest';
import {
    CAMPAIGN_TRACKED_EVENTS,
    correlateCampaignEvent,
    getCampaignStats,
} from '../../../worker/lib/campaignTracking.js';
import { createMockD1 } from '../../helpers/mockD1.js';

const evt = (type, emailId) => ({ type, data: { email_id: emailId, to: ['a@x.com'] } });

describe('CAMPAIGN_TRACKED_EVENTS', () => {
    it('covers the five engagement events', () => {
        for (const t of ['email.delivered', 'email.opened', 'email.clicked', 'email.bounced', 'email.complained']) {
            expect(CAMPAIGN_TRACKED_EVENTS.has(t)).toBe(true);
        }
        expect(CAMPAIGN_TRACKED_EVENTS.has('email.sent')).toBe(false);
    });
});

describe('correlateCampaignEvent', () => {
    const cases = [
        ['email.delivered', 'delivered_at'],
        ['email.opened', 'opened_at'],
        ['email.clicked', 'clicked_at'],
        ['email.bounced', 'bounced_at'],
        ['email.complained', 'complained_at'],
    ];

    for (const [type, column] of cases) {
        it(`${type} → sets ${column} on the matching recipient`, async () => {
            const db = createMockD1();
            db.__on(new RegExp(`UPDATE campaign_recipients SET ${column} = \\? WHERE resend_email_id`), { meta: { changes: 1 } }, 'run');
            const out = await correlateCampaignEvent(db, evt(type, 're_abc'), { now: 999 });
            expect(out).toEqual({ matched: true, column });
            const w = db.__writes().find((x) => x.kind === 'run' && x.sql.includes(`${column} = ?`));
            expect(w).toBeDefined();
            expect(w.args).toEqual([999, 're_abc']);
        });
    }

    it('no-ops for an untracked event type', async () => {
        const db = createMockD1();
        const out = await correlateCampaignEvent(db, evt('email.sent', 're_abc'));
        expect(out).toEqual({ matched: false, column: null });
        expect(db.__writes().filter((w) => w.kind === 'run')).toHaveLength(0);
    });

    it('no-ops when the event carries no resend email id', async () => {
        const db = createMockD1();
        const out = await correlateCampaignEvent(db, { type: 'email.opened', data: {} });
        expect(out.matched).toBe(false);
        expect(db.__writes().filter((w) => w.kind === 'run')).toHaveLength(0);
    });

    it('matched=false when no recipient row updates (changes=0)', async () => {
        const db = createMockD1();
        db.__on(/UPDATE campaign_recipients SET opened_at/, { meta: { changes: 0 } }, 'run');
        const out = await correlateCampaignEvent(db, evt('email.opened', 're_unknown'));
        expect(out.matched).toBe(false);
    });
});

describe('getCampaignStats', () => {
    it('returns engagement counts from the aggregate row', async () => {
        const db = createMockD1();
        db.__on(/FROM campaign_recipients WHERE campaign_id = \?/, {
            recipients: 10, sent: 8, failed: 1, delivered: 7, opened: 4, clicked: 2, bounced: 1, complained: 0,
        }, 'first');
        const stats = await getCampaignStats(db, 'cmp_1');
        expect(stats).toEqual({
            recipients: 10, sent: 8, failed: 1, delivered: 7, opened: 4, clicked: 2, bounced: 1, complained: 0,
        });
    });

    it('returns zeros when the table is missing (unmigrated)', async () => {
        const db = createMockD1();
        db.__on(/FROM campaign_recipients WHERE campaign_id = \?/, () => { throw new Error('no such table'); }, 'first');
        const stats = await getCampaignStats(db, 'cmp_1');
        expect(stats.recipients).toBe(0);
        expect(stats.delivered).toBe(0);
    });
});
