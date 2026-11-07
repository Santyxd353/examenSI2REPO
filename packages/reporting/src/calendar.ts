const bolivia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz',
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const DAY = 86400000;

export function boliviaDate(timestamp: string) {
  const date = bolivia.formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    date.find((item) => item.type === type)!.value;
  return part('year').padStart(4, '0') + '-' + part('month') + '-' + part('day');
}
export function isoWeek(day: string) {
  const thursday = new Date(day + 'T00:00:00Z');
  const isoDay = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - isoDay);
  const year = thursday.getUTCFullYear();
  const first = new Date(thursday.getTime());
  first.setUTCMonth(0, 1);
  const week = Math.ceil((1 + (thursday.getTime() - first.getTime()) / DAY) / 7);
  return String(year).padStart(4, '0') + '-W' + String(week).padStart(2, '0');
}
