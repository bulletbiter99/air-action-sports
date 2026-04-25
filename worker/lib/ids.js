// URL-safe random ID generators

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function randomId(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return out;
}

export function bookingId() {
    return `bk_${randomId(14)}`;
}

export function attendeeId() {
    return `at_${randomId(14)}`;
}

export function qrToken() {
    return randomId(24);
}

export function promoCodeId() {
    return `pc_${randomId(12)}`;
}

export function rentalAssignmentId() {
    return `ra_${randomId(12)}`;
}

export function rentalItemId() {
    return `ri_${randomId(12)}`;
}

export function ticketTypeId() {
    return `tt_${randomId(12)}`;
}

export function promoCodeDbId() {
    return `pc_${randomId(12)}`;
}

export function eventId() {
    return `ev_${randomId(12)}`;
}

export function feedbackId() {
    return `fb_${randomId(12)}`;
}

// Turn "Operation Nightfall" into "operation-nightfall". Returns a safe slug
// (lowercase, hyphen-separated, alnum only). Falls back to random if empty.
export function slugify(input) {
    const s = String(input || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return s || `event-${randomId(6).toLowerCase()}`;
}

export function sessionToken() {
    return randomId(40);
}
