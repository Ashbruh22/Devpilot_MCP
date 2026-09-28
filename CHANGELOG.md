# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - Unreleased

### Added

- MCP server on the v2 TypeScript SDK (`@modelcontextprotocol/server`), with one transport-agnostic core served over
  **stdio** (`npx @ashbruh22/devpilot-mcp`) and **Streamable HTTP** (`POST /mcp`, stateless).
- Six tools: `get_issue`, `analyze_issue`, `search_codebase`, `get_docs`, `run_tests`, `summarize_test_failures`.
  All have zod input schemas, output schemas, structured content, and size caps.
- `triage_issue` prompt that walks the agent through the full loop.
- Test runner auto-detection (vitest, jest, pytest, npm test) with machine-readable report parsing and failure
  grouping by normalized error message.
- Remote mode: repo allowlist with shallow clones, fixed test commands, a per-repo concurrency lock, bearer auth,
  per-IP rate limiting, Host/Origin validation, and CORS.
- Sandboxed execution: no shell, a timeout that kills the process tree, capped output, and secrets stripped from the
  child environment.
- Path guard against traversal, absolute paths, and symlink escapes.
- Landing page with a live status indicator, `/healthz`, a Dockerfile (non-root, tini), a Render blueprint, and CI.
- Demo repository with two real bugs and five realistic issues, plus a benchmark harness.
