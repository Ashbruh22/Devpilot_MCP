import { Octokit } from '@octokit/rest';
import { ToolError, errorMessage } from './errors.js';
import { log } from './logger.js';
import { VERSION } from './version.js';

export interface IssueComment {
  author: string;
  body: string;
  created_at: string;
}

export interface LinkedPullRequest {
  number: number;
  title: string;
  state: string;
  url: string;
  repo: string;
}

export interface IssueData {
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  is_pull_request: boolean;
  labels: string[];
  author: string;
  created_at: string;
  updated_at: string;
  body: string;
  comments: IssueComment[];
  total_comments: number;
  linked_prs: LinkedPullRequest[];
  url: string;
}

interface CacheEntry<T> {
  expires: number;
  value: Promise<T>;
}

/** Tiny TTL cache that also de-duplicates concurrent identical requests. */
export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
  ) {}

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) return hit.value;
    const value = load();
    this.entries.set(key, { expires: now + this.ttlMs, value });
    value.catch(() => this.entries.delete(key)); // never cache failures
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

export interface GitHubClientOptions {
  token?: string;
  baseUrl?: string;
  cacheTtlMs?: number;
}

function status(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null && 'status' in err
    ? Number((err as { status: unknown }).status)
    : undefined;
}

export class GitHubClient {
  private readonly octokit: Octokit;
  private readonly cache: TtlCache<IssueData>;
  readonly authenticated: boolean;

  constructor(opts: GitHubClientOptions = {}) {
    this.octokit = new Octokit({
      auth: opts.token,
      baseUrl: opts.baseUrl,
      userAgent: `devpilot-mcp/${VERSION}`,
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      request: { retries: 0 },
    });
    this.authenticated = Boolean(opts.token);
    this.cache = new TtlCache(opts.cacheTtlMs ?? 60_000);
  }

  /** Fetch an issue with its discussion and linked PRs. Cached for 60s. */
  getIssue(owner: string, repo: string, issueNumber: number, maxComments = 20): Promise<IssueData> {
    const key = `${owner}/${repo}#${issueNumber}`.toLowerCase() + `:${maxComments}`;
    return this.cache.getOrLoad(key, () => this.fetchIssue(owner, repo, issueNumber, maxComments));
  }

  private async fetchIssue(owner: string, repo: string, n: number, maxComments: number): Promise<IssueData> {
    const where = `${owner}/${repo}`;
    try {
      const { data: issue } = await this.octokit.rest.issues.get({ owner, repo, issue_number: n });

      const comments: IssueComment[] = [];
      if (maxComments > 0 && issue.comments > 0) {
        // Fetch the most recent `maxComments` comments: jump to the last page(s).
        const perPage = Math.min(100, maxComments);
        const lastPage = Math.max(1, Math.ceil(issue.comments / perPage));
        const pages = lastPage > 1 && maxComments > perPage ? [lastPage - 1, lastPage] : [lastPage];
        for (const page of pages) {
          const { data } = await this.octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number: n,
            per_page: perPage,
            page,
          });
          for (const c of data) {
            comments.push({ author: c.user?.login ?? 'ghost', body: c.body ?? '', created_at: c.created_at });
          }
        }
      }

      const linked = await this.fetchLinkedPrs(owner, repo, n);

      return {
        owner,
        repo,
        number: issue.number,
        title: issue.title,
        state: issue.state_reason ? `${issue.state} (${issue.state_reason})` : issue.state,
        is_pull_request: Boolean(issue.pull_request),
        labels: issue.labels
          .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
          .filter((l): l is string => Boolean(l)),
        author: issue.user?.login ?? 'ghost',
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        body: issue.body ?? '',
        comments: comments.slice(-maxComments),
        total_comments: issue.comments,
        linked_prs: linked,
        url: issue.html_url,
      };
    } catch (err) {
      throw this.translate(err, `Issue #${n}`, where);
    }
  }

  private async fetchLinkedPrs(owner: string, repo: string, n: number): Promise<LinkedPullRequest[]> {
    try {
      const { data } = await this.octokit.rest.issues.listEventsForTimeline({
        owner,
        repo,
        issue_number: n,
        per_page: 100,
      });
      const prs = new Map<string, LinkedPullRequest>();
      for (const ev of data as Array<Record<string, unknown>>) {
        if (ev.event !== 'cross-referenced') continue;
        const src = (ev.source as { issue?: Record<string, unknown> } | undefined)?.issue;
        if (!src || !src.pull_request) continue;
        const repoName =
          ((src.repository as { full_name?: string } | undefined)?.full_name ?? `${owner}/${repo}`) || '';
        const pr: LinkedPullRequest = {
          number: Number(src.number),
          title: String(src.title ?? ''),
          state: (src.pull_request as { merged_at?: string | null }).merged_at
            ? 'merged'
            : String(src.state ?? ''),
          url: String(src.html_url ?? ''),
          repo: repoName,
        };
        prs.set(`${repoName}#${pr.number}`, pr);
      }
      return [...prs.values()];
    } catch (err) {
      // Linked PRs are a nice-to-have; don't fail the whole call.
      log.warn('could not fetch issue timeline', { owner, repo, issue: n, error: errorMessage(err) });
      return [];
    }
  }

  private translate(err: unknown, what: string, where: string): ToolError {
    const s = status(err);
    const headers = (err as { response?: { headers?: Record<string, string> } }).response?.headers ?? {};
    if (s === 404) {
      return new ToolError(
        `${what} not found in ${where}. Check the owner/repo/number` +
          (this.authenticated ? '.' : ' (or set GITHUB_TOKEN if the repo is private).'),
      );
    }
    if (s === 401) return new ToolError('GitHub rejected the token (401). Check GITHUB_TOKEN.');
    if (s === 403 || s === 429) {
      if (headers['x-ratelimit-remaining'] === '0') {
        const reset = Number(headers['x-ratelimit-reset'] ?? 0) * 1000;
        const mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60_000)) : undefined;
        return new ToolError(
          `GitHub API rate limit exhausted${mins ? `; resets in ~${mins} min` : ''}.` +
            (this.authenticated
              ? ''
              : ' Set GITHUB_TOKEN to raise the limit from 60 to 5,000 requests/hour.'),
        );
      }
      return new ToolError(`GitHub denied access to ${where} (${s}). The token may lack read access.`);
    }
    log.error('GitHub request failed', { where, status: s, error: errorMessage(err) });
    return new ToolError(`GitHub request for ${what} in ${where} failed: ${errorMessage(err)}`);
  }
}
