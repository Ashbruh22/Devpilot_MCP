import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  isProjectFrame,
  normalizeFramePath,
  parseStackFrames,
  type StackFrame,
} from './parsers/stackTrace.js';
import { isSafeRelative } from './pathGuard.js';
import { truncateText } from './truncate.js';

export type IssueType = 'bug' | 'feature' | 'question' | 'docs';

export interface AnalyzableIssue {
  title: string;
  body: string;
  labels: string[];
  comments: Array<{ body: string }>;
}

export interface CodeBlock {
  source: string;
  lang: string;
  code: string;
}

export interface IssueAnalysis {
  type_guess: IssueType;
  type_signals: string[];
  error_messages: string[];
  stack_frames: StackFrame[];
  mentioned_paths: string[];
  code_blocks: CodeBlock[];
  suggested_search_queries: string[];
}

const LABEL_TYPES: Array<[RegExp, IssueType]> = [
  [/\b(bug|defect|regression|crash|broken|error)\b/i, 'bug'],
  [/\b(docs?|documentation)\b/i, 'docs'],
  [/\b(question|help wanted|support|how.?to)\b/i, 'question'],
  [/\b(feature|enhancement|proposal|request|idea)\b/i, 'feature'],
];

const KEYWORDS: Record<IssueType, RegExp[]> = {
  bug: [
    /\b(bug|crash(es|ed)?|broken|regression|fails?|failing|failed|wrong|incorrect|unexpected|exception|throws?)\b/i,
    /\b(expected .{1,60} but (got|received|was))\b/i,
    /\bsteps to reproduce\b/i,
  ],
  feature: [
    /\b(feature request|would be (nice|great)|please add|add support|support for|it would help|proposal|suggest(ion)?|allow (users? )?to)\b/i,
    /\b(could you add|can we (have|add)|enhancement)\b/i,
  ],
  question: [
    /\b(how (do|can|should|does|is) (i|we|it|this)|is it possible|what is the (right|best) way|question)\b/i,
  ],
  docs: [/\b(docs?|documentation|readme|typo|guide|tutorial|example in the docs)\b/i],
};

// Titles phrased as a capability ("Support X", "Add Y") read as feature requests.
const FEATURE_TITLE = /^(support|add|allow|implement|provide|expose|enable)\b/i;

const ERROR_LINE_PATTERNS: RegExp[] = [
  /\b[A-Z]\w*(Error|Exception)\b(:|\s-\s|$)/, // TypeError: …, ValueError: …, java.lang.IllegalStateException
  /\bError:\s/,
  /^Traceback \(most recent call last\)/,
  /\bFAILED\b/,
  /\bFAIL\b\s+\S/,
  /\bpanic:\s/,
  /\b(HTTP\/?\d?(\.\d)?\s*)?[45]\d\d\s+(Bad Request|Unauthorized|Forbidden|Not Found|Method Not Allowed|Conflict|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i,
  /\bstatus(\s*code)?\s*[:=]?\s*[45]\d\d\b/i,
  /\b(ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|EADDRINUSE|ERR_[A-Z_]+)\b/,
  /\bAssertionError\b|\bexpected\b.+\bto (be|equal|deeply equal)\b/i,
];

const CODE_EXT =
  'ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|cpp|cc|c|h|hpp|swift|scala|vue|svelte|json|ya?ml|toml|md|mdx|sql|sh|css|scss|html';
const PATH_RE = new RegExp(
  String.raw`(?<![\w/.:-])((?:\.{1,2}/)?(?:[\w@.-]+/)*[\w.-]+\.(?:${CODE_EXT}))(?::\d+(?::\d+)?)?(?![\w/])`,
  'g',
);
const DIR_PATH_RE = /(?<![\w/.:-])((?:src|lib|app|packages|docs|test|tests|pkg|cmd|internal)\/[\w@./-]+)/g;
const BACKTICK_RE = /`([^`\n]{2,80})`/g;
const IDENT_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/;
const FENCE_RE = /^(```|~~~)[ \t]*([\w+#.-]*)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;

const STOP_IDENTS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'none',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'node',
  'git',
  'main',
  'master',
  'this',
  'self',
  'return',
  'const',
  'let',
  'var',
  'function',
  'import',
  'export',
  'error',
  'string',
  'number',
  'object',
  'boolean',
  'python',
  'pip',
]);

