import { describe, expect, it } from 'vitest';
import { groupFailures, normalizeMessage, summarizeFailure } from '../src/lib/failures.js';
import { extractJsonReport, parseJestLikeReport } from '../src/lib/parsers/vitestJest.js';
import { fixture, SAMPLE_REPO } from './helpers.js';

describe('failure summaries', () => {
  // The recorded report uses /repo as its root; map it to the real fixture so naming lookups work.
  const json = fixture('reports/vitest.json')
    .replaceAll('/repo/node_modules', '/nm')
    .replaceAll('/repo', SAMPLE_REPO);
  const report = parseJestLikeReport(extractJsonReport(json)!, 'vitest', SAMPLE_REPO);
  const summaries = report.failures.map((f) => summarizeFailure(f, SAMPLE_REPO));

  it('uses stack frames for likely source files', () => {
    const fmt = summaries.find((s) => s.file === 'src/format.test.ts')!;
    expect(fmt.likely_source_files).toEqual(['src/format.ts']);
    expect(fmt.source_hint).toBe('stack');
    expect(fmt.top_frames.map((f) => f.file)).toEqual(['src/format.ts', 'src/format.test.ts']);
    expect(fmt.top_frames.every((f) => !f.file.includes('node_modules'))).toBe(true);
    expect(fmt.line).toBe(9);
  });

  it('falls back to naming when the stack only has the test file', () => {
    const p = summaries.find((s) => s.test_name.includes('33% off 10'))!;
    expect(p.likely_source_files).toEqual(['src/pricing.ts']);
    expect(p.source_hint).toBe('naming');
  });

  it('groups by normalized message, largest group first', () => {
    const groups = groupFailures(summaries);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      count: 2,
      signature: 'AssertionError: expected <n> to be <n> // Object.is equality',
      likely_source_files: ['src/pricing.ts'],
    });
    expect(groups[1]!.count).toBe(1);
  });

  it('normalizes volatile parts of messages', () => {
    expect(normalizeMessage("Cannot find module '/a/b/c.js' at 0xdeadbeef line 42")).toBe(
      'Cannot find module <str> at <hex> line <n>',
    );
  });
});
