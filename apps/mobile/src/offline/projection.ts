import type { OfflineScope } from './scope';

export type LocalProjection = Readonly<{
  scope: OfflineScope;
  entityId: string;
  version: number | null;
  payload: string;
}>;
