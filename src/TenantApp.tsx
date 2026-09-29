import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import type { QueueItem, Tenant, TenantTask, TenantProduct, Service } from './types';
import { supabase } from './lib/supabase';
import FinancialView from './FinancialView';
import { getProfessionConfig } from './lib/professionConfig';
import { useToasts } from './lib/toast';
import { requestNotificationPermission, getOneSignalId, sendPushNotification, isNotificationEnabled, loginOneSignal, logoutOneSignal } from './lib/oneSignal';
import { playNotificationSound } from './lib/notificationSound';
import { BrandMark } from './LandingPage';
import { ProfessionIcon } from './components/ProfessionIcon';

type RgbColor = [number, number, number];
type AdminTab = 'atendimento' | 'agenda' | 'financial' | 'tasks' | 'store' | 'services' | 'scheduling' | 'settings';
type WorkingHours = NonNullable<Tenant['workingHours']>;

interface QueueRow {
  id: string;
  name: string;
  whatsapp: string;
  service_id: string;
  service_name: string;
  price: string | number;
  status: QueueItem['status'];
  joined_at: string;
  appointment_time?: string;
  is_on_way?: boolean;
  push_id?: string;
  started_at?: string;
  duration?: number;
}

interface TaskRow {
  id: string;
  tenant_id: string;
  title: string;
  is_completed: boolean;
  created_at: string;
}

interface ProductRow {
  id: string;
  tenant_id: string;
  name: string;
  price: string | number;
  image_url?: string;
  created_at: string;
}

const ADMIN_TAB_META: Record<AdminTab, { eyebrow: string; title: string; description: string }> = {
  atendimento: {
    eyebrow: 'Operação em tempo real',
    title: 'Atendimento de hoje',
    description: 'Acompanhe o movimento e conduza cada cliente até a conclusão.',
  },
  agenda: {
    eyebrow: 'Planejamento',
    title: 'Agenda de compromissos',
    description: 'Confirme solicitações e organize os horários reservados.',
  },
  financial: {
    eyebrow: 'Visão do negócio',
    title: 'Financeiro',
    description: 'Receitas, despesas e resultado do estabelecimento em um só lugar.',
  },
  tasks: {
    eyebrow: 'Organização',
    title: 'Tarefas',
    description: 'Registre pendências e mantenha a rotina da equipe em dia.',
  },
  store: {
    eyebrow: 'Catálogo',
    title: 'Produtos',
    description: 'Apresente aos clientes os produtos usados e recomendados por você.',
  },
  services: {
    eyebrow: 'Catálogo',
    title: 'Serviços',
    description: 'Gerencie nomes, duração e valores dos seus atendimentos.',
  },
  scheduling: {
    eyebrow: 'Preferências de operação',
    title: 'Atendimento e horários',
    description: 'Defina o modelo de atendimento e, quando necessário, o expediente.',
  },
  settings: {
    eyebrow: 'Identidade do estabelecimento',
    title: 'Perfil e aparência',
    description: 'Personalize contato e cores que seus clientes verão.',
  },
};

function parseHexColor(value: string): RgbColor | null {
  const normalized = value.trim().replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map(char => char + char).join('')
    : normalized;

  if (!/^[\da-f]{6}$/i.test(expanded)) return null;

  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ];
}

