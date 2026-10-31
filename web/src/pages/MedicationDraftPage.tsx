import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  acceptAiConsent,
  confirmMedicationDraft,
  createMedicationDraft,
  discardMedicationDraft,
  getAiStatus,
  getMedicationDraft,
  type AiStatus,
  type ConfirmItem,
  type DraftItem,
} from '../api/ai';
import { ROUTE_OPTIONS, suggestFirstDose } from '../api/treatments';
import './PatientsPage.css';
import './MedicationsPage.css';
import './Treatments.css';

type ReviewItem = ConfirmItem & {
  nameBand: string;
  concentrationSource: string;
  scheduleBand: string;
  disagreement: string | null;
  rawText: string;
  candidates: DraftItem['candidates'];
  classeTerapeutica: string;
};

function bandLabel(band: string) {
  if (band === 'alta') return 'confiança alta';
  if (band === 'media') return 'confiança média';
  if (band === 'baixa') return 'confiança baixa';
  return 'não lido';
}

function kindLabel(kind: string | null) {
  if (kind === 'package') return 'Embalagem';
  if (kind === 'prescription') return 'Receita';
  return 'Não reconhecido';
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
  const get = (type: string) => zoned.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function datetimeLocalToIso(local: string) {
  const [date, time] = local.split('T');
  if (!date || !time) return local;
  const hm = time.length === 5 ? `${time}:00` : time;
  return `${date}T${hm}-03:00`;
}

async function shrinkImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.8);
    });
    if (!blob) return file;
    return new File([blob], 'medicamento.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

function toReview(item: DraftItem, withTreatment: boolean): ReviewItem {
  const starts = toDatetimeLocalValue(new Date());
  return {
    include: true,
    name: item.name,
    activeIngredient: item.activeIngredient,
    concentration: item.concentration,
    presentation: item.presentation,
    anvisaRegistry: item.anvisaRegistry,
    createTreatment: withTreatment && Boolean(item.schedule.doseQuantity || item.schedule.rawText),
    doseQuantity: item.schedule.doseQuantity,
    route: item.schedule.route,
    scheduleMode:
      item.schedule.mode === 'custom_times' ? 'custom_times' : 'regular_interval',
    intervalHours: item.schedule.intervalHours,
    timesOfDay: item.schedule.timesOfDay,
    startsAt: starts,
    endsOn: item.schedule.continuousUse ? null : item.schedule.endsOn,
    posologyRaw: item.schedule.rawText,
    nameBand: item.nameBand,
    concentrationSource: item.concentrationSource,
    scheduleBand: item.schedule.band,
    disagreement: item.schedule.disagreement,
    rawText: item.schedule.rawText,
    candidates: item.candidates,
    classeTerapeutica: item.classeTerapeutica,
  };
}

export function MedicationDraftPage() {
  const { id: patientId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<'capture' | 'processing' | 'review' | 'failed'>('capture');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState<{ index: number; existingId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAiStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setAccepted(next.consented);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({
            enabled: false,
            providerName: '',
            model: '',
            consented: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const backHref = patientId ? `/pacientes/${patientId}` : '/medicamentos';
  const quotaReached = Boolean(status?.quota?.reached);
  const manualHref = patientId
    ? `/pacientes/${patientId}/tratamentos/novo`
    : '/medicamentos/novo';

  const notice = useMemo(() => {
    if (!status?.enabled) return '';
    return `A imagem é enviada à ${status.providerName}, modelo ${status.model}. Receita pode mostrar nome, documento e CRM, e essa imagem segue junto. Nada é cadastrado antes de você confirmar. A posologia sugerida não substitui o médico nem a bula.`;
  }, [status]);

  function patchItem(index: number, patch: Partial<ReviewItem>) {
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  async function onAnalyze(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setError(null);
    setSubmitting(true);
    setPhase('processing');
    try {
      const prepared = await shrinkImage(file);
      const draft = await createMedicationDraft(prepared, patientId);
      setDraftId(draft.id);
      let current = draft;
      for (let i = 0; i < 50 && current.status === 'processing'; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        current = await getMedicationDraft(draft.id);
      }
      if (current.status !== 'ready' || !current.extracted) {
        setPhase('failed');
        setError('Não consegui ler a foto. Tente de novo ou preencha à mão.');
        return;
      }
      setKind(current.extracted.documentKind);
      setItems(
        current.extracted.items.map((item) => toReview(item, Boolean(patientId))),
      );
      setPhase('review');
    } catch (err) {
      setPhase('failed');
      setError(err instanceof ApiError ? err.message : 'Não consegui ler a foto.');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmItems(source: ReviewItem[]) {
    if (!draftId) return;
    setError(null);
    setDuplicate(null);
    setSubmitting(true);
    try {
      const payload = source.map((item) => ({
        ...item,
        startsAt: item.startsAt.includes('T')
          ? datetimeLocalToIso(item.startsAt)
          : item.startsAt,
      }));
      const result = await confirmMedicationDraft(draftId, payload);
      const treatmentId = result.treatmentIds[0];
      const medicationId = result.medicationIds[0];
      if (treatmentId) navigate(`/tratamentos/${treatmentId}`, { replace: true });
      else if (medicationId) navigate(`/medicamentos/${medicationId}`, { replace: true });
      else navigate(backHref, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') {
        setDuplicate({
          index: Number(err.fields?.itemIndex ?? 0),
          existingId: err.fields?.existingId ?? '',
        });
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Não foi possível cadastrar.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onConfirm() {
    await confirmItems(items);
  }

  async function onDiscard() {
    if (draftId) await discardMedicationDraft(draftId).catch(() => {});
    navigate(backHref, { replace: true });
  }

  if (status && !status.enabled) {
    return (
      <section className="portal-card">
        <h2 className="portal-card__title">Leitura por foto</h2>
        <p className="portal-card__body">
          A leitura por foto está desligada. Dá para cadastrar o medicamento à mão.
        </p>
        <Link to={backHref} className="patients-btn patients-btn--secondary">
          Voltar
        </Link>
      </section>
    );
  }

  if (status?.enabled && !accepted) {
    return (
      <section className="portal-card">
        <h2 className="portal-card__title">Antes de enviar a foto</h2>
        <p className="portal-card__body">{notice}</p>
        <button
          type="button"
          className="patients-btn patients-btn--primary"
          onClick={() => {
            void acceptAiConsent().then(() => setAccepted(true));
          }}
        >
          Entendi
        </button>
      </section>
    );
  }

  return (
    <div className="patients-page">
      <section className="portal-card">
        <h2 className="portal-card__title">
          {patientId ? 'Fotografar caixa ou receita' : 'Cadastrar com foto'}
        </h2>
        {patientId ? (
          <p className="patients-field__hint">
            A posologia sugerida não substitui a orientação do médico ou da bula.
            Confira antes de salvar.
          </p>
        ) : null}

        {phase === 'capture' || phase === 'failed' ? (
          <form className="patients-form" onSubmit={onAnalyze}>
            {quotaReached ? (
              <p className="patients-alert" role="status">
                Você já usou as {status?.quota?.limit} leituras deste mês. Dá
                para cadastrar o medicamento à mão.
              </p>
            ) : null}
            <label className="patients-field">
              <span>Foto</span>
              <input
                className="patients-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <span className="patients-field__hint">
                JPEG, PNG ou WebP. A foto é reduzida neste aparelho antes do envio.
                No celular, a primeira escolha abre a câmera; a segunda, a galeria.
              </span>
            </label>
            <label className="patients-field">
              <span>Ou escolher da galeria</span>
              <input
                className="patients-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {previewUrl ? (
              <img className="meds-photo-preview" src={previewUrl} alt="Prévia da foto" />
            ) : null}
            {error ? (
              <p className="patients-alert" role="alert">
                {error}
              </p>
            ) : null}
            <div className="patients-form__actions">
              <button
                type="submit"
                className="patients-btn patients-btn--primary"
                disabled={!file || submitting || quotaReached}
              >
                Analisar
              </button>
              <Link to={backHref} className="patients-btn patients-btn--secondary">
                Cancelar
              </Link>
              <Link to={manualHref} className="patients-btn patients-btn--secondary">
                Preencher à mão
              </Link>
            </div>
          </form>
        ) : null}

        {phase === 'processing' ? (
          <p className="portal-card__body">Lendo a imagem e conferindo o nome…</p>
        ) : null}

        {phase === 'review' ? (
          <div className="patients-form">
            <p className="patients-field__hint">
              {kindLabel(kind)}. A posologia sugerida não substitui a orientação do
              médico ou da bula. Confira antes de salvar.
            </p>
            {previewUrl ? (
              <img className="meds-photo-preview" src={previewUrl} alt="Foto enviada" />
            ) : null}
            {items.length === 0 ? (
              <p className="portal-card__body">
                Não reconheci um medicamento. Preencha os campos ou descarte a foto.
              </p>
            ) : null}
            {items.map((item, index) => (
              <fieldset key={index} className="portal-card">
                <legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.include}
                      onChange={(e) => patchItem(index, { include: e.target.checked })}
                    />{' '}
                    Incluir este item
                  </label>
                </legend>
                <label className="patients-field">
                  <span>Nome · {bandLabel(item.nameBand)} · lido na foto</span>
                  <input
                    className="patients-input"
                    value={item.name}
                    onChange={(e) => patchItem(index, { name: e.target.value })}
                  />
                </label>
                <label className="patients-field">
                  <span>Princípio ativo</span>
                  <input
                    className="patients-input"
                    value={item.activeIngredient}
                    onChange={(e) =>
                      patchItem(index, { activeIngredient: e.target.value })
                    }
                  />
                </label>
                <label className="patients-field">
                  <span>
                    Concentração
                    {item.concentrationSource === 'anvisa_cmed'
                      ? ' · Anvisa/CMED'
                      : item.concentration
                        ? ' · lido na foto'
                        : ''}
                  </span>
                  <input
                    className="patients-input"
                    value={item.concentration}
                    onChange={(e) =>
                      patchItem(index, { concentration: e.target.value })
                    }
                  />
                </label>
                <label className="patients-field">
                  <span>Apresentação</span>
                  <input
                    className="patients-input"
                    value={item.presentation}
                    onChange={(e) => patchItem(index, { presentation: e.target.value })}
                  />
                </label>
                <label className="patients-field">
                  <span>Registro</span>
                  <input
                    className="patients-input"
                    value={item.anvisaRegistry}
                    onChange={(e) =>
                      patchItem(index, { anvisaRegistry: e.target.value })
                    }
                  />
                </label>
                {item.classeTerapeutica ? (
                  <p className="patients-field__hint">
                    Classe na Anvisa: {item.classeTerapeutica}. Isso não é a indicação
                    da bula e não será gravado como indicação.
                  </p>
                ) : null}
                {item.candidates.length > 1 ? (
                  <label className="patients-field">
                    <span>Candidatos na base</span>
                    <select
                      className="patients-input"
                      value={item.anvisaRegistry}
                      onChange={(e) => {
                        const chosen = item.candidates.find(
                          (row) => row.registro === e.target.value,
                        );
                        if (!chosen) {
                          patchItem(index, { anvisaRegistry: '' });
                          return;
                        }
                        patchItem(index, {
                          anvisaRegistry: chosen.registro,
                          activeIngredient: chosen.substancia,
                          presentation: chosen.apresentacao,
                          classeTerapeutica: chosen.classeTerapeutica,
                          concentrationSource: 'anvisa_cmed',
                        });
                      }}
                    >
                      <option value="">Não usar a base</option>
                      {item.candidates.map((row) => (
                        <option key={row.registro} value={row.registro}>
                          {row.produto} · {row.laboratorio} · {row.apresentacao}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <p className="patients-field__hint">
                  Indicação e posologia de referência não são preenchidas pela IA.
                </p>
                {patientId ? (
                  <>
                    <label className="patients-field">
                      <span>Quantidade da dose · {bandLabel(item.scheduleBand)}</span>
                      <input
                        className="patients-input"
                        value={item.doseQuantity}
                        onChange={(e) =>
                          patchItem(index, { doseQuantity: e.target.value })
                        }
                      />
                    </label>
                    <label className="patients-field">
                      <span>Via</span>
                      <select
                        className="patients-input"
                        value={item.route}
                        onChange={(e) => patchItem(index, { route: e.target.value })}
                      >
                        <option value="">Escolha</option>
                        {ROUTE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="patients-field">
                      <span>Esquema</span>
                      <select
                        className="patients-input"
                        value={item.scheduleMode}
                        onChange={(e) =>
                          patchItem(index, { scheduleMode: e.target.value })
                        }
                      >
                        <option value="regular_interval">Intervalo regular</option>
                        <option value="custom_times">Horários do dia</option>
                      </select>
                    </label>
                    {item.scheduleMode === 'regular_interval' ? (
                      <label className="patients-field">
                        <span>Intervalo (horas)</span>
                        <input
                          className="patients-input"
                          type="number"
                          min={1}
                          max={168}
                          value={item.intervalHours ?? ''}
                          onChange={(e) =>
                            patchItem(index, {
                              intervalHours: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                        />
                      </label>
                    ) : (
                      <label className="patients-field">
                        <span>Horários (HH:MM separados por vírgula)</span>
                        <input
                          className="patients-input"
                          value={item.timesOfDay.join(', ')}
                          onChange={(e) =>
                            patchItem(index, {
                              timesOfDay: e.target.value
                                .split(',')
                                .map((part) => part.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </label>
                    )}
                    <label className="patients-field">
                      <span>Início</span>
                      <input
                        className="patients-input"
                        type="datetime-local"
                        value={item.startsAt}
                        onChange={(e) => patchItem(index, { startsAt: e.target.value })}
                      />
                    </label>
                    <label className="patients-field">
                      <span>Fim (vazio = contínuo)</span>
                      <input
                        className="patients-input"
                        type="date"
                        value={item.endsOn ?? ''}
                        onChange={(e) =>
                          patchItem(index, { endsOn: e.target.value || null })
                        }
                      />
                    </label>
                    {item.disagreement ? (
                      <p className="patients-alert" role="status">
                        {item.disagreement}
                      </p>
                    ) : null}
                    {item.rawText ? (
                      <p className="patients-field__hint">Texto lido: {item.rawText}</p>
                    ) : null}
                    <button
                      type="button"
                      className="patients-btn patients-btn--secondary"
                      onClick={() => {
                        if (!item.intervalHours || !patientId) return;
                        void suggestFirstDose({
                          intervalHours: item.intervalHours,
                          patientId,
                        }).then((suggestion) => {
                          patchItem(index, {
                            startsAt: toDatetimeLocalValue(suggestion.firstDoseAt),
                          });
                        });
                      }}
                    >
                      Sugerir horário evitando a madrugada
                    </button>
                  </>
                ) : null}
                {duplicate && duplicate.index === index && duplicate.existingId ? (
                  <button
                    type="button"
                    className="patients-btn patients-btn--secondary"
                    onClick={() => {
                      const next = items.map((row, i) =>
                        i === index
                          ? { ...row, reuseExistingId: duplicate.existingId }
                          : row,
                      );
                      setItems(next);
                      setDuplicate(null);
                      void confirmItems(next);
                    }}
                  >
                    Usar o medicamento existente e cadastrar
                  </button>
                ) : null}
              </fieldset>
            ))}
            {error ? (
              <p className="patients-alert" role="alert">
                {error}
              </p>
            ) : null}
            <div className="patients-form__actions">
              <button
                type="button"
                className="patients-btn patients-btn--primary"
                disabled={submitting || items.every((item) => !item.include || !item.name.trim())}
                onClick={() => void onConfirm()}
              >
                {submitting ? 'Cadastrando…' : 'Cadastrar'}
              </button>
              <button
                type="button"
                className="patients-btn patients-btn--secondary"
                onClick={() => void onDiscard()}
              >
                Descartar
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
