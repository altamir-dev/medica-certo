-- PR5: treatments + scheduled_doses (R4–R6)
CREATE TABLE IF NOT EXISTS treatments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  medication_id uuid NOT NULL REFERENCES medications (id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_on date NULL,
  ended_at timestamptz NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'ended')),
  dose_quantity text NOT NULL,
  route text NOT NULL,
  schedule_mode text NOT NULL
    CHECK (schedule_mode IN ('regular_interval', 'custom_times')),
  interval_hours int NULL
    CHECK (interval_hours IS NULL OR interval_hours > 0),
  times_of_day time[] NULL,
  alarms_enabled boolean NOT NULL DEFAULT true,
  generated_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT treatments_dose_quantity_not_blank CHECK (length(btrim(dose_quantity)) > 0),
  CONSTRAINT treatments_route_not_blank CHECK (length(btrim(route)) > 0),
  CONSTRAINT treatments_regular_payload CHECK (
    schedule_mode <> 'regular_interval' OR interval_hours IS NOT NULL
  ),
  CONSTRAINT treatments_custom_payload CHECK (
    schedule_mode <> 'custom_times'
    OR (times_of_day IS NOT NULL AND cardinality(times_of_day) >= 1)
  )
);

CREATE TABLE IF NOT EXISTS scheduled_doses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id uuid NOT NULL REFERENCES treatments (id) ON DELETE CASCADE,
  caregiver_id uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'administered', 'skipped', 'cancelled')),
  administered_at timestamptz NULL,
  alarm_at timestamptz NULL,
  alarm_sent_at timestamptz NULL,
  snooze_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (treatment_id, scheduled_at)
);

CREATE INDEX IF NOT EXISTS treatments_caregiver_status_idx
  ON treatments (caregiver_id, status);

CREATE INDEX IF NOT EXISTS treatments_patient_idx
  ON treatments (patient_id);

CREATE INDEX IF NOT EXISTS scheduled_doses_dashboard_idx
  ON scheduled_doses (caregiver_id, status, scheduled_at);

CREATE INDEX IF NOT EXISTS scheduled_doses_treatment_idx
  ON scheduled_doses (treatment_id, scheduled_at);

CREATE INDEX IF NOT EXISTS scheduled_doses_alarm_claim_idx
  ON scheduled_doses (alarm_at)
  WHERE alarm_sent_at IS NULL AND status = 'pending';
