import { splitMessage } from './common.js';
import type { ParsedFailure, ParsedTestReport } from './types.js';

function unescapeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]!] = unescapeXml(m[2]!);
  return out;
}

/**
 * Minimal JUnit XML parser for pytest's `--junitxml` output (no XML dependency needed:
 * the format is flat and machine-generated).
 */
export function parseJUnitXml(xml: string): ParsedTestReport {
  const failures: ParsedFailure[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of xml.matchAll(caseRe)) {
    const a = attrs(m[1] ?? '');
    const body = m[2] ?? '';
    const fail = /<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body);
    if (fail) {
      failed++;
      const fa = attrs(fail[2] ?? '');
      const text = unescapeXml(fail[3] ?? '').trim();
      const classname = a.classname ?? '';
      const file = a.file ?? (classname ? classname.split('.').slice(0, -1).join('/') + '.py' : '');
      const name = a.name ?? 'unknown';
      failures.push({
        test_name: classname ? `${classname}::${name}` : name,
        file,
        line: a.line ? Number(a.line) + 1 : undefined, // pytest reports 0-based lines
        message: (fa.message ? fa.message : splitMessage(text)) || `${fail[1]} in ${name}`,
        stack: text,
      });
    } else if (/<skipped\b/.test(body)) {
      skipped++;
    } else {
      passed++;
    }
  }
  return { runner: 'pytest', passed, failed, skipped, failures, structured: true };
}
