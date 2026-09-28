import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { ToolError } from '../lib/errors.js';
import { runCommand } from '../lib/exec.js';
import { parseJUnitXml } from '../lib/parsers/pytest.js';
import { parseRawOutput } from '../lib/parsers/raw.js';
import type { ParsedTestReport } from '../lib/parsers/types.js';
import { extractJsonReport, parseJestLikeReport } from '../lib/parsers/vitestJest.js';
import { planTestRun, validateFilter, type TestPlan } from '../lib/testCommand.js';
import { stripAnsi, truncateTail } from '../lib/truncate.js';
import { safe, toolResult, workspaceRepoField, type ServerDeps } from './shared.js';

export const runTestsOutput = z.object({
  run_id: z.string(),
  workspace: z.string(),
  runner: z.string(),
  command: z.string(),
  exit_code: z.number().nullable(),
  duration_ms: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  timed_out: z.boolean(),
  structured_report: z.boolean(),
  output_tail: z.string(),
});

function readReport(file: string | undefined): string | null {
  if (!file) return null;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function parseRun(plan: TestPlan, stdout: string, stderr: string, root: string): ParsedTestReport {
  const reportText = readReport(plan.reportFile);
  if (plan.runner === 'vitest' || plan.runner === 'jest') {
    const json = extractJsonReport(reportText ?? '') ?? extractJsonReport(stdout);
    if (json) return parseJestLikeReport(json, plan.runner, root);
  }
  if (plan.runner === 'pytest') {
    const xml = reportText ?? (stdout.includes('<testsuite') ? stdout : null);
    if (xml) {
      const r = parseJUnitXml(xml);
      r.failures = r.failures.map((f) => ({ ...f, file: f.file.replace(/\\/g, '/') }));
      return r;
    }
  }
  const raw = parseRawOutput(`${stdout}\n${stderr}`);
  return { ...raw, runner: plan.runner === 'raw' ? 'raw' : raw.runner };
}

function displayCommand(plan: TestPlan, root: string): string {
  return [plan.command, ...plan.args]
    .map((a) => (a.startsWith(root) ? path.relative(root, a) || '.' : a))
    .map((a) => a.replace(os.tmpdir(), '$TMPDIR'))
    .join(' ');
}

export function registerRunTests(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'run_tests',
    {
      title: 'Run tests',
      description:
        "Run the project's test suite (auto-detects vitest, jest, pytest, or npm test; in remote mode only the server's fixed, configured command runs). Returns pass/fail counts and a run_id; pass the run_id to summarize_test_failures for grouped failures and the source files to fix.",
      inputSchema: z.object({
        filter: z
          .string()
          .max(100)
          .optional()
          .describe(
            'Optional test name or file pattern, e.g. "pricing" or "src/pricing.test.ts". Letters, digits, _ - . / and spaces only.',
          ),
        repo: workspaceRepoField,
      }),
      outputSchema: runTestsOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    safe('run_tests', async ({ filter, repo }) => {
      const cleanFilter = validateFilter(filter);
      const ws = deps.workspaces.resolve(repo);
      const fixed =
        deps.config.mode === 'remote' ? deps.config.testCommands[ws.key] : deps.config.testCommand;
      if (deps.config.mode === 'remote' && !fixed) {
        throw new ToolError(`No test command is configured for ${ws.name} (TEST_COMMANDS).`);
      }

      const release = deps.workspaces.acquireTestLock(ws.key);
      const reportDir = mkdtempSync(path.join(os.tmpdir(), 'devpilot-run-'));
      try {
        let plan: TestPlan;
        try {
          plan = planTestRun(ws.root, reportDir, cleanFilter, fixed);
        } catch (err) {
          if (err instanceof ToolError) throw err;
          throw new ToolError(`Invalid test command: ${(err as Error).message}`);
        }
        const res = await runCommand(plan.command, plan.args, {
          cwd: ws.root,
          timeoutMs: deps.config.testTimeoutMs,
          maxOutputChars: 2_000_000,
          keep: 'tail',
        });
        if (res.spawnError) {
          throw new ToolError(`Could not start test command "${plan.command}": ${res.spawnError}`);
        }
        const report = parseRun(plan, res.stdout, res.stderr, ws.root);
        const combined = stripAnsi([res.stdout, res.stderr].filter(Boolean).join('\n'));
        // Machine-readable reports on stdout are noise for a human tail; prefer stderr then.
        const humanOutput =
          report.structured && !plan.reportFile ? stripAnsi(res.stderr) || combined : combined;
        const runId = deps.runStore.newId();
        const command = displayCommand(plan, ws.root);
        deps.runStore.put({
          run_id: runId,
          created_at: new Date().toISOString(),
          repo: ws.name,
          root: ws.root,
          command: [plan.command, ...plan.args],
          exit_code: res.exitCode,
          duration_ms: res.durationMs,
          timed_out: res.timedOut,
          raw_output: truncateTail(combined, 500_000),
          report,
        });
        const data = {
          run_id: runId,
          workspace: ws.name,
          runner: report.runner,
          command,
          exit_code: res.exitCode,
          duration_ms: res.durationMs,
          passed: report.passed,
          failed: report.failed,
          skipped: report.skipped,
          timed_out: res.timedOut,
          structured_report: report.structured,
          output_tail: truncateTail(
            humanOutput.trim(),
            Math.min(4_000, Math.floor(deps.config.maxOutputChars / 3)),
          ),
        };
        const status = res.timedOut
          ? `TIMED OUT after ${Math.round(deps.config.testTimeoutMs / 1000)} s`
          : report.failed > 0 || (res.exitCode ?? 1) !== 0
            ? 'FAILED'
            : 'PASSED';
        const summary =
          `${status}: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped ` +
          `(${(res.durationMs / 1000).toFixed(1)} s, ${report.runner}). run_id=${runId}` +
          (report.failed > 0 ? ` — call summarize_test_failures with this run_id.` : '');
        return toolResult(summary, data, deps.config.maxOutputChars);
      } finally {
        release();
        rmSync(reportDir, { recursive: true, force: true });
      }
    }),
  );
}
