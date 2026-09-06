/**
 * Transport-neutral message shapes. The Cloud API adapter maps these to Graph API
 * payloads; the simulated transport just records them.
 */

export type Inbound =
  | { kind: 'text'; from: string; text: string; at: Date; id: string }
  | { kind: 'button'; from: string; id: string; title: string; at: Date; msgId: string }
  | { kind: 'list'; from: string; id: string; title: string; at: Date; msgId: string }
  | { kind: 'location'; from: string; lat: number; lng: number; at: Date; id: string }
  | { kind: 'media'; from: string; mediaId: string; caption?: string; at: Date; id: string };

export interface Button {
  id: string;
  title: string; // WhatsApp limit: 20 chars
}

export interface ListRow {
  id: string; // limit 200 chars
  title: string; // limit 24 chars
  description?: string; // limit 72 chars
}

export type Outbound =
  | { type: 'text'; text: string }
  | { type: 'buttons'; text: string; buttons: Button[] } // max 3
  | {
      type: 'list';
      text: string;
      button: string; // limit 20 chars
      sections: { title: string; rows: ListRow[] }[]; // max 10 rows total
    }
  | {
      /** Pre-approved Meta template; the only thing we may send outside the 24h window */
      type: 'template';
      name: string;
      language: string;
      bodyParams: string[];
      /** Quick-reply payloads, in button order, if the template has them */
      quickReplies?: string[];
    };

export interface Delivery {
  to: string;
  message: Outbound;
  at: Date;
}

export interface Transport {
  send(to: string, message: Outbound): Promise<void>;
}

export const LIMITS = {
  buttonTitle: 20,
  buttons: 3,
  listRows: 10,
  listRowTitle: 24,
  listRowDescription: 72,
  listButton: 20,
} as const;

/** Throws if a message breaks a WhatsApp interactive-message limit. */
export function assertWithinLimits(m: Outbound): void {
  if (m.type === 'buttons') {
    if (m.buttons.length > LIMITS.buttons) throw new Error('too many buttons');
    for (const b of m.buttons) {
      if (b.title.length > LIMITS.buttonTitle) throw new Error(`button title too long: ${b.title}`);
    }
  }
  if (m.type === 'list') {
    const rows = m.sections.flatMap((s) => s.rows);
    if (rows.length > LIMITS.listRows) throw new Error('too many list rows');
    if (m.button.length > LIMITS.listButton) throw new Error('list button too long');
    for (const r of rows) {
      if (r.title.length > LIMITS.listRowTitle) throw new Error(`row title too long: ${r.title}`);
      if ((r.description ?? '').length > LIMITS.listRowDescription) {
        throw new Error(`row description too long: ${r.description}`);
      }
    }
  }
}
