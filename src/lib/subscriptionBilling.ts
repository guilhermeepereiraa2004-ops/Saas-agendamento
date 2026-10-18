import type { Tenant } from '../types';

export function billingDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function validCalendarDate(value?: string) {
  const day = value?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}

export function subscriptionBilling(tenant: Pick<Tenant, 'subscriptionStatus' | 'nextPaymentAt'>, today = billingDay()) {
  const dueDate = validCalendarDate(tenant.nextPaymentAt);
  const timing = !dueDate ? 'unknown' : dueDate < today ? 'past' : dueDate === today ? 'today' : 'future';
  const needsPayment = tenant.subscriptionStatus === 'pending' || tenant.subscriptionStatus === 'overdue';
  // A confirmed active plan (or a trial) is not made unpaid by its date.
  // For unpaid plans, only a calendar date before today proves an overdue bill.
  const status = needsPayment ? timing === 'past' ? 'overdue' : 'pending' : tenant.subscriptionStatus || 'trial';
  const label = status === 'active' ? 'Em dia' : status === 'trial' ? 'Teste' : status === 'overdue' ? 'Atrasado' : timing === 'today' ? 'Vence hoje' : timing === 'future' ? 'A vencer' : 'Pendente';
  const palette = status === 'active' ? { background: '#dcfce7', color: '#166534' }
    : status === 'overdue' ? { background: '#fee2e2', color: '#991b1b' }
    : { background: '#fef3c7', color: '#854d0e' };
  return { status, timing, dueDate, needsPayment, label, palette };
}
