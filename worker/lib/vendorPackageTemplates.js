// M6 Batch 2 — Pure helpers for vendor_package_templates.
//
// Houses the section parsing/normalization + the clone-to-event-vendor
// section-insert helper. Keeps worker/routes/admin/vendorPackageTemplates.js
// thin and gives us a separately-testable surface.

import { randomId } from './ids.js';

// The CHECK constraint on vendor_package_sections.kind (migration 0010 line
// 70) restricts kind to this enum. Templates store kind as plaintext JSON;
// to guarantee that any template is cloneable into event_vendors without
// hitting the CHECK, normalizeSections coerces unknown values to 'custom'.
export const VALID_SECTION_KINDS = ['overview', 'schedule', 'map', 'contact', 'custom'];

export function parseSections(json) {
    if (!json) return [];
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function isValidSectionShape(s) {
    return s && typeof s === 'object' && typeof s.title === 'string';
}

/**
 * Normalize a sections-array input from the admin API into the canonical
 * shape stored in vendor_package_templates.sections_json. Invalid entries
 * (missing title) are filtered out. Each entry is coerced to:
 *   { kind, title, body_html, sort_order }
 *
 * Unknown `kind` values are coerced to 'custom' so the resulting array is
 * always cloneable into vendor_package_sections (which has a CHECK on kind).
 */
export function normalizeSections(input) {
    if (!Array.isArray(input)) return [];
    return input
        .filter(isValidSectionShape)
        .map((s, idx) => {
            const kindRaw = typeof s.kind === 'string' ? s.kind : '';
            const kind = VALID_SECTION_KINDS.includes(kindRaw) ? kindRaw : 'custom';
            return {
                kind,
                title: String(s.title).slice(0, 200),
                body_html: typeof s.body_html === 'string' ? s.body_html : '',
                sort_order: Number.isFinite(s.sort_order) ? Number(s.sort_order) : idx,
            };
        });
}

/**
 * Clone a template's sections array into vendor_package_sections rows for a
 * newly-created event_vendor. Each section gets a fresh 'vps_*' id and
 * preserves the template's sort_order (or falls back to array index).
 *
 * Uses env.DB.batch() for atomicity — if any INSERT fails, none commit.
 */
export async function cloneTemplateSections(env, eventVendorId, sections, now) {
    if (!Array.isArray(sections) || sections.length === 0) return { inserted: 0 };

    const ts = Number.isFinite(now) ? now : Date.now();
    const stmts = sections.map((s, idx) => env.DB.prepare(
        `INSERT INTO vendor_package_sections
         (id, event_vendor_id, kind, title, body_html, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        `vps_${randomId(12)}`,
        eventVendorId,
        s.kind,
        s.title,
        s.body_html || null,
        Number.isFinite(s.sort_order) ? s.sort_order : idx,
        ts,
        ts,
    ));

    await env.DB.batch(stmts);
    return { inserted: stmts.length };
}
