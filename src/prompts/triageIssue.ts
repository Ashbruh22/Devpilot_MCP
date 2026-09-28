import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

export function triageInstructions(owner: string, repo: string, issueNumber: number): string {
  const ref = `${owner}/${repo}#${issueNumber}`;
  return `Triage GitHub issue ${ref} and propose a fix. Use the DevPilot tools in this order, and keep your context lean — rely on the structured tool output rather than reading whole files up front.

1. get_issue { owner: "${owner}", repo: "${repo}", issue_number: ${issueNumber} }
   Read the report and discussion. Note any linked PRs (the fix may already exist).
2. analyze_issue { owner: "${owner}", repo: "${repo}", issue_number: ${issueNumber} }
   Use type_guess, error_messages, stack_frames and mentioned_paths to form a hypothesis.
3. search_codebase for each of the top suggested_search_queries (and any mentioned_paths / stack frame function names).
   Open only the files the matches point to.
4. If the issue is a question or docs request, call get_docs with a topic from the issue before answering.
5. run_tests (use a filter matching the affected module if one is obvious).
6. If anything fails, summarize_test_failures { run_id } and focus on the largest group and its likely_source_files.
7. Propose a fix: name the root cause, the file(s) and line(s) to change, and show a minimal diff. Mention which failing tests the fix should turn green and any test you would add.

If the issue is a feature request, skip steps 5–6 and instead outline where the change would go and what tests it needs.`;
}

export function registerTriagePrompt(server: McpServer): void {
  server.registerPrompt(
    'triage_issue',
    {
      title: 'Triage an issue end to end',
      description:
        'Walks the agent through get_issue → analyze_issue → search_codebase → run_tests → summarize_test_failures → proposed fix.',
      argsSchema: z.object({
        owner: z.string().describe('GitHub owner, e.g. "Ashbruh22"'),
        repo: z.string().describe('GitHub repo, e.g. "devpilot-demo"'),
        issue_number: z.string().regex(/^\d+$/).describe('Issue number, e.g. "3"'),
      }),
    },
    ({ owner, repo, issue_number }) => ({
      description: `Triage ${owner}/${repo}#${issue_number}`,
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: triageInstructions(owner, repo, Number(issue_number)) },
        },
      ],
    }),
  );
}
