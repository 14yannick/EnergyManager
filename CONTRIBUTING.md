# Contributing

Thanks for your interest in EnergyManager.

## Setup

See the "Local development" section of the [README](README.md).

## Before opening a PR

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Guidelines

- Keep the savings/payback calculation logic in `apps/api/src/modules/savings/engine.ts`
  pure (no DB or network access) — it's the piece covered by the invariant tests in
  `engine.test.ts`, which run on synthetic inputs and assert the relationships between
  the figures (the two counterfactuals, the battery's rate spread, order-independent
  accumulation) rather than hardcoded totals. Prefer adding another invariant over
  another golden number, and never commit real metering or billing data as a fixture.
- Types and validation shared between the API and the web app belong in
  `packages/shared`, not duplicated in both apps.
- Database schema changes go through Drizzle: edit `apps/api/src/db/schema/*.ts`, then
  run `pnpm db:generate` to produce a migration. Timescale-specific DDL (hypertables,
  continuous aggregates, exclusion constraints) isn't representable in Drizzle's schema
  builder and is hand-written directly into the generated migration file — see
  `apps/api/src/db/migrations/0002_timescale.sql` for the existing example.
