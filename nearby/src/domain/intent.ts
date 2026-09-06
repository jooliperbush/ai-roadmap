import { z } from 'zod';

/**
 * Free-text understanding for the handful of places a creator can type instead of
 * tapping a button. The state machine in conversation.ts decides what to do with
 * an intent; this file only names it.
 *
 * Two parsers: a regex-based one that always works, and a Claude-backed one for
 * the messy cases ("cant make tuesday, thurs ok?"). Keeping the model confined to
 * a fixed intent set is also what keeps the bot inside Meta's WhatsApp policy:
 * task-specific business bots are allowed, open-ended assistants are not.
 */
export const IntentSchema = z.object({
  intent: z.enum([
    'accept',
    'decline',
    'confirm',
    'reschedule',
    'cancel',
    'pause',
    'resume',
    'help',
    'post_link',
    'yes',
    'no',
    'unknown',
  ]),
  /** Any URL found in the message */
  url: z.string().nullable(),
  /** Short note when the creator gives a reason or a constraint */
  note: z.string().nullable(),
});
export type Intent = z.infer<typeof IntentSchema>;

export interface IntentParser {
  parse(text: string, context: string): Promise<Intent>;
}

const URL_RE = /https?:\/\/[^\s]+/i;

export class RuleIntentParser implements IntentParser {
  async parse(text: string): Promise<Intent> {
    const t = text.trim().toLowerCase();
    const url = text.match(URL_RE)?.[0] ?? null;
    if (url) return { intent: 'post_link', url, note: null };
    const has = (...words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(t));
    if (has('stop', 'pause', 'unsubscribe', 'break')) return { intent: 'pause', url, note: null };
    if (has('resume', 'unpause', 'start again', 'back')) return { intent: 'resume', url, note: null };
    if (has('help', 'human', 'support')) return { intent: 'help', url, note: null };
    if (has('reschedule', 'move', 'change', 'another day', 'different')) {
      return { intent: 'reschedule', url, note: text.trim() };
    }
    if (has('cancel', "can't make it", 'cant make it', 'not coming')) {
      return { intent: 'cancel', url, note: text.trim() };
    }
    if (has('accept', 'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'in', 'keen', 'love to')) {
      return { intent: 'yes', url, note: null };
    }
    if (has('decline', 'no', 'nope', 'pass', 'not this time', 'busy')) {
      return { intent: 'no', url, note: text.trim() };
    }
    if (has('confirm', 'confirmed', 'see you')) return { intent: 'confirm', url, note: null };
    return { intent: 'unknown', url, note: text.trim() };
  }
}

/**
 * Claude-backed parser. Only invoked for text that the rules could not place, so
 * the volume is small. Uses structured outputs so the reply is always a valid Intent.
 */
export class ClaudeIntentParser implements IntentParser {
  private fallback = new RuleIntentParser();
  private clientPromise: Promise<typeof import('@anthropic-ai/sdk')> | undefined;

  constructor(private model = 'claude-opus-5') {}

  async parse(text: string, context: string): Promise<Intent> {
    const quick = await this.fallback.parse(text);
    if (quick.intent !== 'unknown') return quick;
    try {
      this.clientPromise ??= import('@anthropic-ai/sdk');
      const { default: Anthropic } = await this.clientPromise;
      const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
      const client = new Anthropic();
      const response = await client.messages.parse({
        model: this.model,
        max_tokens: 256,
        system:
          'You classify one WhatsApp message from a food creator talking to a restaurant-booking assistant. ' +
          'Pick the single best intent from the schema. If the message contains a link to a post, intent is post_link. ' +
          'Do not answer the creator; only classify.',
        messages: [
          {
            role: 'user',
            content: `Conversation state: ${context}\nCreator message: ${JSON.stringify(text)}`,
          },
        ],
        output_config: { format: zodOutputFormat(IntentSchema), effort: 'low' },
      });
      return response.parsed_output ?? quick;
    } catch {
      return quick;
    }
  }
}

export function defaultIntentParser(): IntentParser {
  return process.env.ANTHROPIC_API_KEY ? new ClaudeIntentParser() : new RuleIntentParser();
}
