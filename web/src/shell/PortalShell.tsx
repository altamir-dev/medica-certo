import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  House,
  Users,
  Pill,
  GearSix,
  SignOut,
  Moon,
  Sun,
} from '@phosphor-icons/react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/useTheme';
import { useNow } from '../lib/useNow';
import { formatNowDate, formatNowTime } from '../lib/clock';
import { AlarmProvider } from '../alarms/AlarmContext';
import './PortalShell.css';

/** Own tick so the shell/Outlet do not re-render every second. */
function HeaderClock() {
  const now = useNow(1000);
  return (
    <p className="portal-header__meta" aria-live="polite">
      <span className="portal-header__date">{formatNowDate(now)}</span>
      <span className="portal-header__sep" aria-hidden="true">
        ·
      </span>
      <span className="portal-header__time">{formatNowTime(now)}</span>
    </p>
  );
}

const NAV_ITEMS: Array<{
  to: string;
  label: string;
  shortLabel: string;
  icon: typeof House;
  end?: boolean;
}> = [
  { to: '/', label: 'Dashboard', shortLabel: 'Início', icon: House, end: true },
  { to: '/pacientes', label: 'Pacientes', shortLabel: 'Pacientes', icon: Users },
  {
    to: '/medicamentos',
    label: 'Medicamentos',
    shortLabel: 'Meds',
    icon: Pill,
  },
  {
    to: '/configuracoes',
    label: 'Configurações',
    shortLabel: 'Config',
    icon: GearSix,
  },
];

function titleForPath(pathname: string) {
  if (pathname === '/') return 'Dashboard';
  if (pathname === '/pacientes/novo') return 'Novo paciente';
  if (pathname.match(/^\/pacientes\/[^/]+\/editar$/)) return 'Editar paciente';
  if (pathname.match(/^\/pacientes\/[^/]+\/tratamentos/)) return 'Tratamento';
  if (pathname.match(/^\/pacientes\/[^/]+$/)) return 'Paciente';
  if (pathname.startsWith('/pacientes')) return 'Pacientes';
  if (pathname.startsWith('/tratamentos/')) return 'Tratamento';
  if (pathname === '/medicamentos/novo') return 'Novo medicamento';
  if (pathname.startsWith('/medicamentos/')) return 'Editar medicamento';
  if (pathname.startsWith('/medicamentos')) return 'Medicamentos';
  if (pathname.startsWith('/configuracoes')) return 'Configurações';
  return 'Medica Certo';
}

export function PortalShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const [theme, toggleTheme] = useTheme();
  const title = titleForPath(location.pathname);
  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  async function handleLogout() {
    await auth.logout();
    navigate('/login', { replace: true });
  }

  return (
    <AlarmProvider>
      <div className="portal-shell">
        <aside className="portal-menu" aria-label="Menu principal">
          <div className="portal-menu__brand" aria-hidden="true">
            MC
          </div>
          <nav className="portal-menu__nav">
            {NAV_ITEMS.map(({ to, label, shortLabel, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                aria-label={label}
                className={({ isActive }) =>
                  `portal-menu__item${isActive ? ' is-active' : ''}`
                }
              >
                <Icon weight="regular" aria-hidden="true" />
                <span className="portal-menu__label portal-menu__label--full">
                  {label}
                </span>
                <span className="portal-menu__label portal-menu__label--short">
                  {shortLabel}
                </span>
              </NavLink>
            ))}
            <button
              type="button"
              className="portal-menu__item portal-menu__item--button portal-menu__item--desktop-only"
              onClick={toggleTheme}
              aria-label="Alternar tema claro/escuro"
            >
              <ThemeIcon weight="regular" aria-hidden="true" />
              <span>Tema</span>
            </button>
            <button
              type="button"
              className="portal-menu__item portal-menu__item--desktop-only"
              onClick={() => {
                void handleLogout();
              }}
            >
              <SignOut weight="regular" aria-hidden="true" />
              <span>Sair</span>
            </button>
          </nav>
        </aside>

        <header className="portal-header">
          <div className="portal-header__left">
            <h1 className="portal-header__title">{title}</h1>
            {auth.caregiver ? (
              <p className="portal-header__user">{auth.caregiver.name}</p>
            ) : null}
          </div>
          <div className="portal-header__right">
            <HeaderClock />
            <div className="portal-header__actions">
              <button
                type="button"
                className="portal-header__icon-btn"
                onClick={toggleTheme}
                aria-label="Alternar tema claro/escuro"
              >
                <ThemeIcon weight="regular" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="portal-header__icon-btn"
                onClick={() => {
                  void handleLogout();
                }}
                aria-label="Sair"
              >
                <SignOut weight="regular" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        <main className="portal-main">
          <Outlet />
        </main>
      </div>
    </AlarmProvider>
  );
}
