-- PR4: medications (R3)
CREATE TABLE IF NOT EXISTS medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  name text NOT NULL,
  active_ingredient text,
  indication text,
  reference_posology text,
  usual_interval_hours int NULL,
  photo_path text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medications_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS medications_caregiver_name_uidx
  ON medications (caregiver_id, lower(name));
