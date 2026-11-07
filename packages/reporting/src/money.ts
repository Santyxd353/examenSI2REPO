import { problem } from './coverage';
import { ReportError } from './validate';

export function safeNumber(value: bigint) {
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new ReportError([
      problem('REPORT_TOTAL_OVERFLOW', 'El total excede el rango de enteros seguros.'),
    ]);
  return result;
}
export function ticketMinor(amount: bigint, orders: number) {
  const divisor = BigInt(orders);
  return safeNumber((amount + divisor / 2n) / divisor);
}
export function decimalMinor(value: number) {
  const cents = BigInt(value),
    positive = cents < 0n ? -cents : cents;
  return (
    (cents < 0n ? '-' : '') +
    (positive / 100n).toString() +
    '.' +
    (positive % 100n).toString().padStart(2, '0')
  );
}
