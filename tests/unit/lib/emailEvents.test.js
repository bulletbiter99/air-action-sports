// M7 B8 — pure helpers for the Resend bounce/complaint consumer.

import { describe, it, expect } from 'vitest';
import {
    emailEventId,
    classifyResendEvent,
    shouldSuppressMarketing,
    eventActionName,
} from '../../../worker/lib/emailEvents.js';

describe('emailEventId', () => {
    it('produces a prefixed, unique id', () => {
        const a = emailEventId();
        const b = emailEventId();
        expect(a).toMatch(/^eev_[0-9A-Za-z]{14}$/);
        expect(a).not.toBe(b);
    });
});

describe('classifyResendEvent', () => {
    it('classifies a hard bounce (current payload shape: data.bounce_type)', () => {
        const r = classifyResendEvent({
            type: 'email.bounced',
            data: { email: 'bob@example.com', email_id: 'em_1', bounce_type: 'hard' },
        });
        expect(r).toEqual({ type: 'bounce', bounceType: 'hard', recipient: 'bob@example.com', resendEmailId: 'em_1' });
    });

    it('classifies a soft bounce', () => {
        const r = classifyResendEvent({ type: 'email.bounced', data: { email: 'b@e.com', bounce_type: 'soft' } });
        expect(r.type).toBe('bounce');
        expect(r.bounceType).toBe('soft');
    });

    it('normalizes legacy Permanent/Transient bounce classes (data.bounce.type)', () => {
        const hard = classifyResendEvent({ type: 'email.bounced', data: { email: 'b@e.com', bounce: { type: 'Permanent' } } });
        const soft = classifyResendEvent({ type: 'email.bounced', data: { email: 'b@e.com', bounce: { type: 'Transient' } } });
        expect(hard.bounceType).toBe('hard');
        expect(soft.bounceType).toBe('soft');
    });

    it('classifies a complaint (no bounce type)', () => {
        const r = classifyResendEvent({ type: 'email.complained', data: { email: 'c@e.com' } });
        expect(r.type).toBe('complaint');
        expect(r.bounceType).toBeNull();
        expect(r.recipient).toBe('c@e.com');
    });

    it('extracts recipient from data.to (array) when data.email is absent', () => {
        const r = classifyResendEvent({ type: 'email.bounced', data: { to: ['first@e.com', 'second@e.com'], bounce_type: 'hard' } });
        expect(r.recipient).toBe('first@e.com');
    });

    it('extracts recipient from data.to (string)', () => {
        const r = classifyResendEvent({ type: 'email.complained', data: { to: 'solo@e.com' } });
        expect(r.recipient).toBe('solo@e.com');
    });

    it('returns type=null + recipient=null for an unknown event', () => {
        const r = classifyResendEvent({ type: 'email.delivered', data: {} });
        expect(r.type).toBeNull();
        expect(r.recipient).toBeNull();
    });

    it('is defensive against a missing data object', () => {
        const r = classifyResendEvent({ type: 'email.bounced' });
        expect(r.type).toBe('bounce');
        expect(r.recipient).toBeNull();
        expect(r.resendEmailId).toBeNull();
    });
});

describe('shouldSuppressMarketing', () => {
    it('suppresses complaints', () => {
        expect(shouldSuppressMarketing({ type: 'complaint', bounceType: null })).toBe(true);
    });
    it('suppresses hard bounces', () => {
        expect(shouldSuppressMarketing({ type: 'bounce', bounceType: 'hard' })).toBe(true);
    });
    it('does NOT suppress soft bounces', () => {
        expect(shouldSuppressMarketing({ type: 'bounce', bounceType: 'soft' })).toBe(false);
    });
    it('does NOT suppress a bounce with unknown class', () => {
        expect(shouldSuppressMarketing({ type: 'bounce', bounceType: null })).toBe(false);
    });
    it('is defensive against null input', () => {
        expect(shouldSuppressMarketing(null)).toBe(false);
    });
});

describe('eventActionName', () => {
    it('maps internal types to audit_log action names', () => {
        expect(eventActionName('complaint')).toBe('email.complained');
        expect(eventActionName('bounce')).toBe('email.bounced');
    });
});
