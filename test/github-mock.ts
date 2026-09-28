import nock from 'nock';

export const ISSUE_7 = {
  number: 7,
  title: 'applyDiscount returns 6.69 instead of 6.70',
  state: 'open',
  state_reason: null,
  labels: [{ name: 'bug' }],
  user: { login: 'reporter' },
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-02T10:00:00Z',
  comments: 2,
  html_url: 'https://github.com/acme/shop/issues/7',
  body:
    'Using the pricing module:\n\n```ts\nimport { applyDiscount } from "./src/pricing";\n' +
    'console.log(applyDiscount(10, 33)); // 6.69\n```\n\nExpected 6.7. Also:\n\n' +
    '```\nAssertionError: expected 6.69 to be 6.7\n    at applyDiscount (/home/me/shop/src/pricing.ts:11:10)\n```',
};

/** Mock the three GitHub endpoints get_issue uses. Returns the scope for assertions. */
export function mockGitHub(): nock.Scope {
  return nock('https://api.github.com')
    .persist()
    .get('/repos/acme/shop/issues/7')
    .reply(200, ISSUE_7)
    .get('/repos/acme/shop/issues/7/comments')
    .query(true)
    .reply(200, [
      {
        user: { login: 'dev1' },
        body: 'Probably `Math.floor` in pricing.ts',
        created_at: '2026-09-01T11:00:00Z',
      },
      { user: { login: 'dev2' }, body: 'Confirmed on main.', created_at: '2026-09-01T12:00:00Z' },
    ])
    .get('/repos/acme/shop/issues/7/timeline')
    .query(true)
    .reply(200, [
      { event: 'labeled' },
      {
        event: 'cross-referenced',
        source: {
          issue: {
            number: 8,
            title: 'Round discounts to cents',
            state: 'open',
            html_url: 'https://github.com/acme/shop/pull/8',
            pull_request: { merged_at: null },
            repository: { full_name: 'acme/shop' },
          },
        },
      },
    ])
    .get('/repos/acme/shop/issues/99')
    .reply(404, { message: 'Not Found' })
    .get('/repos/acme/shop/issues/5')
    .reply(
      403,
      { message: 'API rate limit exceeded' },
      { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) },
    );
}
