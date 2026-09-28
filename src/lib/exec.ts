import { spawn } from 'node:child_process';
import { log } from './logger.js';

export interface ExecOptions {
  cwd: string;
  timeoutMs: number;
  /** Cap on captured stdout and stderr (each). */
  maxOutputChars: number;
  /** Which end of the output to keep once the cap is hit. Tests want the tail; search wants the head. */
  keep?: 'head' | 'tail';
  /** Kill the process as soon as the cap is exceeded (only sensible with keep: 'head'). */
  killOnOverflow?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface ExecResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
  durationMs: number;
  /** Set when the process could not be started at all (e.g. ENOENT). */
  spawnError?: string;
}

const SECRET_EXACT = new Set([
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'DEVPILOT_API_KEY',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
]);
const SECRET_PATTERN = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL)/i;

/** Copy of the environment with secrets removed. Children never see our tokens. */
export function sanitizedEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (SECRET_EXACT.has(k.toUpperCase()) || SECRET_PATTERN.test(k)) continue;
    out[k] = v;
  }
  out.CI = '1';
  out.NO_COLOR = '1';
  out.FORCE_COLOR = '0';
  return out;
}

class Capture {
  private buf = '';
  truncated = false;
  constructor(
    private readonly max: number,
    private readonly keep: 'head' | 'tail',
  ) {}
  push(chunk: string): boolean {
    if (this.keep === 'head') {
      if (this.buf.length >= this.max) {
        this.truncated = true;
        return false;
      }
      const room = this.max - this.buf.length;
      if (chunk.length > room) this.truncated = true;
      this.buf += chunk.slice(0, room);
      return !this.truncated;
    }
    this.buf += chunk;
    if (this.buf.length > this.max * 2) {
      this.buf = this.buf.slice(this.buf.length - this.max);
      this.truncated = true;
    }
    return true;
  }
  value(): string {
    if (this.keep === 'tail' && this.buf.length > this.max) {
      this.truncated = true;
      return this.buf.slice(this.buf.length - this.max);
    }
    return this.buf;
  }
}

/** Kill the whole process group (the child was spawned detached, so -pid addresses its group). */
function killTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Spawn a command WITHOUT a shell, with a timeout that kills the whole process tree,
 * capped output, and a sanitized environment.
 */
export function runCommand(command: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
  const started = Date.now();
  const keep = opts.keep ?? 'tail';
  const out = new Capture(opts.maxOutputChars, keep);
  const err = new Capture(opts.maxOutputChars, keep);

  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    let child;
    try {
      child = spawn(command, args, {
        cwd: opts.cwd,
        env: opts.env ?? sanitizedEnv(),
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      resolve({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: Date.now() - started,
        spawnError: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    const pid = child.pid;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      log.warn('command timed out; killing process tree', { command, pid, timeoutMs: opts.timeoutMs });
      killTree(pid, 'SIGTERM');
      killTimer = setTimeout(() => killTree(pid, 'SIGKILL'), 2_000);
      killTimer.unref();
    }, opts.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      if (!out.push(d) && opts.killOnOverflow) killTree(pid, 'SIGTERM');
    });
    child.stderr.on('data', (d: string) => {
      err.push(d);
    });

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        // Make sure stragglers in the group are gone even if the leader exited on SIGTERM.
        killTree(pid, 'SIGKILL');
        if (killTimer) clearTimeout(killTimer);
      }
      resolve({
        exitCode,
        signal,
        stdout: out.value(),
        stderr: err.value(),
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
        timedOut,
        durationMs: Date.now() - started,
        spawnError,
      });
    };

    child.on('error', (e) => finish(null, null, e.message));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

/**
 * Split a configured command string into argv. Supports simple single/double quoting;
 * deliberately does NOT support shell operators (pipes, redirects, $vars, ;, &&).
 */
export function splitCommand(command: string): string[] {
  const args: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of command.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) args.push(cur);
      cur = '';
      has = false;
    } else if (/[|&;<>`$]/.test(ch)) {
      throw new Error(`Shell operator "${ch}" is not supported in commands: ${command}`);
    } else {
      cur += ch;
    }
  }
  if (quote) throw new Error(`Unterminated quote in command: ${command}`);
  if (has || cur) args.push(cur);
  if (args.length === 0) throw new Error('Empty command');
  return args;
}
