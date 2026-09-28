import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ToolError } from './errors.js';
import { splitCommand } from './exec.js';
import type { Runner } from './parsers/types.js';

export interface TestPlan {
  runner: Runner;
  command: string;
  args: string[];
  /** Where the runner writes its machine-readable report, if we asked it to. */
  reportFile?: string;
}

export const FILTER_RE = /^[\w\-./ ]{1,100}$/;

export function validateFilter(filter: string | undefined): string | undefined {
  if (filter === undefined || filter === '') return undefined;
  if (!FILTER_RE.test(filter)) {
    throw new ToolError(
      'filter may only contain letters, digits, "_", "-", ".", "/" and spaces (max 100 chars).',
    );
  }
  if (filter.trimStart().startsWith('-')) throw new ToolError('filter must not start with "-".');
  if (filter.split('/').includes('..')) throw new ToolError('filter must not contain "..".');
  return filter.trim();
}

function looksLikePath(filter: string): boolean {
  return filter.includes('/') || /\.(test|spec)\b|\.[cm]?[jt]sx?$|\.py$/.test(filter);
}

/** Find a locally installed binary, walking up from root (monorepos). Never downloads. */
function findLocalBin(root: string, name: string): string | null {
  let dir = path.resolve(root);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '.bin', name);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function jsRunner(root: string, name: 'vitest' | 'jest'): { command: string; args: string[] } {
  const bin = findLocalBin(root, name);
  // `npx --no` refuses to download a package that isn't installed.
  return bin ? { command: bin, args: [] } : { command: 'npx', args: ['--no', name] };
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

function readPackageJson(root: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

function isPytestProject(root: string): boolean {
  const has = (f: string) => existsSync(path.join(root, f));
  if (has('pytest.ini') || has('conftest.py') || has('tests/conftest.py')) return true;
  for (const f of ['pyproject.toml', 'setup.cfg', 'tox.ini']) {
    try {
      if (/pytest/.test(readFileSync(path.join(root, f), 'utf8'))) return true;
    } catch {
      /* missing */
    }
  }
  return false;
}

export function detectRunnerFromArgs(argv: string[]): Runner {
  const joined = argv.join(' ');
  if (/\bvitest\b/.test(joined)) return 'vitest';
  if (/\bjest\b/.test(joined)) return 'jest';
  if (/\bpytest\b/.test(joined)) return 'pytest';
  return 'raw';
}

function applyFilter(plan: TestPlan, filter: string | undefined): TestPlan {
  if (!filter) return plan;
  const args = [...plan.args];
  switch (plan.runner) {
    case 'vitest':
      // Positional args are file filters; -t filters by test name.
      if (looksLikePath(filter)) args.push(filter);
      else args.push('-t', filter);
      break;
    case 'jest':
      if (looksLikePath(filter)) args.push('--testPathPattern', filter);
      else args.push('-t', filter);
      break;
    case 'pytest':
      if (looksLikePath(filter)) args.push(filter);
      else args.push('-k', filter);
      break;
    default:
      if (plan.command === 'npm') args.push('--', filter);
      else args.push(filter);
  }
  return { ...plan, args };
}

/**
 * Build the command for a test run.
 * - `fixedCommand` (remote TEST_COMMANDS or local TEST_COMMAND) is used verbatim, plus the filter.
 * - Otherwise auto-detect vitest → jest → pytest → `npm test`, preferring machine-readable output.
 */
export function planTestRun(
  root: string,
  reportDir: string,
  filter?: string,
  fixedCommand?: string,
): TestPlan {
  if (fixedCommand) {
    const argv = splitCommand(fixedCommand);
    return applyFilter(
      { runner: detectRunnerFromArgs(argv), command: argv[0]!, args: argv.slice(1) },
      filter,
    );
  }

  const pkg = readPackageJson(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (pkg && 'vitest' in deps) {
    const reportFile = path.join(reportDir, 'vitest-report.json');
    const r = jsRunner(root, 'vitest');
    return applyFilter(
      {
        runner: 'vitest',
        command: r.command,
        args: [...r.args, 'run', '--reporter=json', `--outputFile=${reportFile}`],
        reportFile,
      },
      filter,
    );
  }
  if (pkg && 'jest' in deps) {
    const reportFile = path.join(reportDir, 'jest-report.json');
    const r = jsRunner(root, 'jest');
    return applyFilter(
      {
        runner: 'jest',
        command: r.command,
        args: [...r.args, '--json', `--outputFile=${reportFile}`],
        reportFile,
      },
      filter,
    );
  }
  if (isPytestProject(root)) {
    const reportFile = path.join(reportDir, 'pytest-report.xml');
    return applyFilter(
      { runner: 'pytest', command: 'pytest', args: [`--junitxml=${reportFile}`, '-q'], reportFile },
      filter,
    );
  }
  if (pkg?.scripts?.test) {
    return applyFilter({ runner: 'raw', command: 'npm', args: ['test', '--silent'] }, filter);
  }
  throw new ToolError(
    'Could not detect a test runner (looked for vitest, jest, pytest, and an npm "test" script). ' +
      'Set TEST_COMMAND to configure one.',
  );
}
