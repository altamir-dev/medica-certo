import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarBlank } from '@phosphor-icons/react';
import { ApiError } from '../api/client';
import {
  endTreatment,
  getTreatment,
  type Treatment,
} from '../api/treatments';
import {
  EndTreatmentDialog,
  RemoveTreatmentDialog,
} from './TreatmentStopDialogs';
import './PatientsPage.css';
import './Treatments.css';

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function formatEndedOn(iso: string | null) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function schemeLabel(t: Treatment) {
  if (t.scheduleMode === 'regular_interval') {
    return `Intervalo regular a cada ${t.intervalHours}h`;
  }
  return `Horários customizados: ${(t.timesOfDay ?? []).join(', ')}`;
}

export function TreatmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [stopMode, setStopMode] = useState<'end' | 'remove' | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setTreatment(await getTreatment(id));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível carregar o tratamento.',
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRecreate() {
    if (!treatment) return;
    if (treatment.status === 'active') {
      const ok = window.confirm(
        'Encerrar o tratamento atual (término hoje, sem motivo) e abrir um novo com o mesmo medicamento? O histórico deste tratamento permanece.',
      );
      if (!ok) return;
      setEnding(true);
      try {
        await endTreatment(treatment.id);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Não foi possível encerrar.',
        );
        setEnding(false);
        return;
      }
      setEnding(false);
    }
    navigate(
      `/pacientes/${treatment.patientId}/tratamentos/novo?medicationId=${encodeURIComponent(treatment.medicationId)}`,
    );
  }

  return (
    <div className="patients-page">
      <div className="patients-toolbar">
        <div>
          <p className="patients-toolbar__hint">
            {treatment ? (
              <>
                <Link to={`/pacientes/${treatment.patientId}`}>
                  {treatment.patientName ?? 'Paciente'}
                </Link>
                {' / tratamento'}
              </>
            ) : (
              'Tratamento'
            )}
          </p>
          <h1 className="treatments-title">
            {treatment?.medicationName ?? '…'}
          </h1>
        </div>
        {treatment ? (
          <Link
            to={`/tratamentos/${treatment.id}/grade`}
            className="patients-btn patients-btn--primary"
          >
            <CalendarBlank weight="bold" size={18} aria-hidden="true" />
            Ver grade
          </Link>
        ) : null}
      </div>

      {error ? (
        <p className="patients-alert" role="alert">
          {error}
        </p>
      ) : null}

      {treatment ? (
        <section className="portal-card treatments-form">
          <p>
            <strong>Status:</strong>{' '}
            <span
              className={`treatments-tag treatments-tag--${treatment.status}`}
            >
              {treatment.status === 'active' ? 'ativo' : 'encerrado'}
            </span>
          </p>
          <p>
            <strong>Quantidade:</strong> {treatment.doseQuantity}
          </p>
          <p>
            <strong>Via:</strong> {treatment.route}
          </p>
          <p>
            <strong>Esquema:</strong> {schemeLabel(treatment)}
          </p>
          <p>
            <strong>Início:</strong> {formatWhen(treatment.startsAt)}
          </p>
          <p>
            <strong>Fim previsto:</strong>{' '}
            {treatment.endsOn ?? 'contínuo'}
          </p>
          {treatment.status === 'ended' ? (
            <>
              <p>
                <strong>Término:</strong> {formatEndedOn(treatment.endedAt)}
              </p>
              <p>
                <strong>Motivo:</strong> {treatment.endReason ?? '—'}
              </p>
            </>
          ) : null}
          <p>
            <strong>Alarmes:</strong>{' '}
            {treatment.alarmsEnabled ? 'ativos' : 'desligados'}
          </p>

          <div className="treatments-actions">
            {treatment.status === 'active' ? (
              <button
                type="button"
                className="patients-btn patients-btn--primary"
                disabled={ending}
                onClick={() => setStopMode('end')}
              >
                Encerrar tratamento
              </button>
            ) : null}
            <button
              type="button"
              className="patients-btn patients-btn--secondary"
              disabled={ending}
              onClick={() => {
                void onRecreate();
              }}
            >
              Encerrar e recriar
            </button>
            <button
              type="button"
              className="patients-btn patients-btn--danger"
              disabled={ending}
              onClick={() => setStopMode('remove')}
            >
              Remover
            </button>
          </div>
        </section>
      ) : null}

      {treatment && stopMode === 'end' ? (
        <EndTreatmentDialog
          treatment={treatment}
          onClose={() => setStopMode(null)}
          onEnded={(updated) => {
            setTreatment(updated);
            setStopMode(null);
          }}
        />
      ) : null}
      {treatment && stopMode === 'remove' ? (
        <RemoveTreatmentDialog
          treatment={treatment}
          onClose={() => setStopMode(null)}
          onRemoved={() => {
            navigate(`/pacientes/${treatment.patientId}`);
          }}
        />
      ) : null}
    </div>
  );
}
