import { apiFetch } from './client';
import type { Patient } from './patients';
import type { ScheduledDose } from './treatments';

export type SheetColumn = {
  treatmentId: string;
  medicationName: string;
  doseQuantity: string;
  route: string;
  schemeLabel: string;
  slots: string[];
};

export type SheetCell = {
  doseId: string;
  treatmentId: string;
  scheduledAt: string;
  status: string;
  administeredAt: string | null;
  day: string;
  slot: string;
  isNext: boolean;
  isOverdue: boolean;
};

export type PatientSheet = {
  patientId: string;
  from: string;
  to: string;
  columns: SheetColumn[];
  days: string[];
  cells: Record<string, SheetCell>;
  nextDoseId: string | null;
};

export async function getPatientSheet(
  patientId: string,
  opts?: { from?: string; to?: string },
): Promise<{ patient: Patient; sheet: PatientSheet }> {
  const params = new URLSearchParams();
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to) params.set('to', opts.to);
  const qs = params.toString();
  return apiFetch<{ patient: Patient; sheet: PatientSheet }>(
    `/api/patients/${patientId}/sheet${qs ? `?${qs}` : ''}`,
  );
}

export async function administerDose(
  doseId: string,
  input: {
    administeredAt?: string;
    note?: string;
    confirmEarly?: boolean;
  },
): Promise<ScheduledDose> {
  const data = await apiFetch<{ dose: ScheduledDose }>(
    `/api/doses/${doseId}/administer`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return data.dose;
}

export async function updateAdministration(
  doseId: string,
  input: { administeredAt: string; note?: string },
): Promise<ScheduledDose> {
  const data = await apiFetch<{ dose: ScheduledDose }>(
    `/api/doses/${doseId}/administration`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return data.dose;
}