function uniq<T>(items: T[], key: (t: T) => string = (t) => String(t)): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function stripCode(markdown: string): string {
  return markdown.replace(FENCE_RE, '\n');
}

export function extractCodeBlocks(text: string, source: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  for (const m of text.matchAll(FENCE_RE)) {
    blocks.push({ source, lang: m[2] ?? '', code: (m[3] ?? '').replace(/\s+$/, '') });
  }
  return blocks;
}

export function extractErrorMessages(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[>*-]\s+/, '');
    if (!line || /^\s*at\s/.test(raw) || /^File ".+", line \d+/.test(line)) continue;
    if (ERROR_LINE_PATTERNS.some((re) => re.test(line))) out.push(truncateText(line, 300));
  }
  return uniq(out);
}

export function extractMentionedPaths(text: string): string[] {
  const out: string[] = [];
  const prose = text.replace(/https?:\/\/\S+/g, ' ');
  for (const m of prose.matchAll(PATH_RE)) out.push(m[1]!);
  for (const m of prose.matchAll(DIR_PATH_RE)) out.push(m[1]!.replace(/[.,;:)]+$/, ''));
  return uniq(
    out
      .map((p) => p.replace(/^\.\//, ''))
      .filter(
        (p) => !/^\d+(\.\d+)+$/.test(p) && !/(^|\/)node_modules\//.test(p) && !/^e\.g\.|^i\.e\./.test(p),
      ),
  );
}

const MODULE_SPEC_RE =
  /\bfrom\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]|^\s*from\s+([\w.]+)\s+import\b|^\s*import\s+(\w+(?:\.\w+)+)\s*$/gm;

/** Module names imported in code snippets, e.g. "./src/pricing" → "src/pricing", "app.services.billing". */
export function extractModuleSpecifiers(blocks: CodeBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    for (const m of b.code.matchAll(MODULE_SPEC_RE)) {
      const spec = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').trim();
      if (!spec || spec.startsWith('node:') || /^https?:/.test(spec)) continue;
      // Keep relative/path-like specifiers and dotted Python modules; skip bare npm packages.
      if (!spec.includes('/') && !/^\w+(\.\w+)+$/.test(spec)) continue;
      out.push(spec.replace(/^(\.\.?\/)+/, ''));
    }
  }
  return out;
}

function guessType(
  issue: AnalyzableIssue,
  hasErrors: boolean,
  hasFrames: boolean,
): { type: IssueType; signals: string[] } {
  for (const label of issue.labels) {
    for (const [re, type] of LABEL_TYPES) {
      if (re.test(label)) return { type, signals: [`label "${label}"`] };
    }
  }
  const text = `${issue.title}\n${stripCode(issue.body)}`;
  const scores: Record<IssueType, number> = { bug: 0, feature: 0, question: 0, docs: 0 };
  const signals: string[] = [];
  for (const [type, patterns] of Object.entries(KEYWORDS) as Array<[IssueType, RegExp[]]>) {
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) {
        // Title matches weigh double.
        scores[type] += re.test(issue.title) ? 2 : 1;
        signals.push(`${type}: "${m[0].trim()}"`);
      }
    }
  }
  if (FEATURE_TITLE.test(issue.title.trim())) {
    scores.feature += 2;
    signals.push(`feature: title starts with "${issue.title.trim().split(/\s+/)[0]}"`);
  }
  // A trailing question mark is weak evidence (bug reports ask questions too).
  if (/\?\s*$/m.test(text)) scores.question += 0.5;
  if (hasErrors) {
    scores.bug += 2;
    signals.push('bug: error messages present');
  }
  if (hasFrames) {
    scores.bug += 2;
    signals.push('bug: stack trace present');
  }
  const order: IssueType[] = ['bug', 'docs', 'feature', 'question'];
  let best: IssueType = 'question';
  let bestScore = 0;
  for (const t of order) {
    if (scores[t] > bestScore) {
      best = t;
      bestScore = scores[t];
    }
  }
  return { type: best, signals: bestScore ? signals : ['no strong signals; defaulting to question'] };
}

