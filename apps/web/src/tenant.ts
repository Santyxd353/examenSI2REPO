const selectionKey = 'lumina.selected-store';
function initialTenantSlug() {
  if (typeof window === 'undefined') return 'lumina';
  const parameter = new URLSearchParams(window.location.search).get('tienda');
  if (parameter) return parameter;
  try {
    return localStorage.getItem(selectionKey) || 'lumina';
  } catch {
    return 'lumina';
  }
}
// Una pestaña conserva su tienda hasta una navegación completa. localStorage es
// compartido y otra pestaña puede cambiar la preferencia para futuras aperturas.
const selectedTenant = initialTenantSlug();
export const tenantSlug = () => selectedTenant;
export function selectTenant(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 63)
    throw new Error('Selecciona una tienda válida.');
  try {
    localStorage.setItem(selectionKey, slug);
  } catch {
    /* La URL también conserva la selección. */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('tienda', slug);
  window.location.assign(url.toString());
}
export function tenantAsset(path: string) {
  const slug = tenantSlug();
  return slug !== 'lumina' && path.startsWith('/assets/') ? `/stores/${slug}${path}` : path;
}
