export interface Service {
  id: string;
  name: string;
  price: number;
  duration?: number; // duration in minutes
}

export type Profession = 'barber' | 'manicure' | 'carwash' | 'hairstylist' | 'lash' | 'makeup' | 'esthetician';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  whatsapp: string;
  services: Service[];
  primaryColor?: string;
  hasLogo?: boolean;
  logoUrl?: string;
  loginEmail?: string;
  loginPassword?: string;
  profession?: Profession;
  isOnline?: boolean;
  bookingType?: 'queue' | 'appointment';
  workingHours?: { day: number; start: string; end: string }[];
  isActive?: boolean;
  // SaaS Subscription Fields
  subscriptionStatus?: 'active' | 'overdue' | 'pending' | 'trial';
  nextPaymentAt?: string;
  paymentDay?: number;
  monthlyFee?: number;
}

export interface QueueItem {
  id: string;
  name: string;
  whatsapp: string;
  serviceId: string;
  serviceName: string;
  price: number;
  status: 'serving' | 'ready' | 'waiting';
  joinedAt: string; // ISO string 
  appointmentTime?: string; // ISO string
  isOnWay?: boolean;
  startedAt?: string;
}

export interface TenantTask {
  id: string;
  tenantId: string;
  title: string;
  isCompleted: boolean;
  createdAt: string;
}

export interface TenantProduct {
  id: string;
  tenantId: string;
  name: string;
  price: number;
  imageUrl?: string;
  createdAt: string;
}
