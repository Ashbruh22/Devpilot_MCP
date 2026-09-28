import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type Config } from '../src/config.js';

export const FIXTURES = path.resolve(import.meta.dirname, 'fixtures');
export const SAMPLE_REPO = path.join(FIXTURES, 'sample-repo');

export function fixture(rel: string): string {
  return readFileSync(path.join(FIXTURES, rel), 'utf8');
}

export function tmpCopyOfSampleRepo(): { root: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'devpilot-test-'));
  const root = path.join(dir, 'repo');
  cpSync(SAMPLE_REPO, root, { recursive: true });
  return { root, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ WORKSPACE_ROOT: SAMPLE_REPO, LOG_LEVEL: 'error', ...env });
}
