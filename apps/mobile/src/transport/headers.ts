import type { ScopeKey } from '../auth/sessionScope';

export function createApiHeaders(
  original: HeadersInit | undefined,
  requestScope: ScopeKey,
  accessToken: string,
  body: BodyInit | null | undefined,
): Headers {
  const headers = new Headers(original);
  headers.set('X-Client-Channel', 'APP');
  headers.set('X-Tenant-Slug', requestScope.tenantSlug);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const formData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (formData) headers.delete('Content-Type');
  else if (typeof body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return headers;
}
