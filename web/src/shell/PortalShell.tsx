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
import './PortalShell.css';

const NAV_ITEMS: Array<{
  to: string;
  label: string;
  icon: typeof House;
  end?: boolean;
}> = [
  { to: '/', label: 'Dashboard', icon: House, end: true },
  { to: '/pacientes', label: 'Pacientes', icon: Users },
  { to: '/medicamentos', label: 'Medicamentos', icon: Pill },
  { to: '/configuracoes', label: 'Configurações', icon: GearSix },
];

const TITLE_BY_PATH: Record<string, string> = {
  '/': 'Dashboard',
  '/pacientes': 'Pacientes',
  '/medicamentos': 'Medicamentos',
  '/configuracoes': 'Configurações',
};

function formatNow() {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

export function PortalShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const [theme, toggleTheme] = useTheme();
  const title = TITLE_BY_PATH[location.pathname] ?? 'Medica Certo';
  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  async function handleLogout() {
    await auth.logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="portal-shell">
      <aside className="portal-menu" aria-label="Menu principal">
        <div className="portal-menu__brand" aria-hidden="true">
          MC
        </div>
        <nav className="portal-menu__nav">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `portal-menu__item${isActive ? ' is-active' : ''}`
              }
            >
              <Icon weight="regular" aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className="portal-menu__item portal-menu__item--button"
            onClick={toggleTheme}
            aria-label="Alternar tema claro/escuro"
          >
            <ThemeIcon weight="regular" aria-hidden="true" />
            <span>Tema</span>
          </button>
          <button
            type="button"
            className="portal-menu__item"
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
        <div>
          <h1 className="portal-header__title">{title}</h1>
          {auth.caregiver ? (
            <p className="portal-header__user">{auth.caregiver.name}</p>
          ) : null}
        </div>
        <p className="portal-header__meta">{formatNow()}</p>
      </header>

      <main className="portal-main">
        <Outlet />
      </main>
    </div>
  );
}
