// DB-backed email template loader + variable renderer.
// Variables look like {{player_name}} in subject/body.
//
// Security: variables are always CRLF-stripped (header-injection guard).
// HTML bodies additionally get HTML-entity-escaped — any attacker-controlled
// string (booker name, email, event title, custom answers) is untrusted.
//
// M6 B3: `status` column added by migration 0056. `loadTemplate` now
// silently skips drafts unless the caller passes { includeDrafts: true }.
// This is the single template-fetch chokepoint used by every sender in
// worker/lib/emailSender.js — drafts return null, so the existing
// `if (!template) return { skipped: 'template_missing' }` guard in each
// sender fires without any sender-side change. Admin preview opts in
// to includeDrafts so authors can iterate before publishing.

export async function loadTemplate(db, slug, { includeDrafts = false } = {}) {
    const row = await db.prepare(
        `SELECT * FROM email_templates WHERE slug = ?`
    ).bind(slug).first();
    if (!row) return null;
    if (!includeDrafts && row.status === 'draft') return null;
    return row;
}

export function renderTemplate(template, vars) {
    return {
        subject: substitute(template.subject, vars, { escape: 'text' }),
        html: substitute(template.body_html, vars, { escape: 'html' }),
        text: template.body_text ? substitute(template.body_text, vars, { escape: 'text' }) : undefined,
    };
}

function substitute(str, vars, { escape } = { escape: 'text' }) {
    if (!str) return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const v = vars[key];
        if (v == null) return '';
        const raw = String(v).replace(/[\r\n]+/g, ' ');
        return escape === 'html' ? escapeHtml(raw) : raw;
    });
}

function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
