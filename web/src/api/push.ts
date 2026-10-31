import { apiFetch } from './client';
import type { Caregiver } from './auth';

export type PushSubscriptionRow = {
  id: string;
  label: string | null;
  ua: string | null;
  createdAt: string;
  lastOkAt: string | null;
  lastError: string | null;
  fails: number;
};

export function fetchVapidPublicKey() {
  return apiFetch<{ configured: boolean; publicKey: string | null }>(
    '/api/push/vapid-public-key',
  );
}

export function fetchPushSubscriptions() {
  return apiFetch<{
    configured: boolean;
    subscriptions: PushSubscriptionRow[];
  }>('/api/push/subscriptions');
}

export function subscribePush(subscription: PushSubscriptionJSON, label?: string) {
  return apiFetch<{ id: string; label: string }>('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription, label }),
  });
}

export function unsubscribePush(target: { endpoint?: string; id?: string }) {
  return apiFetch<{ removed: number }>('/api/push/subscribe', {
    method: 'DELETE',
    body: JSON.stringify(target),
  });
}

export function sendPushTest(id?: string) {
  return apiFetch<{
    sent: number;
    failed: number;
    results: Array<{ id: string; label: string | null; ok: boolean }>;
  }>('/api/push/test', {
    method: 'POST',
    body: JSON.stringify(id ? { id } : {}),
  });
}

export function updatePreferences(alarmsEnabled: boolean) {
  return apiFetch<{ caregiver: Caregiver }>('/api/me/preferences', {
    method: 'PATCH',
    body: JSON.stringify({ alarmsEnabled }),
  });
}
