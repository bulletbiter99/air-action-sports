// M5 Batch 5 — tests for scripts/import-job-descriptions.js (pure helpers).

import { describe, it, expect } from 'vitest';
import { parseJobDescriptions, buildRow, planImport } from '../../../scripts/import-job-descriptions.js';

const SAMPLE_MD = `# Some preamble

Don't pick this up.

## 1. Event Director / Operations Manager

**Department:** Operations

This is the Event Director description body.
Multiple paragraphs allowed.

## 2. Booking / Customer Service Coordinator

The BC role description.

## 3. Marketing / Social Media Manager

Marketing role.
`;

describe('parseJobDescriptions', () => {
    it('parses numbered H2 sections into { number, title, body }', () => {
        const sections = parseJobDescriptions(SAMPLE_MD);
        expect(sections).toHaveLength(3);
        expect(sections[0]).toMatchObject({ number: 1, title: 'Event Director / Operations Manager' });
        expect(sections[0].body).toContain('Department:');
        expect(sections[0].body).toContain('This is the Event Director');
        expect(sections[1].number).toBe(2);
        expect(sections[1].title).toMatch(/Booking/);
        expect(sections[2].number).toBe(3);
    });

    it('returns empty array on no H2 sections', () => {
        expect(parseJobDescriptions('No headings here')).toEqual([]);
    });

    it('skips H2 without numbered prefix', () => {
        const md = `## Just a heading\n\nbody\n\n## 1. Real Section\n\nbody`;
        const sections = parseJobDescriptions(md);
        expect(sections).toHaveLength(1);
        expect(sections[0].number).toBe(1);
    });

    it('handles preamble before first heading', () => {
        const sections = parseJobDescriptions(SAMPLE_MD);
        // Preamble shouldn't show up; first section starts at "## 1."
        expect(sections[0].body.startsWith('Don\'t pick this up')).toBe(false);
    });
});

describe('buildRow', () => {
    it('produces a staff_documents row from a section + roleId', () => {
        const section = { number: 1, title: 'Event Director', body: 'Body content here.' };
        const row = buildRow(section, 'role_event_director');
        expect(row.kind).toBe('jd');
        expect(row.slug).toBe('event_director_jd');
        expect(row.title).toBe('Event Director');
        expect(row.body_html).toBe('Body content here.');
        expect(row.body_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(row.version).toBe('v1.0');
        expect(row.primary_role_id).toBe('role_event_director');
        expect(row.id).toMatch(/^sd_/);
    });

    it('truncates long descriptions to 120 chars', () => {
        const longTitle = 'X'.repeat(200);
        const section = { number: 1, title: longTitle, body: 'body' };
        const row = buildRow(section, 'role_event_director');
        expect(row.description.length).toBeLessThanOrEqual(120);
        expect(row.description.endsWith('...')).toBe(true);
    });

    it('keeps short descriptions intact', () => {
        const section = { number: 1, title: 'Event Director', body: 'body' };
        const row = buildRow(section, 'role_event_director');
        expect(row.description).toBe('Event Director');
    });
});

describe('planImport', () => {
    it('creates rows for new sections matching the role catalog order', () => {
        const plan = planImport(SAMPLE_MD, []);
        expect(plan.toCreate).toHaveLength(3);
        expect(plan.toCreate[0].slug).toBe('event_director_jd');
        expect(plan.toCreate[1].slug).toBe('booking_coordinator_jd');
        expect(plan.toCreate[2].slug).toBe('marketing_manager_jd');
        expect(plan.toSkip).toHaveLength(0);
        expect(plan.toFlag).toHaveLength(0);
    });

    it('skips sections that already have an existing slug', () => {
        const plan = planImport(SAMPLE_MD, ['event_director_jd']);
        expect(plan.toCreate).toHaveLength(2);
        expect(plan.toSkip).toHaveLength(1);
        expect(plan.toSkip[0].slug).toBe('event_director_jd');
    });

    it('flags sections beyond the 22-role catalog as no_matching_role', () => {
        const md = `## 23. Unknown Role\n\nbody\n\n## 30. Another\n\nbody`;
        const plan = planImport(md, []);
        expect(plan.toCreate).toHaveLength(0);
        expect(plan.toFlag).toHaveLength(2);
        expect(plan.toFlag[0].reason).toBe('no_matching_role');
        expect(plan.toFlag[0].section).toBe(23);
    });

    it('idempotent: re-running with all slugs already present produces zero creates', () => {
        const plan = planImport(SAMPLE_MD, [
            'event_director_jd',
            'booking_coordinator_jd',
            'marketing_manager_jd',
        ]);
        expect(plan.toCreate).toHaveLength(0);
        expect(plan.toSkip).toHaveLength(3);
    });

    it('produces deterministic slugs based on roleId order', () => {
        const md = `## 11. Check-In / Registration Staff\n\nbody`;
        const plan = planImport(md, []);
        expect(plan.toCreate[0].slug).toBe('check_in_staff_jd');
        expect(plan.toCreate[0].primary_role_id).toBe('role_check_in_staff');
    });
});

describe('integration: parses the actual staff-job-descriptions.md', () => {
    it('finds 22 numbered sections in the real doc', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const docPath = path.join(process.cwd(), 'docs', 'staff-job-descriptions.md');
        const md = fs.readFileSync(docPath, 'utf8');
        const sections = parseJobDescriptions(md);
        expect(sections).toHaveLength(22);
        // Confirm role catalog alignment
        expect(sections[0].title).toMatch(/Event Director/);
        expect(sections[21].title).toMatch(/Attorney/);
    });

    it('produces 22 creates when planning against the real doc with no prior state', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const docPath = path.join(process.cwd(), 'docs', 'staff-job-descriptions.md');
        const md = fs.readFileSync(docPath, 'utf8');
        const plan = planImport(md, []);
        expect(plan.toCreate).toHaveLength(22);
        expect(plan.toFlag).toHaveLength(0);
    });
});
