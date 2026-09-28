import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ParsedFailure } from './parsers/types.js';
import {
  isProjectFrame,
  isTestFile,
  normalizeFramePath,
  parseStackFrames,
  type StackFrame,
} from './parsers/stackTrace.js';
import { truncateText } from './truncate.js';

export interface FailureSummary {
  test_name: string;
  file: string;
  line?: number;
  message: string;
  top_frames: StackFrame[];
  likely_source_files: string[];
  /** How likely_source_files was derived. */
  source_hint: 'stack' | 'naming' | 'none';
}

export interface FailureGroup {
  signature: string;
  count: number;
  sample_message: string;
  tests: string[];
  likely_source_files: string[];
}

/**
 * Normalize an error message so failures with the same root cause group together:
 * numbers, quoted strings, hex addresses and paths become placeholders.
 */
export function normalizeMessage(message: string): string {
  const first = message.split('\n').find((l) => l.trim()) ?? '';
  return (
    first
      .trim()
      .replace(/0x[0-9a-f]+/gi, '<hex>')
      .replace(/(["'`])(?:(?!\1).){0,200}\1/g, '<str>')
      .replace(/(?:[A-Za-z]:)?(?:\/[\w.@-]+){2,}/g, '<path>')
      .replace(/-?\d+(\.\d+)?(e[+-]?\d+)?/gi, '<n>')
      .replace(/\s+/g, ' ')
      .slice(0, 200) || '(no message)'
  );
}

/** When the stack has no source frames, guess from naming: src/x.test.ts → src/x.ts, tests/test_x.py → x.py. */
function guessSourceFromTestName(root: string, testFile: string): string[] {
  if (!testFile) return [];
  const dir = path.posix.dirname(testFile);
  const base = path.posix.basename(testFile);
  const stem = base
    .replace(/\.(test|spec)(\.[cm]?[jt]sx?)$/, '$2')
    .replace(/^test_(.+\.py)$/, '$1')
    .replace(/^(.+)_test(\.py)$/, '$1$2');
  if (stem === base) return [];
  const parentDir = path.posix.dirname(dir);
  const candidates = [
    path.posix.join(dir, stem),
    path.posix.join(parentDir, stem),
    path.posix.join(parentDir, 'src', stem),
    path.posix.join('src', stem),
    path.posix.join('lib', stem),
    stem,
  ];
  const exts = /\.[cm]?[jt]sx?$/.test(stem)
    ? ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
    : [path.posix.extname(stem)];
  const found: string[] = [];
  for (const c of candidates) {
    const noExt = c.replace(/\.[^.]+$/, '');
    for (const ext of exts) {
      const rel = path.posix.normalize(noExt + ext);
      if (!rel.startsWith('..') && existsSync(path.join(root, rel))) found.push(rel);
    }
  }
  return [...new Set(found)].slice(0, 3);
}

export function summarizeFailure(f: ParsedFailure, root: string): FailureSummary {
  const frames = parseStackFrames(f.stack)
    .map((fr) => ({ ...fr, file: normalizeFramePath(fr.file, root) }))
    .filter((fr) => isProjectFrame(fr.file));
  const top = frames.slice(0, 5);
  const fromStack = [...new Set(frames.map((fr) => fr.file).filter((file) => !isTestFile(file)))];
  const file = normalizeFramePath(f.file, root);
  let likely = fromStack;
  let hint: FailureSummary['source_hint'] = fromStack.length ? 'stack' : 'none';
  if (!likely.length) {
    likely = guessSourceFromTestName(root, file);
    if (likely.length) hint = 'naming';
  }
  // Use the test's own frame for the line number if the reporter didn't give one.
  const line = f.line ?? frames.find((fr) => fr.file === file)?.line;
  return {
    test_name: f.test_name,
    file,
    line,
    message: truncateText(f.message, 800),
    top_frames: top,
    likely_source_files: likely.slice(0, 5),
    source_hint: hint,
  };
}

export function groupFailures(failures: FailureSummary[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();
  for (const f of failures) {
    const sig = normalizeMessage(f.message);
    let g = groups.get(sig);
    if (!g)
      groups.set(
        sig,
        (g = { signature: sig, count: 0, sample_message: f.message, tests: [], likely_source_files: [] }),
      );
    g.count++;
    if (g.tests.length < 20) g.tests.push(f.test_name);
    for (const s of f.likely_source_files)
      if (!g.likely_source_files.includes(s)) g.likely_source_files.push(s);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
