-- Integrity rules Prisma's schema language can't express.
-- Prisma's migration diff ignores triggers and CHECK constraints, so these
-- won't be dropped by future `prisma migrate dev` runs.

-- 1. AuditLog is append-only: reject every UPDATE and DELETE.
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

-- TRUNCATE skips row triggers, so block it with a statement trigger too.
CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutation();

-- 2. Money sanity checks.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amountCents_nonzero" CHECK ("amountCents" <> 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amountCents_positive" CHECK ("amountCents" > 0);

-- 3. Currency must be a 3-letter ISO 4217 code.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
