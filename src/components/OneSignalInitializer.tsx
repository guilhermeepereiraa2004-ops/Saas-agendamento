import { useEffect } from 'react';
import { initializeOneSignal } from '../lib/oneSignal';

export function OneSignalInitializer() {
  useEffect(() => {
    initializeOneSignal();
  }, []);

  return null;
}
