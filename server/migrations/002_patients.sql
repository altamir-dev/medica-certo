-- PR3: patients (R2)
CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  name text NOT NULL,
  birth_date date NOT NULL,
  sleep_start time NOT NULL DEFAULT '22:00',
  sleep_end time NOT NULL DEFAULT '07:00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patients_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS patients_caregiver_idx ON patients (caregiver_id);
CREATE INDEX IF NOT EXISTS patients_caregiver_name_idx ON patients (caregiver_id, lower(name));
