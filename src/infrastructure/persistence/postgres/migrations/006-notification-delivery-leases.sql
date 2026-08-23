ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS delivery_worker_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_lease_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS notifications_delivery_claim_idx
  ON notifications (status, delivery_lease_until, updated_at)
  WHERE status IN ('QUEUED', 'FAILED');
