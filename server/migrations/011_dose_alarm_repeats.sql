-- Repetir o push da dose enquanto ela segue pendente e sem soneca.
-- send_count = 1 no primeiro envio; last_sent_at é o relógio do intervalo.

ALTER TABLE dose_alarm_receipts
  ADD COLUMN IF NOT EXISTS send_count integer NOT NULL DEFAULT 1;

ALTER TABLE dose_alarm_receipts
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;

UPDATE dose_alarm_receipts
SET last_sent_at = sent_at
WHERE last_sent_at IS NULL;

ALTER TABLE dose_alarm_receipts
  ALTER COLUMN last_sent_at SET DEFAULT now();

ALTER TABLE dose_alarm_receipts
  ALTER COLUMN last_sent_at SET NOT NULL;

ALTER TABLE dose_alarm_receipts
  DROP CONSTRAINT IF EXISTS dose_alarm_receipts_send_count_pos;

ALTER TABLE dose_alarm_receipts
  ADD CONSTRAINT dose_alarm_receipts_send_count_pos CHECK (send_count >= 1);

-- O índice antigo só cobre alarm_sent_at IS NULL. A repetição também
-- seleciona doses já enviadas e ainda pendentes.
CREATE INDEX IF NOT EXISTS scheduled_doses_alarm_due_idx
  ON scheduled_doses (alarm_at)
  WHERE status = 'pending' AND alarm_at IS NOT NULL;
