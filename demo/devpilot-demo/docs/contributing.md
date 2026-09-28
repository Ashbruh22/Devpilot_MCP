# Contributing

## Running tests

`npm test` runs the vitest suite once. Two tests currently fail on purpose (see issues #1 and #2).

## Adding a discount type

Add a pure function in `src/pricing.ts`, export it, and cover each tier boundary in `src/pricing.test.ts`.

## Currency

Only USD is supported today. See issue #3 for multi-currency.
