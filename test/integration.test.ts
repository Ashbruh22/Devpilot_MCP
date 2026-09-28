import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import nock from 'nock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeps, createServer } from '../src/server.js';
import { mockGitHub } from './github-mock.js';
import { FIXTURES, testConfig } from './helpers.js';

type Structured = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function connect(env: Record<string, string> = {}) {
  const deps = createDeps(testConfig({ GITHUB_TOKEN: 'test-token', ...env }));
  const server = createServer(deps);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    return { isError: Boolean(res.isError), text, data: res.structuredContent as Structured };
  };
  return { client, call, deps };
}

describe('MCP integration (in-memory client ↔ server, fixture repo)', () => {
  let ctx: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    nock.disableNetConnect();
    mockGitHub();
    ctx = await connect();
  });
  afterAll(async () => {
    await ctx.client.close();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('lists the six tools, each with input and output schemas', async () => {
    const { tools } = await ctx.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'analyze_issue',
      'get_docs',
      'get_issue',
      'run_tests',
      'search_codebase',
      'summarize_test_failures',
    ]);
    for (const t of tools) {
      expect(t.description?.length).toBeGreaterThan(40);
      expect(t.outputSchema).toBeDefined();
      for (const prop of Object.values(t.inputSchema.properties ?? {})) {
        expect((prop as { description?: string }).description, `${t.name} field description`).toBeTruthy();
      }
    }
  });

  it('get_issue returns the issue, comments, and linked PRs', async () => {
    const r = await ctx.call('get_issue', { owner: 'acme', repo: 'shop', issue_number: 7 });
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({
      number: 7,
      title: 'applyDiscount returns 6.69 instead of 6.70',
      state: 'open',
      labels: ['bug'],
      author: 'reporter',
      total_comments: 2,
      url: 'https://github.com/acme/shop/issues/7',
    });
    expect(r.data.comments).toHaveLength(2);
    expect(r.data.comments[0]).toMatchObject({ author: 'dev1' });
    expect(r.data.linked_prs).toEqual([
      {
        number: 8,
        title: 'Round discounts to cents',
        state: 'open',
        url: 'https://github.com/acme/shop/pull/8',
        repo: 'acme/shop',
      },
    ]);
    expect(r.text).toMatch(/^#7 "applyDiscount returns/);
  });

  it('get_issue reports a missing issue actionably', async () => {
    const r = await ctx.call('get_issue', { owner: 'acme', repo: 'shop', issue_number: 99 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Issue #99 not found in acme\/shop/);
    expect(r.text).not.toMatch(/at \w+ \(/); // no stack traces leak
  });

  it('get_issue explains rate limiting', async () => {
    const r = await ctx.call('get_issue', { owner: 'acme', repo: 'shop', issue_number: 5 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/rate limit exhausted; resets in ~\d+ min/);
  });

  it('validates tool input', async () => {
    const r = await ctx.call('get_issue', { owner: 'acme', repo: 'shop', issue_number: -1 });
    expect(r.isError).toBe(true);
  });

  it('runs the whole triage loop', async () => {
    // 1. analyze
    const a = await ctx.call('analyze_issue', { owner: 'acme', repo: 'shop', issue_number: 7 });
    expect(a.isError).toBe(false);
    expect(a.data.type_guess).toBe('bug');
    expect(a.data.suggested_search_queries[0]).toBe('applyDiscount');
    // The reporter's /home/me/shop/src/pricing.ts frame is mapped onto the workspace.
    expect(a.data.mentioned_paths).toContain('src/pricing.ts');
    expect(a.data.stack_frames[0]).toMatchObject({ file: 'src/pricing.ts', line: 11 });

    // 2. search for the top suggestion
    const s = await ctx.call('search_codebase', {
      query: a.data.suggested_search_queries[0],
      path_glob: 'src/**',
    });
    expect(s.data.matches.map((m: Structured) => m.path)).toContain('src/pricing.ts');

    // 3. docs
    const d = await ctx.call('get_docs', { topic: 'rounding' });
    expect(d.data.sections[0]).toMatchObject({ path: 'docs/rounding.md', heading: 'Rounding rules' });
    expect(d.data.sections.length).toBeLessThanOrEqual(3);

    // 4. run tests
    const t = await ctx.call('run_tests', {});
    expect(t.isError).toBe(false);
    expect(t.data).toMatchObject({
      runner: 'vitest',
      passed: 2,
      failed: 3,
      skipped: 1,
      timed_out: false,
      exit_code: 1,
    });
    expect(t.data.run_id).toMatch(/^run_/);
    expect(t.data.command).toContain('vitest run --reporter=json');
    expect(t.data.command).not.toContain(process.env.HOME ?? '/root/');

    // 5. summarize
    const f = await ctx.call('summarize_test_failures', { run_id: t.data.run_id });
    expect(f.isError).toBe(false);
    expect(f.data.total_failures).toBe(3);
    expect(f.data.groups[0]).toMatchObject({ count: 2, likely_source_files: ['src/pricing.ts'] });
    const fmt = f.data.failures.find((x: Structured) => x.file === 'src/format.test.ts');
    expect(fmt).toMatchObject({ likely_source_files: ['src/format.ts'], source_hint: 'stack' });
    expect(fmt.top_frames[0]).toMatchObject({ file: 'src/format.ts', line: 7, function: 'formatPrice' });
    expect(f.text).toMatch(/Likely source files: src\/pricing\.ts, src\/format\.ts/);
  });

  it('run_tests honors a file filter', async () => {
    const t = await ctx.call('run_tests', { filter: 'src/format.test.ts' });
    expect(t.data).toMatchObject({ passed: 1, failed: 1 });
  });

  it('run_tests rejects unsafe filters', async () => {
    for (const filter of ['--config=/tmp/evil.js', 'x; rm -rf /']) {
      const r = await ctx.call('run_tests', { filter });
      expect(r.isError, filter).toBe(true);
    }
  });

  it('summarize_test_failures rejects unknown runs', async () => {
    const r = await ctx.call('summarize_test_failures', { run_id: 'run_nope' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Unknown run_id/);
  });

  it('get_docs guards paths', async () => {
    for (const p of ['../../package.json', '/etc/passwd', 'src/pricing.ts']) {
      const r = await ctx.call('get_docs', { path: p });
      expect(r.isError, p).toBe(true);
    }
    const ok = await ctx.call('get_docs', { path: 'CONTRIBUTING.md', topic: 'tests' });
    expect(ok.data.sections).toEqual([
      { path: 'CONTRIBUTING.md', heading: 'Running tests', content: expect.stringContaining('npm test') },
    ]);
  });

  it('serves the triage_issue prompt', async () => {
    const { prompts } = await ctx.client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('triage_issue');
    const p = await ctx.client.getPrompt({
      name: 'triage_issue',
      arguments: { owner: 'acme', repo: 'shop', issue_number: '7' },
    });
    const text = (p.messages[0]!.content as { text: string }).text;
    for (const step of [
      'get_issue',
      'analyze_issue',
      'search_codebase',
      'run_tests',
      'summarize_test_failures',
    ]) {
      expect(text).toContain(step);
    }
    expect(text.indexOf('get_issue')).toBeLessThan(text.indexOf('summarize_test_failures'));
  });
});

describe('limits', () => {
  it('kills a hanging test run at TEST_TIMEOUT_MS', async () => {
    const { call, client } = await connect({
      TEST_COMMAND: `node ${path.join(FIXTURES, 'hang.mjs')}`,
      TEST_TIMEOUT_MS: '1500',
    });
    const t = await call('run_tests', {});
    expect(t.data.timed_out).toBe(true);
    expect(t.data.duration_ms).toBeLessThan(6_000);
    expect(t.text).toMatch(/^TIMED OUT/);
    await client.close();
  });

  it('caps every text response at MAX_OUTPUT_CHARS', async () => {
    const { call, client } = await connect({ MAX_OUTPUT_CHARS: '1000' });
    const r = await call('search_codebase', { query: 'e', max_results: 200, context_lines: 10 });
    expect(r.text.length).toBeLessThanOrEqual(1000 + 40);
    await client.close();
  });

  it('rejects a second concurrent test run for the same repo', async () => {
    const { call, client } = await connect({
      TEST_COMMAND: `node ${path.join(FIXTURES, 'hang.mjs')}`,
      TEST_TIMEOUT_MS: '2000',
    });
    const first = call('run_tests', {});
    await new Promise((r) => setTimeout(r, 200));
    const second = await call('run_tests', {});
    expect(second.isError).toBe(true);
    expect(second.text).toMatch(/busy, retry in \d+ s/);
    await first;
    await client.close();
  });
});
