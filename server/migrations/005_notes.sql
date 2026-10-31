-- PR7 partial: notes for dose administration
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  treatment_id uuid NULL REFERENCES treatments (id) ON DELETE CASCADE,
  scheduled_dose_id uuid NULL REFERENCES scheduled_doses (id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notes_body_not_blank CHECK (length(btrim(body)) > 0),
  CONSTRAINT notes_has_target CHECK (
    treatment_id IS NOT NULL OR scheduled_dose_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS notes_dose_idx ON notes (scheduled_dose_id);
CREATE INDEX IF NOT EXISTS notes_treatment_idx ON notes (treatment_id);
