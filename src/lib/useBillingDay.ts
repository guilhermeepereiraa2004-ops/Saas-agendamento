import { useEffect, useState } from 'react';
import { billingDay } from './subscriptionBilling';

export function useBillingDay() {
  const [today, setToday] = useState(billingDay);
  useEffect(() => {
    const refresh = () => setToday(billingDay());
    const timer = window.setInterval(refresh, 60_000);
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return today;
}
