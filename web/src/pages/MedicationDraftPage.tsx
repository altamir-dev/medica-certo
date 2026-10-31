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
  registryFromMatch: boolean;
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
    referencePosology: '',
    registryFromMatch: Boolean(item.anvisaRegistry),
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorItemIndex, setErrorItemIndex] = useState<number | null>(null);
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

  function errorFor(index: number, field: string) {
    if (errorItemIndex !== index) return undefined;
    return fieldErrors[field];
  }

  function patchItem(index: number, patch: Partial<ReviewItem>) {
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
    setFieldErrors((current) => {
      if (errorItemIndex !== index) return current;
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
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
    setFieldErrors({});
    setErrorItemIndex(null);
    setDuplicate(null);
    setSubmitting(true);
    try {
      const payload = source.map((item) => ({
        ...item,
        createTreatment: Boolean(patientId && item.doseQuantity.trim()),
        startsAt: item.startsAt.includes('T')
          ? datetimeLocalToIso(item.startsAt)
          : item.startsAt,
      }));
      const result = await confirmMedicationDraft(draftId, payload);
      const treatmentId = result.treatmentIds[0];
      const medicationId = result.medicationIds[0];
      if (treatmentId) navigate(`/tratamentos/${treatmentId}`, { replace: true });
      else if (medicationId) {
        navigate(`/medicamentos/${medicationId}`, {
          replace: true,
          state:
            kind === 'package'
              ? { offerTreatment: true, patientId: patientId ?? null }
              : undefined,
        });
      } else navigate(backHref, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') {
        setDuplicate({
          index: Number(err.fields?.itemIndex ?? 0),
          existingId: err.fields?.existingId ?? '',
        });
        setError(err.message);
      } else if (err instanceof ApiError && err.fields) {
        const { itemIndex, ...rest } = err.fields;
        const index = itemIndex != null ? Number(itemIndex) : 0;
        const shown = new Set([
          'name',
          'activeIngredient',
          'concentration',
          'presentation',
          'anvisaRegistry',
          'referencePosology',
          'doseQuantity',
          'route',
          'intervalHours',
          'timesOfDay',
          'startsAt',
          'endsOn',
        ]);
        const unmapped = Object.entries(rest).filter(([key]) => !shown.has(key));
        setErrorItemIndex(Number.isFinite(index) ? index : 0);
        setFieldErrors(rest);
        setError(
          unmapped.length > 0
            ? unmapped.map(([, message]) => message).join(' ')
            : Object.keys(rest).length > 0
              ? null
              : err.message,
        );
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
                    className={`patients-input${errorFor(index, 'name') ? ' is-error' : ''}`}
                    value={item.name}
                    aria-invalid={Boolean(errorFor(index, 'name')) || undefined}
                    onChange={(e) => patchItem(index, { name: e.target.value })}
                  />
                  {errorFor(index, 'name') ? (
                    <span className="patients-field__error">{errorFor(index, 'name')}</span>
                  ) : null}
                </label>
                <label className="patients-field">
                  <span>Princípio ativo</span>
                  <input
                    className={`patients-input${
                      errorFor(index, 'activeIngredient') ? ' is-error' : ''
                    }`}
                    value={item.activeIngredient}
                    aria-invalid={Boolean(errorFor(index, 'activeIngredient')) || undefined}
                    onChange={(e) =>
                      patchItem(index, { activeIngredient: e.target.value })
                    }
                  />
                  {errorFor(index, 'activeIngredient') ? (
                    <span className="patients-field__error">
                      {errorFor(index, 'activeIngredient')}
                    </span>
                  ) : null}
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
                    className={`patients-input${
                      errorFor(index, 'concentration') ? ' is-error' : ''
                    }`}
                    value={item.concentration}
                    aria-invalid={Boolean(errorFor(index, 'concentration')) || undefined}
                    onChange={(e) =>
                      patchItem(index, { concentration: e.target.value })
                    }
                  />
                  {errorFor(index, 'concentration') ? (
                    <span className="patients-field__error">
                      {errorFor(index, 'concentration')}
                    </span>
                  ) : null}
                </label>
                <label className="patients-field">
                  <span>Apresentação</span>
                  <input
                    className={`patients-input${
                      errorFor(index, 'presentation') ? ' is-error' : ''
                    }`}
                    value={item.presentation}
                    aria-invalid={Boolean(errorFor(index, 'presentation')) || undefined}
                    onChange={(e) => patchItem(index, { presentation: e.target.value })}
                  />
                  {errorFor(index, 'presentation') ? (
                    <span className="patients-field__error">
                      {errorFor(index, 'presentation')}
                    </span>
                  ) : null}
                </label>
                <label className="patients-field">
                  <span>Registro Anvisa</span>
                  <input
                    className={`patients-input${
                      errorFor(index, 'anvisaRegistry') ? ' is-error' : ''
                    }`}
                    value={item.anvisaRegistry}
                    readOnly={item.registryFromMatch}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="número Anvisa, 9 ou 13 dígitos, opcional"
                    aria-invalid={Boolean(errorFor(index, 'anvisaRegistry')) || undefined}
                    onChange={(e) =>
                      patchItem(index, { anvisaRegistry: e.target.value })
                    }
                  />
                  {errorFor(index, 'anvisaRegistry') ? (
                    <span className="patients-field__error">
                      {errorFor(index, 'anvisaRegistry')}
                    </span>
                  ) : (
                    <span className="patients-field__hint">
                      {item.registryFromMatch
                        ? 'Preenchido pela base da Anvisa. Número de 9 ou 13 dígitos.'
                        : 'Número Anvisa, 9 ou 13 dígitos, opcional. Não é a posologia.'}
                    </span>
                  )}
                </label>
                {kind === 'package' ? (
                  <label className="patients-field">
                    <span>Posologia</span>
                    <input
                      className={`patients-input${
                        errorFor(index, 'referencePosology') ? ' is-error' : ''
                      }`}
                      value={item.referencePosology}
                      placeholder="Ex.: 1 comprimido ao dia"
                      aria-invalid={
                        Boolean(errorFor(index, 'referencePosology')) || undefined
                      }
                      onChange={(e) =>
                        patchItem(index, { referencePosology: e.target.value })
                      }
                    />
                    {errorFor(index, 'referencePosology') ? (
                      <span className="patients-field__error">
                        {errorFor(index, 'referencePosology')}
                      </span>
                    ) : patientId ? (
                      <span className="patients-field__hint">
                        É aqui que entra a dose, por exemplo “1 comprimido ao dia”.
                        Os horários do tratamento ficam nos campos abaixo.
                      </span>
                    ) : (
                      <span className="patients-field__hint">
                        É aqui que entra a dose, por exemplo “1 comprimido ao dia”.
                        O registro Anvisa é só o número do produto. Depois de
                        cadastrar, crie o tratamento no paciente.
                      </span>
                    )}
                  </label>
                ) : null}
                {item.classeTerapeutica ? (
                  <p className="patients-field__hint">
                    Classe na Anvisa: {item.classeTerapeutica}. Isso não é a indicação
                    da bula e não será gravado como indicação.
                  </p>
                ) : null}
                {item.candidates.length > 0 ? (
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
                          patchItem(index, {
                            anvisaRegistry: '',
                            registryFromMatch: false,
                          });
                          return;
                        }
                        patchItem(index, {
                          anvisaRegistry: chosen.registro,
                          activeIngredient: chosen.substancia || item.activeIngredient,
                          ...(chosen.apresentacao
                            ? {
                                presentation: chosen.apresentacao,
                                concentrationSource: 'anvisa_cmed' as const,
                              }
                            : {}),
                          classeTerapeutica: chosen.classeTerapeutica,
                          registryFromMatch: true,
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
                    {kind === 'package' ? (
                      <p className="patients-field__hint">Posologia do tratamento</p>
                    ) : null}
                    <label className="patients-field">
                      <span>
                        {kind === 'package'
                          ? 'Posologia · quantidade da dose'
                          : `Quantidade da dose · ${bandLabel(item.scheduleBand)}`}
                      </span>
                      <input
                        className={`patients-input${
                          errorFor(index, 'doseQuantity') ? ' is-error' : ''
                        }`}
                        value={item.doseQuantity}
                        placeholder={kind === 'package' ? 'Ex.: 1 comprimido ao dia' : undefined}
                        aria-invalid={Boolean(errorFor(index, 'doseQuantity')) || undefined}
                        onChange={(e) =>
                          patchItem(index, { doseQuantity: e.target.value })
                        }
                      />
                      {errorFor(index, 'doseQuantity') ? (
                        <span className="patients-field__error">
                          {errorFor(index, 'doseQuantity')}
                        </span>
                      ) : null}
                    </label>
                    <label className="patients-field">
                      <span>Via</span>
                      <select
                        className={`patients-input${errorFor(index, 'route') ? ' is-error' : ''}`}
                        value={item.route}
                        aria-invalid={Boolean(errorFor(index, 'route')) || undefined}
                        onChange={(e) => patchItem(index, { route: e.target.value })}
                      >
                        <option value="">Escolha</option>
                        {ROUTE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      {errorFor(index, 'route') ? (
                        <span className="patients-field__error">
                          {errorFor(index, 'route')}
                        </span>
                      ) : null}
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
                          className={`patients-input${
                            errorFor(index, 'intervalHours') ? ' is-error' : ''
                          }`}
                          type="number"
                          min={1}
                          max={168}
                          value={item.intervalHours ?? ''}
                          aria-invalid={Boolean(errorFor(index, 'intervalHours')) || undefined}
                          onChange={(e) =>
                            patchItem(index, {
                              intervalHours: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                        />
                        {errorFor(index, 'intervalHours') ? (
                          <span className="patients-field__error">
                            {errorFor(index, 'intervalHours')}
                          </span>
                        ) : null}
                      </label>
                    ) : (
                      <label className="patients-field">
                        <span>Horários (HH:MM separados por vírgula)</span>
                        <input
                          className={`patients-input${
                            errorFor(index, 'timesOfDay') ? ' is-error' : ''
                          }`}
                          value={item.timesOfDay.join(', ')}
                          aria-invalid={Boolean(errorFor(index, 'timesOfDay')) || undefined}
                          onChange={(e) =>
                            patchItem(index, {
                              timesOfDay: e.target.value
                                .split(',')
                                .map((part) => part.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                        {errorFor(index, 'timesOfDay') ? (
                          <span className="patients-field__error">
                            {errorFor(index, 'timesOfDay')}
                          </span>
                        ) : null}
                      </label>
                    )}
                    <label className="patients-field">
                      <span>Início</span>
                      <input
                        className={`patients-input${
                          errorFor(index, 'startsAt') ? ' is-error' : ''
                        }`}
                        type="datetime-local"
                        value={item.startsAt}
                        aria-invalid={Boolean(errorFor(index, 'startsAt')) || undefined}
                        onChange={(e) => patchItem(index, { startsAt: e.target.value })}
                      />
                      {errorFor(index, 'startsAt') ? (
                        <span className="patients-field__error">
                          {errorFor(index, 'startsAt')}
                        </span>
                      ) : null}
                    </label>
                    <label className="patients-field">
                      <span>Fim (vazio = contínuo)</span>
                      <input
                        className={`patients-input${
                          errorFor(index, 'endsOn') ? ' is-error' : ''
                        }`}
                        aria-invalid={Boolean(errorFor(index, 'endsOn')) || undefined}
                        type="date"
                        value={item.endsOn ?? ''}
                        onChange={(e) =>
                          patchItem(index, { endsOn: e.target.value || null })
                        }
                      />
                      {errorFor(index, 'endsOn') ? (
                        <span className="patients-field__error">
                          {errorFor(index, 'endsOn')}
                        </span>
                      ) : null}
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
              {kind === 'package' && !patientId ? (
                <Link to="/pacientes" className="patients-btn patients-btn--secondary">
                  Criar o tratamento depois de cadastrar
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
