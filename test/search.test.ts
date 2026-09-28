import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchCodebase } from '../src/lib/search.js';
import { tmpCopyOfSampleRepo } from './helpers.js';

describe('searchCodebase', () => {
  let root: string;
  let cleanup: () => void;
  beforeAll(() => {
    ({ root, cleanup } = tmpCopyOfSampleRepo());
    writeFileSync(path.join(root, '.gitignore'), 'ignored/\n');
    mkdirSync(path.join(root, 'ignored'));
    writeFileSync(path.join(root, 'ignored', 'x.ts'), 'applyDiscount in ignored dir');
    mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'applyDiscount in deps');
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(path.join(root, 'dist', 'pricing.js'), 'applyDiscount in dist');
    writeFileSync(path.join(root, 'package-lock.json'), '{"applyDiscount": true}');
    writeFileSync(path.join(root, 'blob.bin'), Buffer.from([0, 1, 2, ...Buffer.from('applyDiscount'), 0, 0]));
  });
  afterAll(() => cleanup());

  const base = { isRegex: false, maxResults: 30, contextLines: 2 };

  it('finds literal matches with context and relative paths', async () => {
    const r = await searchCodebase(root, { ...base, query: 'Math.floor(' });
    expect(r.total_matches).toBe(1);
    expect(r.matches[0]).toMatchObject({ path: 'src/pricing.ts', line: 11 });
    expect(r.matches[0]!.preview).toContain('Math.floor(discounted * 100)');
    expect(r.matches[0]!.context_before).toEqual([
      '  assertValidPercent(percent);',
      '  const discounted = amount * (1 - percent / 100);',
    ]);
    expect(r.matches[0]!.context_after).toEqual(['}']);
  });

  it('skips .gitignored files, node_modules, dist, lockfiles and binaries', async () => {
    const r = await searchCodebase(root, { ...base, query: 'applyDiscount' });
    const files = new Set(r.matches.map((m) => m.path));
    expect([...files].sort()).toEqual(['README.md', 'src/pricing.test.ts', 'src/pricing.ts']);
  });

  it('supports regex, globs, and result caps', async () => {
    const r = await searchCodebase(root, {
      ...base,
      query: 'apply\\w+\\(',
      isRegex: true,
      pathGlob: '*.test.ts',
      maxResults: 2,
    });
    expect(r.matches).toHaveLength(2);
    expect(r.total_matches).toBeGreaterThan(2);
    expect(r.truncated).toBe(true);
    expect(r.matches.every((m) => m.path.endsWith('.test.ts'))).toBe(true);
  });

  it('treats regex metacharacters literally by default', async () => {
    const r = await searchCodebase(root, { ...base, query: '(1 - percent / 100)' });
    expect(r.total_matches).toBe(1);
  });

  it('never treats the query as a flag', async () => {
    const r = await searchCodebase(root, { ...base, query: '--files' });
    expect(r.total_matches).toBe(0);
  });

  it('reports invalid regexes clearly', async () => {
    await expect(searchCodebase(root, { ...base, query: '(unclosed', isRegex: true })).rejects.toThrow(
      /Invalid regex/,
    );
  });

  it('rejects unsafe globs', async () => {
    await expect(searchCodebase(root, { ...base, query: 'x', pathGlob: '../**' })).rejects.toThrow(/\.\./);
  });
});
