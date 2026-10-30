import { useMemo, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Moon, Sun } from '@phosphor-icons/react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { useTheme } from '../theme/useTheme';
import './LoginPage.css';

type Mode = 'login' | 'register';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, toggleTheme] = useTheme();
  const ThemeIcon = theme === 'dark' ? Sun : Moon;
  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const next = params.get('next');
    return next && next.startsWith('/') ? next : '/';
  }, [location.search]);

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [bootstrapClosed, setBootstrapClosed] = useState(false);

  if (auth.status === 'loading') {
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
        <div className="login-card portal-card">
          <p className="portal-card__body">Carregando…</p>
        </div>
      </div>
    );
  }

  if (auth.status === 'authenticated') {
    return <Navigate to={nextPath} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      if (mode === 'login') {
        await auth.login(email, password);
      } else {
        await auth.register({ email, password, name });
      }
      navigate(nextPath, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'BOOTSTRAP_CLOSED') {
          setBootstrapClosed(true);
          setMode('login');
          setError('Cadastro inicial já foi feito. Entre com e-mail e senha.');
        } else if (err.fields) {
          setFieldErrors(err.fields);
          setError(err.message);
        } else {
          setError(err.message);
        }
      } else {
        setError('Não foi possível conectar. Tente de novo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

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
        <h1 className="portal-card__title">Medica Certo</h1>
        <p className="portal-card__body">
          {mode === 'login'
            ? 'Entre para administrar as doses dos pacientes.'
            : 'Crie o primeiro cuidador deste ambiente.'}
        </p>

        {mode === 'register' ? (
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
        ) : null}

        <label className="login-field">
          <span>E-mail</span>
          <input
            className={`login-input${fieldErrors.email ? ' is-error' : ''}`}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {fieldErrors.email ? (
            <span className="login-field__error">{fieldErrors.email}</span>
          ) : null}
        </label>

        <label className="login-field">
          <span>Senha</span>
          <input
            className={`login-input${fieldErrors.password ? ' is-error' : ''}`}
            type="password"
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
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

        <button
          type="submit"
          className="login-button"
          disabled={submitting}
        >
          {submitting
            ? 'Aguarde…'
            : mode === 'login'
              ? 'Entrar'
              : 'Criar cuidador'}
        </button>

        {!bootstrapClosed ? (
          <button
            type="button"
            className="login-switch"
            onClick={() => {
              setMode((m) => (m === 'login' ? 'register' : 'login'));
              setError(null);
              setFieldErrors({});
            }}
          >
            {mode === 'login'
              ? 'Primeiro acesso? Criar cuidador'
              : 'Já tenho conta — Entrar'}
          </button>
        ) : null}
      </form>
    </div>
  );
}
