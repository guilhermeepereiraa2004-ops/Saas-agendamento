// iOS 16.4 supports installed web push but predates AbortSignal.any/timeout.
if (typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), milliseconds);
    return controller.signal;
  };
}
if (typeof AbortSignal.any !== 'function') {
  AbortSignal.any = (signals: AbortSignal[]) => {
    const controller = new AbortController();
    const listeners = new Map<AbortSignal, () => void>();
    const abort = (source: AbortSignal) => {
      controller.abort(source.reason);
      for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener);
      listeners.clear();
    };
    for (const signal of signals) {
      if (signal.aborted) { abort(signal); break; }
      const listener = () => abort(signal);
      listeners.set(signal, listener); signal.addEventListener('abort', listener, { once: true });
    }
    return controller.signal;
  };
}
