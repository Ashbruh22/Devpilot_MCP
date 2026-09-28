import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { toPosix } from './pathGuard.js';

export interface DocSection {
  path: string;
  heading: string;
  level: number;
  content: string;
}

const ROOT_DOC = /^(README|CONTRIBUTING|CHANGELOG|ARCHITECTURE|SECURITY|DEVELOPMENT)([._-].*)?$|\.(md|mdx)$/i;
const DOC_EXT = /\.(md|mdx|markdown|txt|rst)$/i;
const DOC_DIRS = ['docs', 'doc', 'documentation'];
const MAX_DOC_BYTES = 512 * 1024;
const MAX_FILES = 300;

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'is',
  'how',
  'do',
  'i',
  'what',
  'with',
  'does',
  'can',
  'it',
  'be',
  'are',
  'my',
  'we',
  'use',
  'using',
]);

/** Find documentation files: README*, CONTRIBUTING*, *.md at the root, and docs/**\/*.md. */
export function listDocFiles(root: string): string[] {
  const out: string[] = [];
  const safeReaddir = (dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const e of safeReaddir(root)) {
    if (
      e.isFile() &&
      ROOT_DOC.test(e.name) &&
      DOC_EXT.test(e.name.includes('.') ? e.name : e.name + '.txt')
    ) {
      out.push(e.name);
    }
  }
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || out.length >= MAX_FILES) return;
    for (const e of safeReaddir(dir)) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, depth + 1);
      else if (e.isFile() && DOC_EXT.test(e.name)) out.push(toPosix(path.relative(root, abs)));
    }
  };
  for (const d of DOC_DIRS) walk(path.join(root, d), 0);
  const rank = (p: string) =>
    /^readme/i.test(p) ? 0 : /^contributing/i.test(p) ? 1 : p.includes('/') ? 3 : 2;
  return [...new Set(out)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function readDoc(absPath: string): string | null {
  try {
    const st = statSync(absPath);
    if (!st.isFile() || st.size > MAX_DOC_BYTES) return null;
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

/** Split markdown into sections at ATX headings, ignoring "#" lines inside fenced code. */
export function splitSections(relPath: string, markdown: string): DocSection[] {
  const sections: DocSection[] = [];
  let current: DocSection = { path: relPath, heading: '(top)', level: 0, content: '' };
  let fence: string | null = null;
  const lines: string[] = [];
  const flush = () => {
    current.content = lines.join('\n').trim();
    if (current.content || current.level > 0) sections.push(current);
    lines.length = 0;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) fence = fence === f[1] ? null : (fence ?? f[1]!);
    const h = fence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      current = { path: relPath, heading: h[2]!, level: h[1]!.length, content: '' };
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

export function tokenize(topic: string): string[] {
  return [
    ...new Set(
      topic
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
    ),
  ];
}

function countHits(text: string, term: string): number {
  let n = 0;
  let i = text.indexOf(term);
  while (i !== -1) {
    n++;
    i = text.indexOf(term, i + term.length);
  }
  return n;
}

/** Keyword score: heading hits weigh 5x, body hits count once each (capped), all-terms bonus. */
export function scoreSection(section: DocSection, terms: string[]): number {
  if (terms.length === 0) return 0;
  const heading = section.heading.toLowerCase();
  const body = section.content.toLowerCase();
  let score = 0;
  let matched = 0;
  for (const t of terms) {
    const h = countHits(heading, t);
    const b = Math.min(10, countHits(body, t));
    if (h || b) matched++;
    score += h * 5 + b;
  }
  if (matched === terms.length && terms.length > 1) score *= 1.5;
  return score;
}
