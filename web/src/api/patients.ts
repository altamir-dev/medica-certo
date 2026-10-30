import { apiFetch } from './client';

export type Patient = {
  id: string;
  name: string;
  birthDate: string;
  sleepStart: string;
  sleepEnd: string;
  createdAt: string;
  updatedAt: string;
};

export type PatientInput = {
  name: string;
  birthDate: string;
  sleepStart?: string;
  sleepEnd?: string;
};

export async function listPatients(): Promise<Patient[]> {
  const data = await apiFetch<{ patients: Patient[] }>('/api/patients');
  return data.patients;
}

export async function getPatient(id: string): Promise<Patient> {
  const data = await apiFetch<{ patient: Patient }>(`/api/patients/${id}`);
  return data.patient;
}

export async function createPatient(input: PatientInput): Promise<Patient> {
  const data = await apiFetch<{ patient: Patient }>('/api/patients', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.patient;
}

export async function updatePatient(
  id: string,
  input: PatientInput,
): Promise<Patient> {
  const data = await apiFetch<{ patient: Patient }>(`/api/patients/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return data.patient;
}

export async function deletePatient(id: string): Promise<void> {
  await apiFetch<void>(`/api/patients/${id}`, { method: 'DELETE' });
}
