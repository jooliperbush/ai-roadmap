import type { Outbound } from './types.js';

/**
 * Message templates that must be submitted to Meta for approval before use.
 * Anything sent to a creator more than 24h after their last message has to be one
 * of these. Body text below is what you paste into WhatsApp Manager; {{n}} are
 * the positional parameters we fill at send time.
 *
 * Category matters for price: 'utility' (transactional) is roughly half the
 * cost of 'marketing' in both the UK and UAE. Invites, reminders and post
 * requests all relate to an arrangement the creator opted into, so they are
 * submitted as utility.
 */
export const TEMPLATES = {
  invite: {
    name: 'nearby_invite_v1',
    category: 'utility',
    body:
      'Hi {{1}} 👋 {{2}} in {{3}} would love to host you for a {{4}} meal for {{5}} in exchange for a post. Fancy it? Reply within 24h to hold the spot.',
    quickReplies: ['accept', 'decline'],
  },
  reminder: {
    name: 'nearby_visit_reminder_v1',
    category: 'utility',
    body: 'Reminder: you are booked at {{1}} on {{2}}. Table for {{3}} under "{{4}}". Need to change it? Reply here.',
    quickReplies: ['confirm', 'reschedule'],
  },
  postRequest: {
    name: 'nearby_post_request_v1',
    category: 'utility',
    body: 'Hope you enjoyed {{1}}! When your post is live, send the link here so we can share it with the venue. {{2}}',
    quickReplies: [],
  },
  venueBooking: {
    name: 'nearby_venue_booking_v1',
    category: 'utility',
    body: 'Nearby booking: {{1}} ({{2}}) is coming on {{3}}, table for {{4}}. They will film and post. Reply here if anything changes.',
    quickReplies: [],
  },
  reengage: {
    name: 'nearby_reengage_v1',
    category: 'utility',
    body: 'Hi {{1}}, quick one from Nearby: we have new venues near {{2}} this month. Want invites? Reply to update your preferences.',
    quickReplies: ['yes', 'pause'],
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export function template(key: TemplateKey, params: string[], language = 'en'): Outbound {
  const t = TEMPLATES[key];
  return {
    type: 'template',
    name: t.name,
    language,
    bodyParams: params,
    quickReplies: [...t.quickReplies],
  };
}

/** Render a template's body with parameters, for logs and the simulated transport. */
export function renderTemplate(name: string, params: string[]): string {
  const t = Object.values(TEMPLATES).find((x) => x.name === name);
  if (!t) return `[template ${name}] ${params.join(' | ')}`;
  return t.body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
}
