import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Express, NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ConfigError, loadConfig, type Config } from './config.js';
import { errorMessage } from './lib/errors.js';
import { log } from './lib/logger.js';
import { VERSION } from './lib/version.js';
import { createDeps, createServer, type ServerDeps } from './server.js';

const startedAt = Date.now();

function loadLandingPage(): string {
  try {
    return readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
  } catch {
    return `<!doctype html><title>DevPilot MCP</title><p>DevPilot MCP ${VERSION}. POST MCP requests to <code>/mcp</code>.</p>`;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Bearer-token check for /mcp. Only installed when DEVPILOT_API_KEY is set. */
function bearerAuth(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m || !safeEqual(m[1]!.trim(), apiKey)) {
      res
        .status(401)
        .set('WWW-Authenticate', 'Bearer realm="devpilot-mcp"')
        .json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized: missing or invalid bearer token' },
          id: null,
        });
      return;
    }
    next();
  };
}

/**
 * CORS for browser-based MCP clients: allow the MCP headers in, expose the ones clients
 * need to read (session id / protocol version), and answer preflights.
 */
function cors(origin: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.set('Access-Control-Allow-Origin', origin);
    if (origin !== '*') res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID',
    );
    res.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate');
    res.set('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/healthz') return;
    log.info('http', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
      ip: req.ip,
    });
  });
  next();
}

export function createHttpApp(config: Config, deps: ServerDeps = createDeps(config)): Express {
  // The SDK helper adds express.json and Host-header validation (DNS-rebinding protection)
  // for localhost binds, or for the explicit allowedHosts list on public binds.
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts.length ? config.allowedHosts : undefined,
    jsonLimit: '1mb',
  });
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1); // Render/Fly terminate TLS in front of us

  app.use(requestLogger);

  const landing = loadLandingPage();
  app.get('/', (_req, res) => {
    res.type('html').set('Cache-Control', 'public, max-age=300').send(landing);
  });

  app.get('/healthz', (_req, res) => {
    const workspaces = deps.workspaces.list().map((w) => ({ repo: w.name, status: w.status }));
    res.json({
      status: 'ok',
      version: VERSION,
      uptime: Math.round((Date.now() - startedAt) / 1000),
      mode: config.mode,
      auth: config.apiKey ? 'bearer' : 'public',
      ...(config.mode === 'remote' ? { workspaces } : {}),
    });
  });

  const mcpHandler = createMcpHandler(() => createServer(deps), {
    onerror: (err) => log.warn('mcp handler error', { error: err.message }),
    maxRequestBodySize: 1024 * 1024,
  });
  const nodeHandler = toNodeHandler(mcpHandler, {
    onerror: (err) => log.error('mcp adapter error', { error: err.message }),
    maxRequestBodySize: 1024 * 1024,
  });

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMin,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: `Rate limit exceeded (${config.rateLimitPerMin} requests/min). Retry shortly.`,
        },
        id: null,
      });
    },
  });

  const mcpChain = [cors(config.corsOrigin), limiter];
  if (config.apiKey) mcpChain.push(bearerAuth(config.apiKey));
  app.options('/mcp', cors(config.corsOrigin));
  // Stateless Streamable HTTP: POST carries requests; GET/DELETE get the SDK's own answer (405 for legacy).
  app.all('/mcp', ...mcpChain, (req: Request, res: Response) => {
    void nodeHandler(req, res, req.body);
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found. MCP endpoint is POST /mcp.' });
  });

  return app;
}

export interface RunningHttpServer {
  server: Server;
  url: string;
  deps: ServerDeps;
  close: () => Promise<void>;
}

export async function startHttpServer(
  config: Config,
  deps: ServerDeps = createDeps(config),
): Promise<RunningHttpServer> {
  const app = createHttpApp(config, deps);
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(config.port, config.host, () => resolve(s));
    s.on('error', reject);
  });
  const addr = server.address() as AddressInfo;
  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  return {
    server,
    url: `http://${host}:${addr.port}`,
    deps,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const deps = createDeps(config);
  if (config.mode === 'remote' && !config.apiKey) {
    log.warn(
      'DEVPILOT_API_KEY not set: running as a public demo (allowlisted repos + fixed test commands only)',
    );
  }
  if (config.mode === 'remote' && config.host !== '127.0.0.1' && config.allowedHosts.length === 0) {
    log.warn('No ALLOWED_HOSTS configured; Host-header validation is off for this public bind');
  }
  const running = await startHttpServer(config, deps);
  log.info('devpilot-mcp listening', {
    url: running.url,
    mcp: `${running.url}/mcp`,
    mode: config.mode,
    version: VERSION,
  });

  // Clone allowlisted repos in the background so the health check passes immediately.
  void deps.workspaces.prepareAll();

  const shutdown = (signal: string) => {
    log.info('shutting down', { signal });
    void running.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

function isEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err) => {
    if (err instanceof ConfigError) process.stderr.write(`${err.message}\n`);
    else log.error('fatal', { error: errorMessage(err) });
    process.exit(1);
  });
}
