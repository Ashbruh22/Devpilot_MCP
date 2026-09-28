# Demo repository

`devpilot-demo/` is the project the hosted DevPilot server operates on
(`ALLOWED_REPOS=Ashbruh22/Devpilot_MCP:demo/devpilot-demo`). It is also the benchmark set (see
[`../bench`](../bench)).

- Two modules, `src/pricing.ts` and `src/dateUtils.ts`, with vitest tests.
- **Two intentionally failing tests** caused by real bugs:
  - a rounding bug: `roundToCents` truncates, so `applyDiscount(10, 33)` gives `6.69`
  - an off-by-one date bug: `daysInMonth` looks at the wrong month, so `addMonths(Jan 31, 1)` gives Mar 2
- `docs/` with pricing, dates, and contributing pages.
- `issues/`: five issues written like real user reports (a code snippet, a stack trace, a vague
  feature request, a docs question, and a "bug" that is actually intended behaviour).

## Optional: publish as a standalone repo

The hosted server doesn't need this. If you want the demo issues on GitHub so `get_issue` and `triage_issue` have
something to fetch, run:

```bash
demo/publish.sh Ashbruh22 devpilot-demo   # needs an authenticated `gh`
```

This creates the public repo, pushes the code, and files the five issues in order (#1–#5). To serve it, set
`ALLOWED_REPOS=Ashbruh22/devpilot-demo` and `TEST_COMMANDS={"Ashbruh22/devpilot-demo":"npx --no vitest run --reporter=json"}`.
