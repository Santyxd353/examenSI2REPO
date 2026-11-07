import { createSyncSequence } from '../../web/src/offline/sync-sequence';

test('un reintento espera la limpieza del envío anterior aunque su respuesta se pierda', async () => {
  const sequence = createSyncSequence(),
    events: string[] = [];
  let release!: () => void;
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = sequence.run('account:lease', async () => {
    events.push('first');
    await pause;
    events.push('recovered');
    throw new Error('Respuesta perdida');
  });
  const rejected = expect(first).rejects.toThrow('Respuesta perdida');
  const retry = sequence.run('account:lease', async () => {
    events.push('retry');
    return 3;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(events).toEqual(['first']);
  release();
  await rejected;
  expect(await retry).toBe(3);
  expect(events).toEqual(['first', 'recovered', 'retry']);
});
test('cancelar un reintento no libera el turno de su predecesor ni bloquea otra cuenta', async () => {
  const sequence = createSyncSequence();
  let release!: () => void;
  const calls: string[] = [];
  const first = sequence.run(
    'a',
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const controller = new AbortController();
  const cancelled = sequence.run(
    'a',
    async () => {
      calls.push('cancelled');
    },
    controller.signal,
  );
  const rejected = expect(cancelled).rejects.toThrow();
  controller.abort(new Error('Cancelado'));
  const next = sequence.run('a', async () => {
    calls.push('next');
  });
  await sequence.run('b', async () => {
    calls.push('other');
  });
  await rejected;
  expect(calls).toEqual(['other']);
  release();
  await first;
  await next;
  expect(calls).toEqual(['other', 'next']);
});
