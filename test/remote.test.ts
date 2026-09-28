import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import nock from 'nock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createDeps, createServer } from '../src/server.js';
import { mockGitHub } from './github-mock.js';
import { SAMPLE_REPO } from './helpers.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const VITEST_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'vitest');

/** Build a bare git remote at <base>/acme/shop.git from the sample fixture. */
function makeRemote(): string {
  const base = mkdtempSync(path.join(os.tmpdir(), 'devpilot-remote-'));
  const work = path.join(base, 'work');
  cpSync(SAMPLE_REPO, work, { recursive: true });
  const git = (args: string[], cwd: string) =>
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args],
      {
        cwd,
        stdio: 'ignore',
      },
    );
  git(['init', '-q'], work);
  git(['add', '-A'], work);
  git(['commit', '-qm', 'init'], work);
  mkdirSync(path.join(base, 'acme'));
  git(['clone', '-q', '--bare', work, path.join(base, 'acme', 'shop.git')], base);
  return base;
}

type Structured = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('remote mode', () => {
  let remoteBase: string;
  // Inside the repo so the clone can resolve `vitest` from our node_modules.
  const workspacesDir = path.join(REPO_ROOT, 'test', '.workspaces', `run-${process.pid}`);
  let client: Client;
  let call: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ isError: boolean; text: string; data: Structured }>;
  let deps: ReturnType<typeof createDeps>;

  beforeAll(async () => {
    nock.disableNetConnect();
    mockGitHub();
    remoteBase = makeRemote();
    const config = loadConfig({
      DEVPILOT_MODE: 'remote',
      ALLOWED_REPOS: 'acme/shop@main',
      TEST_COMMANDS: JSON.stringify({ 'acme/shop': `${VITEST_BIN} run --reporter=json` }),
      GIT_BASE_URL: `file://${remoteBase}`,
      WORKSPACES_DIR: workspacesDir,
      INSTALL_DEPS: 'false',
      GITHUB_TOKEN: 'test-token',
    });
    deps = createDeps(config);
    await deps.workspaces.prepareAll();
    const server = createServer(deps);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: 'remote-test', version: '1' });
    await client.connect(ct);
    call = async (name, args) => {
      const res = await client.callTool({ name, arguments: args });
      return {
        isError: Boolean(res.isError),
        text: (res.content as Array<{ text: string }>)[0]?.text ?? '',
        data: res.structuredContent as Structured,
      };
    };
  });

  afterAll(async () => {
    await client?.close();
    nock.cleanAll();
    nock.enableNetConnect();
    rmSync(remoteBase, { recursive: true, force: true });
    rmSync(workspacesDir, { recursive: true, force: true });
  });

  it('shallow-clones allowlisted repos at boot', () => {
    const [ws] = deps.workspaces.list();
    expect(ws).toMatchObject({ key: 'acme/shop', name: 'acme/shop', status: 'ready' });
    expect(ws!.root).toBe(path.join(workspacesDir, 'acme__shop'));
    const depth = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: ws!.root }).toString().trim();
    expect(depth).toBe('1');
  });

  it('searches and reads docs in the cloned workspace', async () => {
    const s = await call('search_codebase', { query: 'Math.floor' });
    expect(s.data.workspace).toBe('acme/shop');
    expect(s.data.matches[0].path).toBe('src/pricing.ts');
    const d = await call('get_docs', { topic: 'rounding', repo: 'acme/shop' });
    expect(d.data.sections[0].path).toBe('docs/rounding.md');
  });

  it('runs only the fixed configured command and parses its stdout JSON', async () => {
    const t = await call('run_tests', {});
    expect(t.isError).toBe(false);
    expect(t.data).toMatchObject({
      runner: 'vitest',
      passed: 2,
      failed: 3,
      skipped: 1,
      structured_report: true,
    });
    expect(t.data.command).toBe(`${VITEST_BIN} run --reporter=json`);
    const f = await call('summarize_test_failures', { run_id: t.data.run_id });
    expect(f.data.groups[0].likely_source_files).toEqual(['src/pricing.ts']);
  });

  it('rejects repos that are not allowlisted', async () => {
    const s = await call('search_codebase', { query: 'x', repo: 'evil/repo' });
    expect(s.isError).toBe(true);
    expect(s.text).toMatch(/not allowlisted.*Allowed: acme\/shop/);

    const i = await call('get_issue', { owner: 'torvalds', repo: 'linux', issue_number: 1 });
    expect(i.isError).toBe(true);
    expect(i.text).toMatch(/not allowlisted/);

    const t = await call('run_tests', { repo: 'evil/repo' });
    expect(t.isError).toBe(true);
  });

  it('defaults issue tools to the single allowlisted repo', async () => {
    const i = await call('get_issue', { issue_number: 7 });
    expect(i.isError).toBe(false);
    expect(i.data).toMatchObject({ owner: 'acme', repo: 'shop', number: 7 });
    const ok = await call('get_issue', { owner: 'ACME', repo: 'Shop', issue_number: 7 });
    expect(ok.isError).toBe(false); // allowlist match is case-insensitive
  });

  it('reports workspaces that failed to prepare', async () => {
    const bad = createDeps(
      loadConfig({
        DEVPILOT_MODE: 'remote',
        ALLOWED_REPOS: 'acme/missing@main,acme/shop@main',
        GIT_BASE_URL: `file://${remoteBase}`,
        WORKSPACES_DIR: path.join(workspacesDir, 'bad'),
        INSTALL_DEPS: 'false',
      }),
    );
    await bad.workspaces.prepareAll();
    expect(() => bad.workspaces.resolve('acme/missing')).toThrow(/failed to prepare: git clone failed/);
    expect(() => bad.workspaces.resolve()).toThrow(/Specify "repo"/);
    expect(bad.workspaces.resolve('acme/shop').status).toBe('ready');
  });
});
