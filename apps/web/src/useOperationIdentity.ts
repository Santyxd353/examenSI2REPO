import { useRef } from 'react';
import { canonicalJson } from '@lumina/contracts';

// Keep the original UUID when the server response was lost. Clear only after a response succeeds.
export function useOperationIdentity() {
  const pending = useRef(new Map<string, string>());
  return {
    forPayload(payload: unknown) {
      const key = canonicalJson(JSON.parse(JSON.stringify(payload)));
      const id = pending.current.get(key) ?? crypto.randomUUID();
      pending.current.set(key, id);
      return id;
    },
    complete(payload: unknown) {
      pending.current.delete(canonicalJson(JSON.parse(JSON.stringify(payload))));
    },
  };
}
let memoryDevice = '';
export function webDeviceId() {
  try {
    const key = 'lumina.web-installation';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return (memoryDevice ||= crypto.randomUUID());
  }
}
