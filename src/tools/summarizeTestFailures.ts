import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { ToolError } from '../lib/errors.js';
import { groupFailures, normalizeMessage, summarizeFailure } from '../lib/failures.js';
import { readOnly, safe, toolResult, type ServerDeps } from './shared.js';

const frame = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number().optional(),
  function: z.string().optional(),
});

export const summarizeOutput = z.object({
  run_id: z.string(),
  workspace: z.string(),
  total_failures: z.number(),
  failures: z.array(
    z.object({
      test_name: z.string(),
      file: z.string(),
      line: z.number().optional(),
      message: z.string(),
      top_frames: z.array(frame),
      likely_source_files: z.array(z.string()),
      source_hint: z.enum(['stack', 'naming', 'none']),
    }),
  ),
  groups: z.array(
    z.object({
      signature: z.string(),
      count: z.number(),
      sample_message: z.string(),
      tests: z.array(z.string()),
      likely_source_files: z.array(z.string()),
    }),
  ),
  truncated: z.boolean(),
});

export function registerSummarizeTestFailures(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'summarize_test_failures',
    {
      title: 'Summarize test failures',
      description:
        'Summarize the failures of a previous run_tests call: each failing test with its message, top project stack frames, and likely_source_files (non-test files from the stack — where the fix probably goes), plus groups of failures sharing the same normalized error, largest first.',
      inputSchema: z.object({
        run_id: z
          .string()
          .regex(/^run_[a-z0-9-]+$/)
          .describe('The run_id returned by run_tests.'),
      }),
      outputSchema: summarizeOutput,
      annotations: { ...readOnly, openWorldHint: false },
    },
    safe('summarize_test_failures', async ({ run_id }) => {
      const run = deps.runStore.get(run_id);
      if (!run) {
        throw new ToolError(
          `Unknown run_id "${run_id}". Runs are kept in memory (last 20) and are lost on restart; call run_tests again.`,
        );
      }
      const summaries = run.report.failures.map((f) => summarizeFailure(f, run.root));
      const groups = groupFailures(summaries);
      // Order failures like their groups (largest first) so truncation drops the long tail.
      const rank = new Map(groups.map((g, i) => [g.signature, i]));
      const all = [...summaries].sort(
        (a, b) => (rank.get(normalizeMessage(a.message)) ?? 0) - (rank.get(normalizeMessage(b.message)) ?? 0),
      );

      // Keep the response within budget: drop per-failure detail before dropping groups.
      const perFailure = 1_200;
      const maxFailures = Math.max(1, Math.floor((deps.config.maxOutputChars * 0.5) / perFailure));
      const failures = all.slice(0, maxFailures);
      const data = {
        run_id,
        workspace: run.repo,
        total_failures: all.length,
        failures,
        groups: groups.slice(0, 20),
        truncated: all.length > failures.length || groups.length > 20,
      };

      let summary: string;
      if (all.length === 0) {
        summary =
          run.report.failed > 0
            ? `Run ${run_id} reported ${run.report.failed} failure(s) but none could be parsed; see output_tail from run_tests.`
            : `Run ${run_id} had no failing tests.`;
      } else {
        const top = groups[0]!;
        const sources = [...new Set(groups.flatMap((g) => g.likely_source_files))];
        summary =
          `${all.length} failure(s) in ${groups.length} group(s). Largest group (${top.count}): ${top.signature}. ` +
          (sources.length
            ? `Likely source files: ${sources.slice(0, 5).join(', ')}.`
            : 'No project source frames found.');
      }
      return toolResult(summary, data, deps.config.maxOutputChars);
    }),
  );
}
