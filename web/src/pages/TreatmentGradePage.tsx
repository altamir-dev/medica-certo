import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  listTreatmentDoses,
  type ScheduledDose,
  type Treatment,
} from '../api/treatments';
import './PatientsPage.css';
import './Treatments.css';

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function doseTag(dose: ScheduledDose, now: Date) {
  if (dose.status === 'cancelled') {
    return { label: 'cancelada', className: 'treatments-tag--cancelled' };
  }
  if (dose.status === 'administered') {
    return { label: 'administrada', className: 'treatments-tag--active' };
  }
  if (dose.status === 'skipped') {
    return { label: 'pulada', className: 'treatments-tag--ended' };
  }
  if (new Date(dose.scheduledAt).getTime() < now.getTime()) {
    return { label: 'atrasada', className: 'treatments-tag--overdue' };
  }
  return { label: 'pendente', className: 'treatments-tag--pending' };
}

export function TreatmentGradePage() {
  const { id } = useParams<{ id: string }>();
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [doses, setDoses] = useState<ScheduledDose[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await listTreatmentDoses(id);
      setTreatment(data.treatment);
      setDoses(data.doses);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível carregar a grade.',
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

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
                {' / '}
                <Link to={`/tratamentos/${treatment.id}`}>
                  {treatment.medicationName ?? 'Tratamento'}
                </Link>
                {' / grade'}
              </>
            ) : (
              'Grade de doses'
            )}
          </p>
          <h1 className="treatments-title">
            Grade — {treatment?.medicationName ?? '…'}
          </h1>
          {treatment ? (
            <p className="patients-row__meta">
              {treatment.doseQuantity} · {treatment.route}
              {treatment.alarmsEnabled ? ' · alarmes on' : ' · alarmes off'}
            </p>
          ) : null}
        </div>
        {treatment ? (
          <Link
            to={`/tratamentos/${treatment.id}`}
            className="patients-btn patients-btn--secondary"
          >
            Detalhe
          </Link>
        ) : null}
      </div>

      {error ? (
        <p className="patients-alert" role="alert">
          {error}
        </p>
      ) : null}

      <section className="portal-card">
        {doses.length === 0 && !error ? (
          <p className="portal-card__body">Nenhuma dose na grade.</p>
        ) : (
          <>
            <table className="treatments-grade-table">
              <thead>
                <tr>
                  <th>Horário previsto</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {doses.map((dose) => {
                  const tag = doseTag(dose, now);
                  return (
                    <tr key={dose.id}>
                      <td>{formatWhen(dose.scheduledAt)}</td>
                      <td>
                        <span className={`treatments-tag ${tag.className}`}>
                          {tag.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="treatments-grade-cards">
              {doses.map((dose) => {
                const tag = doseTag(dose, now);
                return (
                  <li key={dose.id} className="treatments-grade-card">
                    <span className="treatments-grade-card__when">
                      {formatWhen(dose.scheduledAt)}
                    </span>
                    <span className={`treatments-tag ${tag.className}`}>
                      {tag.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
