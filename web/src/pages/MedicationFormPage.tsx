import { useEffect, useState, type FormEvent } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  createMedication,
  getMedication,
  updateMedication,
  uploadMedicationPhoto,
} from '../api/medications';
import { safeReturnTo } from '../lib/safeReturnTo';
import './PatientsPage.css';
import './MedicationsPage.css';

type Mode = 'create' | 'edit';

type FormLocationState = {
  photoUploadError?: string;
  offerTreatment?: boolean;
  patientId?: string | null;
};

function readPhotoUploadError(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as FormLocationState).photoUploadError;
  return typeof value === 'string' && value.trim() ? value : null;
}

function readOfferTreatment(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const value = state as FormLocationState;
  if (!value.offerTreatment) return null;
  return typeof value.patientId === 'string' && value.patientId
    ? `/pacientes/${value.patientId}/tratamentos/novo`
    : '/pacientes';
}

export function MedicationFormPage() {
  const { id } = useParams<{ id: string }>();
  const mode: Mode = id ? 'edit' : 'create';
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const prefillName = searchParams.get('name') ?? '';
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const photoUploadErrorFromState = readPhotoUploadError(location.state);
  const [offerTreatmentHref] = useState(() => readOfferTreatment(location.state));

  const [name, setName] = useState(mode === 'create' ? prefillName : '');
  const [activeIngredient, setActiveIngredient] = useState('');
  const [indication, setIndication] = useState('');
  const [referencePosology, setReferencePosology] = useState('');
  const [usualIntervalHours, setUsualIntervalHours] = useState('');
  const [concentration, setConcentration] = useState('');
  const [presentation, setPresentation] = useState('');
  const [anvisaRegistry, setAnvisaRegistry] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(mode === 'edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    photoUploadErrorFromState
      ? `Medicamento salvo; falha ao enviar a foto. ${photoUploadErrorFromState} Selecione a foto novamente para tentar.`
      : null,
  );
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!photoUploadErrorFromState) return;
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: {},
    });
  }, [
    photoUploadErrorFromState,
    navigate,
    location.pathname,
    location.search,
  ]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [photoFile]);

  useEffect(() => {
    if (mode !== 'edit' || !id) return;

    let cancelled = false;
    // Preserve soft-error from create→edit navigate(state); do not clear it on load.
    const keepPhotoError = Boolean(readPhotoUploadError(location.state));

    async function load() {
      setLoading(true);
      if (!keepPhotoError) setError(null);
      try {
        const medication = await getMedication(id!);
        if (cancelled) return;
        setName(medication.name);
        setActiveIngredient(medication.activeIngredient);
        setIndication(medication.indication);
        setReferencePosology(medication.referencePosology);
        setUsualIntervalHours(
          medication.usualIntervalHours == null
            ? ''
            : String(medication.usualIntervalHours),
        );
        setConcentration(medication.concentration ?? '');
        setPresentation(medication.presentation ?? '');
        setAnvisaRegistry(medication.anvisaRegistry ?? '');
        setHasPhoto(medication.hasPhoto);
        setUpdatedAt(medication.updatedAt);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Não foi possível carregar o medicamento.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // location.state read only for initial keepPhotoError; clearing state must not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, id]);

  function buildPayload() {
    const trimmedInterval = usualIntervalHours.trim();
    let interval: number | null = null;
    if (trimmedInterval) {
      const n = Number(trimmedInterval);
      interval = Number.isFinite(n) ? n : NaN;
    }

    return {
      name: name.trim(),
      activeIngredient: activeIngredient.trim(),
      indication: indication.trim(),
      referencePosology: referencePosology.trim(),
      usualIntervalHours: interval,
      concentration: concentration.trim(),
      presentation: presentation.trim(),
      anvisaRegistry: anvisaRegistry.trim(),
    };
  }

  function editPathFor(medicationId: string) {
    const params = new URLSearchParams();
    if (returnTo) params.set('returnTo', returnTo);
    const qs = params.toString();
    return qs
      ? `/medicamentos/${medicationId}?${qs}`
      : `/medicamentos/${medicationId}`;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDuplicateId(null);
    setFieldErrors({});
    setSubmitting(true);

    const payload = buildPayload();
    if (
      payload.usualIntervalHours !== null &&
      (!Number.isInteger(payload.usualIntervalHours) ||
        payload.usualIntervalHours < 1 ||
        payload.usualIntervalHours > 168)
    ) {
      setFieldErrors({
        usualIntervalHours: 'Informe um intervalo em horas entre 1 e 168.',
      });
      setSubmitting(false);
      return;
    }

    try {
      let medicationId = id;
      let justCreated = false;

      if (mode === 'create') {
        const created = await createMedication(payload);
        medicationId = created.id;
        justCreated = true;
        setUpdatedAt(created.updatedAt);
      } else if (id) {
        const updated = await updateMedication(id, payload);
        setUpdatedAt(updated.updatedAt);
      }

      if (photoFile && medicationId) {
        try {
          const withPhoto = await uploadMedicationPhoto(medicationId, photoFile);
          setHasPhoto(withPhoto.hasPhoto);
          setUpdatedAt(withPhoto.updatedAt);
          setPhotoFile(null);
        } catch (photoErr) {
          const detail =
            photoErr instanceof ApiError
              ? photoErr.message
              : 'Tente enviar a foto de novo.';
          const message = `Medicamento salvo; falha ao enviar a foto. ${detail}`;
          if (justCreated && medicationId) {
            navigate(editPathFor(medicationId), {
              replace: true,
              state: { photoUploadError: detail },
            });
          } else {
            setError(
              `${message} Selecione a foto novamente se necessário.`,
            );
          }
          return;
        }
      }

      if (returnTo && medicationId) {
        const sep = returnTo.includes('?') ? '&' : '?';
        navigate(`${returnTo}${sep}medicationId=${encodeURIComponent(medicationId)}`, {
          replace: true,
        });
      } else {
        navigate(returnTo ?? '/medicamentos', { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'DUPLICATE_NAME') {
          setDuplicateId(err.fields?.existingId ?? null);
          setError(err.message);
        } else {
          if (err.fields) {
            const { existingId: _existingId, ...rest } = err.fields;
            setFieldErrors(rest);
          }
          setError(err.message);
        }
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
        <p className="portal-card__body">Carregando medicamento…</p>
      </section>
    );
  }

  const cancelTo = returnTo ?? '/medicamentos';
  const serverPhotoSrc =
    mode === 'edit' && hasPhoto && id
      ? `/api/medications/${id}/photo${
          updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : ''
        }`
      : null;
  const previewSrc = photoPreviewUrl ?? serverPhotoSrc;

  return (
    <div className="patients-page">
      <section className="portal-card">
        <h2 className="portal-card__title">
          {mode === 'create' ? 'Novo medicamento' : 'Editar medicamento'}
        </h2>
        <p className="portal-card__body">
          Nome é obrigatório. Princípio ativo, indicação, posologia, intervalo e
          foto são opcionais.
        </p>
        {offerTreatmentHref ? (
          <>
            <p className="portal-card__body">
              A posologia com horário entra no tratamento do paciente.
            </p>
            <p className="patients-form__actions">
              <Link
                to={offerTreatmentHref}
                className="patients-btn patients-btn--secondary"
              >
                Criar o tratamento
              </Link>
            </p>
          </>
        ) : null}

        <form className="patients-form" onSubmit={onSubmit} noValidate>
          <label className="patients-field">
            <span>Nome</span>
            <input
              className={`patients-input${fieldErrors.name ? ' is-error' : ''}`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              autoComplete="off"
            />
            {fieldErrors.name ? (
              <span className="patients-field__error">{fieldErrors.name}</span>
            ) : null}
          </label>

          <label className="patients-field">
            <span>Princípio ativo</span>
            <input
              className={`patients-input${
                fieldErrors.activeIngredient ? ' is-error' : ''
              }`}
              type="text"
              value={activeIngredient}
              onChange={(e) => setActiveIngredient(e.target.value)}
              maxLength={200}
              autoComplete="off"
            />
            {fieldErrors.activeIngredient ? (
              <span className="patients-field__error">
                {fieldErrors.activeIngredient}
              </span>
            ) : null}
          </label>

          <label className="patients-field">
            <span>Concentração</span>
            <input
              className={`patients-input${
                fieldErrors.concentration ? ' is-error' : ''
              }`}
              type="text"
              value={concentration}
              onChange={(e) => setConcentration(e.target.value)}
              maxLength={80}
              autoComplete="off"
            />
          </label>

          <label className="patients-field">
            <span>Apresentação</span>
            <input
              className="patients-input"
              type="text"
              value={presentation}
              onChange={(e) => setPresentation(e.target.value)}
              maxLength={200}
              autoComplete="off"
            />
          </label>

          <label className="patients-field">
            <span>Registro Anvisa</span>
            <input
              className={`patients-input${
                fieldErrors.anvisaRegistry ? ' is-error' : ''
              }`}
              type="text"
              value={anvisaRegistry}
              onChange={(e) => setAnvisaRegistry(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
            />
          </label>

          <label className="patients-field">
            <span>Indicação</span>
            <input
              className={`patients-input${
                fieldErrors.indication ? ' is-error' : ''
              }`}
              type="text"
              value={indication}
              onChange={(e) => setIndication(e.target.value)}
              maxLength={500}
              autoComplete="off"
            />
            {fieldErrors.indication ? (
              <span className="patients-field__error">
                {fieldErrors.indication}
              </span>
            ) : null}
          </label>

          <label className="patients-field">
            <span>Posologia de referência</span>
            <textarea
              className={`meds-textarea${
                fieldErrors.referencePosology ? ' is-error' : ''
              }`}
              value={referencePosology}
              onChange={(e) => setReferencePosology(e.target.value)}
              maxLength={2000}
              rows={4}
            />
            {fieldErrors.referencePosology ? (
              <span className="patients-field__error">
                {fieldErrors.referencePosology}
              </span>
            ) : (
              <span className="patients-field__hint">
                Texto livre da bula ou orientação médica.
              </span>
            )}
          </label>

          <label className="patients-field">
            <span>Intervalo usual (horas)</span>
            <input
              className={`patients-input${
                fieldErrors.usualIntervalHours ? ' is-error' : ''
              }`}
              type="number"
              inputMode="numeric"
              min={1}
              max={168}
              step={1}
              value={usualIntervalHours}
              onChange={(e) => setUsualIntervalHours(e.target.value)}
              placeholder="Ex.: 8"
            />
            {fieldErrors.usualIntervalHours ? (
              <span className="patients-field__error">
                {fieldErrors.usualIntervalHours}
              </span>
            ) : (
              <span className="patients-field__hint">
                Opcional — sugestão ao criar tratamento (1–168).
              </span>
            )}
          </label>

          <label className="patients-field">
            <span>Foto (opcional)</span>
            <input
              className="patients-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setPhotoFile(file);
              }}
            />
            <span className="patients-field__hint">
              JPEG, PNG ou WebP · máx. 2 MB
              {hasPhoto && !photoFile ? ' · já há uma foto salva' : ''}
              {photoFile ? ` · novo arquivo: ${photoFile.name}` : ''}
            </span>
            {previewSrc ? (
              <img
                className="meds-photo-preview"
                src={previewSrc}
                alt={`Foto de ${name || 'medicamento'}`}
              />
            ) : null}
          </label>

          {duplicateId ? (
            <div className="meds-duplicate" role="alert">
              <span>{error}</span>
              <Link
                to={`/medicamentos/${duplicateId}`}
                className="patients-btn patients-btn--secondary"
              >
                Abrir medicamento existente
              </Link>
            </div>
          ) : error ? (
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
              to={cancelTo}
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
