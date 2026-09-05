import { describe, expect, it } from 'vitest';
import { landingView } from '../../src/web/views/landing.js';
import { HOME_FAQ } from '../../src/http/public-copy.js';
import { renderLlmsTxt, softwareLd } from '../../src/web/seo.js';

describe('launch site represents the available product', () => {
  it.each([1, 2, 3])('does not promise all four assistants with %i configured', (liveProviders) => {
    const content = landingView({ liveProviders }).value;
    expect(content).not.toContain('across all four assistants');
    expect(content).toContain('configured API surfaces');
  });
  it('discloses the simulated example and automatic audit behavior', () => {
    const content = landingView().value;
    expect(content).toContain('Worked example');
    expect(content).toContain('automatically');
    expect(content).not.toContain('a live assistant, with web search on');
    expect(content).not.toContain('email nobody until you approve');
  });
  it('publishes a consistent early-access offer without unvalidated paid subscriptions', () => {
    for (const content of [landingView().value, renderLlmsTxt([]), softwareLd().value]) {
      expect(content).not.toMatch(/\$750|\$2,000|\$5,000|"price":"750"|"price":"2000"/);
    }
    expect(landingView().value).toContain('Early access');
  });
  it('makes every structured FAQ available to visitors', () => {
    const content = landingView().value;
    for (const faq of HOME_FAQ) expect(content).toContain(faq.q);
    expect(content).toContain('https://github.com/jooliperbush/ai-roadmap');
  });
});
