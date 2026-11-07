const periods = () =>
  require('../src/billing/periods') as {
    calendarMonthAfter(date: Date, anchorDay?: number): Date;
    monthlyPeriodAt(anchor: Date, now: Date): { from: Date; to: Date };
  };

test('aniversario del31 usa último día de febrero y recupera31 en marzo, hora Bolivia', () => {
  const { calendarMonthAfter } = periods();
  const january = new Date('2026-02-01T03:30:00.123Z'); // 31 enero23:30 Bolivia
  const february = calendarMonthAfter(january, 31);
  expect(february.toISOString()).toBe('2026-03-01T03:30:00.123Z');
  expect(calendarMonthAfter(february, 31).toISOString()).toBe('2026-04-01T03:30:00.123Z');
});

test('activación nocturna del30 no pierde otro día por calcular meses en UTC', () => {
  expect(periods().calendarMonthAfter(new Date('2026-01-31T03:30:00.123Z'), 30).toISOString()).toBe(
    '2026-03-01T03:30:00.123Z',
  );
});

test('intervalos mensuales son desde inclusivo y hasta exclusivo con ancla original', () => {
  const anchor = new Date('2026-02-01T03:30:00.123Z');
  const first = periods().monthlyPeriodAt(anchor, new Date('2026-03-01T03:30:00.122Z'));
  const second = periods().monthlyPeriodAt(anchor, first.to);
  expect(first.from.toISOString()).toBe(anchor.toISOString());
  expect(second.from.toISOString()).toBe(first.to.toISOString());
  expect(second.to.toISOString()).toBe('2026-04-01T03:30:00.123Z');
});

test('año bisiesto y fechas inválidas tienen resultado explícito', () => {
  expect(periods().calendarMonthAfter(new Date('2028-02-01T03:00:00Z'), 31).toISOString()).toBe(
    '2028-03-01T03:00:00.000Z',
  );
  expect(() => periods().calendarMonthAfter(new Date(NaN))).toThrow();
  expect(() => periods().calendarMonthAfter(new Date(), 0)).toThrow();
});
