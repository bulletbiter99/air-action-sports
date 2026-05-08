// M5 Batch 4 — at-rest encryption helper for sensitive person fields
// (mailing_address). Uses Web Crypto API AES-GCM with a key derived from
// SESSION_SECRET via PBKDF2. The same secret already protects admin
// session cookies and vendor magic links; co-locating the at-rest key
// avoids managing a separate secret.
//
// Storage shape:  base64(iv || ciphertext || tag)
//   - iv: 12 bytes (AES-GCM standard nonce length)
//   - ciphertext: variable
//   - tag: 16 bytes (appended by AES-GCM)
//
// Read path: extract iv (first 12 bytes), feed to AES-GCM decrypt with
// the rest as ciphertext+tag.
//
// PII gating: callers must check the staff.read.pii capability before
// invoking decrypt(). The helper itself doesn't enforce capability —
// it just provides the cryptographic primitive.

const PBKDF2_ITERATIONS = 100_000;
const SALT_DERIVATION = new TextEncoder().encode('aas-person-encryption-v1');

/**
 * Derives the AES-GCM encryption key from SESSION_SECRET via PBKDF2.
 * Cached in module scope so re-derivation doesn't run on every call —
 * but the cache is per-Worker-instance, so cold starts pay the
 * derivation cost once.
 */
let cachedKey = null;
let cachedKeyForSecret = null;

async function deriveKey(secret) {
    if (cachedKey && cachedKeyForSecret === secret) return cachedKey;
    if (!secret) throw new Error('personEncryption: SESSION_SECRET not configured');

    const baseKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        'PBKDF2',
        false,
        ['deriveKey'],
    );

    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: SALT_DERIVATION,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );

    cachedKey = key;
    cachedKeyForSecret = secret;
    return key;
}

function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
}

function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * Encrypts a cleartext string with the SESSION_SECRET-derived key.
 * Returns base64-encoded `iv || ciphertext || tag`. Returns null when
 * input is null/undefined/empty so the database column stays NULL
 * for "no value" cases.
 *
 * @param {string|null|undefined} cleartext
 * @param {string} sessionSecret
 * @returns {Promise<string|null>}
 */
export async function encrypt(cleartext, sessionSecret) {
    if (cleartext === null || cleartext === undefined || cleartext === '') return null;
    const key = await deriveKey(sessionSecret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(String(cleartext)),
    );
    const ciphertextBytes = new Uint8Array(ciphertext);
    const combined = new Uint8Array(iv.length + ciphertextBytes.length);
    combined.set(iv, 0);
    combined.set(ciphertextBytes, iv.length);
    return bytesToBase64(combined);
}

/**
 * Decrypts the base64 payload produced by encrypt(). Returns null when
 * input is null/undefined/empty. Throws on tampered ciphertext (AES-GCM
 * AEAD verification fails) — caller decides whether to surface the error
 * or fall back to "could not decrypt".
 *
 * @param {string|null|undefined} ciphertextB64
 * @param {string} sessionSecret
 * @returns {Promise<string|null>}
 */
export async function decrypt(ciphertextB64, sessionSecret) {
    if (!ciphertextB64) return null;
    const key = await deriveKey(sessionSecret);
    const combined = base64ToBytes(ciphertextB64);
    if (combined.length < 13) {
        // Too short to even contain an IV + 1 byte; treat as garbage.
        return null;
    }
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext,
    );
    return new TextDecoder().decode(plaintext);
}

/**
 * Convenience helper: tries to decrypt, returns null on any error
 * (tampered ciphertext, malformed base64, missing key). Use in admin
 * read-paths where a corrupted row should render as "(unavailable)"
 * rather than 500 the request.
 *
 * @param {string|null|undefined} ciphertextB64
 * @param {string} sessionSecret
 * @returns {Promise<string|null>}
 */
export async function decryptSafely(ciphertextB64, sessionSecret) {
    try {
        return await decrypt(ciphertextB64, sessionSecret);
    } catch {
        return null;
    }
}

// Test-only export: clears the cached key so test runs can mint fresh
// keys per case (e.g., when testing with different SESSION_SECRET).
export function __resetKeyCache() {
    cachedKey = null;
    cachedKeyForSecret = null;
}
