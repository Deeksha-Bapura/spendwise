# Spendwise

An AI spend management platform (Ramp-style): connect bank accounts, categorize spending with an LLM, enforce plain-English policies, approve expenses, and reimburse through an idempotent double-entry ledger.

> **Status: Phase 1 · Step 1 (foundation).** The project setup, the full database schema, sign-in with three roles, the audit log and CI. Plaid, expenses and dashboards come in the next steps.

## Architecture

A **modular monolith** in Next.js: one app and one Postgres database, split into modules (`auth`, `org`, `transactions`, `expenses`, `policies`, `audit`, `events`). Modules may only import each other through their public entry points, and an ESLint rule enforces that. In Phase 3, **only the ledger** becomes a separate service (Spring Boot, with its own database), because it moves money and needs strict consistency and its own deploy schedule. Everything else changes together, so splitting it would add network hops and failure modes for no benefit.

```
Browser ─▶ Next.js (App Router)
             ├─ proxy.ts           optimistic "is there a session cookie?" redirect + request id
             ├─ pages & route handlers ─▶ requireUser / requirePermission (real authorization)
             └─ modules/*  ─▶ Prisma ─▶ Postgres
                                         ├─ AuditLog      (append-only, DB trigger)
                                         ├─ WebhookEvent  (inbox, dedupe by provider + eventId)
                                         └─ OutboxEvent   (transactional outbox → Kafka in Phase 3)
```

### Rules that hold everywhere

- **Money is integer cents** (`BigInt`) plus an ISO 4217 currency code. There are no floats anywhere. `src/lib/money.ts` parses and formats exactly, even past `Number.MAX_SAFE_INTEGER`. The database rejects zero or negative expenses and malformed currencies with `CHECK` constraints.
- **The audit log is append-only.** Postgres triggers reject `UPDATE`, `DELETE` and `TRUNCATE`. `recordAudit(tx, …)` takes the caller's transaction, so an audit row commits or rolls back with the change it describes.
- **Every row carries `orgId`.** `can()` denies cross-org access before any role rule runs.
- **Authorization happens on the server.** `proxy.ts` only checks that a session cookie exists. Every page and route handler calls `requireUser` / `requirePermission`, and hiding a link in the UI is cosmetic.

### Roles

| | Employee | Manager | Finance admin |
|---|---|---|---|
| Own transactions and expenses | ✓ | ✓ | ✓ |
| Team's expenses | | read and approve (never their own) | |
| Whole org | | | read, approve, reimburse (never their own) |
| Policies, audit log, `/admin` | | | ✓ |

The full matrix lives in `src/modules/auth/rbac.ts`, and `tests/unit/rbac.test.ts` tests every cell.

## Stack

Next.js 16 (App Router, TypeScript strict) · PostgreSQL 16 + Prisma 7 · Better Auth · TanStack Query (server state) · Redux Toolkit (client state) · Tailwind CSS 4 · Zod · pino · Jest + React Testing Library · Playwright · GitHub Actions

## Run it locally

Requirements: Node 22+, pnpm 10, Docker.

```bash
cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d            # Postgres, plus a spendwise_test database
pnpm install                    # also runs `prisma generate`
pnpm db:deploy                  # apply migrations
pnpm db:seed                    # demo org, teams, users, policies
pnpm dev                        # http://localhost:3000
```

### Demo accounts (password `demo1234`)

| Email | Role |
|---|---|
| `employee@acme.test` | Employee (Engineering) |
| `manager@acme.test` | Manager (Engineering) |
| `finance@acme.test` | Finance admin |

With `DEMO_MODE=true`, the login page shows one-click buttons for each account. Self sign-up is disabled, because accounts are provisioned.

## Tests

```bash
pnpm test                 # unit + component (Jest, React Testing Library)
pnpm test:integration     # against TEST_DATABASE_URL (migrate it first, see below)
pnpm build && pnpm test:e2e   # Playwright against a production build
```

Before the first integration run, migrate the test database:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/spendwise_test" pnpm db:deploy
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, migrations, a **schema drift check** (it fails if `schema.prisma` and the migrations disagree), all three test layers and a build on every push and PR.

## Scripts

| Script | What it does |
|---|---|
| `db:migrate` | Create a new migration from schema changes (dev) |
| `db:deploy` | Apply pending migrations |
| `db:seed` | Seed demo data (idempotent) |
| `db:reset` | Drop, re-migrate and re-seed |
| `db:drift` | Exit non-zero if the database and `schema.prisma` differ |
