import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { fitToBudget, truncateText } from '../lib/truncate.js';
import {
  issueNumberField,
  ownerField,
  readOnly,
  repoField,
  safe,
  toolResult,
  type ServerDeps,
} from './shared.js';

export const getIssueInput = z.object({
  owner: ownerField,
  repo: repoField,
  issue_number: issueNumberField,
  max_comments: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(20)
    .describe('Maximum number of comments to return (most recent first kept). Default 20.'),
});

export const getIssueOutput = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.string(),
  is_pull_request: z.boolean(),
  labels: z.array(z.string()),
  author: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  body: z.string(),
  comments: z.array(z.object({ author: z.string(), body: z.string(), created_at: z.string() })),
  total_comments: z.number(),
  linked_prs: z.array(
    z.object({ number: z.number(), title: z.string(), state: z.string(), url: z.string(), repo: z.string() }),
  ),
  url: z.string(),
});

export function registerGetIssue(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'get_issue',
    {
      title: 'Get GitHub issue',
      description:
        'Fetch a GitHub issue with its discussion: title, state, labels, author, dates, body, recent comments, and linked pull requests. Read-only. Start here when triaging an issue.',
      inputSchema: getIssueInput,
      outputSchema: getIssueOutput,
      annotations: { ...readOnly, openWorldHint: true },
    },
    safe('get_issue', async ({ owner, repo, issue_number, max_comments }) => {
      const target = await deps.workspaces.resolveIssueRepo(owner, repo);
      const issue = await deps.github.getIssue(target.owner, target.repo, issue_number, max_comments);

      // Budget: the body gets up to 40%, comments share what is left.
      const budget = Math.floor(deps.config.maxOutputChars * 0.8);
      const body = truncateText(issue.body, Math.floor(budget * 0.4));
      const commentBodies = fitToBudget(
        issue.comments.map((c) => c.body),
        Math.max(0, budget - body.length),
      );
      const data = {
        ...issue,
        body,
        comments: issue.comments.map((c, i) => ({ ...c, body: commentBodies[i]! })),
      };
      const summary =
        `#${issue.number} "${issue.title}" [${issue.state}] in ${issue.owner}/${issue.repo} by @${issue.author}` +
        `${issue.labels.length ? `; labels: ${issue.labels.join(', ')}` : ''}; ` +
        `${issue.comments.length}/${issue.total_comments} comments; ${issue.linked_prs.length} linked PR(s).`;
      return toolResult(summary, data, deps.config.maxOutputChars);
    }),
  );
}
