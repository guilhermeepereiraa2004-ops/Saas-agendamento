import { useState, useEffect } from 'react';
import type { Tenant, Service, Profession } from './types';
import { supabase } from './lib/supabase';
import { PROFESSION_CONFIG } from './lib/professionConfig';
import { useToasts } from './components/ToastProvider';

export default function SuperAdmin() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [showForm, setShowForm] = useState(false);
  
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
  const [services, setServices] = useState<Service[]>([
    { id: '1', name: 'Corte Clássico', price: 40 }
  ]);

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    const { data, error } = await supabase.from('tenants').select('*').order('created_at', { ascending: false });
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
        services: typeof t.services === 'string' ? JSON.parse(t.services) : t.services
      }));
      setTenants(mapped);
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
      services: tenantData.services,
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

  const handleAddService = () => {
    setServices([...services, { id: Math.random().toString(), name: '', price: 0 }]);
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
      services: services.filter(s => s.name.trim() !== '') // Remove empty services
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
    setServices([{ id: Math.random().toString(), name: 'Corte Clássico', price: 40 }]);
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
    setServices(tenant.services.length > 0 ? [...tenant.services] : [{ id: Math.random().toString(), name: '', price: 0 }]);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    <div className="app-container fade-in" style={{ maxWidth: '1000px' }}>
      <header className="header-container glass-panel" style={{ marginBottom: '2rem' }}>
        <div className="brand-section">
          <div className="logo-wrapper" style={{ background: 'linear-gradient(135deg, #10b981, #059669)', borderColor: 'rgba(16,185,129,0.3)', color: '#fff', boxShadow: '0 4px 20px rgba(16,185,129,0.2)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
          </div>
          <div className="brand-info">
            <h1>Sua Vez</h1>
            <p style={{ color: 'var(--success)' }}>Gestão Global Multi-SaaS</p>
          </div>
        </div>
        <button className="btn-submit" style={{ width: 'auto', padding: '12px 24px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', boxShadow: '0 6px 20px rgba(16,185,129,0.3)' }} onClick={() => { resetForm(); setShowForm(true); }}>
          + NOVO CADASTRO
        </button>
      </header>

      {showForm && (
        <form onSubmit={handleSubmit} className="glass-panel" style={{ padding: '2.5rem', marginBottom: '2.5rem' }}>
          <h2 style={{ marginBottom: '1.5rem', color: '#fff' }}>
            {editingTenantId ? 'Editar Perfil' : 'Cadastrar Novo Estabelecimento'}
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div className="form-group">
              <label>Nome do Estabelecimento</label>
              <input type="text" value={name} onChange={e => handleNameChange(e.target.value)} required />
            </div>
            
            <div className="form-group">
              <label>Slug (Subdomínio)</label>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input type="text" value={slug} onChange={e => setSlug(slugify(e.target.value))} required />
              </div>
            </div>
          </div>

          <div className="form-group">
            <label>Número do WhatsApp</label>
            <input type="text" value={whatsapp} onChange={handlePhoneChange} maxLength={15} />
          </div>

          {/* Profession Selector */}
          <div className="form-group">
            <label>Tipo de Estabelecimento</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {(Object.entries(PROFESSION_CONFIG) as [Profession, typeof PROFESSION_CONFIG[Profession]][]).map(([key, cfg]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setProfession(key)}
                  style={{
                    padding: '0.85rem 1rem',
                    borderRadius: 'var(--border-radius-md)',
                    border: profession === key ? '2px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.1)',
                    background: profession === key ? 'rgba(var(--accent-primary-rgb, 234, 179, 8), 0.1)' : 'rgba(255,255,255,0.03)',
                    color: profession === key ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '0.9rem',
                    fontWeight: profession === key ? 600 : 400,
                    transition: 'all 0.2s ease'
                  }}
                >
                  <span dangerouslySetInnerHTML={{ __html: cfg.iconSvg.replace('width="28" height="28"', 'width="20" height="20"').replace('stroke="currentColor"', `stroke="${profession === key ? 'var(--accent-primary)' : 'var(--text-secondary)'}"`) }} />
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          {/* Login Credentials */}
          <div style={{ marginTop: '1.5rem', padding: '1.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--border-radius-md)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <h3 style={{ color: '#fff', fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              {PROFESSION_CONFIG[profession].loginLabel}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Credenciais que o(a) {PROFESSION_CONFIG[profession].professional.toLowerCase()} usará para acessar o painel de gerenciamento.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>E-mail de Acesso</label>
                <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Senha de Acesso</label>
                <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} minLength={6} required />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
            <div className="form-group">
              <label>Possui Logo?</label>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button 
                  type="button" 
                  className={`btn-role ${hasLogo ? 'serving' : ''}`} 
                  onClick={() => setHasLogo(true)}
                  style={{ flex: 1, borderColor: hasLogo ? 'var(--success)' : '' }}
                >Sim</button>
                <button 
                  type="button" 
                  className={`btn-role ${!hasLogo ? 'serving' : ''}`} 
                  onClick={() => setHasLogo(false)}
                  style={{ flex: 1, borderColor: !hasLogo ? 'var(--success)' : '' }}
                >Não</button>
              </div>
            </div>

            {hasLogo && (
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Carregar Logo da Máquina ou URL</label>
                <div style={{ display: 'flex', gap: '1rem', flexDirection: 'column' }}>
                  <input 
                    type="file" 
                    accept="image/*"
                    onChange={handleFileChange}
                    className="btn-role"
                    style={{ padding: '10px' }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', flex: 1 }}></div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>OU</span>
                    <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', flex: 1 }}></div>
                  </div>
                  <input 
                    type="url" 
                    value={logoUrl} 
                    onChange={e => setLogoUrl(e.target.value)} 
                    placeholder="Cole o link da logo aqui (URL)"
                    required={hasLogo && !logoUrl}
                  />
                </div>
                {logoUrl && (
                  <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div className="logo-wrapper" style={{ width: '40px', height: '40px', overflow: 'hidden' }}>
                      <img src={logoUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <span style={{ fontSize: '0.9rem', color: 'var(--success)' }}>Logo carregada com sucesso!</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <div className="form-group" style={{ maxWidth: '300px' }}>
              <label>Cor da Marca (Botões, Ícones e Destaques)</label>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} style={{ width: '50px', height: '50px', padding: '0', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }} />
                <input type="text" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} style={{ flex: 1 }} />
              </div>
            </div>
          </div>

          <div style={{ marginTop: '2rem', marginBottom: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ color: '#fff' }}>Serviços Oferecidos</h3>
              <button type="button" onClick={handleAddService} className="btn-role" style={{ border: '1px solid var(--success)', color: 'var(--success)' }}>+ Adicionar Serviço</button>
            </div>
            
            {services.map((service) => (
              <div key={service.id} style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{ flex: 2 }}>
                  <input 
                    type="text" 
                    value={service.name} 
                    onChange={e => updateService(service.id, 'name', e.target.value)} 
                    placeholder="Nome do serviço (Ex: Degradê)"
                    required
                  />
                </div>
                <div style={{ flex: 1, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '16px', top: '14px', color: 'var(--text-secondary)' }}>R$</span>
                  <input 
                    type="number" 
                    value={service.price || ''} 
                    onChange={e => updateService(service.id, 'price', parseFloat(e.target.value))} 
                    placeholder="0.00"
                    style={{ paddingLeft: '40px' }}
                    required
                    min="0"
                    step="0.01"
                  />
                </div>
                {services.length > 1 && (
                  <button type="button" onClick={() => removeService(service.id)} style={{ padding: '0 1rem', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', borderRadius: 'var(--border-radius-md)', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '2rem' }}>
            <button type="button" onClick={resetForm} className="btn-secondary" style={{ width: 'auto', padding: '12px 30px' }}>Cancelar</button>
            <button type="submit" className="btn-submit" disabled={loading} style={{ width: 'auto', padding: '12px 40px', background: 'var(--success)', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}

      <h2 style={{ marginBottom: '1.5rem', color: '#fff', fontSize: '1.4rem' }}>Estabelecimentos Cadastrados</h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
        {tenants.length === 0 ? (
           <div className="empty-state glass-card" style={{ gridColumn: '1 / -1', padding: '3rem' }}>
             <p>Nenhum estabelecimento cadastrado no SaaS ainda.</p>
           </div>
        ) : (
          tenants.map(tenant => (
            <div key={tenant.id} className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                 <h3 style={{ color: '#fff', fontSize: '1.3rem' }}>{tenant.name}</h3>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <button onClick={() => handleEdit(tenant)} className="btn-role" style={{ padding: '6px 10px', fontSize: '0.7rem', borderColor: 'rgba(255,255,255,0.15)' }}>Editar</button>
                    <button 
                      onClick={() => handleDelete(tenant.id, tenant.name)} 
                      className="btn-role" 
                      style={{ 
                        padding: '6px', 
                        borderColor: 'rgba(239, 68, 68, 0.2)', 
                        color: 'var(--danger)',
                        background: 'rgba(239, 68, 68, 0.05)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                      }}
                      title="Excluir Estabelecimento"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                    <a href={`/${tenant.slug}`} target="_blank" className="status-badge serving" style={{ textDecoration: 'none', background: 'rgba(16,185,129,0.1)', color: 'var(--success)', whiteSpace: 'nowrap', fontSize: '0.7rem', height: '28px', display: 'flex', alignItems: 'center' }}>Acessar</a>
                  </div>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                   Link de acesso: /{tenant.slug}
                 </div>
                 {tenant.whatsapp && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                      {tenant.whatsapp}
                    </div>
                 )}
                 <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    {tenant.services.length} Serviço(s) Ativos
                 </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
