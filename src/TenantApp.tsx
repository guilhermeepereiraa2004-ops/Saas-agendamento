import { useState, useEffect } from 'react';
import './App.css';
import type { QueueItem, Tenant } from './types';
import { supabase } from './lib/supabase';
import FinancialView from './FinancialView';
import { getProfessionConfig } from './lib/professionConfig';
import { useToasts } from './components/ToastProvider';
import { loginOneSignal, requestNotificationPermission } from './components/OneSignalInitializer';

export default function TenantApp({ tenant: initialTenant }: { tenant: Tenant }) {
  const [tenant, setTenant] = useState<Tenant>(initialTenant);
  const { showToast } = useToasts();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  
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
      appointmentTime: q.appointment_time
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
          isOnline: tenantData.is_online ?? true
        }));
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

  const getBookedSlots = () => {
    return queue
      .filter(q => q.appointmentTime && q.appointmentTime.startsWith(selectedDate))
      .map(q => {
        const timePart = q.appointmentTime!.split('T')[1];
        return timePart ? timePart.substring(0, 5) : null;
      })
      .filter(Boolean) as string[];
  };

  const getAvailableSlots = () => {
    if (!tenant.workingHours || tenant.workingHours.length === 0) return [];
    
    // JS getDay(): 0=Sun, 1=Mon... Our db workingHours: 0=Dom, 1=Seg...
    const dateObj = new Date(selectedDate + "T12:00:00"); // 12:00 to avoid timezone shift
    const dayOfWeek = dateObj.getDay(); 
    
    const wh = tenant.workingHours.find(h => h.day === dayOfWeek);
    if (!wh) return [];

    const service = tenant.services.find(s => s.id === selectedServiceId);
    if (!service || !service.duration) return [];

    const startParts = wh.start.split(':').map(Number);
    const endParts = wh.end.split(':').map(Number);
    let currentMins = startParts[0] * 60 + startParts[1];
    const endMins = endParts[0] * 60 + endParts[1];

    const bookedSlots = getBookedSlots();
    const slots = [];
    
    while (currentMins + service.duration <= endMins) {
      const h = Math.floor(currentMins / 60).toString().padStart(2, '0');
      const m = (currentMins % 60).toString().padStart(2, '0');
      const timeString = `${h}:${m}`;
      
      // Calculate slot end time to check overlap if needed, but for simplicity we assume exact slots
      if (!bookedSlots.includes(timeString)) {
        slots.push(timeString);
      }
      currentMins += service.duration;
    }
    return slots;
  };

  // Auth state specifics to this tenant
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [activeTab, setActiveTab] = useState<'queue' | 'financial'>('queue');
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Load stats from localStorage on mount (for persistent auth)
  useEffect(() => {
    // Check auth session
    const auth = localStorage.getItem(`suavez_auth_${tenant.slug}`);
    if (auth === 'true') {
      setIsAuthenticated(true);
    }
  }, [tenant.slug]);

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

  // Handle actual adding to queue
  const confirmJoinQueue = async () => {
    setShowConfirmation(false);
    setLoading(true);

    try {
      // 1. Anti-spam check: check if this WhatsApp is already in the queue for this tenant
      const { data: existing } = await supabase
        .from('queue_items')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('whatsapp', customerWhatsapp.trim())
        .in('status', ['waiting', 'serving'])
        .maybeSingle();

      if (existing) {
        showToast('Você já está na fila deste estabelecimento!', 'warning');
        setLoading(false);
        return;
      }

      const selectedSvc = tenant.services.find(s => s.id === selectedServiceId);
      if (!selectedSvc) {
        setLoading(false);
        return;
      }

      const { error } = await supabase.from('queue_items').insert([{
        tenant_id: tenant.id,
        name: name.trim(),
        whatsapp: customerWhatsapp.trim(),
        service_id: selectedSvc.id,
        service_name: selectedSvc.name,
        price: selectedSvc.price,
        status: tenant.bookingType === 'appointment' ? 'ready' : 'waiting', // Appointments skip waiting to be 'served' by time
        appointment_time: tenant.bookingType === 'appointment' ? `${selectedDate}T${selectedTimeSlot}:00` : null
      }]);

      if (!error) {
        setName('');
        setCustomerWhatsapp('');
        // Store in localStorage that THIS user is in the queue to show a special message
        localStorage.setItem(`suavez_in_queue_${tenant.id}`, 'true');
        showToast('Presença confirmada com sucesso!', 'success');
      } else {
        showToast('Erro ao entrar na fila: ' + error.message, 'error');
      }
    } finally {
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
    await supabase.from('queue_items').update({ status: 'serving' }).eq('id', id);
  };

  const handleRemoveFromQueue = async (id: string) => {
    if (!isAuthenticated) return;
    if (!window.confirm('Remover este cliente da fila?')) return;
    await supabase.from('queue_items').delete().eq('id', id);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const validEmail = tenant.loginEmail || 'admin@suavez.com';
    const validPassword = tenant.loginPassword || '123456';
    
    if (loginEmail === validEmail && loginPassword === validPassword) {
      setIsAuthenticated(true);
      setShowLogin(false);
      showToast('Login realizado com sucesso!', 'success');
      
      // Logar no OneSignal para receber notificações de admin
      loginOneSignal(`admin_${tenant.id}`);
      requestNotificationPermission();
    } else {
      showToast('E-mail ou senha incorretos!', 'error');
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

  // Dynamic CSS variables for tenant theme dynamically applied to document root 
  useEffect(() => {
    document.documentElement.style.setProperty('--accent-primary', tenant.primaryColor || '#d4af37');
    
    // Cleanup if leaving tenant view
    return () => {
      document.documentElement.style.removeProperty('--accent-primary');
    };
  }, [tenant.primaryColor]);

  return (
    <div className="app-container fade-in">
      {/* Role Switcher Toolbar */}
      <div className="role-switcher">
        <button onClick={toggleRole} className="btn-role">
          {isAuthenticated ? `Sair (${prof.professional})` : 'Acesso Restrito'}
        </button>
        {isAuthenticated && (
          <button 
            onClick={toggleStatus} 
            className={`btn-role ${tenant.isOnline ? 'online' : 'offline'}`}
            style={{ 
              background: tenant.isOnline ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: tenant.isOnline ? '#10b981' : '#ef4444',
              border: `1px solid ${tenant.isOnline ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              background: tenant.isOnline ? '#10b981' : '#ef4444',
              boxShadow: tenant.isOnline ? '0 0 8px #10b981' : 'none'
            }}></span>
            {tenant.isOnline ? 'Online' : 'Offline'}
          </button>
        )}
      </div>

      {/* Login Modal */}
      {showLogin && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel fade-in">
            <h3>Acesso Restrito - {tenant.name}</h3>
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label>E-mail</label>
                <input 
                  type="email" 
                  value={loginEmail} 
                  onChange={(e) => setLoginEmail(e.target.value)} 
                  placeholder="teste@gmail.com"
                  required 
                />
              </div>
              <div className="form-group">
                <label>Senha</label>
                <input 
                  type="password" 
                  value={loginPassword} 
                  onChange={(e) => setLoginPassword(e.target.value)} 
                  placeholder="******"
                  required 
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn-submit">Entrar</button>
                <button type="button" onClick={() => setShowLogin(false)} className="btn-secondary">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmation && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content glass-panel fade-in" style={{ maxWidth: '450px' }}>
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <div style={{ 
                width: '64px', 
                height: '64px', 
                background: 'rgba(16, 185, 129, 0.1)', 
                color: '#10b981', 
                borderRadius: '50%', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                margin: '0 auto 1.5rem'
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Confirme sua Escolha</h3>
              <p style={{ color: 'var(--text-secondary)' }}>Verifique os detalhes do seu atendimento</p>
            </div>

            <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '2rem', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ marginBottom: '1.25rem' }}>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.4rem' }}>Serviço Escolhido</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff' }}>
                  {tenant.services.find(s => s.id === selectedServiceId)?.name}
                </span>
              </div>
              {tenant.bookingType === 'appointment' && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.4rem' }}>Data e Horário</span>
                  <span style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff' }}>
                    {selectedDate.split('-').reverse().join('/')} às {selectedTimeSlot}
                  </span>
                </div>
              )}
              <div>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.4rem' }}>Valor do Atendimento</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-primary)' }}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(tenant.services.find(s => s.id === selectedServiceId)?.price || 0)}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button 
                onClick={confirmJoinQueue} 
                className="btn-submit" 
                style={{ flex: 2, padding: '16px', borderRadius: '12px' }}
              >
                Sim, Confirmar
              </button>
              <button 
                onClick={() => setShowConfirmation(false)} 
                className="btn-secondary" 
                style={{ flex: 1, padding: '16px', borderRadius: '12px' }}
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header Section */}
      <header className="header-container glass-panel">
        <div className="brand-section">
          <div className="logo-wrapper" style={{ overflow: 'hidden' }}>
            {tenant.hasLogo && tenant.logoUrl ? (
              <img 
                src={tenant.logoUrl} 
                alt={`${tenant.name} Logo`} 
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
              />
            ) : (
              <div 
                style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                dangerouslySetInnerHTML={{ __html: prof.iconSvg.replace('width="28" height="28"', 'width="24" height="24"') }}
              />
            )}
          </div>
          <div className="brand-info">
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800 }}>{tenant.name}</h1>
          </div>
        </div>
        <div className="header-stats-wrapper">
          {isAuthenticated && (
            <div className="queue-stats admin-stats">
              <div className="stat-value">{completedCount}</div>
              <div className="stat-label">Serviços Hoje</div>
            </div>
          )}
          <div className="queue-stats">
            <div className="stat-value">{queue.length}</div>
            <div className="stat-label">Na Fila</div>
          </div>
        </div>
      </header>

      {/* Tab Switcher (only for authenticated barbers) */}
      {isAuthenticated && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <button
            onClick={() => setActiveTab('queue')}
            className={activeTab === 'queue' ? 'btn-submit' : 'btn-secondary'}
            style={{ 
              flex: 1, 
              padding: '12px', 
              fontSize: '0.9rem', 
              width: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              fontWeight: 600,
              letterSpacing: '0.5px'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>
            Fila de Atendimento
          </button>
          <button
            onClick={() => setActiveTab('financial')}
            className={activeTab === 'financial' ? 'btn-submit' : 'btn-secondary'}
            style={{ 
              flex: 1, 
              padding: '12px', 
              fontSize: '0.9rem', 
              width: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              fontWeight: 600,
              letterSpacing: '0.5px'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
            Financeiro
          </button>
        </div>
      )}

      {activeTab === 'financial' && isAuthenticated ? (
        <FinancialView tenantId={tenant.id} profession={tenant.profession} />
      ) : (
        <main className="main-content">
        
        {/* Left Side: Form */}
        <section className="form-panel glass-panel">
          {!tenant.isOnline && !isAuthenticated ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <div style={{ 
                width: '64px', 
                height: '64px', 
                background: 'rgba(239, 68, 68, 0.1)', 
                borderRadius: '50%', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                margin: '0 auto 1.5rem',
                color: '#ef4444'
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              </div>
              <h2 style={{ marginBottom: '1rem', color: '#fff' }}>Estabelecimento Offline</h2>
              <p style={{ color: '#a1a1aa', fontSize: '0.95rem', lineHeight: '1.6' }}>
                No momento o(a) {prof.professional.toLowerCase()} não está aceitando novos clientes na fila. Por favor, tente novamente mais tarde.
              </p>
            </div>
          ) : localStorage.getItem(`suavez_in_queue_${tenant.id}`) && !isAuthenticated ? (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <div style={{ 
                width: '60px', 
                height: '60px', 
                background: 'rgba(16, 185, 129, 0.1)', 
                borderRadius: '50%', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                margin: '0 auto 1.5rem',
                color: 'var(--success)'
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <h2 style={{ marginBottom: '1rem' }}>Sua presença está confirmada!</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.6' }}>
                Você já está na fila. Agora é só aguardar o(a) {prof.professional.toLowerCase()} chamar pelo painel ou pelo WhatsApp.
              </p>
              
              <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                <p style={{ color: '#fff', fontSize: '0.9rem', marginBottom: '1rem', fontWeight: 500 }}>
                  🔔 Quer ser avisado quando chegar sua vez?
                </p>
                <button 
                  onClick={() => requestNotificationPermission()}
                  style={{ 
                    background: '#3b82f6', 
                    color: '#fff', 
                    border: 'none', 
                    padding: '10px 20px', 
                    borderRadius: '8px', 
                    fontWeight: 600, 
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                  }}
                >
                  Ativar Notificações
                </button>
              </div>
              <button 
                onClick={() => {
                  if(confirm("Deseja entrar novamente com outro nome?")) {
                    localStorage.removeItem(`suavez_in_queue_${tenant.id}`);
                    window.location.reload();
                  }
                }}
                style={{ 
                  marginTop: '2rem', 
                  background: 'none', 
                  border: 'none', 
                  color: 'var(--text-secondary)', 
                  textDecoration: 'underline', 
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                Entrar com outro perfil
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                <h2 style={{ margin: 0 }}>{prof.joinTitle}</h2>
              </div>
              <form onSubmit={handleJoinQueue}>
                <div className="form-group">
                  <label htmlFor="name">Seu Nome</label>
                  <input 
                    type="text" 
                    id="name" 
                    placeholder="Ex: Pedro Nascimento" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="whatsapp">Seu WhatsApp</label>
                  <input 
                    type="tel" 
                    id="whatsapp" 
                    placeholder="(00) 00000-0000" 
                    value={customerWhatsapp}
                    onChange={handlePhoneChange}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="service">Serviço Desejado</label>
                  <select 
                    id="service" 
                    value={selectedServiceId}
                    onChange={(e) => {
                      setSelectedServiceId(e.target.value);
                      setSelectedTimeSlot('');
                    }}
                  >
                    {tenant.services.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} — R$ {s.price.toFixed(2).replace('.', ',')} {s.duration && tenant.bookingType === 'appointment' ? `(${s.duration} min)` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {tenant.bookingType === 'appointment' && (
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '1.5rem' }}>
                    <div className="form-group" style={{ marginBottom: '1rem' }}>
                      <label htmlFor="date">Data do Agendamento</label>
                      <input 
                        type="date" 
                        id="date" 
                        value={selectedDate}
                        onChange={(e) => {
                          setSelectedDate(e.target.value);
                          setSelectedTimeSlot('');
                        }}
                        min={new Date().toISOString().split('T')[0]}
                        required
                        style={{ background: 'rgba(0,0,0,0.2)' }}
                      />
                    </div>
                    
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Horários Disponíveis</label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px', marginTop: '0.5rem' }}>
                        {getAvailableSlots().length === 0 ? (
                          <div style={{ gridColumn: '1 / -1', fontSize: '0.9rem', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '0.5rem 0' }}>
                            Nenhum horário disponível para esta data.
                          </div>
                        ) : (
                          getAvailableSlots().map(slot => (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => setSelectedTimeSlot(slot)}
                              style={{
                                padding: '8px 4px',
                                borderRadius: '6px',
                                fontSize: '0.9rem',
                                fontWeight: 600,
                                border: selectedTimeSlot === slot ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.1)',
                                background: selectedTimeSlot === slot ? 'rgba(var(--accent-primary-rgb, 234, 179, 8), 0.15)' : 'rgba(255,255,255,0.03)',
                                color: selectedTimeSlot === slot ? 'var(--accent-primary)' : '#fff',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                              }}
                            >
                              {slot}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
                
                <button type="submit" className="btn-submit" disabled={loading}>
                  {loading ? 'Processando...' : (tenant.bookingType === 'appointment' ? 'Agendar Horário' : 'Confirmar Presença')}
                </button>
                
                {tenant.whatsapp && (
                  <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                    <a 
                      href={`https://wa.me/${tenant.whatsapp.replace(/\D/g, '')}?text=Olá,%20acabei%20de%20entrar%20na%20fila!`} 
                      target="_blank" rel="noreferrer"
                      style={{ color: 'var(--success)', fontSize: '0.9rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                      Chamar no WhatsApp
                    </a>
                  </div>
                )}
              </form>
            </>
          )}
        </section>

        {/* Right Side: Queue List */}
        <section className="queue-panel">
          <div className="queue-header">
            <h2>
              {tenant.bookingType === 'appointment' ? 'Agendamentos' : prof.queueTitle} 
              {isAuthenticated && <span className="admin-tag" style={{ background: 'var(--accent-primary)', color: '#111' }}>{prof.professional} Logado(a)</span>}
            </h2>
          </div>
          
          {tenant.bookingType === 'appointment' && isAuthenticated && (
            <div style={{ marginBottom: '1.5rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.5rem' }}>Visualizando Agendamentos do Dia:</label>
              <input 
                type="date" 
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setSelectedTimeSlot('');
                }}
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 12px', borderRadius: '6px', color: '#fff', width: '100%' }}
              />
            </div>
          )}

          <div className="queue-list">
            {(tenant.bookingType === 'appointment' ? queue.filter(q => q.appointmentTime?.startsWith(selectedDate)) : queue).length === 0 ? (
              <div className="empty-state glass-panel fade-in">
                <div className="empty-state-icon">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                </div>
                <h3>{tenant.bookingType === 'appointment' ? 'Sem agendamentos' : 'A fila está livre'}</h3>
                <p>{tenant.bookingType === 'appointment' ? 'Nenhum horário marcado para este dia.' : 'Nenhum cliente aguardando momento.'}</p>
              </div>
            ) : (
              (tenant.bookingType === 'appointment' ? queue.filter(q => q.appointmentTime?.startsWith(selectedDate)).sort((a,b) => (a.appointmentTime || '').localeCompare(b.appointmentTime || '')) : queue).map((item, index) => (
                <div 
                  key={item.id} 
                  className={`queue-item glass-card fade-in ${item.status}`}
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className="queue-position" style={tenant.bookingType === 'appointment' ? { width: '60px', height: '60px', borderRadius: '12px', fontSize: '1rem', display: 'flex', flexDirection: 'column', gap: '2px', lineHeight: 1 } : {}}>
                    {tenant.bookingType === 'appointment' ? (
                      <>
                        <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)' }}>Horário</span>
                        <span style={{ fontWeight: 800 }}>{item.appointmentTime?.split('T')[1]?.substring(0, 5)}</span>
                      </>
                    ) : `${index + 1}º`}
                  </div>
                  
                    <div className="queue-item-info">
                      <h3 style={{ display: 'flex', justifyContent: 'space-between' }}>
                        {item.name}
                        <span style={{ fontSize: '1rem', color: 'var(--success)' }}>R$ {item.price.toFixed(2).replace('.', ',')}</span>
                      </h3>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <div className="queue-service">{item.serviceName}</div>
                        {item.whatsapp && (
                          <div className="queue-service" style={{ color: 'var(--success)', borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)' }}>
                            📱 {item.whatsapp}
                          </div>
                        )}
                      </div>
                    </div>
                  
                  <div className="queue-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                    <div className={`status-badge ${item.status}`}>
                      {item.status === 'serving' ? 'Em Atendimento' : (tenant.bookingType === 'appointment' ? 'Agendado' : 'Aguardando')}
                    </div>
                    {tenant.bookingType !== 'appointment' && (
                      <div className="queue-time">
                        🕒 {formatTimeISO(item.joinedAt)}
                      </div>
                    )}
                    {item.status === 'waiting' && isAuthenticated && index === queue.findIndex(i => i.status === 'waiting') && tenant.bookingType !== 'appointment' && (
                       <button 
                         className="btn-complete"
                         style={{ background: 'var(--accent-primary)', color: '#111' }}
                         onClick={() => handleStartService(item.id)}
                       >
                         ▶ Iniciar
                       </button>
                    )}
                    {item.status === 'ready' && isAuthenticated && tenant.bookingType === 'appointment' && (
                       <button 
                         className="btn-complete"
                         style={{ background: 'var(--accent-primary)', color: '#111' }}
                         onClick={() => handleStartService(item.id)}
                       >
                         ▶ Iniciar
                       </button>
                    )}
                    {item.status === 'serving' && isAuthenticated && (
                       <button 
                         className="btn-complete"
                         onClick={() => handleCompleteService(item.id)}
                       >
                         ✓ Finalizar
                       </button>
                    )}
                    {isAuthenticated && (
                      <button
                        onClick={() => handleRemoveFromQueue(item.id)}
                        style={{
                          marginTop: '0.25rem',
                          padding: '4px 10px',
                          fontSize: '0.75rem',
                          background: 'rgba(239,68,68,0.1)',
                          color: 'var(--danger)',
                          border: '1px solid rgba(239,68,68,0.25)',
                          borderRadius: 'var(--border-radius-sm)',
                          cursor: 'pointer',
                          transition: 'all var(--transition-fast)'
                        }}
                        onMouseOver={e => (e.currentTarget.style.background = 'var(--danger)', e.currentTarget.style.color = '#fff')}
                        onMouseOut={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)', e.currentTarget.style.color = 'var(--danger)')}
                      >
                        ✕ Remover da Fila
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
      )}
    </div>
  );
}

