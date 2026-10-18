import { useId, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToasts } from '../lib/toast';

type Logo = { hasLogo: boolean; logoUrl: string };
const MAX_FILE_SIZE = 5 * 1024 * 1024;

async function prepareLogo(file: File): Promise<Blob> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Escolha uma imagem PNG, JPG ou WebP.');
  }
  if (file.size > MAX_FILE_SIZE) throw new Error('A imagem deve ter até 5 MB.');

  const imageSource = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem. Tente selecionar o arquivo novamente.'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Não foi possível abrir essa imagem. Escolha outro arquivo.'));
    image.src = imageSource;
  });
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height || width * height > 40_000_000) throw new Error('Essa imagem é muito grande. Escolha uma versão menor da logo.');
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível preparar a imagem neste navegador.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a logo.')), 'image/png');
  });
}

export function TenantLogoEditor({ tenantId, hasLogo, logoUrl, onSaved, onSaveStateChange }: Logo & { tenantId: string; onSaved: (logo: Logo) => void; onSaveStateChange: (state: 'saving' | 'saved' | 'error') => void }) {
  const { showToast } = useToasts();
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const hasImage = hasLogo && Boolean(logoUrl);

  async function saveLogo(logo: Logo) {
    const { data, error: saveError } = await supabase.from('tenants')
      .update({ has_logo: logo.hasLogo, logo_url: logo.logoUrl })
      .eq('id', tenantId).select('id,has_logo,logo_url').single();
    if (saveError || !data) throw new Error('Não foi possível salvar a logo. Tente novamente.');
    onSaved({ hasLogo: data.has_logo, logoUrl: data.logo_url || '' });
  }

  async function uploadLogo(file: File) {
    if (saving) return;
    setSaving(true);
    onSaveStateChange('saving');
    setError('');
    let uploadedPath: string | null = null;
    try {
      const blob = await prepareLogo(file);
      const path = `products/${tenantId}/branding/logo-${crypto.randomUUID()}.png`;
      const storage = supabase.storage.from('product-images');
      const { data, error: uploadError } = await storage.upload(path, blob, { contentType: 'image/png', cacheControl: '31536000', upsert: false });
      if (uploadError || !data) throw new Error('Não foi possível enviar a imagem. Verifique sua conexão e tente novamente.');
      uploadedPath = data.path;
      const { data: publicData } = storage.getPublicUrl(data.path);
      await saveLogo({ hasLogo: true, logoUrl: publicData.publicUrl });
      uploadedPath = null;
      onSaveStateChange('saved');
      showToast('Logo salva! Sua marca já aparece no painel e na página do cliente.', 'success');
    } catch (cause) {
      // Remove only the new upload if saving its profile reference failed.
      if (uploadedPath) await supabase.storage.from('product-images').remove([uploadedPath]).catch(() => {});
      const message = cause instanceof Error ? cause.message : 'Não foi possível salvar a logo. Tente novamente.';
      setError(message);
      onSaveStateChange('error');
      showToast(message, 'error');
    } finally {
      setSaving(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function removeLogo() {
    if (saving) return;
    setSaving(true);
    onSaveStateChange('saving');
    setError('');
    try {
      await saveLogo({ hasLogo: false, logoUrl: '' });
      onSaveStateChange('saved');
      showToast('Logo removida do perfil.', 'success');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível remover a logo.';
      setError(message);
      onSaveStateChange('error');
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-logo-editor" aria-labelledby={`${id}-title`} aria-busy={saving}>
      <h3 id={`${id}-title`}>Logo do estabelecimento</h3>
      <div className="admin-logo-editor-content">
        <div className="admin-logo-image">
          {hasImage ? <img src={logoUrl} alt="Logo do estabelecimento" /> : <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>}
        </div>
        <p>Use sua marca no painel, no login e na página dos clientes.<small>PNG, JPG ou WebP · até 5 MB. Imagens transparentes são preservadas.</small></p>
      </div>
      <input ref={inputRef} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Selecionar logo do estabelecimento" disabled={saving} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void uploadLogo(file); }} />
      <div className="admin-logo-editor-actions">
        <button type="button" disabled={saving} onClick={() => inputRef.current?.click()}>{saving ? 'Salvando logo…' : hasImage ? 'Trocar logo' : 'Adicionar logo'}</button>
        {hasImage && <button type="button" className="admin-logo-remove" disabled={saving} onClick={() => void removeLogo()}>Remover logo</button>}
      </div>
      {error && <p className="admin-logo-error" role="alert">{error}</p>}
    </section>
  );
}
