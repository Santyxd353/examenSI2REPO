export type OfflineScope = Readonly<{ tenantId: string; actorId: string; deviceId: string }>;

export function offlineScopeKey(scope: OfflineScope) {
  if (!scope.tenantId || !scope.actorId || !scope.deviceId) throw new Error('El ámbito offline está incompleto.');
  return `${scope.tenantId}:${scope.actorId}:${scope.deviceId}`;
}

export function sameOfflineScope(left: OfflineScope, right: OfflineScope) {
  return offlineScopeKey(left) === offlineScopeKey(right);
}
