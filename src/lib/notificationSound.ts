let audioContext: AudioContext | null = null;
let lastPlayedAt = 0;

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextClass = window.AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  audioContext = AudioContextClass ? new AudioContextClass() : null;
  return audioContext;
}

export async function unlockNotificationSound() {
  try {
    const context = getAudioContext();
    if (context?.state === 'suspended') await context.resume();
  } catch {
    // O navegador pode manter o áudio bloqueado até o próximo gesto do usuário.
  }
}

export function playNotificationSound() {
  const now = Date.now();
  if (now - lastPlayedAt < 1500) return;
  lastPlayedAt = now;

  try {
    const context = getAudioContext();
    if (!context || context.state !== 'running') return;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.62);
    gain.connect(context.destination);

    [0, 0.16].forEach((delay, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = index === 0 ? 740 : 988;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + delay);
      oscillator.stop(context.currentTime + delay + 0.28);
    });
  } catch {
    // O aviso visual e o push continuam funcionando se o áudio não estiver disponível.
  }
}
