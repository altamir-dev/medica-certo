import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus, PencilSimple } from '@phosphor-icons/react';
import { ApiError } from '../api/client';
import { type Patient } from '../api/patients';
import {
  listPatientTreatments,
  type Treatment,
} from '../api/treatments';
import {
  administerDose,
  getPatientSheet,
  updateAdministration,
  type PatientSheet,
  type SheetChip,
} from '../api/doses';
import { nearestSlot } from '../lib/clock';
import { useNowMinute } from '../lib/useNow';
import './PatientsPage.css';
import './Treatments.css';
import './PatientSheet.css';

function formatBirthDate(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat('pt-BR').format(new Date(y, m - 1, d));
}

function formatStamp(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function formatScheduledLabel(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function formatDaySub(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(y, m - 1, d));
}

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
  const [date, time] = local.split('T');
  if (!date || !time) return local;
  const hm = time.length === 5 ? `${time}:00` : time;
  if (typeof Temporal !== 'undefined') {
    try {
      return Temporal.PlainDateTime.from(`${date}T${hm}`)
        .toZonedDateTime('America/Sao_Paulo')
        .toString({ timeZoneName: 'never' });
    } catch {
      /* fall through */
    }
  }
  return `${date}T${hm}-03:00`;
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

type ModalMode = 'register' | 'view' | 'edit';

const GRID_ROWS = 3;
const GRID_COLS = 10;
const GRID_CELLS = GRID_ROWS * GRID_COLS;

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const now = useNowMinute();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [sheet, setSheet] = useState<PatientSheet | null>(null);
  const [treatments, setTreatments] = useState<Treatment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusTreatmentId, setFocusTreatmentId] = useState<string | null>(null);

  const [modalChip, setModalChip] = useState<SheetChip | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>('register');
  const [administeredAtLocal, setAdministeredAtLocal] = useState('');
  const [note, setNote] = useState('');
  const [confirmEarly, setConfirmEarly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [sheetData, list] = await Promise.all([
        getPatientSheet(id),
        listPatientTreatments(id),
      ]);
      setPatient(sheetData.patient);
      setSheet(sheetData.sheet);
      setTreatments(list);
    } catch (err) {
      setPatient(null);
      setSheet(null);
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

  const gridTemplate = useMemo(() => {
    if (!sheet) return '';
    // Célula do horário precisa caber mini-grid 3×10
    return `88px repeat(${Math.max(sheet.slots.length, 1)}, minmax(120px, 1fr))`;
  }, [sheet]);

  /** Posição fixa no mini-grid por tratamento (ordem das abas). */
  const medIndexByTreatment = useMemo(() => {
    const map = new Map<string, number>();
    sheet?.medications.forEach((med, idx) => {
      if (idx < GRID_CELLS) map.set(med.treatmentId, idx);
    });
    return map;
  }, [sheet]);

  const nearest = useMemo(
    () => (sheet ? nearestSlot(sheet.slots, now) : null),
    [sheet, now],
  );

  function openChip(chip: SheetChip) {
    setModalChip(chip);
    setModalError(null);
    setConfirmEarly(false);
    if (chip.status === 'administered') {
      setModalMode('view');
      setAdministeredAtLocal(
        toDatetimeLocalValue(chip.administeredAt ?? chip.scheduledAt),
      );
      setNote(chip.note ?? '');
    } else {
      setModalMode('register');
      setAdministeredAtLocal(toDatetimeLocalValue(new Date()));
      setNote('');
    }
  }

  function closeModal() {
    if (saving) return;
    setModalChip(null);
    setModalError(null);
  }

  async function onConfirmModal(event: FormEvent) {
    event.preventDefault();
    if (!modalChip || modalMode === 'view') return;
    setSaving(true);
    setModalError(null);
    const iso = datetimeLocalToIso(administeredAtLocal);
    try {
      if (modalMode === 'edit' || modalChip.status === 'administered') {
        await updateAdministration(modalChip.doseId, {
          administeredAt: iso,
          note: note.trim() || undefined,
        });
      } else {
        await administerDose(modalChip.doseId, {
          administeredAt: iso,
          note: note.trim() || undefined,
          confirmEarly,
        });
      }
      setModalChip(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFIRM_EARLY_REQUIRED') {
        setConfirmEarly(true);
        setModalError(
          'Horário previsto ainda não chegou. Confirme para registrar adiantado.',
        );
      } else {
        setModalError(
          err instanceof ApiError
            ? err.message
            : 'Não foi possível salvar o registro.',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  if (!id) {
    return (
      <p className="patients-alert" role="alert">
        Paciente inválido.
      </p>
    );
  }

  const isEarly =
    modalChip &&
    modalMode === 'register' &&
    new Date(modalChip.scheduledAt).getTime() > Date.now();

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

      <section className="portal-card cal-card">
        <h2 className="treatments-section-title">Calendário de doses</h2>

        {sheet === null ? (
          <p className="portal-card__body">Carregando…</p>
        ) : sheet.medications.length === 0 ? (
          <div className="patients-empty">
            <p className="portal-card__body">
              Nenhum tratamento ativo. Adicione um medicamento para montar o
              calendário.
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
          <>
            <div className="cal-tabs" role="tablist" aria-label="Medicamentos">
              {sheet.medications.map((med) => {
                const active =
                  focusTreatmentId === null ||
                  focusTreatmentId === med.treatmentId;
                return (
                  <button
                    key={med.treatmentId}
                    type="button"
                    role="tab"
                    aria-selected={focusTreatmentId === med.treatmentId}
                    className={`cal-tab${active ? ' is-active' : ' is-dim'}`}
                    style={
                      {
                        background: med.color,
                        ['--tab-color']: med.color,
                      } as CSSProperties
                    }
                    title={`${med.name} · ${med.doseQuantity} · ${med.route}`}
                    onClick={() =>
                      setFocusTreatmentId((prev) =>
                        prev === med.treatmentId ? null : med.treatmentId,
                      )
                    }
                  >
                    <span className="cal-tab__dot" aria-hidden="true" />
                    {med.name}
                  </button>
                );
              })}
            </div>

            {sheet.slots.length === 0 ? (
              <p className="portal-card__body">
                Sem doses na janela (ontem → próximos 6 dias).
              </p>
            ) : (
              <div className="cal-wrap">
                <div
                  className="cal-grid"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <div className="cal-corner">Dia</div>
                  {sheet.slots.map((slot) => (
                    <div
                      key={slot}
                      className={`cal-slot-head${slot === nearest ? ' is-nearest' : ''}`}
                    >
                      {slot}
                    </div>
                  ))}

                  {sheet.days.map((day) => (
                    <div key={day.ymd} style={{ display: 'contents' }}>
                      <div
                        className={`cal-day${day.isToday ? ' is-today' : ''}`}
                      >
                        <span className="cal-day__label">{day.label}</span>
                        <span className="cal-day__sub">
                          {formatDaySub(day.ymd)}
                        </span>
                      </div>
                      {sheet.slots.map((slot) => {
                        const key = `${day.ymd}|${slot}`;
                        const chipsHere = sheet.byDaySlot[key] ?? [];
                        /** Índice do mini-grid → chip (só medicamentos alocados neste horário). */
                        const chipByIndex = new Map<number, SheetChip>();
                        for (const chip of chipsHere) {
                          const idx = medIndexByTreatment.get(chip.treatmentId);
                          if (idx === undefined) continue;
                          chipByIndex.set(idx, chip);
                        }
                        return (
                          <div
                            key={key}
                            className={`cal-cell${day.isToday ? ' is-today' : ''}${slot === nearest ? ' is-nearest' : ''}`}
                          >
                            <div
                              className="cal-cell-grid"
                              style={
                                {
                                  ['--grid-rows']: GRID_ROWS,
                                  ['--grid-cols']: GRID_COLS,
                                } as CSSProperties
                              }
                              aria-label={`Doses às ${slot}`}
                            >
                              {Array.from({ length: GRID_CELLS }, (_, idx) => {
                                const chip = chipByIndex.get(idx);
                                if (!chip) {
                                  return (
                                    <span
                                      key={idx}
                                      className="cal-subcell"
                                      aria-hidden="true"
                                    />
                                  );
                                }
                                const focused =
                                  focusTreatmentId === null ||
                                  focusTreatmentId === chip.treatmentId;
                                const filled = chip.status === 'administered';
                                const classes = [
                                  'cal-subcell',
                                  'cal-subcell--med',
                                  filled ? 'cal-subcell--filled' : '',
                                  chip.isNext ? 'cal-subcell--next' : '',
                                  chip.isOverdue ? 'cal-subcell--overdue' : '',
                                  focused ? '' : 'cal-subcell--dim',
                                ]
                                  .filter(Boolean)
                                  .join(' ');
                                return (
                                  <button
                                    key={chip.doseId}
                                    type="button"
                                    className={classes}
                                    style={
                                      {
                                        ['--chip-color']: chip.color,
                                      } as CSSProperties
                                    }
                                    title={`${chip.medicationName} · previsto ${formatScheduledLabel(chip.scheduledAt)}${filled && chip.administeredAt ? ` · dado às ${formatStamp(chip.administeredAt)}` : ''}`}
                                    aria-label={`${chip.medicationName} às ${slot}`}
                                    onClick={() => openChip(chip)}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="cal-legend" aria-hidden="true">
              <span>
                <i className="cal-legend__swatch" /> Contorno = pendente
              </span>
              <span>
                <i className="cal-legend__swatch cal-legend__swatch--filled" />{' '}
                Preenchido = administrado
              </span>
              <span>
                Mini-grid 3×10: cada remédio tem posição fixa; vazio = sem dose
              </span>
            </div>
          </>
        )}
      </section>

      {treatments && treatments.length > 0 ? (
        <section className="portal-card">
          <h2 className="treatments-section-title">Tratamentos</h2>
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
                    {t.doseQuantity} · {t.route}
                    {t.alarmsEnabled ? ' · alarmes on' : ' · alarmes off'}
                  </p>
                </div>
                <Link
                  to={`/tratamentos/${t.id}`}
                  className="patients-btn patients-btn--secondary"
                >
                  Detalhe
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {modalChip ? (
        <div
          className="sheet-modal-backdrop"
          role="presentation"
          onClick={closeModal}
        >
          <div
            className="sheet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dose-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="dose-modal-title">
              {modalMode === 'register'
                ? 'Registrar dose'
                : modalMode === 'edit'
                  ? 'Editar registro'
                  : 'Dose administrada'}
            </h2>

            <div className="sheet-modal__med">
              <span
                className="sheet-modal__swatch"
                style={
                  {
                    ['--chip-color']: modalChip.color,
                  } as CSSProperties
                }
              />
              {modalChip.medicationName} · {modalChip.doseQuantity} ·{' '}
              {modalChip.route}
            </div>
            <p>Previsto {formatScheduledLabel(modalChip.scheduledAt)}</p>

            {modalMode === 'view' ? (
              <>
                <dl className="sheet-modal__readonly">
                  <dt>Horário efetivo</dt>
                  <dd>
                    {modalChip.administeredAt
                      ? formatScheduledLabel(modalChip.administeredAt)
                      : '—'}
                  </dd>
                  <dt>Observação</dt>
                  <dd>{modalChip.note?.trim() ? modalChip.note : '—'}</dd>
                </dl>
                {modalError ? (
                  <p className="patients-alert" role="alert">
                    {modalError}
                  </p>
                ) : null}
                <div className="sheet-modal__actions">
                  <button
                    type="button"
                    className="patients-btn patients-btn--secondary"
                    onClick={closeModal}
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    className="patients-btn patients-btn--primary"
                    onClick={() => {
                      setModalError(null);
                      setModalMode('edit');
                    }}
                  >
                    Editar
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={onConfirmModal}>
                <label>
                  Data e hora da administração
                  <input
                    type="datetime-local"
                    value={administeredAtLocal}
                    onChange={(e) => setAdministeredAtLocal(e.target.value)}
                    required
                  />
                </label>

                <label>
                  Observação (opcional)
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={2000}
                    placeholder="Ex.: tomou com alimento, reação leve…"
                  />
                </label>

                {isEarly || confirmEarly ? (
                  <label className="sheet-modal__check">
                    <input
                      type="checkbox"
                      checked={confirmEarly}
                      onChange={(e) => setConfirmEarly(e.target.checked)}
                    />
                    Registrar antes do horário previsto
                  </label>
                ) : null}

                {modalError ? (
                  <p className="patients-alert" role="alert">
                    {modalError}
                  </p>
                ) : null}

                <div className="sheet-modal__actions">
                  <button
                    type="button"
                    className="patients-btn patients-btn--secondary"
                    disabled={saving}
                    onClick={closeModal}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="patients-btn patients-btn--primary"
                    disabled={saving}
                  >
                    {saving ? 'Salvando…' : 'Salvar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
