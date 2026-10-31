import { apiFetch } from './client';

export type ScheduleMode = 'regular_interval' | 'custom_times';

export type Treatment = {
  id: string;
  caregiverId: string;
  patientId: string;
  medicationId: string;
  startsAt: string;
  endsOn: string | null;
  endedAt: string | null;
  status: 'active' | 'ended';
  doseQuantity: string;
  route: string;
  scheduleMode: ScheduleMode;
  intervalHours: number | null;
  timesOfDay: string[] | null;
  alarmsEnabled: boolean;
  generatedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  patientName?: string;
  medicationName?: string;
};

export type ScheduledDose = {
  id: string;
  treatmentId: string;
  caregiverId: string;
  scheduledAt: string;
  status: 'pending' | 'administered' | 'skipped' | 'cancelled';
  administeredAt: string | null;
  alarmAt: string | null;
};

export type TreatmentInput = {
  patientId: string;
  medicationId: string;
  startsAt: string;
  endsOn?: string | null;
  doseQuantity: string;
  route: string;
  scheduleMode: ScheduleMode;
  intervalHours?: number | null;
  timesOfDay?: string[] | null;
  alarmsEnabled?: boolean;
};

export type PreviewResult = {
  doses: { scheduledAt: string }[];
  rangeStart: string;
  rangeEnd: string;
  truncatedBackfill: boolean;
  doseCount: number;
};

export type SuggestResult = {
  firstDoseAt: string;
  sleepHitCount: number;
  warning: boolean;
  warningMessage: string | null;
  preview: { scheduledAt: string }[];
};

export async function listPatientTreatments(
  patientId: string,
): Promise<Treatment[]> {
  const data = await apiFetch<{ treatments: Treatment[] }>(
    `/api/patients/${patientId}/treatments`,
  );
  return data.treatments;
}

export async function getTreatment(id: string): Promise<Treatment> {
  const data = await apiFetch<{ treatment: Treatment }>(
    `/api/treatments/${id}`,
  );
  return data.treatment;
}

export async function createTreatment(
  input: TreatmentInput,
): Promise<{ treatment: Treatment; doseCount: number }> {
  const data = await apiFetch<{
    treatment: Treatment;
    doseCount: number;
  }>('/api/treatments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data;
}

export async function previewTreatment(
  input: Omit<TreatmentInput, 'patientId' | 'medicationId'> & {
    patientId?: string;
    medicationId?: string;
  },
): Promise<PreviewResult> {
  return apiFetch<PreviewResult>('/api/treatments/preview', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function suggestFirstDose(input: {
  intervalHours: number;
  patientId?: string;
  sleepStart?: string;
  sleepEnd?: string;
  anchorDate?: string;
}): Promise<SuggestResult> {
  return apiFetch<SuggestResult>('/api/treatments/suggest-first-dose', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function endTreatment(id: string): Promise<Treatment> {
  const data = await apiFetch<{ treatment: Treatment }>(
    `/api/treatments/${id}/end`,
    { method: 'POST', body: '{}' },
  );
  return data.treatment;
}

export async function listTreatmentDoses(
  id: string,
  opts?: { from?: string; to?: string; includeCancelled?: boolean },
): Promise<{ treatment: Treatment; doses: ScheduledDose[] }> {
  const params = new URLSearchParams();
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to) params.set('to', opts.to);
  if (opts?.includeCancelled) params.set('includeCancelled', '1');
  const qs = params.toString();
  return apiFetch<{ treatment: Treatment; doses: ScheduledDose[] }>(
    `/api/treatments/${id}/doses${qs ? `?${qs}` : ''}`,
  );
}

export const ROUTE_OPTIONS = [
  { value: 'VO', label: 'VO (oral)' },
  { value: 'SL', label: 'SL (sublingual)' },
  { value: 'IM', label: 'IM (intramuscular)' },
  { value: 'EV', label: 'EV (endovenoso)' },
  { value: 'SC', label: 'SC (subcutâneo)' },
  { value: 'tópica', label: 'Tópica' },
  { value: 'inalatória', label: 'Inalatória' },
  { value: 'retal', label: 'Retal' },
  { value: 'ocular', label: 'Ocular' },
  { value: 'nasal', label: 'Nasal' },
  { value: 'outra', label: 'Outra' },
] as const;
