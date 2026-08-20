/**
 * Crawler classification by PURPOSE.
 *
 * GPTBot influences future training. OAI-SearchBot influences whether ChatGPT search can
 * retrieve you today. ClaudeBot and Claude-User are not the same job either. Counting them
 * together as "AI crawler visits" produces a chart, not a decision.
 */

export type BotClass = 'training' | 'search_index' | 'user_fetch' | 'agent' | 'unknown';

export interface BotSignature {
  name: string;
  operator: string;
  botClass: BotClass;
  match: RegExp;
  /** what fixing access to this bot can and cannot achieve */
  effect: string;
}

export const BOT_SIGNATURES: BotSignature[] = [
  { name: 'GPTBot', operator: 'OpenAI', botClass: 'training', match: /GPTBot/i,
    effect: 'Affects whether your content can inform future model training. No effect on answers today.' },
  { name: 'OAI-SearchBot', operator: 'OpenAI', botClass: 'search_index', match: /OAI-SearchBot/i,
    effect: 'Affects whether ChatGPT search can retrieve and cite your pages. This is usually the one that matters.' },
  { name: 'ChatGPT-User', operator: 'OpenAI', botClass: 'user_fetch', match: /ChatGPT-User/i,
    effect: 'Affects live fetches triggered by a user in-conversation.' },
  { name: 'ClaudeBot', operator: 'Anthropic', botClass: 'training', match: /ClaudeBot/i,
    effect: 'Affects training-time ingestion only.' },
  { name: 'Claude-User', operator: 'Anthropic', botClass: 'user_fetch', match: /Claude-User/i,
    effect: 'Affects fetches Claude performs on behalf of a user in a conversation.' },
  { name: 'Claude-SearchBot', operator: 'Anthropic', botClass: 'search_index', match: /Claude-SearchBot/i,
    effect: 'Affects search-time retrieval for grounded Claude answers.' },
  { name: 'PerplexityBot', operator: 'Perplexity', botClass: 'search_index', match: /PerplexityBot/i,
    effect: 'Affects Perplexity index coverage and citation eligibility.' },
  { name: 'Perplexity-User', operator: 'Perplexity', botClass: 'user_fetch', match: /Perplexity-User/i,
    effect: 'Affects user-triggered live fetches.' },
  { name: 'Google-Extended', operator: 'Google', botClass: 'training', match: /Google-Extended/i,
    effect: 'Controls Gemini training use. Does not affect Google Search or AI Overviews eligibility.' },
  { name: 'Googlebot', operator: 'Google', botClass: 'search_index', match: /Googlebot(?!-)/i,
    effect: 'Standard search indexing — also the substrate for AI Overviews eligibility.' },
  { name: 'Bingbot', operator: 'Microsoft', botClass: 'search_index', match: /bingbot/i,
    effect: 'Search indexing used by several assistants for grounding.' },
  { name: 'Amazonbot', operator: 'Amazon', botClass: 'search_index', match: /Amazonbot/i,
    effect: 'Affects retrieval for Amazon assistant surfaces. Blocking it removes you from that index only.' },
  { name: 'meta-externalagent', operator: 'Meta', botClass: 'agent', match: /meta-externalagent/i,
    effect: 'Affects agentic browsing that fetches pages mid-task. Blocking it can break task completion, not just citation.' },
];

export function classifyBot(userAgent: string): { name: string; operator: string; botClass: BotClass; effect: string } {
  for (const sig of BOT_SIGNATURES) {
    if (sig.match.test(userAgent)) {
      return { name: sig.name, operator: sig.operator, botClass: sig.botClass, effect: sig.effect };
    }
  }
  return {
    name: 'unrecognised',
    operator: 'unknown',
    botClass: 'unknown',
    effect: 'Unmatched user agent. Listed for transparency; never counted as an AI visibility signal.',
  };
}

export const BOT_CLASS_LABEL: Record<BotClass, string> = {
  training: 'Training ingestion',
  search_index: 'Search / retrieval index',
  user_fetch: 'User-triggered fetch',
  agent: 'Agentic browsing',
  unknown: 'Unrecognised',
};

/**
 * Which crawler class actually blocks a given defect. Recommending "unblock GPTBot" when the
 * answer defect comes from grounded search retrieval is a wasted change-control cycle.
 */
export function relevantBotClassFor(grounding: 'grounded_search' | 'training_memory' | 'hybrid'): BotClass {
  switch (grounding) {
    case 'grounded_search':
      return 'search_index';
    case 'training_memory':
      return 'training';
    default:
      return 'search_index';
  }
}

export interface CrawlerEventLike {
  botClass: BotClass;
  botName: string;
  statusCode: number;
  blockedBy: string;
}

export interface CrawlerBlockFinding {
  botName: string;
  botClass: BotClass;
  blockedCount: number;
  totalCount: number;
  blockedBy: string;
}

export function summariseBlocks(events: CrawlerEventLike[]): CrawlerBlockFinding[] {
  const byBot = new Map<string, CrawlerBlockFinding>();
  for (const e of events) {
    const cur =
      byBot.get(e.botName) ?? { botName: e.botName, botClass: e.botClass, blockedCount: 0, totalCount: 0, blockedBy: '' };
    cur.totalCount++;
    if (e.statusCode === 403 || e.statusCode === 401 || e.blockedBy) {
      cur.blockedCount++;
      if (e.blockedBy) cur.blockedBy = e.blockedBy;
    }
    byBot.set(e.botName, cur);
  }
  return [...byBot.values()].sort((a, b) => b.blockedCount - a.blockedCount || a.botName.localeCompare(b.botName));
}
