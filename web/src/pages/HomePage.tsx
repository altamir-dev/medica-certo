import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from '@phosphor-icons/react';
import { ApiError } from '../api/client';
import {
  getDashboardCalendar,
  type CalendarPatientChip,
  type CaregiverCalendar,
} from '../api/dashboard';
import { administerDose, updateAdministration } from '../api/doses';
import { nearestSlot } from '../lib/clock';
import { useNow } from '../lib/useNow';
import './PatientsPage.css';
import './Treatments.css';
import './PatientSheet.css';
import './HomePage.css';

const GRID_ROWS = 3;
const GRID_COLS = 10;
const GRID_CELLS = GRID_ROWS * GRID_COLS;

function formatDaySub(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(y, m - 1, d));
}

function formatScheduledLabel(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function formatStamp(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
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
  return `${date}T${hm}-03:00`;
}

type SlotModal = {
  chip: CalendarPatientChip;
  day: string;
  slot: string;
};

export function HomePage() {
  const navigate = useNavigate();
  const now = useNow(1000);
  const [calendar, setCalendar] = useState<CaregiverCalendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusPatientId, setFocusPatientId] = useState<string | null>(null);
  const [slotModal, setSlotModal] = useState<SlotModal | null>(null);

  const [doseEditId, setDoseEditId] = useState<string | null>(null);
  const [administeredAtLocal, setAdministeredAtLocal] = useState('');
  const [note, setNote] = useState('');
  const [confirmEarly, setConfirmEarly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCalendar(await getDashboardCalendar());
    } catch (err) {
      setCalendar(null);
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível carregar o calendário.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const gridTemplate = useMemo(() => {
    if (!calendar) return '';
    return `88px repeat(${Math.max(calendar.slots.length, 1)}, minmax(120px, 1fr))`;
  }, [calendar]);

  const patientIndex = useMemo(() => {
    const map = new Map<string, number>();
    calendar?.patients.forEach((p, idx) => {
      if (idx < GRID_CELLS) map.set(p.patientId, idx);
    });
    return map;
  }, [calendar]);

  const nearest = useMemo(
    () => (calendar ? nearestSlot(calendar.slots, now) : null),
    [calendar, now],
  );

  function openPatientChip(
    chip: CalendarPatientChip,
    day: string,
    slot: string,
  ) {
    const pending = chip.doses.filter((d) => d.status === 'pending');
    if (pending.length > 0 || chip.doses.length > 0) {
      setSlotModal({ chip, day, slot });
      setDoseEditId(null);
      setModalError(null);
      setConfirmEarly(false);
      setNote('');
      return;
    }
    navigate(`/pacientes/${chip.patientId}`);
  }

  function startRegister(doseId: string, scheduledAt: string) {
    setDoseEditId(doseId);
    setAdministeredAtLocal(toDatetimeLocalValue(new Date()));
    setNote('');
    setConfirmEarly(false);
    setModalError(null);
    void scheduledAt;
  }

  function startEdit(doseId: string, administeredAt: string | null, scheduledAt: string) {
    setDoseEditId(doseId);
    setAdministeredAtLocal(
      toDatetimeLocalValue(administeredAt ?? scheduledAt),
    );
    setNote('');
    setConfirmEarly(false);
    setModalError(null);
  }

  async function onSaveDose(event: FormEvent) {
    event.preventDefault();
    if (!slotModal || !doseEditId) return;
    const dose = slotModal.chip.doses.find((d) => d.doseId === doseEditId);
    if (!dose) return;
    setSaving(true);
    setModalError(null);
    const iso = datetimeLocalToIso(administeredAtLocal);
    try {
      if (dose.status === 'administered') {
        await updateAdministration(doseEditId, {
          administeredAt: iso,
          note: note.trim() || undefined,
        });
      } else {
        await administerDose(doseEditId, {
          administeredAt: iso,
          note: note.trim() || undefined,
          confirmEarly,
        });
      }
      setDoseEditId(null);
      await load();
      // refresh modal chip from new calendar
      const fresh = await getDashboardCalendar();
      setCalendar(fresh);
      const key = `${slotModal.day}|${slotModal.slot}`;
      const updated = (fresh.byDaySlot[key] ?? []).find(
        (c) => c.patientId === slotModal.chip.patientId,
      );
      if (updated) setSlotModal({ ...slotModal, chip: updated });
      else setSlotModal(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFIRM_EARLY_REQUIRED') {
        setConfirmEarly(true);
        setModalError(
          'Horário previsto ainda não chegou. Confirme para registrar adiantado.',
        );
      } else {
        setModalError(
          err instanceof ApiError ? err.message : 'Falha ao salvar.',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  const editingDose = slotModal?.chip.doses.find((d) => d.doseId === doseEditId);
  const isEarly =
    editingDose &&
    editingDose.status === 'pending' &&
    new Date(editingDose.scheduledAt).getTime() > Date.now();

  return (
    <div className="patients-page">
      <div className="patients-toolbar">
        <div>
          <h1 className="treatments-title">Dashboard</h1>
          <p className="patients-toolbar__hint">
            Quem medicar em cada horário · ontem → próximos dias
          </p>
        </div>
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

      <section className="portal-card cal-card">
        {calendar === null ? (
          <p className="portal-card__body">Carregando…</p>
        ) : calendar.patients.length === 0 ? (
          <div className="patients-empty">
            <p className="portal-card__body">
              Nenhum paciente cadastrado. Cadastre alguém para ver o calendário.
            </p>
            <Link
              to="/pacientes/novo"
              className="patients-btn patients-btn--primary"
            >
              Cadastrar paciente
            </Link>
          </div>
        ) : (
          <>
            <div className="cal-tabs" role="tablist" aria-label="Pacientes">
              {calendar.patients.map((p) => {
                const active =
                  focusPatientId === null || focusPatientId === p.patientId;
                return (
                  <button
                    key={p.patientId}
                    type="button"
                    role="tab"
                    aria-selected={focusPatientId === p.patientId}
                    className={`cal-tab${active ? ' is-active' : ' is-dim'}`}
                    style={
                      {
                        background: p.color,
                        ['--tab-color']: p.color,
                      } as CSSProperties
                    }
                    onClick={() =>
                      setFocusPatientId((prev) =>
                        prev === p.patientId ? null : p.patientId,
                      )
                    }
                  >
                    <span className="cal-tab__dot" aria-hidden="true" />
                    {p.name}
                  </button>
                );
              })}
            </div>

            {calendar.slots.length === 0 ? (
              <p className="portal-card__body">
                Sem doses na janela. Configure tratamentos nos pacientes.
              </p>
            ) : (
              <div className="cal-wrap">
                <div
                  className="cal-grid"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <div className="cal-corner">Dia</div>
                  {calendar.slots.map((slot) => (
                    <div
                      key={slot}
                      className={`cal-slot-head${slot === nearest ? ' is-nearest' : ''}`}
                    >
                      {slot}
                    </div>
                  ))}

                  {calendar.days.map((day) => (
                    <div key={day.ymd} style={{ display: 'contents' }}>
                      <div
                        className={`cal-day${day.isToday ? ' is-today' : ''}`}
                      >
                        <span className="cal-day__label">{day.label}</span>
                        <span className="cal-day__sub">
                          {formatDaySub(day.ymd)}
                        </span>
                      </div>
                      {calendar.slots.map((slot) => {
                        const key = `${day.ymd}|${slot}`;
                        const chips = calendar.byDaySlot[key] ?? [];
                        const chipByIndex = new Map<
                          number,
                          CalendarPatientChip
                        >();
                        for (const chip of chips) {
                          const idx = patientIndex.get(chip.patientId);
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
                                  focusPatientId === null ||
                                  focusPatientId === chip.patientId;
                                const allDone = chip.doses.every(
                                  (d) => d.status === 'administered',
                                );
                                const classes = [
                                  'cal-subcell',
                                  'cal-subcell--med',
                                  allDone ? 'cal-subcell--filled' : '',
                                  chip.isNext ? 'cal-subcell--next' : '',
                                  chip.isOverdue ? 'cal-subcell--overdue' : '',
                                  focused ? '' : 'cal-subcell--dim',
                                ]
                                  .filter(Boolean)
                                  .join(' ');
                                return (
                                  <button
                                    key={chip.patientId}
                                    type="button"
                                    className={classes}
                                    style={
                                      {
                                        ['--chip-color']: chip.color,
                                      } as CSSProperties
                                    }
                                    title={`${chip.patientName} · ${slot} · ${chip.doses.length} dose(s)`}
                                    aria-label={`${chip.patientName} às ${slot}`}
                                    onClick={() =>
                                      openPatientChip(chip, day.ymd, slot)
                                    }
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
                <i className="cal-legend__swatch" /> Contorno = ainda há dose
                pendente
              </span>
              <span>
                <i className="cal-legend__swatch cal-legend__swatch--filled" />{' '}
                Preenchido = todas as doses do horário dadas
              </span>
              <span>Clique no quadrado → paciente e medicamentos</span>
            </div>
          </>
        )}
      </section>

      {slotModal ? (
        <div
          className="sheet-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!saving) {
              setSlotModal(null);
              setDoseEditId(null);
            }
          }}
        >
          <div
            className="sheet-modal home-slot-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-slot-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="home-slot-title">{slotModal.chip.patientName}</h2>
            <p>
              {formatDaySub(slotModal.day)} · {slotModal.slot}
            </p>

            <ul className="home-dose-list">
              {slotModal.chip.doses.map((dose) => (
                <li key={dose.doseId} className="home-dose-item">
                  <div>
                    <strong>{dose.medicationName}</strong>
                    <span className="patients-row__meta">
                      {' '}
                      · {dose.doseQuantity} · {dose.route}
                    </span>
                    <div className="patients-row__meta">
                      Previsto {formatScheduledLabel(dose.scheduledAt)}
                      {dose.status === 'administered' && dose.administeredAt
                        ? ` · dado às ${formatStamp(dose.administeredAt)}`
                        : dose.isOverdue
                          ? ' · atrasada'
                          : dose.status === 'pending'
                            ? ' · pendente'
                            : ''}
                    </div>
                  </div>
                  <div className="home-dose-item__actions">
                    {dose.status === 'pending' ? (
                      <button
                        type="button"
                        className="patients-btn patients-btn--primary"
                        onClick={() =>
                          startRegister(dose.doseId, dose.scheduledAt)
                        }
                      >
                        Registrar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="patients-btn patients-btn--secondary"
                        onClick={() =>
                          startEdit(
                            dose.doseId,
                            dose.administeredAt,
                            dose.scheduledAt,
                          )
                        }
                      >
                        Ver / editar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {doseEditId && editingDose ? (
              <form className="home-dose-form" onSubmit={onSaveDose}>
                <h3>
                  {editingDose.status === 'administered'
                    ? 'Editar registro'
                    : 'Registrar dose'}{' '}
                  — {editingDose.medicationName}
                </h3>
                <label>
                  Data e hora
                  <input
                    type="datetime-local"
                    value={administeredAtLocal}
                    onChange={(e) => setAdministeredAtLocal(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Observação
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={2000}
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
                    onClick={() => setDoseEditId(null)}
                  >
                    Voltar
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
            ) : null}

            <div className="sheet-modal__actions">
              <button
                type="button"
                className="patients-btn patients-btn--secondary"
                onClick={() => {
                  setSlotModal(null);
                  setDoseEditId(null);
                }}
              >
                Fechar
              </button>
              <button
                type="button"
                className="patients-btn patients-btn--primary"
                onClick={() =>
                  navigate(`/pacientes/${slotModal.chip.patientId}`)
                }
              >
                Abrir paciente
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
