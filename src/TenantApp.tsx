import { useState, useEffect, useRef } from 'react';
import './App.css';
import type { QueueItem, Tenant, TenantTask, TenantProduct } from './types';
import { supabase } from './lib/supabase';
import FinancialView from './FinancialView';
import { getProfessionConfig } from './lib/professionConfig';
import { useToasts } from './components/ToastProvider';
import { loginOneSignal, requestNotificationPermission, getOneSignalId, sendPushNotification } from './components/OneSignalInitializer';

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
  useEffect(() => {
    const mapQueueItem = (q: any): QueueItem => ({
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
      startedAt: q.started_at
    });

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
          hasLogo: tenantData.has_logo,
          logoUrl: tenantData.logo_url,
          isOnline: tenantData.is_online ?? true,
          subscriptionStatus: tenantData.subscription_status,
          nextPaymentAt: tenantData.next_payment_at ? tenantData.next_payment_at.split('T')[0] : undefined,
        }));
      }

      const { data: settingsData } = await supabase.from('platform_settings').select('pix_key, pix_name').limit(1).single();
      if (settingsData) {
        if (settingsData.pix_key) setAdminPixKey(settingsData.pix_key);
        if (settingsData.pix_name) setAdminPixName(settingsData.pix_name);
      }
    };

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
            primaryColor: payload.new.primary_color ?? prev.primaryColor,
            subscriptionStatus: payload.new.subscription_status ?? prev.subscriptionStatus,
            nextPaymentAt: payload.new.next_payment_at ? payload.new.next_payment_at.split('T')[0] : prev.nextPaymentAt,
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

  // Set initial service when tenant services load
  useEffect(() => {
    if (tenant.services && tenant.services.length > 0) {
      setSelectedServiceId(tenant.services[0].id);
    }
  }, [tenant.services]);

  // Auth state specifics to this tenant
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [activeTab, setActiveTab] = useState<'queue' | 'financial' | 'tasks' | 'store'>('queue');
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
    }
  }, [isAuthenticated, tenant.id]);

  // Always load products for client-side store button
  useEffect(() => {
    fetchProducts();
  }, [tenant.id]);

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

  const [myQueueItemId, setMyQueueItemId] = useState<string | null>(() => 
    localStorage.getItem(`suavez_customer_id_${tenant.id}`)
  );

  const amIInQueue = queue.find(item => item.id === myQueueItemId);

  // Limpar localStorage se não estiver mais na fila
  useEffect(() => {
    if (myQueueItemId && !amIInQueue && queue.length > 0) {
      // Pequeno delay para garantir que a fila carregou
      const timer = setTimeout(() => {
        if (!queue.find(item => item.id === myQueueItemId)) {
          localStorage.removeItem(`suavez_customer_id_${tenant.id}`);
          localStorage.removeItem(`suavez_in_queue_${tenant.id}`);
          setMyQueueItemId(null);
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [queue, myQueueItemId]);

  // Trigger confirmation modal
  const handleJoinQueue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !selectedServiceId) return;
    if (tenant.bookingType === 'appointment' && !selectedTimeSlot) {
      showToast('Por favor, selecione um horário!', 'warning');
      return;
    }
    setShowConfirmation(true);
  };

  // Status counts for the summary bar
  const servingCount = queue.filter(item => item.status === 'serving').length;
  const waitingCount = queue.filter(item => item.status === 'waiting' || item.status === 'ready').length;
  const totalCount = queue.length;

  // Handle actual adding to queue
  const confirmJoinQueue = async () => {
    setShowConfirmation(false);
    setLoading(true);
    const startTime = Date.now();

    try {
      // 1. Anti-spam check: check if this WhatsApp is already in the queue for this tenant
      const { data: existing } = await supabase
        .from('queue_items')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('whatsapp', customerWhatsapp.trim())
        .in('status', ['waiting', 'serving'])
        .maybeSingle();

      if (existing && !import.meta.env.DEV) {
        showToast('Você já está na fila deste estabelecimento!', 'warning');
        setLoading(false);
        return;
      }

      const selectedSvc = tenant.services.find(s => s.id === selectedServiceId);
      if (!selectedSvc) {
        setLoading(false);
        return;
      }

      // Capture OneSignal ID if possible
      const pushId = await getOneSignalId();

      const { data, error } = await supabase.from('queue_items').insert([{
        tenant_id: tenant.id,
        name: name.trim(),
        whatsapp: customerWhatsapp.trim(),
        service_id: selectedSvc.id,
        service_name: selectedSvc.name,
        price: selectedSvc.price,
        status: tenant.bookingType === 'appointment' ? 'ready' : 'waiting', // Appointments skip waiting to be 'served' by time
        appointment_time: tenant.bookingType === 'appointment' ? `${selectedDate}T${selectedTimeSlot}:00` : null,
        push_id: pushId
      }]).select();

      if (!error && data) {
        setName('');
        setCustomerWhatsapp('');
        // Store in localStorage that THIS user is in the queue to show a special message
        localStorage.setItem(`suavez_in_queue_${tenant.id}`, 'true');
        localStorage.setItem(`suavez_customer_id_${tenant.id}`, data[0].id);
        setMyQueueItemId(data[0].id);
        showToast('Presença confirmada com sucesso!', 'success');
      } else {
        showToast('Erro ao entrar na fila: ' + error.message, 'error');
      }
    } finally {
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < 1200) {
        await new Promise(resolve => setTimeout(resolve, 1200 - elapsedTime));
      }
      setLoading(false);
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

  const handleStartService = async (id: string) => {
    if (!isAuthenticated) return;
    
    // Find client to get push_id
    const client = queue.find(q => q.id === id);
    
    const { error } = await supabase.from('queue_items').update({ status: 'serving', started_at: new Date().toISOString() }).eq('id', id);
    
    if (!error && client?.pushId) {
      sendPushNotification(
        client.pushId,
        'Sua vez chegou! ✂️',
        `Olá ${client.name}, o profissional já está te aguardando. Pode vir!`
      );
    }
  };

  const handleRemoveFromQueue = async (id: string) => {
    if (!isAuthenticated) return;
    if (!window.confirm('Remover este cliente da fila?')) return;
    await supabase.from('queue_items').delete().eq('id', id);
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
    }
  };

  const handleCancelMyPlace = async () => {
    if (!myQueueItemId) return;
    setShowLeaveModal(false);
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('queue_items')
        .delete()
        .eq('id', myQueueItemId);
      
      if (error) {
        showToast('Erro ao cancelar: ' + error.message, 'error');
      } else {
        localStorage.removeItem(`suavez_customer_id_${tenant.id}`);
        localStorage.removeItem(`suavez_in_queue_${tenant.id}`);
        setMyQueueItemId(null);
        showToast('Você saiu da fila.', 'info');
      }
    } finally {
      setLoading(false);
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
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    if (formatted.length <= 15) { // Limit to (XX) XXXXX-XXXX
      setCustomerWhatsapp(formatted);
    }
  };

  // DERIVED CONFIG: Always recalculate based on current state
  const prof = getProfessionConfig(tenant.profession);

  // Format time (e.g., 14:30)
  const formatTimeISO = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  // Helper to hex to rgb
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '212, 175, 55';
  };

  // Dynamic CSS variables for tenant theme dynamically applied to document root 
  useEffect(() => {
    const color = tenant.primaryColor || '#d4af37';
    document.documentElement.style.setProperty('--accent-primary', color);
    document.documentElement.style.setProperty('--accent-primary-rgb', hexToRgb(color));
    
    // Cleanup if leaving tenant view
    return () => {
      document.documentElement.style.removeProperty('--accent-primary');
      document.documentElement.style.removeProperty('--accent-primary-rgb');
    };
  }, [tenant.primaryColor]);

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
                className={`nav-item ${activeTab === 'queue' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => { setActiveTab('queue'); setIsMobileMenuOpen(false); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                {tenant.bookingType === 'appointment' ? 'Agendamentos' : 'Fila de Espera'}
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
                    {activeTab === 'queue' ? (tenant.bookingType === 'appointment' ? 'Agenda de Hoje' : 'Fila de Espera') : 
                     activeTab === 'financial' ? 'Controle Financeiro' :
                     activeTab === 'tasks' ? 'Controle de Atividades' : 'Minha Loja'}
                  </h1>
                  <p>{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                </div>
              </div>
              <div className="topbar-actions" style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                  <div className="subscription-badge">
                    <div className={`sub-dot ${tenant.subscriptionStatus === 'active' ? 'active' : 'warning'}`}></div>
                    <span>Plano {tenant.subscriptionStatus === 'active' ? 'Ativo' : 'Pendente'}</span>
                  </div>
                  <button 
                    onClick={() => setIsAdminAddModalOpen(true)}
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
                            <option value="">Selecione...</option>
                            {tenant.services.map(s => (
                              <option key={s.id} value={s.id}>{s.name} - R$ {s.price}</option>
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

                      <button type="submit" className="btn-submit" style={{ width: '100%', padding: '14px', background: 'var(--accent-primary)', color: '#000', fontWeight: 800, borderRadius: '10px' }}>
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
                  <div className="premium-card" style={{ padding: '2rem' }}>
                    <h2 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>Minhas Atividades</h2>
                    <form onSubmit={handleAddTask} style={{ display: 'flex', gap: '10px', marginBottom: '2rem' }}>
                      <input type="text" value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} placeholder="Adicione uma nova atividade..." style={{ flexGrow: 1 }} />
                      <button type="submit" className="btn-submit" style={{ width: 'auto', padding: '0 20px', background: '#0f172a', color: '#fff' }}>Adicionar</button>
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

              ) : (
                <div className="admin-dashboard-container">
                  <div className="admin-stats-row">
                    <div className="admin-stat-card"><span className="stat-label">Clientes Hoje</span><span className="stat-value">{completedCount}</span></div>
                    <div className="admin-stat-card"><span className="stat-label">Em Espera</span><span className="stat-value">{waitingCount}</span></div>
                    <div className="admin-stat-card"><span className="stat-label">Atendendo Agora</span><span className="stat-value">{servingCount}</span></div>
                  </div>
                  <div className="admin-queue-list-section">
                    <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                      <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Gestão de Atendimento</h2>
                      <div className="live-indicator"><span className="live-dot"></span>AO VIVO</div>
                    </div>
                    <div className="admin-queue-list">
                      {queue.length === 0 ? (
                        <div className="empty-state" style={{ padding: '4rem', textAlign: 'center', borderRadius: '20px' }}>
                          <p style={{ color: '#64748b', fontWeight: 500 }}>Nenhum cliente na fila no momento.</p>
                        </div>
                      ) : queue.map((item, index) => (
                        <div key={item.id} className={`admin-queue-item ${item.status}`}>
                          <div className="item-pos">{index + 1}º</div>
                          <div className="item-main">
                            <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {item.name}
                              {item.isOnWay && <span style={{ fontSize: '0.7rem', background: 'var(--accent-primary)', color: '#000', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>🚗 A CAMINHO</span>}
                            </h4>
                            <span className="item-service">{item.serviceName} {item.appointmentTime ? `• 🕒 ${formatTimeISO(item.appointmentTime)}` : ''}</span>
                            {item.status === 'serving' && item.startedAt && <TimeElapsed startedAt={item.startedAt} />}
                          </div>
                          <div className="item-actions">
                            {item.status === 'waiting' && <button onClick={() => handleStartService(item.id)} className="btn-action-start">Atender</button>}
                            {item.status === 'serving' && <button onClick={() => handleCompleteService(item.id)} className="btn-action-complete">Finalizar</button>}
                            <button onClick={() => handleRemoveFromQueue(item.id)} className="btn-action-remove">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

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
                   {!amIInQueue && tenant.isOnline && (
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
            <div className="status-summary-card total">
              <div className="status-info">
                <span className="status-value">{totalCount}</span>
                <span className="status-label">Total Hoje</span>
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
              ) : amIInQueue ? (
                <div className="active-presence-card fade-in">
                  <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Sua presença confirmada!</h2>
                  <div className="my-status-monitor fade-in">
                    <div className="monitor-glow"></div>
                    <div className="monitor-content">
                      <p className="monitor-label">Posição Atual</p>
                      <div className="monitor-value">{queue.findIndex(item => item.id === amIInQueue?.id) + 1}º</div>
                      <p className="monitor-subtext">Você é o próximo!</p>
                    </div>
                    <div className="monitor-footer">
                      <div className="live-indicator"><span className="live-dot"></span>AO VIVO</div>
                    </div>
                  </div>

                  {(() => {
                    const waitingItems = queue.filter(q => q.status === 'waiting');
                    const myWaitIndex = waitingItems.findIndex(q => q.id === amIInQueue?.id);
                    
                    // Mostrar se for o 1º ou 2º da fila de espera
                    if (myWaitIndex >= 0 && myWaitIndex < 2) {
                      if (amIInQueue?.isOnWay) {
                        return (
                          <div className="fade-in" style={{ marginTop: '1.5rem', padding: '16px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981', borderRadius: '16px', textAlign: 'center', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                            Profissional avisado que você está a caminho!
                          </div>
                        );
                      } else {
                        return (
                          <div className="fade-in" style={{ marginTop: '1.5rem' }}>
                            <button 
                              onClick={() => handleConfirmOnWay(amIInQueue!.id)} 
                              className="btn-submit" 
                              disabled={loading}
                              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#3b82f6', color: '#fff' }}
                            >
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 22h14"></path><path d="m5 12 7-7 7 7"></path><path d="M12 15v7"></path></svg>
                              Você está a caminho? Confirme presença
                            </button>
                          </div>
                        );
                      }
                    }
                    return null;
                  })()}

                  <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <button onClick={() => window.open(`https://wa.me/${tenant.whatsapp?.replace(/\D/g, '')}`)} className="hero-cta-button" style={{ background: '#25D366' }}>Falar no WhatsApp</button>
                    <button onClick={() => setShowLeaveModal(true)} className="btn-secondary">Sair da Fila</button>
                  </div>
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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '1rem' }}>
                      {tenant.services.map(s => (
                        <button key={s.id} type="button" onClick={() => setSelectedServiceId(s.id)} className={`service-selection-card ${selectedServiceId === s.id ? 'active' : ''}`} style={{ padding: '1rem', borderRadius: '12px', border: '1px solid color-mix(in srgb, var(--accent-primary) 20%, #e2e8f0)', background: selectedServiceId === s.id ? 'rgba(var(--accent-primary-rgb), 0.1)' : 'var(--bg-surface)', color: 'var(--text-primary)' }}>
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button type="submit" className="btn-submit" style={{ marginTop: '1rem' }} disabled={loading}>
                    {loading ? 'Aguarde...' : 'Confirmar'}
                  </button>
                </form>
              )}
            </section>

            {/* Queue Section */}
            <section className="queue-panel">
               <div className="queue-header">
                <h2>Acompanhe a Fila</h2>
              </div>
              <div className="queue-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {queue.map((item, index) => (
                  <div key={item.id} className={`queue-item glass-card ${item.status}`} style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, opacity: 0.3 }}>{index + 1}º</div>
                    <div style={{ flexGrow: 1 }}>
                      <h4 style={{ color: 'var(--text-primary)' }}>{item.name}</h4>
                      <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>{item.serviceName}</span>
                      {item.status === 'serving' && item.startedAt && <TimeElapsed startedAt={item.startedAt} />}
                    </div>
                    <span className={`status-badge ${item.status}`}>{item.status === 'serving' ? 'Atendendo' : 'Aguardando'}</span>
                  </div>
                ))}
              </div>
            </section>
          </main>
        </div>
      )}


      {/* Confirmation Modal */}
      {showConfirmation && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal-content glass-panel fade-in" style={{ maxWidth: '400px', textAlign: 'center', background: 'var(--bg-surface)' }}>
            <div style={{ width: '64px', height: '64px', background: 'var(--success)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Sucesso!</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Seu lugar na fila foi reservado com sucesso.</p>
            <button onClick={() => setShowConfirmation(false)} className="btn-submit">Entendi</button>
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
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Sair da Fila?</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.95rem', lineHeight: '1.5' }}>
              Você perderá sua posição atual e precisará entrar novamente se mudar de ideia.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button 
                onClick={handleCancelMyPlace} 
                className="btn-submit" 
                style={{ background: '#ef4444', color: '#fff', border: 'none' }}
              >
                Sim, desejo sair
              </button>
              <button 
                onClick={() => setShowLeaveModal(false)} 
                className="btn-secondary" 
                style={{ border: '1px solid rgba(0,0,0,0.1)', width: '100%' }}
              >
                Continuar na fila
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

    </>
  );
}
