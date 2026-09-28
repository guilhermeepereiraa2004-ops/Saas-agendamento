import type { Profession } from '../types';

interface ProfessionConfig {
  label: string;          // Display name for admin list
  professional: string;   // What to call the professional
  loginLabel: string;     // Label for the login section
  queueTitle: string;     // Queue section title
  joinTitle: string;      // Join queue form title
  defaultService: string; // Default service suggestion
}

export const PROFESSION_CONFIG: Record<Profession, ProfessionConfig> = {
  barber: {
    label: 'Barbearia',
    professional: 'Barbeiro',
    loginLabel: 'Acesso Restrito',
    queueTitle: 'Fila de Atendimento',
    joinTitle: 'Entrar na Fila',
    defaultService: 'Corte Clássico',
  },
  manicure: {
    label: 'Manicure / Pedicure',
    professional: 'Manicure',
    loginLabel: 'Acesso Restrito',
    queueTitle: 'Fila de Atendimento',
    joinTitle: 'Entrar na Fila',
    defaultService: 'Manicure Clássica',
  },
  carwash: {
    label: 'Lava-Jato',
    professional: 'Atendente',
    loginLabel: 'Acesso Restrito',
    queueTitle: 'Fila de Atendimento',
    joinTitle: 'Colocar Veículo na Fila',
    defaultService: 'Lavagem Simples',
  },
  hairstylist: {
    label: 'Salão de Cabelo',
    professional: 'Cabeleireiro(a)',
    loginLabel: 'Acesso Restrito',
    queueTitle: 'Fila de Atendimento',
    joinTitle: 'Entrar na Fila',
    defaultService: 'Corte Feminino',
  },
  lash: {
    label: 'Lash Design',
    professional: 'Lash Designer',
    loginLabel: 'Acesso Restrito',
    queueTitle: 'Fila de Atendimento',
    joinTitle: 'Entrar na Fila',
    defaultService: 'Extensão de Cílios',
  },
  makeup: {
    label: 'Maquiadora',
    professional: 'Maquiadora',
    loginLabel: 'Acesso Restrito',
    queueTitle: 'Fila de Atendimento',
    joinTitle: 'Entrar na Fila',
    defaultService: 'Maquiagem Social',
  },
  esthetician: {
    label: 'Esteticista',
    professional: 'Esteticista',
    loginLabel: 'Acesso Restrito',
    queueTitle: 'Fila de Atendimento',
    joinTitle: 'Entrar na Fila',
    defaultService: 'Limpeza de Pele',
  },
};

export function getProfessionConfig(profession?: Profession): ProfessionConfig {
  return PROFESSION_CONFIG[profession || 'barber'];
}
