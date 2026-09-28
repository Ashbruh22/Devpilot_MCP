import { McpServer } from '@modelcontextprotocol/server';
import type { Config } from './config.js';
import { GitHubClient } from './lib/github.js';
import { RunStore } from './lib/runStore.js';
import { SERVER_NAME, VERSION } from './lib/version.js';
import { WorkspaceManager } from './lib/workspace.js';
import { registerTriagePrompt } from './prompts/triageIssue.js';
import { registerAnalyzeIssue } from './tools/analyzeIssue.js';
import { registerGetDocs } from './tools/getDocs.js';
import { registerGetIssue } from './tools/getIssue.js';
import { registerRunTests } from './tools/runTests.js';
import type { ServerDeps } from './tools/shared.js';
import { registerSearchCodebase } from './tools/searchCodebase.js';
import { registerSummarizeTestFailures } from './tools/summarizeTestFailures.js';

export type { ServerDeps } from './tools/shared.js';

/** Build the long-lived dependencies once per process (caches, run store, workspaces). */
export function createDeps(config: Config, overrides: Partial<ServerDeps> = {}): ServerDeps {
  return {
    config,
    github: overrides.github ?? new GitHubClient({ token: config.githubToken, baseUrl: config.githubApiUrl }),
    workspaces: overrides.workspaces ?? new WorkspaceManager(config),
    runStore: overrides.runStore ?? new RunStore(20),
  };
}

const INSTRUCTIONS = `DevPilot gives you structured, scoped context for fixing issues: the GitHub issue, the code, the docs, and the test suite.
Typical loop: get_issue → analyze_issue → search_codebase (suggested queries) → run_tests → summarize_test_failures → propose a fix.
The "triage_issue" prompt walks through it. All output is size-capped; prefer targeted queries over broad ones.`;

/**
 * Build an McpServer with every tool and prompt registered. Transport-agnostic:
 * stdio calls it once per connection, HTTP once per request (stateless).
 */
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    { capabilities: { tools: {}, prompts: {} }, instructions: INSTRUCTIONS },
  );
  registerGetIssue(server, deps);
  registerAnalyzeIssue(server, deps);
  registerSearchCodebase(server, deps);
  registerGetDocs(server, deps);
  registerRunTests(server, deps);
  registerSummarizeTestFailures(server, deps);
  registerTriagePrompt(server);
  return server;
}
