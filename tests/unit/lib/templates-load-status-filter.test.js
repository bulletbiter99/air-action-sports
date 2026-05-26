// M6 B3 — loadTemplate gains a draft filter (migration 0056).
// These tests pin the chokepoint behavior that every named sender in
// worker/lib/emailSender.js relies on: drafts return null by default,
// so the existing `if (!template) return { skipped: 'template_missing' }`
// guard in each sender fires without sender-side changes.

import { describe, it, expect } from 'vitest';
import { loadTemplate } from '../../../worker/lib/templates.js';
import { createMockD1 } from '../../helpers/mockD1.js';

function published(slug, extra = {}) {
    return {
        id: `tpl_${slug}`,
        slug,
        subject: 'Subject for ' + slug,
        body_html: '<p>HTML</p>',
        body_text: 'text',
        variables_json: null,
        updated_by: null,
        updated_at: 1700000000000,
        created_at: 1700000000000,
        status: 'published',
        ...extra,
    };
}

function draft(slug, extra = {}) {
    return published(slug, { status: 'draft', ...extra });
}

describe('loadTemplate — published rows', () => {
    it('returns the row when status=published', async () => {
        const db = createMockD1();
        db.__on(/FROM email_templates WHERE slug = \?/, published('booking_confirmation'), 'first');
        const row = await loadTemplate(db, 'booking_confirmation');
        expect(row).not.toBeNull();
        expect(row.slug).toBe('booking_confirmation');
        expect(row.status).toBe('published');
    });

    it('returns the row when status field is absent (legacy pre-M6 B3 compat)', async () => {
        const db = createMockD1();
        const legacyRow = published('legacy');
        delete legacyRow.status;
        db.__on(/FROM email_templates/, legacyRow, 'first');
        const row = await loadTemplate(db, 'legacy');
        expect(row).not.toBeNull();
        expect(row.slug).toBe('legacy');
    });

    it('returns the row when status is null (defensive)', async () => {
        const db = createMockD1();
        db.__on(/FROM email_templates/, published('nullish', { status: null }), 'first');
        const row = await loadTemplate(db, 'nullish');
        expect(row).not.toBeNull();
    });
});

describe('loadTemplate — draft rows', () => {
    it('returns null for status=draft when includeDrafts is omitted', async () => {
        const db = createMockD1();
        db.__on(/FROM email_templates/, draft('booking_confirmation'), 'first');
        const row = await loadTemplate(db, 'booking_confirmation');
        expect(row).toBeNull();
    });

    it('returns null for status=draft when includeDrafts=false', async () => {
        const db = createMockD1();
        db.__on(/FROM email_templates/, draft('booking_confirmation'), 'first');
        const row = await loadTemplate(db, 'booking_confirmation', { includeDrafts: false });
        expect(row).toBeNull();
    });

    it('returns the row for status=draft when includeDrafts=true (preview opt-in)', async () => {
        const db = createMockD1();
        db.__on(/FROM email_templates/, draft('booking_confirmation'), 'first');
        const row = await loadTemplate(db, 'booking_confirmation', { includeDrafts: true });
        expect(row).not.toBeNull();
        expect(row.status).toBe('draft');
    });
});

describe('loadTemplate — missing rows', () => {
    it('returns null when no template exists (independent of includeDrafts)', async () => {
        const db = createMockD1();
        // No handler registered — mockD1 returns null for unmatched first().
        const noFlag = await loadTemplate(db, 'does_not_exist');
        const withFlag = await loadTemplate(db, 'does_not_exist', { includeDrafts: true });
        expect(noFlag).toBeNull();
        expect(withFlag).toBeNull();
    });

    it('binds the slug into the SQL query', async () => {
        const db = createMockD1();
        db.__on(/FROM email_templates WHERE slug = \?/, published('event_reminder_24h'), 'first');
        await loadTemplate(db, 'event_reminder_24h');
        const writes = db.__writes();
        const lookup = writes.find((w) => /FROM email_templates WHERE slug/.test(w.sql));
        expect(lookup).toBeDefined();
        expect(lookup.args).toEqual(['event_reminder_24h']);
    });
});
