import { describe, it, expect } from 'vitest';
import { classifyBot, relevantBotClassFor, summariseBlocks, BOT_SIGNATURES } from '../../src/domain/crawlers.js';

describe('bot classification by purpose', () => {
  it('separates OpenAI training from OpenAI retrieval', () => {
    expect(classifyBot('Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)').botClass).toBe('training');
    expect(classifyBot('Mozilla/5.0 (compatible; OAI-SearchBot/1.0)').botClass).toBe('search_index');
  });

  it('separates ClaudeBot from Claude-User', () => {
    expect(classifyBot('Mozilla/5.0 (compatible; ClaudeBot/1.0)').botClass).toBe('training');
    expect(classifyBot('Mozilla/5.0 (compatible; Claude-User/1.0)').botClass).toBe('user_fetch');
  });

  it('knows Google-Extended governs training, not search eligibility', () => {
    const g = classifyBot('Mozilla/5.0 (compatible; Google-Extended)');
    expect(g.botClass).toBe('training');
    expect(g.effect).toMatch(/Does not affect Google Search/i);
  });

  it('lists unmatched agents without counting them as a signal', () => {
    const u = classifyBot('RandomScraper/0.1');
    expect(u.botClass).toBe('unknown');
    expect(u.effect).toMatch(/never counted/i);
  });

  it('gives every signature an explanation of what allowing it changes', () => {
    for (const s of BOT_SIGNATURES) expect(s.effect.length).toBeGreaterThan(20);
  });
});

describe('relevance routing', () => {
  it('routes a grounded-search defect to the retrieval crawler, not the training crawler', () => {
    expect(relevantBotClassFor('grounded_search')).toBe('search_index');
    expect(relevantBotClassFor('training_memory')).toBe('training');
  });
});

describe('block summary', () => {
  it('counts blocks per bot and records what blocked them', () => {
    const findings = summariseBlocks([
      { botName: 'OAI-SearchBot', botClass: 'search_index', statusCode: 403, blockedBy: 'robots.txt' },
      { botName: 'OAI-SearchBot', botClass: 'search_index', statusCode: 200, blockedBy: '' },
      { botName: 'GPTBot', botClass: 'training', statusCode: 200, blockedBy: '' },
    ]);
    expect(findings[0].botName).toBe('OAI-SearchBot');
    expect(findings[0].blockedCount).toBe(1);
    expect(findings[0].totalCount).toBe(2);
    expect(findings[0].blockedBy).toBe('robots.txt');
  });
});
