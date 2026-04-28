import { useState, useEffect } from 'react';
import './App.css';
import type { Tenant } from './types';
import SuperAdmin from './SuperAdmin';
import TenantApp from './TenantApp';
import { supabase } from './lib/supabase';
import { ToastProvider } from './components/ToastProvider';
import { OneSignalInitializer, loginOneSignal, requestNotificationPermission } from './components/OneSignalInitializer';
import QueueLoader from './components/QueueLoader';

function App() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPath] = useState(window.location.pathname);
  const [isAdminAuth, setIsAdminAuth] = useState(localStorage.getItem('admin_auth') === 'true');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  useEffect(() => {
    const fetchTenants = async () => {
      const startTime = Date.now();
      const { data, error } = await supabase.from('tenants').select('*');
      
      // Garante pelo menos 1.5 segundos de loader para o usuário apreciar a animação
      const minLoadingTime = 1500;
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < minLoadingTime) {
        await new Promise(resolve => setTimeout(resolve, minLoadingTime - elapsedTime));
      }

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
      
      // Login no OneSignal para o Super Admin
      loginOneSignal('super_admin');
      await requestNotificationPermission();
    } else {
      alert('Credenciais administrativas inválidas!');
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#09090b', color: '#fff' }}>
        <QueueLoader />
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
              <h2 className="text-gradient" style={{ marginBottom: '0.5rem', fontSize: '1.8rem', fontWeight: 800 }}>Sua Vez</h2>
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

    // Landing Page Redesign
    return (
      <div className="home-container fade-in" style={{ 
        background: '#000',
        color: '#fff',
        overflowX: 'hidden'
      }}>
        {/* Navbar */}
        <nav style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: 'clamp(1rem, 3vw, 1.5rem) clamp(1rem, 5vw, 2rem)',
          maxWidth: '1400px',
          margin: '0 auto',
          position: 'sticky',
          top: 0,
          background: 'rgba(0, 0, 0, 0.9)',
          backdropFilter: 'blur(15px)',
          zIndex: 100,
          borderBottom: '1px solid rgba(255,255,255,0.08)'
        }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 2vw, 12px)' }}>
             <div style={{ width: 'clamp(30px, 8vw, 36px)', height: 'clamp(30px, 8vw, 36px)', background: 'var(--accent-primary)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
             </div>
             <span className="text-gradient" style={{ fontSize: 'clamp(0.95rem, 4.5vw, 1.2rem)', fontWeight: 800, fontFamily: 'var(--font-heading)', letterSpacing: '-0.5px' }}>Sua Vez</span>
           </div>

           {/* Mobile Navigation hidden for simplicity or desktop nav links */}
           <div style={{ display: 'flex', gap: '2.5rem', alignItems: 'center', marginLeft: 'auto', marginRight: '3rem' }} className="hide-mobile">
              <a href="#" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>Início</a>
              <a href="#vantagens" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>Vantagens</a>
              <a href="#solucoes" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>Soluções</a>
           </div>

           <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
             <a href="/admin" className="btn-submit" style={{ 
               width: 'auto',                
               padding: 'clamp(8px, 2vw, 10px) clamp(16px, 4vw, 24px)', 
               fontSize: 'clamp(0.75rem, 3vw, 0.85rem)', 
               borderRadius: '100px', 
               background: 'rgba(255,255,255,0.05)', 
               border: '1px solid rgba(255,255,255,0.1)',
               color: '#fff', 
               fontWeight: 600,
               textDecoration: 'none',
               whiteSpace: 'nowrap'
             }}>
               Painel Master
             </a>
           </div>
        </nav>

        {/* Hero Section */}
        <section style={{ 
          minHeight: 'calc(100vh - 80px)', // Compensa a altura aproximada da navbar
          display: 'flex',
          alignItems: 'center',
          padding: '2rem max(5vw, 2rem)',
          maxWidth: '1400px',
          margin: '0 auto',
          position: 'relative'
        }}>
          <div className="hero-grid">
            <div style={{ textAlign: 'left' }} className="animate-fade-in-up">
              <div className="feature-badge" style={{ marginBottom: '2rem' }}>Tecnologia de Fila 2.0</div>
              <h1 className="section-title" style={{ marginBottom: '2rem', fontSize: 'clamp(2.2rem, 8vw, 4rem)' }}>
                Seu fluxo de clientes na <span className="text-gradient">palma da sua mão</span>
              </h1>
              
              {/* MOBILE HERO IMAGE - Inserted between Title and Description */}
              <div className="mobile-hero-image animate-float">
                <div style={{
                  position: 'relative',
                  borderRadius: '30px',
                  padding: '8px',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.02))',
                  boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                  overflow: 'hidden'
                }}>
                  <img src="/hero_user.jpg" alt="Acesse sua vez de qualquer lugar" style={{ width: '100%', height: 'auto', display: 'block', borderRadius: '24px' }} />
                </div>
              </div>

              <p style={{ fontSize: 'clamp(1rem, 4vw, 1.2rem)', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '3.5rem', maxWidth: '600px' }} className="delay-1">
                Transforme o tempo de espera em valor. Nossa plataforma SaaS organiza seu fluxo de clientes com precisão cirúrgica e design de elite.
              </p>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }} className="delay-2">
                <a href="/admin" className="btn-submit" style={{ width: 'auto', padding: '20px 48px', fontSize: '1.1rem', borderRadius: '14px', background: 'var(--accent-primary)', color: '#000', fontWeight: 800, textDecoration: 'none' }}>
                  Acessar Plataforma
                </a>
              </div>
            </div>
            
            <div style={{ position: 'relative', width: '100%' }} className="animate-float desktop-hero-image">
              {/* Luxury Glow Background */}
              <div style={{ 
                position: 'absolute', 
                top: '50%', 
                left: '50%', 
                transform: 'translate(-50%, -50%)',
                width: '120%', 
                height: '120%', 
                background: 'radial-gradient(circle, rgba(212, 175, 55, 0.15) 0%, transparent 70%)',
                filter: 'blur(40px)',
                zIndex: -1,
                opacity: 0.8
              }}></div>

              {/* Luxury Image Frame */}
              <div style={{
                position: 'relative',
                borderRadius: '40px',
                padding: '10px',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.02))',
                boxShadow: '0 40px 100px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.1)',
                transform: 'perspective(2000px) rotateY(-12deg) rotateX(4deg)',
                overflow: 'hidden'
              }}>
                <div style={{
                   borderRadius: '32px',
                   overflow: 'hidden',
                   position: 'relative'
                }}>
                  <img src="/hero_user.jpg" alt="Acesse sua vez de qualquer lugar" style={{ width: '100%', height: 'auto', display: 'block' }} />
                  {/* Glass Overlay Detail */}
                  <div style={{ 
                    position: 'absolute', 
                    top: 0, 
                    left: 0, 
                    right: 0, 
                    bottom: 0, 
                    background: 'linear-gradient(225deg, rgba(255,255,255,0.05) 0%, transparent 50%)',
                    pointerEvents: 'none'
                  }} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Queue organization Section - WHITE BACKGROUND */}
        <section id="vantagens" style={{ background: '#FFFFFF', padding: '10rem max(5vw, 2rem)', position: 'relative', zIndex: 1 }}>
          <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
            <div className="hero-grid" style={{ alignItems: 'center' }}>
              <div style={{ textAlign: 'left' }} className="animate-fade-in-up">
                <h2 className="section-title" style={{ fontSize: '3.5rem', marginBottom: '2rem', color: '#09090b', letterSpacing: '-3px' }}>
                  O Caos termina aqui.
                </h2>
                <div style={{ width: '60px', height: '4px', background: 'var(--accent-primary)', marginBottom: '2.5rem' }} />
                
                <h3 style={{ fontSize: '1.8rem', color: '#09090b', marginBottom: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-body)', letterSpacing: '-0.5px' }}>
                  Seus clientes merecem o melhor
                </h3>
                
                <p style={{ color: '#4b5563', fontSize: '1.1rem', lineHeight: '1.8', marginBottom: '2rem', fontWeight: 400 }}>
                  A jornada do seu cliente começa muito antes da cadeira. Uma espera desorganizada gera ansiedade e frustração. No mercado de luxo, cada detalhe é uma oportunidade de encantar.
                </p>
                <div className="glass-panel" style={{ background: '#f8fafc', padding: '2rem', borderLeft: '4px solid var(--accent-primary)', boxShadow: 'none', borderRight: 'none', borderTop: 'none', borderBottom: 'none', borderRadius: '0 20px 20px 0' }}>
                  <p style={{ color: '#09090b', fontSize: '1.1rem', lineHeight: '1.8', fontWeight: 500 }}>
                    Entregue tranquilidade. Garanta que a espera seja tão impecável quanto o resultado final do seu trabalho.
                  </p>
                </div>
              </div>

              <div style={{ position: 'relative', width: '100%' }} className="animate-fade-in-up delay-2">
                 <div style={{
                   borderRadius: '40px',
                   overflow: 'hidden',
                   boxShadow: '0 50px 100px rgba(0,0,0,0.12)',
                   border: '4px solid #f8fafc',
                   transform: 'scale(1.05)' /* Reduzido levemente para harmonia */
                 }}>
                   <img src="/experience_luxury.png" alt="Experiência de Luxo" style={{ width: '100%', height: 'auto', display: 'block' }} />
                 </div>
              </div>
            </div>
          </div>
        </section>


        {/* What we deliver Section */}
        <section id="solucoes" style={{ padding: 'clamp(4rem, 12vw, 10rem) max(5vw, 2rem)', maxWidth: '1200px', margin: '0 auto' }}>
          <div className="hero-grid">
            <div style={{ 
               background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.1), transparent)', 
               borderRadius: '30px', 
               padding: '2.5rem',
               border: '1px solid rgba(212,175,55,0.1)'
            }}>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(1.5rem, 5vw, 2rem)', marginBottom: '1.5rem' }}>O que entregamos para você:</h3>
              <ul style={{ listStyle: 'none', display: 'grid', gap: '1.5rem' }}>
                {[
                  { title: "Dashboard Profissional", desc: "Controle total via drag-and-drop." },
                  { title: "Notificações via Push", desc: "Avisamos o cliente quando a vez chega." },
                  { title: "Identidade Custom", desc: "Sua logo, suas cores, sua marca." },
                  { title: "Monitor de Fila", desc: "Projetado para telas na recepção." }
                ].map((item, i) => (
                  <li key={i} style={{ display: 'flex', gap: '15px' }}>
                    <div style={{ color: 'var(--accent-primary)', marginTop: '3px' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{item.title}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{item.desc}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            
            <div style={{ textAlign: 'left' }} className="animate-fade-in-up">
               <h2 className="section-title" style={{ fontSize: 'clamp(2rem, 8vw, 3.5rem)', marginBottom: 'clamp(1.5rem, 5vw, 2.5rem)' }}>Não é apenas uma fila, é <span className="text-gradient">Governança.</span></h2>
               <p style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', lineHeight: '1.7', marginBottom: '2rem' }}>
                 Barbearias de elite não gerenciam cadeiras, gerenciam experiências. O "Sua Vez" foi desenhado para remover o estresse da porta e permitir que seu talento brilhe sem interrupções.
               </p>
                <div className="glass-panel" style={{ padding: 'clamp(1.5rem, 5vw, 2.5rem)', borderLeft: '4px solid var(--accent-primary)', background: 'rgba(255, 255, 255, 0.9)' }}>
                 <p style={{ fontStyle: 'italic', color: '#000', fontSize: 'clamp(0.95rem, 3vw, 1.1rem)', lineHeight: '1.7' }}>
                   "A melhor ferramenta para o meu negócio. O faturamento aumentou porque nenhum cliente desiste de esperar ao ver a fila organizada."
                 </p>
                 <footer style={{ marginTop: '1rem', fontWeight: 700, color: '#000', fontSize: '0.9rem', opacity: 0.8 }}>— Gestão Master Multi-SaaS</footer>
               </div>
            </div>
          </div>
        </section>

        {/* Who we serve Section - INTERACTIVE ELITE LIST */}
        <section style={{ padding: 'clamp(4rem, 15vw, 12rem) max(5vw, 2rem)', background: '#FFFFFF', borderTop: '1px solid rgba(0,0,0,0.05)', position: 'relative' }}>
          <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'clamp(3rem, 10vw, 8rem)' }}>
              <span style={{ 
                color: 'var(--accent-primary)', 
                fontWeight: 700, 
                letterSpacing: '4px', 
                fontSize: '0.9rem', 
                textTransform: 'uppercase', 
                display: 'block',
                marginBottom: '1.5rem'
              }}>Ecossistema</span>
              <h2 className="section-title" style={{ fontSize: 'clamp(2rem, 10vw, 4.5rem)', marginBottom: '0', color: '#09090b', letterSpacing: '-1px', lineHeight: 1 }}>
                Quem atendemos?
              </h2>
              <div style={{ width: '60px', height: '4px', background: 'var(--accent-primary)', margin: '1.5rem auto 0' }} />
            </div>
            
            <div style={{ position: 'relative', paddingLeft: '0' }}>
              {/* Vertical connector line */}
              <div style={{ 
                position: 'absolute', 
                left: '18px', 
                top: '0', 
                bottom: '0', 
                width: '1px', 
                background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.1) 10%, rgba(0,0,0,0.1) 90%, transparent)',
                zIndex: 0 
              }} />

              {[
                "Barbearias", 
                "Salão de beleza", 
                "Esteticistas", 
                "Manicures", 
                "Lash Design", 
                "Lava-jatos"
              ].map((name, index) => (
                <div key={index} 
                     className="elite-list-item animate-fade-in-up" 
                     style={{ 
                       animationDelay: `${index * 0.1}s`,
                       padding: 'clamp(2rem, 5vw, 3.5rem) 0',
                       display: 'flex',
                       alignItems: 'center',
                       gap: 'clamp(1rem, 5vw, 4rem)',
                       cursor: 'pointer',
                       position: 'relative',
                       zIndex: 1
                     }}>
                  
                  {/* Number Indicator */}
                  <div style={{ 
                    width: '36px', 
                    height: '36px', 
                    borderRadius: '50%', 
                    background: '#fff', 
                    border: '1px solid rgba(0,0,0,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    color: '#64748b',
                    flexShrink: 0,
                    transition: 'all 0.4s ease',
                    fontFamily: 'var(--font-body)'
                  }} className="number-badge">
                    0{index + 1}
                  </div>

                  {/* Text Content */}
                  <h4 style={{ 
                    fontSize: 'clamp(1.4rem, 8vw, 3.5rem)', 
                    fontWeight: 800, 
                    color: '#09090b', 
                    fontFamily: 'var(--font-heading)', 
                    letterSpacing: '-1px',
                    margin: 0,
                    transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                    opacity: 0.9,
                    wordBreak: 'break-word',
                    lineHeight: 1.1
                  }} className="elite-item-text">
                    {name}
                  </h4>

                  {/* Border line */}
                  <div style={{ 
                    position: 'absolute', 
                    bottom: 0, 
                    left: 'clamp(45px, 12vw, 80px)', 
                    right: 0, 
                    height: '1px', 
                    background: 'rgba(0,0,0,0.05)' 
                  }} />
                </div>
              ))}
            </div>
            
            <style>{`
              .elite-list-item:hover .elite-item-text {
                transform: translateX(30px);
                color: var(--accent-primary);
                opacity: 1;
              }
              .elite-list-item:hover .number-badge {
                border-color: var(--accent-primary);
                color: var(--accent-primary);
                transform: scale(1.2);
                box-shadow: 0 0 20px rgba(16, 185, 129, 0.2);
              }
              @media (max-width: 768px) {
                .elite-list-item:hover .elite-item-text {
                  transform: translateX(10px);
                }
              }
              @media (max-width: 480px) {
                .elite-item-text {
                  font-size: 1.6rem !important;
                  letter-spacing: 0 !important;
                }
                .elite-list-item {
                  padding: 1.5rem 0 !important;
                  gap: 0.75rem !important;
                }
                .number-badge {
                  width: 30px !important;
                  height: 30px !important;
                  font-size: 0.7rem !important;
                }
              }
            `}</style>
          </div>
        </section>

        {/* Footer - WHITE BACKGROUND */}
        <footer style={{ background: '#FFFFFF', padding: '4rem 2rem', textAlign: 'center' }}>
          <p style={{ color: '#64748b', fontSize: '0.9rem', opacity: 0.7, fontWeight: 500 }}>
            &copy; {new Date().getFullYear()} Sua Vez • Inteligência em Gestão de Filas. Todos os direitos reservados.
          </p>
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
