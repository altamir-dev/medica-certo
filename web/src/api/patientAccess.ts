import { apiFetch } from './client';

export type AccessGrantee = {
  caregiverId: string;
  email: string;
  name: string;
  since: string;
};

export type GranteeAccessDetail = {
  granteeId: string;
  patientIds: string[];
  patients: { id: string; name: string }[];
};

export function fetchAccessGrantees() {
  return apiFetch<{ grantees: AccessGrantee[] }>('/api/patient-access');
}

export function fetchGranteeAccess(granteeId: string) {
  return apiFetch<{ access: GranteeAccessDetail }>(
    `/api/patient-access/${granteeId}`,
  );
}

export function updateGranteeAccess(granteeId: string, patientIds: string[]) {
  return apiFetch<{ ok: true }>(`/api/patient-access/${granteeId}`, {
    method: 'PUT',
    body: JSON.stringify({ patientIds }),
  });
}

export function revokeGranteeAccess(granteeId: string) {
  return apiFetch<void>(`/api/patient-access/${granteeId}`, {
    method: 'DELETE',
  });
}
