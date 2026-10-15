export function distanceMeters(aLat, aLng, bLat, bLng) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function localDateTime(instant, timeZone = 'Asia/Manila') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(instant)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), time: `${parts.hour}:${parts.minute}` };
}

export function cutoffFor(dateString, startDays = [11, 26]) {
  const [year, month, day] = dateString.split('-').map(Number);
  const starts = [...new Set(startDays.map(Number))].sort((a, b) => a - b);
  if (starts.length !== 2 || starts.some(n => n < 1 || n > 28)) throw new Error('Two cutoff start days between 1 and 28 are required.');
  let startYear = year, startMonth = month, startDay = starts[0];
  if (day >= starts[1]) startDay = starts[1];
  else if (day < starts[0]) {
    startMonth -= 1;
    if (startMonth === 0) { startMonth = 12; startYear -= 1; }
    startDay = starts[1];
  }
  let nextYear = startYear, nextMonth = startMonth, nextDay = startDay === starts[0] ? starts[1] : starts[0];
  if (startDay === starts[1]) {
    nextMonth += 1;
    if (nextMonth === 13) { nextMonth = 1; nextYear += 1; }
  }
  const pad = n => String(n).padStart(2, '0');
  const end = new Date(Date.UTC(nextYear, nextMonth - 1, nextDay) - 86400000);
  return { start: `${startYear}-${pad(startMonth)}-${pad(startDay)}`, end: end.toISOString().slice(0, 10) };
}

export function attendanceMinutes(inUtc, outUtc, scheduleStart, scheduleEnd, timeZone) {
  const start = clockMinutes(scheduleStart), end = clockMinutes(scheduleEnd);
  const inMinute = inUtc ? localDateTime(inUtc, timeZone).minutes : null;
  const outMinute = outUtc ? localDateTime(outUtc, timeZone).minutes : null;
  return {
    late: inMinute === null ? 0 : Math.max(0, inMinute - start),
    early: outMinute === null ? 0 : Math.max(0, end - outMinute)
  };
}

export function clockMinutes(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) throw new Error('Time must be HH:MM.');
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function safeDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const REGULAR_START = '08:00';
export const REGULAR_END = '17:00';
export const OVERTIME_END = '22:00';
export const NIGHT_END = '06:00';
export const MIN_OVERTIME_MINUTES = 60;

export function nextDate(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

export function shiftInstant(date, time, nextDay = false) {
  if (!safeDate(date)) throw new Error('Valid work date is required.');
  clockMinutes(time);
  return new Date(`${nextDay ? nextDate(date) : date}T${time}:00+08:00`).toISOString();
}

function overlapMinutes(start, end, windowStart, windowEnd) {
  return Math.max(0, Math.floor((Math.min(end, windowEnd) - Math.max(start, windowStart)) / 60000));
}

export function workBreakdown(date, inUtc, outUtc, continuedAtUtc = null) {
  const empty = { regularMinutes: 0, undertimeMinutes: 0, overtimeCandidateMinutes: 0,
    nightCandidateMinutes: 0, overtimeEligible: false };
  if (!inUtc || !outUtc) return empty;
  const start = Date.parse(inUtc), out = Date.parse(outUtc);
  if (!Number.isFinite(start) || !Number.isFinite(out) || out <= start) return empty;
  const regularStart = Date.parse(shiftInstant(date, REGULAR_START));
  const regularEnd = Date.parse(shiftInstant(date, REGULAR_END));
  const overtimeEnd = Date.parse(shiftInstant(date, OVERTIME_END));
  const nightEnd = Date.parse(shiftInstant(date, NIGHT_END, true));
  const regularMinutes = overlapMinutes(start, out, regularStart, regularEnd);
  const undertimeMinutes = start < regularEnd ? Math.max(0, Math.floor((regularEnd - Math.max(start, out)) / 60000)) : 0;
  const continuedAt = continuedAtUtc ? Date.parse(continuedAtUtc) : NaN;
  const overtimeCandidateMinutes = Number.isFinite(continuedAt)
    ? overlapMinutes(Math.max(start, continuedAt), out, regularEnd, overtimeEnd) : 0;
  const overtimeEligible = overtimeCandidateMinutes >= MIN_OVERTIME_MINUTES;
  const nightCandidateMinutes = overtimeEligible
    ? overlapMinutes(Math.max(start, continuedAt), out, overtimeEnd, nightEnd) : 0;
  return { regularMinutes, undertimeMinutes, overtimeCandidateMinutes,
    nightCandidateMinutes, overtimeEligible };
}

export function holidayFor(date, holidays = []) {
  return holidays.find(holiday => holiday.date === date) || null;
}

export function isScheduledWorkday(date, workdays, holidays = []) {
  return !holidayFor(date, holidays) && workdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}
