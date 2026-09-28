import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('config', () => {
  it('defaults to local mode with sane limits', () => {
    const c = loadConfig({ WORKSPACE_ROOT: '/tmp' });
    expect(c).toMatchObject({
      mode: 'local',
      port: 3000,
      testTimeoutMs: 120_000,
      maxOutputChars: 20_000,
      host: '127.0.0.1',
    });
    expect(c.workspaceRoot).toBe('/tmp');
  });

  it('parses remote settings', () => {
    const c = loadConfig({
      DEVPILOT_MODE: 'remote',
      ALLOWED_REPOS: 'Ashbruh22/devpilot-demo@main, octo/other',
      TEST_COMMANDS: '{"Ashbruh22/devpilot-demo":"npx vitest run --reporter=json"}',
      RENDER_EXTERNAL_HOSTNAME: 'devpilot.onrender.com',
    });
    expect(c.allowedRepos).toEqual([
      { owner: 'Ashbruh22', repo: 'devpilot-demo', ref: 'main', key: 'ashbruh22/devpilot-demo' },
      { owner: 'octo', repo: 'other', key: 'octo/other' },
    ]);
    expect(c.testCommands['ashbruh22/devpilot-demo']).toBe('npx vitest run --reporter=json');
    expect(c.host).toBe('0.0.0.0');
    expect(c.allowedHosts).toContain('devpilot.onrender.com');
    expect(c.trustProxy).toBe(true);
  });

  it('parses subfolder workspaces', () => {
    const c = loadConfig({
      DEVPILOT_MODE: 'remote',
      ALLOWED_REPOS: 'Ashbruh22/Devpilot_MCP@main:demo/devpilot-demo',
    });
    expect(c.allowedRepos[0]).toEqual({
      owner: 'Ashbruh22',
      repo: 'Devpilot_MCP',
      ref: 'main',
      key: 'ashbruh22/devpilot_mcp',
      subdir: 'demo/devpilot-demo',
    });
    expect(() => loadConfig({ ALLOWED_REPOS: 'a/b@main:../etc' })).toThrow(/without "\.\."/);
    expect(() => loadConfig({ ALLOWED_REPOS: 'a/b@main,a/b@dev' })).toThrow(/more than once/);
  });

  it('fails fast with clear errors', () => {
    expect(() => loadConfig({ DEVPILOT_MODE: 'cloud' })).toThrow(ConfigError);
    expect(() => loadConfig({ DEVPILOT_MODE: 'remote' })).toThrow(/ALLOWED_REPOS: required in remote mode/);
    expect(() => loadConfig({ ALLOWED_REPOS: 'not a repo' })).toThrow(/owner\/repo@ref/);
    expect(() => loadConfig({ TEST_COMMANDS: '{nope' })).toThrow(/TEST_COMMANDS must be a JSON object/);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() =>
      loadConfig({ DEVPILOT_MODE: 'remote', ALLOWED_REPOS: 'a/b', TEST_COMMANDS: '{"c/d":"npm test"}' }),
    ).toThrow(/keys not in ALLOWED_REPOS: c\/d/);
  });
});
