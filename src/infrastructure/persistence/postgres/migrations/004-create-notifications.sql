CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('IN_APP', 'PUSH', 'SMS', 'EMAIL')),
  template_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED')),
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_creation_keys (
  idempotency_key TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL UNIQUE REFERENCES notifications(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_attempts (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'SENT', 'FAILED')),
  provider_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_operation_keys (
  notification_id TEXT NOT NULL REFERENCES notifications(id),
  operation TEXT NOT NULL CHECK (operation IN ('SEND', 'RETRY', 'CANCEL')),
  idempotency_key TEXT NOT NULL,
  attempt_id TEXT UNIQUE REFERENCES notification_attempts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS notification_attempts_notification_idx
  ON notification_attempts (notification_id, created_at DESC);
