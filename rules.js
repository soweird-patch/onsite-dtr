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
  const required = Math.min(REQUIRED_REGULAR_MINUTES, Math.max(0, end - start));
  const date = inUtc ? localDateTime(inUtc, timeZone).date : null;
  const worked = date && outUtc ? workBreakdown(date, inUtc, outUtc, null, scheduleStart, scheduleEnd).regularMinutes : 0;
  const shortfall = outUtc ? Math.max(0, required - worked) : 0;
  const arrivalDelay = inMinute === null ? 0 : Math.max(0, inMinute - start);
  return {
    late: Math.min(arrivalDelay, shortfall),
    early: shortfall
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
export const MIN_OVERTIME_MINUTES = 1;
export const REQUIRED_REGULAR_MINUTES = 8 * 60;
export const BREAK_START = '12:00';
export const BREAK_END = '13:00';

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

function breakdownWindows(date, scheduleStart, scheduleEnd) {
  const regularStart = Date.parse(shiftInstant(date, scheduleStart));
  const regularEnd = Date.parse(shiftInstant(date, scheduleEnd));
  const breakStart = Date.parse(shiftInstant(date, BREAK_START));
  const breakEnd = Date.parse(shiftInstant(date, BREAK_END));
  return { regularStart, regularEnd, breakStart, breakEnd,
    overtimeStart: Date.parse(shiftInstant(date, REGULAR_END)),
    overtimeEnd: Date.parse(shiftInstant(date, OVERTIME_END)),
    nightEnd: Date.parse(shiftInstant(date, NIGHT_END, true)) };
}

function finalizeBreakdown(regularMinutes, overtimeBeforeAdjustmentMinutes, nightCandidateMinutes) {
  regularMinutes = Math.min(REQUIRED_REGULAR_MINUTES, regularMinutes);
  const shortageMinutes = Math.max(0, REQUIRED_REGULAR_MINUTES - regularMinutes);
  const proposedTransferMinutes = Math.min(shortageMinutes, overtimeBeforeAdjustmentMinutes);
  const remainingOvertimeMinutes = Math.max(0, overtimeBeforeAdjustmentMinutes - proposedTransferMinutes);
  return { regularMinutes, shortageMinutes, undertimeMinutes: shortageMinutes,
    overtimeBeforeAdjustmentMinutes, proposedTransferMinutes,
    resultingRegularMinutes: regularMinutes + proposedTransferMinutes,
    remainingOvertimeMinutes, overtimeCandidateMinutes: overtimeBeforeAdjustmentMinutes,
    nightCandidateMinutes, overtimeEligible: overtimeBeforeAdjustmentMinutes >= MIN_OVERTIME_MINUTES };
}

function scheduledMinutes(start, end, windows) {
  return overlapMinutes(start, end, windows.regularStart, windows.regularEnd) -
    overlapMinutes(start, end, Math.max(windows.regularStart, windows.breakStart),
      Math.min(windows.regularEnd, windows.breakEnd));
}

function overtimeMinutes(start, end, windows) {
  const raw = overlapMinutes(start, end, windows.overtimeStart, windows.overtimeEnd);
  const scheduledOverlap = overlapMinutes(start, end,
    Math.max(windows.overtimeStart, windows.regularStart),
    Math.min(windows.overtimeEnd, windows.regularEnd));
  return Math.max(0, raw - scheduledOverlap);
}

export function workBreakdown(date, inUtc, outUtc, continuedAtUtc = null,
  scheduleStart = REGULAR_START, scheduleEnd = REGULAR_END) {
  const empty = finalizeBreakdown(0, 0, 0);
  if (!inUtc || !outUtc) return empty;
  const start = Date.parse(inUtc), out = Date.parse(outUtc);
  if (!Number.isFinite(start) || !Number.isFinite(out) || out <= start) return empty;
  const windows = breakdownWindows(date, scheduleStart, scheduleEnd);
  const previousDate = new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const earlyNightStart = Date.parse(shiftInstant(previousDate, OVERTIME_END));
  const earlyNightEnd = Date.parse(shiftInstant(date, NIGHT_END));
  const regularMinutes = scheduledMinutes(start, out, windows);
  const overtimeBeforeAdjustmentMinutes = overtimeMinutes(start, out, windows);
  const nightCandidateMinutes = overlapMinutes(start, out, earlyNightStart, earlyNightEnd) +
    overlapMinutes(start, out, windows.overtimeEnd, windows.nightEnd);
  return finalizeBreakdown(regularMinutes, overtimeBeforeAdjustmentMinutes, nightCandidateMinutes);
}

export function groupPunches(punches = []) {
  const groups = new Map();
  for (const punch of punches) {
    const number = punch.segment || 1;
    if (!groups.has(number)) groups.set(number, { number, inPunch: null, outPunch: null });
    groups.get(number)[punch.slot === 'IN' ? 'inPunch' : 'outPunch'] = punch;
  }
  return [...groups.values()].sort((a, b) => a.number - b.number);
}

export function isPayrollDayReady(punches) {
  const segments = groupPunches(punches);
  return segments.length > 0 && segments.every(({ inPunch, outPunch }) => isPayrollReady(inPunch, outPunch));
}

// Count only time inside recorded work intervals. Gaps between punches never earn hours.
export function workBreakdownIntervals(date, intervals, continuedAtUtc = null,
  scheduleStart = REGULAR_START, scheduleEnd = REGULAR_END) {
  const complete = intervals.filter(item => item.inUtc && item.outUtc)
    .map(item => ({ start: Date.parse(item.inUtc), end: Date.parse(item.outUtc) }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start);
  if (complete.length === 1) return workBreakdown(date, new Date(complete[0].start).toISOString(),
    new Date(complete[0].end).toISOString(), continuedAtUtc, scheduleStart, scheduleEnd);
  if (!complete.length) return workBreakdown(date, null, null, continuedAtUtc, scheduleStart, scheduleEnd);
  const windows = breakdownWindows(date, scheduleStart, scheduleEnd);
  const previousDate = new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const earlyNightStart = Date.parse(shiftInstant(previousDate, OVERTIME_END));
  const earlyNightEnd = Date.parse(shiftInstant(date, NIGHT_END));
  const regularMinutes = complete.reduce((sum, item) => sum + scheduledMinutes(item.start, item.end, windows), 0);
  const overtimeBeforeAdjustmentMinutes = complete.reduce((sum, item) =>
    sum + overtimeMinutes(item.start, item.end, windows), 0);
  const nightCandidateMinutes = complete.reduce((sum, item) => sum +
    overlapMinutes(item.start, item.end, earlyNightStart, earlyNightEnd) +
    overlapMinutes(item.start, item.end, windows.overtimeEnd, windows.nightEnd), 0);
  return finalizeBreakdown(regularMinutes, overtimeBeforeAdjustmentMinutes, nightCandidateMinutes);
}

export function holidayFor(date, holidays = []) {
  return holidays.find(holiday => holiday.date === date) || null;
}

export function isScheduledWorkday(date, workdays, holidays = []) {
  return !holidayFor(date, holidays) && workdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

export function isPayrollReady(inPunch, outPunch) {
  return Boolean(inPunch && outPunch &&
    inPunch.verification === 'APPROVED' && outPunch.verification === 'APPROVED');
}
