import path from 'node:path';
import * as z from 'zod';

export type Mode = 'local' | 'remote';

export interface AllowedRepo {
  owner: string;
  repo: string;
  ref: string;
  /** Lowercased `owner/repo`, used as the lookup key everywhere. */
  key: string;
}

export interface Config {
  mode: Mode;
  githubToken?: string;
  workspaceRoot: string;
  allowedRepos: AllowedRepo[];
  /** Keyed by lowercased `owner/repo`. */
  testCommands: Record<string, string>;
  /** Optional local-mode override for the auto-detected test command. */
  testCommand?: string;
  apiKey?: string;
  port: number;
  host: string;
  allowedHosts: string[];
  corsOrigin: string;
  rateLimitPerMin: number;
  trustProxy: boolean;
  testTimeoutMs: number;
  maxOutputChars: number;
  workspacesDir: string;
  gitBaseUrl: string;
  githubApiUrl?: string;
  installDeps: boolean;
}

const REPO_RE = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)(?:@([A-Za-z0-9._/-]+))?$/;

export function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}

function parseAllowedRepos(raw: string, ctx: z.RefinementCtx): AllowedRepo[] {
  const out: AllowedRepo[] = [];
  for (const entry of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const m = REPO_RE.exec(entry);
    if (!m) {
      ctx.addIssue({
        code: 'custom',
        message: `ALLOWED_REPOS entry "${entry}" is not of the form owner/repo@ref`,
      });
      continue;
    }
    const [, owner, repo, ref] = m as unknown as [string, string, string, string | undefined];
    out.push({ owner, repo, ref: ref ?? 'main', key: repoKey(owner, repo) });
  }
  return out;
}

const intFromEnv = (def: number, min: number) => z.coerce.number().int().min(min).default(def);
const boolFromEnv = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1' || v === 'yes');
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  DEVPILOT_MODE: z.enum(['local', 'remote']).default('local'),
  GITHUB_TOKEN: optionalString,
  WORKSPACE_ROOT: optionalString,
  ALLOWED_REPOS: z.string().default('').transform(parseAllowedRepos),
  TEST_COMMANDS: z
    .string()
    .default('{}')
    .transform((raw, ctx) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'TEST_COMMANDS must be a JSON object' });
        return z.NEVER;
      }
      const res = z.record(z.string(), z.string().min(1)).safeParse(parsed);
      if (!res.success) {
        ctx.addIssue({ code: 'custom', message: 'TEST_COMMANDS must map "owner/repo" to a command string' });
        return z.NEVER;
      }
      return Object.fromEntries(Object.entries(res.data).map(([k, v]) => [k.toLowerCase(), v]));
    }),
  TEST_COMMAND: optionalString,
  DEVPILOT_API_KEY: optionalString,
  PORT: intFromEnv(3000, 0),
  HOST: optionalString,
  ALLOWED_HOSTS: optionalString,
  RENDER_EXTERNAL_HOSTNAME: optionalString,
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_PER_MIN: intFromEnv(60, 1),
  TRUST_PROXY: optionalString,
  TEST_TIMEOUT_MS: intFromEnv(120_000, 1_000),
  MAX_OUTPUT_CHARS: intFromEnv(20_000, 1_000),
  WORKSPACES_DIR: z.string().default('/tmp/workspaces'),
  GIT_BASE_URL: z.string().default('https://github.com'),
  GITHUB_API_URL: optionalString,
  INSTALL_DEPS: boolFromEnv(true),
});

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const res = EnvSchema.safeParse(env);
  if (!res.success) {
    const lines = res.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new ConfigError(`Invalid DevPilot configuration:\n${lines.join('\n')}`);
  }
  const e = res.data;
  const mode = e.DEVPILOT_MODE;

  if (mode === 'remote') {
    if (e.ALLOWED_REPOS.length === 0) {
      throw new ConfigError(
        'Invalid DevPilot configuration:\n  - ALLOWED_REPOS: required in remote mode (e.g. "Ashbruh22/devpilot-demo@main")',
      );
    }
    const allowed = new Set(e.ALLOWED_REPOS.map((r) => r.key));
    const stray = Object.keys(e.TEST_COMMANDS).filter((k) => !allowed.has(k));
    if (stray.length) {
      throw new ConfigError(
        `Invalid DevPilot configuration:\n  - TEST_COMMANDS: keys not in ALLOWED_REPOS: ${stray.join(', ')}`,
      );
    }
  }

  const host = e.HOST ?? (mode === 'remote' ? '0.0.0.0' : '127.0.0.1');
  const allowedHosts = e.ALLOWED_HOSTS
    ? e.ALLOWED_HOSTS.split(',')
        .map((h) => h.trim())
        .filter(Boolean)
    : e.RENDER_EXTERNAL_HOSTNAME
      ? [e.RENDER_EXTERNAL_HOSTNAME, 'localhost', '127.0.0.1']
      : [];

  return {
    mode,
    githubToken: e.GITHUB_TOKEN,
    workspaceRoot: path.resolve(e.WORKSPACE_ROOT ?? process.cwd()),
    allowedRepos: e.ALLOWED_REPOS,
    testCommands: e.TEST_COMMANDS,
    testCommand: e.TEST_COMMAND,
    apiKey: e.DEVPILOT_API_KEY,
    port: e.PORT,
    host,
    allowedHosts,
    corsOrigin: e.CORS_ORIGIN,
    rateLimitPerMin: e.RATE_LIMIT_PER_MIN,
    trustProxy: e.TRUST_PROXY ? ['1', 'true', 'yes'].includes(e.TRUST_PROXY) : mode === 'remote',
    testTimeoutMs: e.TEST_TIMEOUT_MS,
    maxOutputChars: e.MAX_OUTPUT_CHARS,
    workspacesDir: path.resolve(e.WORKSPACES_DIR),
    gitBaseUrl: e.GIT_BASE_URL.replace(/\/+$/, ''),
    githubApiUrl: e.GITHUB_API_URL,
    installDeps: e.INSTALL_DEPS,
  };
}
