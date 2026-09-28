import { readFileSync } from 'node:fs';

// Works from both src/lib (tsx) and dist/lib (compiled): package.json is two levels up.
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readVersion();
export const SERVER_NAME = 'devpilot-mcp';
