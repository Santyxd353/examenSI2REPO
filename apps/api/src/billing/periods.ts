const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
};
function parts(date: Date): WallTime {
  if (!Number.isFinite(date.getTime())) throw new RangeError('Fecha de facturación inválida.');
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
  return { ...values, ms: date.getUTCMilliseconds() } as WallTime;
}
const wallStamp = (p: WallTime) =>
  Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.ms);
function instant(wall: WallTime): Date {
  const target = wallStamp(wall);
  let candidate = target;
  for (let i = 0; i < 3; i++) {
    const adjustment = target - wallStamp(parts(new Date(candidate)));
    if (!adjustment) break;
    candidate += adjustment;
  }
  const result = new Date(candidate);
  if (wallStamp(parts(result)) !== target)
    throw new RangeError('Hora local de facturación inválida.');
  return result;
}
function boundary(anchor: WallTime, offset: number, day = anchor.day): Date {
  const month = new Date(Date.UTC(anchor.year, anchor.month - 1 + offset, 1));
  const maximum = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return instant({
    ...anchor,
    year: month.getUTCFullYear(),
    month: month.getUTCMonth() + 1,
    day: Math.min(day, maximum),
  });
}
export function calendarMonthAfter(date: Date, anchorDay?: number): Date {
  const p = parts(date),
    day = anchorDay ?? p.day;
  if (!Number.isInteger(day) || day < 1 || day > 31)
    throw new RangeError('Día de aniversario inválido.');
  return boundary(p, 1, day);
}
export function billingAnchorDay(date: Date): number {
  return parts(date).day;
}
export function calendarYearAfter(date: Date): Date {
  return boundary(parts(date), 12);
}
export function monthlyPeriodAt(anchor: Date, now: Date): { from: Date; to: Date } {
  const a = parts(anchor),
    n = parts(now);
  if (now < anchor) throw new RangeError('El ciclo todavía no comenzó.');
  let index = (n.year - a.year) * 12 + n.month - a.month;
  if (boundary(a, index) > now) index--;
  return { from: boundary(a, index), to: boundary(a, index + 1) };
}
