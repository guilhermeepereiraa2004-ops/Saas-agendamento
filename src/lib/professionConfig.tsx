import type { Profession } from '../types';

interface ProfessionConfig {
  label: string;          // Display name for admin list
  professional: string;   // What to call the professional
  loginLabel: string;     // Label for the login section
  queueTitle: string;     // Queue section title
  joinTitle: string;      // Join queue form title
  icon: React.ReactNode;  // SVG icon (string form for flexibility)
  iconSvg: string;        // SVG string for admin display
  defaultService: string; // Default service suggestion
}

export const PROFESSION_CONFIG: Record<Profession, ProfessionConfig> = {
  barber: {
    label: 'Barbearia',
    professional: 'Barbeiro',
    loginLabel: 'Acesso Restrito',
    queueTitle: 'Fila de Atendimento',
    joinTitle: 'Entrar na Fila',
    icon: null,
    iconSvg: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>`,
    defaultService: 'Corte Clássico',
  },
  manicure: {
    label: 'Manicure / Pedicure',
    professional: 'Manicure',
    loginLabel: 'Acesso Restrito',
    queueTitle: 'Fila de Atendimento',
    joinTitle: 'Entrar na Fila',
    icon: null,
    iconSvg: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"></path><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"></path><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"></path><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path></svg>`,
    defaultService: 'Manicure Clássica',
  },
  carwash: {
    label: 'Lava-Jato',
    professional: 'Atendente',
    loginLabel: 'Acesso Restrito',
    queueTitle: 'Fila de Atendimento',
    joinTitle: 'Colocar Veículo na Fila',
    icon: null,
    iconSvg: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"></rect><line x1="16" y1="8" x2="20" y2="8"></line><line x1="23" y1="13" x2="23" y2="11" ></line><path d="m20 11 2.5 2.5L20 16"></path><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`,
    defaultService: 'Lavagem Simples',
  },
  hairstylist: {
    label: 'Salão de Cabelo',
    professional: 'Cabeleireiro(a)',
    loginLabel: 'Acesso Restrito',
    queueTitle: 'Fila de Atendimento',
    joinTitle: 'Entrar na Fila',
    icon: null,
    iconSvg: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"></path><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1 1 2.67 1.39 4 1.02 1.66-.51 3.42-1.64 4-3.04 0-1.67-1.35-3.02-3-3.02z"></path></svg>`,
    defaultService: 'Corte Feminino',
  },
};

export function getProfessionConfig(profession?: Profession): ProfessionConfig {
  return PROFESSION_CONFIG[profession || 'barber'];
}
