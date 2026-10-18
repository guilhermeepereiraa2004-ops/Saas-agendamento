import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export function useAdminDrawer(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>, id: string) {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1020px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1020px)');
    const update = () => { setCompact(media.matches); if (!media.matches) setOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [setOpen]);
  useEffect(() => {
    if (!open) return;
    const panel = document.getElementById(id);
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const elements = () => Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') || []).filter(element => element.getClientRects().length > 0);
    elements()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const list = elements();
      const first = list[0]; const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      previousFocus?.focus();
    };
  }, [open, setOpen, id]);
  return compact;
}
