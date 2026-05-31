// Pure helpers for the Resend bounce/complaint webhook consumer (M7 Batch 8).
//
// These are the testable core of POST /api/webhooks/resend: they shape the raw
// Resend payload into a normalized record and decide whether a marketing
// suppression should fire. All I/O (signature verify, D1 reads/writes) lives in
// worker/routes/webhooks.js handleResendEmailEvent; everything here is pure.
//
// emailEventId() reuses ids.js's randomId so the High-DNT ids.js contract is
// untouched while keeping the new 'eev_' prefix co-located with its domain.

import { randomId } from './ids.js';

/** New email_events primary key, e.g. 'eev_aZ09…' (mirrors ids.js style). */
export function emailEventId() {
    return `eev_${randomId(14)}`;
}

/**
 * Normalize a Resend webhook event into a flat record.
 *
 * Resend's bounce payload has drifted across API versions, so extraction is
 * deliberately defensive:
 *   - recipient lives at data.email (current) OR data.to (older; string|array)
 *   - bounce class lives at data.bounce_type (current 'hard'|'soft') OR
 *     data.bounce.type (older 'Permanent'|'Transient')
 *
 * @param {object} event  The parsed webhook body ({ type, data, ... }).
 * @returns {{ type:'bounce'|'complaint'|null, bounceType:'hard'|'soft'|string|null,
 *            recipient:string|null, resendEmailId:string|null }}
 */
export function classifyResendEvent(event) {
    const data = event?.data || {};
    const type =
        event?.type === 'email.bounced' ? 'bounce' :
        event?.type === 'email.complained' ? 'complaint' :
        null;

    return {
        type,
        bounceType: type === 'bounce' ? normalizeBounceType(data.bounce_type ?? data.bounce?.type) : null,
        recipient: extractRecipient(data),
        resendEmailId: data.email_id || null,
    };
}

/**
 * Marketing email must be suppressed for any spam complaint and for any HARD
 * bounce (the address is permanently undeliverable). Soft (transient) bounces
 * are recorded but do NOT suppress — they often recover (mailbox full, etc.).
 *
 * @param {{ type:string, bounceType:string|null }} classified
 * @returns {boolean}
 */
export function shouldSuppressMarketing(classified) {
    if (!classified) return false;
    if (classified.type === 'complaint') return true;
    return classified.type === 'bounce' && classified.bounceType === 'hard';
}

/** audit_log action name for an internal event type. */
export function eventActionName(type) {
    return type === 'complaint' ? 'email.complained' : 'email.bounced';
}

// ── internal ──────────────────────────────────────────────────────────────

function extractRecipient(data) {
    const raw = data.email ?? (Array.isArray(data.to) ? data.to[0] : data.to);
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed || null;
}

function normalizeBounceType(raw) {
    if (!raw) return null;
    const s = String(raw).toLowerCase();
    if (s === 'hard' || s === 'permanent') return 'hard';
    if (s === 'soft' || s === 'transient') return 'soft';
    return s; // unknown classification — store as-is (lowercased) for forensics
}
