export function normalizeOrigin(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin; }
  catch { return null; }
}

export function pushOrigin(request: Request) {
  return normalizeOrigin(process.env.APP_ORIGIN) || new URL(request.url).origin;
}
