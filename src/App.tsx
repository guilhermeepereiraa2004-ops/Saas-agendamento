import { useState, useEffect } from 'react';
import './App.css';
import type { Tenant } from './types';
import SuperAdmin from './SuperAdmin';
import TenantApp from './TenantApp';
import { supabase } from './lib/supabase';
import { ToastProvider } from './components/ToastProvider';
import { OneSignalInitializer } from './components/OneSignalInitializer';
import { requestNotificationPermission } from './lib/oneSignal';
import LandingPage, { BrandMark } from './LandingPage';

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
          workingHours: typeof t.working_hours === 'string' ? JSON.parse(t.working_hours) : (t.working_hours || []),
          subscriptionStatus: t.subscription_status || 'trial',
          paymentDay: t.payment_day || 10,
          secondaryColor: t.secondary_color || '#ffffff',
          isActive: t.is_active !== false,
        }));
        setTenants(mappedTenants);
      }
      setIsLoading(false);
    };

    fetchTenants();
  }, []);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adminEmail === 'gestaomulti@gmail.com' && adminPassword === 'naoseinao') {
      setIsAdminAuth(true);
      localStorage.setItem('admin_auth', 'true');
      
      await requestNotificationPermission();
    } else {
      alert('Credenciais administrativas inválidas!');
    }
  };

  if (isLoading) {
    return null;
  }

  const renderContent = () => {
    if (currentPath === '/admin') {
      if (!isAdminAuth) {
        return (
          <div className="home-container master-login" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#09090b' }}>
            <div className="glass-panel fade-in master-login-card" style={{ padding: '3rem', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
              <div className="master-login-logo" aria-hidden="true">
                <BrandMark />
              </div>
              <h2 className="text-gradient" style={{ marginBottom: '0.5rem', fontSize: '1.8rem', fontWeight: 800 }}>Sua Vez</h2>
              <p style={{ color: '#a1a1aa', marginBottom: '2rem', fontSize: '0.9rem' }}>Acesso Administrativo</p>
              
              <form onSubmit={handleAdminLogin} style={{ textAlign: 'left' }}>
                <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', color: '#000000', fontSize: '0.8rem', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>E-mail Master</label>
                  <input 
                    type="email" 
                    value={adminEmail} 
                    onChange={(e) => setAdminEmail(e.target.value)} 
                    style={{ width: '100%', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#000000' }}
                    placeholder="gestaomulti@gmail.com"
                    required 
                  />
                </div>
                <div className="form-group" style={{ marginBottom: '2rem' }}>
                  <label style={{ display: 'block', color: '#000000', fontSize: '0.8rem', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Senha</label>
                  <input 
                    type="password" 
                    value={adminPassword} 
                    onChange={(e) => setAdminPassword(e.target.value)} 
                    style={{ width: '100%', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#000000' }}
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
        if (activeTenant.isActive === false) {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8fafc', padding: '2rem', textAlign: 'center' }}>
              <div style={{ background: '#fff', borderRadius: '24px', padding: '3rem 2rem', maxWidth: '480px', width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' }}>
                <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.75rem' }}>Estabelecimento Suspenso</h2>
                <p style={{ color: '#64748b', fontSize: '1rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  O acesso a <strong>{activeTenant.name}</strong> está temporariamente suspenso.<br/>Entre em contato com o suporte para mais informações.
                </p>
                <div style={{ background: '#f1f5f9', borderRadius: '12px', padding: '1rem', fontSize: '0.85rem', color: '#475569' }}>
                  📞 Se você é o proprietário, entre em contato com a administração da plataforma.
                </div>
              </div>
            </div>
          );
        }
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

    return <LandingPage />;
  };

  return (
    <ToastProvider>
      <OneSignalInitializer />
      {renderContent()}
    </ToastProvider>
  );
}

export default App;
