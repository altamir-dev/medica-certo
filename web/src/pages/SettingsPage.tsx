import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  fetchPushSubscriptions,
  fetchVapidPublicKey,
  sendPushTest,
  subscribePush,
  unsubscribePush,
  updatePreferences,
  type PushSubscriptionRow,
} from '../api/push';
import {
  isIosDevice,
  isStandaloneDisplay,
  registerServiceWorker,
  urlBase64ToUint8Array,
} from '../lib/registerSw';
import { unlockAlarmAudio } from '../lib/alarmSound';
import { useAlarms } from '../alarms/AlarmContext';
import { InvitesCard } from './InvitesCard';
import './PatientsPage.css';
import './SettingsPage.css';

export function SettingsPage() {
  const auth = useAuth();
  const alarms = useAlarms();
  const [configured, setConfigured] = useState(false);
  const [subs, setSubs] = useState<PushSubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alarmsEnabled, setAlarmsEnabled] = useState(
    auth.caregiver?.alarmsEnabled ?? true,
  );

  const ios = isIosDevice();
  const standalone = isStandaloneDisplay();
  const canActivate = !ios || standalone;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [vapid, list] = await Promise.all([
        fetchVapidPublicKey(),
        fetchPushSubscriptions(),
      ]);
      setConfigured(vapid.configured);
      setSubs(list.subscriptions);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Falha ao carregar configurações.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setAlarmsEnabled(auth.caregiver?.alarmsEnabled ?? true);
  }, [auth.caregiver?.alarmsEnabled]);

  async function toggleAlarms(next: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const { caregiver } = await updatePreferences(next);
      setAlarmsEnabled(caregiver.alarmsEnabled);
      await auth.refresh();
      await alarms.refresh();
      setMessage(
        caregiver.alarmsEnabled
          ? 'Alarmes globais ligados.'
          : 'Alarmes globais desligados.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function activateDevice() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await unlockAlarmAudio();
      if (!canActivate) {
        setError(
          'No iPhone, abra o Medica Certo pelo ícone da Tela de Início (Safari → Compartilhar → Adicionar à Tela de Início).',
        );
        return;
      }
      if (!configured) {
        setError('Notificações indisponíveis neste servidor (VAPID).');
        return;
      }
      if (!('Notification' in window) || !('PushManager' in window)) {
        setError('Este navegador não suporta notificações push.');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError('Permissão de notificação negada. Habilite nas configurações do navegador.');
        return;
      }
      const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
      const vapid = await fetchVapidPublicKey();
      if (!vapid.publicKey) {
        setError('Chave VAPID pública indisponível.');
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
      });
      await subscribePush(sub.toJSON());
      await reload();
      setMessage('Aparelho ativado para alarmes.');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível ativar neste aparelho.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function deactivateDevice() {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker?.ready;
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      await reload();
      setMessage('Aparelho desativado.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao desativar.');
    } finally {
      setBusy(false);
    }
  }

  async function testPush() {
    setBusy(true);
    setMessage(null);
    try {
      await unlockAlarmAudio();
      const result = await sendPushTest();
      setMessage(
        result.sent > 0
          ? `Teste enviado (${result.sent} aparelho${result.sent > 1 ? 's' : ''}).`
          : 'Nenhum aparelho recebeu o teste.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha no teste.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="patients-page settings-page">
      <div className="patients-toolbar">
        <div>
          <h2 className="portal-card__title" style={{ marginBottom: 0 }}>
            Configurações
          </h2>
          <p className="patients-toolbar__hint">
            Compartilhar pacientes, alarmes e notificações neste aparelho
          </p>
        </div>
      </div>

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

      <InvitesCard />

      <div className="portal-card settings-card">
        <h3 className="settings-card__title">Alarmes</h3>
        <label className="settings-switch">
          <input
            type="checkbox"
            checked={alarmsEnabled}
            disabled={busy}
            onChange={(e) => {
              void toggleAlarms(e.target.checked);
            }}
          />
          <span>Receber alarmes de doses</span>
        </label>
        <p className="settings-hint">
          Também dá para desligar alarmes em cada tratamento. Não há horário
          silencioso para medicamentos.
        </p>
      </div>

      <div className="portal-card settings-card">
        <h3 className="settings-card__title">Notificações neste aparelho</h3>
        {loading ? (
          <p className="settings-hint">Carregando…</p>
        ) : (
          <>
            <p className="settings-hint">
              Status do servidor:{' '}
              <strong>
                {configured ? 'push disponível' : 'push indisponível (sem VAPID)'}
              </strong>
            </p>
            {ios && !standalone ? (
              <ol className="settings-ios">
                <li>Abra o site no Safari.</li>
                <li>Compartilhar → Adicionar à Tela de Início.</li>
                <li>Abra pelo ícone e toque em Ativar neste aparelho.</li>
              </ol>
            ) : null}
            <div className="settings-actions">
              <button
                type="button"
                className="patients-btn patients-btn--primary"
                disabled={busy || !configured || !canActivate}
                onClick={() => {
                  void activateDevice();
                }}
              >
                Ativar neste aparelho
              </button>
              <button
                type="button"
                className="patients-btn patients-btn--secondary"
                disabled={busy || subs.length === 0}
                onClick={() => {
                  void testPush();
                }}
              >
                Enviar teste
              </button>
              <button
                type="button"
                className="patients-btn patients-btn--secondary"
                disabled={busy}
                onClick={() => {
                  void deactivateDevice();
                }}
              >
                Desativar neste aparelho
              </button>
            </div>
            <h4 className="settings-sub">Aparelhos inscritos</h4>
            {subs.length === 0 ? (
              <p className="settings-hint">Nenhum aparelho ainda.</p>
            ) : (
              <ul className="settings-subs">
                {subs.map((s) => (
                  <li key={s.id}>
                    <strong>{s.label || s.id}</strong>
                    {s.lastError ? (
                      <span className="settings-sub-error"> · {s.lastError}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
