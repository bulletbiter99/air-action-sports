// Rate-limit middleware wrapping Cloudflare's Workers Rate Limiting bindings.
//
// Usage:
//   router.post('/login', rateLimit('RL_LOGIN'), handler);
//   router.post('/forgot-password', rateLimit('RL_FORGOT', (c) => {
//     // key by IP + email to cap per-address abuse
//     const body = c.get('earlyBody') || {};
//     return `${clientIp(c)}:${(body.email || '').toLowerCase()}`;
//   }), handler);
//
// Keying rules:
//   - Default key is CF-Connecting-IP. Works for most brute-force defenses.
//   - Pass a custom keyFn(c) for email-bound or user-bound buckets.
//
// Failure modes:
//   - Binding missing (local dev, misconfigured) → middleware no-ops.
//     This keeps `wrangler dev` working without forcing mocks.
//   - No IP header → no-op. This is extremely rare on Workers but defensive.
//   - binding.limit() throws → log and allow. Don't fail requests because
//     the rate limiter backend hiccupped.

export function rateLimit(bindingName, keyFn = defaultKey) {
    return async (c, next) => {
        const binding = c.env[bindingName];
        if (!binding) return next();
        const key = keyFn(c);
        if (!key) return next();
        try {
            const { success } = await binding.limit({ key });
            if (!success) {
                return c.json({ error: 'Too many requests. Slow down and try again in a minute.' }, 429);
            }
        } catch (err) {
            console.error(`Rate-limit ${bindingName} error`, err);
            // fall through on error — availability beats strict enforcement here
        }
        return next();
    };
}

export function clientIp(c) {
    return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '';
}

function defaultKey(c) {
    return clientIp(c);
}
