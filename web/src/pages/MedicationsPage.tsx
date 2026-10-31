import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, PencilSimple, Trash, Image as ImageIcon } from '@phosphor-icons/react';
import { ApiError } from '../api/client';
import {
  deleteMedication,
  listMedications,
  type Medication,
} from '../api/medications';
import { safeReturnTo } from '../lib/safeReturnTo';
import './PatientsPage.css';
import './MedicationsPage.css';

function formatInterval(hours: number | null) {
  if (hours == null) return null;
  return `a cada ${hours}h`;
}

export function MedicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';
  const [qInput, setQInput] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [medications, setMedications] = useState<Medication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQ(qInput.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [qInput]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (q) next.set('q', q);
    else next.delete('q');
    setSearchParams(next, { replace: true });
    // Only sync q into the URL; ignore other searchParams churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, setSearchParams]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listMedications(q || undefined);
      setMedications(data);
    } catch (err) {
      setMedications([]);
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível carregar os medicamentos.',
      );
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  const createParams = new URLSearchParams();
  if (q) createParams.set('name', q);
  if (returnTo) createParams.set('returnTo', returnTo);
  const createQs = createParams.toString();
  const createHref = createQs
    ? `/medicamentos/novo?${createQs}`
    : '/medicamentos/novo';

  async function handleDelete(medication: Medication) {
    const ok = window.confirm(
      `Excluir o medicamento “${medication.name}”? Esta ação não pode ser desfeita.`,
    );
    if (!ok) return;

    setDeletingId(medication.id);
    setError(null);
    try {
      await deleteMedication(medication.id);
      setMedications((prev) =>
        (prev ?? []).filter((item) => item.id !== medication.id),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível excluir o medicamento.',
      );
    } finally {
      setDeletingId(null);
    }
  }

  const isSearching = Boolean(q);
  const emptyCatalog =
    medications !== null && medications.length === 0 && !isSearching;
  const emptySearch =
    medications !== null && medications.length === 0 && isSearching;

  return (
    <div className="patients-page">
      <div className="patients-toolbar">
        <p className="patients-toolbar__hint">
          Catálogo reutilizável nos tratamentos. Busque por nome ou princípio
          ativo.
        </p>
        <Link to={createHref} className="patients-btn patients-btn--primary">
          <Plus weight="bold" size={18} aria-hidden="true" />
          Novo medicamento
        </Link>
      </div>

      <div className="meds-search">
        <label className="patients-field meds-search__field">
          <span className="visually-hidden">Buscar medicamento</span>
          <input
            className="patients-input"
            type="search"
            placeholder="Buscar por nome ou princípio ativo…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            autoComplete="off"
          />
        </label>
      </div>

      {error ? (
        <p className="patients-alert" role="alert">
          {error}
        </p>
      ) : null}

      {medications === null ? (
        <section className="portal-card">
          <p className="portal-card__body">Carregando medicamentos…</p>
        </section>
      ) : emptyCatalog ? (
        <section className="portal-card patients-empty">
          <h2 className="patients-empty__title">Nenhum medicamento ainda</h2>
          <p className="portal-card__body">
            Cadastre o primeiro medicamento para reutilizar em tratamentos.
          </p>
          <Link to={createHref} className="patients-btn patients-btn--primary">
            <Plus weight="bold" size={18} aria-hidden="true" />
            Cadastrar medicamento
          </Link>
        </section>
      ) : emptySearch ? (
        <section className="portal-card patients-empty">
          <h2 className="patients-empty__title">Nenhum resultado</h2>
          <p className="portal-card__body">
            Não encontramos “{q}” no catálogo. Cadastre agora e continue o
            fluxo.
          </p>
          <Link to={createHref} className="patients-btn patients-btn--primary">
            <Plus weight="bold" size={18} aria-hidden="true" />
            Cadastrar «{q}»
          </Link>
        </section>
      ) : (
        <div className="patients-list">
          {medications.map((medication) => {
            const interval = formatInterval(medication.usualIntervalHours);
            const metaParts = [
              medication.activeIngredient || null,
              interval,
              medication.hasPhoto ? 'com foto' : null,
            ].filter(Boolean);

            return (
              <article key={medication.id} className="portal-card patients-row">
                <div className="patients-row__main">
                  <h2 className="meds-row__name">
                    {medication.hasPhoto ? (
                      <ImageIcon
                        className="meds-photo-icon"
                        weight="regular"
                        size={18}
                        aria-label="Possui foto"
                      />
                    ) : null}
                    {medication.name}
                  </h2>
                  {metaParts.length > 0 ? (
                    <p className="patients-row__meta">{metaParts.join(' · ')}</p>
                  ) : (
                    <p className="patients-row__meta">Sem detalhes extras</p>
                  )}
                </div>
                <div className="patients-row__actions">
                  <Link
                    to={`/medicamentos/${medication.id}`}
                    className="patients-btn patients-btn--secondary"
                  >
                    <PencilSimple weight="bold" size={18} aria-hidden="true" />
                    Editar
                  </Link>
                  <button
                    type="button"
                    className="patients-btn patients-btn--danger"
                    disabled={deletingId === medication.id}
                    onClick={() => {
                      void handleDelete(medication);
                    }}
                  >
                    <Trash weight="bold" size={18} aria-hidden="true" />
                    {deletingId === medication.id ? 'Excluindo…' : 'Excluir'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
