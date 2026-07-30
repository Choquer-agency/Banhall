export const FIRM_TIME_ZONE = "America/Vancouver";
const DAY_MS = 86_400_000;

type CivilDate = { year: number; month: number; day: number };

function nthSunday(year: number, monthIndex: number, occurrence: number) {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return 1 + ((7 - firstWeekday) % 7) + (occurrence - 1) * 7;
}

function pacificUtcTransitions(year: number) {
  const marchSunday = nthSunday(year, 2, 2);
  const novemberSunday = nthSunday(year, 10, 1);
  return {
    startsAt: Date.UTC(year, 2, marchSunday, 10),
    endsAt: Date.UTC(year, 10, novemberSunday, 9),
  };
}

export function firmUtcOffsetMinutes(timestamp: number) {
  const year = new Date(timestamp).getUTCFullYear();
  const { startsAt, endsAt } = pacificUtcTransitions(year);
  return timestamp >= startsAt && timestamp < endsAt ? -420 : -480;
}

export function firmDateParts(timestamp: number): CivilDate {
  const shifted = new Date(timestamp + firmUtcOffsetMinutes(timestamp) * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function civilDateString({ year, month, day }: CivilDate) {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function firmMidnightUsesDaylightTime(date: CivilDate) {
  const marchSunday = nthSunday(date.year, 2, 2);
  const novemberSunday = nthSunday(date.year, 10, 1);
  if (date.month < 3 || date.month > 11) return false;
  if (date.month > 3 && date.month < 11) return true;
  if (date.month === 3) return date.day > marchSunday;
  return date.day <= novemberSunday;
}

export function firmDateStartUtc(date: CivilDate) {
  const offsetMinutes = firmMidnightUsesDaylightTime(date) ? -420 : -480;
  return Date.UTC(date.year, date.month - 1, date.day) - offsetMinutes * 60_000;
}

export function firmDayNumber(timestamp: number) {
  const date = firmDateParts(timestamp);
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / DAY_MS);
}

export function firmDateStartAfterDays(timestamp: number, days: number) {
  return firmDateStartUtc(addCivilDays(firmDateParts(timestamp), days));
}

export function isFirmDateStart(timestamp: number) {
  const date = firmDateParts(timestamp);
  return firmDateStartUtc(date) === timestamp;
}
