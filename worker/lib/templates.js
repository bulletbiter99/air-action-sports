// DB-backed email template loader + variable renderer.
// Variables look like {{player_name}} in subject/body.

export async function loadTemplate(db, slug) {
    return db.prepare(
        `SELECT * FROM email_templates WHERE slug = ?`
    ).bind(slug).first();
}

export function renderTemplate(template, vars) {
    return {
        subject: substitute(template.subject, vars),
        html: substitute(template.body_html, vars),
        text: template.body_text ? substitute(template.body_text, vars) : undefined,
    };
}

function substitute(str, vars) {
    if (!str) return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const v = vars[key];
        return v == null ? '' : String(v);
    });
}
