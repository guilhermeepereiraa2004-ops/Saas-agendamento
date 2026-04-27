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

  const todayExpenses = expenses
    .filter(e => e.created_at.split('T')[0] === today)
    .reduce((sum, e) => sum + e.amount, 0);

  const totalRevenue = records.reduce((sum, r) => sum + Number(r.price), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const netProfit = totalRevenue - totalExpenses;

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

      {/* Today's Summary */}
      <div className="admin-stats-row" style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div className="admin-stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '-10px', right: '-10px', opacity: 0.05, color: '#10b981' }}>
             <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
              Faturamento Hoje
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#0f172a' }}>
              {formatCurrency(todayTotal)}
            </div>
          </div>
        </div>

        <div className="admin-stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '-10px', right: '-10px', opacity: 0.05, color: '#ef4444' }}>
             <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"></path></svg>
              Saídas Hoje
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#ef4444' }}>
              {formatCurrency(todayExpenses)}
            </div>
          </div>
        </div>

        <div className="admin-stat-card" style={{ position: 'relative', overflow: 'hidden', background: '#0f172a' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
              Saldo Líquido Total
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff' }}>
              {formatCurrency(netProfit)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* Monthly Breakdown */}
        <div className="admin-stat-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '2rem' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            <h3 style={{ fontSize: '1rem', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }}>
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
                  background: '#f8fafc',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{formatMonth(key)}</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{data.count} atendimentos</div>
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#10b981' }}>
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <h3 style={{ fontSize: '1rem', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }}>
              Controle de Saídas
            </h3>
          </div>

          <form onSubmit={handleAddExpense} style={{ display: 'flex', gap: '10px', marginBottom: '2rem' }}>
            <input 
              type="text" 
              placeholder="Descrição (ex: Aluguel)" 
              value={expenseDescription}
              onChange={e => setExpenseDescription(e.target.value)}
              style={{ flexGrow: 2 }}
            />
            <input 
              type="text" 
              placeholder="R$ 0,00" 
              value={expenseAmount}
              onChange={e => setExpenseAmount(e.target.value)}
              style={{ flexGrow: 1 }}
            />
            <button type="submit" className="btn-submit" style={{ width: 'auto', padding: '0 20px', background: '#ef4444', color: '#fff' }}>Lançar</button>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {expenses.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Nenhuma saída registrada.</p>
            ) : (
              expenses.map(exp => (
                <div key={exp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '12px' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#991b1b' }}>{exp.description}</div>
                    <div style={{ fontSize: '0.75rem', color: '#b91c1c' }}>{new Date(exp.created_at).toLocaleDateString('pt-BR')}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ fontWeight: 800, color: '#ef4444' }}>-{formatCurrency(exp.amount)}</div>
                    <button onClick={() => handleDeleteExpense(exp.id)} style={{ background: 'transparent', color: '#ef4444', padding: '5px' }}>
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
