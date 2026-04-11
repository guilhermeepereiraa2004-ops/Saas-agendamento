export interface Service {
  id: string;
  name: string;
  price: number;
}

export type Profession = 'barber' | 'manicure' | 'carwash' | 'hairstylist';

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
}
