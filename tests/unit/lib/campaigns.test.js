// Marketing milestone B2 — campaign domain logic tests (pure + resolution).

import { describe, it, expect } from 'vitest';
import {
    CAMPAIGN_STATUSES,
    canTransition,
    validateCampaignInput,
    formatCampaign,
    formatCampaignSummary,
    resolveCampaignRecipients,
} from '../../../worker/lib/campaigns.js';
import { createMockD1 } from '../../helpers/mockD1.js';

const fullInput = {
    name: '  Spring blast  ',
    subject: '  Come back  ',
    bodyHtml: '<p>hi</p>',
    bodyText: 'hi',
    segmentId: 'seg_1',
    fromName: 'Air Action',
    scheduledAt: 1_800_000_000_000,
};

describe('validateCampaignInput — create (full)', () => {
    it('accepts a complete input and trims strings', () => {
        const v = validateCampaignInput(fullInput);
        expect(v.valid).toBe(true);
        expect(v.normalized.name).toBe('Spring blast');
        expect(v.normalized.subject).toBe('Come back');
        expect(v.normalized.bodyHtml).toBe('<p>hi</p>');
        expect(v.normalized.segmentId).toBe('seg_1');
        expect(v.normalized.scheduledAt).toBe(1_800_000_000_000);
    });

    it('requires name, subject, bodyHtml', () => {
        expect(validateCampaignInput({ subject: 's', bodyHtml: 'b' }).valid).toBe(false);
        expect(validateCampaignInput({ name: 'n', bodyHtml: 'b' }).valid).toBe(false);
        expect(validateCampaignInput({ name: 'n', subject: 's' }).valid).toBe(false);
    });

    it('rejects a blank (whitespace-only) name', () => {
        expect(validateCampaignInput({ name: '   ', subject: 's', bodyHtml: 'b' }).valid).toBe(false);
    });

    it('rejects a non-object body', () => {
        expect(validateCampaignInput(null).valid).toBe(false);
        expect(validateCampaignInput('nope').valid).toBe(false);
        expect(validateCampaignInput([]).valid).toBe(false);
    });

    it('coerces empty/whitespace segmentId to null (whole base)', () => {
        expect(validateCampaignInput({ name: 'n', subject: 's', bodyHtml: 'b', segmentId: '' }).normalized.segmentId).toBeNull();
        expect(validateCampaignInput({ name: 'n', subject: 's', bodyHtml: 'b', segmentId: '   ' }).normalized.segmentId).toBeNull();
        expect(validateCampaignInput({ name: 'n', subject: 's', bodyHtml: 'b', segmentId: null }).normalized.segmentId).toBeNull();
    });

    it('rejects a non-string non-null segmentId', () => {
        expect(validateCampaignInput({ name: 'n', subject: 's', bodyHtml: 'b', segmentId: 42 }).valid).toBe(false);
    });

    it('rejects a non-positive or non-finite scheduledAt', () => {
        expect(validateCampaignInput({ name: 'n', subject: 's', bodyHtml: 'b', scheduledAt: 0 }).valid).toBe(false);
        expect(validateCampaignInput({ name: 'n', subject: 's', bodyHtml: 'b', scheduledAt: -5 }).valid).toBe(false);
        expect(validateCampaignInput({ name: 'n', subject: 's', bodyHtml: 'b', scheduledAt: 'soon' }).valid).toBe(false);
    });

    it('accepts a null scheduledAt (unschedule)', () => {
        const v = validateCampaignInput({ name: 'n', subject: 's', bodyHtml: 'b', scheduledAt: null });
        expect(v.valid).toBe(true);
        expect(v.normalized.scheduledAt).toBeNull();
    });
});

describe('validateCampaignInput — partial (PUT)', () => {
    it('does not require name/subject/bodyHtml when partial', () => {
        const v = validateCampaignInput({ subject: 'New subject' }, { partial: true });
        expect(v.valid).toBe(true);
        expect(v.normalized).toEqual({ subject: 'New subject' });
    });

    it('still validates a present field', () => {
        expect(validateCampaignInput({ name: '' }, { partial: true }).valid).toBe(false);
    });
});

