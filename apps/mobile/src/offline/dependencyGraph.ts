import type { OfflineIntent } from './intentRepository';

export function orderedPending(intents: readonly OfflineIntent[]) {
  const byId = new Map(intents.map((item) => [item.operationId, item]));
  const result: OfflineIntent[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error('Las dependencias offline contienen un ciclo.');
    const item = byId.get(id);
    if (!item) throw new Error('Falta una dependencia offline.');
    if (item.state === 'BLOCKED' || item.state === 'CONFLICT')
      throw new Error('Una dependencia offline requiere intervención.');
    if (item.state === 'SENDING')
      throw new Error('Una dependencia offline todavía se está sincronizando.');
    visiting.add(id);
    item.dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
    if (item.state === 'PENDING') result.push(item);
  }

  intents.filter((item) => item.state === 'PENDING').forEach((item) => visit(item.operationId));
  return result;
}

export function blockDependents(intents: readonly OfflineIntent[], failedId: string) {
  const blocked = new Set<string>([failedId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of intents) {
      if (item.dependsOn.some((id) => blocked.has(id)) && !blocked.has(item.operationId)) {
        blocked.add(item.operationId);
        changed = true;
      }
    }
  }
  return intents.map((item) =>
    blocked.has(item.operationId) && item.operationId !== failedId
      ? { ...item, state: 'BLOCKED' as const }
      : item,
  );
}
