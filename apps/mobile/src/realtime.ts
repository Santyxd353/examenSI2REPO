import { io, Socket } from 'socket.io-client';
import {
  captureSessionScope,
  getAccessToken,
  getTenantSlug,
  isCurrentSessionScope,
  REALTIME_URL,
} from './api';

let socket: Socket | null = null;

export function connectRealtime(
  locationId: string,
  onInventory: (event: { locationId: string; variantIds: string[]; reason: string }) => void,
) {
  socket?.disconnect();
  const requestScope = captureSessionScope();
  const connected = io(`${REALTIME_URL}/realtime`, {
    transports: ['websocket'],
    auth: { token: getAccessToken(), tenant: getTenantSlug() },
    reconnection: true,
  });
  socket = connected;
  connected.on('connect', () => {
    if (!isCurrentSessionScope(requestScope)) return connected.disconnect();
    connected.emit('inventory:subscribe', { locationId });
  });
  connected.on('inventory:updated', (event) => {
    if (isCurrentSessionScope(requestScope)) onInventory(event);
  });
  return () => {
    connected.disconnect();
    if (socket === connected) socket = null;
  };
}
