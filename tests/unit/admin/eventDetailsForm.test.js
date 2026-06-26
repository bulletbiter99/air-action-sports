// M8 item-6b — converters between the AdminEvents detail-content form fields
// and the events.details_json payload.

import { describe, it, expect } from 'vitest';
import { formStateToDetailsPayload, detailsToFormState, emptyDetailsFormState } from '../../../src/admin/eventDetailsForm.js';

describe('formStateToDetailsPayload', () => {
    it('splits mission briefing into paragraphs and rules into lines', () => {
        const out = formStateToDetailsPayload({
            missionBriefing: 'Para one.\n\nPara two.',
            rules: 'No blind fire\nFPS 350\n',
        });
        expect(out.missionBriefing).toEqual(['Para one.', 'Para two.']);
        expect(out.rules).toEqual(['No blind fire', 'FPS 350']);
    });

    it('parses schedule and documents from delimited lines', () => {
        const out = formStateToDetailsPayload({
            schedule: '7:00 AM | Check-in\n8:00 AM | First game',
            documents: 'Waiver | https://forms.example/w | sign first\nMap |  | ',
        });
        expect(out.schedule).toEqual([
            { time: '7:00 AM', label: 'Check-in' },
            { time: '8:00 AM', label: 'First game' },
        ]);
        expect(out.documents).toEqual([
            { label: 'Waiver', url: 'https://forms.example/w', note: 'sign first' },
            { label: 'Map', url: '', note: '' },
        ]);
    });

    it('parses an optional leading day for multi-day schedules; 2-cell stays day-less', () => {
        const out = formStateToDetailsPayload({
            schedule: '1 | 7:00 AM | Check-in\n2 | 6:00 AM | Dawn push\n10:00 AM | No-day line',
        });
        expect(out.schedule).toEqual([
            { day: 1, time: '7:00 AM', label: 'Check-in' },
            { day: 2, time: '6:00 AM', label: 'Dawn push' },
            { time: '10:00 AM', label: 'No-day line' },
        ]);
    });

    it('parses factionLinks and drops lines missing a name or url', () => {
        const out = formStateToDetailsPayload({
            factionLinks: 'Kraken | https://forms.example/k\nBolotnik |\n| https://x.example',
        });
        expect(out.factionLinks).toEqual({ Kraken: 'https://forms.example/k' });
    });

    it('trims scalar fields', () => {
        const out = formStateToDetailsPayload({ terrain: '  Jungle  ', fpsLabel: '350 / 450', collabBannerUrl: ' /uploads/b.png ' });
        expect(out.terrain).toBe('Jungle');
        expect(out.fpsLabel).toBe('350 / 450');
        expect(out.collabBannerUrl).toBe('/uploads/b.png');
    });
});

describe('detailsToFormState', () => {
    it('joins arrays back into editable text', () => {
        const fs = detailsToFormState({
            missionBriefing: ['A.', 'B.'],
            rules: ['r1', 'r2'],
            schedule: [{ time: '7:00 AM', label: 'Check-in' }],
            documents: [{ label: 'Waiver', url: 'https://x', note: 'n' }],
            factionLinks: { Kraken: 'https://k' },
            terrain: 'Jungle',
        });
        expect(fs.missionBriefing).toBe('A.\n\nB.');
        expect(fs.rules).toBe('r1\nr2');
        expect(fs.schedule).toBe('7:00 AM | Check-in');
        expect(fs.documents).toBe('Waiver | https://x | n');
        expect(fs.factionLinks).toBe('Kraken | https://k');
        expect(fs.terrain).toBe('Jungle');
    });

    it('round-trips structured fields through both converters', () => {
        const original = {
            missionBriefing: ['Para one.', 'Para two.'],
            rules: ['No blind fire'],
            schedule: [{ time: '7:00 AM', label: 'Check-in' }, { time: '2:00 PM', label: 'Exfil' }],
            terrain: 'Dense jungle',
            fpsLabel: '350 / 450',
        };
        const round = formStateToDetailsPayload(detailsToFormState(original));
        expect(round.missionBriefing).toEqual(original.missionBriefing);
        expect(round.rules).toEqual(original.rules);
        expect(round.schedule).toEqual(original.schedule);
        expect(round.terrain).toBe(original.terrain);
        expect(round.fpsLabel).toBe(original.fpsLabel);
    });

    it('round-trips a day-keyed (multi-day) schedule', () => {
        const original = {
            schedule: [
                { day: 1, time: '7:00 AM', label: 'Check-in' },
                { day: 2, time: '6:00 AM', label: 'Dawn push' },
            ],
        };
        const round = formStateToDetailsPayload(detailsToFormState(original));
        expect(round.schedule).toEqual(original.schedule);
    });

    it('emptyDetailsFormState is all blank strings', () => {
        const fs = emptyDetailsFormState();
        expect(Object.values(fs).every((v) => v === '')).toBe(true);
    });
});