const GLOBAL_OBJECTS = new Set([
  'Math',
  'JSON',
  'Object',
  'Array',
  'Number',
  'String',
  'Date',
  'Promise',
  'console',
  'process',
  'window',
  'document',
  'Reflect',
  'Intl',
  'Symbol',
  'os',
  'sys',
  'json',
  'math',
]);

const CALL_RE = /(?<![\w$.])([A-Za-z_$][\w$]{2,})\s*\(/g;
const IMPORT_RE = /\bimport\s*\{([^}]+)\}|\bfrom\s+[\w.]+\s+import\s+([\w, ]+)/g;
const NOT_CALLS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'require',
  'import',
  'print',
  'console',
  'describe',
  'it',
  'test',
  'expect',
  'len',
  'str',
  'int',
  'float',
  'list',
  'dict',
  'set',
  'range',
  'super',
  'setTimeout',
  'setInterval',
  'fetch',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'Promise',
  'Error',
  'parseInt',
  'parseFloat',
  'isinstance',
  'await',
  'async',
  'typeof',
  'new',
]);

/** Identifiers the snippet imports or calls (e.g. `applyDiscount(10, 33)`), most distinctive first. */
function identifiersFromCode(blocks: CodeBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    for (const m of b.code.matchAll(IMPORT_RE)) {
      for (const name of (m[1] ?? m[2] ?? '').split(',')) {
        const n = name
          .trim()
          .split(/\s+as\s+/)[0]!
          .trim();
        if (IDENT_RE.test(n) && n.length >= 3) out.push(n);
      }
    }
    const code = b.code
      .split('\n')
      .filter(
        (l) =>
          !/^\s*at\s/.test(l) &&
          !/^\s*File ".+", line \d+/.test(l) &&
          !ERROR_LINE_PATTERNS.some((re) => re.test(l)) &&
          !/^\s*Traceback\b/.test(l),
      )
      .join('\n');
    for (const m of code.matchAll(CALL_RE)) {
      const n = m[1]!;
      if (!NOT_CALLS.has(n) && !STOP_IDENTS.has(n.toLowerCase())) out.push(n);
    }
  }
  return out;
}

