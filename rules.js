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
  clockMinutes(scheduleStart); clockMinutes(scheduleEnd);
  const required = REQUIRED_REGULAR_MINUTES;
  const date = inUtc ? localDateTime(inUtc, timeZone).date : null;
  const worked = date && outUtc ? workBreakdown(date, inUtc, outUtc, null, scheduleStart, scheduleEnd).regularMinutes : 0;
  const shortfall = outUtc ? Math.max(0, required - worked) : 0;
  return {
    late: 0,
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

// Payroll uses actual worked time. Scheduled clock times are planning metadata.
// The company unpaid lunch is 12:00–13:00; recorded gaps are also unpaid.
function paidIntervals(date, intervals) {
  const lunchStart = Date.parse(shiftInstant(date, BREAK_START));
  const lunchEnd = Date.parse(shiftInstant(date, BREAK_END));
  const cutoff = Date.parse(shiftInstant(date, NIGHT_END, true));
  const merged = [];
  for (const item of intervals.filter(item => item.inUtc && item.outUtc)
    .map(item => ({ start: Date.parse(item.inUtc), end: Math.min(Date.parse(item.outUtc), cutoff) }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else merged.push({ ...item });
  }
  return merged.flatMap(({ start, end }) => [
    { start, end: Math.min(end, lunchStart) },
    { start: Math.max(start, lunchEnd), end }
  ].filter(item => item.end > item.start));
}

export function expectedTimeOut(date, intervals = []) {
  let remaining = REQUIRED_REGULAR_MINUTES * 60000;
  for (const item of paidIntervals(date, intervals)) {
    if (item.end - item.start >= remaining) return new Date(item.start + remaining).toISOString();
    remaining -= item.end - item.start;
  }
  const last = intervals.filter(item => Number.isFinite(Date.parse(item.inUtc)) &&
    (!item.outUtc || Number.isFinite(Date.parse(item.outUtc)))).at(-1);
  if (!last) return null;
  let start = Date.parse(last.outUtc || last.inUtc);
  const lunchStart = Date.parse(shiftInstant(date, BREAK_START));
  const lunchEnd = Date.parse(shiftInstant(date, BREAK_END));
  if (start >= lunchStart && start < lunchEnd) start = lunchEnd;
  let end = start + remaining;
  if (start < lunchStart && end > lunchStart) end += lunchEnd - lunchStart;
  return new Date(end).toISOString();
}

export function workBreakdown(date, inUtc, outUtc, continuedAtUtc = null,
  scheduleStart = REGULAR_START, scheduleEnd = REGULAR_END) {
  return workBreakdownIntervals(date, [{ inUtc, outUtc }], continuedAtUtc, scheduleStart, scheduleEnd);
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

// Merge overlaps defensively so a minute can never be paid twice.
export function workBreakdownIntervals(date, intervals = [], continuedAtUtc = null,
  scheduleStart = REGULAR_START, scheduleEnd = REGULAR_END) {
  const paid = paidIntervals(date, intervals);
  const workedMinutes = Math.floor(paid.reduce((sum, item) => sum + item.end - item.start, 0) / 60000);
  const regularMinutes = Math.min(REQUIRED_REGULAR_MINUTES, workedMinutes);
  const overtimeEnd = Date.parse(shiftInstant(date, OVERTIME_END));
  let regularRemainingMs = REQUIRED_REGULAR_MINUTES * 60000, overtimeMs = 0;
  for (const item of paid) {
    const regularMs = Math.min(regularRemainingMs, item.end - item.start);
    regularRemainingMs -= regularMs;
    // After eight actual hours, OT can accrue only until 10 PM on the work date.
    overtimeMs += Math.max(0, Math.min(item.end, overtimeEnd) - (item.start + regularMs));
  }
  const overtimeMinutes = Math.floor(overtimeMs / 60000);
  const earlyNightStart = Date.parse(shiftInstant(date, '00:00'));
  const earlyNightEnd = Date.parse(shiftInstant(date, NIGHT_END));
  const nightStart = Date.parse(shiftInstant(date, OVERTIME_END));
  const nightEnd = Date.parse(shiftInstant(date, NIGHT_END, true));
  const nightCandidateMinutes = paid.reduce((sum, item) => sum +
    overlapMinutes(item.start, item.end, earlyNightStart, earlyNightEnd) +
    overlapMinutes(item.start, item.end, nightStart, nightEnd), 0);
  const shortageMinutes = REQUIRED_REGULAR_MINUTES - regularMinutes;
  return { workedMinutes, regularMinutes, shortageMinutes, undertimeMinutes: shortageMinutes,
    overtimeBeforeAdjustmentMinutes: overtimeMinutes, proposedTransferMinutes: 0,
    resultingRegularMinutes: regularMinutes, remainingOvertimeMinutes: overtimeMinutes,
    overtimeCandidateMinutes: overtimeMinutes, nightCandidateMinutes,
    overtimeEligible: overtimeMinutes >= MIN_OVERTIME_MINUTES,
    expectedTimeOutUtc: expectedTimeOut(date, intervals) };
}

export function premiumCalculationKey(date, punches) {
  return JSON.stringify(['actual-hours-v2-ot22', date, groupPunches(punches).map(group => [
    group.inPunch?.timeUtc || null, group.outPunch?.timeUtc || null,
    group.inPunch?.scheduleStart || REGULAR_START, group.inPunch?.scheduleEnd || REGULAR_END
  ])]);
}

export function payrollDayTotals(date, punches, extension) {
  const hours = workBreakdownIntervals(date, groupPunches(punches).map(group => ({
    inUtc: group.inPunch?.timeUtc, outUtc: group.outPunch?.timeUtc
  })));
  const ready = isPayrollDayReady(punches);
  const reviewed = extension?.calculationKey === premiumCalculationKey(date, punches);
  return { regular: ready ? hours.regularMinutes : 0,
    undertime: ready ? hours.undertimeMinutes : 0,
    overtime: ready && reviewed && extension.overtimeDecision === 'APPROVED' ? hours.overtimeCandidateMinutes : 0,
    night: ready && reviewed && extension.nightDecision === 'APPROVED' ? hours.nightCandidateMinutes : 0 };
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
