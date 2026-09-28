import { stripAnsi } from '../truncate.js';

/**
 * Split a failure text into its message (lines before the first stack frame) and the full text.
 */
export function splitMessage(text: string, maxLines = 6): string {
  const clean = stripAnsi(text).replace(/\r/g, '');
  const lines: string[] = [];
  for (const line of clean.split('\n')) {
    if (/^\s*at\s+\S/.test(line) || /^\s*File ".+", line \d+/.test(line)) break;
    if (line.trim() === '' && lines.length === 0) continue;
    lines.push(line.replace(/\s+$/, ''));
    if (lines.length >= maxLines) break;
  }
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.join('\n').trim() || clean.trim().split('\n')[0] || '';
}
