import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import type { Profession } from './types';

interface FinancialRecord {
  id: string;
  price: number;
  completed_at: string;
}

interface FinancialExpense {
  id: string;
  description: string;
  amount: number;
  created_at: string;
}

interface Props {
  tenantId: string;
  profession?: Profession;
}

export default function FinancialView({ tenantId }: Props) {
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [expenses, setExpenses] = useState<FinancialExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      const [recordsRes, expensesRes] = await Promise.all([
        supabase
          .from('financial_records')
          .select('id, price, completed_at')
          .eq('tenant_id', tenantId)
          .order('completed_at', { ascending: false }),
        supabase
          .from('tenant_expenses')
          .select('id, description, amount, created_at')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
      ]);

      if (recordsRes.data) setRecords(recordsRes.data);
      if (expensesRes.data) setExpenses(expensesRes.data.map(e => ({
        id: e.id,
        description: e.description,
        amount: parseFloat(e.amount),
        created_at: e.created_at
      })));

      setLoading(false);
    };
    fetchData();
  }, [tenantId]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseDescription || !expenseAmount) return;

    const { error } = await supabase
      .from('tenant_expenses')
      .insert([{
        tenant_id: tenantId,
        description: expenseDescription,
        amount: parseFloat(expenseAmount.replace(',', '.'))
      }]);

    if (!error) {
      setExpenseDescription('');
      setExpenseAmount('');
      // Refresh
      const { data } = await supabase
        .from('tenant_expenses')
        .select('id, description, amount, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (data) setExpenses(data.map(e => ({
        id: e.id,
        description: e.description,
        amount: parseFloat(e.amount),
        created_at: e.created_at
      })));
    }
  };

  const handleDeleteExpense = async (id: string) => {
    const { error } = await supabase
      .from('tenant_expenses')
      .delete()
      .eq('id', id);

    if (!error) {
      setExpenses(prev => prev.filter(e => e.id !== id));
    }
  };

  // --- Calculations ---
  const today = new Date().toISOString().split('T')[0];

  const todayTotal = records
    .filter(r => r.completed_at.split('T')[0] === today)
    .reduce((sum, r) => sum + Number(r.price), 0);



  const monthRevenue = records
    .filter(r => r.completed_at.startsWith(selectedMonth))
    .reduce((sum, r) => sum + Number(r.price), 0);

  const monthExpenses = expenses
    .filter(e => e.created_at.startsWith(selectedMonth))
    .reduce((sum, e) => sum + e.amount, 0);

  const monthNet = monthRevenue - monthExpenses;

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
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem', color: '#64748b' }}>
        Carregando financeiro...
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem', padding: '0.5rem 0' }}>
      
      {/* Month Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>Resumo Financeiro</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Acompanhe seu faturamento e despesas</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Mês de Referência:</span>
          <select 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(e.target.value)}
            style={{ 
              padding: '8px 16px', 
              borderRadius: '10px', 
              border: '1px solid #e2e8f0', 
              background: '#fff', 
              fontWeight: 700,
              cursor: 'pointer',
              color: '#0f172a'
            }}
          >
            {/* Generate months from records and expenses */}
            {(() => {
              const availableMonths = new Set<string>();
              records.forEach(r => availableMonths.add(r.completed_at.slice(0, 7)));
              expenses.forEach(e => availableMonths.add(e.created_at.slice(0, 7)));
              // Add current month if not there
              const now = new Date();
              availableMonths.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
              
              return Array.from(availableMonths)
                .sort((a, b) => b.localeCompare(a))
                .map(m => (
                  <option key={m} value={m}>{formatMonth(m)}</option>
                ));
            })()}
          </select>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="admin-stats-row" style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div className="admin-stat-card" style={{ position: 'relative', overflow: 'hidden', borderLeft: '4px solid var(--success)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
              Faturamento Hoje
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--text-primary)' }}>
              {formatCurrency(todayTotal)}
            </div>
          </div>
        </div>

        <div className="admin-stat-card" style={{ position: 'relative', overflow: 'hidden', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
              Faturamento Mensal
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#3b82f6' }}>
              {formatCurrency(monthRevenue)}
            </div>
          </div>
        </div>

        <div className="admin-stat-card" style={{ position: 'relative', overflow: 'hidden', borderLeft: '4px solid var(--danger)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
              Saídas Mensais
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--danger)' }}>
              {formatCurrency(monthExpenses)}
            </div>
          </div>
        </div>

        <div className="admin-stat-card" style={{ position: 'relative', overflow: 'hidden', borderLeft: '4px solid #000', background: 'rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
              Líquido no Mês
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: monthNet >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {formatCurrency(monthNet)}
            </div>
          </div>
        </div>
      </div>

      <div className="financial-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {/* Monthly Breakdown */}
        <div className="admin-stat-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '2rem' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }}>
              Histórico Mensal
            </h3>
          </div>

          {months.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: '#94a3b8' }}>
              <p>Nenhum faturamento registrado ainda.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {months.map(([key, data]) => (
                <div key={key} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '1rem',
                  background: 'var(--bg-base)',
                  borderRadius: '12px',
                  border: '1px solid color-mix(in srgb, var(--accent-primary) 10%, #e2e8f0)',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{formatMonth(key)}</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{data.count} atendimentos</div>
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--success)' }}>
                    {formatCurrency(data.total)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expenses Section */}
        <div className="admin-stat-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '2rem' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }}>
              Controle de Saídas
            </h3>
          </div>

          <form onSubmit={handleAddExpense} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input 
                type="text" 
                placeholder="Descrição (ex: Aluguel)" 
                value={expenseDescription}
                onChange={e => setExpenseDescription(e.target.value)}
                style={{ flex: '1 1 200px' }}
              />
              <div style={{ display: 'flex', gap: '10px', flex: '1 1 200px' }}>
                <input 
                  type="text" 
                  placeholder="R$ 0,00" 
                  value={expenseAmount}
                  onChange={e => setExpenseAmount(e.target.value)}
                  style={{ flexGrow: 1, minWidth: '80px' }}
                />
                <button type="submit" className="btn-submit" style={{ width: 'auto', minWidth: '100px', flexShrink: 0, padding: '0 20px', background: 'var(--danger)', color: '#fff' }}>Lançar</button>
              </div>
            </div>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {expenses.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Nenhuma saída registrada.</p>
            ) : (
              expenses.map(exp => (
                <div key={exp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'color-mix(in srgb, var(--danger) 5%, var(--bg-surface))', border: '1px solid color-mix(in srgb, var(--danger) 15%, #fee2e2)', borderRadius: '12px' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#991b1b' }}>{exp.description}</div>
                    <div style={{ fontSize: '0.75rem', color: '#b91c1c' }}>{new Date(exp.created_at).toLocaleDateString('pt-BR')}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ fontWeight: 800, color: 'var(--danger)' }}>-{formatCurrency(exp.amount)}</div>
                    <button onClick={() => handleDeleteExpense(exp.id)} style={{ background: 'transparent', color: 'var(--danger)', padding: '5px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
