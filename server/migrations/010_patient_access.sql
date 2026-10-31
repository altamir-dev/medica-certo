-- Shared patient access: grantee caregivers see and record doses on owner patients.

CREATE TABLE IF NOT EXISTS patient_access (
  patient_id uuid NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  caregiver_id uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, caregiver_id),
  CONSTRAINT patient_access_grantee_not_owner CHECK (caregiver_id <> granted_by)
);

CREATE INDEX IF NOT EXISTS patient_access_caregiver_idx
  ON patient_access (caregiver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS patient_access_granted_by_idx
  ON patient_access (granted_by, caregiver_id);

CREATE TABLE IF NOT EXISTS invite_patients (
  invite_id uuid NOT NULL REFERENCES caregiver_invites (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  PRIMARY KEY (invite_id, patient_id)
);

CREATE INDEX IF NOT EXISTS invite_patients_patient_idx
  ON invite_patients (patient_id);

CREATE TABLE IF NOT EXISTS dose_alarm_receipts (
  scheduled_dose_id uuid NOT NULL REFERENCES scheduled_doses (id) ON DELETE CASCADE,
  caregiver_id uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scheduled_dose_id, caregiver_id)
);

CREATE INDEX IF NOT EXISTS dose_alarm_receipts_caregiver_idx
  ON dose_alarm_receipts (caregiver_id, sent_at DESC);
