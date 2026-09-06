import { renderTemplate } from './templates.js';
import type { Delivery, Inbound, Outbound, Transport } from './types.js';
import { assertWithinLimits } from './types.js';

/**
 * In-memory transport for tests and the demo. Records every outbound message and
 * lets a test script "tap" buttons or type replies as the creator would.
 */
export class SimulatedTransport implements Transport {
  readonly sent: Delivery[] = [];
  constructor(private clock: () => Date = () => new Date()) {}

  async send(to: string, message: Outbound): Promise<void> {
    assertWithinLimits(message);
    this.sent.push({ to, message, at: this.clock() });
  }

  last(to?: string): Delivery | undefined {
    const list = to ? this.sent.filter((d) => d.to === to) : this.sent;
    return list[list.length - 1];
  }

  /** Human-readable transcript, the way it would look in the WhatsApp thread. */
  transcript(to?: string): string {
    return this.sent
      .filter((d) => !to || d.to === to)
      .map((d) => `→ ${d.to}: ${render(d.message)}`)
      .join('\n');
  }
}

export function render(m: Outbound): string {
  switch (m.type) {
    case 'text':
      return m.text;
    case 'buttons':
      return `${m.text}\n   [${m.buttons.map((b) => b.title).join('] [')}]`;
    case 'list':
      return `${m.text}\n   (${m.button}) ${m.sections
        .flatMap((s) => s.rows)
        .map((r) => r.title)
        .join(' | ')}`;
    case 'template':
      return `📨 ${renderTemplate(m.name, m.bodyParams)}${
        m.quickReplies?.length ? `\n   [${m.quickReplies.join('] [')}]` : ''
      }`;
  }
}

let seq = 0;
const next = () => `wamid.sim${++seq}`;

/** Helpers to fabricate inbound events the way the Cloud API webhook would deliver them. */
export const inbound = {
  text: (from: string, text: string, at = new Date()): Inbound => ({ kind: 'text', from, text, at, id: next() }),
  button: (from: string, id: string, title = id, at = new Date()): Inbound => ({
    kind: 'button',
    from,
    id,
    title,
    at,
    msgId: next(),
  }),
  list: (from: string, id: string, title = id, at = new Date()): Inbound => ({
    kind: 'list',
    from,
    id,
    title,
    at,
    msgId: next(),
  }),
  location: (from: string, lat: number, lng: number, at = new Date()): Inbound => ({
    kind: 'location',
    from,
    lat,
    lng,
    at,
    id: next(),
  }),
};
