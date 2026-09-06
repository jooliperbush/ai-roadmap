import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Inbound, Outbound, Transport } from './types.js';
import { assertWithinLimits } from './types.js';

/**
 * Meta WhatsApp Business Platform (Cloud API) adapter.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Going direct to Meta rather than via a BSP (Twilio, 360dialog, Infobip...) saves
 * the per-message markup; a BSP is still worth it if you want their inbox UI or
 * number-hosting in the UAE.
 */
export interface CloudApiConfig {
  token: string;
  phoneNumberId: string;
  appSecret?: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
}

export class CloudApiTransport implements Transport {
  private base: string;
  private fetchImpl: typeof fetch;

  constructor(private cfg: CloudApiConfig) {
    this.base = `https://graph.facebook.com/${cfg.graphVersion ?? 'v22.0'}/${cfg.phoneNumberId}/messages`;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async send(to: string, message: Outbound): Promise<void> {
    assertWithinLimits(message);
    const body = toGraphPayload(to, message);
    const res = await this.fetchImpl(this.base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`WhatsApp send failed ${res.status}: ${await res.text()}`);
    }
  }
}

/** E.164 without the plus, which is what the Graph API wants in `to`. */
const bare = (phone: string) => phone.replace(/^\+/, '');

export function toGraphPayload(to: string, m: Outbound): Record<string, unknown> {
  const common = { messaging_product: 'whatsapp', recipient_type: 'individual', to: bare(to) };
  switch (m.type) {
    case 'text':
      return { ...common, type: 'text', text: { preview_url: false, body: m.text } };
    case 'buttons':
      return {
        ...common,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: m.text },
          action: {
            buttons: m.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
          },
        },
      };
    case 'list':
      return {
        ...common,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: m.text },
          action: {
            button: m.button,
            sections: m.sections.map((s) => ({
              title: s.title,
              rows: s.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
            })),
          },
        },
      };
    case 'template': {
      const components: unknown[] = [
        { type: 'body', parameters: m.bodyParams.map((text) => ({ type: 'text', text })) },
      ];
      (m.quickReplies ?? []).forEach((payload, index) => {
        components.push({ type: 'button', sub_type: 'quick_reply', index, parameters: [{ type: 'payload', payload }] });
      });
      return {
        ...common,
        type: 'template',
        template: { name: m.name, language: { code: m.language }, components },
      };
    }
  }
}

/** Webhook GET handshake. */
export function verifyWebhook(query: Record<string, unknown>, verifyToken: string): string | undefined {
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
    return String(query['hub.challenge'] ?? '');
  }
  return undefined;
}

/** X-Hub-Signature-256 check over the raw body. */
export function verifySignature(rawBody: string | Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const given = header.slice('sha256='.length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

/** Flatten a Cloud API webhook body into transport-neutral inbound events. */
export function parseWebhook(body: unknown): Inbound[] {
  const out: Inbound[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: unknown[] }[]) {
    for (const change of entry.changes ?? []) {
      const value = (change as { value?: { messages?: unknown[] } }).value;
      for (const raw of value?.messages ?? []) {
        const msg = raw as Record<string, any>;
        const from = `+${msg.from}`;
        const at = new Date(Number(msg.timestamp) * 1000);
        const id = String(msg.id);
        switch (msg.type) {
          case 'text':
            out.push({ kind: 'text', from, text: String(msg.text?.body ?? ''), at, id });
            break;
          case 'interactive': {
            const i = msg.interactive;
            if (i?.type === 'button_reply') {
              out.push({ kind: 'button', from, id: i.button_reply.id, title: i.button_reply.title, at, msgId: id });
            } else if (i?.type === 'list_reply') {
              out.push({ kind: 'list', from, id: i.list_reply.id, title: i.list_reply.title, at, msgId: id });
            }
            break;
          }
          case 'button': // quick-reply on a template message
            out.push({ kind: 'button', from, id: String(msg.button?.payload ?? ''), title: String(msg.button?.text ?? ''), at, msgId: id });
            break;
          case 'location':
            out.push({ kind: 'location', from, lat: Number(msg.location.latitude), lng: Number(msg.location.longitude), at, id });
            break;
          case 'image':
          case 'video':
            out.push({ kind: 'media', from, mediaId: String(msg[msg.type]?.id ?? ''), caption: msg[msg.type]?.caption, at, id });
            break;
          default:
            break;
        }
      }
    }
  }
  return out;
}
