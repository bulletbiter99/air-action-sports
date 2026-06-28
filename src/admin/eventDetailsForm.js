// M8 item-6b — pure converters between the AdminEvents "Detail page content"
// form fields (operator-friendly text) and the events.details_json object that
// normalizeEventDetails (worker/routes/admin/events.js) sanitizes server-side.
//
// Multi-value fields are edited as plain text and parsed here:
//   missionBriefing — paragraphs separated by a blank line
//   rules           — one rule per line
//   schedule        — one "time | label" per line
//   documents       — one "label | url | note" per line (url/note optional)
//   factionLinks    — one "Faction name | url" per line
//
// Best-effort: blank lines / missing cells are dropped. The SERVER sanitizer
// (normalizeEventDetails) is the authority on final shape + URL safety — this
// just shapes the payload; it intentionally does not validate URLs.

const splitParas = (t) => String(t || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
const splitLines = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
const cells = (line) => line.split('|').map((s) => s.trim());

/** Form text fields → details object payload (sent as body.details on save). */
export function formStateToDetailsPayload(fs = {}) {
    return {
        missionBriefing: splitParas(fs.missionBriefing),
        rules: splitLines(fs.rules),
        schedule: splitLines(fs.schedule).map((l) => {
            const parts = cells(l);
            // 3+ cells = "day | time | label" (multi-day); 2 = "time | label".
            if (parts.length >= 3) {
                const day = Number(parts[0]);
                const row = { time: parts[1] || '', label: parts[2] || '' };
                if (Number.isInteger(day) && day >= 1) row.day = day;
                return row;
            }
            return { time: parts[0] || '', label: parts[1] || '' };
        }),
        scheduleNote: String(fs.scheduleNote || '').trim(),
        firstGameLabel: String(fs.firstGameLabel || '').trim(),
        fpsLabel: String(fs.fpsLabel || '').trim(),
        documents: splitLines(fs.documents).map((l) => {
            const [label, url, note] = cells(l);
            return { label: label || '', url: url || '', note: note || '' };
        }),
        factionLinks: Object.fromEntries(
            splitLines(fs.factionLinks)
                .map((l) => { const [name, url] = cells(l); return [name || '', url || '']; })
                .filter(([n, u]) => n && u),
        ),
        terrain: String(fs.terrain || '').trim(),
        collabBannerUrl: String(fs.collabBannerUrl || '').trim(),
        coverTextBelow: !!fs.coverTextBelow,
    };
}

/** details object (from formatEvent → event.details) → editable form text fields. */
export function detailsToFormState(details) {
    const d = details || {};
    return {
        missionBriefing: (d.missionBriefing || []).join('\n\n'),
        rules: (d.rules || []).join('\n'),
        schedule: (d.schedule || []).map((r) => (
            r.day != null && r.day !== ''
                ? `${r.day} | ${r.time || ''} | ${r.label || ''}`
                : `${r.time || ''} | ${r.label || ''}`
        )).join('\n'),
        scheduleNote: d.scheduleNote || '',
        firstGameLabel: d.firstGameLabel || '',
        fpsLabel: d.fpsLabel || '',
        documents: (d.documents || []).map((x) => `${x.label || ''} | ${x.url || ''} | ${x.note || ''}`).join('\n'),
        factionLinks: Object.entries(d.factionLinks || {}).map(([n, u]) => `${n} | ${u}`).join('\n'),
        terrain: d.terrain || '',
        collabBannerUrl: d.collabBannerUrl || '',
        coverTextBelow: !!d.coverTextBelow,
    };
}

/** The empty editable shape (new event / no details). */
export function emptyDetailsFormState() {
    return detailsToFormState(null);
}
