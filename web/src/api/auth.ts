import { apiFetch } from './client';

export type Caregiver = {
  id: string;
  email: string;
  name: string;
  alarmsEnabled: boolean;
  isAdmin: boolean;
};

type CaregiverResponse = { caregiver: Caregiver };

export function fetchMe() {
  return apiFetch<CaregiverResponse>('/api/auth/me');
}

export function login(email: string, password: string) {
  return apiFetch<CaregiverResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function register(input: {
  email: string;
  password: string;
  name: string;
  inviteToken?: string;
}) {
  return apiFetch<CaregiverResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function logout() {
  return apiFetch<{ ok: boolean }>('/api/auth/logout', {
    method: 'POST',
  });
}
