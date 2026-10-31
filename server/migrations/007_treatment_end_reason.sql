-- Motivo opcional ao encerrar um tratamento. Linhas existentes ficam com NULL.
ALTER TABLE treatments
  ADD COLUMN IF NOT EXISTS end_reason text NULL;

ALTER TABLE treatments
  ADD CONSTRAINT treatments_end_reason_len
  CHECK (
    end_reason IS NULL
    OR (
      char_length(btrim(end_reason)) > 0
      AND char_length(end_reason) <= 500
    )
  );
