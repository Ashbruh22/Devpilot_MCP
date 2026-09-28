import { stripAnsi } from '../truncate.js';
import type { ParsedFailure, ParsedTestReport } from './types.js';

function num(re: RegExp, text: string): number | undefined {
  const m = re.exec(text);
  return m ? Number(m[1]) : undefined;
}

/**
 * Best-effort parse of human-readable test output (the `npm test` fallback).
 * Understands the summary lines of vitest, jest, mocha, node:test, and pytest.
 */
export function parseRawOutput(output: string): ParsedTestReport {
  const text = stripAnsi(output);
  const failed =
    num(/Tests?:?\s+(\d+) failed/i, text) ??
    num(/(\d+) failing/i, text) ??
    num(/[=\s](\d+) failed/i, text) ??
    num(/# fail (\d+)/i, text) ??
    0;
  const passed =
    num(/Tests?:?\s+(?:\d+ failed\s*[|,]\s*)?(\d+) passed/i, text) ??
    num(/(\d+) passing/i, text) ??
    num(/[=\s](\d+) passed/i, text) ??
    num(/# pass (\d+)/i, text) ??
    0;
  const skipped =
    num(/(\d+) skipped/i, text) ?? num(/(\d+) pending/i, text) ?? num(/# skip (\d+)/i, text) ?? 0;

  const failures: ParsedFailure[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && failures.length < 50; i++) {
    const line = lines[i]!;
    // jest: "  ● suite › test name"; vitest: " FAIL  file > test"; pytest: "FAILED path::test - msg"
    let m = /^\s*●\s+(.+)$/.exec(line);
    if (m && !/Console$/.test(m[1]!)) {
      const block = lines.slice(i + 1, i + 30).join('\n');
      failures.push({ test_name: m[1]!.trim(), file: '', message: firstMessage(block), stack: block });
      continue;
    }
    m = /^\s*FAIL(?:ED)?\s+(\S+?)(?:::|\s+>\s+)(.+?)(?:\s+-\s+(.+))?$/.exec(line);
    if (m) {
      const block = lines.slice(i + 1, i + 30).join('\n');
      failures.push({
        test_name: m[2]!.trim(),
        file: m[1]!,
        message: m[3]?.trim() || firstMessage(block),
        stack: block,
      });
    }
  }
  return {
    runner: 'raw',
    passed,
    failed: Math.max(failed, failures.length),
    skipped,
    failures,
    structured: false,
  };
}

function firstMessage(block: string): string {
  for (const l of block.split('\n')) {
    const t = l.trim();
    if (t && !/^at\s/.test(t)) return t.slice(0, 500);
  }
  return 'Test failed';
}
