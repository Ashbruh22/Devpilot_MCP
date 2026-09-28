import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { searchCodebase } from '../lib/search.js';
import { readOnly, safe, toolResult, workspaceRepoField, type ServerDeps } from './shared.js';

export const searchCodebaseOutput = z.object({
  workspace: z.string(),
  matches: z.array(
    z.object({
      path: z.string(),
      line: z.number(),
      preview: z.string(),
      context_before: z.array(z.string()),
      context_after: z.array(z.string()),
    }),
  ),
  total_matches: z.number(),
  files_with_matches: z.number(),
  truncated: z.boolean(),
});

export function registerSearchCodebase(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'search_codebase',
    {
      title: 'Search codebase',
      description:
        'Search the workspace with ripgrep (respects .gitignore; skips node_modules, dist, lockfiles and binaries). Returns matching lines with surrounding context and paths relative to the workspace root.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(500)
          .describe('Text to search for. Treated literally unless is_regex is true.'),
        is_regex: z
          .boolean()
          .default(false)
          .describe('Interpret query as a (Rust-flavored) regular expression.'),
        path_glob: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Restrict to files matching this glob, relative to the root, e.g. "src/**/*.ts" or "*.py".',
          ),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(30)
          .describe('Maximum matches to return. Default 30.'),
        context_lines: z
          .number()
          .int()
          .min(0)
          .max(10)
          .default(2)
          .describe('Lines of context before and after each match. Default 2.'),
        repo: workspaceRepoField,
      }),
      outputSchema: searchCodebaseOutput,
      annotations: { ...readOnly, openWorldHint: false },
    },
    safe('search_codebase', async ({ query, is_regex, path_glob, max_results, context_lines, repo }) => {
      const ws = deps.workspaces.resolve(repo);
      // Shrink the result count so the response fits the output budget (~250 chars per context line).
      const perMatch = 200 + context_lines * 2 * 120;
      const fit = Math.max(1, Math.floor((deps.config.maxOutputChars * 0.45) / perMatch));
      const res = await searchCodebase(ws.root, {
        query,
        isRegex: is_regex,
        pathGlob: path_glob,
        maxResults: Math.min(max_results, fit),
        contextLines: context_lines,
      });
      const data = { workspace: ws.name, ...res };
      const summary = res.total_matches
        ? `${res.total_matches} match(es) in ${res.files_with_matches} file(s) for ${JSON.stringify(query)}` +
          (res.truncated ? `; showing first ${res.matches.length}.` : '.')
        : `No matches for ${JSON.stringify(query)}${path_glob ? ` in ${path_glob}` : ''}.`;
      return toolResult(summary, data, deps.config.maxOutputChars);
    }),
  );
}
