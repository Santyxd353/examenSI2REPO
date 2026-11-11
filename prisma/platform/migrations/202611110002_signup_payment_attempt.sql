-- Attempt zero retains the idempotency key used by existing pending checkouts.
ALTER TABLE platform.signup ADD COLUMN payment_attempt integer NOT NULL DEFAULT 0
  CHECK (payment_attempt >= 0);
