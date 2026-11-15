'use strict';

jest.mock('../../lib/resource-acquisition/verify/fetch-page', () => ({
  fetchPageText: jest.fn(),
  extractTitle: jest.requireActual('../../lib/resource-acquisition/verify/fetch-page').extractTitle,
  extractMetaDescription: jest.requireActual('../../lib/resource-acquisition/verify/fetch-page').extractMetaDescription,
}));

const { fetchPageText } = require('../../lib/resource-acquisition/verify/fetch-page');
const { verifyOpportunityRecord } = require('../../lib/resource-acquisition/verify/adapters');

describe('resource verification adapters', () => {
  test('HTTP 200 does not set benefits_confirmed', async () => {
    fetchPageText.mockResolvedValue({
      ok: true,
      status: 200,
      body: '<html><title>OpenAI for Startups</title><body>Startups program benefits</body></html>',
    });
    const v = await verifyOpportunityRecord({
      provider: 'OpenAI',
      program_name: 'OpenAI for Startups hub',
      official_source_url: 'https://openai.com/business/why-openai/startups/',
    });
    expect(v.flags.source_reachable).toBe(true);
    expect(v.flags.benefits_confirmed).toBe(false);
    expect(v.flags.weak_page_signal).toBe(true);
    expect(v.classification).toBe('WEAK_PAGE_SIGNAL');
  });

  test('403 reachability does not confirm program', async () => {
    fetchPageText.mockResolvedValue({ ok: true, status: 403, body: '' });
    const v = await verifyOpportunityRecord({
      provider: 'OpenAI',
      program_name: 'x',
      official_source_url: 'https://openai.com/leads/startup/',
    });
    expect(v.flags.source_reachable).toBe(false);
    expect(v.flags.program_confirmed).toBe(false);
  });
});