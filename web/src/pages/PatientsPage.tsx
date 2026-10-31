import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, PencilSimple, Trash } from '@phosphor-icons/react';
import { ApiError } from '../api/client';
import {
  deletePatient,
  listPatients,
  type Patient,
} from '../api/patients';
import './PatientsPage.css';

function formatBirthDate(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat('pt-BR').format(new Date(y, m - 1, d));
}

export function PatientsPage() {
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listPatients();
      setPatients(data);
    } catch (err) {
      setPatients([]);
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível carregar os pacientes.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(patient: Patient) {
    const ok = window.confirm(
      `Excluir o paciente “${patient.name}”? Esta ação não pode ser desfeita.`,
    );
    if (!ok) return;

    setDeletingId(patient.id);
    setError(null);
    try {
      await deletePatient(patient.id);
      setPatients((prev) =>
        (prev ?? []).filter((item) => item.id !== patient.id),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível excluir o paciente.',
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="patients-page">
      <div className="patients-toolbar">
        <p className="patients-toolbar__hint">
          Cadastre quem recebe os medicamentos. A janela de sono entra na
          sugestão da 1ª dose.
        </p>
        <Link to="/pacientes/novo" className="patients-btn patients-btn--primary">
          <Plus weight="bold" size={18} aria-hidden="true" />
          Novo paciente
        </Link>
      </div>

      {error ? (
        <p className="patients-alert" role="alert">
          {error}
        </p>
      ) : null}

      {patients === null ? (
        <section className="portal-card">
          <p className="portal-card__body">Carregando pacientes…</p>
        </section>
      ) : patients.length === 0 ? (
        <section className="portal-card patients-empty">
          <h2 className="patients-empty__title">Nenhum paciente ainda</h2>
          <p className="portal-card__body">
            Cadastre o primeiro paciente para organizar tratamentos e a grade
            de doses.
          </p>
          <Link
            to="/pacientes/novo"
            className="patients-btn patients-btn--primary"
          >
            <Plus weight="bold" size={18} aria-hidden="true" />
            Cadastrar paciente
          </Link>
        </section>
      ) : (
        <div className="patients-list">
          {patients.map((patient) => (
            <article key={patient.id} className="portal-card patients-row">
              <div className="patients-row__main">
                <h2 className="patients-row__name">
                  <Link to={`/pacientes/${patient.id}`}>{patient.name}</Link>
                </h2>
                <p className="patients-row__meta">
                  Nascimento {formatBirthDate(patient.birthDate)} · Sono{' '}
                  {patient.sleepStart}–{patient.sleepEnd}
                  {patient.access === 'grantee' ? ' · compartilhado' : ''}
                </p>
              </div>
              <div className="patients-row__actions">
                <Link
                  to={`/pacientes/${patient.id}`}
                  className="patients-btn patients-btn--primary"
                >
                  Abrir
                </Link>
                {patient.access !== 'grantee' ? (
                  <>
                <Link
                  to={`/pacientes/${patient.id}/editar`}
                  className="patients-btn patients-btn--secondary"
                >
                  <PencilSimple weight="bold" size={18} aria-hidden="true" />
                  Editar
                </Link>
                <button
                  type="button"
                  className="patients-btn patients-btn--danger"
                  disabled={deletingId === patient.id}
                  onClick={() => {
                    void handleDelete(patient);
                  }}
                >
                  <Trash weight="bold" size={18} aria-hidden="true" />
                  {deletingId === patient.id ? 'Excluindo…' : 'Excluir'}
                </button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
