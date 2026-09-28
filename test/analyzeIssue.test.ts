import { describe, expect, it } from 'vitest';
import { analyzeIssueContent, type AnalyzableIssue } from '../src/lib/issueAnalysis.js';
import { fixture } from './helpers.js';

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
});
