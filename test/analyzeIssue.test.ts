import { describe, expect, it } from 'vitest';
import {
  analyzeIssueContent,
  extractModuleSpecifiers,
  mapToWorkspace,
  type AnalyzableIssue,
} from '../src/lib/issueAnalysis.js';
import { fixture, SAMPLE_REPO } from './helpers.js';

const issue = (name: string) => JSON.parse(fixture(`issues/${name}.json`)) as AnalyzableIssue;

describe('analyzeIssueContent', () => {
  it('extracts a JS stack trace report', () => {
    const a = analyzeIssueContent(issue('stack-trace'), '/app');
    expect(a.type_guess).toBe('bug');
    expect(a.error_messages).toContain("TypeError: Cannot read properties of undefined (reading 'map')");
    expect(a.error_messages.some((e) => e.includes('500 Internal Server Error'))).toBe(true);
    expect(a.stack_frames[0]).toMatchObject({
      file: 'src/components/list.js',
      line: 42,
      function: 'renderItems',
    });
    expect(a.mentioned_paths).toEqual(
      expect.arrayContaining(['src/components/list.js', 'src/pages/checkout.js']),
    );
    expect(a.mentioned_paths.some((p) => p.includes('node:'))).toBe(false);
    expect(a.code_blocks).toHaveLength(1);
    expect(a.suggested_search_queries.slice(0, 2)).toEqual(['renderItems', 'checkoutPage']);
    expect(a.suggested_search_queries).toContain('Cannot read properties of undefined (reading map)');
  });

  it('extracts a code-snippet report', () => {
    const a = analyzeIssueContent(issue('code-snippet'));
    expect(a.type_guess).toBe('bug');
    expect(a.type_signals[0]).toBe('label "bug"');
    expect(a.code_blocks[0]).toMatchObject({ lang: 'ts', source: 'body' });
    expect(a.code_blocks[0]!.code).toContain('applyDiscount(10, 33)');
    expect(a.mentioned_paths).toContain('src/pricing.ts');
    expect(a.suggested_search_queries).toEqual(expect.arrayContaining(['applyDiscount', 'pricing']));
  });

  it('recognizes a vague feature request', () => {
    const a = analyzeIssueContent(issue('feature'));
    expect(a.type_guess).toBe('feature');
    expect(a.error_messages).toEqual([]);
    expect(a.stack_frames).toEqual([]);
  });

  it('respects a question label and parses Python tracebacks', () => {
    const a = analyzeIssueContent(issue('python-question'));
    expect(a.type_guess).toBe('question');
    expect(a.error_messages).toContain('ZeroDivisionError: division by zero');
    expect(a.error_messages).toContain('Traceback (most recent call last):');
    expect(a.stack_frames[0]).toMatchObject({
      file: '/srv/app/services/billing.py',
      line: 88,
      function: 'compute_invoice',
    });
    expect(a.mentioned_paths).toContain('docs/billing.md');
    expect(a.suggested_search_queries[0]).toBe('compute_invoice');
  });

  it('guesses docs from keywords', () => {
    const a = analyzeIssueContent({
      title: 'Typo in README installation section',
      body: 'The docs say npm isntall.',
      labels: [],
      comments: [],
    });
    expect(a.type_guess).toBe('docs');
  });

  it("maps absolute frames from the reporter's machine onto workspace files", () => {
    expect(mapToWorkspace('/home/me/shop/src/pricing.ts', SAMPLE_REPO)).toBe('src/pricing.ts');
    expect(mapToWorkspace('/home/me/shop/src/nope.ts', SAMPLE_REPO)).toBe('/home/me/shop/src/nope.ts');
    const a = analyzeIssueContent(
      {
        title: 'Crash',
        body: '```\nRangeError: Invalid discount percent: 120\n    at assertValidPercent (/Users/me/code/shop/src/pricing.ts:3:11)\n    at checkout (/Users/me/code/app/cart.js:9:3)\n```',
        labels: [],
        comments: [],
      },
      SAMPLE_REPO,
    );
    expect(a.stack_frames[0]).toMatchObject({ file: 'src/pricing.ts', function: 'assertValidPercent' });
    expect(a.suggested_search_queries.slice(0, 2)).toEqual(['assertValidPercent', 'checkout']);
    expect(a.mentioned_paths).toContain('src/pricing.ts');
  });

  it('extracts imported module names (JS and Python)', () => {
    const blocks = [
      {
        source: 'body',
        lang: 'ts',
        code: "import { a } from './src/pricing';\nconst x = require('../lib/util');\nimport 'zod';",
      },
      { source: 'body', lang: 'py', code: 'from app.services.billing import compute\nimport os.path' },
    ];
    expect(extractModuleSpecifiers(blocks)).toEqual([
      'src/pricing',
      'lib/util',
      'app.services.billing',
      'os.path',
    ]);
  });

  it('reads capability-style titles as features and falls back to title keywords', () => {
    const a = analyzeIssueContent({
      title: 'Support other currencies?',
      body: 'Would be nice to have EUR.',
      labels: [],
      comments: [],
    });
    expect(a.type_guess).toBe('feature');
    expect(a.suggested_search_queries).toEqual(['currency']);
  });

  it('ignores language builtins in inline code', () => {
    const a = analyzeIssueContent({
      title: 'x',
      body: 'I think `Math.floor` in `roundToCents` is wrong',
      labels: [],
      comments: [],
    });
    expect(a.suggested_search_queries).toEqual(['roundToCents']);
  });
});
