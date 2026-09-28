# Demo repository

`devpilot-demo/` is the source for the public demo repo (`Ashbruh22/devpilot-demo`) the hosted
DevPilot server operates on. It is also the benchmark set (see [`../bench`](../bench)).

- Two modules, `src/pricing.ts` and `src/dateUtils.ts`, with vitest tests.
- **Two intentionally failing tests** caused by real bugs:
  - a rounding bug: `roundToCents` truncates, so `applyDiscount(10, 33)` gives `6.69`
  - an off-by-one date bug: `daysInMonth` looks at the wrong month, so `addMonths(Jan 31, 1)` gives Mar 2
- `docs/` with pricing, dates, and contributing pages.
- `issues/`: five issues written like real user reports (a code snippet, a stack trace, a vague
  feature request, a docs question, and a "bug" that is actually intended behaviour).

## Publish

```bash
demo/publish.sh Ashbruh22 devpilot-demo   # needs an authenticated `gh`
```

This creates the public repo, pushes the code, and files the five issues in order (#1–#5).
