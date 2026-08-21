CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  availability TEXT NOT NULL CHECK (availability IN ('OFFLINE', 'AVAILABLE', 'BUSY', 'SUSPENDED')),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS dispatch_jobs (
  id TEXT PRIMARY KEY,
  delivery_job_id TEXT NOT NULL UNIQUE REFERENCES delivery_jobs(id),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SEARCHING', 'PROVIDER_ASSIGNED', 'PROVIDER_ACCEPTED', 'PROVIDER_REJECTED', 'COMPLETED', 'CANCELLED')),
  assigned_provider_id TEXT REFERENCES providers(id),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS dispatch_jobs_provider_idx ON dispatch_jobs (assigned_provider_id);