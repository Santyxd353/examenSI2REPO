import { canonicalJson } from '@lumina/contracts';
import { ApiProblem } from '../../errors/ApiProblem';

export type SalePayload = {
  locationId: string;
  customerName?: string;
  paymentMethod: 'EFECTIVO' | 'TARJETA' | 'QR';
  items: { variantId: string; quantity: number }[];
};
export type SaleReceipt = {
  id: string;
  numero: string;
  total: string | number;
  estado: string;
  canal: string;
  ubicacion_id: string;
  idempotencia: string;
};
export type SaleSummary = { location: string; lines: string[]; totalCents: number };
export type StoredSale = {
  id: string;
  payload: SalePayload;
  phase: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  summary?: SaleSummary;
  receipt?: SaleReceipt;
  error?: string;
};
export type SaleIO = {
  guard(): void;
  uuid(): string;
  read(): Promise<StoredSale | null>;
  save(value: StoredSale): Promise<void>;
  clear(): Promise<void>;
  send(body: SalePayload & { idempotency: string }): Promise<unknown>;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function salePayload(raw: SalePayload): SalePayload {
  const name = raw.customerName?.trim();
  if (
    !uuid.test(raw.locationId) ||
    !['EFECTIVO', 'TARJETA', 'QR'].includes(raw.paymentMethod) ||
    (name && (name.length < 2 || name.length > 160)) ||
    !Array.isArray(raw.items) ||
    !raw.items.length ||
    raw.items.length > 30 ||
    raw.items.some(
      (line) =>
        !uuid.test(line.variantId) ||
        !Number.isInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > 100,
    ) ||
    new Set(raw.items.map((line) => line.variantId.toLowerCase())).size !== raw.items.length
  )
    throw new Error('Revisa ubicación, prendas, cantidades y nombre de la clienta.');
  return {
    locationId: raw.locationId.toLowerCase(),
    paymentMethod: raw.paymentMethod,
    ...(name ? { customerName: name } : {}),
    items: raw.items
      .map((line) => ({ variantId: line.variantId.toLowerCase(), quantity: line.quantity }))
      .sort((a, b) => a.variantId.localeCompare(b.variantId)),
  };
}
/** Intención durable: nunca se confunde refrescar la pantalla con registrar otra venta. */
export class PointOfSaleWorkflow {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private io: SaleIO) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => {});
    return result;
  }
  async current() {
    this.io.guard();
    const saved = await this.io.read();
    this.io.guard();
    if (saved) {
      salePayload(saved.payload);
      if (!uuid.test(saved.id) || !['PENDING', 'CONFIRMED', 'REJECTED'].includes(saved.phase))
        throw new Error('No se pudo abrir la venta guardada.');
    }
    return saved;
  }
  submit(raw: SalePayload, summary?: SaleSummary) {
    return this.serial(async () => {
      this.io.guard();
      const payload = salePayload(raw);
      let intent = await this.current();
      if (intent && canonicalJson(intent.payload) !== canonicalJson(payload))
        throw new Error('Primero resuelve la venta pendiente antes de cambiar sus datos.');
      if (intent?.phase === 'CONFIRMED' && intent.receipt) return intent.receipt;
      if (intent?.phase === 'REJECTED')
        throw new Error('Corrige la venta rechazada iniciando un formulario nuevo.');
      if (!intent) {
        intent = { id: this.io.uuid(), payload, phase: 'PENDING', ...(summary ? { summary } : {}) };
        await this.io.save(intent);
        this.io.guard();
      }
      try {
        const rawReceipt = await this.io.send({ ...intent.payload, idempotency: intent.id });
        this.io.guard();
        const receipt = rawReceipt as SaleReceipt;
        if (
          !receipt ||
          !uuid.test(receipt.id) ||
          receipt.idempotencia !== intent.id ||
          receipt.canal !== 'TIENDA' ||
          receipt.ubicacion_id !== payload.locationId ||
          typeof receipt.numero !== 'string' ||
          !receipt.numero ||
          !Number.isFinite(Number(receipt.total)) ||
          Number(receipt.total) < 0 ||
          typeof receipt.estado !== 'string'
        )
          throw new Error(
            'La respuesta no contiene un comprobante válido. Reintenta la misma venta.',
          );
        await this.io.save({ ...intent, phase: 'CONFIRMED', receipt, error: undefined });
        this.io.guard();
        return receipt;
      } catch (reason) {
        this.io.guard();
        const definitive = reason instanceof ApiProblem && [400, 422].includes(reason.status);
        await this.io.save({
          ...intent,
          phase: definitive ? 'REJECTED' : 'PENDING',
          error: (reason as Error).message,
        });
        this.io.guard();
        throw reason;
      }
    });
  }
  startNew() {
    return this.serial(async () => {
      const saved = await this.current();
      if (saved?.phase === 'PENDING')
        throw new Error('Reintenta la venta pendiente antes de iniciar otra.');
      this.io.guard();
      await this.io.clear();
      this.io.guard();
    });
  }
}
