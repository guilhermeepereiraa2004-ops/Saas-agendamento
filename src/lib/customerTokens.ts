export function customerTokens(tenantId: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`suavez_tokens_${tenantId}`) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, token]) => typeof token === 'string' && token.length >= 32 && token.length <= 128));
  } catch { return {}; }
}
