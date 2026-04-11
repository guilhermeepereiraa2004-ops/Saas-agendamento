import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { getProfessionConfig } from './lib/professionConfig';
import type { Profession } from './types';

interface FinancialRecord {
  id: string;
  price: number;
  completed_at: string;
}

interface Props {
  tenantId: string;
  profession?: Profession;
}

export default function FinancialView({ tenantId, profession }: Props) {
  const prof = getProfessionConfig(profession);
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRecords = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('financial_records')
        .select('id, price, completed_at')
        .eq('tenant_id', tenantId)
        .order('completed_at', { ascending: false });
      if (data) setRecords(data);
      setLoading(false);
    };
    fetchRecords();
  }, [tenantId]);

  // --- Calculations ---
  const today = new Date().toISOString().split('T')[0];

  const todayTotal = records
    .filter(r => r.completed_at.split('T')[0] === today)
    .reduce((sum, r) => sum + Number(r.price), 0);

  const todayCount = records.filter(r => r.completed_at.split('T')[0] === today).length;

  // Group by month
  const monthlyMap: Record<string, { total: number; count: number }> = {};
  records.forEach(r => {
    const month = r.completed_at.slice(0, 7); // "YYYY-MM"
    if (!monthlyMap[month]) monthlyMap[month] = { total: 0, count: 0 };
    monthlyMap[month].total += Number(r.price);
    monthlyMap[month].count += 1;
  });

  const months = Object.entries(monthlyMap).sort((a, b) => b[0].localeCompare(a[0]));

  const formatMonth = (key: string) => {
    const [year, month] = key.split('-');
    const names = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    return `${names[parseInt(month) - 1]} ${year}`;
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
        Carregando financeiro...
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem', padding: '0.5rem 0' }}>

      {/* Today's Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '-10px', right: '-10px', opacity: 0.05 }}>
             <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 600 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
              Faturamento Hoje
            </div>
            <div style={{ fontSize: '2.8rem', fontWeight: 900, color: 'var(--success)', textShadow: '0 0 30px rgba(16, 185, 129, 0.2)' }}>
              {formatCurrency(todayTotal)}
            </div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <div 
            style={{ position: 'absolute', top: '-10px', right: '-10px', opacity: 0.05 }}
            dangerouslySetInnerHTML={{ __html: prof.iconSvg.replace('width="28" height="28"', 'width="100" height="100"') }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 600 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: prof.iconSvg.match(/<path[^>]*>|<circle[^>]*>|<line[^>]*>|<rect[^>]*>|<polyline[^>]*>/g)?.join('') || '' }} />
              Serviços Hoje
            </div>
            <div style={{ fontSize: '2.8rem', fontWeight: 900, color: 'var(--accent-primary)', textShadow: '0 0 30px color-mix(in srgb, var(--accent-primary) 20%, transparent)' }}>
              {todayCount}
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Breakdown */}
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '2rem' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          <h3 style={{ fontSize: '1rem', color: '#fff', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700 }}>
            Histórico Mensal
          </h3>
        </div>

        {months.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-secondary)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.3 }}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <p>Nenhum faturamento registrado ainda.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {months.map(([key, data]) => (
              <div key={key} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1.5rem',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: 'var(--border-radius-md)',
                border: '1px solid rgba(255,255,255,0.05)',
                transition: 'transform 0.2s ease, border-color 0.2s ease',
                cursor: 'default'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                  <div style={{ 
                    width: '48px', 
                    height: '48px', 
                    borderRadius: '12px', 
                    background: 'rgba(255,255,255,0.03)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    border: '1px solid rgba(255,255,255,0.05)'
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: '#fff', fontSize: '1.1rem', marginBottom: '4px' }}>{formatMonth(key)}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                      {data.count} atendimento{data.count !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--success)' }}>
                    {formatCurrency(data.total)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
