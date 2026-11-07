/** Serializa los disparadores de una misma sesión dentro de la pestaña. */
export function createSyncSequence() {
  const tails = new Map<string, Promise<void>>();
  return {
    async run<T>(key: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) throw signal.reason ?? new Error('Sincronización cancelada.');
      const result = (tails.get(key) ?? Promise.resolve()).then(() => {
        if (signal?.aborted) throw signal.reason ?? new Error('Sincronización cancelada.');
        return work();
      });
      const settled = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, settled);
      void settled.then(() => {
        if (tails.get(key) === settled) tails.delete(key);
      });
      if (!signal) return result;
      let onAbort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? new Error('Sincronización cancelada.'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      try {
        return await Promise.race([result, aborted]);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