function relativeLuminance([red, green, blue]: RgbColor) {
  const channels = [red, green, blue].map(channel => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(first: RgbColor, second: RgbColor) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function getReadableAccentText(background: string, preferred: string) {
  const backgroundRgb = parseHexColor(background) || [16, 18, 24] as RgbColor;
  const preferredRgb = parseHexColor(preferred);

  if (preferredRgb && contrastRatio(backgroundRgb, preferredRgb) >= 4.5) return preferred;

  const white: RgbColor = [255, 255, 255];
  const ink: RgbColor = [17, 19, 24];
  return contrastRatio(backgroundRgb, white) >= contrastRatio(backgroundRgb, ink) ? '#ffffff' : '#111318';
}

function hexToRgbString(value: string) {
  return (parseHexColor(value) || [212, 175, 55]).join(', ');
}

function parseMoneyInput(value: string) {
  const normalized = value.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function toLocalDateInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().split('T')[0];
}

function queueItemDate(item: QueueItem) {
  if (item.appointmentTime) return item.appointmentTime.split('T')[0];
  return toLocalDateInputValue(new Date(item.joinedAt));
}

function TimeElapsed({ startedAt }: { startedAt: string }) {
  const [mins, setMins] = useState(0);

  useEffect(() => {
    const calc = () => {
      const diffMs = Date.now() - new Date(startedAt).getTime();
      setMins(Math.max(0, Math.floor(diffMs / 60000)));
    };
    calc();
    const interval = setInterval(calc, 60000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--success)', marginTop: '4px', fontWeight: 600 }}>Atendimento iniciado há {mins} min</span>;
}

function AdminNavIcon({ tab }: { tab: AdminTab }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

  if (tab === 'atendimento') return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6m-3-3h6"/></svg>;
  if (tab === 'agenda') return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>;
  if (tab === 'financial') return <svg {...common}><path d="M4 19V9m5 10V5m5 14v-7m5 7V3"/></svg>;
  if (tab === 'services') return <svg {...common}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>;
  if (tab === 'store') return <svg {...common}><path d="M6 2 3 6v15h18V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>;
  if (tab === 'tasks') return <svg {...common}><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
  if (tab === 'scheduling') return <svg {...common}><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6M9 8h6m2 8h6"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>;
}

export default function TenantApp({ tenant: initialTenant }: { tenant: Tenant }) {
  const [tenant, setTenant] = useState<Tenant>(initialTenant);
  const { showToast } = useToasts();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const prevQueueRef = useRef<QueueItem[]>([]);

  // INITIAL LOAD + REALTIME
  const mapQueueItem = useCallback((q: QueueRow): QueueItem => {
    return {
      id: q.id,
      name: q.name,
      whatsapp: q.whatsapp,
      serviceId: q.service_id,
      serviceName: q.service_name,
      price: Number(q.price),
      status: q.status,
      joinedAt: q.joined_at,
      appointmentTime: q.appointment_time,
      isOnWay: q.is_on_way,
      pushId: q.push_id,
      startedAt: q.started_at,
      duration: q.duration || 30
    };
  }, []);

  const fetchData = useCallback(async () => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [queueResponse, tenantResponse, completedResponse, settingsResponse] = await Promise.all([
      supabase
        .from('queue_items')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('joined_at', { ascending: true }),
      supabase
        .from('tenants')
        .select('*')
        .eq('id', tenant.id)
        .single(),
      supabase
        .from('financial_records')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .gte('completed_at', dayStart.toISOString())
        .lt('completed_at', dayEnd.toISOString()),
      supabase.from('platform_settings').select('pix_key, pix_name').limit(1).single(),
    ]);

    const queueData = queueResponse.data;

    if (queueData) setQueue(queueData.map(mapQueueItem));

    const tenantData = tenantResponse.data;

    if (tenantData) {
      setTenant(prev => ({
        ...prev,
        profession: tenantData.profession,
        name: tenantData.name,
        primaryColor: tenantData.primary_color,
        secondaryColor: tenantData.secondary_color,
        whatsapp: tenantData.whatsapp,
        hasLogo: tenantData.has_logo,
        logoUrl: tenantData.logo_url,
        isOnline: tenantData.is_online ?? true,
        subscriptionStatus: tenantData.subscription_status,
        nextPaymentAt: tenantData.next_payment_at ? tenantData.next_payment_at.split('T')[0] : undefined,
        bookingType: tenantData.booking_type || 'queue',
        workingHours: typeof tenantData.working_hours === 'string' ? JSON.parse(tenantData.working_hours) : (tenantData.working_hours || []),
        appointmentInterval: tenantData.appointment_interval || 30,
        lunchStart: tenantData.lunch_start || '12:00',
        lunchEnd: tenantData.lunch_end || '13:00',
      }));
    }

    setCompletedCount(completedResponse.count || 0);

    const settingsData = settingsResponse.data;
    if (settingsData) {
      if (settingsData.pix_key) setAdminPixKey(settingsData.pix_key);
      if (settingsData.pix_name) setAdminPixName(settingsData.pix_name);
    }
  }, [tenant.id, mapQueueItem]);

  // INITIAL LOAD + REALTIME
  useEffect(() => {
    fetchData();

    // Canal separado para queue_items
    const queueChannel = supabase
      .channel(`queue_${tenant.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'queue_items', filter: `tenant_id=eq.${tenant.id}` },
        (payload) => {
          const newItem = mapQueueItem(payload.new as QueueRow);
          setQueue(prev => prev.some(i => i.id === payload.new.id) ? prev : [...prev, newItem]);

          if (document.querySelector('.professional-admin')) {
            const isAppointment = Boolean(newItem.appointmentTime);
            playNotificationSound();
            window.dispatchEvent(new CustomEvent('suavez:notification', {
              detail: {
                title: isAppointment ? 'Novo agendamento' : 'Novo cliente na fila',
                message: `${newItem.name} solicitou ${newItem.serviceName}.`,
                url: window.location.href,
              },
            }));
          }
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'queue_items', filter: `tenant_id=eq.${tenant.id}` },
        (payload) => {
          setQueue(prev => prev.map(item =>
            item.id === payload.new.id ? mapQueueItem(payload.new as QueueRow) : item
          ));
        }
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'queue_items' },
        (payload) => {
          setQueue(prev => prev.filter(item => item.id !== payload.old.id));
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') fetchData();
      });

    // Canal separado para tenants (online/offline)
    const tenantChannel = supabase
      .channel(`tenant_${tenant.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tenants', filter: `id=eq.${tenant.id}` },
        (payload) => {
          setTenant(prev => ({
            ...prev,
            isOnline: payload.new.is_online ?? prev.isOnline,
            name: payload.new.name ?? prev.name,
            whatsapp: payload.new.whatsapp ?? prev.whatsapp,
            primaryColor: payload.new.primary_color ?? prev.primaryColor,
            secondaryColor: payload.new.secondary_color ?? prev.secondaryColor,
            logoUrl: payload.new.logo_url ?? prev.logoUrl,
            hasLogo: payload.new.has_logo ?? prev.hasLogo,
            services: payload.new.services ?? prev.services,
            nextPaymentAt: payload.new.next_payment_at ? payload.new.next_payment_at.split('T')[0] : prev.nextPaymentAt,
            bookingType: payload.new.booking_type ?? prev.bookingType,
            workingHours: payload.new.working_hours ?? prev.workingHours,
            appointmentInterval: payload.new.appointment_interval ?? prev.appointmentInterval,
            lunchStart: payload.new.lunch_start ?? prev.lunchStart,
            lunchEnd: payload.new.lunch_end ?? prev.lunchEnd,
          }));
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') fetchData();
      });

    // Polling de segurança a cada 5s (garante sincronia mesmo se WebSocket falhar)
    const pollInterval = setInterval(fetchData, 5000);

    return () => {
      supabase.removeChannel(queueChannel);
      supabase.removeChannel(tenantChannel);
      clearInterval(pollInterval);
    };
  }, [tenant.id, fetchData, mapQueueItem]);


  // Handle service extraction since we now deal with objects
  const [name, setName] = useState('');
  const [adminPixKey, setAdminPixKey] = useState('');
  const [adminPixName, setAdminPixName] = useState('');
  const [customerWhatsapp, setCustomerWhatsapp] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [completedCount, setCompletedCount] = useState(0);
  const [activeQueueActionId, setActiveQueueActionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Appointment specific state
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateInputValue(new Date()));
  const [selectedTimeSlot, setSelectedTimeSlot] = useState('');
  const [adminSelectedDate, setAdminSelectedDate] = useState(() => toLocalDateInputValue(new Date()));

  // O serviço não é mais selecionado automaticamente para evitar mal entendidos

  // Auth state specifics to this tenant
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('atendimento');
  const [tasks, setTasks] = useState<TenantTask[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [products, setProducts] = useState<TenantProduct[]>([]);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductImage, setNewProductImage] = useState('');
  const [newProductImageFile, setNewProductImageFile] = useState<File | null>(null);
  const [newProductImagePreview, setNewProductImagePreview] = useState<string>('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCompactAdmin, setIsCompactAdmin] = useState(() => window.matchMedia('(max-width: 1020px)').matches);
  const [isAdminAddModalOpen, setIsAdminAddModalOpen] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [isServiceListOpen, setIsServiceListOpen] = useState(false);
  const [showJoinConfirmation, setShowJoinConfirmation] = useState(false);
  const [itemForCancel, setItemForCancel] = useState<QueueItem | null>(null);
  const [showAdminDeleteModal, setShowAdminDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<QueueItem | null>(null);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showMobileJoinModal, setShowMobileJoinModal] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState('30');
  const [profileSaveState, setProfileSaveState] = useState<'saved' | 'saving' | 'error'>('saved');

  const [notifsEnabled, setNotifsEnabled] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1020px)');
    const handleChange = (event: MediaQueryListEvent) => {
      setIsCompactAdmin(event.matches);
      if (!event.matches) setIsMobileMenuOpen(false);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!showMobileJoinModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMobileJoinModal(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [showMobileJoinModal]);

  useEffect(() => {
    if (!isAdminAddModalOpen && !showServiceModal && !showAdminDeleteModal) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showAdminDeleteModal) {
        setShowAdminDeleteModal(false);
        setItemToDelete(null);
      } else if (showServiceModal) {
        setShowServiceModal(false);
      } else {
        setIsAdminAddModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isAdminAddModalOpen, showServiceModal, showAdminDeleteModal]);

  useEffect(() => {
    const checkNotifs = async () => {
      const enabled = await isNotificationEnabled();
      setNotifsEnabled(enabled);
    };
    checkNotifs();
    const handlePushState = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      setNotifsEnabled(Boolean(detail?.enabled));
    };
    window.addEventListener('suavez:push-state', handlePushState);
    return () => window.removeEventListener('suavez:push-state', handlePushState);
  }, []);

  const enableNotifications = async () => {
    if (isAuthenticated) await loginOneSignal(`admin_${tenant.id}`);
    const pushId = await requestNotificationPermission();
    if (!pushId) {
      showToast('Não foi possível ativar. Verifique a permissão do navegador e, no iPhone, abra o app pela Tela de Início.', 'warning');
      return null;
    }

    if (isAuthenticated) {
      const { error } = await supabase.from('tenants').update({ admin_push_id: pushId }).eq('id', tenant.id);
      if (error) {
        showToast('As notificações foram ativadas neste dispositivo, mas não foi possível sincronizar o cadastro.', 'warning');
        return pushId;
      }
    }

    setNotifsEnabled(true);
    showToast('Notificações e aviso sonoro ativados neste dispositivo.', 'success');
    return pushId;
  };

  // Load stats from localStorage on mount (for persistent auth)
  useEffect(() => {
    // Check auth session
    const auth = localStorage.getItem(`suavez_auth_${tenant.slug}`);
    if (auth === 'true') {
      setIsAuthenticated(true);
    }
  }, [tenant.slug]);

  const fetchTasks = useCallback(async () => {
    const { data } = await supabase
      .from('tenant_tasks')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false });
    if (data) {
      setTasks((data as TaskRow[]).map(t => ({
        id: t.id,
        tenantId: t.tenant_id,
        title: t.title,
        isCompleted: t.is_completed,
        createdAt: t.created_at
      })));
    }
  }, [tenant.id]);

  const fetchProducts = useCallback(async () => {
    const { data } = await supabase
      .from('tenant_products')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false });
    if (data) {
      setProducts((data as ProductRow[]).map(p => ({
        id: p.id,
        tenantId: p.tenant_id,
        name: p.name,
        price: Number(p.price),
        imageUrl: p.image_url,
        createdAt: p.created_at
      })));
    }
  }, [tenant.id]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTasks();
      fetchProducts();

      void loginOneSignal(`admin_${tenant.id}`);

      const syncAdminSubscription = async (providedId?: string | null) => {
        const pushId = providedId === undefined ? await getOneSignalId() : providedId;
        if (!pushId) return;
        const { error } = await supabase.from('tenants').update({ admin_push_id: pushId }).eq('id', tenant.id);
        if (error) console.error('Não foi possível registrar este dispositivo para notificações.', error);
      };

      void syncAdminSubscription();
      const handlePushState = (event: Event) => {
        const detail = (event as CustomEvent<{ enabled?: boolean; id?: string | null }>).detail;
        if (detail?.enabled && detail.id) void syncAdminSubscription(detail.id);
      };
      window.addEventListener('suavez:push-state', handlePushState);
      return () => window.removeEventListener('suavez:push-state', handlePushState);
    }
  }, [isAuthenticated, tenant.id, fetchProducts, fetchTasks]);

  // Always load products for client-side store button
  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const updateBookingType = async (type: 'queue' | 'appointment') => {
    setLoading(true);
    const { error } = await supabase
      .from('tenants')
      .update({ booking_type: type })
      .eq('id', tenant.id);
    
    if (error) {
      showToast('Erro ao atualizar modelo: ' + error.message, 'error');
    } else {
      setTenant(prev => ({ ...prev, bookingType: type }));
      if (type === 'queue') {
        const now = toLocalDateInputValue(new Date());
        setSelectedDate(now);
        setAdminSelectedDate(now);
        setActiveTab('atendimento');
      }
      showToast('Modelo de atendimento atualizado!', 'success');
    }
    setLoading(false);
  };

  const updateSchedulingSettings = async (field: string, value: string | number) => {
    setLoading(true);
    const { error } = await supabase
      .from('tenants')
      .update({ [field]: value })
      .eq('id', tenant.id);
    
    if (error) {
      showToast('Erro ao atualizar configuração: ' + error.message, 'error');
    } else {
      setTenant(prev => ({ ...prev, [field === 'appointment_interval' ? 'appointmentInterval' : field === 'lunch_start' ? 'lunchStart' : 'lunchEnd']: value }));
      showToast('Configuração atualizada!', 'success');
    }
    setLoading(false);
  };

  const updateWorkingHours = async (newHours: WorkingHours) => {
    setLoading(true);
    const { error } = await supabase
      .from('tenants')
      .update({ working_hours: newHours })
      .eq('id', tenant.id);
    
    if (error) {
      showToast('Erro ao atualizar horários: ' + error.message, 'error');
    } else {
      setTenant(prev => ({ ...prev, workingHours: newHours }));
      showToast('Horários atualizados!', 'success');
    }
    setLoading(false);
  };

  const generateTimeSlots = () => {
    if (!tenant.workingHours || !selectedDate) return [];

    const date = new Date(selectedDate + 'T00:00:00');
    const dayOfWeek = date.getDay(); // 0 (Sun) to 6 (Sat)
    const dayConfig = tenant.workingHours.find(h => h.day === dayOfWeek);

    if (!dayConfig) return [];

    const slots: string[] = [];
    const [startH, startM] = dayConfig.start.split(':').map(Number);
    const [endH, endM] = dayConfig.end.split(':').map(Number);
    const interval = tenant.appointmentInterval || 30;

    const current = new Date(date);
    current.setHours(startH, startM, 0, 0);

    const end = new Date(date);
    end.setHours(endH, endM, 0, 0);

    const now = new Date();

    const lStart = tenant.lunchStart ? tenant.lunchStart.split(':').map(Number) : null;
    const lEnd = tenant.lunchEnd ? tenant.lunchEnd.split(':').map(Number) : null;
    
    const lunchStartTime = lStart ? new Date(date).setHours(lStart[0], lStart[1], 0, 0) : null;
    const lunchEndTime = lEnd ? new Date(date).setHours(lEnd[0], lEnd[1], 0, 0) : null;

    const selectedSvc = tenant.services.find(s => s.id === selectedServiceId);
    const selectedDuration = selectedSvc?.duration || 30;

    while (current < end) {
      const timeStr = current.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
      
      const slotStartMs = current.getTime();
      const slotEndMs = slotStartMs + selectedDuration * 60000;
      
      const isPast = date.toDateString() === now.toDateString() && current < now;

      // Check if the entire service duration overlaps with lunch
      const overlapsLunch = lunchStartTime && lunchEndTime && (
        (slotStartMs >= lunchStartTime && slotStartMs < lunchEndTime) || // Starts during lunch
        (slotEndMs > lunchStartTime && slotEndMs <= lunchEndTime) ||   // Ends during lunch
        (slotStartMs <= lunchStartTime && slotEndMs >= lunchEndTime)    // Spans across lunch
      );

      // Check if service fits before the end of the day
      const fitsInDay = slotEndMs <= end.getTime();

      // Check if the entire service duration overlaps with any existing appointment
      const overlapsAppointment = queue.some(item => {
        if (!item.appointmentTime || item.status === 'cancelled') return false;
        const itemStart = new Date(item.appointmentTime);
        const itemDuration = Number(item.duration) || 30;
        const itemEnd = new Date(itemStart.getTime() + itemDuration * 60000);
        
        const isSameDay = itemStart.getFullYear() === date.getFullYear() &&
                          itemStart.getMonth() === date.getMonth() &&
                          itemStart.getDate() === date.getDate();
        
        if (!isSameDay) return false;

        const itemStartMs = itemStart.getTime();
        const itemEndMs = itemEnd.getTime();

        const overlaps = slotStartMs < itemEndMs && slotEndMs > itemStartMs;

        return overlaps;
      });

      if (!overlapsLunch && !isPast && !overlapsAppointment && fitsInDay) {
        slots.push(timeStr);
      }

      current.setMinutes(current.getMinutes() + interval);
    }

    return slots;
  };

  // Compress image via Canvas before upload (max 800px, 75% quality JPEG)
  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 800;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
            else { width = Math.round(width * MAX / height); height = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.75);
        };
        img.src = ev.target!.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  // Notificar admin quando alguém está a caminho
  useEffect(() => {
    if (isAuthenticated) {
      queue.forEach(item => {
        const prevItem = prevQueueRef.current.find(p => p.id === item.id);
        if (item.isOnWay && (!prevItem || !prevItem.isOnWay)) {
          showToast(`🚗 O cliente ${item.name} confirmou que está a caminho!`, 'info');
        }
      });
    }
    prevQueueRef.current = queue;
  }, [queue, isAuthenticated, showToast]);

  const [myQueueItemIds, setMyQueueItemIds] = useState<string[]>(() => {
    const stored = localStorage.getItem(`suavez_customer_ids_${tenant.id}`);
    if (stored) {
      try { return JSON.parse(stored); } catch { return []; }
    }
    // Suporte legado para ID único
    const legacy = localStorage.getItem(`suavez_customer_id_${tenant.id}`);
    return legacy ? [legacy] : [];
  });

  const [forceShowJoinForm, setForceShowJoinForm] = useState(false);

  const myItemsInQueue = queue.filter(item => myQueueItemIds.includes(item.id));

  const openCustomerJoin = () => {
    setForceShowJoinForm(myItemsInQueue.length > 0);
    if (window.matchMedia('(max-width: 980px)').matches) {
      setShowMobileJoinModal(true);
      return;
    }
    window.requestAnimationFrame(() => {
      document.querySelector('.customer-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // Limpar localStorage se não estiver mais na fila
  useEffect(() => {
    if (myQueueItemIds.length > 0 && queue.length > 0) {
      const timer = setTimeout(() => {
        const stillInQueue = myQueueItemIds.filter(id => queue.some(item => item.id === id));
        if (stillInQueue.length !== myQueueItemIds.length) {
          setMyQueueItemIds(stillInQueue);
          localStorage.setItem(`suavez_customer_ids_${tenant.id}`, JSON.stringify(stillInQueue));
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [queue, myQueueItemIds, tenant.id]);

  // Trigger confirmation modal
  const handleJoinQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    if (!selectedServiceId) {
      showToast('Por favor, selecione um serviço!', 'warning');
      return;
    }
    if (tenant.bookingType === 'appointment' && !selectedTimeSlot) {
      showToast('Por favor, selecione um horário!', 'warning');
      return;
    }
    
    // Abrir modal de confirmação
    setShowJoinConfirmation(true);
  };

  // Filtering Logic
  const todayStr = toLocalDateInputValue(new Date());

  useEffect(() => {
    if (tenant.bookingType !== 'queue') return;
    setSelectedDate(todayStr);
    setAdminSelectedDate(todayStr);
    if (activeTab === 'agenda') setActiveTab('atendimento');
  }, [tenant.bookingType, activeTab, todayStr]);
  
  // Today's Queue (Atendimento)
  const todayQueue = queue.filter(item => {
    if (tenant.bookingType === 'queue') {
      return !item.appointmentTime
        && (item.status === 'waiting' || item.status === 'ready' || item.status === 'serving');
    }
    return queueItemDate(item) === todayStr;
  }).sort((a, b) => {
    if (a.appointmentTime && b.appointmentTime) return a.appointmentTime.localeCompare(b.appointmentTime);
    return a.joinedAt.localeCompare(b.joinedAt);
  });

  // Filter for the specific admin selected date (used in Agenda tab)
  const filteredAgenda = queue.filter(item => {
    return Boolean(item.appointmentTime)
      && queueItemDate(item) === adminSelectedDate
      && item.status !== 'cancelled'
      && item.status !== 'completed';
  }).sort((a, b) => {
    if (a.appointmentTime && b.appointmentTime) return a.appointmentTime.localeCompare(b.appointmentTime);
    return a.joinedAt.localeCompare(b.joinedAt);
  });

  const servingCount = todayQueue.filter(item => item.status === 'serving').length;
  const waitingCount = todayQueue.filter(item => item.status === 'waiting' || item.status === 'ready').length;
  const pendingCount = todayQueue.filter(item => item.status === 'pending').length;
  const activeTodayQueue = todayQueue
    .filter(item => item.status !== 'cancelled' && item.status !== 'completed')
    .filter(item => tenant.bookingType === 'appointment' || item.status !== 'pending')
    .sort((a, b) => Number(a.status !== 'pending') - Number(b.status !== 'pending'));

  const handleApproveAppointment = async (itemId: string) => {
    const item = queue.find(i => i.id === itemId);
    if (!item || activeQueueActionId) return;

    setActiveQueueActionId(itemId);
    try {
      const { error } = await supabase
        .from('queue_items')
        .update({ status: 'waiting' })
        .eq('id', itemId);

      if (error) {
        showToast('Não foi possível confirmar o agendamento: ' + error.message, 'error');
        return;
      }
      showToast(`Agendamento de ${item.name} confirmado! ✅`, 'success');
      if (item.pushId) {
        void sendPushNotification('appointment_approved', tenant.id, item.id);
      }
    } finally {
      setActiveQueueActionId(null);
    }
  };

  const handleRejectAppointment = async (item: QueueItem) => {
    const confirm = window.confirm(`Deseja realmente recusar o agendamento de ${item.name}?`);
    if (!confirm || activeQueueActionId) return;

    setActiveQueueActionId(item.id);
    try {
      const { error } = await supabase
        .from('queue_items')
        .update({ status: 'cancelled' })
        .eq('id', item.id);

      if (error) {
        showToast('Não foi possível recusar o agendamento: ' + error.message, 'error');
        return;
      }
      showToast('Agendamento recusado.', 'info');
      if (item.pushId) {
        void sendPushNotification('appointment_rejected', tenant.id, item.id);
      }
    } finally {
      setActiveQueueActionId(null);
    }
  };



  // Group client queue by day
  const groupedClientQueue = queue.reduce((acc, item) => {
    const date = queueItemDate(item);
    if (!acc[date]) acc[date] = [];
    acc[date].push(item);
    return acc;
  }, {} as Record<string, QueueItem[]>);
  const publicQueueItems = (tenant.bookingType === 'queue'
    ? queue.filter(item => !item.appointmentTime && (item.status === 'waiting' || item.status === 'ready' || item.status === 'serving'))
    : (groupedClientQueue[selectedDate] || []).filter(item => item.status !== 'cancelled'))
    .sort((a, b) => (a.appointmentTime || a.joinedAt).localeCompare(b.appointmentTime || b.joinedAt));

  // Handle actual adding to queue
  const confirmJoinQueue = async (requestedPushId?: string | null) => {
    setShowConfirmation(false);
    setLoading(true);
    
    if (myQueueItemIds.length >= 4) {
      showToast('Limite de 3 acompanhantes atingido!', 'warning');
      setLoading(false);
      return;
    }
    
    try {
      const selectedSvc = tenant.services.find(s => s.id === selectedServiceId);
      if (!selectedSvc) {
        console.error('Serviço selecionado não foi encontrado.');
        setLoading(false);
        return;
      }

      // Capture OneSignal ID if possible (non-blocking, PROD ONLY)
      let pushId = requestedPushId ?? null;
      if (import.meta.env.PROD && requestedPushId === undefined) {
        try {
          pushId = await getOneSignalId();
        } catch (err) {
          console.warn('Não foi possível ativar as notificações deste dispositivo.', err);
        }
      }

      const { data, error } = await supabase.from('queue_items').insert([{
        tenant_id: tenant.id,
        name: name.trim(),
        whatsapp: customerWhatsapp.trim(),
        service_id: selectedSvc.id,
        service_name: selectedSvc.name,
        price: selectedSvc.price,
        status: tenant.bookingType === 'appointment' ? 'pending' : 'waiting',
        appointment_time: tenant.bookingType === 'appointment' ? getISOWithOffset(selectedDate, selectedTimeSlot) : null,
        push_id: pushId,
        duration: selectedSvc.duration || 30
      }]).select();

      if (error) {
        console.error('Erro ao criar atendimento:', error);
        showToast('Erro ao entrar na fila: ' + error.message, 'error');
      } else if (data && data.length > 0) {
        setName('');
        setCustomerWhatsapp('');
        
        const newIds = [...myQueueItemIds, data[0].id];
        setMyQueueItemIds(newIds);
        localStorage.setItem(`suavez_customer_ids_${tenant.id}`, JSON.stringify(newIds));
        localStorage.setItem(`suavez_in_queue_${tenant.id}`, 'true');
        setForceShowJoinForm(false);
        setShowMobileJoinModal(false);
        
        // Forçar atualização manual da fila caso o realtime falhe
        fetchData();
        
        showToast('Presença confirmada com sucesso!', 'success');

        // O servidor deriva texto e destinatário a partir deste registro.
        sendPushNotification('client_joined', tenant.id, data[0].id);
      }
    } catch (err: unknown) {
      console.error('Erro inesperado ao criar atendimento:', err);
      const message = err instanceof Error ? err.message : 'Tente novamente em instantes.';
      showToast('Ocorreu um erro inesperado: ' + message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const confirmAdminAddClient = async () => {
    const selectedSvc = tenant.services.find(service => service.id === selectedServiceId);
    if (!name.trim() || !customerWhatsapp.trim() || !selectedSvc) {
      showToast('Preencha os dados do cliente e selecione um serviço.', 'warning');
      return false;
    }
    if (tenant.bookingType === 'appointment' && !selectedTimeSlot) {
      showToast('Selecione um horário disponível.', 'warning');
      return false;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('queue_items').insert([{
        tenant_id: tenant.id,
        name: name.trim(),
        whatsapp: customerWhatsapp.trim(),
        service_id: selectedSvc.id,
        service_name: selectedSvc.name,
        price: selectedSvc.price,
        // Um compromisso criado pelo próprio estabelecimento já nasce confirmado.
        status: 'waiting',
        appointment_time: tenant.bookingType === 'appointment' ? getISOWithOffset(selectedDate, selectedTimeSlot) : null,
        push_id: null,
        duration: selectedSvc.duration || 30,
      }]);

      if (error) {
        showToast('Não foi possível adicionar o cliente: ' + error.message, 'error');
        return false;
      }

      setName('');
      setCustomerWhatsapp('');
      setSelectedServiceId('');
      setSelectedTimeSlot('');
      await fetchData();
      showToast(tenant.bookingType === 'appointment' ? 'Agendamento confirmado e adicionado.' : 'Cliente adicionado à fila.', 'success');
      return true;
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteService = async (id: string) => {
    if (!isAuthenticated || activeQueueActionId) return;
    
    const item = queue.find(q => q.id === id);
    if (!item) {
      showToast('Este atendimento não está mais disponível.', 'warning');
      return;
    }

    setActiveQueueActionId(id);
    try {
      // Registra a receita primeiro; se a remoção falhar, desfaz o registro criado.
      const { data: financialRecord, error: financialError } = await supabase.from('financial_records').insert([{
        tenant_id: tenant.id,
        price: item.price,
      }]).select('id').single();

      if (financialError || !financialRecord) {
        showToast('Não foi possível registrar a receita. O atendimento continua aberto.', 'error');
        return;
      }

      const { error: deleteError } = await supabase.from('queue_items').delete().eq('id', id);
      if (deleteError) {
        await supabase.from('financial_records').delete().eq('id', financialRecord.id);
        showToast('Não foi possível concluir o atendimento. Tente novamente.', 'error');
        return;
      }

      setQueue(current => current.filter(queueItem => queueItem.id !== id));
      setCompletedCount(current => current + 1);
      showToast('Atendimento concluído e receita registrada.', 'success');
    } finally {
      setActiveQueueActionId(null);
    }
  };

  const handleCallClient = async (id: string) => {
    if (!isAuthenticated || activeQueueActionId) return;
    
    const client = queue.find(q => q.id === id);
    if (!client || client.status === 'ready') return;

    setActiveQueueActionId(id);
    try {
      const { error } = await supabase.from('queue_items').update({ status: 'ready' }).eq('id', id);
      if (error) {
        showToast('Não foi possível chamar o cliente: ' + error.message, 'error');
        return;
      }
      showToast(`Cliente ${client.name} chamado!`, 'success');
      if (client.pushId) void sendPushNotification('client_called', tenant.id, client.id);
    } finally {
      setActiveQueueActionId(null);
    }
  };

  const handleStartService = async (id: string) => {
    if (!isAuthenticated || activeQueueActionId) return;
    
    // Find client to get push_id
    const client = queue.find(q => q.id === id);
    
    if (!client) return;

    setActiveQueueActionId(id);
    try {
      const { error } = await supabase.from('queue_items').update({
        status: 'serving',
        started_at: new Date().toISOString(),
        is_on_way: false
      }).eq('id', id);

      if (error) {
        showToast('Não foi possível iniciar o atendimento: ' + error.message, 'error');
        return;
      }
      showToast(`Atendimento de ${client.name} iniciado.`, 'success');
      if (client.pushId) void sendPushNotification('service_started', tenant.id, client.id);
    } finally {
      setActiveQueueActionId(null);
    }
  };

  const handleRemoveFromQueue = async (item: QueueItem) => {
    if (!isAuthenticated) return;
    setItemToDelete(item);
    setShowAdminDeleteModal(true);
  };

  const confirmAdminDelete = async () => {
    if (!itemToDelete) return;
    const { error } = await supabase.from('queue_items').delete().eq('id', itemToDelete.id);
    if (error) {
      showToast('Erro ao remover: ' + error.message, 'error');
    } else {
      showToast('Cliente removido com sucesso.', 'info');
    }
    setShowAdminDeleteModal(false);
    setItemToDelete(null);
  };

  const handleConfirmOnWay = async (id: string) => {
    setLoading(true);
    const { error } = await supabase
      .from('queue_items')
      .update({ is_on_way: true })
      .eq('id', id);
    setLoading(false);
    
    if (error) {
      showToast('Erro ao confirmar presença: ' + error.message, 'error');
    } else {
      showToast('Presença confirmada! O profissional foi avisado.', 'success');
      
      sendPushNotification('client_on_way', tenant.id, id);
    }
  };

  const handleCancelMyPlace = async (id: string) => {
    if (!id) return;
    setShowLeaveModal(false);
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('queue_items')
        .delete()
        .eq('id', id);
      
      if (error) {
        showToast('Erro ao cancelar: ' + error.message, 'error');
      } else {
        const newIds = myQueueItemIds.filter(i => i !== id);
        setMyQueueItemIds(newIds);
        localStorage.setItem(`suavez_customer_ids_${tenant.id}`, JSON.stringify(newIds));
        showToast('Cancelado com sucesso.', 'info');
      }
    } finally {
      setLoading(false);
      setItemForCancel(null);
    }
  };
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const validEmail = tenant.loginEmail || 'admin@suavez.com';
    const validPassword = tenant.loginPassword || '123456';
    
    if (loginEmail === validEmail && loginPassword === validPassword) {
      setIsAuthenticated(true);
      setShowLogin(false);
      showToast('Login realizado com sucesso!', 'success');
      
      // Persistir login para não deslogar ao atualizar
      localStorage.setItem(`suavez_auth_${tenant.slug}`, 'true');
      
      void loginOneSignal(`admin_${tenant.id}`).then(() => requestNotificationPermission()).then(async pushId => {
        if (!pushId) return;
        const { error } = await supabase.from('tenants').update({ admin_push_id: pushId }).eq('id', tenant.id);
        if (error) showToast('Login realizado, mas as notificações não puderam ser ativadas.', 'warning');
      });
    } else {
      showToast('E-mail ou senha incorretos!', 'error');
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    const { data, error } = await supabase
      .from('tenant_tasks')
      .insert([{
        tenant_id: tenant.id,
        title: newTaskTitle.trim(),
        is_completed: false
      }])
      .select();

    if (error || !data) {
      showToast('Não foi possível adicionar a tarefa: ' + (error?.message || 'tente novamente'), 'error');
      return;
    }
    setNewTaskTitle('');
    await fetchTasks();
    showToast('Atividade adicionada!', 'success');
  };

  const handleToggleTask = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('tenant_tasks')
      .update({ is_completed: !currentStatus })
      .eq('id', id);

    if (error) {
      showToast('Não foi possível atualizar a tarefa: ' + error.message, 'error');
      return;
    }
    await fetchTasks();
  };

  const handleDeleteTask = async (id: string) => {
    const { error } = await supabase
      .from('tenant_tasks')
      .delete()
      .eq('id', id);

    if (error) {
      showToast('Não foi possível remover a tarefa: ' + error.message, 'error');
      return;
    }
    await fetchTasks();
    showToast('Atividade removida!', 'info');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem(`suavez_auth_${tenant.slug}`);
    void getOneSignalId().then(pushId => {
      if (!pushId) return undefined;
      return supabase.from('tenants').update({ admin_push_id: null }).eq('id', tenant.id).eq('admin_push_id', pushId);
    }).finally(() => logoutOneSignal());
  };

  const toggleRole = () => {
    if (isAuthenticated) {
      handleLogout();
    } else {
      setShowLogin(true);
    }
  };

  const toggleStatus = async () => {
    if (!isAuthenticated) return;
    const newStatus = !tenant.isOnline;
    const { error } = await supabase
      .from('tenants')
      .update({ is_online: newStatus })
      .eq('id', tenant.id);
    
    if (error) {
      showToast('Erro ao mudar status: ' + error.message, 'error');
    } else {
      showToast(`Você está agora ${newStatus ? 'Online' : 'Offline'}`, 'info');
    }
  };

  // Format WhatsApp: (XX) XXXXX-XXXX
  const formatPhoneNumber = (value: string) => {
    const n = value.replace(/\D/g, '');
    if (n.length <= 2) return n;
    if (n.length <= 10) {
      // (XX) XXXX-XXXX (fixo ou mobile sem 9)
      return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
    }
    // (XX) 9XXXX-XXXX (mobile com 9)
    return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    if (formatted.length <= 15) { // Limit to (XX) 9XXXX-XXXX
      setCustomerWhatsapp(formatted);
    }
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServiceName.trim() || !newServicePrice) return;

    const price = parseMoneyInput(newServicePrice);
    const duration = Number(newServiceDuration);
    if (price === null) {
      showToast('Informe um preço válido e não negativo.', 'warning');
      return;
    }
    if (!Number.isInteger(duration) || duration < 5 || duration > 600) {
      showToast('A duração deve ficar entre 5 e 600 minutos.', 'warning');
      return;
    }

    let updatedServices: Service[] = [];
    
    if (editingService) {
      // Edit existing
      updatedServices = tenant.services.map(s => 
        s.id === editingService.id ? { ...s, name: newServiceName.trim(), price, duration } : s
      );
    } else {
      // Add new
      const newService: Service = {
        id: crypto.randomUUID(),
        name: newServiceName.trim(),
        price,
        duration,
      };
      updatedServices = [...tenant.services, newService];
    }

    const { error } = await supabase
      .from('tenants')
      .update({ services: updatedServices })
      .eq('id', tenant.id);

    if (error) {
      showToast('Erro ao salvar serviço: ' + error.message, 'error');
    } else {
      showToast(editingService ? 'Serviço atualizado!' : 'Serviço adicionado!', 'success');
      setTenant({ ...tenant, services: updatedServices });
      setShowServiceModal(false);
      setEditingService(null);
      setNewServiceName('');
      setNewServicePrice('');
      setNewServiceDuration('30');
    }
  };

  const handleDeleteService = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este serviço?')) return;

    const updatedServices = tenant.services.filter(s => s.id !== id);

    const { error } = await supabase
      .from('tenants')
      .update({ services: updatedServices })
      .eq('id', tenant.id);

    if (error) {
      showToast('Erro ao excluir serviço: ' + error.message, 'error');
    } else {
      showToast('Serviço excluído!', 'success');
      setTenant({ ...tenant, services: updatedServices });
    }
  };

  const openServiceModal = (service?: Service) => {
    if (service) {
      setEditingService(service);
      setNewServiceName(service.name);
      setNewServicePrice(service.price.toString());
      setNewServiceDuration((service.duration || 30).toString());
    } else {
      setEditingService(null);
      setNewServiceName('');
      setNewServicePrice('');
      setNewServiceDuration('30');
    }
    setShowServiceModal(true);
  };

  const updateTenantProfile = async <K extends keyof Tenant>(field: K, value: Tenant[K]) => {
    setProfileSaveState('saving');
    const dbField = field === 'primaryColor' ? 'primary_color' : field === 'secondaryColor' ? 'secondary_color' : field === 'logoUrl' ? 'logo_url' : field === 'hasLogo' ? 'has_logo' : field;
    const { error } = await supabase
      .from('tenants')
      .update({ [dbField]: value })
      .eq('id', tenant.id);

    if (error) {
      setProfileSaveState('error');
      showToast('Erro ao atualizar perfil: ' + error.message, 'error');
    } else {
      setTenant({ ...tenant, [field]: value });
      setProfileSaveState('saved');
      showToast('Perfil atualizado com sucesso!', 'success');
    }
  };

  // DERIVED CONFIG: Always recalculate based on current state
  const prof = getProfessionConfig(tenant.profession);
  const selectedService = tenant.services.find(service => service.id === selectedServiceId);
  const availableTimeSlots = tenant.bookingType === 'appointment' ? generateTimeSlots() : [];
  const selectedDayAppointments = (groupedClientQueue[selectedDate] || [])
    .filter(item => item.status !== 'cancelled');
  const customerAccent = tenant.primaryColor || '#7257d9';
  const customerSecondary = tenant.secondaryColor || '#ffffff';
  const customerThemeStyle = {
    '--accent-primary': customerAccent,
    '--accent-primary-rgb': hexToRgbString(customerAccent),
    '--accent-secondary': customerSecondary,
    '--customer-accent': customerAccent,
    '--customer-accent-rgb': hexToRgbString(customerAccent),
    '--customer-on-accent': getReadableAccentText(customerAccent, customerSecondary),
  } as React.CSSProperties;
  const adminThemeStyle = {
    ...customerThemeStyle,
    '--admin-accent': customerAccent,
    '--admin-accent-rgb': hexToRgbString(customerAccent),
    '--admin-on-accent': getReadableAccentText(customerAccent, customerSecondary),
  } as React.CSSProperties;
  const activeTabMeta = activeTab === 'atendimento' && tenant.bookingType === 'queue'
    ? {
        eyebrow: 'Operação em tempo real',
        title: 'Fila de agora',
        description: 'Acompanhe a ordem de chegada e conduza cada cliente até a conclusão.',
      }
    : ADMIN_TAB_META[activeTab];
  const clientQueueDate = tenant.bookingType === 'queue' ? todayStr : selectedDate;
  const adminNavGroups: Array<{ label: string; items: Array<{ id: AdminTab; label: string; description: string }> }> = [
    {
      label: 'Operação',
      items: [
        { id: 'atendimento', label: tenant.bookingType === 'queue' ? 'Fila de agora' : 'Atendimento de hoje', description: tenant.bookingType === 'queue' ? 'Movimento em tempo real' : 'Compromissos do dia' },
        ...(tenant.bookingType === 'appointment' ? [{ id: 'agenda' as AdminTab, label: 'Agenda', description: 'Reservas por data' }] : []),
      ],
    },
    {
      label: 'Negócio',
      items: [
        { id: 'financial', label: 'Financeiro', description: 'Receitas e despesas' },
        { id: 'services', label: 'Serviços', description: 'Preços e duração' },
        { id: 'store', label: 'Produtos', description: 'Catálogo recomendado' },
        { id: 'tasks', label: 'Tarefas', description: 'Pendências da rotina' },
      ],
    },
    {
      label: 'Estabelecimento',
      items: [
        { id: 'scheduling', label: 'Atendimento e horários', description: 'Modelo e expediente' },
        { id: 'settings', label: 'Perfil e aparência', description: 'Contato e identidade' },
      ],
    },
  ];

  // Format time (e.g., 14:30)
  const formatTimeISO = (isoString: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    // Usar o formatador para garantir que mostre o horário local corretamente
    return date.toLocaleTimeString('pt-BR', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false
    });
  };

  const getISOWithOffset = (dateStr: string, timeStr: string) => {
    const d = new Date(`${dateStr}T${timeStr}:00`);
    const offset = -d.getTimezoneOffset();
    const absOffset = Math.abs(offset);
    const sign = offset >= 0 ? '+' : '-';
    const hours = Math.floor(absOffset / 60).toString().padStart(2, '0');
    const mins = (absOffset % 60).toString().padStart(2, '0');
    return `${dateStr}T${timeStr}:00${sign}${hours}:${mins}`;
  };

  const changeAdminDateBy = (days: number) => {
    const date = new Date(`${adminSelectedDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    const nextDate = toLocalDateInputValue(date);
    setAdminSelectedDate(nextDate);
    setSelectedDate(nextDate);
  };

  const openAdminAddModal = () => {
    setName('');
    setCustomerWhatsapp('');
    setSelectedServiceId('');
    setSelectedTimeSlot('');
    const requestedDate = activeTab === 'agenda' && adminSelectedDate >= todayStr ? adminSelectedDate : todayStr;
    setSelectedDate(requestedDate);
    setIsAdminAddModalOpen(true);
  };

  // Dynamic CSS variables for tenant theme dynamically applied to document root 
  useEffect(() => {
    const color = tenant.primaryColor || '#d4af37';
    const sColor = tenant.secondaryColor || '#ffffff';
    document.documentElement.style.setProperty('--accent-primary', color);
    document.documentElement.style.setProperty('--accent-primary-rgb', hexToRgbString(color));
    document.documentElement.style.setProperty('--accent-secondary', sColor);
    
    // Cleanup if leaving tenant view
    return () => {
      document.documentElement.style.removeProperty('--accent-primary');
      document.documentElement.style.removeProperty('--accent-primary-rgb');
      document.documentElement.style.removeProperty('--accent-secondary');
    };
  }, [tenant.primaryColor, tenant.secondaryColor]);

  return (
    <>
      {/* Professional Login Page (Full Screen Overlay) */}
      {showLogin && (
        <div className="login-page-overlay fade-in">
          <div className="login-page-container">
            <button className="login-back-button" onClick={() => setShowLogin(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              Voltar para o site
            </button>

            <div className="login-card glass-panel">
              <div className="login-header">
                <div className={`login-logo ${tenant.hasLogo && tenant.logoUrl ? 'has-custom-logo' : 'has-profession-icon'}`}>
                  {tenant.hasLogo && tenant.logoUrl ? (
                    <img src={tenant.logoUrl} alt="Logo" />
                  ) : (
                    <ProfessionIcon profession={tenant.profession} className="profession-icon profession-icon--login" />
                  )}
                </div>
                <h2>Acesso Profissional</h2>
                <p>Gerencie sua fila e agendamentos em tempo real.</p>
              </div>

              <form onSubmit={handleLogin} className="login-form">
                <div className="form-group">
                  <label>E-mail de Acesso</label>
                  <div className="input-with-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                    <input 
                      type="email" 
                      value={loginEmail} 
                      onChange={(e) => setLoginEmail(e.target.value)} 
                      placeholder="seu@email.com"
                      required 
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Sua Senha</label>
                  <div className="input-with-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    <input 
                      type="password" 
                      value={loginPassword} 
                      onChange={(e) => setLoginPassword(e.target.value)} 
                      placeholder="••••••••"
                      required 
                    />
                  </div>
                </div>

                <button type="submit" className="btn-submit login-btn">
                  Acessar Painel
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </button>
              </form>

              <div className="login-footer">
                <p>Esqueceu sua senha? Entre em contato com o suporte do Sua Vez.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAuthenticated ? (
        /* PROFESSIONAL ADMIN LAYOUT */
        <div className="admin-layout-wrapper professional-admin fade-in" style={adminThemeStyle}>
          {/* MOBILE BACKDROP */}
          {isMobileMenuOpen && (
            <button className="sidebar-mobile-backdrop" onClick={() => setIsMobileMenuOpen(false)} aria-label="Fechar menu"></button>
          )}
          
          {/* SIDEBAR */}
          <aside
            id="professional-admin-menu"
            className={`admin-sidebar ${isMobileMenuOpen ? 'open' : ''}`}
            aria-hidden={isCompactAdmin && !isMobileMenuOpen ? true : undefined}
            inert={isCompactAdmin && !isMobileMenuOpen ? true : undefined}
          >
            <div className="sidebar-header">
              <div className={`sidebar-logo ${tenant.hasLogo && tenant.logoUrl ? 'has-custom-logo' : 'has-profession-icon'}`}>
                {tenant.hasLogo && tenant.logoUrl ? (
                  <img src={tenant.logoUrl} alt="Logo" className="sidebar-logo-img" />
                ) : (
                  <ProfessionIcon profession={tenant.profession} className="profession-icon profession-icon--sidebar" />
                )}
              </div>
              <div className="sidebar-brand">
                <h3>{tenant.name}</h3>
                <p>Painel Administrativo</p>
              </div>
            </div>

            <nav className="sidebar-nav" aria-label="Navegação do painel profissional">
              {adminNavGroups.map(group => (
                <div className="admin-nav-group" key={group.label}>
                  <span className="admin-nav-label">{group.label}</span>
                  {group.items.map(item => (
                    <button
                      key={item.id}
                      className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                      onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
                      aria-current={activeTab === item.id ? 'page' : undefined}
                    >
                      <AdminNavIcon tab={item.id} />
                      <span className="admin-nav-copy">
                        <span className="admin-nav-text">{item.label}</span>
                        <span className="admin-nav-description">{item.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            <div className="sidebar-footer">
              {tenant.bookingType === 'queue' && (
                <div className="tenant-status-card">
                  <div className="status-indicator">
                    <div className={`status-dot ${tenant.isOnline ? 'online' : 'offline'}`}></div>
                    <span>Fila {tenant.isOnline ? 'aberta' : 'fechada'}</span>
                  </div>
                  <button
                    onClick={toggleStatus}
                    className="btn-toggle-status"
                    style={{ background: tenant.isOnline ? '#ef4444' : '#10b981', color: '#fff' }}
                  >
                    {tenant.isOnline ? 'Fechar fila' : 'Abrir fila'}
                  </button>
                </div>
              )}
              <button onClick={toggleRole} className="btn-logout">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                Sair do Painel
              </button>
            </div>
          </aside>

          {/* MAIN CONTENT */}
          <main className="admin-main-content">
            {/* Payment Alert Banner */}
            {(tenant.subscriptionStatus === 'pending' || tenant.subscriptionStatus === 'overdue') && (
              <div className="payment-alert-banner fade-in">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="alert-icon-pulse">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                  </div>
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.95rem' }}>Atenção: Pagamento Pendente</strong>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', opacity: 0.9 }}>
                      {tenant.nextPaymentAt ? (
                        <>Sua mensalidade venceu em <strong>{new Date(tenant.nextPaymentAt).toLocaleDateString('pt-BR')}</strong>.</>
                      ) : (
                        <>Sua mensalidade está pendente de pagamento.</>
                      )}
                      {" "}Realize o pagamento para evitar a suspensão dos serviços.
                    </p>
                    {adminPixKey && (
                      <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {adminPixName && (
                          <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                            <span style={{ fontWeight: 600 }}>Favorecido:</span> {adminPixName}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Chave PIX:</span>
                          <code style={{ background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', letterSpacing: '0.5px' }}>
                            {adminPixKey}
                          </code>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(adminPixKey);
                              showToast('Chave PIX copiada!', 'success');
                            }}
                            style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: '4px' }}
                            title="Copiar PIX"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <a 
                  href={`https://wa.me/5573981171609?text=Olá! Já realizei o pagamento da minha conta: ${tenant.name}. Segue o comprovante.`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="btn-pay-now"
                >
                  Enviar Comprovante
                </a>
              </div>
            )}

            <header className="admin-topbar admin-page-header">
              <div className="admin-page-heading">
                <button
                  className="mobile-menu-btn"
                  onClick={() => setIsMobileMenuOpen(true)}
                  aria-label="Abrir menu"
                  aria-expanded={isMobileMenuOpen}
                  aria-controls="professional-admin-menu"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                </button>
                <div className="topbar-info">
                  <span className="admin-eyebrow">{activeTabMeta.eyebrow}</span>
                  <h1>{activeTabMeta.title}</h1>
                  <p>{activeTabMeta.description}</p>
                </div>
              </div>
              <div className="topbar-actions">
                  <button
                    type="button"
                    className={`admin-notification-toggle ${notifsEnabled ? 'enabled' : ''}`}
                    onClick={() => void enableNotifications()}
                    aria-label={notifsEnabled ? 'Notificações ativas neste dispositivo' : 'Ativar notificações neste dispositivo'}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                    <span>{notifsEnabled ? 'Avisos ativos' : 'Ativar avisos'}</span>
                  </button>
                  <div className="admin-mode-pill">
                    <span>{tenant.bookingType === 'queue' ? 'Ordem de chegada' : 'Horário marcado'}</span>
                    {(activeTab === 'atendimento' || activeTab === 'agenda') && (
                      <small>{activeTab === 'agenda'
                        ? new Date(adminSelectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                        : 'Hoje'}</small>
                    )}
                  </div>
                  <div className="subscription-badge">
                    <div className={`sub-dot ${tenant.subscriptionStatus === 'active' ? 'active' : 'warning'}`}></div>
                    <span>Plano {tenant.subscriptionStatus === 'active' ? 'Ativo' : 'Pendente'}</span>
                  </div>
                  {(activeTab === 'atendimento' || activeTab === 'agenda') && (
                    <button 
                      onClick={openAdminAddModal}
                      className="admin-header-action"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                      {tenant.bookingType === 'appointment' ? 'Novo agendamento' : 'Adicionar à fila'}
                    </button>
                  )}
               </div>
            </header>

            {isAdminAddModalOpen && (
               <div className="modal-overlay" style={{ zIndex: 10000 }}>
                  <div className="modal-content admin-modal fade-in" role="dialog" aria-modal="true" aria-labelledby="admin-add-client-title">
                    <div className="admin-modal-header">
                      <div>
                        <span className="admin-eyebrow">{tenant.bookingType === 'appointment' ? 'Novo compromisso' : 'Atendimento imediato'}</span>
                        <h3 id="admin-add-client-title">{tenant.bookingType === 'appointment' ? 'Adicionar agendamento' : 'Adicionar cliente à fila'}</h3>
                      </div>
                      <button className="admin-icon-button" onClick={() => setIsAdminAddModalOpen(false)} aria-label="Fechar">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </button>
                    </div>

                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      const wasCreated = await confirmAdminAddClient();
                      if (wasCreated) setIsAdminAddModalOpen(false);
                    }}>
                      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                        <label htmlFor="admin-client-name" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Nome do Cliente</label>
                        <input id="admin-client-name" autoFocus className="premium-input" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
                      </div>
                      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                        <label htmlFor="admin-client-whatsapp" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>WhatsApp</label>
                        <input id="admin-client-whatsapp" className="premium-input" type="tel" value={customerWhatsapp} onChange={handlePhoneChange} required />
                      </div>
                      
                      <div className="admin-form-grid" style={{ marginBottom: '1.25rem' }}>
                        <div className="form-group">
                          <label htmlFor="admin-client-service" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Serviço</label>
                          <select 
                            id="admin-client-service"
                            value={selectedServiceId} 
                            onChange={(e) => {
                              setSelectedServiceId(e.target.value);
                              setSelectedTimeSlot('');
                            }}
                            required
                            className="premium-input"
                          >
                            <option value="" disabled hidden>Selecione um serviço...</option>
                            {tenant.services.map(s => (
                              <option key={s.id} value={s.id}>{s.name} - R$ {s.price.toFixed(2).replace('.', ',')}</option>
                            ))}
                          </select>
                        </div>
                        
                        {tenant.bookingType === 'appointment' && (
                          <div className="form-group">
                            <label htmlFor="admin-client-date" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Data</label>
                            <input 
                              id="admin-client-date"
                              type="date" 
                              value={selectedDate} 
                              onChange={(e) => {
                                setSelectedDate(e.target.value);
                                setSelectedTimeSlot('');
                              }}
                              min={todayStr}
                              required 
                              className="premium-input"
                            />
                          </div>
                        )}
                      </div>

                      {tenant.bookingType === 'appointment' && (
                        <div className="form-group" style={{ marginBottom: '2rem' }}>
                          <label htmlFor="admin-client-time" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Horário Disponível</label>
                          <select 
                            id="admin-client-time"
                            value={selectedTimeSlot} 
                            onChange={(e) => setSelectedTimeSlot(e.target.value)} 
                            required
                            className="premium-input"
                          >
                            <option value="">Selecione um horário...</option>
                            {availableTimeSlots.map(slot => (
                              <option key={slot} value={slot}>{slot}</option>
                            ))}
                          </select>
                          {selectedServiceId && availableTimeSlots.length === 0 && (
                            <p className="admin-field-hint">Não há horários disponíveis nesta data para a duração deste serviço.</p>
                          )}
                        </div>
                      )}

                      <button type="submit" disabled={loading} className="btn-submit" style={{ width: '100%', padding: '14px', background: 'var(--accent-primary)', color: 'var(--customer-on-accent)', fontWeight: 800, borderRadius: '10px' }}>
                        {loading ? 'Salvando…' : tenant.bookingType === 'appointment' ? 'Confirmar Agendamento' : 'Colocar na Fila'}
                      </button>
                    </form>
                 </div>
               </div>
             )}

            <div className="admin-content-scroll">

              {activeTab === 'financial' ? (
                <div className="admin-module fade-in"><FinancialView tenantId={tenant.id} /></div>

              ) : activeTab === 'tasks' ? (
                <div className="admin-module fade-in">
                  <div className="premium-card admin-module-card">
                    <div className="admin-module-heading">
                      <div><span className="admin-eyebrow">Rotina organizada</span><h2 className="admin-module-title">Minhas tarefas</h2><p className="admin-module-copy">{tasks.filter(task => !task.isCompleted).length} pendentes · {tasks.filter(task => task.isCompleted).length} concluídas</p></div>
                    </div>
                    <form onSubmit={handleAddTask} className="admin-quick-form">
                      <input 
                        type="text" 
                        value={newTaskTitle} 
                        onChange={(e) => setNewTaskTitle(e.target.value)} 
                        placeholder="Adicione uma nova atividade..." 
                        style={{ flex: '1 1 200px', minWidth: '0' }} 
                      />
                      <button 
                        type="submit" 
                        className="btn-submit" 
                        style={{ width: 'auto', minWidth: '100px', flexShrink: 0, padding: '0 20px', background: '#0f172a', color: '#fff' }}
                      >
                        Adicionar
                      </button>
                    </form>

                    <div className="admin-list-stack">
                      {tasks.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Nenhuma atividade pendente.</p>
                      ) : (
                        tasks.map(task => (
                          <div key={task.id} className={`glass-card admin-list-row ${task.isCompleted ? 'is-complete' : ''}`}>
                            <input 
                              type="checkbox" 
                              checked={task.isCompleted} 
                              onChange={() => handleToggleTask(task.id, task.isCompleted)}
                              aria-label={`${task.isCompleted ? 'Reabrir' : 'Concluir'} tarefa: ${task.title}`}
                              style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                            />
                            <span style={{ 
                              flexGrow: 1, 
                              textDecoration: task.isCompleted ? 'line-through' : 'none',
                              opacity: task.isCompleted ? 0.5 : 1,
                              color: 'var(--text-primary)',
                              fontSize: '1rem',
                              fontWeight: 500
                            }}>
                              {task.title}
                            </span>
                            <button 
                              onClick={() => handleDeleteTask(task.id)} 
                              aria-label={`Excluir tarefa: ${task.title}`}
                              style={{ background: 'transparent', color: '#ef4444', padding: '5px', borderRadius: '5px', cursor: 'pointer' }}
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

              ) : activeTab === 'store' ? (
                <div className="admin-module fade-in">
                  <div className="premium-card admin-module-card">
                    <div className="admin-module-heading">
                      <div><span className="admin-eyebrow">Vitrine do estabelecimento</span><h2 className="admin-module-title">Produtos recomendados</h2><p className="admin-module-copy">Adicione produtos que você usa e recomenda. Seus clientes poderão visualizá-los.</p></div>
                      <span className="admin-count-chip">{products.length} {products.length === 1 ? 'produto' : 'produtos'}</span>
                    </div>
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newProductName || !newProductPrice) return;
                      const productPrice = parseMoneyInput(newProductPrice);
                      if (productPrice === null || productPrice === 0) {
                        showToast('Informe um preço de produto maior que zero.', 'warning');
                        return;
                      }
                      let imageUrl = newProductImage || null;

                      // Upload file if selected
                      if (newProductImageFile) {
                        let uploadBlob: Blob = newProductImageFile;
                        try {
                          uploadBlob = await compressImage(newProductImageFile);
                        } catch (error) {
                          console.warn('Não foi possível comprimir a imagem; o arquivo original será usado.', error);
                        }
                        const filePath = `products/${tenant.id}/${Date.now()}.jpg`;
                        const { data: uploadData, error: uploadError } = await supabase.storage
                          .from('product-images')
                          .upload(filePath, uploadBlob, { upsert: true, contentType: 'image/jpeg' });
                        if (!uploadError && uploadData) {
                          const { data: publicData } = supabase.storage.from('product-images').getPublicUrl(uploadData.path);
                          imageUrl = publicData.publicUrl;
                        } else if (uploadError) {
                          showToast('Erro ao enviar imagem: ' + uploadError.message, 'error');
                          return;
                        }
                      }

                      const { error } = await supabase.from('tenant_products').insert([{ tenant_id: tenant.id, name: newProductName.trim(), price: productPrice, image_url: imageUrl }]);
                      if (!error) {
                        setNewProductName('');
                        setNewProductPrice('');
                        setNewProductImage('');
                        setNewProductImageFile(null);
                        setNewProductImagePreview('');
                        fetchProducts();
                        showToast('Produto adicionado!', 'success');
                      } else {
                        showToast('Não foi possível adicionar o produto: ' + error.message, 'error');
                      }
                    }} className="admin-product-form">
                      <div className="admin-form-grid admin-product-form-grid">
                        <div className="form-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.8rem' }}>Nome do produto</label>
                          <input type="text" value={newProductName} onChange={e => setNewProductName(e.target.value)} placeholder="Ex: Pomada X" required />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.8rem' }}>Preço (R$)</label>
                          <input type="text" inputMode="decimal" value={newProductPrice} onChange={e => setNewProductPrice(e.target.value)} placeholder="29,90" required />
                        </div>
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.8rem' }}>Foto do produto</label>
                        <div className="admin-product-upload-row">
                          <label style={{ 
                            display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px',
                             border: '2px dashed color-mix(in srgb, var(--accent-primary) 30%, #cbd5e1)', borderRadius: '12px', cursor: 'pointer',
                            background: 'var(--bg-base)', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600,
                            transition: 'all 0.2s'
                          }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                            {newProductImageFile ? newProductImageFile.name : 'Selecionar foto'}
                            <input 
                              type="file" 
                              accept="image/*" 
                              style={{ display: 'none' }}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  // Show original as preview immediately
                                  setNewProductImagePreview(URL.createObjectURL(file));
                                  // Store file for upload (will be compressed on submit)
                                  setNewProductImageFile(file);
                                  showToast('Foto selecionada — será comprimida ao salvar 🗜️', 'success');
                                }
                              }}
                            />
                          </label>
                          {newProductImagePreview && (
                            <div style={{ position: 'relative' }}>
                              <img src={newProductImagePreview} alt="preview" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                              <button type="button" aria-label="Remover foto selecionada" onClick={() => { setNewProductImageFile(null); setNewProductImagePreview(''); }} style={{ position: 'absolute', top: '-10px', right: '-10px', background: '#ef4444', color: '#fff', borderRadius: '50%', width: '32px', height: '32px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                         <button type="submit" className="btn-submit" style={{ width: 'auto', padding: '0 24px' }}>Adicionar Produto</button>
                      </div>
                    </form>
                    <div className="admin-card-grid">
                      {products.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', padding: '2rem', gridColumn: '1/-1', textAlign: 'center' }}>Nenhum produto cadastrado ainda.</p>
                      ) : products.map(p => (
                        <div key={p.id} className="glass-card admin-product-card">
                          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: '140px', objectFit: 'cover' }} /> : (
                            <div style={{ width: '100%', height: '140px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                            </div>
                          )}
                          <div style={{ padding: '1rem' }}>
                            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>{p.name}</div>
                            <div className="admin-card-price">R$ {p.price.toFixed(2).replace('.',',')}</div>
                            <button onClick={async () => { if (!window.confirm(`Remover ${p.name} do catálogo?`)) return; const { error } = await supabase.from('tenant_products').delete().eq('id', p.id); if (error) { showToast('Não foi possível remover o produto: ' + error.message, 'error'); return; } await fetchProducts(); showToast('Produto removido.', 'info'); }} className="admin-danger-link">Remover</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              ) : activeTab === 'services' ? (
                <div className="admin-module fade-in">
                  <div className="premium-card admin-module-card">
                    <div className="admin-module-heading">
                      <div>
                        <span className="admin-eyebrow">Seu catálogo</span>
                        <h2 className="admin-module-title">Serviços oferecidos</h2>
                        <p className="admin-module-copy">Cadastre e gerencie os serviços oferecidos aos seus clientes.</p>
                      </div>
                      <button onClick={() => openServiceModal()} className="btn-submit" style={{ width: 'auto', padding: '0 24px', background: '#0f172a', color: '#fff' }}>
                        + Novo Serviço
                      </button>
                    </div>

                    <div className="admin-card-grid">
                      {tenant.services.length === 0 ? (
                        <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '4rem', background: 'rgba(255,255,255,0.02)', borderRadius: '20px' }}>
                          <p style={{ color: 'var(--text-secondary)' }}>Nenhum serviço cadastrado ainda.</p>
                        </div>
                      ) : tenant.services.map(s => (
                        <div key={s.id} className="glass-card admin-service-card">
                          <div>
                            <h4 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px' }}>{s.name}</h4>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <p className="admin-card-price">R$ {s.price.toFixed(2).replace('.', ',')}</p>
                              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '4px' }}>
                                {s.duration || 30} min
                              </span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <button 
                              onClick={() => openServiceModal(s)}
                              style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: 'none', padding: '8px', borderRadius: '8px', cursor: 'pointer' }}
                              title="Editar"
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button 
                              onClick={() => handleDeleteService(s.id)}
                              style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: 'none', padding: '8px', borderRadius: '8px', cursor: 'pointer' }}
                              title="Excluir"
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              ) : activeTab === 'settings' ? (
                <div className="admin-module fade-in">
                  <div className="premium-card admin-module-card">
                    <div className="admin-module-heading">
                      <div>
                        <span className="admin-eyebrow">Como o cliente vê sua marca</span>
                        <h2 className="admin-module-title">Perfil e identidade visual</h2>
                        <p className="admin-module-copy">A prévia é atualizada instantaneamente. As alterações são salvas ao sair do campo.</p>
                      </div>
                      <span className={`admin-save-state is-${profileSaveState}`}>
                        <span></span>
                        {profileSaveState === 'saving' ? 'Salvando…' : profileSaveState === 'error' ? 'Falha ao salvar' : 'Alterações salvas'}
                      </span>
                    </div>

                    <div className="admin-settings-grid">
                      <div className="admin-settings-fields">
                        <div className="form-group">
                          <label>WhatsApp de contato</label>
                          <input 
                            type="text" 
                            className="premium-input" 
                            value={tenant.whatsapp} 
                            onChange={(e) => setTenant({ ...tenant, whatsapp: formatPhoneNumber(e.target.value) })}
                            onBlur={(e) => updateTenantProfile('whatsapp', e.target.value)}
                          />
                        </div>
                        <div className="form-group admin-color-field">
                          <label>Cor principal da marca</label>
                          <div>
                            <input 
                              type="color" 
                              value={tenant.primaryColor || '#d4af37'} 
                              onChange={(e) => setTenant({ ...tenant, primaryColor: e.target.value })}
                              onBlur={(e) => updateTenantProfile('primaryColor', e.target.value)}
                            />
                            <span>{tenant.primaryColor?.toUpperCase() || '#D4AF37'}</span>
                          </div>
                        </div>
                        <div className="form-group admin-color-field">
                          <label>Cor de texto preferida</label>
                          <div>
                            <input 
                              type="color" 
                              value={tenant.secondaryColor || '#ffffff'} 
                              onChange={(e) => setTenant({ ...tenant, secondaryColor: e.target.value })}
                              onBlur={(e) => updateTenantProfile('secondaryColor', e.target.value)}
                            />
                            <span>{tenant.secondaryColor?.toUpperCase() || '#FFFFFF'}</span>
                          </div>
                          <small>O sistema corrige automaticamente o texto quando a combinação não possui contraste suficiente.</small>
                        </div>
                      </div>
                      <aside className="admin-brand-preview" aria-label="Prévia da identidade visual">
                        <span className="admin-brand-preview-label">Prévia para o cliente</span>
                        <div className="admin-brand-preview-stage" style={{ background: customerAccent, color: getReadableAccentText(customerAccent, customerSecondary) }}>
                          <div className="admin-brand-preview-mark"><ProfessionIcon profession={tenant.profession} /></div>
                          <span>Atendimento digital</span>
                          <strong>{tenant.name}</strong>
                          <p>Uma experiência simples, organizada e com a personalidade da sua marca.</p>
                          <button type="button" style={{ color: getReadableAccentText(customerAccent, customerSecondary) }}>Entrar na fila</button>
                        </div>
                      </aside>
                    </div>
                  </div>
                </div>

              ) : activeTab === 'scheduling' ? (
                <div className="admin-module fade-in">
                  <div className="premium-card admin-module-card">
                    <div className="admin-module-heading">
                      <div>
                        <span className="admin-eyebrow">Experiência de atendimento</span>
                        <h2 className="admin-module-title">Como seus clientes serão atendidos?</h2>
                        <p className="admin-module-copy">Escolha um modelo. A página do cliente é atualizada automaticamente.</p>
                      </div>
                    </div>

                    <div className="admin-booking-grid">
                      <button 
                        onClick={() => updateBookingType('queue')}
                        className={`glass-card admin-booking-option ${tenant.bookingType === 'queue' ? 'active-selection' : ''}`}
                        aria-pressed={tenant.bookingType === 'queue'}
                        style={{ 
                          padding: '2rem', 
                          textAlign: 'left', 
                          cursor: 'pointer', 
                          border: tenant.bookingType === 'queue' ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.05)',
                          background: tenant.bookingType === 'queue' ? 'rgba(16,185,129,0.05)' : 'transparent',
                          transition: 'all 0.3s ease'
                        }}
                      >
                        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', marginBottom: '1rem' }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        </div>
                        <h4 style={{ fontSize: '1.1rem', marginBottom: '8px', color: tenant.bookingType === 'queue' ? '#10b981' : 'var(--text-primary)' }}>Fila Virtual</h4>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>Clientes entram em uma lista de espera por ordem de chegada. Ideal para fluxos rápidos e sem hora marcada.</p>
                      </button>

                      <button 
                        onClick={() => updateBookingType('appointment')}
                        className={`glass-card admin-booking-option ${tenant.bookingType === 'appointment' ? 'active-selection' : ''}`}
                        aria-pressed={tenant.bookingType === 'appointment'}
                        style={{ 
                          padding: '2rem', 
                          textAlign: 'left', 
                          cursor: 'pointer', 
                          border: tenant.bookingType === 'appointment' ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.05)',
                          background: tenant.bookingType === 'appointment' ? 'rgba(16,185,129,0.05)' : 'transparent',
                          transition: 'all 0.3s ease'
                        }}
                      >
                        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(59,130,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6', marginBottom: '1rem' }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        </div>
                        <h4 style={{ fontSize: '1.1rem', marginBottom: '8px', color: tenant.bookingType === 'appointment' ? '#3b82f6' : 'var(--text-primary)' }}>Horário Marcado</h4>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>Clientes escolhem um dia e horário específico para serem atendidos. Melhora a previsibilidade e organização.</p>
                      </button>
                    </div>

                    <div className="admin-notice-card">
                      <h4 style={{ fontSize: '0.95rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                        Nota importante
                      </h4>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                        Ao mudar o modelo de atendimento, as telas dos seus clientes serão atualizadas automaticamente para o novo formato. Agendamentos ou pessoas que já estão na fila permanecerão salvos.
                      </p>
                    </div>

                    {tenant.bookingType === 'appointment' && (
                      <div className="fade-in admin-schedule-section">
                        <div style={{ marginBottom: '2.5rem' }}>
                          <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(var(--accent-primary-rgb), 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)' }}>
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                            </div>
                            Configuração da Agenda
                          </h3>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Personalize seu fluxo de trabalho e intervalos de descanso.</p>
                        </div>

                        <div className="admin-settings-grid">
                          {/* Card: Tempo de Serviço */}
                          <div className="glass-card" style={{ padding: '2rem', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                              <div style={{ color: '#3b82f6' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                              </div>
                              <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Intervalo entre horários</h4>
                            </div>
                            <div className="form-group">
                              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <input 
                                  type="number" 
                                  className="premium-input"
                                  key={`${tenant.id}-${tenant.appointmentInterval}`}
                                  defaultValue={tenant.appointmentInterval || 30}
                                  onBlur={e => {
                                    const value = Number(e.target.value);
                                    if (!Number.isInteger(value) || value < 5 || value > 240) {
                                      e.currentTarget.value = String(tenant.appointmentInterval || 30);
                                      showToast('Use um intervalo entre 5 e 240 minutos.', 'warning');
                                      return;
                                    }
                                    if (value !== tenant.appointmentInterval) void updateSchedulingSettings('appointment_interval', value);
                                  }}
                                  step="5" min="5" max="240"
                                  style={{ flex: 1, fontSize: '1.2rem', fontWeight: 700, textAlign: 'center' }}
                                />
                                <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 600 }}>minutos</span>
                              </div>
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '1rem', lineHeight: '1.5' }}>
                                Este é o intervalo fixo entre o início de um cliente e o próximo.
                              </p>
                            </div>
                          </div>

                          {/* Card: Almoço */}
                          <div className="glass-card" style={{ padding: '2rem', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                              <div style={{ color: '#f59e0b' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>
                              </div>
                              <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Intervalo de Almoço</h4>
                            </div>
                            <div className="form-group">
                              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <input 
                                  type="time" 
                                  className="premium-input"
                                  key={`${tenant.id}-${tenant.lunchStart}-start`}
                                  defaultValue={tenant.lunchStart || '12:00'}
                                  onBlur={e => {
                                    if (e.target.value >= (tenant.lunchEnd || '13:00')) {
                                      e.currentTarget.value = tenant.lunchStart || '12:00';
                                      showToast('O início do intervalo precisa ser antes do fim.', 'warning');
                                      return;
                                    }
                                    if (e.target.value !== tenant.lunchStart) void updateSchedulingSettings('lunch_start', e.target.value);
                                  }}
                                  style={{ flex: 1, fontWeight: 600 }}
                                />
                                <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>às</span>
                                <input 
                                  type="time" 
                                  className="premium-input"
                                  key={`${tenant.id}-${tenant.lunchEnd}-end`}
                                  defaultValue={tenant.lunchEnd || '13:00'}
                                  onBlur={e => {
                                    if (e.target.value <= (tenant.lunchStart || '12:00')) {
                                      e.currentTarget.value = tenant.lunchEnd || '13:00';
                                      showToast('O fim do intervalo precisa ser depois do início.', 'warning');
                                      return;
                                    }
                                    if (e.target.value !== tenant.lunchEnd) void updateSchedulingSettings('lunch_end', e.target.value);
                                  }}
                                  style={{ flex: 1, fontWeight: 600 }}
                                />
                              </div>
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '1rem', lineHeight: '1.5' }}>
                                O sistema bloqueará automaticamente qualquer agendamento neste período.
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Weekly Schedule Section */}
                        <div className="premium-card admin-schedule-section">
                          <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                            <div>
                              <h4 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>Horário de Expediente</h4>
                              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Selecione os dias e defina os horários de abertura e fechamento.</p>
                            </div>
                          </div>

                          <div className="admin-schedule-grid">
                            {['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'].map((dayName, idx) => {
                              const dayNum = idx === 6 ? 0 : idx + 1;
                              const wh = tenant.workingHours?.find(h => h.day === dayNum);
                              const isWorking = !!wh;
                              
                              return (
                                <div key={dayNum} className={`schedule-row admin-schedule-row ${isWorking ? 'active' : 'inactive'}`}
                                  style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'space-between',
                                    padding: '1.25rem 2rem', 
                                    background: isWorking ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)', 
                                    borderRadius: '16px', 
                                    border: '1px solid', 
                                    borderColor: isWorking ? 'rgba(var(--accent-primary-rgb), 0.2)' : 'rgba(255,255,255,0.03)',
                                    transition: 'all 0.3s ease',
                                    flexWrap: 'wrap',
                                    gap: '1.5rem'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', minWidth: '160px' }}>
                                    <label className="switch">
                                      <input 
                                        type="checkbox" 
                                        aria-label={`${isWorking ? 'Desativar' : 'Ativar'} expediente de ${dayName}`}
                                        checked={isWorking} 
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            updateWorkingHours([...(tenant.workingHours || []), { day: dayNum, start: '08:00', end: '18:00' }].sort((a,b) => a.day - b.day));
                                          } else {
                                            updateWorkingHours((tenant.workingHours || []).filter(h => h.day !== dayNum));
                                          }
                                        }} 
                                      />
                                      <span className="slider round"></span>
                                    </label>
                                    <span style={{ fontWeight: isWorking ? 800 : 500, fontSize: '1rem', color: isWorking ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{dayName}</span>
                                  </div>

                                  {isWorking && wh ? (
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexGrow: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                      <div className="admin-time-range">
                                        <input type="time" className="time-input-minimal" value={wh.start} onChange={e => updateWorkingHours((tenant.workingHours || []).map(h => h.day === dayNum ? { ...h, start: e.target.value } : h))} />
                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 800, letterSpacing: '1px', opacity: 0.6 }}>ATÉ</span>
                                        <input type="time" className="time-input-minimal" value={wh.end} onChange={e => updateWorkingHours((tenant.workingHours || []).map(h => h.day === dayNum ? { ...h, end: e.target.value } : h))} />
                                      </div>
                                      
                                      <button 
                                        className="btn-minimal"
                                        onClick={() => {
                                          const newHours = (tenant.workingHours || []).map(h => ({ ...h, start: wh.start, end: wh.end }));
                                          updateWorkingHours(newHours);
                                          showToast('Horário aplicado a todos os dias ativos!', 'success');
                                        }}
                                        title="Aplicar este horário a todos os dias marcados"
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 2.1l4 4-4 4"/><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8M7 21.9l-4-4 4-4"/><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2"/></svg>
                                        Aplicar a todos
                                      </button>
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', opacity: 0.6 }}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                                      Fechado para atendimentos
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

              ) : activeTab === 'atendimento' ? (
                <div className="admin-dashboard-container admin-module">
                  <div className="admin-stats-row admin-hero-stats">
                    <div className="admin-stat-card admin-kpi-card is-accent">
                      <div className="admin-kpi-icon"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6"/></svg></div>
                      <div><span className="stat-label">Concluídos hoje</span><span className="stat-value">{completedCount}</span><small>Atendimentos finalizados</small></div>
                    </div>
                    <div className="admin-stat-card admin-kpi-card">
                      <div className="admin-kpi-icon"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
                      <div><span className="stat-label">{tenant.bookingType === 'appointment' ? 'Aguardando confirmação' : 'Aguardando agora'}</span><span className="stat-value">{tenant.bookingType === 'appointment' ? pendingCount : waitingCount}</span><small>{tenant.bookingType === 'appointment' ? 'Solicitações para hoje' : 'Pessoas na fila atual'}</small></div>
                    </div>
                    <div className="admin-stat-card admin-kpi-card">
                      <div className="admin-kpi-icon"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
                      <div><span className="stat-label">Atendendo agora</span><span className="stat-value">{servingCount}</span><small>{servingCount ? 'Atendimento em andamento' : 'Nenhum atendimento iniciado'}</small></div>
                    </div>
                  </div>
                  <div className="admin-queue-list-section">
                    <div className="section-header admin-module-heading">
                      <div><span className="admin-eyebrow">Fluxo do atendimento</span><h2 className="admin-module-title">{tenant.bookingType === 'queue' ? 'Fila atual' : 'Compromissos confirmados'}</h2><p className="admin-module-copy">Use a ação principal de cada cartão para conduzir o próximo passo.</p></div>
                      <div className="live-indicator"><span className="live-dot"></span>AO VIVO</div>
                    </div>
                    <div className="admin-queue-list">
                      {activeTodayQueue.length === 0 ? (
                        <div className="empty-state" style={{ padding: '4rem', textAlign: 'center', borderRadius: '20px', border: '2px dashed rgba(0,0,0,0.05)' }}>
                          <p style={{ color: '#64748b', fontWeight: 500 }}>Nenhum atendimento confirmado para hoje.</p>
                        </div>
                      ) : activeTodayQueue.map((item, index) => (
                        <div key={item.id} className={`admin-queue-item ${item.status}`}>
                          <div className="item-pos">{tenant.bookingType === 'appointment' && item.appointmentTime ? formatTimeISO(item.appointmentTime) : `${index + 1}º`}</div>
                          <div className="item-main">
                            <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {item.name}
                              {item.isOnWay && <span style={{ fontSize: '0.7rem', background: 'var(--accent-primary)', color: 'var(--accent-secondary)', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>🚗 A CAMINHO</span>}
                            </h4>
                            <span className="item-service">{item.serviceName} {item.appointmentTime ? `• 🕒 ${formatTimeISO(item.appointmentTime)}` : ''}</span>
                            {item.status === 'serving' && item.startedAt && <TimeElapsed startedAt={item.startedAt} />}
                          </div>
                          <div className="item-actions">
                            {item.status === 'pending' ? (
                              <>
                                <button disabled={Boolean(activeQueueActionId)} onClick={() => handleApproveAppointment(item.id)} className="action-btn approve">Confirmar</button>
                                <button disabled={Boolean(activeQueueActionId)} onClick={() => handleRejectAppointment(item)} className="action-btn reject">Recusar</button>
                              </>
                            ) : item.status === 'serving' ? (
                              <button disabled={Boolean(activeQueueActionId)} onClick={() => handleCompleteService(item.id)} className="action-btn complete" style={{ background: '#10b981', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '10px', fontWeight: 700, fontSize: '0.85rem' }}>
                                {activeQueueActionId === item.id ? 'Concluindo…' : 'Concluir'}
                              </button>
                            ) : (
                              <>
                                <button 
                                  onClick={() => handleCallClient(item.id)} 
                                  disabled={Boolean(activeQueueActionId) || item.status === 'ready'}
                                  className="action-btn call" 
                                  style={{ background: item.status === 'ready' ? '#f1f5f9' : 'var(--accent-primary)', color: item.status === 'ready' ? '#64748b' : 'var(--accent-secondary)', border: 'none', padding: '10px 16px', borderRadius: '10px', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}
                                >
                                  {item.status === 'ready' ? 'Chamado ✓' : 'Chamar'}
                                </button>
                                <button 
                                  onClick={() => handleStartService(item.id)} 
                                  disabled={Boolean(activeQueueActionId)}
                                  className="action-btn start" 
                                  style={{ background: '#0f172a', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: '10px', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}
                                >
                                  Atender
                                </button>
                              </>
                            )}
                          </div>
                          <button onClick={() => handleRemoveFromQueue(item)} className="btn-action-remove" aria-label={`Remover ${item.name} do atendimento`}>✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : activeTab === 'agenda' ? (
                <div className="admin-dashboard-container admin-module fade-in">
                  <div className="agenda-view-wrapper">
                    <div className="section-header admin-module-heading">
                      <div className="admin-agenda-heading">
                        <div>
                          <span className="admin-eyebrow">Visão diária</span>
                          <h2 className="admin-module-title">Cronograma de agendamentos</h2>
                          <p className="admin-module-copy">Gerencie reservas e solicitações da data selecionada.</p>
                        </div>
                        
                        {/* Integrated Date Picker Filter */}
                        <div className="agenda-date-filter admin-agenda-toolbar">
                          <button type="button" className="admin-icon-button" onClick={() => changeAdminDateBy(-1)} aria-label="Dia anterior"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg></button>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                          <span>Data</span>
                          <input 
                            type="date" 
                            value={adminSelectedDate}
                            onChange={(e) => {
                              setAdminSelectedDate(e.target.value);
                              setSelectedDate(e.target.value);
                            }}
                            style={{ 
                              background: 'transparent', 
                              border: 'none', 
                              color: 'var(--text-primary)', 
                              fontSize: '0.9rem', 
                              fontWeight: 800, 
                              cursor: 'pointer',
                              outline: 'none',
                              padding: '4px'
                            }}
                          />
                          {adminSelectedDate !== todayStr && (
                            <button 
                              type="button"
                              onClick={() => {
                                setAdminSelectedDate(todayStr);
                                setSelectedDate(todayStr);
                              }}
                              style={{ background: 'rgba(var(--accent-primary-rgb), 0.1)', color: 'var(--accent-primary)', border: 'none', padding: '4px 10px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 900, cursor: 'pointer' }}
                            >
                              HOJE
                            </button>
                          )}
                          <button type="button" className="admin-icon-button" onClick={() => changeAdminDateBy(1)} aria-label="Próximo dia"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg></button>
                        </div>
                      </div>
                      <div className="agenda-stats" style={{ display: 'flex', gap: '1.5rem' }}>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Nesta data</span>
                          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-primary)' }}>{filteredAgenda.length}</span>
                        </div>
                      </div>
                    </div>

                    {filteredAgenda.length === 0 ? (
                      <div className="premium-empty-state" style={{ padding: '8rem 2rem', textAlign: 'center', borderRadius: '32px', background: 'rgba(255,255,255,0.01)', border: '2px dashed rgba(255,255,255,0.05)' }}>
                        <div style={{ width: '100px', height: '100px', background: 'linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.1), transparent)', borderRadius: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" opacity="0.8"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        </div>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.75rem' }}>Agenda livre para este dia</h3>
                        <p style={{ color: 'var(--text-secondary)', maxWidth: '350px', margin: '0 auto 2rem', fontSize: '1rem', lineHeight: '1.6' }}>Não há compromissos marcados para {adminSelectedDate === todayStr ? 'hoje' : 'esta data'}.</p>
                        {adminSelectedDate >= todayStr && (
                          <button
                            onClick={openAdminAddModal}
                            className="btn-submit"
                            style={{ width: 'auto', padding: '0 32px', height: '52px', borderRadius: '16px' }}
                          >
                            + Novo Agendamento
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="agenda-timeline" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '3.5rem' }}>
                        {/* Timeline vertical line */}
                        <div style={{ position: 'absolute', left: '26px', top: '10px', bottom: '10px', width: '2px', background: 'linear-gradient(to bottom, rgba(var(--accent-primary-rgb), 0.2), transparent)', zIndex: 0 }}></div>

                        <div className="agenda-day-group" style={{ position: 'relative', zIndex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '1.5rem' }}>
                            <div style={{ 
                              width: '54px', 
                              height: '54px', 
                              background: adminSelectedDate === todayStr ? 'var(--accent-primary)' : 'var(--bg-surface)', 
                              color: adminSelectedDate === todayStr ? 'var(--accent-secondary)' : 'var(--text-primary)',
                              borderRadius: '18px', 
                              display: 'flex', 
                              flexDirection: 'column', 
                              alignItems: 'center', 
                              justifyContent: 'center',
                              boxShadow: '0 8px 16px rgba(0,0,0,0.1)',
                              border: '1px solid rgba(255,255,255,0.05)'
                            }}>
                              <span style={{ fontSize: '0.7rem', fontWeight: 800, opacity: 0.8, textTransform: 'uppercase' }}>
                                {new Date(adminSelectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
                              </span>
                              <span style={{ fontSize: '1.25rem', fontWeight: 900, lineHeight: 1 }}>
                                {new Date(adminSelectedDate + 'T12:00:00').getDate()}
                              </span>
                            </div>
                            <div>
                              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'capitalize' }}>
                                {new Date(adminSelectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' })}
                              </h3>
                              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, opacity: 0.6 }}>
                                {filteredAgenda.length} {filteredAgenda.length === 1 ? 'atendimento' : 'atendimentos'} agendados
                              </p>
                            </div>
                          </div>

                          <div className="admin-agenda-grid" style={{ paddingLeft: '74px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.25rem' }}>
                            {filteredAgenda.map(item => (
                              <div key={item.id} className="premium-agenda-card admin-agenda-card" style={{
                                padding: '1.5rem', 
                                background: 'var(--bg-surface)', 
                                borderRadius: '24px', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '1.25rem', 
                                border: '1px solid rgba(255,255,255,0.03)',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                position: 'relative',
                                overflow: 'hidden'
                              }}>
                                {/* Status indicator bar */}
                                <div style={{ 
                                  position: 'absolute', 
                                  left: 0, 
                                  top: 0, 
                                  bottom: 0, 
                                  width: '4px', 
                                  background: item.status === 'pending' ? '#f59e0b' : 'var(--accent-primary)' 
                                }}></div>

                                <div style={{ 
                                  width: '64px', 
                                  height: '64px', 
                                  background: 'rgba(255,255,255,0.02)', 
                                  borderRadius: '16px', 
                                  display: 'flex', 
                                  flexDirection: 'column', 
                                  alignItems: 'center', 
                                  justifyContent: 'center', 
                                  flexShrink: 0,
                                  border: '1px solid rgba(255,255,255,0.05)'
                                }}>
                                  <span style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                                    {item.appointmentTime ? formatTimeISO(item.appointmentTime) : '--:--'}
                                  </span>
                                </div>

                                <div style={{ flexGrow: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <h4 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</h4>
                                    {item.status === 'pending' && (
                                      <span className="pulse-badge" style={{ fontSize: '0.6rem', background: '#f59e0b', color: '#fff', padding: '3px 8px', borderRadius: '6px', fontWeight: 900, letterSpacing: '0.5px' }}>SOLICITAÇÃO</span>
                                    )}
                                  </div>
                                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0, opacity: 0.8, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontWeight: 600 }}>{item.serviceName}</span>
                                    <span style={{ opacity: 0.4 }}>•</span>
                                    <span>{item.duration || 30} min</span>
                                  </p>
                                </div>

                                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                                  {item.status === 'pending' ? (
                                    <>
                                      <button 
                                        onClick={() => handleApproveAppointment(item.id)}
                                        disabled={Boolean(activeQueueActionId)}
                                        className="approve-btn"
                                        aria-label={`Confirmar agendamento de ${item.name}`}
                                        style={{ 
                                          width: '40px', 
                                          height: '40px', 
                                          background: '#10b981', 
                                          color: '#fff', 
                                          border: 'none', 
                                          borderRadius: '12px', 
                                          cursor: 'pointer', 
                                          display: 'flex', 
                                          alignItems: 'center', 
                                          justifyContent: 'center',
                                          transition: 'transform 0.2s'
                                        }}
                                      >
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        <span>Confirmar</span>
                                      </button>
                                      <button 
                                        onClick={() => handleRejectAppointment(item)}
                                        disabled={Boolean(activeQueueActionId)}
                                        className="reject-btn"
                                        aria-label={`Recusar agendamento de ${item.name}`}
                                        style={{ 
                                          width: '40px', 
                                          height: '40px', 
                                          background: 'rgba(239, 68, 68, 0.1)', 
                                          color: '#ef4444', 
                                          border: 'none', 
                                          borderRadius: '12px', 
                                          cursor: 'pointer', 
                                          display: 'flex', 
                                          alignItems: 'center', 
                                          justifyContent: 'center',
                                          transition: 'transform 0.2s'
                                        }}
                                      >
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        <span>Recusar</span>
                                      </button>
                                    </>
                                  ) : (
                                    <button 
                                      onClick={() => handleRemoveFromQueue(item)}
                                      style={{ 
                                        width: '40px', 
                                        height: '40px', 
                                        background: 'rgba(255,255,255,0.03)', 
                                        color: '#ef4444', 
                                        border: 'none', 
                                        borderRadius: '12px', 
                                        cursor: 'pointer', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'center',
                                        opacity: 0.4
                                      }}
                                    >
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

            </div>
          </main>
        </div>
      ) : (
        /* CLIENT VIEW */
        <div className="app-container customer-app fade-in" style={customerThemeStyle}>
          <header className="customer-topbar">
            <div className="customer-platform-brand">
              <BrandMark className="customer-platform-mark" />
              <div>
                <strong>Sua Vez</strong>
                <span>Experiência digital</span>
              </div>
            </div>
            <div className="customer-topbar-actions">
              <span className="customer-topbar-note">Seu atendimento, no seu tempo</span>
              <button onClick={toggleRole} className="btn-role" aria-label="Acessar área profissional">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                <span className="customer-role-label"><span className="customer-role-label-prefix">Área </span>profissional</span>
              </button>
            </div>
          </header>

          {/* Hero Section */}
          <section className="hero-section customer-hero fade-in">
            <div className="hero-background-glow"></div>
            <div className="customer-hero-pattern" aria-hidden="true"></div>
            <div className="hero-content">
              <div className="hero-brand">
                <div className={`hero-logo-container ${tenant.hasLogo && tenant.logoUrl ? 'has-custom-logo' : 'has-profession-icon'}`}>
                  {tenant.hasLogo && tenant.logoUrl ? (
                    <img 
                      src={tenant.logoUrl} 
                      alt={`${tenant.name} Logo`} 
                      className="hero-logo-img"
                    />
                  ) : (
                    <div className="hero-logo-icon">
                      <ProfessionIcon profession={tenant.profession} className="profession-icon profession-icon--hero" />
                    </div>
                  )}
                </div>
                <div className="hero-text">
                  <span className="customer-hero-kicker">
                    {tenant.bookingType === 'appointment' ? 'Agenda online' : 'Fila virtual'}
                  </span>
                  <h1 className="hero-title">{tenant.name}</h1>
                  <p className="hero-subtitle">
                    {tenant.bookingType === 'appointment' 
                      ? `Agende seu horário com os melhores profissionais de ${prof.label.toLowerCase()}.` 
                      : `Entre na fila virtual e economize tempo esperando de onde quiser.`}
                  </p>
                </div>
              </div>

              <div className="hero-stats">
                 <div className="client-hero-actions">
                   <div className="customer-hero-promise">
                     <span className="customer-promise-icon">
                       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                     </span>
                     <span>
                       <strong>{tenant.bookingType === 'appointment' ? 'Seu horário, sem complicação' : 'Espere de onde quiser'}</strong>
                       <small>{tenant.bookingType === 'appointment' ? 'Escolha o melhor momento para você.' : 'Acompanhe sua posição em tempo real.'}</small>
                     </span>
                   </div>
                   {myItemsInQueue.length === 0 && (tenant.bookingType === 'appointment' || tenant.isOnline) && (
                     <button 
                       onClick={openCustomerJoin}
                       className="hero-cta-button"
                     >
                       {tenant.bookingType === 'appointment' ? 'Agendar Agora' : 'Garantir meu Lugar'}
                     </button>
                   )}
                   {products.length > 0 && (
                     <button
                       onClick={() => setShowStoreModal(true)}
                       className="customer-store-button"
                     >
                       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                       Acessar a Loja
                     </button>
                   )}
                   <div className={`hero-online-badge ${tenant.bookingType === 'appointment' || tenant.isOnline ? 'online' : 'offline'}`}>
                     <span className="pulse-dot"></span>
                     {tenant.bookingType === 'appointment' ? 'Agenda online' : (tenant.isOnline ? 'Aberto agora' : 'Fechado no momento')}
                   </div>
                 </div>
              </div>
            </div>
          </section>

          {/* Client Content */}
          <div className="status-summary-container customer-status-grid fade-in">
            <div className="status-summary-card serving">
              <div className="customer-status-copy">
                <span className="customer-status-eyebrow">{tenant.bookingType === 'appointment' ? 'Na data escolhida' : 'Movimento agora'}</span>
                <div className="status-info">
                  <span className="status-value">{tenant.bookingType === 'appointment' ? (selectedService ? availableTimeSlots.length : '—') : servingCount}</span>
                  <span className="status-label">{tenant.bookingType === 'appointment' ? 'Horários livres' : 'Em atendimento'}</span>
                </div>
              </div>
              <span className="customer-status-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 7V3m8 4V3M5 10h14"/><rect x="4" y="5" width="16" height="15" rx="3"/><path d="m9 15 2 2 4-5"/></svg>
              </span>
            </div>
            <div className="status-summary-card waiting">
              <div className="customer-status-copy">
                <span className="customer-status-eyebrow">{tenant.bookingType === 'appointment' ? 'Agenda do dia' : 'Próximos da vez'}</span>
                <div className="status-info">
                  <span className="status-value">{tenant.bookingType === 'appointment' ? selectedDayAppointments.length : waitingCount}</span>
                  <span className="status-label">{tenant.bookingType === 'appointment' ? 'Reservas' : 'Na espera'}</span>
                </div>
              </div>
              <span className="customer-status-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6m3-3h-6"/></svg>
              </span>
            </div>
          </div>

          {showMobileJoinModal && (
            <button
              type="button"
              className="mobile-join-backdrop"
              onClick={() => setShowMobileJoinModal(false)}
              aria-label="Fechar formulário"
            />
          )}

          <main className="main-content customer-main-content">
            {/* Form Section */}
            <section
              className={`form-panel glass-panel customer-form-panel ${showMobileJoinModal ? 'mobile-join-modal is-open' : ''} ${myItemsInQueue.length > 0 && !forceShowJoinForm ? 'has-active-presence' : ''}`}
              role={showMobileJoinModal ? 'dialog' : undefined}
              aria-modal={showMobileJoinModal ? true : undefined}
              aria-label={showMobileJoinModal ? (tenant.bookingType === 'appointment' ? 'Fazer agendamento' : 'Entrar na fila') : undefined}
            >
              <button
                type="button"
                className="mobile-join-close"
                onClick={() => setShowMobileJoinModal(false)}
                aria-label="Fechar formulário"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18"/></svg>
              </button>
              {tenant.bookingType === 'queue' && !tenant.isOnline ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                  <div style={{ width: '64px', height: '64px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                  </div>
                  <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Loja Fechada</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Volte em nosso horário de funcionamento!</p>
                </div>
              ) : (myItemsInQueue.length > 0 && !forceShowJoinForm) ? (
                <div className="active-presence-container fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <h2 style={{ marginBottom: '1.5rem', textAlign: 'center', color: 'var(--text-primary)' }}>Presenças Confirmadas ({myItemsInQueue.length})</h2>
                  
                  {myItemsInQueue.map(item => (
                    <div key={item.id} className="active-presence-card" style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <div style={{ flex: 1 }}>
                          <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)' }}>{item.name}</h3>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{item.serviceName}</span>
                        </div>
                        <span className={`status-badge ${item.status}`} style={{ fontSize: '0.7rem' }}>
                          {item.status === 'serving' ? 'Atendendo' : item.status === 'ready' ? 'Sua Vez!' : (tenant.bookingType === 'appointment' ? (item.status === 'pending' ? 'Pendente' : 'Confirmado') : 'Na Fila')}
                        </span>
                      </div>

                      <div className="my-status-monitor fade-in" style={{ marginBottom: '1rem' }}>
                        <div className="monitor-glow"></div>
                        <div className="monitor-content">
                          <p className="monitor-label">{item.status === 'serving' ? 'Status Atual' : 'Posição Atual'}</p>
                          <div className="monitor-value">
                            {item.status === 'serving' 
                              ? <span style={{ fontSize: '2.5rem' }}>VOCÊ</span> 
                              : `${todayQueue.findIndex(q => q.id === item.id) + 1}º`}
                          </div>
                          <p className="monitor-subtext">
                            {item.status === 'serving' 
                              ? 'Você está em atendimento agora!' 
                              : todayQueue.findIndex(q => q.id === item.id) === 0 
                                ? 'Próximo da fila!' 
                                : 'Aguarde sua vez'}
                          </p>
                        </div>
                        <div className="monitor-footer">
                          <div className="live-indicator"><span className="live-dot"></span>AO VIVO</div>
                          <div 
                            onClick={() => void enableNotifications()}
                            style={{ 
                              fontSize: '0.65rem', 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: '4px', 
                              color: notifsEnabled ? 'var(--accent-primary)' : '#ef4444',
                              cursor: 'pointer',
                              fontWeight: 600
                            }}
                          >
                            <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor' }}></div>
                            {notifsEnabled ? 'NOTIFICAÇÕES ATIVAS' : 'NOTIFICAÇÕES DESATIVADAS'}
                          </div>
                        </div>
                      </div>

                      {(() => {
                        const waitingItems = queue.filter(q => q.status === 'waiting');
                        const myWaitIndex = waitingItems.findIndex(q => q.id === item.id);
                        
                        if (myWaitIndex >= 0 && myWaitIndex < 2) {
                          if (item.isOnWay) {
                            return (
                              <div className="fade-in" style={{ padding: '12px', background: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 22%, transparent)', color: 'var(--accent-primary)', borderRadius: '12px', textAlign: 'center', fontWeight: 600, fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                                Profissional avisado!
                              </div>
                            );
                          } else if (item.status === 'waiting') {
                            return (
                              <button 
                                onClick={() => handleConfirmOnWay(item.id)} 
                                className="btn-submit" 
                                disabled={loading}
                                style={{ width: '100%', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#3b82f6', color: '#fff', fontSize: '0.85rem' }}
                              >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 22h14"></path><path d="m5 12 7-7 7 7"></path><path d="M12 15v7"></path></svg>
                                Estou a caminho
                              </button>
                            );
                          }
                        }
                        return null;
                      })()}

                      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
                        {item.status !== 'serving' && (
                          <button 
                            onClick={() => { setItemForCancel(item); setShowLeaveModal(true); }} 
                            className="btn-secondary"
                            style={{ flex: 1, height: '44px', fontSize: '0.85rem' }}
                          >
                            Remover
                          </button>
                        )}
                        <button 
                          onClick={() => window.open(`https://wa.me/${tenant.whatsapp?.replace(/\D/g, '')}`)} 
                          className="hero-cta-button" 
                          style={{ flex: 1, height: '44px', fontSize: '0.85rem', background: '#25D366' }}
                        >
                          WhatsApp
                        </button>
                      </div>
                    </div>
                  ))}

                  {myItemsInQueue.length < 4 ? (
                    <button 
                      onClick={() => {
                        openCustomerJoin();
                        setName('');
                        setCustomerWhatsapp('');
                      }} 
                      className="btn-submit"
                      style={{ background: 'var(--accent-primary)', color: 'var(--accent-secondary)', marginTop: '1rem' }}
                    >
                      + Adicionar Outra Pessoa (Acompanhante)
                    </button>
                  ) : (
                    <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.1)', textAlign: 'center', color: '#ef4444', fontSize: '0.85rem', fontWeight: 600 }}>
                      ⚠️ Limite máximo de 3 acompanhantes atingido.
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={handleJoinQueue} className="join-form customer-join-form">
                   <div className="customer-form-heading">
                    <div className="customer-form-icon">
                      {tenant.bookingType === 'appointment' ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M8 3v3m8-3v3M4 9h16"/><rect x="3" y="5" width="18" height="16" rx="4"/><path d="m9 15 2 2 4-5"/></svg>
                      ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>
                      )}
                    </div>
                    <div>
                      <span>{tenant.bookingType === 'appointment' ? 'Agendamento online' : 'Vamos começar'}</span>
                      <h2>{tenant.bookingType === 'appointment' ? 'Agende seu horário' : 'Garanta seu lugar'}</h2>
                      <p>{tenant.bookingType === 'appointment' ? 'Escolha o serviço, o dia e o melhor horário para você.' : 'É rápido e leva menos de um minuto.'}</p>
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="customer-name">Seu nome</label>
                    <div className="customer-input-shell">
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
                      <input id="customer-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Como podemos chamar você?" required />
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="customer-whatsapp">WhatsApp</label>
                    <div className="customer-input-shell">
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-4-.9l-5 1 1.1-4.8a8.7 8.7 0 1 1 16.9-3.7Z"/><path d="M8.5 8.4c.7 3 2.1 4.4 5.1 5.1"/></svg>
                      <input id="customer-whatsapp" type="tel" value={customerWhatsapp} onChange={handlePhoneChange} placeholder="(00) 90000-0000" required />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Serviço</label>
                    <div className="service-selector-simple">
                      <button 
                        type="button" 
                        className={`selector-trigger ${isServiceListOpen ? 'open' : ''}`}
                        onClick={() => setIsServiceListOpen(!isServiceListOpen)}
                        aria-expanded={isServiceListOpen}
                        aria-haspopup="listbox"
                      >
                        <span className="selector-trigger-copy">
                          <strong>{selectedService?.name || 'Selecione um serviço'}</strong>
                          <small>{selectedService ? `${selectedService.duration || 30} min · R$ ${selectedService.price.toFixed(2).replace('.', ',')}` : 'Veja duração e valor antes de continuar'}</small>
                        </span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                      </button>
                      
                      {isServiceListOpen && (
                        <div className="simple-vertical-list fade-in" role="listbox" aria-label="Serviços disponíveis">
                          {tenant.services.map(s => (
                            <button 
                              key={s.id} 
                              type="button" 
                              className={`simple-list-item ${selectedServiceId === s.id ? 'active' : ''}`}
                              role="option"
                              aria-selected={selectedServiceId === s.id}
                              onClick={() => {
                                setSelectedServiceId(s.id);
                                setSelectedTimeSlot('');
                                setIsServiceListOpen(false);
                              }}
                            >
                              <span className="svc-copy">
                                <span className="svc-name">{s.name}</span>
                                <small>{s.duration || 30} minutos</small>
                              </span>
                              <span className="svc-price">R$ {s.price.toFixed(2).replace('.', ',')}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {tenant.bookingType === 'appointment' && (
                    <div className="fade-in customer-schedule-fields">
                      <div className="appointment-step">
                        <div className="appointment-step-heading">
                          <span className="appointment-step-number">1</span>
                          <span>
                            <strong>Escolha o dia</strong>
                            <small>Você pode agendar a partir de hoje</small>
                          </span>
                        </div>
                        <label className="appointment-date-control" htmlFor="appointment-date">
                          <span className="appointment-control-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M8 3v3m8-3v3M4 9h16"/><rect x="3" y="5" width="18" height="16" rx="4"/></svg>
                          </span>
                          <span className="appointment-date-copy">
                            <small>Data do atendimento</small>
                            <input
                              id="appointment-date"
                              type="date"
                              value={selectedDate}
                              min={todayStr}
                              onChange={(e) => {
                                setSelectedDate(e.target.value);
                                setSelectedTimeSlot('');
                              }}
                              required
                            />
                          </span>
                        </label>
                      </div>
                      <div className="appointment-step">
                        <div className="appointment-step-heading">
                          <span className="appointment-step-number">2</span>
                          <span>
                            <strong>Escolha o horário</strong>
                            <small>{selectedService ? `${availableTimeSlots.length} opções disponíveis` : 'Selecione primeiro um serviço'}</small>
                          </span>
                        </div>
                        {!selectedService ? (
                          <div className="appointment-slot-message">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 8v4m0 4h.01"/><circle cx="12" cy="12" r="9"/></svg>
                            Escolha um serviço para ver os horários exatos.
                          </div>
                        ) : availableTimeSlots.length > 0 ? (
                          <div className="appointment-time-grid" role="group" aria-label="Horários disponíveis">
                            {availableTimeSlots.map(slot => (
                              <button
                                key={slot}
                                type="button"
                                className={`appointment-time-slot ${selectedTimeSlot === slot ? 'selected' : ''}`}
                                onClick={() => setSelectedTimeSlot(slot)}
                                aria-pressed={selectedTimeSlot === slot}
                              >
                                {slot}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="appointment-slot-message unavailable">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>
                            Não há horários livres neste dia. Tente outra data.
                          </div>
                        )}
                      </div>
                      {selectedService && selectedTimeSlot && (
                        <div className="appointment-selection-summary" aria-live="polite">
                          <span className="appointment-summary-check">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m5 12 4 4L19 6"/></svg>
                          </span>
                          <span>
                            <small>Seu agendamento</small>
                            <strong>{selectedService.name} · {new Date(`${selectedDate}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} às {selectedTimeSlot}</strong>
                          </span>
                          <b>R$ {selectedService.price.toFixed(2).replace('.', ',')}</b>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Notification Recommendation (Non-blocking) */}
                  {import.meta.env.PROD && !notifsEnabled && (
                    <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'rgba(var(--accent-primary-rgb), 0.05)', borderRadius: '16px', border: '1px solid rgba(var(--accent-primary-rgb), 0.1)', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center', marginBottom: '0.75rem', color: 'var(--accent-primary)' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Ative as Notificações</span>
                      </div>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: '1.4' }}>
                        Para receber avisos em tempo real e não perder sua vez, recomendamos ativar as notificações abaixo.
                      </p>
                      <button 
                        type="button" 
                        onClick={() => void enableNotifications()}
                        className="btn-secondary" 
                        style={{ width: '100%', fontSize: '0.85rem', padding: '10px', background: 'white' }}
                      >
                        Ativar Agora
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="btn-submit customer-submit-button"
                    style={{ marginTop: '1.5rem' }}
                    disabled={loading || !selectedServiceId || (tenant.bookingType === 'appointment' && !selectedTimeSlot)}
                  >
                    {loading
                      ? 'Aguarde...'
                      : tenant.bookingType === 'appointment'
                        ? (selectedTimeSlot ? 'Confirmar agendamento' : 'Escolha um horário')
                        : 'Entrar na fila agora'}
                    {!loading && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>}
                  </button>
                  <p className="customer-form-assurance">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
                    Seus dados são usados somente neste atendimento.
                  </p>
                  
                  {myItemsInQueue.length > 0 && (
                    <button 
                      type="button" 
                      onClick={() => {
                        setForceShowJoinForm(false);
                        setShowMobileJoinModal(false);
                      }}
                      className="btn-secondary"
                      style={{ width: '100%', marginTop: '0.75rem' }}
                    >
                      Voltar para meus agendamentos
                    </button>
                  )}
                </form>
              )}
            </section>

            {/* Queue Section */}
            <section className="queue-panel customer-queue-panel">
               <div className="queue-header customer-queue-header">
                 <div className="customer-queue-header-inner">
                   <div className="customer-queue-heading-copy">
                     <span className="customer-section-kicker">Atualização em tempo real</span>
                     <h2 style={{ margin: '0 0 6px 0' }}>{tenant.bookingType === 'appointment' ? 'Agenda do dia' : 'Acompanhe a Fila'}</h2>
                    <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', margin: 0, opacity: 0.9, lineHeight: '1.5' }}>
                      {tenant.bookingType === 'appointment' 
                        ? 'Consulte os horários já reservados sem expor os dados de outros clientes.'
                        : 'Veja a ordem dos clientes na fila de atendimento para hoje.'}
                    </p>
                  </div>
                  {tenant.bookingType === 'appointment' && (
                    <div className="client-date-filter" style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(var(--accent-primary-rgb), 0.05)', padding: '8px 16px', borderRadius: '16px', border: '1px solid rgba(var(--accent-primary-rgb), 0.1)', height: 'fit-content' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        <input
                          type="date"
                          value={selectedDate}
                          min={todayStr}
                          onChange={(e) => {
                            setSelectedDate(e.target.value);
                            setSelectedTimeSlot('');
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-primary)',
                            fontSize: '0.95rem',
                            fontWeight: 600,
                            outline: 'none',
                            cursor: 'pointer',
                            fontFamily: 'inherit'
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {(tenant.bookingType === 'appointment' || tenant.isOnline) && myItemsInQueue.length < 4 && (
                <div className="mobile-join-cta-wrap">
                  <button type="button" className="mobile-join-cta" onClick={openCustomerJoin}>
                    <span>
                      <small>{tenant.bookingType === 'appointment' ? 'Escolha dia e horário' : 'Atendimento por ordem de chegada'}</small>
                      <strong>{tenant.bookingType === 'appointment' ? 'Agendar meu horário' : 'Garantir meu lugar'}</strong>
                    </span>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                  </button>
                </div>
              )}
              <div className="queue-list" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {publicQueueItems.length > 0 ? (
                  <div className="client-day-group fade-in">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1.25rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--accent-primary)', textTransform: 'uppercase', background: 'rgba(var(--accent-primary-rgb), 0.1)', padding: '4px 10px', borderRadius: '8px' }}>
                        {tenant.bookingType === 'queue' ? 'Agora' : clientQueueDate === todayStr ? 'Hoje' : new Date(clientQueueDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                      </span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, opacity: 0.6 }}>
                        {tenant.bookingType === 'queue' ? 'Ordem de chegada em tempo real' : new Date(clientQueueDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' })}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {publicQueueItems.map((item, index) => (
                        <div key={item.id} className={`queue-item glass-card ${item.status}`} style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div className="customer-queue-time">
                            {tenant.bookingType === 'appointment' && item.appointmentTime ? formatTimeISO(item.appointmentTime) : `${index + 1}º`}
                          </div>
                          <div style={{ flexGrow: 1 }}>
                            <h4 className="customer-queue-name">
                              {tenant.bookingType === 'appointment' && !myQueueItemIds.includes(item.id) ? 'Horário reservado' : item.name}
                            </h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span className="customer-queue-service">
                                {tenant.bookingType === 'appointment' && !myQueueItemIds.includes(item.id) ? 'Indisponível para agendamento' : item.serviceName}
                              </span>
                              {(tenant.bookingType !== 'appointment' || myQueueItemIds.includes(item.id)) && (
                                <span className="customer-queue-duration">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                  Duração: {item.duration || 30} min
                                </span>
                              )}
                            </div>
                            {item.status === 'serving' && item.startedAt && <TimeElapsed startedAt={item.startedAt} />}
                          </div>
                          <span className={`status-badge ${item.status}`}>
                            {item.status === 'serving'
                              ? 'Atendendo'
                              : tenant.bookingType === 'appointment'
                                ? (myQueueItemIds.includes(item.id) ? (item.status === 'pending' ? 'Pendente' : 'Confirmado') : 'Reservado')
                                : 'Aguardando'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="premium-empty-state customer-empty-state">
                    <div className="customer-empty-icon">
                      {tenant.bookingType === 'appointment' ? (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                      ) : (
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.5"/><circle cx="11" cy="12" r="1.8"/><circle cx="17" cy="12" r="2.1"/><path d="M19 12h3m-2-2 2 2-2 2"/></svg>
                      )}
                    </div>
                    <span className="customer-empty-kicker">Tudo tranquilo por aqui</span>
                    <h3>{tenant.bookingType === 'appointment' ? 'Agenda livre para este dia' : 'A fila está livre agora'}</h3>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: '300px', margin: '0 auto', fontSize: '0.95rem', lineHeight: '1.5' }}>
                      {tenant.bookingType === 'appointment'
                        ? (selectedDate === todayStr ? 'Não há compromissos marcados para hoje.' : `Não há compromissos marcados para o dia ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR')}.`)
                        : 'Entre agora e seja uma das próximas pessoas a serem atendidas.'}
                    </p>
                    {(tenant.bookingType === 'appointment' || tenant.isOnline) && myItemsInQueue.length === 0 && (
                      <button type="button" className="customer-empty-cta" onClick={openCustomerJoin}>
                        {tenant.bookingType === 'appointment' ? 'Agendar agora' : 'Quero ser o primeiro'}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          </main>
        </div>
      )}


      {/* Confirmation Modal */}
      {showConfirmation && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal-content glass-panel fade-in" style={{ maxWidth: '400px', textAlign: 'center', background: 'var(--bg-surface)' }}>
            <div style={{ width: '64px', height: '64px', background: 'var(--accent-primary)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', color: 'var(--customer-on-accent, #fff)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Sucesso!</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>{tenant.bookingType === 'appointment' ? 'Seu horário foi agendado com sucesso.' : 'Seu lugar na fila foi reservado com sucesso.'}</p>
            <button onClick={() => setShowConfirmation(false)} className="btn-submit">Entendi</button>
          </div>
        </div>
      )}

      {/* Join Queue Confirmation Modal */}
      {showJoinConfirmation && (
        <div className="modal-overlay" style={{ zIndex: 10001 }}>
          <div className="modal-content glass-panel fade-in" style={{ maxWidth: '400px', textAlign: 'center', background: 'var(--bg-surface)' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Confirmar Presença</h3>
            <div style={{ background: 'rgba(var(--accent-primary-rgb), 0.05)', padding: '1.5rem', borderRadius: '16px', marginBottom: '1.5rem', border: '1px solid rgba(var(--accent-primary-rgb), 0.1)' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Você está solicitando:</p>
              <h4 style={{ fontSize: '1.2rem', color: 'var(--text-primary)', marginBottom: '4px' }}>
                {tenant.services.find(s => s.id === selectedServiceId)?.name}
              </h4>
              <p style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--accent-primary)' }}>
                R$ {tenant.services.find(s => s.id === selectedServiceId)?.price.toFixed(2).replace('.', ',')}
              </p>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.9rem' }}>
              {tenant.bookingType === 'appointment' ? 'Deseja confirmar este agendamento?' : 'Deseja entrar na fila agora?'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button 
                onClick={async () => {
                  setShowJoinConfirmation(false);
                  const pushId = import.meta.env.PROD ? await requestNotificationPermission() : null;
                  await confirmJoinQueue(pushId);
                }} 
                className="btn-submit"
              >
                Confirmar e Entrar
              </button>
              <button onClick={() => setShowJoinConfirmation(false)} className="btn-secondary">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Queue Confirmation Modal */}
      {showLeaveModal && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal-content glass-panel fade-in" style={{ maxWidth: '400px', textAlign: 'center', padding: '2.5rem' }}>
            <div style={{ width: '64px', height: '64px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', color: '#ef4444' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Remover {itemForCancel?.name}?</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.95rem', lineHeight: '1.5' }}>
              {tenant.bookingType === 'appointment' ? 'Este agendamento será cancelado e o horário ficará disponível para outros.' : 'Esta pessoa será removida da fila e perderá a posição atual.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button 
                onClick={() => handleCancelMyPlace(itemForCancel?.id || '')} 
                className="btn-submit" 
                style={{ background: '#ef4444', color: '#fff', border: 'none' }}
              >
                Sim, desejo remover
              </button>
              <button 
                onClick={() => { setShowLeaveModal(false); setItemForCancel(null); }} 
                className="btn-secondary" 
                style={{ border: '1px solid rgba(0,0,0,0.1)', width: '100%' }}
              >
                {tenant.bookingType === 'appointment' ? 'Manter agendamento' : 'Manter na fila'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Delete Confirmation Modal */}
      {showAdminDeleteModal && (
        <div className="modal-overlay" style={{ zIndex: 10005 }}>
          <div className="modal-content glass-panel admin-modal fade-in" role="alertdialog" aria-modal="true" aria-labelledby="admin-delete-title" style={{ maxWidth: '400px', textAlign: 'center', padding: '2.5rem' }}>
            <div style={{ width: '64px', height: '64px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', color: '#ef4444' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
            </div>
            <h3 id="admin-delete-title" style={{ fontSize: '1.5rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Remover cliente?</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.95rem', lineHeight: '1.5' }}>
              Você está prestes a remover <strong>{itemToDelete?.name}</strong> da fila. Esta ação não pode ser desfeita.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button 
                onClick={confirmAdminDelete} 
                className="btn-submit" 
                style={{ background: '#ef4444', color: '#fff', border: 'none' }}
              >
                Sim, remover da fila
              </button>
              <button 
                onClick={() => { setShowAdminDeleteModal(false); setItemToDelete(null); }} 
                className="btn-secondary" 
                style={{ border: '1px solid rgba(0,0,0,0.1)', width: '100%' }}
              >
                Manter cliente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Store Modal */}
      {showStoreModal && (
        <div className="modal-overlay" style={{ zIndex: 10000 }} onClick={() => setShowStoreModal(false)}>
          <div className="modal-content glass-panel fade-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '680px', width: '92%', background: 'var(--bg-surface)', padding: '2rem', borderRadius: '24px', border: '1px solid color-mix(in srgb, var(--accent-primary) 20%, rgba(0,0,0,0.08))', maxHeight: '88vh', overflowY: 'auto' }}>
            
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>🛍️ Loja de {tenant.name}</h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '4px 0 0' }}>Produtos usados e recomendados — clique para pedir via WhatsApp</p>
              </div>
              <button onClick={() => setShowStoreModal(false)} style={{ background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer', padding: '4px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            <div style={{ width: '100%', height: '3px', background: 'linear-gradient(90deg, var(--accent-primary), var(--text-primary))', borderRadius: '2px', marginBottom: '1.5rem' }}></div>

            {/* Product grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
              {products.map(p => {
                const waNumber = (tenant.whatsapp || '').replace(/\D/g, '');
                const waMsg = encodeURIComponent(`Olá ${tenant.name}! Vi sua loja e tenho interesse no produto: *${p.name}* (R$ ${p.price.toFixed(2).replace('.',',')}). Poderia me dar mais informações?`);
                const waLink = `https://wa.me/${waNumber}?text=${waMsg}`;

                return (
                  <div key={p.id} className="glass-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: '145px', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '145px', background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                      </div>
                    )}
                    <div style={{ padding: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', flexGrow: 1 }}>
                      <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem', lineHeight: 1.3 }}>{p.name}</div>
                      <div style={{ fontWeight: 800, color: 'var(--accent-primary)', fontSize: '1.15rem' }}>R$ {p.price.toFixed(2).replace('.',',')}</div>
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          marginTop: 'auto',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '9px 12px',
                          background: '#25d366',
                          color: '#fff',
                          borderRadius: '10px',
                          fontWeight: 700,
                          fontSize: '0.82rem',
                          textDecoration: 'none',
                          transition: 'opacity 0.2s'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        Quero este produto
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Service Management Modal */}
      {showServiceModal && (
        <div className="modal-overlay fade-in">
          <div className="modal-content glass-panel admin-modal" role="dialog" aria-modal="true" aria-labelledby="service-modal-title" style={{ maxWidth: '450px' }}>
            <div className="modal-header admin-modal-header">
              <h3 id="service-modal-title" style={{ fontSize: '1.25rem' }}>{editingService ? 'Editar Serviço' : 'Novo Serviço'}</h3>
              <button onClick={() => setShowServiceModal(false)} className="btn-close-modal" aria-label="Fechar cadastro de serviço">✕</button>
            </div>
            <form onSubmit={handleSaveService} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="form-group">
                <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 700 }}>Nome do Serviço</label>
                <input 
                  type="text" 
                  value={newServiceName} 
                  onChange={e => setNewServiceName(e.target.value)}
                  placeholder="ex: Corte Social" 
                  className="premium-input"
                  required
                />
              </div>
              <div className="form-group">
                <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 700 }}>Preço (R$)</label>
                <input 
                  type="text" 
                  inputMode="decimal"
                  value={newServicePrice} 
                  onChange={e => setNewServicePrice(e.target.value)}
                  placeholder="ex: 35,00" 
                  className="premium-input"
                  required
                />
              </div>
              <div className="form-group">
                <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 700 }}>Duração (minutos)</label>
                <input 
                  type="number" 
                  value={newServiceDuration} 
                  onChange={e => setNewServiceDuration(e.target.value)}
                  placeholder="ex: 45" 
                  className="premium-input"
                  min="5"
                  max="600"
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setShowServiceModal(false)} className="btn-secondary" style={{ flex: 1 }}>Cancelar</button>
                <button type="submit" className="btn-submit" style={{ flex: 2, background: '#0f172a', color: '#fff' }}>{editingService ? 'Salvar Alterações' : 'Adicionar Serviço'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </>
  );
}
