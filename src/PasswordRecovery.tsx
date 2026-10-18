import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { BrandMark } from './LandingPage';
import './PasswordRecovery.css';

const initialRecoveryLink = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';

export default function PasswordRecovery() {
  const [mode, setMode] = useState<'request' | 'checking' | 'change' | 'done'>(initialRecoveryLink ? 'checking' : 'request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && event === 'PASSWORD_RECOVERY' && session) setMode('change');
    });
    if (initialRecoveryLink) void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active) return;
      if (!authError && data.user) setMode('change');
      else { setMode('request'); setError('Este link expirou ou não é válido. Solicite um novo link abaixo.'); }
    });
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (params.has('error') || new URLSearchParams(window.location.search).has('error')) setError('Este link expirou ou já foi utilizado. Solicite outro link.');
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const requestLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || cooldown) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/recuperar-acesso` });
      if (sendError) {
        setError(sendError.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' : 'Não foi possível enviar o link agora. Tente novamente em alguns minutos ou entre em contato com o suporte.');
        return;
      }
      setMessage('Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha. Confira também a pasta de spam.');
      setCooldown(60);
    } catch { setError('Não foi possível conectar. Confira sua internet e tente novamente.'); }
    finally { setBusy(false); }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (password.length < 12 || password.length > 128) { setError('Use uma senha de 12 a 128 caracteres.'); return; }
    if (password !== confirmation) { setError('As senhas não coincidem.'); return; }
    setBusy(true);
    try {
      const { error: changeError } = await supabase.auth.updateUser({ password });
      if (changeError) { setError('Não foi possível atualizar a senha. O link pode ter expirado ou a senha não atende aos requisitos. Solicite outro link se necessário.'); return; }
      setPassword(''); setConfirmation(''); setMode('done');
      await supabase.auth.signOut({ scope: 'global' });
    } catch { setError('Não foi possível conectar. Sua nova senha não foi confirmada. Tente novamente.'); }
    finally { setBusy(false); }
  };

  return <main className="recovery-page">
    <section className="recovery-card" aria-labelledby="recovery-title">
      <div className="recovery-brand"><BrandMark /><strong>Sua Vez</strong></div>
      <span className="recovery-eyebrow">Acesso seguro</span>
      <h1 id="recovery-title">{mode === 'done' ? 'Senha atualizada' : mode === 'change' ? 'Crie sua nova senha' : 'Recuperar acesso'}</h1>
      {mode === 'checking' ? <p role="status">Conferindo seu link…</p> : mode === 'done' ? <>
        <p>Sua senha foi atualizada. Volte à tela de login do seu estabelecimento ou do painel master e entre com a nova senha.</p>
        <a className="recovery-primary" href="/">Voltar ao início</a>
      </> : <>
        <p>{mode === 'change' ? 'Escolha uma senha de pelo menos 12 caracteres que você ainda não tenha usado.' : 'Informe o e-mail da sua conta profissional ou master para receber o link de recuperação.'}</p>
        <form onSubmit={mode === 'change' ? changePassword : requestLink}>
          {mode === 'change' ? <>
            <label>Nova senha<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required /></label>
            <label>Confirmar nova senha<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>
          </> : <label>E-mail da conta<input type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} required /></label>}
          {error ? <p className="recovery-error" role="alert">{error}</p> : null}
          {message ? <p className="recovery-message" role="status">{message}</p> : null}
          <button className="recovery-primary" type="submit" disabled={busy || (mode === 'request' && cooldown > 0)}>{busy ? 'Aguarde…' : mode === 'change' ? 'Salvar nova senha' : cooldown ? `Reenviar em ${cooldown}s` : 'Enviar link de recuperação'}</button>
        </form>
        {mode === 'change' ? <button className="recovery-link" type="button" disabled={busy} onClick={() => { setMode('request'); setPassword(''); setConfirmation(''); setError(''); }}>Solicitar outro link</button> : <a className="recovery-link" href="/">Voltar ao início</a>}
      </>}
    </section>
  </main>;
}
