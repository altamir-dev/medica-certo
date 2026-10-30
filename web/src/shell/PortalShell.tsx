import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  House,
  Users,
  Pill,
  GearSix,
} from '@phosphor-icons/react';
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
  const title = TITLE_BY_PATH[location.pathname] ?? 'Medica Certo';

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
        </nav>
      </aside>

      <header className="portal-header">
        <h1 className="portal-header__title">{title}</h1>
        <p className="portal-header__meta">{formatNow()}</p>
      </header>

      <main className="portal-main">
        <Outlet />
      </main>
    </div>
  );
}
