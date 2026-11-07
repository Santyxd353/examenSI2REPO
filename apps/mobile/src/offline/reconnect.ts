import { AppState } from 'react-native';
import { addNetworkStateListener } from 'expo-network';
import type { Identity } from '../types';
import { captureSessionScope, isCurrentSessionScope } from '../api';
import { bootstrapOfflineVault } from './bootstrap';

/** Un solo bootstrap por cambio de conectividad; las operaciones conservan su UUID al reintentar. */
export function watchOfflineReconnect(identity: Identity) {
  const session = captureSessionScope();
  let running = false,
    closed = false;
  const attempt = async () => {
    if (closed || running || !isCurrentSessionScope(session)) return;
    running = true;
    try {
      await bootstrapOfflineVault(identity);
    } catch {
      /* La cola queda durable; la pantalla de sincronización informa los rechazos. */
    } finally {
      running = false;
    }
  };
  const network = addNetworkStateListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) void attempt();
  });
  const app = AppState.addEventListener('change', (state) => {
    if (state === 'active') void attempt();
  });
  return () => {
    closed = true;
    network.remove();
    app.remove();
  };
}
