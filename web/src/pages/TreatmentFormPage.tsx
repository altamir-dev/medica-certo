import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { getPatient, type Patient } from '../api/patients';
import {
  getMedication,
  listMedications,
  type Medication,
} from '../api/medications';
import {
  ROUTE_OPTIONS,
  createTreatment,
  previewTreatment,
  suggestFirstDose,
  type PreviewResult,
  type ScheduleMode,
} from '../api/treatments';
import './PatientsPage.css';
import './Treatments.css';
import './MedicationsPage.css';

function toDatetimeLocalValue(isoOrDate: Date | string) {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const zoned = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) =>
    zoned.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function datetimeLocalToIso(local: string) {
  // Interpret as America/Sao_Paulo wall time → ISO with offset
  const [date, time] = local.split('T');
  if (!date || !time) return local;
  const hm = time.length === 5 ? `${time}:00` : time;
  // Use Temporal in browser if available; fallback offset -03:00 (BRT no DST since 2019)
  if (typeof Temporal !== 'undefined') {
    const zdt = Temporal.PlainDateTime.from(`${date}T${hm}`).toZonedDateTime(
      'America/Sao_Paulo',
    );
    return zdt.toString({ timeZoneName: 'never' });
  }
  return `${date}T${hm}-03:00`;
}

