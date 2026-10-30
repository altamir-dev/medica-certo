import { useEffect, useState } from 'react';

type HealthResponse = {
  status: string;
  db: string;
  service: string;
  time: string;
};

type Props = {
  title: string;
  description: string;
  showHealth?: boolean;
};

export function PlaceholderPage({ title, description, showHealth = false }: Props) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    if (!showHealth) return;

    let cancelled = false;

    async function loadHealth() {
      try {
        const res = await fetch('/api/health');
        const data = (await res.json()) as HealthResponse;
        if (!cancelled) {
          setHealth(data);
          setHealthError(null);
        }
      } catch {
        if (!cancelled) {
          setHealth(null);
          setHealthError('API indisponível');
        }
      }
    }

    void loadHealth();
    return () => {
      cancelled = true;
    };
  }, [showHealth]);

  return (
    <section className="portal-card">
      <h2 className="portal-card__title">{title}</h2>
      <p className="portal-card__body">{description}</p>

      {showHealth ? (
        <div className="portal-status-row" aria-live="polite">
          {healthError ? (
            <span className="portal-tag portal-tag--error">{healthError}</span>
          ) : null}
          {health ? (
            <>
              <span
                className={`portal-tag ${
                  health.status === 'ok'
                    ? 'portal-tag--success'
                    : 'portal-tag--error'
                }`}
              >
                API {health.status}
              </span>
              <span
                className={`portal-tag ${
                  health.db === 'up'
                    ? 'portal-tag--success'
                    : 'portal-tag--error'
                }`}
              >
                DB {health.db}
              </span>
              <span className="portal-tag portal-tag--secondary">
                {health.service}
              </span>
              <span className="portal-tag portal-tag--primary">
                bootstrap
              </span>
            </>
          ) : null}
          {!health && !healthError ? (
            <span className="portal-tag portal-tag--secondary">
              verificando…
            </span>
          ) : null}
        </div>
      ) : (
        <div className="portal-status-row">
          <span className="portal-tag portal-tag--secondary">em breve</span>
        </div>
      )}
    </section>
  );
}
