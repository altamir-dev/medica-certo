-- Convites de uso único. Cuidadores já existentes permanecem;
-- o mais antigo vira administrador se ainda não houver nenhum.

ALTER TABLE caregivers
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

UPDATE caregivers AS c
SET is_admin = true
WHERE c.id = (
  SELECT id
  FROM caregivers
  ORDER BY created_at ASC, id ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM caregivers WHERE is_admin = true
);

CREATE TABLE IF NOT EXISTS caregiver_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  email citext,
  created_by uuid NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid REFERENCES caregivers (id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caregiver_invites_email_len CHECK (
    email IS NULL OR char_length(email::text) BETWEEN 1 AND 200
  ),
  CONSTRAINT caregiver_invites_token_hash_hex CHECK (
    token_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS caregiver_invites_created_by_idx
  ON caregiver_invites (created_by, created_at DESC);
