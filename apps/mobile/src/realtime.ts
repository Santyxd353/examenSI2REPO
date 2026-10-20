import { io, Socket } from 'socket.io-client';
import { getAccessToken, getTenantSlug, REALTIME_URL } from './api';

let socket: Socket | null = null;

export function connectRealtime(
  locationId: string,
  onInventory: (event: { locationId: string; variantIds: string[]; reason: string }) => void,
) {
  socket?.disconnect();
  socket = io(`${REALTIME_URL}/realtime`, {
    transports: ['websocket'],
    auth: { token: getAccessToken(), tenant: getTenantSlug() },
    reconnection: true,
  });
  socket.on('connect', () => socket?.emit('inventory:subscribe', { locationId }));
  socket.on('inventory:updated', onInventory);
  return () => {
    socket?.disconnect();
    socket = null;
  };
}
