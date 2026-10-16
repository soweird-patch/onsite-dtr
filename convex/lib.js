import { cutoffFor, distanceMeters, localDateTime, clockMinutes, safeDate } from '../rules.js';
import { noWorkHolidays, philippineHolidays } from '../philippineHolidays.js';

export { distanceMeters, localDateTime, clockMinutes, safeDate };
export const timezone = 'Asia/Manila';
export const now = () => new Date().toISOString();
export const dayNow = () => localDateTime(now(), timezone).date;

export const settingsDefault = () => ({ key: 'main', siteName: 'Main site', radiusM: 150,
  maxAccuracyM: 100, cutoffDays: [11, 26], siteVersion: 1, holidays: [],
  appName: 'Onsite DTR', updatedAt: now() });

export async function settings(ctx) {
  const row = await ctx.db.query('settings').withIndex('by_key', q => q.eq('key', 'main')).unique();
  return row || settingsDefault();
}

export function settingsView(row) {
  return { siteName: row.siteName, siteLat: row.siteLat ?? null, siteLng: row.siteLng ?? null,
    radiusM: row.radiusM, maxAccuracyM: row.maxAccuracyM, cutoffDays: row.cutoffDays,
    siteVersion: row.siteVersion, holidays: noWorkHolidays(row.holidays || []),
    legalHolidays: philippineHolidays, customHolidays: row.holidays || [],
    appName: row.appName || 'Onsite DTR',
    updatedAt: row.updatedAt, configured: row.siteLat !== undefined && row.siteLng !== undefined };
}

export function userView(row) {
  return { id: row._id, name: row.name, email: row.email ?? null, mobile: row.mobile ?? null, role: row.role,
    active: row.active, scheduleStart: '08:00', scheduleEnd: '17:00',
    workdays: row.workdays };
}

export function punchView(row, name) {
  return { id: row._id, userId: row.userId, employeeName: name,
    workDate: row.workDate, slot: row.slot, method: row.method, timeUtc: row.timeUtc,
    submittedAt: row.submittedAt, latitude: row.latitude ?? null, longitude: row.longitude ?? null,
    accuracyM: row.accuracyM ?? null, distanceM: row.distanceM ?? null,
    hasSelfie: !!row.selfieId, note: row.note, verification: row.verification,
    assignmentType: row.assignmentType ?? null,
    rejectionReason: row.rejectionReason ?? null, createdBy: row.createdBy ?? null,
    reviewedBy: row.reviewedBy ?? null, reviewedAt: row.reviewedAt ?? null,
    siteVersion: row.siteVersion ?? null, active: row.active };
}

async function digest(token) {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export { digest };

export async function authUser(ctx, token, role) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Please sign in.');
  const hash = await digest(token);
  const session = await ctx.db.query('sessions').withIndex('by_hash', q => q.eq('tokenHash', hash)).unique();
  if (!session || session.expiresAt <= Date.now()) throw new Error('Please sign in.');
  const user = await ctx.db.get(session.userId);
  if (!user?.active) throw new Error('Please sign in.');
  if (role && user.role !== role) throw new Error('Not allowed.');
  return user;
}

export function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

export function validateEmployee(input, creating) {
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.length > 120)
    throw new Error('Employee name must have 2–120 characters.');
  if (typeof input.mobile !== 'string' || !/^\d{11}$/.test(input.mobile))
    throw new Error('Employee mobile number must contain exactly 11 digits.');
  if (creating && (!input.passwordHash || typeof input.passwordHash !== 'string'))
    throw new Error('Temporary password is required.');
  clockMinutes(input.scheduleStart); clockMinutes(input.scheduleEnd);
  if (input.scheduleStart !== '08:00' || input.scheduleEnd !== '17:00')
    throw new Error('The regular schedule is fixed at 8:00 AM–5:00 PM: 8 regular hours, with 12:00–1:00 PM included.');
  if (!Array.isArray(input.workdays) || !input.workdays.length ||
      input.workdays.some(n => !Number.isInteger(n) || n < 0 || n > 6))
    throw new Error('Choose valid workdays.');
}

export function dateRange(from, to, config) {
  const current = cutoffFor(dayNow(), config.cutoffDays);
  from ||= current.start; to ||= current.end;
  if (!safeDate(from) || !safeDate(to) || from > to ||
      (Date.parse(to) - Date.parse(from)) > 1000 * 86400 * 370)
    throw new Error('Invalid date range.');
  return { from, to };
}

export async function audit(ctx, actorId, action, targetType, targetId, details = {}) {
  await ctx.db.insert('audit', { actorId, action, targetType, targetId: String(targetId), details, createdAt: now() });
}

export function localTimeToUtc(date, time) {
  clockMinutes(time);
  const value = new Date(`${date}T${time}:00+08:00`);
  if (Number.isNaN(value.getTime())) throw new Error('Invalid date/time.');
  return value.toISOString();
}
