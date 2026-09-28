import { describe, expect, it } from 'vitest';
import { parseJUnitXml } from '../src/lib/parsers/pytest.js';
import { parseRawOutput } from '../src/lib/parsers/raw.js';
import { extractJsonReport, parseJestLikeReport } from '../src/lib/parsers/vitestJest.js';
import { fixture } from './helpers.js';

describe('vitest JSON parser', () => {
  const report = parseJestLikeReport(extractJsonReport(fixture('reports/vitest.json'))!, 'vitest', '/repo');

  it('reads totals', () => {
    expect(report).toMatchObject({ runner: 'vitest', passed: 2, failed: 3, skipped: 1, structured: true });
  });

  it('extracts failures with relative files and messages', () => {
    expect(report.failures).toHaveLength(3);
    const f = report.failures.find((x) => x.test_name.includes('33% off 10'))!;
    expect(f.file).toBe('src/pricing.test.ts');
    expect(f.test_name).toBe('applyDiscount rounds 33% off 10 to cents');
    expect(f.message).toBe('AssertionError: expected 6.69 to be 6.7 // Object.is equality');
    expect(f.stack).toContain('pricing.test.ts:10:35');
  });

  it('finds the JSON report inside noisy stdout', () => {
    const noisy = `some log line\n${fixture('reports/vitest.json')}\n`;
    expect(extractJsonReport(noisy)?.numFailedTests).toBe(3);
  });
});

describe('jest JSON parser', () => {
  const report = parseJestLikeReport(extractJsonReport(fixture('reports/jest.json'))!, 'jest', '/repo');

  it('reads totals and includes suite-level failures', () => {
    expect(report.passed).toBe(4);
    expect(report.skipped).toBe(1);
    expect(report.failures.map((f) => f.test_name)).toEqual([
      'cart applies coupon',
      'coupon parses code',
      'src/broken.test.js (suite failed to run)',
    ]);
    expect(report.failed).toBe(3);
  });

  it('keeps location lines and multi-line messages', () => {
    const f = report.failures[0]!;
    expect(f.line).toBe(12);
    expect(f.message).toContain('Expected: 45');
    expect(f.message).toContain('Received: 50');
    expect(report.failures[2]!.message).toContain('SyntaxError');
  });
});

describe('pytest JUnit XML parser', () => {
  const report = parseJUnitXml(fixture('reports/pytest-junit.xml'));

  it('reads counts', () => {
    expect(report).toMatchObject({ runner: 'pytest', passed: 2, failed: 2, skipped: 1 });
  });

  it('extracts failures with decoded messages and 1-based lines', () => {
    const [a, b] = report.failures;
    expect(a).toMatchObject({
      test_name: 'tests.test_dates::test_days_in_month_feb_leap',
      file: 'tests/test_dates.py',
      line: 10,
    });
    expect(a!.message).toContain('assert 31 == 29');
    expect(b!.message).toBe('ZeroDivisionError: division by zero');
    expect(b!.stack).toContain('app/pricing.py:4: ZeroDivisionError');
    expect(b!.stack).toContain('>       return total / qty');
  });
});

describe('raw output fallback', () => {
  it('parses jest text output', () => {
    const r = parseRawOutput(fixture('reports/raw-jest.txt'));
    expect(r).toMatchObject({ runner: 'raw', passed: 1, failed: 1, structured: false });
    expect(r.failures[0]!.test_name).toBe('cart › applies coupon');
    expect(r.failures[0]!.message).toContain('expect(received).toBe(expected)');
  });

  it('parses pytest text output', () => {
    const r = parseRawOutput(fixture('reports/raw-pytest.txt'));
    expect(r).toMatchObject({ passed: 2, failed: 1, skipped: 1 });
    expect(r.failures[0]).toMatchObject({
      file: 'tests/test_dates.py',
      test_name: 'test_days_in_month_feb_leap',
      message: 'assert 31 == 29',
    });
  });

  it('parses vitest text output', () => {
    const r = parseRawOutput(fixture('reports/raw-vitest.txt'));
    expect(r).toMatchObject({ passed: 2, failed: 1 });
    expect(r.failures[0]).toMatchObject({
      file: 'src/pricing.test.ts',
      test_name: 'applyDiscount > rounds 33% off 10 to cents',
    });
  });
});
