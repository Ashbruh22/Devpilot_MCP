import { stripAnsi } from '../truncate.js';
import { splitMessage } from './common.js';
import { normalizeFramePath } from './stackTrace.js';
import type { ParsedFailure, ParsedTestReport, Runner } from './types.js';

interface AssertionResult {
  fullName?: string;
  title?: string;
  ancestorTitles?: string[];
  status?: string;
  failureMessages?: string[];
  location?: { line?: number; column?: number } | null;
}

interface FileResult {
  name?: string;
  status?: string;
  message?: string;
  assertionResults?: AssertionResult[];
}

interface JestLikeReport {
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  testResults?: FileResult[];
}

/** Find the JSON report inside stdout that may also contain log noise. */
export function extractJsonReport(text: string): JestLikeReport | null {
  const trimmed = text.trim();
  const tryParse = (s: string): JestLikeReport | null => {
    try {
      const v = JSON.parse(s) as unknown;
      return v && typeof v === 'object' && 'testResults' in v ? (v as JestLikeReport) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  // Look for the report object start and parse from there to the last closing brace.
  for (const marker of ['{"numTotalTestSuites"', '{"numFailedTestSuites"', '{\n  "numTotalTestSuites"']) {
    const start = text.indexOf(marker);
    if (start >= 0) {
      const end = text.lastIndexOf('}');
      const parsed = end > start ? tryParse(text.slice(start, end + 1)) : null;
      if (parsed) return parsed;
    }
  }
  return null;
}

/** Parse vitest `--reporter=json` or jest `--json` output (they share Jest's schema). */
export function parseJestLikeReport(report: JestLikeReport, runner: Runner, root?: string): ParsedTestReport {
  const failures: ParsedFailure[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const file of report.testResults ?? []) {
    const filePath = normalizeFramePath(file.name ?? '', root);
    const assertions = file.assertionResults ?? [];
    for (const a of assertions) {
      const status = a.status ?? '';
      if (status === 'passed') passed++;
      else if (status === 'failed') {
        failed++;
        const text = stripAnsi((a.failureMessages ?? []).join('\n\n'));
        const name =
          a.fullName ?? [...(a.ancestorTitles ?? []), a.title ?? ''].filter(Boolean).join(' > ') ?? 'unknown';
        failures.push({
          test_name: name,
          file: filePath,
          line: a.location?.line ?? undefined,
          message: splitMessage(text) || 'Test failed (no message)',
          stack: text,
        });
      } else if (['pending', 'skipped', 'todo', 'disabled'].includes(status)) skipped++;
    }
    // Suite-level failure (e.g. syntax error, failed import) with no assertion results.
    if (file.status === 'failed' && !assertions.some((a) => a.status === 'failed') && file.message) {
      failed++;
      const text = stripAnsi(file.message);
      failures.push({
        test_name: `${filePath} (suite failed to run)`,
        file: filePath,
        message: splitMessage(text) || 'Suite failed to run',
        stack: text,
      });
    }
  }

  // Prefer the reporter's totals when present (they include tests we might not have walked).
  const hasTotals = typeof report.numPassedTests === 'number' && typeof report.numFailedTests === 'number';
  return {
    runner,
    passed: hasTotals ? report.numPassedTests! : passed,
    failed: hasTotals ? Math.max(report.numFailedTests!, failed) : failed,
    skipped: hasTotals ? (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0) : skipped,
    failures,
    structured: true,
  };
}