describe('canTransition', () => {
    it('allows the documented forward transitions', () => {
        expect(canTransition('draft', 'sending')).toBe(true);
        expect(canTransition('draft', 'scheduled')).toBe(true);
        expect(canTransition('draft', 'canceled')).toBe(true);
        expect(canTransition('scheduled', 'sending')).toBe(true);
        expect(canTransition('scheduled', 'draft')).toBe(true);
        expect(canTransition('sending', 'sent')).toBe(true);
    });

    it('blocks illegal transitions', () => {
        expect(canTransition('sent', 'sending')).toBe(false);
        expect(canTransition('sent', 'draft')).toBe(false);
        expect(canTransition('canceled', 'sending')).toBe(false);
        expect(canTransition('sending', 'draft')).toBe(false);
        expect(canTransition('bogus', 'sending')).toBe(false);
    });

    it('CAMPAIGN_STATUSES lists the five statuses', () => {
        expect(CAMPAIGN_STATUSES).toEqual(['draft', 'scheduled', 'sending', 'sent', 'canceled']);
    });
});

describe('formatCampaign / formatCampaignSummary', () => {
    const row = {
        id: 'cmp_1', name: 'N', subject: 'S', body_html: '<p>b</p>', body_text: 'b',
        segment_id: 'seg_1', status: 'draft', scheduled_at: null, from_name: 'AA',
        recipient_count: 5, sent_count: 2, failed_count: 1, created_by: 'u1',
        created_at: 100, updated_at: 200, sent_at: null,
    };

    it('maps snake_case columns to camelCase (detail)', () => {
        const f = formatCampaign(row);
        expect(f).toMatchObject({
            id: 'cmp_1', bodyHtml: '<p>b</p>', bodyText: 'b', segmentId: 'seg_1',
            recipientCount: 5, sentCount: 2, failedCount: 1, createdBy: 'u1', sentAt: null,
        });
    });

    it('summary drops the body fields', () => {
        const s = formatCampaignSummary(row);
        expect(s.bodyHtml).toBeUndefined();
        expect(s.bodyText).toBeUndefined();
        expect(s.id).toBe('cmp_1');
        expect(s.recipientCount).toBe(5);
    });
});

describe('resolveCampaignRecipients', () => {
    it('null segment → whole marketing-opted base; filters null emails', async () => {
        const db = createMockD1();
        db.__on(/email_marketing = 1 AND archived_at IS NULL/, {
            results: [
                { id: 'cus_a', email: 'a@x.com', name: 'Alice' },
                { id: 'cus_b', email: null, name: 'NoEmail' },
                { id: 'cus_c', email: 'c@x.com', name: null },
            ],
        }, 'all');

        const out = await resolveCampaignRecipients(db, { segmentId: null });
        expect(out).toEqual([
            { customerId: 'cus_a', email: 'a@x.com', name: 'Alice' },
            { customerId: 'cus_c', email: 'c@x.com', name: null },
        ]);
    });

    it('segment path loads the stored spec + resolves via the segment SQL', async () => {
        const db = createMockD1();
        db.__on(/FROM segments WHERE id = \? AND type/, {
            query_json: JSON.stringify({ v: 1, tags: { any: ['vip'] } }),
        }, 'first');
        db.__on(/customers\.id, customers\.email, customers\.name/, {
            results: [{ id: 'cus_v', email: 'v@x.com', name: 'Vip' }],
        }, 'all');

        const out = await resolveCampaignRecipients(db, { segmentId: 'seg_1' });
        expect(out).toEqual([{ customerId: 'cus_v', email: 'v@x.com', name: 'Vip' }]);
    });

    it('throws when the segment is missing', async () => {
        const db = createMockD1();
        db.__on(/FROM segments WHERE id = \? AND type/, null, 'first');
        await expect(resolveCampaignRecipients(db, { segmentId: 'nope' })).rejects.toThrow(/segment not found/);
    });

    it('throws when the stored spec is invalid', async () => {
        const db = createMockD1();
        db.__on(/FROM segments WHERE id = \? AND type/, { query_json: JSON.stringify({ v: 99 }) }, 'first');
        await expect(resolveCampaignRecipients(db, { segmentId: 'seg_bad' })).rejects.toThrow(/segment spec invalid/);
    });
});
