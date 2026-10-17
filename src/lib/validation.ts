import type { Tenant } from '../types';

export function validBilling(fee: number, day: number) {
  return Number.isFinite(fee) && fee >= 0 && Number.isInteger(day) && day >= 1 && day <= 31;
}

export function validWorkingHours(hours: NonNullable<Tenant['workingHours']>) {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return new Set(hours.map(h => h.day)).size === hours.length && hours.every(h => Number.isInteger(h.day) && h.day >= 0 && h.day <= 6 && time.test(h.start) && time.test(h.end) && h.start < h.end);
}

export function formatCalendarDate(value: string) {
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('/') : '';
}
