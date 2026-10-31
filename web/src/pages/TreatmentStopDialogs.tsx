import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../api/client';
import {
  deleteTreatment,
  endTreatment,
  type Treatment,
} from '../api/treatments';
import './PatientSheet.css';
import './PatientsPage.css';
import './Treatments.css';

function todaySaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function startDay(treatment: Treatment) {
  return treatment.startsAt.slice(0, 10);
}

function medicationLabel(treatment: Treatment) {
  return treatment.medicationName ?? 'este medicamento';
}

export function EndTreatmentDialog({
  treatment,
  onClose,
  onEnded,
}: {
  treatment: Treatment;
  onClose: () => void;
  onEnded: (treatment: Treatment) => void;
}) {
  const today = todaySaoPaulo();
  const start = startDay(treatment);
  const min = start <= today ? start : today;
  const [endedOn, setEndedOn] = useState(today);
  const [endReason, setEndReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = medicationLabel(treatment);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await endTreatment(treatment.id, {
        endedOn,
        endReason: endReason.trim() ? endReason.trim() : null,
      });
      onEnded(updated);
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : undefined;
      setError(
        fields?.endedOn ||
          fields?.endReason ||
          (err instanceof ApiError
            ? err.message
            : 'Não foi possível encerrar o tratamento.'),
      );
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="sheet-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="sheet-modal sheet-modal--stop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-treatment-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="end-treatment-title">Encerrar tratamento</h2>
        <p>
          {name} sai da lista ativa. Doses futuras pendentes são canceladas e
          o medicamento deixa de gerar lembretes, agendamentos e notificações.
          O histórico permanece.
        </p>
        <form onSubmit={(event) => void onSubmit(event)}>
          <label>
            Data de término
            <input
              type="date"
              value={endedOn}
              min={min}
              max={today}
              required
              onChange={(event) => setEndedOn(event.target.value)}
            />
          </label>
          <label>
            Motivo (opcional)
            <textarea
              value={endReason}
              maxLength={500}
              placeholder="Ex.: fim do antibiótico, troca de esquema…"
              onChange={(event) => setEndReason(event.target.value)}
            />
          </label>
          {error ? (
            <p className="patients-alert" role="alert">
              {error}
            </p>
          ) : null}
          <div className="sheet-modal__actions">
            <button
              type="button"
              className="patients-btn patients-btn--secondary"
              disabled={saving}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="patients-btn patients-btn--primary"
              disabled={saving}
            >
              {saving ? 'Encerrando…' : 'Encerrar tratamento'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export function RemoveTreatmentDialog({
  treatment,
  onClose,
  onRemoved,
}: {
  treatment: Treatment;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = medicationLabel(treatment);
  const patient = treatment.patientName ?? 'este paciente';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) {
      setError('Confirme que o histórico será apagado.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deleteTreatment(treatment.id);
      onRemoved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível remover o medicamento.',
      );
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="sheet-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="sheet-modal sheet-modal--stop"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-treatment-title"
        aria-describedby="remove-treatment-warning"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="remove-treatment-title">Remover medicamento</h2>
        <p id="remove-treatment-warning" className="treatments-stop-note">
          Use isto só se o cadastro foi feito por engano. O vínculo de {name}{' '}
          com {patient} será apagado de vez, junto com os horários, as doses
          registradas e as anotações. Não dá para desfazer.
        </p>
        <p>
          Para parar o uso e manter o histórico, feche esta janela e use
          Encerrar tratamento.
        </p>
        <form onSubmit={(event) => void onSubmit(event)}>
          <label className="sheet-modal__check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Entendo que o histórico deste medicamento será apagado
          </label>
          {error ? (
            <p className="patients-alert" role="alert">
              {error}
            </p>
          ) : null}
          <div className="sheet-modal__actions">
            <button
              type="button"
              className="patients-btn patients-btn--secondary"
              disabled={saving}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="patients-btn patients-btn--danger"
              disabled={saving || !confirmed}
            >
              {saving ? 'Removendo…' : 'Remover de vez'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
