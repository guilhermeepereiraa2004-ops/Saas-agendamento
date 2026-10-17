import type { Tenant } from '../types';

export const TENANT_FIELDS = 'id,name,slug,whatsapp,primary_color,secondary_color,has_logo,logo_url,services,profession,is_online,is_active,booking_type,working_hours,subscription_status,next_payment_at,payment_day,monthly_fee,appointment_interval,lunch_start,lunch_end';

export function mapTenant(t: Record<string, unknown>): Tenant {
  return {
    id: String(t.id), name: String(t.name), slug: String(t.slug), whatsapp: String(t.whatsapp || ''),
    primaryColor: t.primary_color as string, secondaryColor: (t.secondary_color as string) || '#ffffff',
    hasLogo: Boolean(t.has_logo), logoUrl: t.logo_url as string,
    services: typeof t.services === 'string' ? JSON.parse(t.services) : (t.services || []),
    profession: t.profession as Tenant['profession'], isOnline: t.is_online !== false, isActive: t.is_active !== false,
    bookingType: (t.booking_type as Tenant['bookingType']) || 'queue',
    workingHours: typeof t.working_hours === 'string' ? JSON.parse(t.working_hours) : (t.working_hours || []),
    subscriptionStatus: (t.subscription_status as Tenant['subscriptionStatus']) || 'trial',
    nextPaymentAt: t.next_payment_at ? String(t.next_payment_at).slice(0, 10) : undefined,
    paymentDay: Number(t.payment_day ?? 10), monthlyFee: Number(t.monthly_fee ?? 0),
    appointmentInterval: Number(t.appointment_interval ?? 30), lunchStart: (t.lunch_start as string) || '12:00', lunchEnd: (t.lunch_end as string) || '13:00',
  };
}
