// Logout must not leave the interface waiting indefinitely for a suspended mobile connection.
export const authFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url).pathname;
  const logout = path.endsWith('/auth/v1/logout');
  const recovery = path.endsWith('/auth/v1/recover') || (path.endsWith('/auth/v1/user') && init?.method?.toUpperCase() === 'PUT');
  if (!logout && !recovery) return fetch(input, init);
  const timeout = AbortSignal.timeout(logout ? 8000 : 15000);
  const original = init?.signal || (input instanceof Request ? input.signal : null);
  return fetch(input, { ...init, signal: original ? AbortSignal.any([original, timeout]) : timeout });
};
