// Public newsletter-signup route tests — POST /api/newsletter.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';

let env;

beforeEach(() => {
  env = createMockEnv();
});

function post(path, body) {
  return worker.fetch(
    new Request(`https://airactionsport.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
    {},
  );
}

const customerWrites = () =>
  env.DB.__writes().filter((w) => /INSERT INTO customers|UPDATE customers/.test(w.sql));

describe('POST /api/newsletter', () => {
  it('400 on a missing/invalid email', async () => {
    const res = await post('/api/newsletter', { email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(customerWrites()).toHaveLength(0);
  });

  it('honeypot filled → silent 200 with no DB writes', async () => {
    const res = await post('/api/newsletter', { email: 'real@player.com', website: 'http://spam' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    // Never touches the DB — returns before any query.
    expect(env.DB.__writes()).toHaveLength(0);
  });

  it('new email → inserts a customer with email_marketing=1 + subscribe audit', async () => {
    // No SELECT handler → first() returns null → insert path.
    const res = await post('/api/newsletter', { email: 'New.Player@Example.com' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });

    const writes = env.DB.__writes();
    const insert = writes.find((w) => /INSERT INTO customers/.test(w.sql));
    expect(insert).toBeDefined();
    // display email preserved, normalized email lower-cased.
    expect(insert.args).toContain('New.Player@Example.com');
    expect(insert.args).toContain('new.player@example.com');

    const audit = writes.find(
      (w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('newsletter.subscribed'),
    );
    expect(audit).toBeDefined();
  });

  it('existing already-subscribed → idempotent 200, no write', async () => {
    env.DB.__on(
      /SELECT id, email_marketing FROM customers/,
      { id: 'cus_1', email_marketing: 1 },
      'first',
    );
    const res = await post('/api/newsletter', { email: 'member@player.com' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alreadySubscribed: true });
    expect(customerWrites()).toHaveLength(0);
  });

  it('existing opted-out → re-opt-in (email_marketing=1) + resubscribe audit', async () => {
    env.DB.__on(
      /SELECT id, email_marketing FROM customers/,
      { id: 'cus_1', email_marketing: 0 },
      'first',
    );
    const res = await post('/api/newsletter', { email: 'comeback@player.com' });
    expect(res.status).toBe(200);

    const writes = env.DB.__writes();
    const upd = writes.find((w) => /UPDATE customers SET email_marketing = 1/.test(w.sql));
    expect(upd).toBeDefined();
    expect(upd.args).toContain('cus_1');

    const audit = writes.find(
      (w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('newsletter.resubscribed'),
    );
    expect(audit).toBeDefined();
    // Did NOT create a duplicate customer.
    expect(writes.find((w) => /INSERT INTO customers/.test(w.sql))).toBeUndefined();
  });
});
