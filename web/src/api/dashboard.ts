import { apiFetch } from './client';

export type CalendarPatient = {
  patientId: string;
  name: string;
  color: string;
};

export type CalendarDay = {
  ymd: string;
  label: string;
  isToday: boolean;
  isYesterday: boolean;
};

export type CalendarDose = {
  doseId: string;
  treatmentId: string;
  medicationName: string;
  doseQuantity: string;
  route: string;
  scheduledAt: string;
  status: string;
  administeredAt: string | null;
  isNext: boolean;
  isOverdue: boolean;
};

export type CalendarPatientChip = {
  patientId: string;
  patientName: string;
  color: string;
  hasPending: boolean;
  isNext: boolean;
  isOverdue: boolean;
  doses: CalendarDose[];
};

export type CaregiverCalendar = {
  from: string;
  to: string;
  today: string;
  patients: CalendarPatient[];
  slots: string[];
  days: CalendarDay[];
  byDaySlot: Record<string, CalendarPatientChip[]>;
  nextDoseId: string | null;
};

export async function getDashboardCalendar(opts?: {
  from?: string;
  to?: string;
}): Promise<CaregiverCalendar> {
  const params = new URLSearchParams();
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to) params.set('to', opts.to);
  const qs = params.toString();
  const data = await apiFetch<{ calendar: CaregiverCalendar }>(
    `/api/dashboard/calendar${qs ? `?${qs}` : ''}`,
  );
  return data.calendar;
}