function formatDoseLabel(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

declare const Temporal: {
  PlainDateTime: {
    from: (s: string) => {
      toZonedDateTime: (tz: string) => {
        toString: (opts: { timeZoneName: string }) => string;
      };
    };
  };
};

export function TreatmentFormPage() {
  const { id: patientId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [medicationQuery, setMedicationQuery] = useState('');
  const [medResults, setMedResults] = useState<Medication[]>([]);
  const [medication, setMedication] = useState<Medication | null>(null);
  const [doseQuantity, setDoseQuantity] = useState('');
  const [route, setRoute] = useState('VO');
  const [scheduleMode, setScheduleMode] =
    useState<ScheduleMode>('regular_interval');
  const [intervalHours, setIntervalHours] = useState('8');
  const [timesOfDay, setTimesOfDay] = useState<string[]>([]);
  const [timeDraft, setTimeDraft] = useState('');
  const [startsAtLocal, setStartsAtLocal] = useState(() =>
    toDatetimeLocalValue(new Date()),
  );
  const [endsOn, setEndsOn] = useState('');
  const [alarmsEnabled, setAlarmsEnabled] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [suggestWarning, setSuggestWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const returnTo = useMemo(() => {
    if (!patientId) return '/pacientes';
    return `/pacientes/${patientId}/tratamentos/novo`;
  }, [patientId]);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const p = await getPatient(patientId!);
        if (cancelled) return;
        setPatient(p);

        const medId = searchParams.get('medicationId');
        if (medId) {
          const med = await getMedication(medId);
          if (!cancelled) {
            setMedication(med);
            setMedicationQuery(med.name);
            if (med.usualIntervalHours) {
              setIntervalHours(String(med.usualIntervalHours));
            }
            if (med.referencePosology) {
              setDoseQuantity(med.referencePosology);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : 'Não foi possível carregar o paciente.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [patientId, searchParams]);

  useEffect(() => {
    if (medicationQuery.trim().length < 1) {
      setMedResults([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void listMedications(medicationQuery.trim())
        .then((list) => {
          if (!cancelled) setMedResults(list);
        })
        .catch(() => {
          if (!cancelled) setMedResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [medicationQuery]);

  function selectMedication(med: Medication) {
    setMedication(med);
    setMedicationQuery(med.name);
    setMedResults([]);
    if (med.usualIntervalHours) {
      setIntervalHours(String(med.usualIntervalHours));
    }
    if (med.referencePosology && !doseQuantity) {
      setDoseQuantity(med.referencePosology);
    }
  }

  function addTime() {
    const t = timeDraft.trim();
    if (!/^\d{2}:\d{2}$/.test(t)) {
      setFieldErrors((f) => ({ ...f, timesOfDay: 'Use HH:MM.' }));
      return;
    }
    if (timesOfDay.includes(t)) {
      setFieldErrors((f) => ({ ...f, timesOfDay: 'Horário duplicado.' }));
      return;
    }
    setTimesOfDay([...timesOfDay, t].sort());
    setTimeDraft('');
    setFieldErrors((f) => {
      const next = { ...f };
      delete next.timesOfDay;
      return next;
    });
  }

  async function onSuggest() {
    setError(null);
    setSuggestWarning(null);
    try {
      const n = Number(intervalHours);
      const anchorDate = startsAtLocal.slice(0, 10);
      const result = await suggestFirstDose({
        intervalHours: n,
        patientId,
        anchorDate,
      });
      setStartsAtLocal(toDatetimeLocalValue(result.firstDoseAt));
      if (result.warning && result.warningMessage) {
        setSuggestWarning(result.warningMessage);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível sugerir o horário.',
      );
    }
  }

  async function onPreview() {
    setError(null);
    setFieldErrors({});
    try {
      const result = await previewTreatment({
        startsAt: datetimeLocalToIso(startsAtLocal),
        endsOn: endsOn || null,
        doseQuantity: doseQuantity || '1',
        route,
        scheduleMode,
        intervalHours:
          scheduleMode === 'regular_interval' ? Number(intervalHours) : null,
        timesOfDay: scheduleMode === 'custom_times' ? timesOfDay : null,
        alarmsEnabled,
      });
      setPreview(result);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setFieldErrors(err.fields);
      }
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível gerar a prévia.',
      );
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!patientId || !medication) {
      setFieldErrors({ medicationId: 'Escolha um medicamento.' });
      return;
    }
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const { treatment } = await createTreatment({
        patientId,
        medicationId: medication.id,
        startsAt: datetimeLocalToIso(startsAtLocal),
        endsOn: endsOn || null,
        doseQuantity,
        route,
        scheduleMode,
        intervalHours:
          scheduleMode === 'regular_interval' ? Number(intervalHours) : null,
        timesOfDay: scheduleMode === 'custom_times' ? timesOfDay : null,
        alarmsEnabled,
      });
      navigate(`/tratamentos/${treatment.id}/grade`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setFieldErrors(err.fields);
      }
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível salvar o tratamento.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="portal-card">
        <p className="portal-card__body">Carregando…</p>
      </section>
    );
  }

  const cadastroHref = `/medicamentos/novo?returnTo=${encodeURIComponent(returnTo)}&name=${encodeURIComponent(medicationQuery)}`;

  return (
    <div className="patients-page">
      <div className="patients-toolbar">
        <div>
          <p className="patients-toolbar__hint">
            <Link to="/pacientes">Pacientes</Link>
            {patient ? (
              <>
                {' / '}
                <Link to={`/pacientes/${patient.id}`}>{patient.name}</Link>
                {' / novo tratamento'}
              </>
            ) : null}
          </p>
          <h1 className="treatments-title">Adicionar medicamento</h1>
        </div>
      </div>

      {error ? (
        <p className="patients-alert" role="alert">
          {error}
        </p>
      ) : null}

      <form className="treatments-form portal-card" onSubmit={onSubmit}>
        <div className="treatments-field treatments-med-pick">
          <label htmlFor="med-search">Medicamento</label>
          <input
            id="med-search"
            className={fieldErrors.medicationId ? 'is-error' : ''}
            value={medicationQuery}
            onChange={(e) => {
              setMedicationQuery(e.target.value);
              setMedication(null);
            }}
            placeholder="Buscar por nome ou princípio ativo"
            autoComplete="off"
          />
          {fieldErrors.medicationId ? (
            <span className="treatments-field__error">
              {fieldErrors.medicationId}
            </span>
          ) : null}
          {medResults.length > 0 && !medication ? (
            <ul className="treatments-med-results">
              {medResults.map((med) => (
                <li key={med.id}>
                  <button type="button" onClick={() => selectMedication(med)}>
                    <strong>{med.name}</strong>
                    {med.activeIngredient
                      ? ` — ${med.activeIngredient}`
                      : ''}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {medication ? (
            <p className="patients-row__meta">
              Selecionado: <strong>{medication.name}</strong>
            </p>
          ) : (
            <p className="patients-row__meta">
              Não achou?{' '}
              <Link to={cadastroHref}>Cadastrar medicamento</Link>
            </p>
          )}
        </div>

        <div className="treatments-field">
          <label htmlFor="dose-qty">Quantidade da dose</label>
          <input
            id="dose-qty"
            className={fieldErrors.doseQuantity ? 'is-error' : ''}
            value={doseQuantity}
            onChange={(e) => setDoseQuantity(e.target.value)}
            placeholder="Ex.: 1 comprimido, 1 g, 20 gotas"
            required
          />
          {fieldErrors.doseQuantity ? (
            <span className="treatments-field__error">
              {fieldErrors.doseQuantity}
            </span>
          ) : null}
        </div>

        <div className="treatments-field">
          <label htmlFor="route">Via</label>
          <select
            id="route"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
          >
            {ROUTE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="treatments-field">
          <legend>Esquema de horários</legend>
          <div className="treatments-radio-row">
            <label className="treatments-radio">
              <input
                type="radio"
                name="scheduleMode"
                checked={scheduleMode === 'regular_interval'}
                onChange={() => setScheduleMode('regular_interval')}
              />
              Intervalo regular
            </label>
            <label className="treatments-radio">
              <input
                type="radio"
                name="scheduleMode"
                checked={scheduleMode === 'custom_times'}
                onChange={() => setScheduleMode('custom_times')}
              />
              Horários customizados
            </label>
          </div>
        </fieldset>

        {scheduleMode === 'regular_interval' ? (
          <div className="treatments-field">
            <label htmlFor="interval">A cada N horas</label>
            <input
              id="interval"
              type="number"
              min={1}
              className={fieldErrors.intervalHours ? 'is-error' : ''}
              value={intervalHours}
              onChange={(e) => setIntervalHours(e.target.value)}
              required
            />
            {fieldErrors.intervalHours ? (
              <span className="treatments-field__error">
                {fieldErrors.intervalHours}
              </span>
            ) : null}
            <div className="treatments-actions">
              <button
                type="button"
                className="patients-btn patients-btn--secondary"
                onClick={() => {
                  void onSuggest();
                }}
              >
                Sugerir 1ª dose (respeita sono)
              </button>
            </div>
            {suggestWarning ? (
              <p className="treatments-warning" role="status">
                {suggestWarning}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="treatments-field">
            <label htmlFor="time-draft">Horários do dia</label>
            <div className="treatments-times">
              <input
                id="time-draft"
                type="time"
                value={timeDraft}
                onChange={(e) => setTimeDraft(e.target.value)}
              />
              <button
                type="button"
                className="patients-btn patients-btn--secondary"
                onClick={addTime}
              >
                Adicionar
              </button>
              {timesOfDay.map((t) => (
                <span key={t} className="treatments-time-chip">
                  {t}
                  <button
                    type="button"
                    aria-label={`Remover ${t}`}
                    onClick={() =>
                      setTimesOfDay(timesOfDay.filter((x) => x !== t))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            {fieldErrors.timesOfDay ? (
              <span className="treatments-field__error">
                {fieldErrors.timesOfDay}
              </span>
            ) : null}
          </div>
        )}

        <div className="treatments-field">
          <label htmlFor="starts-at">Início (1ª dose)</label>
          <input
            id="starts-at"
            type="datetime-local"
            className={fieldErrors.startsAt ? 'is-error' : ''}
            value={startsAtLocal}
            onChange={(e) => setStartsAtLocal(e.target.value)}
            required
          />
        </div>

        <div className="treatments-field">
          <label htmlFor="ends-on">Data de fim (opcional)</label>
          <input
            id="ends-on"
            type="date"
            className={fieldErrors.endsOn ? 'is-error' : ''}
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
          <span className="patients-row__meta">
            Vazio = tratamento contínuo (janela rolante de 7 dias).
          </span>
        </div>

        <label className="treatments-check">
          <input
            type="checkbox"
            checked={alarmsEnabled}
            onChange={(e) => setAlarmsEnabled(e.target.checked)}
          />
          Ativar alarmes deste tratamento
        </label>

        <div className="treatments-actions">
          <button
            type="button"
            className="patients-btn patients-btn--secondary"
            onClick={() => {
              void onPreview();
            }}
          >
            Pré-visualizar grade
          </button>
          <button
            type="submit"
            className="patients-btn patients-btn--primary"
            disabled={submitting}
          >
            {submitting ? 'Salvando…' : 'Salvar tratamento'}
          </button>
          <Link
            to={patientId ? `/pacientes/${patientId}` : '/pacientes'}
            className="patients-btn patients-btn--secondary"
          >
            Cancelar
          </Link>
        </div>

        {preview ? (
          <div className="treatments-preview">
            <h2 className="treatments-section-title">
              Prévia — {preview.doseCount} dose
              {preview.doseCount === 1 ? '' : 's'}
            </h2>
            {preview.truncatedBackfill ? (
              <p className="treatments-warning">
                Início antigo: backfill limitado a 31 dias.
              </p>
            ) : null}
            <ol className="treatments-preview__list">
              {preview.doses.slice(0, 12).map((d) => (
                <li key={d.scheduledAt}>{formatDoseLabel(d.scheduledAt)}</li>
              ))}
            </ol>
            {preview.doseCount > 12 ? (
              <p className="patients-row__meta">
                … e mais {preview.doseCount - 12} doses na grade completa.
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  );
}
