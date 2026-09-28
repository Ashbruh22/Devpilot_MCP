# devpilot-demo

A tiny shop library (pricing and date helpers) with **real bugs**, used to demo and benchmark
[DevPilot MCP](https://github.com/Ashbruh22/devpilot_mcp).

```bash
npm install
npm test   # 2 tests fail on purpose — see the open issues
```

## Modules

- `src/pricing.ts`: discounts, bulk tiers, and order totals
- `src/dateUtils.ts`: month arithmetic and invoice due dates

See [`docs/`](docs) for the pricing rules, date handling, and contributing guide.
