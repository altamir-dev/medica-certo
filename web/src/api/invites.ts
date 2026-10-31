import { apiFetch } from './client';

export type InviteStatus = 'pending' | 'used' | 'expired' | 'revoked';

export type Invite = {
  id: string;
  email: string | null;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};

export function createInvite(input: { email?: string; expiresInDays?: number }) {
  return apiFetch<{ invite: Invite; token: string }>('/api/invites', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchInvites() {
  return apiFetch<{ invites: Invite[] }>('/api/invites');
}

export function revokeInvite(id: string) {
  return apiFetch<{ invite: Invite }>(`/api/invites/${id}/revoke`, {
    method: 'POST',
  });
}

export function lookupInvite(token: string) {
  return apiFetch<{ invite: { email: string | null; expiresAt: string } }>(
    `/api/auth/invites/${encodeURIComponent(token)}`,
  );
}

export function inviteUrl(token: string) {
  return `${window.location.origin}/convite/${encodeURIComponent(token)}`;
}
