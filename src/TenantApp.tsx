import { useState, useEffect, useRef } from 'react';
import './App.css';
import type { QueueItem, Tenant, TenantTask, TenantProduct, Service } from './types';
import { supabase } from './lib/supabase';
import FinancialView from './FinancialView';
import { getProfessionConfig } from './lib/professionConfig';
import { useToasts } from './components/ToastProvider';
import { loginOneSignal, requestNotificationPermission, getOneSignalId, sendPushNotification, isNotificationEnabled } from './components/OneSignalInitializer';

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

  return <span style={{ display: 'block', fontSize: '0.75rem', color: '#10b981', marginTop: '4px', fontWeight: 600 }}>Atendimento iniciado há {mins} min</span>;
}

export default function TenantApp({ tenant: initialTenant }: { tenant: Tenant }) {
  const [tenant, setTenant] = useState<Tenant>(initialTenant);
  const { showToast } = useToasts();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const prevQueueRef = useRef<QueueItem[]>([]);

  // INITIAL LOAD + REALTIME
  const mapQueueItem = (q: any): QueueItem => {
    // Fallback logic: if duration is missing in the record, try to find it in current services
    let duration = q.duration;
    if (!duration && tenant?.services) {
      const svc = tenant.services.find(s => s.id === q.service_id);
      if (svc) duration = svc.duration;
    }

    return {
      id: q.id,
      name: q.name,
      whatsapp: q.whatsapp,
      serviceId: q.service_id,
      serviceName: q.service_name,
      price: parseFloat(q.price),
      status: q.status,
      joinedAt: q.joined_at,
      appointmentTime: q.appointment_time,
      isOnWay: q.is_on_way,
      pushId: q.push_id,
      startedAt: q.started_at,
      duration: duration || 30
    };
  };

  const fetchData = async () => {
    const { data: queueData } = await supabase
      .from('queue_items')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('joined_at', { ascending: true });

    if (queueData) setQueue(queueData.map(mapQueueItem));

    const { data: tenantData } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenant.id)
      .single();

    if (tenantData) {
      setCompletedCount(tenantData.completed_today || 0);
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

    const { data: settingsData } = await supabase.from('platform_settings').select('pix_key, pix_name').limit(1).single();
    if (settingsData) {
      if (settingsData.pix_key) setAdminPixKey(settingsData.pix_key);
      if (settingsData.pix_name) setAdminPixName(settingsData.pix_name);
    }
  };

  // INITIAL LOAD + REALTIME
  useEffect(() => {
    fetchData();

    // Canal separado para queue_items
    const queueChannel = supabase
      .channel(`queue_${tenant.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'queue_items', filter: `tenant_id=eq.${tenant.id}` },
        (payload) => {
          console.log('[RT] INSERT', payload.new);
          setQueue(prev => prev.some(i => i.id === payload.new.id) ? prev : [...prev, mapQueueItem(payload.new)]);
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'queue_items', filter: `tenant_id=eq.${tenant.id}` },
        (payload) => {
          console.log('[RT] UPDATE queue', payload.new);
          setQueue(prev => prev.map(item =>
            item.id === payload.new.id ? { ...item, ...mapQueueItem({ ...item, ...payload.new }) } : item
          ));
        }
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'queue_items' },
        (payload) => {
          console.log('[RT] DELETE', payload.old);
          setQueue(prev => prev.filter(item => item.id !== payload.old.id));
        }
      )
      .subscribe((status) => {
        console.log('[RT] queueChannel:', status);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') fetchData();
      });

    // Canal separado para tenants (online/offline)
    const tenantChannel = supabase
      .channel(`tenant_${tenant.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tenants', filter: `id=eq.${tenant.id}` },
        (payload) => {
          console.log('[RT] UPDATE tenant', payload.new);
          if (payload.new.completed_today !== undefined) setCompletedCount(payload.new.completed_today);
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
        console.log('[RT] tenantChannel:', status);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') fetchData();
      });

    // Polling de segurança a cada 5s (garante sincronia mesmo se WebSocket falhar)
    const pollInterval = setInterval(fetchData, 5000);

    return () => {
      supabase.removeChannel(queueChannel);
      supabase.removeChannel(tenantChannel);
      clearInterval(pollInterval);
    };
  }, [tenant.id]);


  // Handle service extraction since we now deal with objects
  const [name, setName] = useState('');
  const [adminPixKey, setAdminPixKey] = useState('');
  const [adminPixName, setAdminPixName] = useState('');
  const [customerWhatsapp, setCustomerWhatsapp] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [completedCount, setCompletedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  
  // Appointment specific state
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    // Ajustar fuso horário local para o input de data
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  });
  const [selectedTimeSlot, setSelectedTimeSlot] = useState('');
  const [adminSelectedDate, setAdminSelectedDate] = useState(() => {
    const d = new Date();
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  });

  // O serviço não é mais selecionado automaticamente para evitar mal entendidos

  // Auth state specifics to this tenant
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [activeTab, setActiveTab] = useState<'atendimento' | 'agenda' | 'financial' | 'tasks' | 'store' | 'services' | 'scheduling' | 'settings'>('atendimento');
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
  const [isAdminAddModalOpen, setIsAdminAddModalOpen] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [isServiceListOpen, setIsServiceListOpen] = useState(false);
  const [showJoinConfirmation, setShowJoinConfirmation] = useState(false);
  const [itemForCancel, setItemForCancel] = useState<QueueItem | null>(null);
  const [showAdminDeleteModal, setShowAdminDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<QueueItem | null>(null);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState('30');

  const [notifsEnabled, setNotifsEnabled] = useState(true);

  useEffect(() => {
    const checkNotifs = async () => {
      const enabled = await isNotificationEnabled();
      setNotifsEnabled(enabled);
    };
    checkNotifs();
    // Checar a cada 2 segundos caso o usuário mude nas configurações do browser
    const interval = setInterval(checkNotifs, 2000);
    return () => clearInterval(interval);
  }, []);

  // Load stats from localStorage on mount (for persistent auth)
  useEffect(() => {
    // Check auth session
    const auth = localStorage.getItem(`suavez_auth_${tenant.slug}`);
    if (auth === 'true') {
      setIsAuthenticated(true);
    }
  }, [tenant.slug]);

  const fetchTasks = async () => {
    const { data } = await supabase
      .from('tenant_tasks')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false });
    if (data) {
      setTasks(data.map((t: any) => ({
        id: t.id,
        tenantId: t.tenant_id,
        title: t.title,
        isCompleted: t.is_completed,
        createdAt: t.created_at
      })));
    }
  };

  const fetchProducts = async () => {
    const { data } = await supabase
      .from('tenant_products')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false });
    if (data) {
      setProducts(data.map((p: any) => ({
        id: p.id,
        tenantId: p.tenant_id,
        name: p.name,
        price: parseFloat(p.price),
        imageUrl: p.image_url,
        createdAt: p.created_at
      })));
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchTasks();
      fetchProducts();

      // CAPTURAR E SALVAR O PUSH ID DO ADMIN (Sempre que logado em PROD)
      if (import.meta.env.PROD) {
        const syncAdminPushId = async () => {
          const pushId = await getOneSignalId();
          if (pushId) {
            console.log('[DEBUG] Sincronizando Admin Push ID:', pushId);
            const { error } = await supabase.from('tenants').update({ admin_push_id: pushId }).eq('id', tenant.id);
            if (error) console.error('[DEBUG] Erro ao salvar Admin Push ID:', error);
          }
        };
        // Tenta capturar após 5s, 15s e 30s (garante captura mesmo em conexões lentas)
        setTimeout(syncAdminPushId, 5000);
        setTimeout(syncAdminPushId, 15000);
        setTimeout(syncAdminPushId, 30000);
      }
    }
  }, [isAuthenticated, tenant.id]);

  // Always load products for client-side store button
  useEffect(() => {
    fetchProducts();
  }, [tenant.id]);

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
      showToast('Modelo de atendimento atualizado!', 'success');
    }
    setLoading(false);
  };

  const updateSchedulingSettings = async (field: string, value: any) => {
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

  const updateWorkingHours = async (newHours: any[]) => {
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
        if (!item.appointmentTime) return false;
        const itemStart = new Date(item.appointmentTime);
        const itemDuration = Number(item.duration) || 30;
        const itemEnd = new Date(itemStart.getTime() + itemDuration * 60000);
        
        const isSameDay = itemStart.getFullYear() === date.getFullYear() &&
                          itemStart.getMonth() === date.getMonth() &&
                          itemStart.getDate() === date.getDate();
        
        if (!isSameDay) return false;

        const itemStartMs = itemStart.getTime();
        const itemEndMs = itemEnd.getTime();

        console.log(`[DEBUG] Verificando Slot ${timeStr} (${selectedDuration}min) contra ${item.name} (${itemDuration}min às ${itemStart.toLocaleTimeString()})`);

        const overlaps = slotStartMs < itemEndMs && slotEndMs > itemStartMs;
        
        if (overlaps) {
          console.log(`[DEBUG] Slot ${timeStr} bloqueado por ${item.name} (${item.serviceName}): ${itemStart.toLocaleTimeString()} - ${itemEnd.toLocaleTimeString()}`);
        }

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
  }, [queue, isAuthenticated]);

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
  }, [queue, myQueueItemIds]);

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
  const todayStr = new Date().toISOString().split('T')[0];
  
  // Today's Queue (Atendimento)
  const todayQueue = queue.filter(item => {
    const itemDate = item.appointmentTime ? item.appointmentTime.split('T')[0] : item.joinedAt.split('T')[0];
    return itemDate === todayStr;
  }).sort((a, b) => {
    if (a.appointmentTime && b.appointmentTime) return a.appointmentTime.localeCompare(b.appointmentTime);
    return a.joinedAt.localeCompare(b.joinedAt);
  });

  // Future Agenda
  const futureAgenda = queue.filter(item => {
    const itemDate = item.appointmentTime ? item.appointmentTime.split('T')[0] : item.joinedAt.split('T')[0];
    return itemDate > todayStr;
  }).sort((a, b) => {
    const dateA = a.appointmentTime || a.joinedAt;
    const dateB = b.appointmentTime || b.joinedAt;
    return dateA.localeCompare(dateB);
  });

  // Filter for the specific admin selected date (used in Agenda tab)
  const filteredAgenda = queue.filter(item => {
    const itemDate = item.appointmentTime ? item.appointmentTime.split('T')[0] : item.joinedAt.split('T')[0];
    return itemDate === adminSelectedDate;
  }).sort((a, b) => {
    if (a.appointmentTime && b.appointmentTime) return a.appointmentTime.localeCompare(b.appointmentTime);
    return a.joinedAt.localeCompare(b.joinedAt);
  });

  const servingCount = todayQueue.filter(item => item.status === 'serving').length;
  const waitingCount = todayQueue.filter(item => item.status === 'waiting' || item.status === 'ready').length;

  const handleApproveAppointment = async (itemId: string) => {
    const item = queue.find(i => i.id === itemId);
    if (!item) return;

    const { error } = await supabase
      .from('queue_items')
      .update({ status: 'waiting' })
      .eq('id', itemId);

    if (!error) {
      showToast(`Agendamento de ${item.name} confirmado! ✅`, 'success');
      if (item.pushId) {
        sendPushNotification(
          item.pushId,
          'Agendamento Confirmado! ✅',
          `Olá ${item.name}, seu agendamento para ${item.serviceName} foi confirmado pelo profissional.`,
          window.location.origin + '/' + tenant.slug
        );
      }
    }
  };

  const handleRejectAppointment = async (item: QueueItem) => {
    const confirm = window.confirm(`Deseja realmente recusar o agendamento de ${item.name}?`);
    if (!confirm) return;

    const { error } = await supabase
      .from('queue_items')
      .update({ status: 'cancelled' })
      .eq('id', item.id);

    if (!error) {
      showToast('Agendamento recusado.', 'info');
      if (item.pushId) {
        sendPushNotification(
          item.pushId,
          'Agendamento Recusado ❌',
          `Olá ${item.name}, infelizmente não poderemos atender seu agendamento de ${item.serviceName}.`,
          window.location.origin + '/' + tenant.slug
        );
      }
    }
  };



  // Group client queue by day
  const groupedClientQueue = queue.reduce((acc, item) => {
    const date = item.appointmentTime ? item.appointmentTime.split('T')[0] : item.joinedAt.split('T')[0];
    if (!acc[date]) acc[date] = [];
    acc[date].push(item);
    return acc;
  }, {} as Record<string, QueueItem[]>);

  // Handle actual adding to queue
  const confirmJoinQueue = async () => {
    console.log('[DEBUG] Iniciando confirmJoinQueue...');
    setShowConfirmation(false);
    const startTime = Date.now();
    setLoading(true);
    
    if (myQueueItemIds.length >= 4) {
      showToast('Limite de 3 acompanhantes atingido!', 'warning');
      setLoading(false);
      return;
    }
    
    try {
      const selectedSvc = tenant.services.find(s => s.id === selectedServiceId);
      if (!selectedSvc) {
        console.error('[DEBUG] Serviço não encontrado:', selectedServiceId);
        setLoading(false);
        return;
      }

      // Capture OneSignal ID if possible (non-blocking, PROD ONLY)
      let pushId = null;
      if (import.meta.env.PROD) {
        try {
          console.log('[DEBUG] Tentando capturar OneSignal ID...');
          pushId = await getOneSignalId();
          console.log('[DEBUG] OneSignal ID capturado:', pushId);
        } catch (err) {
          console.warn('[DEBUG] Falha ao capturar Push ID, continuando sem ele:', err);
        }
      } else {
        console.log('[DEBUG] OneSignal ignorado em modo DEV.');
      }

      console.log('[DEBUG] Enviando para o Supabase...', {
        tenant_id: tenant.id,
        name: name.trim(),
        whatsapp: customerWhatsapp.trim()
      });

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
        console.error('[DEBUG] Erro Supabase:', error);
        showToast('Erro ao entrar na fila: ' + error.message, 'error');
      } else if (data && data.length > 0) {
        console.log('[DEBUG] Sucesso! Dados retornados:', data[0]);
        setName('');
        setCustomerWhatsapp('');
        
        const newIds = [...myQueueItemIds, data[0].id];
        setMyQueueItemIds(newIds);
        localStorage.setItem(`suavez_customer_ids_${tenant.id}`, JSON.stringify(newIds));
        localStorage.setItem(`suavez_in_queue_${tenant.id}`, 'true');
        setForceShowJoinForm(false);
        
        // Forçar atualização manual da fila caso o realtime falhe
        fetchData();
        
        showToast('Presença confirmada com sucesso!', 'success');

        // Notificar o PROFISSIONAL (se ele tiver um admin_push_id salvo)
        const { data: tenantData } = await supabase.from('tenants').select('admin_push_id').eq('id', tenant.id).single();
        if (tenantData?.admin_push_id && import.meta.env.PROD) {
          console.log('[DEBUG] Disparando notificação para o Admin...');
          sendPushNotification(
            tenantData.admin_push_id,
            tenant.bookingType === 'appointment' ? 'Novo Agendamento Solicitado! 📅' : 'Novo Cliente na Fila! 👤',
            `${name.trim()} solicitou ${selectedSvc.name}${tenant.bookingType === 'appointment' ? ` para o dia ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR')} às ${selectedTimeSlot}` : ''}.`,
            window.location.origin + '/' + tenant.slug
          );
        }
      }
    } catch (err: any) {
      console.error('[DEBUG] Erro inesperado no fluxo:', err);
      showToast('Ocorreu um erro inesperado: ' + err.message, 'error');
    } finally {
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < 1200) {
        await new Promise(resolve => setTimeout(resolve, 1200 - elapsedTime));
      }
      setLoading(false);
      console.log('[DEBUG] Fim do processo confirmJoinQueue');
    }
  };

  const handleCompleteService = async (id: string) => {
    if (!isAuthenticated) return;
    
    // Find the price of the item being completed before deleting it
    const item = queue.find(q => q.id === id);

    // 1. Remove item from queue
    const { error: delError } = await supabase.from('queue_items').delete().eq('id', id);
    if (delError) return;

    // 2. Record revenue (only price + date, nothing else)
    if (item) {
      await supabase.from('financial_records').insert([{
        tenant_id: tenant.id,
        price: item.price
      }]);
    }

    // 3. Increment tenant total cuts
    const newCount = completedCount + 1;
    await supabase.from('tenants').update({ completed_today: newCount }).eq('id', tenant.id);
    // Next person stays as 'waiting' - barber manually clicks Iniciar
  };

  const handleCallClient = async (id: string) => {
    if (!isAuthenticated) return;
    
    const client = queue.find(q => q.id === id);
    
    const { error } = await supabase.from('queue_items').update({ 
      status: 'ready' 
    }).eq('id', id);
    
    if (!error && client?.pushId && import.meta.env.PROD) {
      sendPushNotification(
        client.pushId,
        'Sua vez está chegando! ✂️',
        `Olá ${client.name}, por favor, aproxime-se. O profissional já vai te atender em instantes!`,
        window.location.origin + '/' + tenant.slug
      );
      showToast(`Cliente ${client.name} chamado!`, 'success');
    } else if (!import.meta.env.PROD) {
      console.log('[DEBUG] Notificação de Chamada suprimida (Modo DEV)');
      showToast(`Cliente chamado! (Modo DEV)`, 'success');
    }
  };

  const handleStartService = async (id: string) => {
    if (!isAuthenticated) return;
    
    // Find client to get push_id
    const client = queue.find(q => q.id === id);
    
    const { error } = await supabase.from('queue_items').update({ 
      status: 'serving', 
      started_at: new Date().toISOString(),
      is_on_way: false
    }).eq('id', id);
    
    if (!error && client?.pushId && import.meta.env.PROD) {
      sendPushNotification(
        client.pushId,
        'Atendimento Iniciado! ✂️',
        `Olá ${client.name}, seu atendimento começou. Aproveite a experiência!`,
        window.location.origin + '/' + tenant.slug
      );
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
      
      // Notificar o PROFISSIONAL (A Caminho)
      const { data: tenantData } = await supabase.from('tenants').select('admin_push_id').eq('id', tenant.id).single();
      if (tenantData?.admin_push_id && import.meta.env.PROD) {
        const client = queue.find(q => q.id === id);
        sendPushNotification(
          tenantData.admin_push_id,
          'Cliente a caminho! 🚗',
          `${client?.name || 'Um cliente'} confirmou que está saindo de casa.`,
          window.location.origin + '/' + tenant.slug
        );
      }
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
      
      // Logar no OneSignal para receber notificações de admin
      loginOneSignal(`admin_${tenant.id}`);
      requestNotificationPermission();
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

    if (!error && data) {
      setNewTaskTitle('');
      fetchTasks();
      showToast('Atividade adicionada!', 'success');
    }
  };

  const handleToggleTask = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('tenant_tasks')
      .update({ is_completed: !currentStatus })
      .eq('id', id);

    if (!error) {
      fetchTasks();
    }
  };

  const handleDeleteTask = async (id: string) => {
    const { error } = await supabase
      .from('tenant_tasks')
      .delete()
      .eq('id', id);

    if (!error) {
      fetchTasks();
      showToast('Atividade removida!', 'info');
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem(`suavez_auth_${tenant.slug}`);
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

    const price = parseFloat(newServicePrice.replace(',', '.'));
    if (isNaN(price)) {
      showToast('Preço inválido!', 'warning');
      return;
    }

    let updatedServices: Service[] = [];
    
    if (editingService) {
      // Edit existing
      updatedServices = tenant.services.map(s => 
        s.id === editingService.id ? { ...s, name: newServiceName, price, duration: parseInt(newServiceDuration) || 30 } : s
      );
    } else {
      // Add new
      const newService: Service = {
        id: crypto.randomUUID(),
        name: newServiceName,
        price,
        duration: parseInt(newServiceDuration) || 30
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

  const updateTenantProfile = async (field: keyof Tenant, value: any) => {
    const dbField = field === 'primaryColor' ? 'primary_color' : field === 'secondaryColor' ? 'secondary_color' : field === 'logoUrl' ? 'logo_url' : field === 'hasLogo' ? 'has_logo' : field;
    const { error } = await supabase
      .from('tenants')
      .update({ [dbField]: value })
      .eq('id', tenant.id);

    if (error) {
      showToast('Erro ao atualizar perfil: ' + error.message, 'error');
    } else {
      setTenant({ ...tenant, [field]: value });
      showToast('Perfil atualizado com sucesso!', 'success');
    }
  };

  // DERIVED CONFIG: Always recalculate based on current state
  const prof = getProfessionConfig(tenant.profession);

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

  // Helper to hex to rgb
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '212, 175, 55';
  };

  // Dynamic CSS variables for tenant theme dynamically applied to document root 
  useEffect(() => {
    const color = tenant.primaryColor || '#d4af37';
    const sColor = tenant.secondaryColor || '#ffffff';
    document.documentElement.style.setProperty('--accent-primary', color);
    document.documentElement.style.setProperty('--accent-primary-rgb', hexToRgb(color));
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
                <div className="login-logo">
                  {tenant.hasLogo && tenant.logoUrl ? (
                    <img src={tenant.logoUrl} alt="Logo" />
                  ) : (
                    <div dangerouslySetInnerHTML={{ __html: (prof?.iconSvg || '').replace('width="28" height="28"', 'width="36" height="36"') }} />
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
        <div className="admin-layout-wrapper fade-in" style={{ backgroundColor: '#f8fafc', minHeight: '100vh', position: 'relative' }}>
          {/* MOBILE BACKDROP */}
          {isMobileMenuOpen && (
            <div className="sidebar-mobile-backdrop" onClick={() => setIsMobileMenuOpen(false)}></div>
          )}
          
          {/* SIDEBAR */}
          <aside className={`admin-sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
              <div className="sidebar-logo">
                {tenant.hasLogo && tenant.logoUrl ? (
                  <img src={tenant.logoUrl} alt="Logo" className="sidebar-logo-img" />
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: (prof?.iconSvg || '').replace('width="28" height="28"', 'width="24" height="24"') }} />
                )}
              </div>
              <div className="sidebar-brand">
                <h3>{tenant.name}</h3>
                <p>Painel Administrativo</p>
              </div>
            </div>

            <nav className="sidebar-nav">
              <button 
                className={`nav-item ${activeTab === 'atendimento' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => { setActiveTab('atendimento'); setIsMobileMenuOpen(false); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                Atendimento (Hoje)
              </button>
              <button 
                className={`nav-item ${activeTab === 'agenda' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => { setActiveTab('agenda'); setIsMobileMenuOpen(false); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                Agenda (Futuro)
              </button>
              <button 
                className={`nav-item ${activeTab === 'financial' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => { setActiveTab('financial'); setIsMobileMenuOpen(false); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                Financeiro
              </button>
              <button 
                className={`nav-item ${activeTab === 'tasks' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => { setActiveTab('tasks'); setIsMobileMenuOpen(false); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
                Controle de Atividades
              </button>
              <button 
                className={`nav-item ${activeTab === 'store' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => { setActiveTab('store'); setIsMobileMenuOpen(false); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                Loja
              </button>
              <button 
                className={`nav-item ${activeTab === 'services' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => { setActiveTab('services'); setIsMobileMenuOpen(false); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                Serviços
              </button>
              <button 
                className={`nav-item ${activeTab === 'scheduling' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => { setActiveTab('scheduling'); setIsMobileMenuOpen(false); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
                Gestão de atendimento
              </button>
              <button 
                className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => { setActiveTab('settings'); setIsMobileMenuOpen(false); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Configurações
              </button>
            </nav>

            <div className="sidebar-footer">
              <div className="tenant-status-card">
                <div className="status-indicator">
                  <div className={`status-dot ${tenant.isOnline ? 'online' : 'offline'}`}></div>
                  <span>Status: {tenant.isOnline ? 'Online' : 'Offline'}</span>
                </div>
                <button 
                  onClick={toggleStatus} 
                  className="btn-toggle-status"
                  style={{ background: tenant.isOnline ? '#ef4444' : '#10b981', color: '#fff' }}
                >
                  {tenant.isOnline ? 'Fechar Loja' : 'Abrir Loja'}
                </button>
              </div>
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

            <header className="admin-topbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(true)}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                </button>
                <div className="topbar-info">
                  <h1>
                    {activeTab === 'atendimento' ? 'Atendimento de Hoje' : 
                     activeTab === 'agenda' ? 'Agenda de Compromissos' :
                     activeTab === 'financial' ? 'Controle Financeiro' :
                     activeTab === 'tasks' ? 'Controle de Atividades' : 'Minha Loja'}
                  </h1>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <p style={{ margin: 0 }}>
                      {activeTab === 'atendimento' 
                        ? new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
                        : new Date(adminSelectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                  </div>
                </div>
              </div>
              <div className="topbar-actions" style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                  <div className="subscription-badge">
                    <div className={`sub-dot ${tenant.subscriptionStatus === 'active' ? 'active' : 'warning'}`}></div>
                    <span>Plano {tenant.subscriptionStatus === 'active' ? 'Ativo' : 'Pendente'}</span>
                  </div>
                  {(activeTab === 'atendimento' || activeTab === 'agenda') && (
                    <button 
                      onClick={() => {
                        if (activeTab === 'atendimento') {
                          setAdminSelectedDate(todayStr);
                          setSelectedDate(todayStr);
                        }
                        setIsAdminAddModalOpen(true);
                      }}
                      style={{ 
                        padding: '10px 20px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        gap: '8px',
                        background: '#0f172a',
                        color: '#fff',
                        borderRadius: '12px',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        border: 'none',
                        cursor: 'pointer',
                        flexShrink: 0,
                        boxShadow: '0 4px 12px rgba(15, 23, 42, 0.15)'
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                      Novo Cliente
                    </button>
                  )}
               </div>
            </header>

            {isAdminAddModalOpen && (
               <div className="modal-overlay" style={{ zIndex: 10000, position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="modal-content glass-panel fade-in" style={{ maxWidth: '500px', width: '90%', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid color-mix(in srgb, var(--accent-primary) 20%, rgba(0,0,0,0.1))', padding: '2rem', borderRadius: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                      <h3 style={{ fontSize: '1.25rem', margin: 0 }}>Adicionar Cliente à Fila</h3>
                      <button onClick={() => setIsAdminAddModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#a1a1aa' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </button>
                    </div>

                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      await confirmJoinQueue();
                      setIsAdminAddModalOpen(false);
                    }}>
                      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Nome do Cliente</label>
                        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', color: 'var(--text-primary)' }} />
                      </div>
                      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>WhatsApp</label>
                        <input type="tel" value={customerWhatsapp} onChange={handlePhoneChange} required style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', color: 'var(--text-primary)' }} />
                      </div>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: tenant.bookingType === 'appointment' ? '1fr 1fr' : '1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                        <div className="form-group">
                          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Serviço</label>
                          <select 
                            value={selectedServiceId} 
                            onChange={(e) => setSelectedServiceId(e.target.value)} 
                            required
                            style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', color: 'var(--text-primary)' }}
                          >
                            <option value="" disabled hidden>Selecione um serviço...</option>
                            {tenant.services.map(s => (
                              <option key={s.id} value={s.id}>{s.name} - R$ {s.price.toFixed(2).replace('.', ',')}</option>
                            ))}
                          </select>
                        </div>
                        
                        {tenant.bookingType === 'appointment' && (
                          <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Data</label>
                            <input 
                              type="date" 
                              value={selectedDate} 
                              onChange={(e) => setSelectedDate(e.target.value)} 
                              required 
                              style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', color: 'var(--text-primary)' }} 
                            />
                          </div>
                        )}
                      </div>

                      {tenant.bookingType === 'appointment' && (
                        <div className="form-group" style={{ marginBottom: '2rem' }}>
                          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>Horário Disponível</label>
                          <select 
                            value={selectedTimeSlot} 
                            onChange={(e) => setSelectedTimeSlot(e.target.value)} 
                            required
                            style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', color: 'var(--text-primary)' }}
                          >
                            <option value="">Selecione um horário...</option>
                            {/* Simple list of common hours or we could use the generateSlots logic if available */}
                            {['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'].map(slot => (
                              <option key={slot} value={slot}>{slot}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <button type="submit" className="btn-submit" style={{ width: '100%', padding: '14px', background: 'var(--accent-primary)', color: 'var(--accent-secondary)', fontWeight: 800, borderRadius: '10px' }}>
                        {tenant.bookingType === 'appointment' ? 'Agendar Cliente' : 'Colocar na Fila'}
                      </button>
                    </form>
                 </div>
               </div>
             )}

            <div className="admin-content-scroll">

              {activeTab === 'financial' ? (
                <FinancialView tenantId={tenant.id} />

              ) : activeTab === 'tasks' ? (
                <div className="fade-in">
                  <div className="premium-card" style={{ padding: 'clamp(1rem, 5vw, 2rem)' }}>
                    <h2 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>Minhas Atividades</h2>
                    <form onSubmit={handleAddTask} style={{ display: 'flex', gap: '10px', marginBottom: '2rem', flexWrap: 'wrap' }}>
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

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {tasks.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Nenhuma atividade pendente.</p>
                      ) : (
                        tasks.map(task => (
                          <div key={task.id} className="glass-card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <input 
                              type="checkbox" 
                              checked={task.isCompleted} 
                              onChange={() => handleToggleTask(task.id, task.isCompleted)}
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
                <div className="fade-in">
                  <div className="premium-card" style={{ padding: '2rem' }}>
                    <h2 style={{ marginBottom: '0.5rem', fontSize: '1.25rem' }}>Produtos da Loja</h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.9rem' }}>Adicione produtos que você usa e recomenda. Seus clientes poderão visualizá-los.</p>
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newProductName || !newProductPrice) return;
                      let imageUrl = newProductImage || null;

                      // Upload file if selected
                      if (newProductImageFile) {
                        let uploadBlob: Blob = newProductImageFile;
                        try { uploadBlob = await compressImage(newProductImageFile); } catch {}
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

                      const { error } = await supabase.from('tenant_products').insert([{ tenant_id: tenant.id, name: newProductName, price: parseFloat(newProductPrice.replace(',','.')), image_url: imageUrl }]);
                      if (!error) {
                        setNewProductName('');
                        setNewProductPrice('');
                        setNewProductImage('');
                        setNewProductImageFile(null);
                        setNewProductImagePreview('');
                        fetchProducts();
                        showToast('Produto adicionado!', 'success');
                      }
                    }} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.8rem' }}>Nome do produto</label>
                          <input type="text" value={newProductName} onChange={e => setNewProductName(e.target.value)} placeholder="Ex: Pomada X" required />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.8rem' }}>Preço (R$)</label>
                          <input type="text" value={newProductPrice} onChange={e => setNewProductPrice(e.target.value)} placeholder="29,90" required />
                        </div>
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.8rem' }}>Foto do produto</label>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
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
                              <button type="button" onClick={() => { setNewProductImageFile(null); setNewProductImagePreview(''); }} style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#ef4444', color: '#fff', borderRadius: '50%', width: '18px', height: '18px', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                         <button type="submit" className="btn-submit" style={{ width: 'auto', padding: '0 24px' }}>Adicionar Produto</button>
                      </div>
                    </form>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                      {products.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', padding: '2rem', gridColumn: '1/-1', textAlign: 'center' }}>Nenhum produto cadastrado ainda.</p>
                      ) : products.map(p => (
                        <div key={p.id} className="glass-card" style={{ overflow: 'hidden' }}>
                          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: '140px', objectFit: 'cover' }} /> : (
                            <div style={{ width: '100%', height: '140px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                            </div>
                          )}
                          <div style={{ padding: '1rem' }}>
                            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>{p.name}</div>
                            <div style={{ fontWeight: 800, color: '#10b981', fontSize: '1.1rem', marginBottom: '0.75rem' }}>R$ {p.price.toFixed(2).replace('.',',')}</div>
                            <button onClick={async () => { await supabase.from('tenant_products').delete().eq('id', p.id); fetchProducts(); }} style={{ background: 'transparent', color: '#ef4444', fontSize: '0.8rem', cursor: 'pointer' }}>Remover</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              ) : activeTab === 'services' ? (
                <div className="fade-in">
                  <div className="premium-card" style={{ padding: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                      <div>
                        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Gestão de Serviços</h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Cadastre e gerencie os serviços oferecidos aos seus clientes.</p>
                      </div>
                      <button onClick={() => openServiceModal()} className="btn-submit" style={{ width: 'auto', padding: '0 24px', background: '#0f172a', color: '#fff' }}>
                        + Novo Serviço
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                      {tenant.services.length === 0 ? (
                        <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '4rem', background: 'rgba(255,255,255,0.02)', borderRadius: '20px' }}>
                          <p style={{ color: 'var(--text-secondary)' }}>Nenhum serviço cadastrado ainda.</p>
                        </div>
                      ) : tenant.services.map(s => (
                        <div key={s.id} className="glass-card" style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <h4 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px' }}>{s.name}</h4>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <p style={{ color: '#10b981', fontWeight: 800, fontSize: '1.1rem' }}>R$ {s.price.toFixed(2).replace('.', ',')}</p>
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
                <div className="fade-in">
                  <div className="premium-card" style={{ padding: '2.5rem' }}>
                    <div style={{ marginBottom: '2.5rem' }}>
                      <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Configurações do Perfil</h2>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Gerencie a identidade visual e informações básicas do seu estabelecimento.</p>
                    </div>

                    <div style={{ display: 'grid', gap: '2rem' }}>
                      {/* Info Form */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                        <div className="form-group">
                          <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 700, marginBottom: '8px', display: 'block' }}>WhatsApp de Contato</label>
                          <input 
                            type="text" 
                            className="premium-input" 
                            value={tenant.whatsapp} 
                            onChange={(e) => setTenant({ ...tenant, whatsapp: formatPhoneNumber(e.target.value) })}
                            onBlur={(e) => updateTenantProfile('whatsapp', e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 700, marginBottom: '8px', display: 'block' }}>Cor da Marca</label>
                          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <input 
                              type="color" 
                              value={tenant.primaryColor || '#d4af37'} 
                              onChange={(e) => setTenant({ ...tenant, primaryColor: e.target.value })}
                              onBlur={(e) => updateTenantProfile('primaryColor', e.target.value)}
                              style={{ width: '50px', height: '50px', border: 'none', borderRadius: '12px', cursor: 'pointer', background: 'transparent' }}
                            />
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{tenant.primaryColor?.toUpperCase() || '#D4AF37'}</span>
                          </div>
                        </div>
                        <div className="form-group">
                          <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 700, marginBottom: '8px', display: 'block' }}>Cor do Letreiro (Texto)</label>
                          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <input 
                              type="color" 
                              value={tenant.secondaryColor || '#ffffff'} 
                              onChange={(e) => setTenant({ ...tenant, secondaryColor: e.target.value })}
                              onBlur={(e) => updateTenantProfile('secondaryColor', e.target.value)}
                              style={{ width: '50px', height: '50px', border: 'none', borderRadius: '12px', cursor: 'pointer', background: 'transparent' }}
                            />
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{tenant.secondaryColor?.toUpperCase() || '#FFFFFF'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              ) : activeTab === 'scheduling' ? (
                <div className="fade-in">
                  <div className="premium-card" style={{ padding: '2rem' }}>
                    <div style={{ marginBottom: '2.5rem' }}>
                      <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Gestão de atendimento</h2>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Escolha como seus clientes devem agendar os serviços.</p>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                      <button 
                        onClick={() => updateBookingType('queue')}
                        className={`glass-card ${tenant.bookingType === 'queue' ? 'active-selection' : ''}`}
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
                        className={`glass-card ${tenant.bookingType === 'appointment' ? 'active-selection' : ''}`}
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

                    <div style={{ marginTop: '3rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <h4 style={{ fontSize: '0.95rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                        Nota importante
                      </h4>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                        Ao mudar o modelo de atendimento, as telas dos seus clientes serão atualizadas automaticamente para o novo formato. Agendamentos ou pessoas que já estão na fila permanecerão salvos.
                      </p>
                    </div>

                    {tenant.bookingType === 'appointment' && (
                      <div className="fade-in" style={{ marginTop: '3.5rem', paddingTop: '3.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ marginBottom: '2.5rem' }}>
                          <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(var(--accent-primary-rgb), 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)' }}>
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                            </div>
                            Configuração da Agenda
                          </h3>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Personalize seu fluxo de trabalho e intervalos de descanso.</p>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '2.5rem' }}>
                          {/* Card: Tempo de Serviço */}
                          <div className="glass-card" style={{ padding: '2rem', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                              <div style={{ color: '#3b82f6' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                              </div>
                              <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Tempo de Atendimento</h4>
                            </div>
                            <div className="form-group">
                              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <input 
                                  type="number" 
                                  className="premium-input"
                                  value={tenant.appointmentInterval || 30} 
                                  onChange={e => updateSchedulingSettings('appointment_interval', parseInt(e.target.value))} 
                                  step="5" min="5" 
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
                                  value={tenant.lunchStart || '12:00'} 
                                  onChange={e => updateSchedulingSettings('lunch_start', e.target.value)} 
                                  style={{ flex: 1, fontWeight: 600 }}
                                />
                                <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>às</span>
                                <input 
                                  type="time" 
                                  className="premium-input"
                                  value={tenant.lunchEnd || '13:00'} 
                                  onChange={e => updateSchedulingSettings('lunch_end', e.target.value)} 
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
                        <div className="premium-card" style={{ padding: '2.5rem', background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                            <div>
                              <h4 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>Horário de Expediente</h4>
                              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Selecione os dias e defina os horários de abertura e fechamento.</p>
                            </div>
                          </div>

                          <div style={{ display: 'grid', gap: '0.75rem' }}>
                            {['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'].map((dayName, idx) => {
                              const dayNum = idx === 6 ? 0 : idx + 1;
                              const wh = tenant.workingHours?.find(h => h.day === dayNum);
                              const isWorking = !!wh;
                              
                              return (
                                <div key={dayNum} className={`schedule-row ${isWorking ? 'active' : 'inactive'}`} 
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
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(15, 23, 42, 0.3)', padding: '10px 18px', borderRadius: '14px', border: '1px solid rgba(255, 255, 255, 0.08)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' }}>
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
                <div className="admin-dashboard-container">
                  <div className="admin-stats-row">
                    <div className="admin-stat-card"><span className="stat-label">Concluídos Hoje</span><span className="stat-value">{completedCount}</span></div>
                    <div className="admin-stat-card"><span className="stat-label">Em Espera</span><span className="stat-value">{waitingCount}</span></div>
                    <div className="admin-stat-card"><span className="stat-label">Atendendo Agora</span><span className="stat-value">{servingCount}</span></div>
                  </div>
                  <div className="admin-queue-list-section">
                    <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                      <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Gestão de Hoje</h2>
                      <div className="live-indicator"><span className="live-dot"></span>AO VIVO</div>
                    </div>
                    <div className="admin-queue-list">
                      {todayQueue.filter(item => item.status !== 'pending' && item.status !== 'cancelled' && item.status !== 'completed').length === 0 ? (
                        <div className="empty-state" style={{ padding: '4rem', textAlign: 'center', borderRadius: '20px', border: '2px dashed rgba(0,0,0,0.05)' }}>
                          <p style={{ color: '#64748b', fontWeight: 500 }}>Nenhum atendimento confirmado para hoje.</p>
                        </div>
                      ) : todayQueue.filter(item => item.status !== 'pending' && item.status !== 'cancelled' && item.status !== 'completed').map((item, index) => (
                        <div key={item.id} className={`admin-queue-item ${item.status}`}>
                          <div className="item-pos">{index + 1}º</div>
                          <div className="item-main">
                            <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {item.name}
                              {item.isOnWay && <span style={{ fontSize: '0.7rem', background: 'var(--accent-primary)', color: 'var(--accent-secondary)', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>🚗 A CAMINHO</span>}
                            </h4>
                            <span className="item-service">{item.serviceName} {item.appointmentTime ? `• 🕒 ${formatTimeISO(item.appointmentTime)}` : ''}</span>
                            {item.status === 'serving' && item.startedAt && <TimeElapsed startedAt={item.startedAt} />}
                          </div>
                          <div className="item-actions">
                            {item.status === 'serving' ? (
                              <button onClick={() => handleCompleteService(item.id)} className="action-btn complete" style={{ background: '#10b981', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '10px', fontWeight: 700, fontSize: '0.85rem' }}>
                                Concluir
                              </button>
                            ) : (
                              <>
                                <button 
                                  onClick={() => handleCallClient(item.id)} 
                                  className="action-btn call" 
                                  style={{ background: item.status === 'ready' ? '#f1f5f9' : 'var(--accent-primary)', color: item.status === 'ready' ? '#64748b' : 'var(--accent-secondary)', border: 'none', padding: '10px 16px', borderRadius: '10px', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}
                                >
                                  {item.status === 'ready' ? 'Chamado ✓' : 'Chamar'}
                                </button>
                                <button 
                                  onClick={() => handleStartService(item.id)} 
                                  className="action-btn start" 
                                  style={{ background: '#0f172a', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: '10px', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}
                                >
                                  Atender
                                </button>
                              </>
                            )}
                          </div>
                          <button onClick={() => handleRemoveFromQueue(item)} className="btn-action-remove">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : activeTab === 'agenda' ? (
                <div className="admin-dashboard-container fade-in">
                  <div className="agenda-view-wrapper" style={{ padding: '0.5rem' }}>
                    <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2.5rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div>
                          <h2 style={{ fontSize: '1.75rem', fontWeight: 900, letterSpacing: '-0.5px', marginBottom: '0.5rem' }}>Cronograma de Agendamentos</h2>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Gerencie suas reservas e solicitações futuras.</p>
                        </div>
                        
                        {/* Integrated Date Picker Filter */}
                        <div className="agenda-date-filter" style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '8px 16px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', width: 'fit-content' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Filtrar por data:</span>
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
                              onClick={() => setAdminSelectedDate(todayStr)}
                              style={{ background: 'rgba(var(--accent-primary-rgb), 0.1)', color: 'var(--accent-primary)', border: 'none', padding: '4px 10px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 900, cursor: 'pointer' }}
                            >
                              HOJE
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="agenda-stats" style={{ display: 'flex', gap: '1.5rem' }}>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total de Agendamentos</span>
                          <span style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--accent-primary)' }}>{futureAgenda.length}</span>
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
                        <button 
                          onClick={() => setIsAdminAddModalOpen(true)}
                          className="btn-submit"
                          style={{ width: 'auto', padding: '0 32px', height: '52px', borderRadius: '16px' }}
                        >
                          + Novo Agendamento
                        </button>
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

                          <div style={{ paddingLeft: '74px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.25rem' }}>
                            {filteredAgenda.map(item => (
                              <div key={item.id} className="premium-agenda-card" style={{ 
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
                                        className="approve-btn"
                                        title="Confirmar"
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
                                      </button>
                                      <button 
                                        onClick={() => handleRejectAppointment(item)}
                                        className="reject-btn"
                                        title="Recusar"
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
        <div className="app-container fade-in">
          {/* Header Action */}
          <div className="role-switcher">
            <button onClick={toggleRole} className="btn-role">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              Admin
            </button>
          </div>

          {/* Hero Section */}
          <section className="hero-section fade-in">
            <div className="hero-background-glow"></div>
            <div className="hero-content">
              <div className="hero-brand">
                <div className="hero-logo-container">
                  {tenant.hasLogo && tenant.logoUrl ? (
                    <img 
                      src={tenant.logoUrl} 
                      alt={`${tenant.name} Logo`} 
                      className="hero-logo-img"
                    />
                  ) : (
                    <div 
                      className="hero-logo-icon"
                      dangerouslySetInnerHTML={{ __html: (prof?.iconSvg || '').replace('width="28" height="28"', 'width="48" height="48"') }}
                    />
                  )}
                </div>
                <div className="hero-text">
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
                   {myItemsInQueue.length === 0 && tenant.isOnline && (
                     <button 
                       onClick={() => document.querySelector('.form-panel')?.scrollIntoView({ behavior: 'smooth' })}
                       className="hero-cta-button"
                     >
                       {tenant.bookingType === 'appointment' ? 'Agendar Agora' : 'Garantir meu Lugar'}
                     </button>
                   )}
                   {products.length > 0 && (
                     <button
                       onClick={() => setShowStoreModal(true)}
                       style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 24px', borderRadius: '12px', border: '2px solid #0f172a', background: 'transparent', color: '#0f172a', fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem', marginTop: '0.5rem' }}
                     >
                       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                       Acessar a Loja
                     </button>
                   )}
                   <div className={`hero-online-badge ${tenant.isOnline ? 'online' : 'offline'}`}>
                     <span className="pulse-dot"></span>
                     {tenant.isOnline ? 'Aberto Agora' : 'Fechado no Momento'}
                   </div>
                 </div>
              </div>
            </div>
          </section>

          {/* Client Content */}
          <div className="status-summary-container fade-in">
            <div className="status-summary-card serving">
              <div className="status-info">
                <span className="status-value">{servingCount}</span>
                <span className="status-label">Em Atendimento</span>
              </div>
              <div className="status-icon-glow"></div>
            </div>
            <div className="status-summary-card waiting">
              <div className="status-info">
                <span className="status-value">{waitingCount}</span>
                <span className="status-label">Na Espera</span>
              </div>
              <div className="status-icon-glow"></div>
            </div>
          </div>

          <main className="main-content">
            {/* Form Section */}
            <section className="form-panel glass-panel">
              {!tenant.isOnline ? (
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
                            onClick={() => requestNotificationPermission()}
                            style={{ 
                              fontSize: '0.65rem', 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: '4px', 
                              color: notifsEnabled ? '#10b981' : '#ef4444',
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
                              <div className="fade-in" style={{ padding: '12px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981', borderRadius: '12px', textAlign: 'center', fontWeight: 600, fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
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
                        setForceShowJoinForm(true);
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
                <form onSubmit={handleJoinQueue} className="join-form">
                   <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    <div style={{ padding: '10px', background: 'rgba(var(--accent-primary-rgb), 0.1)', borderRadius: '12px', color: 'var(--accent-primary)' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>
                    </div>
                    <div>
                      <h2 style={{ fontSize: '1.4rem', color: 'var(--text-primary)' }}>{tenant.bookingType === 'appointment' ? 'Agendar Horário' : 'Entrar na Fila'}</h2>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Seu Nome</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: João" required />
                  </div>
                  <div className="form-group">
                    <label>WhatsApp</label>
                    <input type="tel" value={customerWhatsapp} onChange={handlePhoneChange} placeholder="(00) 90000-0000" required />
                  </div>
                  <div className="form-group">
                    <label>Serviço</label>
                    <div className="service-selector-simple">
                      <button 
                        type="button" 
                        className={`selector-trigger ${isServiceListOpen ? 'open' : ''}`}
                        onClick={() => setIsServiceListOpen(!isServiceListOpen)}
                      >
                        <span>{tenant.services.find(s => s.id === selectedServiceId)?.name || 'Selecione um serviço'}</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                      </button>
                      
                      {isServiceListOpen && (
                        <div className="simple-vertical-list fade-in">
                          {tenant.services.map(s => (
                            <button 
                              key={s.id} 
                              type="button" 
                              className={`simple-list-item ${selectedServiceId === s.id ? 'active' : ''}`}
                              onClick={() => {
                                setSelectedServiceId(s.id);
                                setIsServiceListOpen(false);
                              }}
                            >
                              <span className="svc-name">{s.name}</span>
                              <span className="svc-price">R$ {s.price.toFixed(2).replace('.', ',')}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {tenant.bookingType === 'appointment' && (
                    <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.5rem' }}>
                      <div className="form-group">
                        <label>Data</label>
                        <input 
                          type="date" 
                          value={selectedDate} 
                          min={new Date().toISOString().split('T')[0]}
                          onChange={(e) => {
                            setSelectedDate(e.target.value);
                            setSelectedTimeSlot('');
                          }} 
                          required 
                        />
                      </div>
                      <div className="form-group">
                        <label>Horário</label>
                        <select 
                          value={selectedTimeSlot} 
                          onChange={(e) => setSelectedTimeSlot(e.target.value)} 
                          required
                          className="premium-select"
                        >
                          <option value="">Selecione</option>
                          {generateTimeSlots().map(slot => (
                            <option key={slot} value={slot}>{slot}</option>
                          ))}
                        </select>
                      </div>
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
                        onClick={() => requestNotificationPermission()}
                        className="btn-secondary" 
                        style={{ width: '100%', fontSize: '0.85rem', padding: '10px', background: 'white' }}
                      >
                        Ativar Agora
                      </button>
                    </div>
                  )}

                  <button type="submit" className="btn-submit" style={{ marginTop: '1.5rem' }} disabled={loading}>
                    {loading ? 'Aguarde...' : 'Confirmar'}
                  </button>
                  
                  {myItemsInQueue.length > 0 && (
                    <button 
                      type="button" 
                      onClick={() => setForceShowJoinForm(false)} 
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
            <section className="queue-panel">
               <div className="queue-header" style={{ marginBottom: '2rem' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem', flexWrap: 'wrap', gap: '1.25rem' }}>
                  <div style={{ flex: 1, minWidth: '250px' }}>
                    <h2 style={{ margin: '0 0 6px 0' }}>{tenant.bookingType === 'appointment' ? 'Acompanhe a Agenda' : 'Acompanhe a Fila'}</h2>
                    <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', margin: 0, opacity: 0.9, lineHeight: '1.5' }}>
                      {tenant.bookingType === 'appointment' 
                        ? 'Deseja consultar a disponibilidade para outros dias? Selecione uma data ao lado para conferir os horários.' 
                        : 'Deseja ver o movimento da fila para outros dias? Use o seletor de data ao lado.'}
                    </p>
                  </div>
                  <div className="client-date-filter" style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(var(--accent-primary-rgb), 0.05)', padding: '8px 16px', borderRadius: '16px', border: '1px solid rgba(var(--accent-primary-rgb), 0.1)', height: 'fit-content' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                      <input 
                        type="date" 
                        value={selectedDate}
                        onChange={(e) => {
                          setSelectedDate(e.target.value);
                          setSelectedTimeSlot('');
                        }}
                        style={{ 
                          background: 'transparent', 
                          border: 'none', 
                          color: 'var(--text-primary)', 
                          fontSize: '0.9rem', 
                          fontWeight: 800, 
                          outline: 'none',
                          cursor: 'pointer',
                          fontFamily: 'inherit'
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="queue-list" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {groupedClientQueue[selectedDate] && groupedClientQueue[selectedDate].filter(i => i.status !== 'cancelled').length > 0 ? (
                  <div className="client-day-group fade-in">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1.25rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--accent-primary)', textTransform: 'uppercase', background: 'rgba(var(--accent-primary-rgb), 0.1)', padding: '4px 10px', borderRadius: '8px' }}>
                        {selectedDate === todayStr ? 'Hoje' : new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                      </span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, opacity: 0.6 }}>
                        {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' })}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {groupedClientQueue[selectedDate]
                        .filter(item => item.status !== 'cancelled')
                        .sort((a,b) => (a.appointmentTime||a.joinedAt).localeCompare(b.appointmentTime||b.joinedAt))
                        .map((item, index) => (
                        <div key={item.id} className={`queue-item glass-card ${item.status}`} style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{ fontSize: '1.2rem', fontWeight: 800, opacity: 0.6, minWidth: '60px', color: item.status === 'ready' ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                            {tenant.bookingType === 'appointment' && item.appointmentTime ? formatTimeISO(item.appointmentTime) : `${index + 1}º`}
                          </div>
                          <div style={{ flexGrow: 1 }}>
                            <h4 style={{ color: 'var(--text-primary)', marginBottom: '4px' }}>{item.name}</h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span style={{ fontSize: '0.8rem', opacity: 0.7, fontWeight: 500 }}>{item.serviceName}</span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                Tempo estimado: {item.duration || 30} min
                              </span>
                            </div>
                            {item.status === 'serving' && item.startedAt && <TimeElapsed startedAt={item.startedAt} />}
                          </div>
                          <span className={`status-badge ${item.status}`}>{item.status === 'serving' ? 'Atendendo' : (tenant.bookingType === 'appointment' ? (item.status === 'pending' ? 'Pendente' : 'Confirmado') : 'Aguardando')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="premium-empty-state" style={{ padding: '4rem 2rem', textAlign: 'center', borderRadius: '32px', background: 'rgba(255,255,255,0.01)', border: '2px dashed rgba(255,255,255,0.05)' }}>
                    <div style={{ width: '80px', height: '80px', background: 'linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.1), transparent)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" opacity="0.6"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    </div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Agenda livre para este dia</h3>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: '300px', margin: '0 auto', fontSize: '0.95rem', lineHeight: '1.5' }}>
                      {selectedDate === todayStr ? 'Não há compromissos marcados para hoje.' : `Não há compromissos marcados para o dia ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR')}.`}
                    </p>
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
            <div style={{ width: '64px', height: '64px', background: '#10b981', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
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
                  if (import.meta.env.PROD) requestNotificationPermission();
                  await confirmJoinQueue();
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
          <div className="modal-content glass-panel fade-in" style={{ maxWidth: '400px', textAlign: 'center', padding: '2.5rem' }}>
            <div style={{ width: '64px', height: '64px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', color: '#ef4444' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Remover Cliente?</h3>
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
                      <div style={{ fontWeight: 900, color: '#10b981', fontSize: '1.15rem' }}>R$ {p.price.toFixed(2).replace('.',',')}</div>
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
          <div className="modal-content glass-panel" style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.25rem' }}>{editingService ? 'Editar Serviço' : 'Novo Serviço'}</h3>
              <button onClick={() => setShowServiceModal(false)} className="btn-close-modal">✕</button>
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
