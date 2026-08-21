CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  delivery_job_id TEXT NOT NULL UNIQUE REFERENCES delivery_jobs(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_creation_keys (
  idempotency_key TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  operation TEXT NOT NULL CHECK (operation IN ('INITIATE', 'CONFIRM', 'FAIL', 'CANCEL')),
  idempotency_key TEXT NOT NULL,
  provider_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (payment_id, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS payment_attempts_payment_idx ON payment_attempts (payment_id, created_at DESC);
