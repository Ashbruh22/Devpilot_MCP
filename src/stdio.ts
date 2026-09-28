#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadConfig } from './config.js';
import { errorMessage } from './lib/errors.js';
import { log } from './lib/logger.js';
import { VERSION } from './lib/version.js';
import { createDeps, createServer } from './server.js';

// Local mode entry point. stdout carries MCP messages only; every log line goes to stderr.
async function main(): Promise<void> {
  const config = loadConfig({ DEVPILOT_MODE: 'local', ...process.env });
  const deps = createDeps(config);
  if (config.mode === 'remote') {
    await deps.workspaces.prepareAll();
  }
  if (!config.githubToken) {
    log.warn('GITHUB_TOKEN not set; GitHub API is limited to 60 requests/hour and public repos');
  }
  serveStdio(() => createServer(deps), {
    onerror: (err) => log.error('stdio transport error', { error: err.message }),
  });
  log.info('devpilot-mcp ready (stdio)', {
    version: VERSION,
    mode: config.mode,
    workspace: config.workspaceRoot,
  });
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
  } else {
    log.error('fatal', { error: errorMessage(err) });
  }
  process.exit(1);
});
