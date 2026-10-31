-- Cadastro de medicamento por foto. A 008 já é a de convites.

ALTER TABLE caregivers
  ADD COLUMN IF NOT EXISTS ai_image_consent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ai_image_consent_provider text NULL,
  ADD COLUMN IF NOT EXISTS ai_image_consent_model text NULL;

ALTER TABLE medications
  ADD COLUMN IF NOT EXISTS concentration text NULL,
  ADD COLUMN IF NOT EXISTS presentation text NULL,
  ADD COLUMN IF NOT EXISTS anvisa_registry text NULL,
  ADD COLUMN IF NOT EXISTS catalog_origin text NOT NULL DEFAULT 'manual';

ALTER TABLE medications
  DROP CONSTRAINT IF EXISTS medications_catalog_origin_chk;
ALTER TABLE medications
  ADD CONSTRAINT medications_catalog_origin_chk
  CHECK (catalog_origin IN ('manual', 'ai_confirmed'));

ALTER TABLE medications
  DROP CONSTRAINT IF EXISTS medications_concentration_len;
ALTER TABLE medications
  ADD CONSTRAINT medications_concentration_len
  CHECK (concentration IS NULL OR char_length(concentration) BETWEEN 1 AND 80);

ALTER TABLE medications
  DROP CONSTRAINT IF EXISTS medications_presentation_len;
ALTER TABLE medications
  ADD CONSTRAINT medications_presentation_len
  CHECK (presentation IS NULL OR char_length(presentation) BETWEEN 1 AND 200);

ALTER TABLE medications
  DROP CONSTRAINT IF EXISTS medications_anvisa_registry_digits;
ALTER TABLE medications
  ADD CONSTRAINT medications_anvisa_registry_digits
  CHECK (anvisa_registry IS NULL OR anvisa_registry ~ '^\d{9}(\d{4})?$');

ALTER TABLE treatments
  ADD COLUMN IF NOT EXISTS posology_origin text NULL,
  ADD COLUMN IF NOT EXISTS posology_raw text NULL;

ALTER TABLE treatments
  DROP CONSTRAINT IF EXISTS treatments_posology_origin_chk;
ALTER TABLE treatments
  ADD CONSTRAINT treatments_posology_origin_chk
  CHECK (
    posology_origin IS NULL
    OR posology_origin IN ('manual', 'prescription_confirmed')
  );

ALTER TABLE treatments
  DROP CONSTRAINT IF EXISTS treatments_posology_raw_len;
ALTER TABLE treatments
  ADD CONSTRAINT treatments_posology_raw_len
  CHECK (
    posology_raw IS NULL OR char_length(posology_raw) BETWEEN 1 AND 500
  );

CREATE TABLE IF NOT EXISTS medication_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  patient_id uuid NULL REFERENCES patients (id) ON DELETE SET NULL,
  status text NOT NULL CHECK (
    status IN (
      'processing', 'ready', 'failed', 'confirmed', 'discarded', 'expired'
    )
  ),
  document_kind text NULL CHECK (
    document_kind IS NULL
    OR document_kind IN ('package', 'prescription', 'unknown')
  ),
  image_path text NOT NULL,
  image_sha256 text NOT NULL,
  mime_type text NOT NULL,
  error_code text NULL,
  model_provider text NULL,
  model_name text NULL,
  prompt_version text NULL,
  extracted jsonb NULL,
  candidates jsonb NULL,
  confirmed_medication_ids uuid[] NOT NULL DEFAULT '{}',
  confirmed_treatment_ids uuid[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  image_purge_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS medication_drafts_caregiver_status_idx
  ON medication_drafts (caregiver_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS medication_drafts_one_processing_idx
  ON medication_drafts (caregiver_id)
  WHERE status = 'processing';

CREATE TABLE IF NOT EXISTS medication_ai_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  draft_id uuid NULL REFERENCES medication_drafts (id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  latency_ms int NULL,
  http_status int NULL,
  outcome text NOT NULL CHECK (
    outcome IN ('pending', 'ok', 'invalid_output', 'timeout', 'http_error')
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS medication_ai_events_caregiver_created_idx
  ON medication_ai_events (caregiver_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  caregiver_id uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  request_count int NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  PRIMARY KEY (caregiver_id, usage_date)
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS anvisa_presentations (
  id bigserial PRIMARY KEY,
  registro text NOT NULL,
  registro_produto text,
  produto text NOT NULL,
  substancia text,
  apresentacao text,
  laboratorio text,
  ean text,
  tarja text,
  classe_terapeutica text,
  situacao_registro text,
  produto_norm text NOT NULL,
  substancia_norm text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS anvisa_presentations_produto_trgm
  ON anvisa_presentations USING gin (produto_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS anvisa_presentations_substancia_trgm
  ON anvisa_presentations USING gin (substancia_norm gin_trgm_ops);
