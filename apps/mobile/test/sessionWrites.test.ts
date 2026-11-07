import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionScope } from '../src/auth/sessionScope';
import { createSerialTasks } from '../src/auth/serialTasks';
test('el cierre espera las escrituras iniciadas y elimina tokens antes de permitir otra sesión', async () => {
  const writes = createSerialTasks(),
    session = createSessionScope('one'),
    captured = session.capture();
  const records = new Map<string, string>();
  let resume!: () => void;
  const old = writes.run(async () => {
    session.assertCurrent(captured);
    await new Promise<void>((resolve) => {
      resume = resolve;
    });
    records.set('refresh', 'anterior');
    session.assertCurrent(captured);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  session.invalidate();
  const closed = writes.run(async () => {
    records.delete('refresh');
  });
  resume();
  await assert.rejects(old);
  await closed;
  assert.equal(records.size, 0);
  await writes.run(async () => {
    records.set('refresh', 'nuevo');
  });
  assert.equal(records.get('refresh'), 'nuevo');
});
