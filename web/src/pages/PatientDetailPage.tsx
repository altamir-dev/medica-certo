import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
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
  type SheetCell,
  type SheetColumn,
} from '../api/doses';
import './PatientsPage.css';
import './Treatments.css';
import './PatientSheet.css';

function formatBirthDate(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat('pt-BR').format(new Date(y, m - 1, d));
}

function formatDayLabel(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(y, m - 1, d));
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

type ModalState = {
  cell: SheetCell;
  column: SheetColumn;
};

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [sheet, setSheet] = useState<PatientSheet | null>(null);
  const [treatments, setTreatments] = useState<Treatment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
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

  const flatColumns = useMemo(() => {
    if (!sheet) return [];
    /** @type {{ column: SheetColumn, slot: string }[]} */
    const out: { column: SheetColumn; slot: string }[] = [];
    for (const column of sheet.columns) {
      for (const slot of column.slots) {
        out.push({ column, slot });
      }
    }
    return out;
  }, [sheet]);

  function openCell(column: SheetColumn, day: string, slot: string) {
    if (!sheet) return;
    const key = `${column.treatmentId}|${day}|${slot}`;
    const cell = sheet.cells[key];
    if (!cell) return;
    setModal({ cell, column });
    setNote('');
    setConfirmEarly(false);
    setModalError(null);
    const initial =
      cell.administeredAt ??
      (cell.status === 'pending' ? new Date().toISOString() : cell.scheduledAt);
    setAdministeredAtLocal(toDatetimeLocalValue(initial));
  }

  async function onConfirmModal(event: FormEvent) {
    event.preventDefault();
    if (!modal) return;
    setSaving(true);
    setModalError(null);
    const iso = datetimeLocalToIso(administeredAtLocal);
    try {
      if (modal.cell.status === 'administered') {
        await updateAdministration(modal.cell.doseId, {
          administeredAt: iso,
          note: note.trim() || undefined,
        });
      } else {
        await administerDose(modal.cell.doseId, {
          administeredAt: iso,
          note: note.trim() || undefined,
          confirmEarly,
        });
      }
      setModal(null);
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
    modal &&
    modal.cell.status === 'pending' &&
    new Date(modal.cell.scheduledAt).getTime() > Date.now();

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
        <h2 className="treatments-section-title">Grade de doses</h2>
        {sheet === null ? (
          <p className="portal-card__body">Carregando…</p>
        ) : sheet.columns.length === 0 ? (
          <div className="patients-empty">
            <p className="portal-card__body">
              Nenhum tratamento ativo. Adicione um medicamento para montar a
              folha.
            </p>
            <Link
              to={`/pacientes/${id}/tratamentos/novo`}
              className="patients-btn patients-btn--primary"
            >
              <Plus weight="bold" size={18} aria-hidden="true" />
              Adicionar medicamento
            </Link>
          </div>
        ) : flatColumns.length === 0 ? (
          <p className="portal-card__body">
            Tratamentos ativos sem doses na janela. Ajuste o período do
            tratamento ou aguarde a geração da grade.
          </p>
        ) : (
          <>
            <div className="sheet-wrap">
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th className="sheet-day" rowSpan={2}>
                      Dia
                    </th>
                    {sheet.columns.map((col) => (
                      <th
                        key={col.treatmentId}
                        colSpan={Math.max(col.slots.length, 1)}
                        className="sheet-med-head"
                      >
                        <span className="sheet-med-head__name">
                          {col.medicationName}
                        </span>
                        <span className="sheet-med-head__meta">
                          {col.doseQuantity} · {col.route} · {col.schemeLabel}
                        </span>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {sheet.columns.map((col) =>
                      col.slots.map((slot) => (
                        <th
                          key={`${col.treatmentId}-${slot}`}
                          className="sheet-slot-head"
                        >
                          {slot}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sheet.days.map((day) => (
                    <tr key={day}>
                      <th scope="row" className="sheet-day">
                        {formatDayLabel(day)}
                      </th>
                      {sheet.columns.map((col) =>
                        col.slots.map((slot) => {
                          const key = `${col.treatmentId}|${day}|${slot}`;
                          const cell = sheet.cells[key];
                          if (!cell) {
                            return (
                              <td
                                key={key}
                                className="sheet-cell sheet-cell--empty"
                              />
                            );
                          }
                          const classes = [
                            'sheet-cell',
                            cell.status === 'administered'
                              ? 'sheet-cell--administered'
                              : 'sheet-cell--empty',
                            cell.isNext ? 'sheet-cell--next' : '',
                            cell.isOverdue ? 'sheet-cell--overdue' : '',
                            cell.status === 'skipped'
                              ? 'sheet-cell--skipped'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ');
                          const label =
                            cell.status === 'administered' &&
                            cell.administeredAt
                              ? formatStamp(cell.administeredAt)
                              : cell.status === 'skipped'
                                ? '—'
                                : '';
                          return (
                            <td key={key} className={classes}>
                              <button
                                type="button"
                                className="sheet-cell__btn"
                                title={
                                  cell.isNext
                                    ? `Próxima · previsto ${formatScheduledLabel(cell.scheduledAt)}`
                                    : `Previsto ${formatScheduledLabel(cell.scheduledAt)}`
                                }
                                onClick={() => openCell(col, day, slot)}
                              >
                                {label}
                              </button>
                            </td>
                          );
                        }),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sheet-legend" aria-hidden="true">
              <span>
                <i className="sheet-legend__swatch sheet-legend__swatch--next" />
                Próxima
              </span>
              <span>
                <i className="sheet-legend__swatch sheet-legend__swatch--stamp" />
                Carimbo (administrada)
              </span>
              <span>Célula em branco = pendente · clique para registrar</span>
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

      {modal ? (
        <div
          className="sheet-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!saving) setModal(null);
          }}
        >
          <form
            className="sheet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dose-modal-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={onConfirmModal}
          >
            <h2 id="dose-modal-title">
              {modal.cell.status === 'administered'
                ? 'Editar carimbo'
                : 'Registrar dose'}
            </h2>
            <p>
              {modal.column.medicationName} · {modal.column.doseQuantity} ·
              previsto {formatScheduledLabel(modal.cell.scheduledAt)}
            </p>

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
                Confirmar administração antes do horário previsto
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
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="patients-btn patients-btn--primary"
                disabled={saving}
              >
                {saving ? 'Salvando…' : 'Confirmar'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
