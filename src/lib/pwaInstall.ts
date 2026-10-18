type InstallChoice = { outcome: 'accepted' | 'dismissed' };
export interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<InstallChoice>;
}

let prompt: InstallPrompt | null = null;
let requested = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  prompt = event as InstallPrompt;
  requested = false;
  notify();
});
// On Android this event can precede completion of the WebAPK installation.
window.addEventListener('appinstalled', () => { prompt = null; requested = true; notify(); });

export const installState = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot: () => requested ? 'requested' : prompt ? 'ready' : 'manual',
  async request() {
    const pending = prompt;
    if (!pending) return null;
    prompt = null;
    notify();
    await pending.prompt();
    const choice = await pending.userChoice;
    if (choice.outcome === 'accepted') requested = true;
    notify();
    return choice.outcome;
  },
};

export function isAppleMobile() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function standaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}
