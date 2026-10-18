// Logout must not leave the interface waiting indefinitely for a suspended mobile connection.
export const authFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!new URL(url).pathname.endsWith('/auth/v1/logout')) return fetch(input, init);
  const timeout = AbortSignal.timeout(8000);
  const original = init?.signal || (input instanceof Request ? input.signal : null);
  return fetch(input, { ...init, signal: original ? AbortSignal.any([original, timeout]) : timeout });
};
