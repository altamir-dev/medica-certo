import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Moon, Sun } from '@phosphor-icons/react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { lookupInvite } from '../api/invites';
import { useTheme } from '../theme/useTheme';
import './LoginPage.css';

type Lookup =
  | { state: 'loading' }
  | { state: 'invalid' }
  | { state: 'ready'; email: string | null; expiresAt: string };

function formatUntil(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

export function InviteRegisterPage() {
  const { token } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const ThemeIcon = theme === 'dark' ? Sun : Moon;
  const [lookup, setLookup] = useState<Lookup>({ state: 'loading' });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    if (!token) {
      setLookup({ state: 'invalid' });
      return;
    }
    let active = true;
    setLookup({ state: 'loading' });
    lookupInvite(token)
      .then((result) => {
        if (!active) return;
        setLookup({
          state: 'ready',
          email: result.invite.email,
          expiresAt: result.invite.expiresAt,
        });
        if (result.invite.email) setEmail(result.invite.email);
      })
      .catch(() => {
        if (active) setLookup({ state: 'invalid' });
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token || lookup.state !== 'ready') return;
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await auth.register({
        name,
        email: lookup.email ?? email,
        password,
        inviteToken: token,
      });
      setEntering(true);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields) setFieldErrors(err.fields);
        setError(err.message);
      } else {
        setError('Não foi possível conectar. Tente de novo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const boundEmail = lookup.state === 'ready' ? lookup.email : null;

  return (
    <div className="login-page">
      <button
        type="button"
        className="login-theme"
        onClick={toggleTheme}
        aria-label="Alternar tema claro/escuro"
      >
        <ThemeIcon weight="regular" aria-hidden="true" size={20} />
        Tema
      </button>
      <form className="login-card portal-card" onSubmit={onSubmit} noValidate>
        <div className="login-card__brand" aria-hidden="true">
          MC
        </div>
        <h1 className="portal-card__title">Criar conta</h1>
        {entering || lookup.state === 'loading' || auth.status === 'loading' ? (
          <p className="portal-card__body">
            {entering ? 'Entrando…' : 'Carregando convite…'}
          </p>
        ) : lookup.state === 'invalid' ? (
          <>
            <p className="login-alert" role="alert">
              Este convite não é válido, já foi usado ou expirou.
            </p>
            <Link className="login-switch" to="/login">
              Ir para o login
            </Link>
          </>
        ) : (
          <>
            <p className="portal-card__body">
              Você recebeu um convite para ser cuidador no Medica Certo. A
              conta é sua: os pacientes não são compartilhados. Válido até{' '}
              {formatUntil(lookup.expiresAt)}.
            </p>
            {auth.status === 'authenticated' ? (
              <>
                <p className="portal-card__body">
                  Você já está conectado como {auth.caregiver?.name}. Saia da
                  conta para criar outro cuidador com este convite.
                </p>
                <button
                  type="button"
                  className="login-button"
                  onClick={() => {
                    void auth.logout();
                  }}
                >
                  Sair e continuar o cadastro
                </button>
                <Link className="login-switch" to="/">
                  Voltar ao início
                </Link>
              </>
            ) : (
              <>
            <label className="login-field">
              <span>Nome</span>
              <input
                className={`login-input${fieldErrors.name ? ' is-error' : ''}`}
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              {fieldErrors.name ? (
                <span className="login-field__error">{fieldErrors.name}</span>
              ) : null}
            </label>
            <label className="login-field">
              <span>E-mail</span>
              <input
                className={`login-input${fieldErrors.email ? ' is-error' : ''}`}
                type="email"
                autoComplete="username"
                value={boundEmail ?? email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={Boolean(boundEmail)}
                required
              />
              {boundEmail ? (
                <span className="login-field__hint">
                  Este convite está vinculado a este e-mail.
                </span>
              ) : null}
              {fieldErrors.email ? (
                <span className="login-field__error">{fieldErrors.email}</span>
              ) : null}
            </label>
            <label className="login-field">
              <span>Senha</span>
              <input
                className={`login-input${fieldErrors.password ? ' is-error' : ''}`}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
              {fieldErrors.password ? (
                <span className="login-field__error">{fieldErrors.password}</span>
              ) : null}
            </label>
            {error ? (
              <p className="login-alert" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="login-button" disabled={submitting}>
              {submitting ? 'Aguarde…' : 'Criar conta'}
            </button>
            <Link className="login-switch" to="/login">
              Já tenho conta — Entrar
            </Link>
              </>
            )}
          </>
        )}
      </form>
    </div>
  );
}
