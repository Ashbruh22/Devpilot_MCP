import { existsSync } from 'node:fs';
import { rgPath as bundledRgPath } from '@vscode/ripgrep';
import { ToolError } from './errors.js';
import { runCommand } from './exec.js';
import { assertSafeGlob, isSafeRelative } from './pathGuard.js';
import { truncateLine } from './truncate.js';

export interface SearchMatch {
  path: string;
  line: number;
  preview: string;
  context_before: string[];
  context_after: string[];
}

export interface SearchResult {
  matches: SearchMatch[];
  total_matches: number;
  files_with_matches: number;
  truncated: boolean;
}

export interface SearchOptions {
  query: string;
  isRegex: boolean;
  pathGlob?: string;
  maxResults: number;
  contextLines: number;
  timeoutMs?: number;
}

export function rgBinary(): string {
  return existsSync(bundledRgPath) ? bundledRgPath : 'rg';
}

const EXCLUDES = [
  '!node_modules/',
  '!dist/',
  '!build/',
  '!coverage/',
  '!.git/',
  '!*.lock',
  '!package-lock.json',
  '!pnpm-lock.yaml',
  '!yarn.lock',
  '!*.min.js',
  '!*.map',
];

interface RgText {
  text?: string;
  bytes?: string;
}
interface RgEvent {
  type: 'begin' | 'match' | 'context' | 'end' | 'summary';
  data: {
    path?: RgText;
    lines?: RgText;
    line_number?: number;
    submatches?: unknown[];
    stats?: { matches?: number; matched_lines?: number };
  };
}

function text(t: RgText | undefined): string {
  if (!t) return '';
  if (t.text !== undefined) return t.text;
  return t.bytes ? Buffer.from(t.bytes, 'base64').toString('utf8') : '';
}

/** Run ripgrep against `root`, respecting .gitignore and skipping deps, build output, lockfiles and binaries. */
export async function searchCodebase(root: string, opts: SearchOptions): Promise<SearchResult> {
  if (opts.pathGlob) assertSafeGlob(opts.pathGlob);
  const args = [
    '--json',
    '--no-require-git', // honor .gitignore even outside a git checkout
    '--max-filesize',
    '1M',
    '--max-columns',
    '500',
    '--max-columns-preview',
    '-C',
    String(opts.contextLines),
  ];
  if (!opts.isRegex) args.push('--fixed-strings');
  for (const g of EXCLUDES) args.push('--glob', g);
  if (opts.pathGlob) args.push('--glob', opts.pathGlob);
  // `-e` + `--` so a query or glob can never be interpreted as a flag.
  args.push('-e', opts.query, '--', '.');

  const res = await runCommand(rgBinary(), args, {
    cwd: root,
    timeoutMs: opts.timeoutMs ?? 20_000,
    maxOutputChars: 5_000_000,
    keep: 'head',
    killOnOverflow: true,
  });
  if (res.spawnError) throw new ToolError(`ripgrep could not be started: ${res.spawnError}`);
  if (res.exitCode === 2 && !res.stdout) {
    const msg = res.stderr.trim().split('\n').slice(0, 6).join('\n');
    if (/regex/i.test(msg)) throw new ToolError(`Invalid regex "${opts.query}": ${msg}`);
    throw new ToolError(`Search failed: ${msg || 'ripgrep error'}`);
  }

  // Group lines by file so each match can pick up neighbouring lines as context.
  const files = new Map<string, { lines: Map<number, string>; matches: number[] }>();
  let totalMatches = 0;
  for (const raw of res.stdout.split('\n')) {
    if (!raw) continue;
    let ev: RgEvent;
    try {
      ev = JSON.parse(raw) as RgEvent;
    } catch {
      continue; // partial last line after overflow
    }
    if (ev.type !== 'match' && ev.type !== 'context') continue;
    const p = text(ev.data.path).replace(/^\.\//, '');
    const ln = ev.data.line_number;
    if (!p || !ln) continue;
    let f = files.get(p);
    if (!f) files.set(p, (f = { lines: new Map(), matches: [] }));
    f.lines.set(ln, text(ev.data.lines).replace(/\r?\n$/, ''));
    if (ev.type === 'match') {
      f.matches.push(ln);
      totalMatches++;
    }
  }

  const matches: SearchMatch[] = [];
  let filesWithMatches = 0;
  for (const [p, f] of files) {
    if (f.matches.length === 0) continue;
    if (!isSafeRelative(root, p)) continue; // path guard on every result
    filesWithMatches++;
    for (const ln of f.matches) {
      if (matches.length >= opts.maxResults) break;
      const before: string[] = [];
      for (let i = ln - opts.contextLines; i < ln; i++) {
        const l = f.lines.get(i);
        if (l !== undefined) before.push(truncateLine(l, 200));
      }
      const after: string[] = [];
      for (let i = ln + 1; i <= ln + opts.contextLines; i++) {
        const l = f.lines.get(i);
        if (l !== undefined) after.push(truncateLine(l, 200));
      }
      matches.push({
        path: p,
        line: ln,
        preview: truncateLine(f.lines.get(ln) ?? '', 300),
        context_before: before,
        context_after: after,
      });
    }
  }

  return {
    matches,
    total_matches: totalMatches,
    files_with_matches: filesWithMatches,
    truncated: totalMatches > matches.length || res.stdoutTruncated || res.timedOut,
  };
}
