import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return (
      <div className="portal-shell" style={{ placeItems: 'center' }}>
        <p className="portal-card__body">Carregando sessão…</p>
      </div>
    );
  }

  if (auth.status !== 'authenticated') {
    const next = `${location.pathname}${location.search}`;
    const search = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : '';
    return <Navigate to={`/login${search}`} replace />;
  }

  return <Outlet />;
}
