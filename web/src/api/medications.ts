import { apiFetch } from './client';

export type Medication = {
  id: string;
  name: string;
  activeIngredient: string;
  indication: string;
  referencePosology: string;
  usualIntervalHours: number | null;
  hasPhoto: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MedicationInput = {
  name: string;
  activeIngredient?: string;
  indication?: string;
  referencePosology?: string;
  usualIntervalHours?: number | null;
};

export async function listMedications(q?: string): Promise<Medication[]> {
  const params = new URLSearchParams();
  if (q && q.trim()) params.set('q', q.trim());
  const qs = params.toString();
  const path = qs ? `/api/medications?${qs}` : '/api/medications';
  const data = await apiFetch<{ medications: Medication[] }>(path);
  return data.medications;
}

export async function getMedication(id: string): Promise<Medication> {
  const data = await apiFetch<{ medication: Medication }>(
    `/api/medications/${id}`,
  );
  return data.medication;
}

export async function createMedication(
  input: MedicationInput,
): Promise<Medication> {
  const data = await apiFetch<{ medication: Medication }>('/api/medications', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.medication;
}

export async function updateMedication(
  id: string,
  input: MedicationInput,
): Promise<Medication> {
  const data = await apiFetch<{ medication: Medication }>(
    `/api/medications/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  );
  return data.medication;
}

export async function deleteMedication(id: string): Promise<void> {
  await apiFetch<void>(`/api/medications/${id}`, { method: 'DELETE' });
}

export async function uploadMedicationPhoto(
  id: string,
  file: File,
): Promise<Medication> {
  const form = new FormData();
  form.append('photo', file);
  const data = await apiFetch<{ medication: Medication }>(
    `/api/medications/${id}/photo`,
    {
      method: 'POST',
      body: form,
    },
  );
  return data.medication;
}
