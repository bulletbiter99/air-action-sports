import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { listFlags, setUserOverride } from '../../lib/featureFlags.js';
import { writeAudit } from '../../lib/auditLog.js';

const adminFeatureFlags = new Hono();
adminFeatureFlags.use('*', requireAuth);

// GET /api/admin/feature-flags — list flags + per-user resolved enabled
adminFeatureFlags.get('/', async (c) => {
    const user = c.get('user');
    const flags = await listFlags(c.env, user);
    return c.json({ flags });
});

// PUT /api/admin/feature-flags/:key/override — set the calling user's override
adminFeatureFlags.put('/:key/override', async (c) => {
    const user = c.get('user');
    const key = c.req.param('key');

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.enabled !== 'boolean') {
        return c.json({ error: 'enabled must be a boolean' }, 400);
    }

    // 404 unknown flag — prevents typo'd writes accumulating orphan rows.
    // listFlags returns [] when feature_flags table is missing (deploy-
    // before-migration window), which also fails this check loudly so
    // callers see the unapplied migration instead of a silent write.
    const flags = await listFlags(c.env, user);
    if (!flags.some((f) => f.key === key)) {
        return c.json({ error: 'Unknown flag' }, 404);
    }

    await setUserOverride(c.env, key, user.id, body.enabled);
    await writeAudit(c.env, {
        userId: user.id,
        action: 'feature_flag.override_set',
        targetType: 'feature_flag',
        targetId: key,
        meta: { flag_key: key, enabled: body.enabled },
    });

    return c.json({ success: true });
});

export default adminFeatureFlags;
