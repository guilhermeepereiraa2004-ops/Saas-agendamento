import { useState, useEffect } from 'react';
import type { Tenant, Service, Profession } from './types';
import { supabase } from './lib/supabase';
import { PROFESSION_CONFIG } from './lib/professionConfig';
import { useToasts } from './components/ToastProvider';
import './SuperAdminRedesign.css';

export default function SuperAdmin() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [showForm, setShowForm] = useState(false);
  
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [showFinancialModal, setShowFinancialModal] = useState(false);
  const [financialEditingTenant, setFinancialEditingTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'tenants' | 'financial' | 'settings'>('tenants');
  const [pixKey, setPixKey] = useState('');
  const [pixName, setPixName] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { showToast } = useToasts();
  
  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#eab308');
  const [hasLogo, setHasLogo] = useState(false);
  const [logoUrl, setLogoUrl] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [profession, setProfession] = useState<Profession>('barber');
  const [bookingType, setBookingType] = useState<'queue' | 'appointment'>('queue');
  
  // SaaS Financial Fields
  const [subscriptionStatus, setSubscriptionStatus] = useState<Tenant['subscriptionStatus']>('trial');
  const [nextPaymentAt, setNextPaymentAt] = useState('');
  const [paymentDay, setPaymentDay] = useState(10);
  const [monthlyFee, setMonthlyFee] = useState(59.90);
  const [workingHours, setWorkingHours] = useState<{day: number, start: string, end: string}[]>([
    { day: 1, start: '09:00', end: '18:00' },
    { day: 2, start: '09:00', end: '18:00' },
    { day: 3, start: '09:00', end: '18:00' },
    { day: 4, start: '09:00', end: '18:00' },
    { day: 5, start: '09:00', end: '18:00' },
    { day: 6, start: '09:00', end: '14:00' },
  ]);
  const [services, setServices] = useState<Service[]>([
    { id: '1', name: 'Corte Clássico', price: 40, duration: 30 }
  ]);

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    // Fetch tenants
    const { data, error } = await supabase.from('tenants').select('*').order('created_at', { ascending: false });
    
    // Fetch settings
    const { data: settingsData } = await supabase.from('platform_settings').select('*').limit(1).single();
    if (settingsData) {
      if (settingsData.pix_key) setPixKey(settingsData.pix_key);
      if (settingsData.pix_name) setPixName(settingsData.pix_name);
    }
    if (error) {
      console.error('Error fetching tenants:', error);
    } else if (data) {
      const mapped = data.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        whatsapp: t.whatsapp,
        primaryColor: t.primary_color,
        hasLogo: t.has_logo,
        logoUrl: t.logo_url,
        loginEmail: t.login_email,
        loginPassword: t.login_password,
        profession: t.profession || 'barber',
        bookingType: t.booking_type || 'queue',
        subscriptionStatus: t.subscription_status || 'trial',
        nextPaymentAt: t.next_payment_at ? t.next_payment_at.split('T')[0] : '',
        paymentDay: t.payment_day || 10,
        monthlyFee: parseFloat(t.monthly_fee || 0),
        workingHours: typeof t.working_hours === 'string' ? JSON.parse(t.working_hours) : (t.working_hours || []),
        services: typeof t.services === 'string' ? JSON.parse(t.services) : t.services,
        isActive: t.is_active !== false, // default true if not set
      }));
      setTenants(mapped);
    }
  };

  const handleToggleActive = async (tenantId: string, currentState: boolean, tenantName: string) => {
    const next = !currentState;
    const { error } = await supabase.from('tenants').update({ is_active: next }).eq('id', tenantId);
    if (error) {
      showToast('Erro ao atualizar status: ' + error.message, 'error');
    } else {
      showToast(
        next ? `✅ ${tenantName} ativado com sucesso!` : `🔒 ${tenantName} suspenso. O subdomínio está offline.`,
        next ? 'success' : 'error'
      );
      fetchTenants();
    }
  };

  const saveTenantToSupabase = async (tenantData: any) => {
    setLoading(true);
    const dbData = {
      name: tenantData.name,
      slug: tenantData.slug,
      whatsapp: tenantData.whatsapp,
      primary_color: tenantData.primaryColor,
      has_logo: tenantData.hasLogo,
      logo_url: tenantData.logoUrl,
      login_email: tenantData.loginEmail,
      login_password: tenantData.loginPassword,
      profession: tenantData.profession,
      booking_type: tenantData.bookingType,
      working_hours: tenantData.workingHours,
      services: tenantData.services,
      subscription_status: tenantData.subscriptionStatus,
      next_payment_at: tenantData.nextPaymentAt ? new Date(tenantData.nextPaymentAt).toISOString() : null,
      payment_day: tenantData.paymentDay,
      monthly_fee: tenantData.monthlyFee
    };

    let error;
    if (editingTenantId) {
      const { error: err } = await supabase.from('tenants').update(dbData).eq('id', editingTenantId);
      error = err;
    } else {
      const { error: err } = await supabase.from('tenants').insert([dbData]);
      error = err;
    }

    setLoading(false);
    if (error) {
      showToast('Erro ao salvar no banco de dados: ' + error.message, 'error');
      return false;
    }
    
    showToast('Configurações salvas com sucesso!', 'success');
    await fetchTenants();
    return true;
  };

  const handleSaveSettings = async () => {
    setLoading(true);
    const { data } = await supabase.from('platform_settings').select('id').limit(1).single();
    
    let error;
    if (data) {
      const { error: updateError } = await supabase.from('platform_settings').update({ 
        pix_key: pixKey,
        pix_name: pixName 
      }).eq('id', data.id);
      error = updateError;
    } else {
      const { error: insertError } = await supabase.from('platform_settings').insert([{ 
        pix_key: pixKey,
        pix_name: pixName 
      }]);
      error = insertError;
    }
    
    setLoading(false);
    if (error) {
      showToast('Erro ao salvar configurações: ' + error.message, 'error');
    } else {
      showToast('Configurações salvas com sucesso!', 'success');
    }
  };

  const handleAddService = () => {
    setServices([...services, { id: Math.random().toString(), name: '', price: 0, duration: 30 }]);
  };

  const updateService = (id: string, field: keyof Service, value: string | number) => {
    setServices(services.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const removeService = (id: string) => {
    setServices(services.filter(s => s.id !== id));
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`TEM CERTEZA? Isso excluirá permanentemente o estabelecimento "${name}" e todos os seus dados!`)) {
      return;
    }

    setLoading(true);
    const { error } = await supabase.from('tenants').delete().eq('id', id);
    setLoading(false);

    if (error) {
      showToast('Erro ao excluir: ' + error.message, 'error');
    } else {
      showToast('Estabelecimento excluído com sucesso!', 'success');
      await fetchTenants();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !slug) return;
    
    // Check if slug exists
    if (tenants.some(t => t.slug === slug && t.id !== editingTenantId)) {
      showToast('Este subdomínio (slug) já está em uso.', 'warning');
      return;
    }

    const modifiedTenant = {
      name,
      slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      whatsapp,
      primaryColor,
      hasLogo,
      logoUrl: hasLogo ? logoUrl : '',
      loginEmail,
      loginPassword,
      profession,
      bookingType,
      workingHours,
      services: services.filter(s => s.name.trim() !== ''),
      subscriptionStatus,
      nextPaymentAt,
      paymentDay,
      monthlyFee
    };

    const success = await saveTenantToSupabase(modifiedTenant);
    if (success) {
      resetForm();
    }
  };

  const slugify = (text: string) => {
    return text
      .toString()
      .normalize('NFD')                   // divide letras acentuadas
      .replace(/[\u0300-\u036f]/g, '')     // remove acentos
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '')                 // remove todos os espaços
      .replace(/[^a-z0-9]/g, '');          // remove tudo que não for letra ou número
  };

  const handleNameChange = (newName: string) => {
    const oldSlug = slugify(name);
    setName(newName);
    
    // Auto-update slug ONLY if slug is empty or it was auto-generated from the previous name
    if (!slug || slug === oldSlug) {
      setSlug(slugify(newName));
    }
  };

  const formatPhone = (value: string) => {
    if (!value) return value;
    const phoneNumber = value.replace(/\D/g, '');
    const phoneNumberLength = phoneNumber.length;
    if (phoneNumberLength < 3) return phoneNumber;
    if (phoneNumberLength < 7) {
      return `(${phoneNumber.slice(0, 2)}) ${phoneNumber.slice(2)}`;
    }
    return `(${phoneNumber.slice(0, 2)}) ${phoneNumber.slice(
      2,
      7
    )}-${phoneNumber.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formattedValue = formatPhone(e.target.value);
    setWhatsapp(formattedValue);
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingTenantId(null);
    setName('');
    setSlug('');
    setWhatsapp('');
    setPrimaryColor('#eab308');
    setHasLogo(false);
    setLogoUrl('');
    setLoginEmail('');
    setLoginPassword('');
    setProfession('barber');
    setBookingType('queue');
    setWorkingHours([
      { day: 1, start: '09:00', end: '18:00' },
      { day: 2, start: '09:00', end: '18:00' },
      { day: 3, start: '09:00', end: '18:00' },
      { day: 4, start: '09:00', end: '18:00' },
      { day: 5, start: '09:00', end: '18:00' },
      { day: 6, start: '09:00', end: '14:00' },
    ]);
    setServices([{ id: Math.random().toString(), name: 'Corte Clássico', price: 40, duration: 30 }]);
    setSubscriptionStatus('trial');
    setNextPaymentAt('');
    setPaymentDay(10);
    setMonthlyFee(59.90);
  };

  const handleEdit = (tenant: Tenant) => {
    setEditingTenantId(tenant.id);
    setName(tenant.name);
    setSlug(tenant.slug);
    setWhatsapp(tenant.whatsapp || '');
    setPrimaryColor(tenant.primaryColor || '#eab308');
    setHasLogo(tenant.hasLogo || false);
    setLogoUrl(tenant.logoUrl || '');
    setLoginEmail(tenant.loginEmail || '');
    setLoginPassword(tenant.loginPassword || '');
    setProfession(tenant.profession || 'barber');
    setBookingType(tenant.bookingType || 'queue');
    if (tenant.workingHours && tenant.workingHours.length > 0) {
      setWorkingHours(tenant.workingHours);
    } else {
      setWorkingHours([
        { day: 1, start: '09:00', end: '18:00' },
        { day: 2, start: '09:00', end: '18:00' },
        { day: 3, start: '09:00', end: '18:00' },
        { day: 4, start: '09:00', end: '18:00' },
        { day: 5, start: '09:00', end: '18:00' },
        { day: 6, start: '09:00', end: '14:00' },
      ]);
    }
    setServices(tenant.services.length > 0 ? [...tenant.services] : [{ id: Math.random().toString(), name: '', price: 0, duration: 30 }]);
    setSubscriptionStatus(tenant.subscriptionStatus || 'trial');
    setNextPaymentAt(tenant.nextPaymentAt || '');
    setPaymentDay(tenant.paymentDay || 10);
    setMonthlyFee(tenant.monthlyFee || 59.90);
    setActiveTab('tenants');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenFinancialMode = (tenant: Tenant) => {
    setFinancialEditingTenant(tenant);
    setMonthlyFee(tenant.monthlyFee || 59.90);
    setNextPaymentAt(tenant.nextPaymentAt || '');
    setPaymentDay(tenant.paymentDay || 10);
    setSubscriptionStatus(tenant.subscriptionStatus || 'trial');
    setShowFinancialModal(true);
  };

  const handleQuickFinancialUpdate = async () => {
    if (!financialEditingTenant) return;
    
    setLoading(true);
    const { error } = await supabase.from('tenants').update({
      subscription_status: subscriptionStatus,
      payment_day: paymentDay,
      monthly_fee: monthlyFee
    }).eq('id', financialEditingTenant.id);
    
    setLoading(false);
    if (error) {
      showToast('Erro ao atualizar financeiro: ' + error.message, 'error');
    } else {
      showToast('Financeiro atualizado com sucesso!', 'success');
      setShowFinancialModal(false);
      await fetchTenants();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className={`admin-layout fade-in ${isMobileMenuOpen ? 'mobile-menu-open' : ''}`}>
      {/* Sidebar Redesign */}
      <aside className={`admin-sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
          </div>
          <div className="sidebar-brand-info">
            <h1>Sua Vez</h1>
            <p>GESTÃO MULTI-SAAS</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'tenants' ? 'active' : ''}`}
            onClick={() => { setActiveTab('tenants'); setShowForm(false); setIsMobileMenuOpen(false); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            <span className="nav-text">Estabelecimentos</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'financial' ? 'active' : ''}`}
            onClick={() => { setActiveTab('financial'); setShowForm(false); setIsMobileMenuOpen(false); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
            <span className="nav-text">SaaS Financeiro</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => { setActiveTab('settings'); setShowForm(false); setIsMobileMenuOpen(false); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            <span className="nav-text">Configurações</span>
          </button>
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: '2rem' }}>
          <div className="nav-item" style={{ cursor: 'default', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifySelf: 'center', color: '#000', fontWeight: 'bold', fontSize: '0.8rem', justifyContent: 'center' }}>AD</div>
            <div className="nav-text" style={{ marginLeft: '10px' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>Admin Global</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Master Access</div>
            </div>
          </div>
        </div>
      </aside>
      {isMobileMenuOpen && <div className="mobile-backdrop" onClick={() => setIsMobileMenuOpen(false)} />}

      {/* Main Content Area */}
      <main className="admin-content">
        <header className="content-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="mobile-toggle" onClick={() => setIsMobileMenuOpen(true)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
            <div>
              <h2>{activeTab === 'tenants' ? 'Gestão de Estabelecimentos' : activeTab === 'settings' ? 'Configurações Globais' : 'Controle Financeiro SaaS'}</h2>
              <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
                {activeTab === 'tenants' ? 'Visualize e gerencie todos os clientes da plataforma.' : activeTab === 'settings' ? 'Ajuste os dados globais do seu SaaS, como chaves de recebimento PIX.' : 'Acompanhe a saúde financeira e assinaturas do seu SaaS.'}
              </p>
            </div>
          </div>
          {activeTab === 'tenants' && !showForm && (
            <button className="btn-premium btn-premium-primary" onClick={() => { resetForm(); setShowForm(true); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Novo Cadastro
            </button>
          )}
        </header>

        {activeTab === 'tenants' ? (
          <>
            {showForm ? (
              <div className="fade-in">
                <button 
                  onClick={() => setShowForm(false)} 
                  style={{ background: 'transparent', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.5rem', fontSize: '0.9rem', fontWeight: 500 }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                  Voltar para lista
                </button>

                <form onSubmit={handleSubmit} className="premium-card" style={{ padding: '2.5rem', marginBottom: '2.5rem' }}>
                  <h2 style={{ marginBottom: '2rem', fontSize: '1.5rem' }}>
                    {editingTenantId ? 'Editar Estabelecimento' : 'Novo Cadastro'}
                  </h2>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    <div className="form-group">
                      <label>Nome do Estabelecimento</label>
                      <input type="text" value={name} onChange={e => handleNameChange(e.target.value)} required placeholder="Ex: Barbearia do João" />
                    </div>
                    
                    <div className="form-group">
                      <label>Slug (Subdomínio único)</label>
                      <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '16px', color: '#64748b', fontSize: '0.9rem', zIndex: 10 }}>/</span>
                        <input type="text" value={slug} onChange={e => setSlug(slugify(e.target.value))} required style={{ paddingLeft: '32px' }} placeholder="barbearia-joao" />
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
                    <div className="form-group">
                      <label>WhatsApp de Contato</label>
                      <input type="text" value={whatsapp} onChange={handlePhoneChange} maxLength={15} placeholder="(00) 00000-0000" />
                    </div>

                    <div className="form-group">
                      <label>Tipo de Negócio</label>
                      <div style={{ position: 'relative' }}>
                        <select value={profession} onChange={e => setProfession(e.target.value as Profession)} style={{ appearance: 'none' }}>
                          {(Object.entries(PROFESSION_CONFIG) as [Profession, typeof PROFESSION_CONFIG[Profession]][]).map(([key, cfg]) => (
                            <option key={key} value={key}>{cfg.label}</option>
                          ))}
                        </select>
                        <div style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Login Credentials Box */}
                  <div className="admin-credential-box">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.1rem', margin: 0, color: '#0f172a' }}>Acesso Administrativo</h3>
                        <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0 0 0' }}>Credenciais para o painel do {PROFESSION_CONFIG[profession].professional.toLowerCase()}</p>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>E-mail de Login</label>
                        <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required placeholder="admin@exemplo.com" />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>Senha de Login</label>
                        <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} minLength={6} required placeholder="••••••••" />
                      </div>
                    </div>
                  </div>

                  {/* Visual & Configuration */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '2rem' }}>
                    <div className="form-group">
                      <label>Identidade Visual (Logo)</label>
                      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                        <button type="button" onClick={() => setHasLogo(true)} className={`btn-premium ${hasLogo ? 'btn-premium-primary' : 'btn-premium-secondary'}`} style={{ flex: 1 }}>Sim, possui</button>
                        <button type="button" onClick={() => setHasLogo(false)} className={`btn-premium ${!hasLogo ? 'btn-premium-primary' : 'btn-premium-secondary'}`} style={{ flex: 1 }}>Não possui</button>
                      </div>
                      
                      {hasLogo && (
                        <div className="fade-in">
                          <input type="file" accept="image/*" onChange={handleFileChange} style={{ marginBottom: '0.75rem' }} />
                          <input type="url" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="Ou cole a URL da imagem aqui" />
                          {logoUrl && (
                            <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(16,185,129,0.05)', borderRadius: '12px', border: '1px solid rgba(16,185,129,0.2)' }}>
                              <img src={logoUrl} alt="Preview" style={{ width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover' }} />
                              <span style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 600 }}>Logo vinculada com sucesso!</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="form-group">
                      <label>Cor de Destaque da Marca</label>
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <div style={{ position: 'relative', width: '54px', height: '54px' }}>
                          <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} style={{ width: '100%', height: '100%', padding: '0', border: 'none', borderRadius: '12px', cursor: 'pointer', background: 'transparent' }} />
                          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', borderRadius: '12px', pointerEvents: 'none', border: '2px solid rgba(255,255,255,0.1)' }}></div>
                        </div>
                        <input type="text" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} placeholder="#000000" style={{ flex: 1 }} />
                      </div>
                    </div>
                  </div>

                  {/* Atendimento Modelo */}
                  <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <h3 style={{ marginBottom: '1.25rem', fontSize: '1.1rem' }}>Modelo de Atendimento</h3>
                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                      <button 
                        type="button" 
                        onClick={() => setBookingType('queue')}
                        className={`btn-premium ${bookingType === 'queue' ? 'btn-premium-primary' : 'btn-premium-secondary'}`}
                        style={{ flex: 1, height: '60px' }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        Fila Virtual (Ordem de Chegada)
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setBookingType('appointment')}
                        className={`btn-premium ${bookingType === 'appointment' ? 'btn-premium-primary' : 'btn-premium-secondary'}`}
                        style={{ flex: 1, height: '60px' }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        Horário Marcado (Agenda)
                      </button>
                    </div>

                    {bookingType === 'appointment' && (
                      <div className="fade-in" style={{ background: 'rgba(255,255,255,0.015)', padding: '2rem', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.04)' }}>
                        <h4 style={{ marginBottom: '1.5rem', fontSize: '1rem', fontWeight: 600 }}>Configurar Horários da Semana</h4>
                        <div style={{ display: 'grid', gap: '1rem' }}>
                          {['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'].map((dayName, idx) => {
                            const dayNum = idx === 6 ? 0 : idx + 1;
                            const wh = workingHours.find(h => h.day === dayNum);
                            const isWorking = !!wh;
                            
                            return (
                              <div key={dayNum} style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '12px 16px', background: isWorking ? 'rgba(255,255,255,0.02)' : 'transparent', borderRadius: '12px', border: '1px solid', borderColor: isWorking ? 'rgba(255,255,255,0.05)' : 'transparent' }}>
                                <label style={{ width: '120px', margin: 0, display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={isWorking} 
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setWorkingHours([...workingHours, { day: dayNum, start: '09:00', end: '18:00' }].sort((a,b) => a.day - b.day));
                                      } else {
                                        setWorkingHours(workingHours.filter(h => h.day !== dayNum));
                                      }
                                    }} 
                                    style={{ width: '20px', height: '20px', accentColor: 'var(--success)' }}
                                  />
                                  <span style={{ fontWeight: isWorking ? 700 : 400 }}>{dayName}</span>
                                </label>
                                {isWorking && wh ? (
                                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <input type="time" value={wh.start} onChange={e => setWorkingHours(workingHours.map(h => h.day === dayNum ? { ...h, start: e.target.value } : h))} style={{ width: '130px' }} />
                                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>até</span>
                                    <input type="time" value={wh.end} onChange={e => setWorkingHours(workingHours.map(h => h.day === dayNum ? { ...h, end: e.target.value } : h))} style={{ width: '130px' }} />
                                  </div>
                                ) : (
                                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', opacity: 0.5 }}>Estabelecimento fechado</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Services */}
                  <div style={{ marginTop: '2.5rem', paddingTop: '2.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Menu de Serviços</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Defina o que será oferecido aos clientes</p>
                      </div>
                      <button type="button" onClick={handleAddService} className="btn-premium btn-premium-secondary" style={{ border: '1px solid rgba(16,185,129,0.3)', color: 'var(--success)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        Novo Serviço
                      </button>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {services.map((service) => (
                        <div key={service.id} className="fade-in" style={{ display: 'flex', gap: '1rem', background: 'rgba(255,255,255,0.01)', padding: '12px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.03)' }}>
                          <div style={{ flex: 3 }}>
                            <input type="text" value={service.name} onChange={e => updateService(service.id, 'name', e.target.value)} placeholder="Nome do serviço (Ex: Corte Masculino)" required />
                          </div>
                          <div style={{ flex: 1, position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '16px', top: '14px', color: 'var(--text-secondary)', fontWeight: 600 }}>R$</span>
                            <input type="number" value={service.price || ''} onChange={e => updateService(service.id, 'price', parseFloat(e.target.value))} placeholder="0.00" style={{ paddingLeft: '45px' }} required min="0" step="0.01" />
                          </div>
                          {bookingType === 'appointment' && (
                            <div style={{ flex: 1, position: 'relative' }}>
                              <span style={{ position: 'absolute', right: '16px', top: '14px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>min</span>
                              <input type="number" value={service.duration || ''} onChange={e => updateService(service.id, 'duration', parseInt(e.target.value))} placeholder="30" style={{ paddingRight: '45px' }} required={bookingType === 'appointment'} min="5" step="5" />
                            </div>
                          )}
                          {services.length > 1 && (
                            <button type="button" onClick={() => removeService(service.id)} className="btn-premium-danger" style={{ width: '48px', padding: 0, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Financial Setup within form */}
                  <div style={{ marginTop: '2.5rem', paddingTop: '2.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <h3 style={{ marginBottom: '1.5rem', fontSize: '1.1rem' }}>Configuração de Assinatura</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
                       <div className="form-group">
                         <label>Mensalidade (R$)</label>
                         <input type="number" value={monthlyFee} onChange={e => setMonthlyFee(parseFloat(e.target.value))} step="0.01" />
                       </div>
                       <div className="form-group">
                         <label>Data de Vencimento</label>
                         <input type="date" value={nextPaymentAt} onChange={e => setNextPaymentAt(e.target.value)} />
                       </div>
                       <div className="form-group">
                         <label>Status</label>
                         <select value={subscriptionStatus} onChange={e => setSubscriptionStatus(e.target.value as any)}>
                           <option value="active">Ativo</option>
                           <option value="overdue">Atrasado</option>
                           <option value="pending">Pendente</option>
                           <option value="trial">Período de Teste</option>
                         </select>
                       </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '3rem' }}>
                    <button type="button" onClick={resetForm} className="btn-premium btn-premium-secondary" style={{ padding: '14px 30px' }}>Descartar</button>
                    <button type="submit" className="btn-premium btn-premium-primary" disabled={loading} style={{ padding: '14px 50px', minWidth: '180px' }}>
                      {loading ? 'Salvando...' : 'Finalizar Cadastro'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="tenant-grid fade-in">
                {tenants.length === 0 ? (
                  <div className="glass-panel" style={{ gridColumn: '1 / -1', padding: '5rem', textAlign: 'center' }}>
                    <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    </div>
                    <h3 style={{ color: 'white', fontSize: '1.25rem', marginBottom: '0.5rem' }}>Nenhum estabelecimento encontrado</h3>
                    <p style={{ color: 'var(--text-secondary)' }}>Comece cadastrando seu primeiro cliente multi-saas.</p>
                    <button className="btn-premium btn-premium-primary" style={{ marginTop: '2rem', marginInline: 'auto' }} onClick={() => setShowForm(true)}>+ Criar Primeiro Cadastro</button>
                  </div>
                ) : (
                  tenants.map(tenant => (
                    <div key={tenant.id} className="premium-card">
                      <div className="card-header">
                        <div>
                          <div className="card-title">{tenant.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 700, textTransform: 'uppercase', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }}></div>
                            {PROFESSION_CONFIG[tenant.profession || 'barber'].label}
                          </div>
                        </div>
                        <div className={`card-badge ${tenant.subscriptionStatus === 'active' ? 'status-badge serving' : 'status-badge'}`} style={{ 
                          background: tenant.subscriptionStatus === 'active' ? 'rgba(16,185,129,0.1)' : 'rgba(239, 68, 68, 0.1)',
                          color: tenant.subscriptionStatus === 'active' ? '#10b981' : '#ef4444',
                          border: 'none',
                          padding: '6px 12px'
                        }}>
                          {tenant.subscriptionStatus === 'active' ? 'Ativo' : 'Pendente'}
                        </div>
                      </div>
                      
                      <div className="card-content">
                        <div className="card-info-item">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                          <span>/{tenant.slug}</span>
                        </div>
                        <div className="card-info-item">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                          <span>{tenant.whatsapp || 'Sem contato'}</span>
                        </div>
                        <div className="card-info-item">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                          <span>{tenant.services.length} Serviço(s) Ativos</span>
                        </div>
                        <div className="card-info-item">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                          <span>{tenant.bookingType === 'appointment' ? 'Agenda/Horário Marcado' : 'Fila de Espera'}</span>
                        </div>
                      </div>

                      <div className="card-actions">
                        <button onClick={() => handleEdit(tenant)} className="btn-premium btn-premium-secondary" style={{ flex: 1 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                          Editar
                        </button>
                        <button
                          onClick={() => handleToggleActive(tenant.id, tenant.isActive !== false, tenant.name)}
                          className="btn-premium"
                          style={{
                            flex: 1,
                            background: tenant.isActive !== false ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                            color: tenant.isActive !== false ? '#ef4444' : '#10b981',
                            border: `1px solid ${tenant.isActive !== false ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
                          }}
                        >
                          {tenant.isActive !== false ? (
                            <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                              Suspender
                            </>
                          ) : (
                            <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
                              Ativar
                            </>
                          )}
                        </button>
                        <a href={`/${tenant.slug}`} target="_blank" className="btn-premium btn-premium-primary" style={{ textDecoration: 'none', flex: 1 }}>
                          Acessar
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>
                        </a>
                        <button
                          onClick={() => handleDelete(tenant.id, tenant.name)}
                          className="btn-premium btn-premium-danger"
                          title="Excluir"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        ) : activeTab === 'settings' ? (
          <div className="fade-in">
            <div className="premium-card" style={{ padding: '2.5rem', maxWidth: '600px' }}>
              <h3 style={{ marginBottom: '0.5rem', fontSize: '1.25rem' }}>Dados para Recebimento</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem' }}>
                Configure a chave PIX que os assinantes (estabelecimentos) verão quando a mensalidade deles vencer.
              </p>
              
              <div className="form-group">
                <label>Nome do Beneficiário (PIX)</label>
                <input 
                  type="text" 
                  value={pixName} 
                  onChange={e => setPixName(e.target.value)} 
                  placeholder="Nome completo ou da empresa" 
                />
              </div>

              <div className="form-group">
                <label>Sua Chave PIX</label>
                <input 
                  type="text" 
                  value={pixKey} 
                  onChange={e => setPixKey(e.target.value)} 
                  placeholder="E-mail, CPF/CNPJ, Telefone ou Chave Aleatória" 
                />
              </div>

              <div style={{ marginTop: '2rem' }}>
                <button 
                  onClick={handleSaveSettings} 
                  className="btn-premium btn-premium-primary" 
                  disabled={loading}
                >
                  {loading ? 'Salvando...' : 'Salvar Configurações'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="fade-in">
            {/* Stats Overview */}
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                </div>
                <div className="stat-info">
                  <span className="stat-label">Faturamento MRR</span>
                  <span className="stat-value">R$ {tenants.reduce((acc, curr) => acc + (curr.monthlyFee || 0), 0).toFixed(2)}</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                </div>
                <div className="stat-info">
                  <span className="stat-label">Assinantes Ativos</span>
                  <span className="stat-value">{tenants.filter(t => t.subscriptionStatus === 'active').length}</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                </div>
                <div className="stat-info">
                  <span className="stat-label">Inadimplentes</span>
                  <span className="stat-value">{tenants.filter(t => t.subscriptionStatus === 'overdue').length}</span>
                </div>
              </div>
            </div>

            <div className="premium-table-container">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Estabelecimento</th>
                    <th>Valor Mensal</th>
                    <th>Vencimento</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>AÇÕES</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map(tenant => (
                    <tr key={tenant.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{tenant.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>/{tenant.slug}</div>
                      </td>
                      <td style={{ fontWeight: 600 }}>R$ {tenant.monthlyFee?.toFixed(2)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                          Dia {tenant.paymentDay || 10}
                        </div>
                      </td>
                      <td>
                        <span style={{ 
                          padding: '6px 12px', 
                          borderRadius: '8px', 
                          fontSize: '0.7rem', 
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          background: 
                            tenant.subscriptionStatus === 'active' ? 'rgba(16,185,129,0.1)' : 
                            tenant.subscriptionStatus === 'overdue' ? 'rgba(239,68,68,0.1)' : 
                            'rgba(255,255,255,0.05)',
                          color: 
                            tenant.subscriptionStatus === 'active' ? '#10b981' : 
                            tenant.subscriptionStatus === 'overdue' ? '#ef4444' : 
                            '#fff'
                        }}>
                          {tenant.subscriptionStatus === 'active' ? 'Em dia' : 
                           tenant.subscriptionStatus === 'overdue' ? 'Atrasado' : 
                           tenant.subscriptionStatus === 'trial' ? 'Teste' : 'Pendente'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button 
                          onClick={() => handleOpenFinancialMode(tenant)}
                          className="btn-premium btn-premium-secondary"
                          style={{ padding: '8px 12px', fontSize: '0.75rem', marginLeft: 'auto' }}
                        >
                          Gerenciar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Financial Modal Redesign */}
      {showFinancialModal && financialEditingTenant && (
        <div className="modal-overlay fade-in" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div className="glass-panel" style={{ maxWidth: '500px', width: '100%', padding: '2.5rem', position: 'relative', boxShadow: '0 30px 60px rgba(0,0,0,0.5)' }}>
            <button onClick={() => setShowFinancialModal(false)} style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'transparent', color: 'var(--text-secondary)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <div style={{ width: '60px', height: '60px', borderRadius: '18px', background: 'linear-gradient(135deg, #10b981, #059669)', margin: '0 auto 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
              </div>
              <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Gerenciar Assinatura</h2>
              <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>{financialEditingTenant.name}</p>
            </div>

            <div style={{ display: 'grid', gap: '1.5rem' }}>
              <div className="form-group">
                <label>Valor Mensal</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '16px', top: '14px', color: 'var(--text-secondary)', fontWeight: 600 }}>R$</span>
                  <input type="number" value={monthlyFee} onChange={e => setMonthlyFee(parseFloat(e.target.value))} step="0.01" style={{ paddingLeft: '45px' }} />
                </div>
              </div>

              <div className="form-group">
                <label>Dia do Pagamento</label>
                <input type="number" value={paymentDay} onChange={e => setPaymentDay(parseInt(e.target.value))} min="1" max="31" />
              </div>

              <div className="form-group">
                <label>Status do Pagamento</label>
                <select value={subscriptionStatus} onChange={e => setSubscriptionStatus(e.target.value as any)}>
                  <option value="active">Ativo (Em dia)</option>
                  <option value="overdue">Atrasado (Inadimplente)</option>
                  <option value="pending">Pendente</option>
                  <option value="trial">Período de Teste</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2.5rem' }}>
              <button onClick={() => setShowFinancialModal(false)} className="btn-premium btn-premium-secondary" style={{ flex: 1 }}>Cancelar</button>
              <button onClick={handleQuickFinancialUpdate} disabled={loading} className="btn-premium btn-premium-primary" style={{ flex: 2 }}>
                {loading ? 'Processando...' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
