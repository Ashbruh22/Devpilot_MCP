import type { CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { Config } from '../config.js';
import { ToolError, errorMessage } from '../lib/errors.js';
import type { GitHubClient } from '../lib/github.js';
import { log } from '../lib/logger.js';
import type { RunStore } from '../lib/runStore.js';
import { truncateText } from '../lib/truncate.js';
import type { WorkspaceManager } from '../lib/workspace.js';

/** Long-lived dependencies shared by every server instance (HTTP creates one server per request). */
export interface ServerDeps {
  config: Config;
  github: GitHubClient;
  workspaces: WorkspaceManager;
  runStore: RunStore;
}

/**
 * Build a tool result: structured content plus a short human summary.
 * The text block also carries the JSON so clients that only forward text still get the data,
 * capped at MAX_OUTPUT_CHARS.
 */
export function toolResult<T extends Record<string, unknown>>(
  summary: string,
  data: T,
  maxChars: number,
): CallToolResult {
  const text = `${summary}\n\n${JSON.stringify(data)}`;
  return {
    content: [{ type: 'text', text: truncateText(text, maxChars) }],
    structuredContent: data,
  };
}

export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Wrap a handler so failures become actionable tool errors, never raw stack traces. */
export function safe<A>(
  name: string,
  fn: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    const started = Date.now();
    try {
      const res = await fn(args);
      log.info('tool call', { tool: name, ms: Date.now() - started, error: Boolean(res.isError) });
      return res;
    } catch (err) {
      if (err instanceof ToolError) {
        log.info('tool call', { tool: name, ms: Date.now() - started, error: true });
        return toolError(err.message);
      }
      log.error('tool crashed', {
        tool: name,
        error: errorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return toolError(`Internal error in ${name}: ${errorMessage(err)}`);
    }
  };
}

// Reusable input fields.
export const ownerField = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,39}$/, 'Invalid GitHub owner')
  .optional()
  .describe(
    'GitHub owner (user or org). Optional: defaults to the workspace\'s "origin" remote (local mode) or the only allowlisted repo (remote mode).',
  );
export const repoField = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}$/, 'Invalid GitHub repo name')
  .optional()
  .describe('GitHub repository name. Optional, see "owner".');
export const issueNumberField = z.number().int().positive().describe('Issue (or PR) number, e.g. 42.');
export const workspaceRepoField = z
  .string()
  .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'Use the form owner/repo')
  .optional()
  .describe(
    'Remote mode only: which allowlisted repo ("owner/repo") to operate on. Optional when only one repo is allowlisted; ignored in local mode.',
  );

export const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
