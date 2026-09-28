import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSafeGlob, isSafeRelative, resolveInside } from '../src/lib/pathGuard.js';
import { tmpCopyOfSampleRepo } from './helpers.js';

describe('pathGuard', () => {
  let root: string;
  let cleanup: () => void;
  beforeAll(() => {
    ({ root, cleanup } = tmpCopyOfSampleRepo());
    const outside = path.join(root, '..', 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, path.join(root, 'escape-link'));
    symlinkSync(path.join(root, 'src'), path.join(root, 'inside-link'));
  });
  afterAll(() => cleanup());

  it('resolves normal relative paths', () => {
    expect(resolveInside(root, 'src/pricing.ts').rel).toBe('src/pricing.ts');
    expect(resolveInside(root, './docs/../README.md').rel).toBe('README.md');
  });

  it.each(['../outside/secret.txt', 'src/../../outside', '..', 'docs/../../../etc/passwd'])(
    'rejects traversal: %s',
    (p) => {
      expect(() => resolveInside(root, p)).toThrow(/escapes the workspace root/);
    },
  );

  it('rejects absolute paths', () => {
    expect(() => resolveInside(root, '/etc/passwd')).toThrow(/Absolute paths are not allowed/);
    expect(() => resolveInside(root, 'C:\\Windows\\system.ini')).toThrow(/Absolute paths/);
  });

  it('rejects symlinks that escape the root', () => {
    expect(() => resolveInside(root, 'escape-link/secret.txt')).toThrow(/symlink/);
    expect(() => resolveInside(root, 'escape-link')).toThrow(/symlink/);
  });

  it('allows symlinks that stay inside the root', () => {
    expect(resolveInside(root, 'inside-link/pricing.ts').rel).toBe('inside-link/pricing.ts');
  });

  it('rejects NUL bytes and empty paths', () => {
    expect(() => resolveInside(root, 'a\0b')).toThrow(/NUL/);
    expect(() => resolveInside(root, '')).toThrow();
  });

  it('isSafeRelative is a non-throwing check', () => {
    expect(isSafeRelative(root, 'src/format.ts')).toBe(true);
    expect(isSafeRelative(root, '../x')).toBe(false);
  });

  it('validates globs', () => {
    expect(() => assertSafeGlob('src/**/*.ts')).not.toThrow();
    expect(() => assertSafeGlob('../**/*')).toThrow();
    expect(() => assertSafeGlob('/etc/*')).toThrow();
    expect(() => assertSafeGlob('--pre=sh')).toThrow();
  });
});
