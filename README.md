# Spendwise

An AI spend management platform (Ramp-style): connect bank accounts, categorize spending with an LLM, enforce plain-English policies, approve expenses, and reimburse through an idempotent double-entry ledger.

> **Status: Phase 1 · Step 3 (expenses and approvals).** Done: foundation (schema, three roles, audit log, CI), Plaid (connect a bank, idempotent sync, verified webhooks), and the expense workflow (submit, approve or reject, resubmit, with optimistic locking and a transactional outbox). Next: the outbox relay and background jobs.

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

### Bank connections (Plaid)

```
Plaid Link ─▶ POST /api/plaid/exchange  (Idempotency-Key required)
                 └─ exchange public token → encrypt access token (AES-256-GCM) → first sync

Plaid ─webhook─▶ POST /api/webhooks/plaid
                 ├─ verify: ES256 JWT, key by kid, iat ≤ 5 min, SHA-256 of the raw body
                 ├─ store in WebhookEvent inbox (dedupe: SHA-256 of body)
                 ├─ reply 200 immediately
                 └─ after(): process → syncItem()      ↻ /api/cron/webhooks retries failures

syncItem(): fetch ALL pages first (restart from the original cursor if Plaid's data
            changes mid-pagination) → one DB transaction: compare-and-set the cursor,
            upsert accounts + transactions by Plaid id, soft-delete removals, audit
```

Why each piece is there:

| Problem | What handles it |
|---|---|
| A retried "connect" request would exchange Plaid's single-use token twice | `Idempotency-Key` + `withIdempotency` (advisory lock, stored response, 422 on key reuse with a different body) |
| Plaid redelivers webhooks | Inbox table, unique on `(provider, sha256(body))`; processing is claimed with compare-and-set on `attempts` |
| Webhook + "Sync now" race on the same bank | Cursor advanced with compare-and-set; the loser rolls back as `superseded` |
| Replayed sync pages | Transactions upserted by `plaidTransactionId` (unique) |
| Forged webhooks | Signature, key expiry, 5-minute freshness and body-hash checks |
| Leaked database | Access tokens encrypted with AES-256-GCM, bound to their item id (AAD) |
| Plaid sends floats | Converted to integer cents at the boundary; sub-cent amounts are rejected, not rounded |
| Deleted bank transactions | Soft-deleted (`removedAt`), because expenses may reference them |

Transactions are listed with **keyset pagination** on `(postedAt, id)`, so every page costs the same and new rows don't shift pages. Visibility follows the role rules: employees see their own, managers their team's, finance admins the org's.

### Expenses and approvals

```
 DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──(Phase 3 ledger)──▶ REIMBURSED
   ▲                   │
   └──edit── REJECTED ◀┘ reject (comment required)
```

The whole lifecycle is one table in `src/modules/expenses/workflow.ts`, and every (status, action) pair is unit-tested. Every change goes through one function that, **in a single database transaction**:

1. checks visibility (an expense outside your scope is a 404, not a 403, so ids can't be probed);
2. checks who may act: only the submitter edits or submits; only an approver decides, **never on their own expense**. A manager's expense goes to finance, and finance's to their team manager;
3. checks the workflow allows the move;
4. writes with **optimistic locking**, `UPDATE … WHERE id = ? AND version = ?`. If two approvers click at once, exactly one row matches; the other gets 409 and nothing of theirs is written;
5. records the approval, an **audit** entry, and an **outbox** event (`expense.submitted`, `expense.approved`, …) for the Phase 3 ledger.

Card expenses take their amount, currency and date from the bank transaction, and those can't be edited. Each transaction can be expensed once (a unique index settles races). Creating an expense needs an `Idempotency-Key`, so a double-submitted form makes one expense.

The "New expense" form keeps its draft in **Redux** (client state that survives navigation); everything from the server goes through **TanStack Query** or server components.

### Roles

| | Employee | Manager | Finance admin |
|---|---|---|---|
| Own transactions and expenses | ✓ | ✓ | ✓ |
| Approve expenses | | their team's, not their own | anyone's, not their own |
| Connect and sync own banks | ✓ | ✓ | ✓ |
| Whole org | | | read, approve, reimburse (never their own) |
| Policies, audit log, `/admin` | | | ✓ |

The full matrix lives in `src/modules/auth/rbac.ts`, and `tests/unit/rbac.test.ts` tests every cell.

## Stack

Next.js 16 (App Router, TypeScript strict) · PostgreSQL 16 + Prisma 7 · Better Auth · Plaid (sandbox) · jose · TanStack Query (server state) · Redux Toolkit (client state) · Tailwind CSS 4 · Zod · pino · Jest + React Testing Library · Playwright · GitHub Actions

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

The seed also creates a **"Demo Bank"** card with 30 transactions for Emma, Eli, Marcus and Sam, so the app has data without Plaid keys (demo banks are never synced with Plaid), plus 7 **demo expenses** in every state: Marcus has two of his team's to approve, Fiona has Marcus's, and Emma has an approved, a rejected and a draft one.

### Connecting a real sandbox bank

1. Put your sandbox keys in `.env` (`PLAID_CLIENT_ID`, `PLAID_SECRET`).
2. **Bank accounts → Connect a bank** → pick any bank → username `user_transactions_dynamic`, any password.
3. Click **Sync now** after a few seconds (Plaid needs a moment to prepare transactions).

To receive **webhooks** locally, expose port 3000 with a tunnel and set `PLAID_WEBHOOK_URL`, then connect a new bank:

```bash
cloudflared tunnel --url http://localhost:3000     # prints https://<random>.trycloudflare.com
# .env: PLAID_WEBHOOK_URL="https://<random>.trycloudflare.com/api/webhooks/plaid"
pnpm plaid:sandbox list
pnpm plaid:sandbox add-transactions <itemId>        # Plaid then sends SYNC_UPDATES_AVAILABLE
pnpm plaid:sandbox fire-webhook <itemId>            # or trigger it directly
```

## Tests

```bash
pnpm test                 # unit + component (Jest, React Testing Library)
pnpm test:integration     # against TEST_DATABASE_URL (migrate it first, see below)
pnpm build && pnpm test:e2e   # Playwright against a production build
```

Before the first integration run, migrate the test database:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/spendwise_test" pnpm db:deploy
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
| `plaid:sandbox` | Sandbox helpers: `list`, `add-transactions <id>`, `fire-webhook <id>` |
