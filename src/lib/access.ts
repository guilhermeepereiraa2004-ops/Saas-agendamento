import { supabase } from './supabase';

export type StaffAccess = { is_master: boolean; tenant_ids: string[] };

export async function getStaffAccess(): Promise<StaffAccess | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const { data, error: accessError } = await supabase.rpc('staff_access');
  if (accessError || !data) return null;
  return data as StaffAccess;
}

export async function canManageTenant(tenantId: string) {
  const access = await getStaffAccess();
  return Boolean(access && (access.is_master || access.tenant_ids.includes(tenantId)));
}

export async function authorizationHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}
