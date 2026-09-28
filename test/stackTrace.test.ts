import { describe, expect, it } from 'vitest';
import {
  isProjectFrame,
  isTestFile,
  normalizeFramePath,
  parseStackFrames,
} from '../src/lib/parsers/stackTrace.js';
import { fixture } from './helpers.js';

describe('stackTrace', () => {
  it('parses Node/V8 traces', () => {
    const frames = parseStackFrames(fixture('traces/node.txt'));
    expect(frames[0]).toEqual({
      file: '/app/src/components/list.js',
      line: 42,
      column: 17,
      function: 'renderItems',
    });
    expect(frames[1]).toMatchObject({ file: '/app/src/server.js', line: 10, function: 'Server.handle' });
    expect(frames.find((f) => f.file === 'file:///app/src/index.mjs')).toMatchObject({ line: 3 });
    // "new Promise (<anonymous>)" has no location and is skipped
    expect(frames.some((f) => f.file.includes('anonymous'))).toBe(false);
  });

  it('parses browser (Firefox/Safari) traces', () => {
    const frames = parseStackFrames(fixture('traces/browser.txt'));
    expect(frames[0]).toEqual({
      file: 'http://localhost:5173/src/cart.ts',
      line: 18,
      column: 11,
      function: 'renderCart',
    });
    expect(frames[1]).toMatchObject({ file: 'http://localhost:5173/src/main.ts', line: 4 });
    expect(normalizeFramePath(frames[0]!.file)).toBe('src/cart.ts');
  });

  it('parses Python tracebacks', () => {
    const frames = parseStackFrames(fixture('traces/python.txt'));
    expect(frames[0]).toEqual({ file: '/srv/app/main.py', line: 12, function: '<module>' });
    expect(frames[1]).toEqual({
      file: '/srv/app/services/billing.py',
      line: 88,
      function: 'compute_invoice',
    });
    expect(frames).toHaveLength(3);
  });

  it('normalizes paths relative to a root', () => {
    expect(normalizeFramePath('/app/src/x.ts', '/app')).toBe('src/x.ts');
    expect(normalizeFramePath('file:///app/src/x.ts', '/app')).toBe('src/x.ts');
    expect(normalizeFramePath('webpack:///./src/x.ts')).toBe('src/x.ts');
    expect(normalizeFramePath('/elsewhere/x.ts', '/app')).toBe('/elsewhere/x.ts');
  });

  it('classifies project vs dependency frames', () => {
    expect(isProjectFrame('src/x.ts')).toBe(true);
    expect(isProjectFrame('node_modules/express/index.js')).toBe(false);
    expect(isProjectFrame('node:internal/process/task_queues')).toBe(false);
    expect(isProjectFrame('/usr/lib/python3.12/site-packages/x.py')).toBe(false);
    expect(isProjectFrame('/abs/outside.ts')).toBe(false);
  });

  it('recognizes test files', () => {
    for (const f of [
      'src/a.test.ts',
      'src/__tests__/a.js',
      'tests/test_a.py',
      'pkg/a_test.py',
      'b.spec.tsx',
    ]) {
      expect(isTestFile(f)).toBe(true);
    }
    for (const f of ['src/a.ts', 'app/pricing.py', 'src/testing-utils.ts']) {
      expect(isTestFile(f)).toBe(false);
    }
  });
});
