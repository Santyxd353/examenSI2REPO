type CheckoutLine = { quantity: number; available: number; price: number };

export function checkoutBlocker(input: {
  locationSelected: boolean;
  address: string;
  lines: CheckoutLine[];
}): string | null {
  if (!input.locationSelected) return 'Selecciona una sucursal o almacén para continuar.';
  if (input.address.trim().length < 10)
    return 'Escribe una dirección de entrega o retiro de al menos 10 caracteres.';
  if (input.lines.some((line) => line.available < line.quantity))
    return 'La cantidad supera las existencias de esta ubicación. Ajusta el carrito.';
  if (input.lines.some((line) => line.price <= 0))
    return 'Una prenda no tiene precio disponible. Actualiza el carrito o elige otra ubicación.';
  return null;
}
