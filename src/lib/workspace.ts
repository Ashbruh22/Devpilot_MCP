import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { repoKey, type AllowedRepo, type Config } from '../config.js';
import { ToolError, errorMessage } from './errors.js';
import { runCommand, sanitizedEnv } from './exec.js';
import { log } from './logger.js';

export type WorkspaceStatus = 'pending' | 'cloning' | 'installing' | 'ready' | 'failed';

export interface Workspace {
  /** Lowercased `owner/repo`, or `local` in local mode. */
  key: string;
  /** Display name (`owner/repo` with original casing, or the folder name). */
  name: string;
  root: string;
  status: WorkspaceStatus;
  error?: string;
  owner?: string;
  repo?: string;
}

/** Parse `owner/repo` out of a git remote URL (https or ssh). */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const m = /github\.com[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

function readOriginFromGitConfig(root: string): string | null {
  try {
    const cfg = readFileSync(path.join(root, '.git', 'config'), 'utf8');
    const m = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(cfg);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export class WorkspaceManager {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly busy = new Map<string, { since: number; expectedMs: number }>();
  private readonly lastDuration = new Map<string, number>();
  private localRepo: { owner: string; repo: string } | null | undefined;

  constructor(private readonly config: Config) {
    if (config.mode === 'local') {
      this.workspaces.set('local', {
        key: 'local',
        name: path.basename(config.workspaceRoot),
        root: config.workspaceRoot,
        status: 'ready',
      });
    } else {
      for (const r of config.allowedRepos) {
        this.workspaces.set(r.key, {
          key: r.key,
          name: `${r.owner}/${r.repo}`,
          root: path.join(config.workspacesDir, `${r.owner}__${r.repo}`),
          status: 'pending',
          owner: r.owner,
          repo: r.repo,
        });
      }
    }
  }

  get mode() {
    return this.config.mode;
  }

  list(): Workspace[] {
    return [...this.workspaces.values()];
  }

  /** Clone and install every allowlisted repo (remote mode). Safe to call once at boot. */
  async prepareAll(): Promise<void> {
    if (this.config.mode !== 'remote') return;
    await Promise.all(this.config.allowedRepos.map((r) => this.prepare(r)));
  }

  private async prepare(r: AllowedRepo): Promise<void> {
    const ws = this.workspaces.get(r.key)!;
    const env = sanitizedEnv();
    try {
      mkdirSync(this.config.workspacesDir, { recursive: true });
      if (existsSync(path.join(ws.root, '.git'))) {
        log.info('workspace already present; reusing', { repo: ws.name, root: ws.root });
      } else {
        ws.status = 'cloning';
        const url = `${this.config.gitBaseUrl}/${r.owner}/${r.repo}.git`;
        log.info('cloning allowlisted repo', { repo: ws.name, ref: r.ref });
        const res = await runCommand(
          'git',
          ['clone', '--depth', '1', '--branch', r.ref, '--single-branch', '--', url, ws.root],
          { cwd: this.config.workspacesDir, timeoutMs: 180_000, maxOutputChars: 8_000, env },
        );
        if (res.exitCode !== 0) {
          throw new Error(`git clone failed: ${(res.spawnError ?? res.stderr).trim().slice(-500)}`);
        }
      }
      if (this.config.installDeps) {
        ws.status = 'installing';
        await this.install(ws, env);
      }
      ws.status = 'ready';
      log.info('workspace ready', { repo: ws.name });
    } catch (err) {
      ws.status = 'failed';
      ws.error = errorMessage(err);
      log.error('workspace preparation failed', { repo: ws.name, error: ws.error });
    }
  }

  private async install(ws: Workspace, env: NodeJS.ProcessEnv): Promise<void> {
    const has = (f: string) => existsSync(path.join(ws.root, f));
    let cmd: [string, string[]] | null = null;
    // --ignore-scripts: dependency lifecycle scripts never run on the host.
    if (has('package-lock.json')) cmd = ['npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']];
    else if (has('package.json')) cmd = ['npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']];
    else if (has('requirements.txt'))
      cmd = ['python3', ['-m', 'pip', 'install', '--user', '-r', 'requirements.txt']];
    if (!cmd) return;
    log.info('installing dependencies', { repo: ws.name, command: [cmd[0], ...cmd[1]].join(' ') });
    const res = await runCommand(cmd[0], cmd[1], {
      cwd: ws.root,
      timeoutMs: 600_000,
      maxOutputChars: 8_000,
      env,
    });
    if (res.exitCode !== 0) {
      throw new Error(`dependency install failed: ${(res.spawnError ?? res.stderr).trim().slice(-500)}`);
    }
  }

  /**
   * Pick the workspace a tool call operates on.
   * Local mode: always the single workspace root. Remote mode: `repo` must be allowlisted;
   * it may be omitted only when exactly one repo is allowlisted.
   */
  resolve(repoArg?: string): Workspace {
    if (this.config.mode === 'local') return this.workspaces.get('local')!;
    let ws: Workspace | undefined;
    if (repoArg) {
      ws = this.workspaces.get(repoArg.replace(/@.*$/, '').toLowerCase());
      if (!ws) throw new ToolError(`Repository "${repoArg}" is not allowlisted. ${this.allowedHint()}`);
    } else if (this.workspaces.size === 1) {
      ws = this.workspaces.values().next().value!;
    } else {
      throw new ToolError(`Specify "repo" (owner/repo). ${this.allowedHint()}`);
    }
    if (ws.status === 'failed') {
      throw new ToolError(`Workspace for ${ws.name} failed to prepare: ${ws.error ?? 'unknown error'}`);
    }
    if (ws.status !== 'ready') {
      throw new ToolError(`Workspace for ${ws.name} is still being prepared (${ws.status}); retry in ~15 s.`);
    }
    return ws;
  }

  /** Resolve the GitHub owner/repo for issue tools, enforcing the allowlist in remote mode. */
  async resolveIssueRepo(owner?: string, repo?: string): Promise<{ owner: string; repo: string }> {
    if (this.config.mode === 'remote') {
      if (owner && repo) {
        const key = repoKey(owner, repo);
        const allowed = this.config.allowedRepos.find((r) => r.key === key);
        if (!allowed)
          throw new ToolError(`Repository "${owner}/${repo}" is not allowlisted. ${this.allowedHint()}`);
        return { owner: allowed.owner, repo: allowed.repo };
      }
      if (owner || repo) throw new ToolError('Provide both "owner" and "repo", or neither.');
      if (this.config.allowedRepos.length === 1) {
        const only = this.config.allowedRepos[0]!;
        return { owner: only.owner, repo: only.repo };
      }
      throw new ToolError(`Specify "owner" and "repo". ${this.allowedHint()}`);
    }
    if (owner && repo) return { owner, repo };
    if (owner || repo) throw new ToolError('Provide both "owner" and "repo", or neither.');
    const detected = this.detectLocalRepo();
    if (!detected) {
      throw new ToolError(
        'No "owner"/"repo" given and the workspace has no GitHub "origin" remote to infer them from.',
      );
    }
    return detected;
  }

  private detectLocalRepo(): { owner: string; repo: string } | null {
    if (this.localRepo === undefined) {
      const url = readOriginFromGitConfig(this.config.workspaceRoot);
      this.localRepo = url ? parseGitHubRemote(url) : null;
    }
    return this.localRepo;
  }

  private allowedHint(): string {
    return `Allowed: ${this.config.allowedRepos.map((r) => `${r.owner}/${r.repo}`).join(', ') || '(none)'}.`;
  }

  /**
   * At most one concurrent test run per repo. Returns a release function, or throws a
   * "busy, retry in N s" error.
   */
  acquireTestLock(key: string): () => void {
    const current = this.busy.get(key);
    if (current) {
      const remaining = Math.max(1, Math.ceil((current.since + current.expectedMs - Date.now()) / 1000));
      throw new ToolError(`A test run is already in progress for this repo; busy, retry in ${remaining} s.`);
    }
    const since = Date.now();
    this.busy.set(key, { since, expectedMs: this.lastDuration.get(key) ?? 30_000 });
    return () => {
      this.lastDuration.set(key, Date.now() - since);
      this.busy.delete(key);
    };
  }
}
