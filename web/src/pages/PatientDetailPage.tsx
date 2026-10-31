import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus, PencilSimple, CalendarBlank } from '@phosphor-icons/react';
import { ApiError } from '../api/client';
import { getPatient, type Patient } from '../api/patients';
import {
  listPatientTreatments,
  type Treatment,
} from '../api/treatments';
import './PatientsPage.css';
import './Treatments.css';

function formatBirthDate(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat('pt-BR').format(new Date(y, m - 1, d));
}

function formatStartsAt(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function schemeLabel(t: Treatment) {
  if (t.scheduleMode === 'regular_interval') {
    return `A cada ${t.intervalHours}h`;
  }
  return (t.timesOfDay ?? []).join(', ');
}

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [treatments, setTreatments] = useState<Treatment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [p, list] = await Promise.all([
        getPatient(id),
        listPatientTreatments(id),
      ]);
      setPatient(p);
      setTreatments(list);
    } catch (err) {
      setPatient(null);
      setTreatments([]);
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível carregar o paciente.',
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!id) {
    return (
      <p className="patients-alert" role="alert">
        Paciente inválido.
      </p>
    );
  }

  return (
    <div className="patients-page">
      <div className="patients-toolbar">
        <div>
          <p className="patients-toolbar__hint">
            <Link to="/pacientes">Pacientes</Link>
            {patient ? ` / ${patient.name}` : ''}
          </p>
          {patient ? (
            <>
              <h1 className="treatments-title">{patient.name}</h1>
              <p className="patients-row__meta">
                Nascimento {formatBirthDate(patient.birthDate)} · Sono{' '}
                {patient.sleepStart}–{patient.sleepEnd}
              </p>
            </>
          ) : null}
        </div>
        <div className="patients-row__actions">
          {patient ? (
            <Link
              to={`/pacientes/${patient.id}/editar`}
              className="patients-btn patients-btn--secondary"
            >
              <PencilSimple weight="bold" size={18} aria-hidden="true" />
              Editar
            </Link>
          ) : null}
          <Link
            to={`/pacientes/${id}/tratamentos/novo`}
            className="patients-btn patients-btn--primary"
          >
            <Plus weight="bold" size={18} aria-hidden="true" />
            Adicionar medicamento
          </Link>
        </div>
      </div>

      {error ? (
        <p className="patients-alert" role="alert">
          {error}
        </p>
      ) : null}

      <section className="portal-card">
        <h2 className="treatments-section-title">Tratamentos</h2>
        {treatments === null ? (
          <p className="portal-card__body">Carregando…</p>
        ) : treatments.length === 0 ? (
          <div className="patients-empty">
            <p className="portal-card__body">
              Nenhum tratamento ainda. Vincule um medicamento a este paciente
              para gerar a grade de doses.
            </p>
            <Link
              to={`/pacientes/${id}/tratamentos/novo`}
              className="patients-btn patients-btn--primary"
            >
              <Plus weight="bold" size={18} aria-hidden="true" />
              Adicionar medicamento
            </Link>
          </div>
        ) : (
          <div className="treatments-list">
            {treatments.map((t) => (
              <article key={t.id} className="treatments-row">
                <div>
                  <h3 className="treatments-row__name">
                    {t.medicationName ?? 'Medicamento'}
                    <span
                      className={`treatments-tag treatments-tag--${t.status}`}
                    >
                      {t.status === 'active' ? 'ativo' : 'encerrado'}
                    </span>
                  </h3>
                  <p className="patients-row__meta">
                    {t.doseQuantity} · {t.route} · {schemeLabel(t)} · início{' '}
                    {formatStartsAt(t.startsAt)}
                    {t.endsOn ? ` · até ${t.endsOn}` : ' · contínuo'}
                    {t.alarmsEnabled ? ' · alarmes on' : ' · alarmes off'}
                  </p>
                </div>
                <div className="patients-row__actions">
                  <Link
                    to={`/tratamentos/${t.id}/grade`}
                    className="patients-btn patients-btn--primary"
                  >
                    <CalendarBlank weight="bold" size={18} aria-hidden="true" />
                    Grade
                  </Link>
                  <Link
                    to={`/tratamentos/${t.id}`}
                    className="patients-btn patients-btn--secondary"
                  >
                    Detalhe
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
