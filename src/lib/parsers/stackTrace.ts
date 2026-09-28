import path from 'node:path';

export interface StackFrame {
  file: string;
  line: number;
  column?: number;
  function?: string;
}

// V8 / Node: "    at fn (/abs/file.js:10:5)", "at async fn (file:///x.mjs:1:2)", "at /abs/file.js:10:5"
const V8_WITH_FN = /^\s*at\s+(?:async\s+)?(?:new\s+)?(.+?)\s+\((.+?):(\d+)(?::(\d+))?\)\s*$/;
const V8_NO_FN = /^\s*at\s+(?:async\s+)?(.+?):(\d+)(?::(\d+))?\s*$/;
// Firefox / Safari: "fn@http://host/app.js:10:5" or "@http://host/app.js:10:5"
const GECKO = /^\s*([^@\s]*)@(.+?):(\d+)(?::(\d+))?\s*$/;
// Python: '  File "/abs/x.py", line 10, in func'
const PYTHON = /^\s*File "(.+?)", line (\d+)(?:, in (.+))?\s*$/;
// Pytest short form: "tests/test_x.py:12: AssertionError" / "src/x.py:4: in func"
const PYTEST_SHORT = /^\s*([\w./\\-]+\.py):(\d+):\s*(?:in\s+(\S+))?/;

function cleanFunction(fn: string | undefined): string | undefined {
  if (!fn) return undefined;
  const f = fn.trim();
  if (!f || f === '<anonymous>' || f === '<module>') return f === '<module>' ? f : undefined;
  return f;
}

/** Parse JS (V8, browser) and Python stack frames out of arbitrary text. */
export function parseStackFrames(text: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let m: RegExpExecArray | null;
    if ((m = PYTHON.exec(raw))) {
      frames.push({ file: m[1]!, line: Number(m[2]), function: cleanFunction(m[3]) });
    } else if ((m = V8_WITH_FN.exec(raw))) {
      // "at fn (native)" / "(<anonymous>)" have no line and fail the regex; good.
      frames.push({
        file: m[2]!,
        line: Number(m[3]),
        column: m[4] ? Number(m[4]) : undefined,
        function: cleanFunction(m[1]),
      });
    } else if ((m = V8_NO_FN.exec(raw))) {
      frames.push({ file: m[1]!, line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined });
    } else if ((m = GECKO.exec(raw)) && /[/\\.]/.test(m[2]!)) {
      frames.push({
        file: m[2]!,
        line: Number(m[3]),
        column: m[4] ? Number(m[4]) : undefined,
        function: cleanFunction(m[1]),
      });
    } else if ((m = PYTEST_SHORT.exec(raw))) {
      frames.push({ file: m[1]!, line: Number(m[2]), function: cleanFunction(m[3]) });
    }
  }
  return dedupeFrames(frames);
}

function dedupeFrames(frames: StackFrame[]): StackFrame[] {
  const seen = new Set<string>();
  return frames.filter((f) => {
    const k = `${f.file}:${f.line}:${f.column ?? ''}:${f.function ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Normalize a frame's file to a workspace-relative POSIX path when possible:
 * strips file:// and URL origins, webpack:// prefixes, and the workspace root.
 */
export function normalizeFramePath(file: string, root?: string): string {
  let f = file.trim();
  f = f.replace(/^file:\/\//, '');
  f = f.replace(/^webpack(-internal)?:\/\/\/?(\.\/)?/, '');
  f = f.replace(/^https?:\/\/[^/]+\//, '');
  f = f.replace(/\?.*$/, '');
  if (root) {
    const r = path.resolve(root);
    if (path.isAbsolute(f)) {
      const rel = path.relative(r, f);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) f = rel;
    }
  }
  return f.split(path.sep).join('/').replace(/^\.\//, '');
}

/**
 * Is this frame in the project itself (not deps, runtime internals, or the test runner)?
 * `allowAbsolute` accepts absolute paths that could not be made root-relative — used for
 * traces pasted into issues, which come from the reporter's machine.
 */
export function isProjectFrame(file: string, opts: { allowAbsolute?: boolean } = {}): boolean {
  const f = file.replace(/\\/g, '/');
  if (!f || f.startsWith('node:') || f.startsWith('internal/')) return false;
  if (/(^|\/)node_modules\//.test(f)) return false;
  if (/(^|\/)(site-packages|dist-packages)\//.test(f)) return false;
  if (/^<.*>$/.test(f) || f === 'native' || f.includes('<frozen ')) return false;
  if (/^\/usr\/lib\/python|\/lib\/python\d/.test(f)) return false;
  // Absolute paths that were not made relative to the root are outside the project.
  if (path.isAbsolute(f) && !opts.allowAbsolute) return false;
  return true;
}

const TEST_FILE =
  /(^|\/)(__tests__|__mocks__|tests?|spec)\/|[._-](test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/)conftest\.py$/;
export function isTestFile(file: string): boolean {
  return TEST_FILE.test(file.replace(/\\/g, '/'));
}
