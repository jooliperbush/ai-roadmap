import { describe, expect, it } from 'vitest';
import { parseHandle } from '../src/services/engine.js';
import { inbound } from '../src/whatsapp/simulated.js';
import { H, rig, START_AE } from './fixtures.js';

const UK = '+447700900111';
const AE = '+971500000111';

describe('creator onboarding over WhatsApp', () => {
  it('walks a UK creator from first message to active', async () => {
    const { engine, transport, clock } = rig();
    const say = async (m: Parameters<typeof engine.handleInbound>[0]) => {
      await engine.handleInbound({ ...m, at: clock.now() });
      return transport.last(UK)!.message;
    };

    let m = await say(inbound.text(UK, 'hi'));
    expect(m.type).toBe('buttons');
    m = await say(inbound.button(UK, 'consent:yes'));
    expect(m).toMatchObject({ type: 'text', text: expect.stringMatching(/call you/) });
    await say(inbound.text(UK, 'Priya'));
    m = await say(inbound.text(UK, 'instagram.com/priya.eats'));
    expect(m).toMatchObject({ text: expect.stringMatching(/instagram @priya.eats/) });
    m = await say(inbound.text(UK, 'E2'));
    expect(m).toMatchObject({ text: expect.stringMatching(/Perfect/) });
    m = await say(inbound.text(UK, 'Taiwanese, Japanese and brunch'));
    expect(m.type).toBe('buttons');
    m = await say(inbound.button(UK, 'diet:none'));
    expect(m).toMatchObject({ text: expect.stringMatching(/You are in, Priya/) });

    const c = engine.store.creatorByPhone(UK)!;
    expect(c.status).toBe('active');
    expect(c.cuisines).toEqual(['Taiwanese', 'Japanese', 'brunch']);
    expect(c.home).toBeDefined();
    expect(c.adPermit).toBeUndefined();
    expect(engine.store.conversationByPhone(UK)!.step).toBe('idle');
  });

  it('asks a Dubai creator for the advertiser permit and holds invites until verified', async () => {
    const { engine, transport, clock } = rig(START_AE);
    const say = async (m: Parameters<typeof engine.handleInbound>[0]) => {
      await engine.handleInbound({ ...m, at: clock.now() });
      return transport.last(AE)!.message;
    };
    await say(inbound.text(AE, 'salam'));
    await say(inbound.button(AE, 'consent:yes'));
    await say(inbound.text(AE, 'Omar'));
    await say(inbound.text(AE, '@omar.eats tiktok'));
    await say(inbound.location(AE, 25.07, 55.145));
    await say(inbound.text(AE, 'Indian, Persian'));
    let m = await say(inbound.button(AE, 'diet:no_alcohol'));
    expect(m).toMatchObject({ type: 'buttons', text: expect.stringMatching(/advertiser permit/) });
    m = await say(inbound.button(AE, 'permit:have'));
    expect(m).toMatchObject({ text: expect.stringMatching(/permit number/) });
    m = await say(inbound.text(AE, 'ADV-12345'));
    expect(m).toMatchObject({ text: expect.stringMatching(/verified/) });

    const c = engine.store.creatorByPhone(AE)!;
    expect(c.status).toBe('active');
    expect(c.handles.tiktok).toBe('omar.eats');
    expect(c.dietary).toEqual(['no_alcohol']);
    expect(c.adPermit).toEqual({ number: 'ADV-12345', verified: false });
    await engine.verifyPermit(c.id);
    expect(c.adPermit?.verified).toBe(true);
  });

  it('refuses numbers outside the two markets', async () => {
    const { engine, transport } = rig();
    await engine.handleInbound(inbound.text('+12125550100', 'hi'));
    expect(transport.last()!.message).toMatchObject({ text: expect.stringMatching(/only live in the UK and the UAE/) });
    expect(engine.store.conversations.all()).toHaveLength(0);
  });

  it('pauses and resumes with plain words', async () => {
    const { engine, transport, clock } = rig();
    for (const step of ['hi', 'consent:yes', 'Sam', '@sam', 'E2', 'pizza', 'diet:none']) {
      await engine.handleInbound(step.includes(':') ? inbound.button(UK, step, step, clock.now()) : inbound.text(UK, step, clock.now()));
    }
    await engine.handleInbound(inbound.text(UK, 'please stop for a bit', clock.now()));
    expect(engine.store.creatorByPhone(UK)!.status).toBe('paused');
    clock.advance(H);
    await engine.handleInbound(inbound.text(UK, 'resume', clock.now()));
    expect(engine.store.creatorByPhone(UK)!.status).toBe('active');
    expect(transport.last(UK)!.message).toMatchObject({ text: expect.stringMatching(/Welcome back/) });
  });
});

describe('parseHandle', () => {
  it('reads handles and profile links', () => {
    expect(parseHandle('@foo.bar')).toEqual({ platform: 'instagram', handle: 'foo.bar' });
    expect(parseHandle('foo_bar on tiktok')).toEqual({ platform: 'tiktok', handle: 'foo_bar' });
    expect(parseHandle('https://www.tiktok.com/@foo')).toEqual({ platform: 'tiktok', handle: 'foo' });
    expect(parseHandle('https://instagram.com/foo/')).toEqual({ platform: 'instagram', handle: 'foo' });
    expect(parseHandle('no idea')).toBeUndefined();
  });
});