function searchQueries(
  title: string,
  errors: string[],
  frames: StackFrame[],
  text: string,
  paths: string[],
  blocks: CodeBlock[],
): string[] {
  const q: string[] = [];
  // Frames whose paths resolved inside the workspace are the strongest signal; frames with
  // absolute paths come from the reporter's machine (possibly their own code), so rank them lower.
  const inRepo: string[] = [];
  const foreign: string[] = [];
  for (const f of frames) {
    if (!isProjectFrame(f.file, { allowAbsolute: true }) || !f.function) continue;
    const name =
      f.function
        .replace(/^(Object|Module|async|new)\./, '')
        .split('.')
        .pop() ?? '';
    if (name && name !== '<module>' && name !== '<anonymous>' && !STOP_IDENTS.has(name.toLowerCase())) {
      (path.isAbsolute(f.file) ? foreign : inRepo).push(name);
    }
  }
  // 1. Function names from in-repo stack frames.
  q.push(...inRepo);
  // 2. Identifiers in inline code.
  for (const m of stripCode(text).matchAll(BACKTICK_RE)) {
    const tok = m[1]!.trim().replace(/\(\)$/, '');
    if (IDENT_RE.test(tok) && tok.length >= 3 && !STOP_IDENTS.has(tok.toLowerCase())) {
      // `Math.floor` and friends are language builtins, not project symbols.
      if (GLOBAL_OBJECTS.has(tok.split('.')[0]!)) continue;
      q.push(tok.includes('.') ? tok.split('.').pop()! : tok);
    }
  }
  // 3. Functions imported or called in code snippets.
  q.push(...identifiersFromCode(blocks));
  // 3b. Function names from frames outside the workspace.
  q.push(...foreign);
  // 4. Distinctive error message text (the part after "XxxError: ").
  for (const e of errors) {
    const m = /(?:\w*(?:Error|Exception)|Error):\s*(.+)$/.exec(e);
    const msg = (m?.[1] ?? '').replace(/["'`]/g, '').trim();
    if (msg.length >= 8 && msg.length <= 120) q.push(msg);
  }
  // 5. Basenames of mentioned files (without extension) as a last resort.
  for (const p of paths) {
    const base = p
      .split('/')
      .pop()!
      .replace(/\.[^.]+$/, '');
    if (base.length >= 3 && !STOP_IDENTS.has(base.toLowerCase()) && !/^(index|readme|package)$/i.test(base))
      q.push(base);
  }
  // 6. Nothing concrete (typical for questions and feature requests): fall back to title keywords.
  if (q.length === 0) {
    for (const w of title.toLowerCase().split(/[^a-z0-9_]+/)) {
      if (w.length >= 4 && !TITLE_STOPWORDS.has(w)) q.push(w.replace(/ies$/, 'y').replace(/([^s])s$/, '$1'));
    }
  }
  return uniq(q, (s) => s.toLowerCase()).slice(0, 10);
}

const TITLE_STOPWORDS = new Set(
  'support supposed should would could does doesn with when what which this that there their from into about other work works working using have please feature request question issue problem possible'.split(
    ' ',
  ),
);

/**
 * Map an absolute path from the reporter's machine onto the workspace by the longest path
 * suffix that exists there, e.g. /home/me/shop/src/pricing.ts → src/pricing.ts.
 */
export function mapToWorkspace(file: string, root: string): string {
  if (!path.isAbsolute(file)) return file;
  const parts = file.split('/').filter(Boolean);
  for (let i = Math.max(0, parts.length - 8); i < parts.length; i++) {
    const rel = parts.slice(i).join('/');
    if (existsSync(path.join(root, rel)) && isSafeRelative(root, rel)) return rel;
  }
  return file;
}

/** Deterministically extract triage signals from an issue. No LLM involved. */
export function analyzeIssueContent(issue: AnalyzableIssue, root?: string): IssueAnalysis {
  const sources: Array<[string, string]> = [
    ['body', issue.body],
    ...issue.comments.map((c, i): [string, string] => [`comment ${i + 1}`, c.body]),
  ];
  const all = [issue.title, ...sources.map(([, t]) => t)].join('\n\n');

  const code_blocks = sources.flatMap(([src, t]) => extractCodeBlocks(t, src));
  const error_messages = extractErrorMessages(all).slice(0, 20);
  const stack_frames = uniq(
    parseStackFrames(all).map((f) => {
      const file = normalizeFramePath(f.file, root);
      return {
        ...f,
        file: root && isProjectFrame(file, { allowAbsolute: true }) ? mapToWorkspace(file, root) : file,
      };
    }),
    (f) => `${f.file}:${f.line}`,
  ).slice(0, 30);
  const framePaths = stack_frames
    .filter((f) => isProjectFrame(f.file, { allowAbsolute: true }))
    .map((f) => f.file);
  const mentioned_paths = uniq([
    ...extractMentionedPaths(all),
    ...extractModuleSpecifiers(code_blocks),
    ...framePaths,
  ]).slice(0, 30);
  const { type, signals } = guessType(issue, error_messages.length > 0, stack_frames.length > 0);

  return {
    type_guess: type,
    type_signals: signals.slice(0, 8),
    error_messages,
    stack_frames,
    mentioned_paths,
    code_blocks: code_blocks.slice(0, 10).map((b) => ({ ...b, code: truncateText(b.code, 2_000) })),
    suggested_search_queries: searchQueries(
      issue.title,
      error_messages,
      stack_frames,
      all,
      mentioned_paths,
      code_blocks,
    ),
  };
}
