// Resend API wrapper — fetch only, no SDK.

const RESEND_API = 'https://api.resend.com/emails';

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
