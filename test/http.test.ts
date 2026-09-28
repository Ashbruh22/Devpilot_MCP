import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { startHttpServer, type RunningHttpServer } from '../src/http.js';
import { testConfig } from './helpers.js';

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'curl', version: '1' } },
};

async function start(env: Record<string, string> = {}): Promise<RunningHttpServer> {
  return startHttpServer(testConfig({ PORT: '0', HOST: '127.0.0.1', ...env }));
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('HTTP transport', () => {
  let running: RunningHttpServer | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  it('serves /healthz and the landing page', async () => {
    running = await start();
    const h = await fetch(`${running.url}/healthz`);
    expect(h.status).toBe(200);
    const body = (await h.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'ok', mode: 'local', auth: 'public' });
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime).toBe('number');

    const page = await fetch(`${running.url}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    expect(await page.text()).toContain('DevPilot');
  });

  it('speaks MCP over Streamable HTTP to a real client', async () => {
    running = await start();
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${running.url}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
    const res = await client.callTool({
      name: 'search_codebase',
      arguments: { query: 'applyDiscount', path_glob: 'src/*.ts' },
    });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { total_matches: number }).total_matches).toBeGreaterThan(0);
    await client.close();
  });

  it('answers a raw legacy initialize POST (stateless)', async () => {
    running = await start();
    const r = await post(running.url, INIT);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('devpilot-mcp');
  });

  it('requires the bearer token when DEVPILOT_API_KEY is set', async () => {
    running = await start({ DEVPILOT_API_KEY: 'sekret-key' });
    const noAuth = await post(running.url, INIT);
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get('www-authenticate')).toMatch(/^Bearer/);

    const wrong = await post(running.url, INIT, { authorization: 'Bearer nope' });
    expect(wrong.status).toBe(401);

    const ok = await post(running.url, INIT, { authorization: 'Bearer sekret-key' });
    expect(ok.status).toBe(200);

    // Health and landing page stay public.
    expect((await fetch(`${running.url}/healthz`)).status).toBe(200);

    const client = new Client({ name: 'http-auth', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${running.url}/mcp`), {
        requestInit: { headers: { Authorization: 'Bearer sekret-key' } },
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(6);
    await client.close();
  });

  it('rate-limits /mcp per IP', async () => {
    running = await start({ RATE_LIMIT_PER_MIN: '3' });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await post(running.url, INIT)).status);
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
    expect(statuses[4]).toBe(429);
    // The limiter only covers /mcp.
    expect((await fetch(`${running.url}/healthz`)).status).toBe(200);
  });

  it('answers CORS preflights with MCP headers', async () => {
    running = await start();
    const r = await fetch(`${running.url}/mcp`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:6274', 'access-control-request-method': 'POST' }, // MCP Inspector
    });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-headers')).toMatch(/Mcp-Protocol-Version/);
    expect(r.headers.get('access-control-expose-headers')).toMatch(/Mcp-Session-Id/);
  });

  it('rejects foreign browser Origins on a localhost bind', async () => {
    running = await start();
    const r = await post(running.url, INIT, { origin: 'https://evil.example.com' });
    expect(r.status).toBe(403);
  });

  it('rejects foreign Host headers on a localhost bind (DNS rebinding protection)', async () => {
    running = await start();
    const { request } = await import('node:http');
    const port = new URL(running.url).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          headers: { host: 'evil.example.com', 'content-type': 'application/json' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(INIT));
    });
    expect(status).toBe(403);
  });

  it('rejects oversized bodies', async () => {
    running = await start();
    const r = await post(running.url, { ...INIT, pad: 'x'.repeat(1_100_000) });
    expect(r.status).toBe(413);
  });
});
