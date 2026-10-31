import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import {
  createInvite,
  fetchInvites,
  inviteUrl,
  revokeInvite,
  type Invite,
  type InviteStatus,
} from '../api/invites';
import {
  fetchAccessGrantees,
  fetchGranteeAccess,
  revokeGranteeAccess,
  updateGranteeAccess,
  type AccessGrantee,
} from '../api/patientAccess';
import { listPatients, type Patient } from '../api/patients';

const STATUS_LABEL: Record<InviteStatus, string> = {
  pending: 'Pendente',
  used: 'Usado',
  expired: 'Expirado',
  revoked: 'Revogado',
};

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function statusDetail(invite: Invite) {
  if (invite.status === 'used' && invite.usedAt) {
    return `Usado em ${formatWhen(invite.usedAt)}`;
  }
  if (invite.status === 'revoked' && invite.revokedAt) {
    return `Revogado em ${formatWhen(invite.revokedAt)}`;
  }
  if (invite.status === 'expired') {
    return `Expirou em ${formatWhen(invite.expiresAt)}`;
  }
  return `Expira em ${formatWhen(invite.expiresAt)}`;
}

export function InvitesCard() {
  const [ownedPatients, setOwnedPatients] = useState<Patient[]>([]);
  const [selectedPatients, setSelectedPatients] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(7);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [grantees, setGrantees] = useState<AccessGrantee[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [linkInviteId, setLinkInviteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const reload = useCallback(async () => {
    const [list, access, patients] = await Promise.all([
      fetchInvites(),
      fetchAccessGrantees(),
      listPatients(),
    ]);
    setInvites(list.invites);
    setGrantees(access.grantees);
    const owned = patients.filter((p) => p.access !== 'grantee');
    setOwnedPatients(owned);
    setSelectedPatients((prev) =>
      prev.filter((id) => owned.some((p) => p.id === id)),
    );
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    reload()
      .then(() => {
        if (active) setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(
          err instanceof ApiError ? err.message : 'Falha ao carregar convites.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  function togglePatient(id: string) {
    setSelectedPatients((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await createInvite({
        email: email.trim(),
        patientIds: selectedPatients,
        expiresInDays: days,
      });
      setLink(inviteUrl(created.token));
      setLinkInviteId(created.invite.id);
      setEmail('');
      setSelectedPatients([]);
      setMessage('Convite gerado. Copie o link agora — ele não aparece de novo.');
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Não foi possível gerar o convite.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(link);
      setMessage('Link copiado.');
    } catch {
      setError('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  }

  async function shareLink() {
    if (!link || !canShare) return;
    setError(null);
    try {
      await navigator.share({
        title: 'Convite — Medica Certo',
        text: 'Aceite o convite para ver e registrar doses no Medica Certo.',
        url: link,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError('Não foi possível compartilhar.');
    }
  }

  async function onRevoke(id: string) {
    if (!window.confirm('Revogar este convite? O link deixa de funcionar.')) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await revokeInvite(id);
      if (id === linkInviteId) {
        setLink(null);
        setLinkInviteId(null);
      }
      setMessage('Convite revogado.');
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Não foi possível revogar.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function onRevokeGrantee(grantee: AccessGrantee) {
    if (
      !window.confirm(
        `Revogar todo o acesso de ${grantee.name}? A conta dela continua existindo.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await revokeGranteeAccess(grantee.caregiverId);
      setMessage('Acesso revogado.');
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Não foi possível revogar.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function onUpdateGranteePatients(
    grantee: AccessGrantee,
    patientIds: string[],
  ) {
    setBusy(true);
    setError(null);
    try {
      await updateGranteeAccess(grantee.caregiverId, patientIds);
      setMessage('Pacientes atualizados.');
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Não foi possível atualizar.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (ownedPatients.length === 0) {
    return (
      <div className="portal-card settings-card">
        <h3 className="settings-card__title">Compartilhar pacientes</h3>
        <p className="settings-hint">
          Cadastre um paciente seu para convidar outra pessoa a ver a grade e
          registrar doses.
        </p>
      </div>
    );
  }

  return (
    <div className="portal-card settings-card">
      <h3 className="settings-card__title">Compartilhar pacientes</h3>
      <p className="settings-hint">
        Gere um link para outra pessoa criar conta ou entrar com o e-mail
        indicado. Ela verá só os pacientes marcados e poderá registrar doses e
        anotações. O link vale uma vez.
      </p>

      {error ? (
        <p className="patients-alert" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="settings-ok" role="status">
          {message}
        </p>
      ) : null}

      <form className="invite-form" onSubmit={onCreate}>
        <label className="patients-field">
          <span>E-mail do convidado</span>
          <input
            className="patients-input"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pessoa@example.com"
            required
          />
        </label>
        <fieldset className="invite-patients">
          <legend className="patients-field">
            <span>Pacientes no convite</span>
          </legend>
          <ul className="invite-patient-list">
            {ownedPatients.map((p) => (
              <li key={p.id}>
                <label className="invite-patient-check">
                  <input
                    type="checkbox"
                    checked={selectedPatients.includes(p.id)}
                    onChange={() => togglePatient(p.id)}
                  />
                  {p.name}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <label className="patients-field">
          <span>Validade</span>
          <select
            className="patients-input"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>1 dia</option>
            <option value={7}>7 dias</option>
            <option value={14}>14 dias</option>
            <option value={30}>30 dias</option>
          </select>
        </label>
        <button
          type="submit"
          className="patients-btn patients-btn--primary"
          disabled={busy || selectedPatients.length === 0 || !email.trim()}
        >
          {busy ? 'Aguarde…' : 'Gerar convite'}
        </button>
      </form>

      {link ? (
        <div className="invite-link">
          <label className="patients-field">
            <span>Link do convite</span>
            <input
              className="patients-input"
              readOnly
              value={link}
              aria-label="Link do convite"
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <div className="settings-actions">
            <button
              type="button"
              className="patients-btn patients-btn--secondary"
              onClick={() => {
                void copyLink();
              }}
            >
              Copiar link
            </button>
            {canShare ? (
              <button
                type="button"
                className="patients-btn patients-btn--secondary"
                onClick={() => {
                  void shareLink();
                }}
              >
                Compartilhar
              </button>
            ) : null}
          </div>
          <p className="settings-hint">
            Envie por WhatsApp ou outro meio. O Medica Certo não manda e-mail.
          </p>
        </div>
      ) : null}

      <h4 className="settings-sub">Convites pendentes</h4>
      {loading ? (
        <p className="settings-hint">Carregando…</p>
      ) : invites.length === 0 ? (
        <p className="settings-hint">Nenhum convite ainda.</p>
      ) : (
        <ul className="invite-list">
          {invites.map((invite) => (
            <li key={invite.id} className="invite-row">
              <div className="invite-row__main">
                <span className={`invite-status invite-status--${invite.status}`}>
                  {STATUS_LABEL[invite.status]}
                </span>
                <p className="invite-row__email">{invite.email ?? '—'}</p>
                <p className="settings-hint">{statusDetail(invite)}</p>
              </div>
              {invite.status === 'pending' || invite.status === 'expired' ? (
                <button
                  type="button"
                  className="patients-btn patients-btn--danger"
                  disabled={busy}
                  onClick={() => {
                    void onRevoke(invite.id);
                  }}
                >
                  Revogar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h4 className="settings-sub">Quem já tem acesso</h4>
      {grantees.length === 0 ? (
        <p className="settings-hint">Ninguém com acesso compartilhado ainda.</p>
      ) : (
        <ul className="invite-list">
          {grantees.map((g) => (
            <GranteeRow
              key={g.caregiverId}
              grantee={g}
              ownedPatients={ownedPatients}
              busy={busy}
              onRevoke={() => {
                void onRevokeGrantee(g);
              }}
              onSave={(ids) => {
                void onUpdateGranteePatients(g, ids);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function GranteeRow({
  grantee,
  ownedPatients,
  busy,
  onRevoke,
  onSave,
}: {
  grantee: AccessGrantee;
  ownedPatients: Patient[];
  busy: boolean;
  onRevoke: () => void;
  onSave: (patientIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    fetchGranteeAccess(grantee.caregiverId)
      .then((detail) => setSelected(detail.access.patientIds))
      .catch(() => setSelected([]));
  }, [open, grantee.caregiverId]);

  return (
    <li className="invite-row">
      <div className="invite-row__main">
        <p className="invite-row__email">
          {grantee.name} · {grantee.email}
        </p>
        <p className="settings-hint">Desde {formatWhen(grantee.since)}</p>
        {open ? (
          <ul className="invite-patient-list">
            {ownedPatients.map((p) => (
              <li key={p.id}>
                <label className="invite-patient-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={() =>
                      setSelected((prev) =>
                        prev.includes(p.id)
                          ? prev.filter((x) => x !== p.id)
                          : [...prev, p.id],
                      )
                    }
                  />
                  {p.name}
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="settings-actions">
        <button
          type="button"
          className="patients-btn patients-btn--secondary"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Fechar' : 'Editar pacientes'}
        </button>
        {open ? (
          <button
            type="button"
            className="patients-btn patients-btn--primary"
            disabled={busy || selected.length === 0}
            onClick={() => onSave(selected)}
          >
            Salvar
          </button>
        ) : null}
        <button
          type="button"
          className="patients-btn patients-btn--danger"
          disabled={busy}
          onClick={onRevoke}
        >
          Revogar
        </button>
      </div>
    </li>
  );
}
