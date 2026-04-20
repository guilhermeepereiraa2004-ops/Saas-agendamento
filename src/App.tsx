import { useState, useEffect } from 'react';
import './App.css';
import type { Tenant } from './types';
import SuperAdmin from './SuperAdmin';
import TenantApp from './TenantApp';
import { supabase } from './lib/supabase';
import { ToastProvider } from './components/ToastProvider';
import { OneSignalInitializer, loginOneSignal, requestNotificationPermission } from './components/OneSignalInitializer';

function App() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPath] = useState(window.location.pathname);
  const [isAdminAuth, setIsAdminAuth] = useState(localStorage.getItem('admin_auth') === 'true');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  useEffect(() => {
    const fetchTenants = async () => {
      const { data, error } = await supabase.from('tenants').select('*');
      if (error) {
        console.error('Erro ao buscar estabelecimentos:', error);
        setIsLoading(false);
        return;
      }
      
      if (data && data.length > 0) {
        const mappedTenants: Tenant[] = data.map(t => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          whatsapp: t.whatsapp,
          primaryColor: t.primary_color,
          hasLogo: t.has_logo,
          logoUrl: t.logo_url,
          loginEmail: t.login_email,
          loginPassword: t.login_password,
          services: typeof t.services === 'string' ? JSON.parse(t.services) : t.services,
          profession: t.profession,
          isOnline: t.is_online ?? true,
          bookingType: t.booking_type || 'queue',
          workingHours: typeof t.working_hours === 'string' ? JSON.parse(t.working_hours) : (t.working_hours || [])
        }));
        setTenants(mappedTenants);
      }
      setIsLoading(false);
    };

    fetchTenants();
  }, []);

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminEmail === 'gestaomulti@gmail.com' && adminPassword === 'naoseinao') {
      setIsAdminAuth(true);
      localStorage.setItem('admin_auth', 'true');
      
      // Login no OneSignal para o Super Admin
      loginOneSignal('super_admin');
      requestNotificationPermission();
    } else {
      alert('Credenciais administrativas inválidas!');
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#09090b' }}>
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <div style={{ width: '48px', height: '48px', border: '3px solid rgba(255,255,255,0.1)', borderTop: '3px solid #10b981', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }}></div>
          <p style={{ fontSize: '0.9rem' }}>Carregando...</p>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (currentPath === '/admin') {
      if (!isAdminAuth) {
        return (
          <div className="home-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#09090b' }}>
            <div className="glass-panel fade-in" style={{ padding: '3rem', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
              <div style={{ width: '50px', height: '50px', background: 'linear-gradient(135deg, #10b981, #3b82f6)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              </div>
              <h2 style={{ color: '#fff', marginBottom: '0.5rem' }}>Sua Vez</h2>
              <p style={{ color: '#a1a1aa', marginBottom: '2rem', fontSize: '0.9rem' }}>Acesso Administrativo</p>
              
              <form onSubmit={handleAdminLogin} style={{ textAlign: 'left' }}>
                <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', color: '#a1a1aa', fontSize: '0.8rem', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>E-mail Master</label>
                  <input 
                    type="email" 
                    value={adminEmail} 
                    onChange={(e) => setAdminEmail(e.target.value)} 
                    style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                    placeholder="gestaomulti@gmail.com"
                    required 
                  />
                </div>
                <div className="form-group" style={{ marginBottom: '2rem' }}>
                  <label style={{ display: 'block', color: '#a1a1aa', fontSize: '0.8rem', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Senha</label>
                  <input 
                    type="password" 
                    value={adminPassword} 
                    onChange={(e) => setAdminPassword(e.target.value)} 
                    style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                    placeholder="••••••••"
                    required 
                  />
                </div>
                <button type="submit" className="btn-submit" style={{ width: '100%', padding: '14px', borderRadius: '8px', background: '#10b981', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                  Acessar Plataforma
                </button>
                <a href="/" style={{ display: 'block', textAlign: 'center', marginTop: '1.5rem', color: '#a1a1aa', fontSize: '0.8rem', textDecoration: 'none' }}>Voltar para Home</a>
              </form>
            </div>
          </div>
        );
      }
      return <SuperAdmin />;
    }

    const pathSlug = currentPath.replace('/', '');
    
    if (pathSlug) {
      const activeTenant = tenants.find(t => t.slug === pathSlug);
      
      if (activeTenant) {
        return <TenantApp tenant={activeTenant} />;
      } else {
        return (
          <div className="home-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#09090b', color: '#fff' }}>
            <div className="glass-panel" style={{ padding: '4rem 2rem', maxWidth: '500px', width: '100%', textAlign: 'center' }}>
              <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Estabelecimento não encontrado</h2>
              <p style={{ color: '#a1a1aa', marginBottom: '2rem' }}>O endereço `/{pathSlug}` não corresponde a nenhum cliente ativo.</p>
              <a href="/" style={{ display: 'inline-block', padding: '12px 24px', background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', textDecoration: 'none', borderRadius: '8px', fontWeight: '600' }}>Voltar para a Home</a>
            </div>
          </div>
        );
      }
    }

    // Landing Page Redesign
    return (
      <div className="home-container fade-in" style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        minHeight: '100vh', 
        justifyContent: 'center',
        padding: '2rem',
        position: 'relative',
        background: '#09090b',
        overflow: 'hidden',
        color: '#fff'
      }}>
        {/* Ambient Glows */}
        <div style={{ position: 'absolute', top: '-10%', right: '-10%', width: '50vw', height: '50vw', background: 'radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-10%', left: '-10%', width: '50vw', height: '50vw', background: 'radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <header style={{ marginBottom: '5rem', textAlign: 'center', zIndex: 2, maxWidth: '900px' }}>
          <div style={{ 
            width: '64px', 
            height: '64px', 
            margin: '0 auto 2.5rem', 
            background: 'linear-gradient(135deg, #10b981, #3b82f6)',
            borderRadius: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(16,185,129,0.3)'
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
          </div>
          
          <div style={{ display: 'inline-block', padding: '6px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '100px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '2px', color: '#10b981', marginBottom: '1.5rem', textTransform: 'uppercase' }}>
            Gestão de Atendimento Inteligente
          </div>

          <h1 style={{ 
            fontSize: 'clamp(2.5rem, 8vw, 4.5rem)', 
            fontWeight: 800, 
            lineHeight: 1.1,
            marginBottom: '1.5rem', 
            letterSpacing: '-2px'
          }}>
            <span style={{ background: 'linear-gradient(to right, #10b981, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Sua Vez</span> chegou.
          </h1>
          
          <p style={{ 
            fontSize: 'clamp(1.1rem, 3vw, 1.4rem)', 
            color: '#a1a1aa', 
            maxWidth: '700px', 
            margin: '0 auto 4rem',
            lineHeight: '1.6',
            fontWeight: 400
          }}>
            Otimize seu estabelecimento, remova atritos na espera e ofereça uma experiência de luxo para cada cliente em tempo real.
          </p>
          
          <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center' }}>
            <a href="/admin" className="btn-submit" style={{ 
              display: 'inline-flex', 
              alignItems: 'center',
              gap: '12px',
              textDecoration: 'none', 
              width: 'auto', 
              padding: '18px 48px',
              fontSize: '1.1rem',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              border: 'none',
              borderRadius: '12px',
              boxShadow: '0 10px 40px rgba(16,185,129,0.3)',
              color: '#fff',
              fontWeight: 700
            }}>
              Começar Agora
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </a>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', width: '100%', maxWidth: '1200px', gap: '2rem', zIndex: 2 }}>
          <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'left', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ width: '48px', height: '48px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            </div>
            <h3 style={{ marginBottom: '1rem', color: '#fff' }}>Multi-Tenant</h3>
            <p style={{ color: '#71717a', fontSize: '0.95rem', lineHeight: '1.6' }}>SaaS completo com isolamento total para cada estabelecimento cadastrado.</p>
          </div>
          
          <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'left', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ width: '48px', height: '48px', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
            </div>
            <h3 style={{ marginBottom: '1rem', color: '#fff' }}>Sincronização Real</h3>
            <p style={{ color: '#71717a', fontSize: '0.95rem', lineHeight: '1.6' }}>Fila atualizada instantaneamente via Supabase Realtime para todos os usuários.</p>
          </div>

          <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'left', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ width: '48px', height: '48px', background: 'rgba(234, 179, 8, 0.1)', color: '#eab308', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>
            </div>
            <h3 style={{ marginBottom: '1rem', color: '#fff' }}>Identidade Visual</h3>
            <p style={{ color: '#71717a', fontSize: '0.95rem', lineHeight: '1.6' }}>Personalização total de cores e logotipos para cada cliente da plataforma.</p>
          </div>
        </div>

        <footer style={{ marginTop: 'auto', padding: '4rem 0 2rem', opacity: 0.3, fontSize: '0.8rem', zIndex: 2 }}>
          &copy; {new Date().getFullYear()} Sua Vez &bull; SaaS Architecture
        </footer>
      </div>
    );
  };

  return (
    <ToastProvider>
      <OneSignalInitializer />
      {renderContent()}
    </ToastProvider>
  );
}

export default App;
