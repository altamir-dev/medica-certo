-- PR8/PR9: Web Push subscriptions per caregiver
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id text PRIMARY KEY,
  caregiver_id uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  label text,
  ua text,
  fails int NOT NULL DEFAULT 0,
  last_ok_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (caregiver_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_caregiver_idx
  ON push_subscriptions (caregiver_id);
