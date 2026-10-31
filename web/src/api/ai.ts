import { apiFetch } from './client';

export type AiStatus = {
  enabled: boolean;
  providerName: string;
  model: string;
  consented: boolean;
  quota?: {
    limit: number;
    used: number;
    remaining: number;
    reached: boolean;
  };
};

export type DraftCandidate = {
  registro: string;
  produto: string;
  substancia: string;
  apresentacao: string;
  laboratorio: string;
  classeTerapeutica: string;
  score: number;
};

export type DraftItem = {
  name: string;
  nameConfidence: number;
  nameBand: string;
  nameSource: string;
  activeIngredient: string;
  concentration: string;
  concentrationSource: string;
  presentation: string;
  anvisaRegistry: string;
  classeTerapeutica: string;
  candidates: DraftCandidate[];
  schedule: {
    doseQuantity: string;
    routeText: string;
    route: string;
    mode: string;
    intervalHours: number | null;
    timesOfDay: string[];
    durationDays: number | null;
    continuousUse: boolean;
    endsOn: string | null;
    rawText: string;
    confidence: number;
    band: string;
    disagreement: string | null;
  };
};

export type MedicationDraft = {
  id: string;
  status: string;
  documentKind: string | null;
  errorCode: string | null;
  extracted: {
    documentKind: string;
    documentKindBand: string;
    unreadable: boolean;
    items: DraftItem[];
  } | null;
  patientId: string | null;
  expiresAt: string;
  createdAt: string;
  model: string | null;
};

export async function getAiStatus(): Promise<AiStatus> {
  return apiFetch<AiStatus>('/api/ai/status');
}

export async function acceptAiConsent(): Promise<void> {
  await apiFetch('/api/ai/consent', { method: 'POST', body: '{}' });
}

export async function createMedicationDraft(
  file: File,
  patientId?: string,
): Promise<MedicationDraft> {
  const form = new FormData();
  form.append('image', file);
  const path = patientId
    ? `/api/medication-drafts?patientId=${encodeURIComponent(patientId)}`
    : '/api/medication-drafts';
  const data = await apiFetch<{ draft: MedicationDraft }>(path, {
    method: 'POST',
    body: form,
  });
  return data.draft;
}

export async function getMedicationDraft(id: string): Promise<MedicationDraft> {
  const data = await apiFetch<{ draft: MedicationDraft }>(
    `/api/medication-drafts/${id}`,
  );
  return data.draft;
}

export async function discardMedicationDraft(id: string): Promise<void> {
  await apiFetch(`/api/medication-drafts/${id}`, { method: 'DELETE' });
}

export type ConfirmItem = {
  include: boolean;
  name: string;
  activeIngredient: string;
  concentration: string;
  presentation: string;
  anvisaRegistry: string;
  reuseExistingId?: string;
  createTreatment: boolean;
  doseQuantity: string;
  route: string;
  scheduleMode: string;
  intervalHours: number | null;
  timesOfDay: string[];
  startsAt: string;
  endsOn: string | null;
  posologyRaw: string;
};

export async function confirmMedicationDraft(
  id: string,
  items: ConfirmItem[],
): Promise<{ medicationIds: string[]; treatmentIds: string[] }> {
  return apiFetch(`/api/medication-drafts/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}
