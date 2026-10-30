import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  createPatient,
  getPatient,
  updatePatient,
} from '../api/patients';
import './PatientsPage.css';

type Mode = 'create' | 'edit';

export function PatientFormPage() {
  const { id } = useParams<{ id: string }>();
  const mode: Mode = id ? 'edit' : 'create';
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [sleepStart, setSleepStart] = useState('22:00');
  const [sleepEnd, setSleepEnd] = useState('07:00');
  const [loading, setLoading] = useState(mode === 'edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (mode !== 'edit' || !id) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const patient = await getPatient(id!);
        if (cancelled) return;
        setName(patient.name);
        setBirthDate(patient.birthDate);
        setSleepStart(patient.sleepStart);
        setSleepEnd(patient.sleepEnd);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Não foi possível carregar o paciente.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [mode, id]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    const payload = {
      name: name.trim(),
      birthDate,
      sleepStart,
      sleepEnd,
    };

    try {
      if (mode === 'create') {
        await createPatient(payload);
      } else if (id) {
        await updatePatient(id, payload);
      }
      navigate('/pacientes', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields) setFieldErrors(err.fields);
        setError(err.message);
      } else {
        setError('Não foi possível salvar. Tente de novo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="portal-card">
        <p className="portal-card__body">Carregando paciente…</p>
      </section>
    );
  }

  return (
    <div className="patients-page">
      <section className="portal-card">
        <h2 className="portal-card__title">
          {mode === 'create' ? 'Novo paciente' : 'Editar paciente'}
        </h2>
        <p className="portal-card__body">
          Nome e data de nascimento são obrigatórios. Sem janela de sono
          informada, usamos 22:00–07:00.
        </p>

        <form className="patients-form" onSubmit={onSubmit} noValidate>
          <label className="patients-field">
            <span>Nome</span>
            <input
              className={`patients-input${fieldErrors.name ? ' is-error' : ''}`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              maxLength={120}
            />
            {fieldErrors.name ? (
              <span className="patients-field__error">{fieldErrors.name}</span>
            ) : null}
          </label>

          <label className="patients-field">
            <span>Data de nascimento</span>
            <input
              className={`patients-input${
                fieldErrors.birthDate ? ' is-error' : ''
              }`}
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              required
            />
            {fieldErrors.birthDate ? (
              <span className="patients-field__error">
                {fieldErrors.birthDate}
              </span>
            ) : null}
          </label>

          <div className="patients-sleep-row">
            <label className="patients-field">
              <span>Início do sono</span>
              <input
                className={`patients-input${
                  fieldErrors.sleepStart ? ' is-error' : ''
                }`}
                type="time"
                value={sleepStart}
                onChange={(e) => setSleepStart(e.target.value)}
              />
              {fieldErrors.sleepStart ? (
                <span className="patients-field__error">
                  {fieldErrors.sleepStart}
                </span>
              ) : (
                <span className="patients-field__hint">Padrão 22:00</span>
              )}
            </label>

            <label className="patients-field">
              <span>Fim do sono</span>
              <input
                className={`patients-input${
                  fieldErrors.sleepEnd ? ' is-error' : ''
                }`}
                type="time"
                value={sleepEnd}
                onChange={(e) => setSleepEnd(e.target.value)}
              />
              {fieldErrors.sleepEnd ? (
                <span className="patients-field__error">
                  {fieldErrors.sleepEnd}
                </span>
              ) : (
                <span className="patients-field__hint">Padrão 07:00</span>
              )}
            </label>
          </div>

          {error ? (
            <p className="patients-alert" role="alert">
              {error}
            </p>
          ) : null}

          <div className="patients-form__actions">
            <button
              type="submit"
              className="patients-btn patients-btn--primary"
              disabled={submitting}
            >
              {submitting ? 'Salvando…' : 'Salvar'}
            </button>
            <Link
              to="/pacientes"
              className="patients-btn patients-btn--secondary"
            >
              Cancelar
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
