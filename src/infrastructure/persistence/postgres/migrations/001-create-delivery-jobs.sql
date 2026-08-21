CREATE TABLE IF NOT EXISTS delivery_jobs (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  pickup_address TEXT NOT NULL,
  pickup_latitude DOUBLE PRECISION NOT NULL CHECK (pickup_latitude BETWEEN -90 AND 90),
  pickup_longitude DOUBLE PRECISION NOT NULL CHECK (pickup_longitude BETWEEN -180 AND 180),
  dropoff_address TEXT NOT NULL,
  dropoff_latitude DOUBLE PRECISION NOT NULL CHECK (dropoff_latitude BETWEEN -90 AND 90),
  dropoff_longitude DOUBLE PRECISION NOT NULL CHECK (dropoff_longitude BETWEEN -180 AND 180),
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('PARCEL', 'FOOD', 'DOCUMENT', 'OTHER')),
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT', 'REQUESTED', 'QUOTING', 'BOOKED', 'SEARCHING_FOR_PROVIDER',
    'PROVIDER_ASSIGNED', 'PROVIDER_ACCEPTED', 'ARRIVING_FOR_PICKUP',
    'PICKED_UP', 'IN_TRANSIT', 'ARRIVING', 'DELIVERED', 'CANCELLED'
  )),
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);