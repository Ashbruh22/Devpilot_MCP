import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planTestRun, validateFilter } from '../src/lib/testCommand.js';
import { RunStore } from '../src/lib/runStore.js';
import { SAMPLE_REPO } from './helpers.js';

function tmpProject(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'devpilot-plan-'));
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), c);
  }
  return dir;
}

describe('test command planning', () => {
  it('detects vitest and uses the locally installed binary (never downloads)', () => {
    const plan = planTestRun(SAMPLE_REPO, '/tmp/r', undefined);
    expect(plan.runner).toBe('vitest');
    expect(plan.command).toMatch(/node_modules\/\.bin\/vitest$/);
    expect(plan.args).toEqual(['run', '--reporter=json', '--outputFile=/tmp/r/vitest-report.json']);
  });

  it('falls back to npx --no when vitest is not installed locally', () => {
    const root = tmpProject({ 'package.json': JSON.stringify({ devDependencies: { vitest: '1' } }) });
    const plan = planTestRun(root, '/tmp/r');
    expect([plan.command, ...plan.args.slice(0, 2)]).toEqual(['npx', '--no', 'vitest']);
  });

  it('maps filters to runner flags', () => {
    expect(planTestRun(SAMPLE_REPO, '/r', 'pricing rounding').args.slice(-2)).toEqual([
      '-t',
      'pricing rounding',
    ]);
    expect(planTestRun(SAMPLE_REPO, '/r', 'src/pricing.test.ts').args.at(-1)).toBe('src/pricing.test.ts');
  });

  it('detects jest, pytest and npm test', () => {
    expect(
      planTestRun(tmpProject({ 'package.json': '{"devDependencies":{"jest":"29"}}' }), '/r').args,
    ).toContain('--json');
    const py = planTestRun(
      tmpProject({ 'pyproject.toml': '[tool.pytest.ini_options]\n' }),
      '/r',
      'test_dates',
    );
    expect([py.command, ...py.args]).toEqual([
      'pytest',
      '--junitxml=/r/pytest-report.xml',
      '-q',
      '-k',
      'test_dates',
    ]);
    const npm = planTestRun(tmpProject({ 'package.json': '{"scripts":{"test":"node t.js"}}' }), '/r', 'x');
    expect([npm.command, ...npm.args]).toEqual(['npm', 'test', '--silent', '--', 'x']);
    expect(() => planTestRun(tmpProject({ 'a.txt': '' }), '/r')).toThrow(/Could not detect a test runner/);
  });

  it('uses a fixed command verbatim (remote mode) and detects its runner', () => {
    const plan = planTestRun(SAMPLE_REPO, '/r', 'pricing', 'npx vitest run --reporter=json');
    expect(plan).toMatchObject({
      runner: 'vitest',
      command: 'npx',
      args: ['vitest', 'run', '--reporter=json', '-t', 'pricing'],
    });
    expect(plan.reportFile).toBeUndefined();
  });

  it('validates filters', () => {
    expect(validateFilter('src/pricing.test.ts')).toBe('src/pricing.test.ts');
    expect(validateFilter(undefined)).toBeUndefined();
    for (const bad of [
      '--config=evil.js',
      '-t x',
      'a;rm -rf',
      '$(id)',
      '../../etc',
      'x'.repeat(101),
      'a|b',
    ]) {
      expect(() => validateFilter(bad), bad).toThrow();
    }
  });
});

describe('RunStore', () => {
  it('evicts the least recently used run beyond capacity', () => {
    const store = new RunStore(2);
    const mk = (id: string) => ({ run_id: id }) as never;
    store.put(mk('run_a'));
    store.put(mk('run_b'));
    store.get('run_a'); // refresh a
    store.put(mk('run_c'));
    expect(store.ids()).toEqual(['run_a', 'run_c']);
    expect(store.get('run_b')).toBeUndefined();
  });
});
