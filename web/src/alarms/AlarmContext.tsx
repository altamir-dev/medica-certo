import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getDashboard, type DashboardDose } from '../api/dashboard';
import { administerDose, skipDose, snoozeDose } from '../api/doses';
import { registerServiceWorker } from '../lib/registerSw';
import {
  startAlarmSound,
  stopAlarmSound,
  unlockAlarmAudio,
} from '../lib/alarmSound';
import { ApiError } from '../api/client';
import './AlarmBanner.css';

type AlarmContextValue = {
  dueAlarms: DashboardDose[];
  silencedIds: Set<string>;
  refresh: () => Promise<void>;
  silence: (doseId: string) => void;
  silenceAll: () => void;
  administerNow: (doseId: string) => Promise<void>;
  skipNow: (doseId: string) => Promise<void>;
  snoozeNow: (doseId: string) => Promise<void>;
  unlockAudio: () => Promise<void>;
};

const AlarmContext = createContext<AlarmContextValue | null>(null);

export function useAlarms(): AlarmContextValue {
  const ctx = useContext(AlarmContext);
  if (!ctx) throw new Error('useAlarms outside AlarmProvider');
  return ctx;
}

export function AlarmProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [dueAlarms, setDueAlarms] = useState<DashboardDose[]>([]);
  const [silencedIds, setSilencedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const bumpRef = useRef(0);

  const refresh = useCallback(async () => {
    if (auth.status !== 'authenticated' || !auth.caregiver?.alarmsEnabled) {
      setDueAlarms([]);
      stopAlarmSound();
      return;
    }
    try {
      const dash = await getDashboard();
      setDueAlarms(dash.dueAlarms);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError('Não foi possível atualizar alarmes.');
    }
  }, [auth.status, auth.caregiver?.alarmsEnabled]);

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'mc-push') {
        bumpRef.current += 1;
        void unlockAlarmAudio();
        void refresh();
      }
      if (data.type === 'mc-navigate' && typeof data.url === 'string') {
        navigate(data.url);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMsg);
    };
  }, [navigate, refresh]);

  // Drop silence for doses that left the due set (e.g. after snooze) so they can ring again.
  useEffect(() => {
    setSilencedIds((prev) => {
      if (prev.size === 0) return prev;
      const due = new Set(dueAlarms.map((d) => d.doseId));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (due.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [dueAlarms]);

  const active = useMemo(
    () => dueAlarms.filter((d) => !silencedIds.has(d.doseId)),
    [dueAlarms, silencedIds],
  );

  useEffect(() => {
    if (active.length > 0) startAlarmSound();
    else stopAlarmSound();
    return () => {
      /* keep sound if still active on deps churn — stop handled above */
    };
  }, [active.length]);

  useEffect(() => {
    return () => stopAlarmSound();
  }, []);

  const silence = useCallback((doseId: string) => {
    setSilencedIds((prev) => new Set(prev).add(doseId));
  }, []);

  const silenceAll = useCallback(() => {
    setSilencedIds((prev) => {
      const next = new Set(prev);
      for (const d of dueAlarms) next.add(d.doseId);
      return next;
    });
    stopAlarmSound();
  }, [dueAlarms]);

  const administerNow = useCallback(
    async (doseId: string) => {
      setBusyId(doseId);
      try {
        await unlockAlarmAudio();
        await administerDose(doseId, { confirmEarly: true });
        silence(doseId);
        await refresh();
        await auth.refresh();
      } finally {
        setBusyId(null);
      }
    },
    [auth, refresh, silence],
  );

  const skipNow = useCallback(
    async (doseId: string) => {
      setBusyId(doseId);
      try {
        await skipDose(doseId);
        silence(doseId);
        await refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh, silence],
  );

  const snoozeNow = useCallback(
    async (doseId: string) => {
      setBusyId(doseId);
      try {
        await snoozeDose(doseId);
        silence(doseId);
        await refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh, silence],
  );

  const value = useMemo(
    () => ({
      dueAlarms,
      silencedIds,
      refresh,
      silence,
      silenceAll,
      administerNow,
      skipNow,
      snoozeNow,
      unlockAudio: unlockAlarmAudio,
    }),
    [
      dueAlarms,
      silencedIds,
      refresh,
      silence,
      silenceAll,
      administerNow,
      skipNow,
      snoozeNow,
    ],
  );

  return (
    <AlarmContext.Provider value={value}>
      {children}
      {active.length > 0 ? (
        <div className="alarm-banner" role="alertdialog" aria-live="assertive">
          <div className="alarm-banner__panel">
            <div className="alarm-banner__head">
              <strong>Hora do medicamento</strong>
              <button
                type="button"
                className="patients-btn patients-btn--secondary"
                onClick={() => {
                  void unlockAlarmAudio();
                  silenceAll();
                }}
              >
                Silenciar
              </button>
            </div>
            {error ? (
              <p className="patients-alert" role="alert">
                {error}
              </p>
            ) : null}
            <ul className="alarm-banner__list">
              {active.map((d) => (
                <li key={d.doseId} className="alarm-banner__item">
                  <div>
                    <div className="alarm-banner__title">
                      {d.patientName} · {d.medicationName}
                    </div>
                    <div className="alarm-banner__meta">
                      {d.doseQuantity} · {d.route} ·{' '}
                      {new Date(d.scheduledAt).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <div className="alarm-banner__actions">
                    <button
                      type="button"
                      className="patients-btn patients-btn--primary"
                      disabled={busyId === d.doseId}
                      onClick={() => {
                        void administerNow(d.doseId);
                      }}
                    >
                      Administrar
                    </button>
                    <button
                      type="button"
                      className="patients-btn patients-btn--secondary"
                      disabled={busyId === d.doseId || d.snoozeCount >= 1}
                      onClick={() => {
                        void snoozeNow(d.doseId);
                      }}
                    >
                      Soneca
                    </button>
                    <button
                      type="button"
                      className="patients-btn patients-btn--secondary"
                      disabled={busyId === d.doseId}
                      onClick={() => {
                        void skipNow(d.doseId);
                      }}
                    >
                      Pular
                    </button>
                    <button
                      type="button"
                      className="patients-btn patients-btn--secondary"
                      onClick={() => navigate(`/pacientes/${d.patientId}`)}
                    >
                      Abrir
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </AlarmContext.Provider>
  );
}
