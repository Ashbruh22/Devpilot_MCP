import {
  isProjectFrame,
  normalizeFramePath,
  parseStackFrames,
  type StackFrame,
} from './parsers/stackTrace.js';
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
    /\b(how (do|can|should) (i|we)|is it possible|what is the (right|best) way|question)\b/i,
    /\?\s*$/m,
  ],
  docs: [/\b(docs?|documentation|readme|typo|guide|tutorial|example in the docs)\b/i],
};

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
    for (const m of b.code.matchAll(CALL_RE)) {
      const n = m[1]!;
      if (!NOT_CALLS.has(n) && !STOP_IDENTS.has(n.toLowerCase())) out.push(n);
    }
  }
  return out;
}

function searchQueries(
  errors: string[],
  frames: StackFrame[],
  text: string,
  paths: string[],
  blocks: CodeBlock[],
): string[] {
  const q: string[] = [];
  // 1. Function names from project stack frames (most specific).
  for (const f of frames) {
    if (!isProjectFrame(f.file, { allowAbsolute: true }) || !f.function) continue;
    const name =
      f.function
        .replace(/^(Object|Module|async|new)\./, '')
        .split('.')
        .pop() ?? '';
    if (name && name !== '<module>' && name !== '<anonymous>' && !STOP_IDENTS.has(name.toLowerCase()))
      q.push(name);
  }
  // 2. Identifiers in inline code.
  for (const m of stripCode(text).matchAll(BACKTICK_RE)) {
    const tok = m[1]!.trim().replace(/\(\)$/, '');
    if (IDENT_RE.test(tok) && tok.length >= 3 && !STOP_IDENTS.has(tok.toLowerCase())) {
      q.push(tok.includes('.') ? tok.split('.').pop()! : tok);
    }
  }
  // 3. Functions imported or called in code snippets.
  q.push(...identifiersFromCode(blocks));
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
  return uniq(q, (s) => s.toLowerCase()).slice(0, 10);
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
    parseStackFrames(all).map((f) => ({ ...f, file: normalizeFramePath(f.file, root) })),
    (f) => `${f.file}:${f.line}`,
  ).slice(0, 30);
  const framePaths = stack_frames
    .filter((f) => isProjectFrame(f.file, { allowAbsolute: true }))
    .map((f) => f.file);
  const mentioned_paths = uniq([...extractMentionedPaths(all), ...framePaths]).slice(0, 30);
  const { type, signals } = guessType(issue, error_messages.length > 0, stack_frames.length > 0);

  return {
    type_guess: type,
    type_signals: signals.slice(0, 8),
    error_messages,
    stack_frames,
    mentioned_paths,
    code_blocks: code_blocks.slice(0, 10).map((b) => ({ ...b, code: truncateText(b.code, 2_000) })),
    suggested_search_queries: searchQueries(error_messages, stack_frames, all, mentioned_paths, code_blocks),
  };
}
