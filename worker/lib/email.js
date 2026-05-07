// Resend API wrapper — fetch only, no SDK.
//
// Also exports isValidEmail / normalizeEmail (mirrors of src/utils/email.js;
// see that file for full API documentation). The two helpers are
// duplicated because the Workers runtime can't reach into src/.

const RESEND_API = 'https://api.resend.com/emails';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;  // RFC 5321 §4.5.3.1.3

export function isValidEmail(input) {
    if (typeof input !== 'string') return false;
    const s = input.trim();
    if (!s || s.length > MAX_EMAIL_LEN) return false;
    return EMAIL_RE.test(s);
}

export function normalizeEmail(input) {
    if (!isValidEmail(input)) return null;

    const s = input.trim().normalize('NFC').toLowerCase();
    const atIdx = s.lastIndexOf('@');
    if (atIdx === -1) return null;

    let local = s.slice(0, atIdx);
    const domain = s.slice(atIdx + 1);

    const plusIdx = local.indexOf('+');
    if (plusIdx !== -1) {
        local = local.slice(0, plusIdx);
        if (!local) return null;
    }

    if (domain === 'gmail.com' || domain === 'googlemail.com') {
        local = local.replace(/\./g, '');
        if (!local) return null;
    }

    return local + '@' + domain;
}

export async function sendEmail({ apiKey, from, to, replyTo, subject, html, text, tags }) {
    const body = {
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(tags ? { tags } : {}),
    };
    const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Resend failed: ${res.status} ${err}`);
    }
    return res.json();
}
