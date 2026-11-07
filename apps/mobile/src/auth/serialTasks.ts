/** Serializa persistencia y cierre; una escritura antigua nunca termina después del borrado. */
export function createSerialTasks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      const result = tail.then(work, work);
      tail = result.catch(() => {});
      return result;
    },
  };
}
