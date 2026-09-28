import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { analyzeIssueContent } from '../lib/issueAnalysis.js';
import {
  issueNumberField,
  ownerField,
  readOnly,
  repoField,
  safe,
  toolResult,
  type ServerDeps,
} from './shared.js';

export const analyzeIssueOutput = z.object({
  owner: z.string(),
  repo: z.string(),
  issue_number: z.number(),
  title: z.string(),
  type_guess: z.enum(['bug', 'feature', 'question', 'docs']),
  type_signals: z.array(z.string()),
  error_messages: z.array(z.string()),
  stack_frames: z.array(
    z.object({
      file: z.string(),
      line: z.number(),
      column: z.number().optional(),
      function: z.string().optional(),
    }),
  ),
  mentioned_paths: z.array(z.string()),
  code_blocks: z.array(z.object({ source: z.string(), lang: z.string(), code: z.string() })),
  suggested_search_queries: z.array(z.string()),
});

export function registerAnalyzeIssue(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'analyze_issue',
    {
      title: 'Analyze GitHub issue',
      description:
        'Deterministically extract triage signals from an issue (no LLM): a type guess (bug/feature/question/docs), error messages, parsed stack frames (JS and Python), mentioned file paths, fenced code blocks, and suggested queries to pass to search_codebase.',
      inputSchema: z.object({ owner: ownerField, repo: repoField, issue_number: issueNumberField }),
      outputSchema: analyzeIssueOutput,
      annotations: { ...readOnly, openWorldHint: true },
    },
    safe('analyze_issue', async ({ owner, repo, issue_number }) => {
      const target = await deps.workspaces.resolveIssueRepo(owner, repo);
      // Reuses get_issue's fetch and 60s cache (same key with the default comment count).
      const issue = await deps.github.getIssue(target.owner, target.repo, issue_number, 20);
      const root = deps.config.mode === 'local' ? deps.config.workspaceRoot : undefined;
      const analysis = analyzeIssueContent(issue, root);
      const data = {
        owner: issue.owner,
        repo: issue.repo,
        issue_number: issue.number,
        title: issue.title,
        ...analysis,
      };
      const summary =
        `#${issue.number} looks like a ${analysis.type_guess}. Found ${analysis.error_messages.length} error message(s), ` +
        `${analysis.stack_frames.length} stack frame(s), ${analysis.mentioned_paths.length} path(s), ` +
        `${analysis.code_blocks.length} code block(s).` +
        (analysis.suggested_search_queries.length
          ? ` Next: search_codebase for ${analysis.suggested_search_queries
              .slice(0, 3)
              .map((q) => JSON.stringify(q))
              .join(', ')}.`
          : '');
      return toolResult(summary, data, deps.config.maxOutputChars);
    }),
  );
}
