// Set the manifest before the browser evaluates installability. Each installed
// audience has a separate identity and launch route, without credentials in URLs.
(() => {
  const route = /^\/([a-z0-9][a-z0-9-]{0,79})(?:\/(cliente|profissional))?\/?$/.exec(location.pathname);
  if (!route || ['admin', 'recuperar-acesso'].includes(route[1])) return;
  // Public links always belong to the customer app, regardless of a staff session.
  if (!route[2]) {
    location.replace(`/${route[1]}/cliente/${location.search}${location.hash}`);
    return;
  }
  const audience = route[2] === 'profissional' ? 'professional' : 'customer';
  document.querySelector('link[rel="manifest"]').href = `/api/pwa-manifest?slug=${encodeURIComponent(route[1])}&audience=${audience}`;
  document.querySelector('meta[name="apple-mobile-web-app-title"]').content = audience === 'professional' ? 'Sua Vez Pro' : 'Sua Vez';
})();
