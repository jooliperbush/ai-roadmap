import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MARKETS, nextSendTime, withinSendWindow } from '../src/domain/markets.js';
import { availableSlots, zonedToUtc } from '../src/domain/slots.js';
import { parseWebhook, toGraphPayload, verifySignature, verifyWebhook } from '../src/whatsapp/cloudApi.js';
import { assertWithinLimits } from '../src/whatsapp/types.js';
import { ukRestaurant } from './fixtures.js';

describe('Cloud API adapter', () => {
  it('parses text, button, list, template quick-reply and location webhooks', () => {
    const body = {
      entry: [{ changes: [{ value: { messages: [
        { from: '447700900111', id: 'wamid.1', timestamp: '1757322000', type: 'text', text: { body: 'hi' } },
        { from: '447700900111', id: 'wamid.2', timestamp: '1757322001', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'consent:yes', title: 'Yes' } } },
        { from: '447700900111', id: 'wamid.3', timestamp: '1757322002', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'slot:x', title: 'Tue' } } },
        { from: '447700900111', id: 'wamid.4', timestamp: '1757322003', type: 'button', button: { payload: 'accept', text: 'Accept' } },
        { from: '447700900111', id: 'wamid.5', timestamp: '1757322004', type: 'location', location: { latitude: 51.5, longitude: -0.1 } },
        { from: '447700900111', id: 'wamid.6', timestamp: '1757322005', type: 'sticker' },
      ] } }] }],
    };
    const events = parseWebhook(body);
    expect(events.map((e) => e.kind)).toEqual(['text', 'button', 'list', 'button', 'location']);
    expect(events[0]).toMatchObject({ from: '+447700900111', text: 'hi' });
    expect(events[3]).toMatchObject({ id: 'accept' });
  });

  it('builds Graph API payloads with the plus stripped', () => {
    const p = toGraphPayload('+971500000111', { type: 'template', name: 'nearby_invite_v1', language: 'en', bodyParams: ['Omar', 'X', 'JLT', 'AED 300', '2'], quickReplies: ['accept', 'decline'] });
    expect(p).toMatchObject({ to: '971500000111', type: 'template' });
    const components = (p as any).template.components;
    expect(components[0].parameters).toHaveLength(5);
    expect(components[1]).toMatchObject({ sub_type: 'quick_reply', index: 0, parameters: [{ payload: 'accept' }] });
    expect(toGraphPayload('+1', { type: 'buttons', text: 'x', buttons: [{ id: 'a', title: 'A' }] })).toMatchObject({ interactive: { type: 'button' } });
  });

  it('verifies the webhook handshake and signatures', () => {
    expect(verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 't', 'hub.challenge': '123' }, 't')).toBe('123');
    expect(verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong' }, 't')).toBeUndefined();
    const raw = '{"a":1}';
    const sig = 'sha256=' + createHmac('sha256', 'secret').update(raw).digest('hex');
    expect(verifySignature(raw, sig, 'secret')).toBe(true);
    expect(verifySignature(raw, sig, 'other')).toBe(false);
    expect(verifySignature(raw, undefined, 'secret')).toBe(false);
  });

  it('enforces interactive-message limits', () => {
    expect(() => assertWithinLimits({ type: 'buttons', text: 'x', buttons: [{ id: 'a', title: 'This title is far too long' }] })).toThrow(/too long/);
    expect(() => assertWithinLimits({ type: 'buttons', text: 'x', buttons: [1, 2, 3, 4].map((n) => ({ id: String(n), title: 'ok' })) })).toThrow(/too many/);
    expect(() => assertWithinLimits({ type: 'list', text: 'x', button: 'Pick', sections: [{ title: 's', rows: Array.from({ length: 11 }, (_, i) => ({ id: String(i), title: 'r' })) }] })).toThrow(/rows/);
  });
});

describe('market time rules', () => {
  it('respects quiet hours in each zone', () => {
    // 22:30 in London (BST) is 21:30Z
    expect(withinSendWindow(new Date('2026-09-08T21:30:00Z'), MARKETS.UK)).toBe(false);
    expect(withinSendWindow(new Date('2026-09-08T12:00:00Z'), MARKETS.UK)).toBe(true);
    // 03:00Z is 07:00 Dubai, before the 08:00 window
    expect(withinSendWindow(new Date('2026-09-08T03:00:00Z'), MARKETS.AE)).toBe(false);
    expect(withinSendWindow(new Date('2026-09-08T04:00:00Z'), MARKETS.AE)).toBe(true);
    const next = nextSendTime(new Date('2026-09-08T21:30:00Z'), MARKETS.UK);
    expect(next.toISOString()).toBe('2026-09-09T07:00:00.000Z'); // 08:00 BST
  });

  it('converts venue wall-clock hours to instants and skips taken slots', () => {
    expect(zonedToUtc(2026, 9, 8, 19, 0, 'Europe/London').toISOString()).toBe('2026-09-08T18:00:00.000Z');
    expect(zonedToUtc(2026, 12, 8, 19, 0, 'Europe/London').toISOString()).toBe('2026-12-08T19:00:00.000Z');
    expect(zonedToUtc(2026, 9, 8, 19, 0, 'Asia/Dubai').toISOString()).toBe('2026-09-08T15:00:00.000Z');

    const r = ukRestaurant({ bookingHours: { wed: ['19:00'], thu: ['19:00'] } });
    const from = new Date('2026-09-08T09:00:00Z'); // Tue
    const taken = { id: 'b', matchId: 'm', restaurantId: r.id, creatorId: 'c', at: '2026-09-09T18:00:00Z', guests: 2, status: 'booked' as const, remindersSent: [], postNudgesSent: 0, createdAt: '' };
    const slots = availableSlots(r, [taken], MARKETS.UK, from, { days: 7 });
    expect(slots.map((s) => s.toISOString())).toEqual(['2026-09-10T18:00:00.000Z']);
  });
});
