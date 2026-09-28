import { describe, expect, it } from 'vitest';
import { listDocFiles, scoreSection, splitSections, tokenize } from '../src/lib/docs.js';
import { SAMPLE_REPO } from './helpers.js';

describe('docs index', () => {
  it('lists README, CONTRIBUTING and docs/**', () => {
    expect(listDocFiles(SAMPLE_REPO)).toEqual([
      'README.md',
      'CONTRIBUTING.md',
      'docs/rounding.md',
      'docs/setup.md',
    ]);
  });

  it('splits markdown by headings, ignoring # inside code fences', () => {
    const md = '# Title\nintro\n```sh\n# not a heading\n```\n## Part\nbody';
    const s = splitSections('x.md', md);
    expect(s.map((x) => x.heading)).toEqual(['Title', 'Part']);
    expect(s[0]!.content).toContain('# not a heading');
  });

  it('ranks heading hits above body hits', () => {
    const terms = tokenize('how do I configure rounding');
    expect(terms).toEqual(['configure', 'rounding']);
    const a = scoreSection({ path: 'a', heading: 'Rounding rules', level: 1, content: 'x' }, terms);
    const b = scoreSection({ path: 'b', heading: 'Other', level: 1, content: 'rounding' }, terms);
    expect(a).toBeGreaterThan(b);
  });
});
