export async function placeOrderAndRefresh<T>(
  placeOrder: () => Promise<T>,
  refresh: () => Promise<void>,
): Promise<{ order: T; refreshFailed: boolean }> {
  const order = await placeOrder();
  try {
    await refresh();
    return { order, refreshFailed: false };
  } catch {
    return { order, refreshFailed: true };
  }
}
