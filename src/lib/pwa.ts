export type AppAudience = 'customer' | 'professional';

export function tenantAppPath(slug: string, audience: AppAudience) {
  return `/${encodeURIComponent(slug)}/${audience === 'professional' ? 'profissional' : 'cliente'}/`;
}

export function tenantRoute(pathname: string) {
  const match = /^\/([a-z0-9][a-z0-9-]{0,79})(?:\/(cliente|profissional)\/?)?\/?$/.exec(pathname);
  if (!match || ['admin', 'recuperar-acesso'].includes(match[1])) return null;
  return {
    slug: match[1],
    audience: match[2] === 'profissional' ? 'professional' as const : match[2] === 'cliente' ? 'customer' as const : undefined,
  };
}
