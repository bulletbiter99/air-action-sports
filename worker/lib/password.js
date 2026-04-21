// PBKDF2-SHA256 password hashing using Web Crypto (supported in Workers runtime).
// Stored format: pbkdf2$<iterations>$<salt-b64>$<hash-b64>

// Cloudflare Workers caps PBKDF2 iterations at 100k. Lower than OWASP 2023 guidance
// but acceptable given admin surface area is small (a handful of users) and rate-limited.
const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password, stored) {
    if (!stored || typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations < 1000) return false;
    const salt = fromB64(parts[2]);
    const expected = fromB64(parts[3]);
    const actual = await pbkdf2(password, salt, iterations, expected.length);
    return timingSafeEqual(actual, expected);
}

async function pbkdf2(password, salt, iterations, bytes = HASH_BYTES) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        key,
        bytes * 8
    );
    return new Uint8Array(bits);
}

function b64(bytes) {
    return btoa(String.fromCharCode(...bytes));
}
function fromB64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}
