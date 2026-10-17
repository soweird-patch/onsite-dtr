import { query, mutation, internalQuery, internalMutation } from './_generated/server.js';
import { internal } from './_generated/api.js';
import { v } from 'convex/values';
import { cutoffFor, groupPunches, holidayFor, localDateTime, shiftInstant, workBreakdownIntervals } from '../rules.js';
import { audit, authUser, dateRange, dayNow, digest, distanceMeters, localTimeToUtc,
  now, punchView, safeDate, settings, settingsDefault, settingsView, timezone,
  userView, validateEmployee, validEmail } from './lib.js';

const tokenArg = { token: v.string() };

async function userByEmail(ctx, email) {
  return ctx.db.query('users').withIndex('by_email', q => q.eq('email', email)).unique();
}
async function userByMobile(ctx, mobile) {
  return ctx.db.query('users').withIndex('by_mobile', q => q.eq('mobile', mobile)).unique();
}
async function punchFor(ctx, userId, date, slot) {
  const rows = await ctx.db.query('punches').withIndex('by_user_date', q => q.eq('userId', userId).eq('workDate', date)).collect();
  return rows.find(p => p.slot === slot && (p.segment || 1) === 1 && p.active);
}
async function activeDayPunches(ctx, userId, date) {
  const rows = await ctx.db.query('punches').withIndex('by_user_date', q => q.eq('userId', userId).eq('workDate', date)).collect();
  return rows.filter(row => row.active);
}
function breakdownForDay(date, punches, continuedAt, employee) {
  const schedulePunch = groupPunches(punches).find(group => group.inPunch)?.inPunch;
  return workBreakdownIntervals(date, groupPunches(punches).map(group => ({
    inUtc: group.inPunch?.timeUtc, outUtc: group.outPunch?.timeUtc
  })), continuedAt, schedulePunch ? (schedulePunch.scheduleStart || '08:00') : (employee?.scheduleStart || '08:00'),
    schedulePunch ? (schedulePunch.scheduleEnd || '17:00') : (employee?.scheduleEnd || '17:00'));
}
async function extensionFor(ctx, userId, date) {
  return ctx.db.query('extensions').withIndex('by_user_date', q => q.eq('userId', userId).eq('workDate', date)).unique();
}
function extensionView(row, name) {
  return { id: row._id, userId: row.userId, employeeName: name, workDate: row.workDate,
    continuedAt: row.continuedAt, source: row.source, latitude: row.latitude ?? null,
    longitude: row.longitude ?? null, accuracyM: row.accuracyM ?? null, note: row.note,
    adjustmentDecision: row.adjustmentDecision ?? 'PENDING',
    overtimeDecision: row.overtimeDecision, nightDecision: row.nightDecision,
    adjustmentReason: row.adjustmentReason ?? null,
    overtimeReason: row.overtimeReason ?? null, nightReason: row.nightReason ?? null };
}
async function extensionRows(ctx, from, to, userId) {
  const rows = userId
    ? await ctx.db.query('extensions').withIndex('by_user_date', q => q.eq('userId', userId).gte('workDate', from).lte('workDate', to)).collect()
    : await ctx.db.query('extensions').withIndex('by_date', q => q.gte('workDate', from).lte('workDate', to)).collect();
  const names = new Map();
  for (const row of rows) if (!names.has(row.userId)) names.set(row.userId, (await ctx.db.get(row.userId))?.name || 'Unknown');
  return rows.map(row => extensionView(row, names.get(row.userId)));
}
async function punchRows(ctx, from, to, userId) {
  const rows = userId
    ? await ctx.db.query('punches').withIndex('by_user_date', q => q.eq('userId', userId).gte('workDate', from).lte('workDate', to)).collect()
    : await ctx.db.query('punches').withIndex('by_date', q => q.gte('workDate', from).lte('workDate', to)).collect();
  const active = rows.filter(p => p.active);
  const names = new Map();
  for (const row of active) if (!names.has(row.userId)) names.set(row.userId, (await ctx.db.get(row.userId))?.name || 'Unknown');
  return active.map(row => punchView(row, names.get(row.userId)))
    .sort((a, b) => b.workDate.localeCompare(a.workDate) || a.employeeName.localeCompare(b.employeeName) || a.slot.localeCompare(b.slot));
}
function overtimeView(row) {
  return { user_id: row.userId, work_date: row.workDate, minutes: row.minutes,
    note: row.note, set_by: row.setBy, updated_at: row.updatedAt };
}

export const session = query({ args: tokenArg, handler: async (ctx, { token }) => {
  const user = await authUser(ctx, token);
  const config = settingsView(await settings(ctx));
  const today = dayNow();
  return { user: { ...userView(user), profileImageUrl: user.profileImageId ? await ctx.storage.getUrl(user.profileImageId) : null },
    today, timezone, cutoff: cutoffFor(today, config.cutoffDays), settings: config };
}});

export const signupStatus = query({ args: {}, handler: async ctx => ({
  available: !(await ctx.db.query('users').withIndex('by_role', q => q.eq('role', 'admin')).first())
}) });

export const branding = query({ args: {}, handler: async (ctx) => {
  const config = await settings(ctx);
  return { appName: config.appName || 'Onsite DTR',
    logo192Url: config.logo192Id ? await ctx.storage.getUrl(config.logo192Id) : null,
    logo512Url: config.logo512Id ? await ctx.storage.getUrl(config.logo512Id) : null };
}});

export const attendance = query({ args: { ...tokenArg, from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { token, from, to }) => {
    const user = await authUser(ctx, token, 'employee');
    const range = dateRange(from, to, await settings(ctx));
    const overtime = await ctx.db.query('overtime').withIndex('by_user_date', q => q.eq('userId', user._id).gte('workDate', range.from).lte('workDate', range.to)).collect();
    const yesterday = new Date(Date.parse(`${dayNow()}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const priorIn = await punchFor(ctx, user._id, yesterday, 'IN');
    const priorExtension = await extensionFor(ctx, user._id, yesterday);
    const openShift = localDateTime(now(), timezone).minutes < 360 && priorIn &&
      !await punchFor(ctx, user._id, yesterday, 'OUT')
      ? { workDate: yesterday, inPunch: punchView(priorIn, user.name),
          extension: priorExtension ? extensionView(priorExtension, user.name) : null } : null;
    return { punches: await punchRows(ctx, range.from, range.to, user._id),
      extensions: await extensionRows(ctx, range.from, range.to, user._id),
      overtime: overtime.map(overtimeView), openShift };
  }
});

export const adminAttendance = query({ args: { ...tokenArg, from: v.optional(v.string()), to: v.optional(v.string()), employeeId: v.optional(v.string()) },
  handler: async (ctx, { token, from, to, employeeId }) => {
    await authUser(ctx, token, 'admin');
    const range = dateRange(from, to, await settings(ctx));
    const overtime = await ctx.db.query('overtime').withIndex('by_date', q => q.gte('workDate', range.from).lte('workDate', range.to)).collect();
    return { punches: await punchRows(ctx, range.from, range.to, employeeId || undefined),
      extensions: await extensionRows(ctx, range.from, range.to, employeeId || undefined),
      overtime: overtime.map(overtimeView), range };
  }
});

export const syncAutomaticPremiums = mutation({ args: { ...tokenArg, from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { token, from, to }) => {
    const admin = await authUser(ctx, token, 'admin');
    const range = dateRange(from, to, await settings(ctx));
    const rows = await ctx.db.query('punches').withIndex('by_date', q =>
      q.gte('workDate', range.from).lte('workDate', range.to)).collect();
    const days = new Map();
    for (const punch of rows.filter(row => row.active)) {
      const key = `${punch.userId}|${punch.workDate}`;
      if (!days.has(key)) days.set(key, { userId: punch.userId, workDate: punch.workDate, punches: [] });
      days.get(key).punches.push(punch);
    }
    let created = 0;
    for (const day of days.values()) {
      const segments = groupPunches(day.punches);
      if (!segments.length || segments.some(segment => !segment.inPunch || !segment.outPunch) ||
          await extensionFor(ctx, day.userId, day.workDate)) continue;
      const employee = await ctx.db.get(day.userId);
      const breakdown = breakdownForDay(day.workDate, day.punches, null, employee);
      if (!breakdown.overtimeCandidateMinutes) continue;
      const source = day.punches.every(punch => ['ADMIN', 'SYSTEM'].includes(punch.method)) ? 'ADMIN' : 'AUTO';
      const id = await ctx.db.insert('extensions', { userId: day.userId, workDate: day.workDate,
        continuedAt: shiftInstant(day.workDate, '17:00'), source,
        note: 'Overtime automatically synchronized from existing attendance',
        adjustmentDecision: 'PENDING', overtimeDecision: 'PENDING', nightDecision: 'PENDING' });
      await audit(ctx, admin._id, 'overtime_auto_synced', 'extension', id,
        { workDate: day.workDate, minutes: breakdown.overtimeCandidateMinutes });
      created++;
    }
    return { created };
  }
});

export const employees = query({ args: tokenArg, handler: async (ctx, { token }) => {
  await authUser(ctx, token, 'admin');
  const users = await ctx.db.query('users').withIndex('by_role', q => q.eq('role', 'employee')).collect();
  return { employees: users.sort((a, b) => a.name.localeCompare(b.name)).map(userView) };
}});

export const adminSettings = query({ args: tokenArg, handler: async (ctx, { token }) => {
  await authUser(ctx, token, 'admin');
  return { settings: settingsView(await settings(ctx)) };
}});

export const auditItems = query({ args: tokenArg, handler: async (ctx, { token }) => {
  await authUser(ctx, token, 'admin');
  const items = await ctx.db.query('audit').withIndex('by_created').order('desc').take(100);
  const names = new Map();
  for (const item of items) if (item.actorId && !names.has(item.actorId)) names.set(item.actorId, (await ctx.db.get(item.actorId))?.name || 'Unknown');
  return { items: items.map(item => ({ id: item._id, actor_name: names.get(item.actorId) || 'System', action: item.action,
    target_type: item.targetType, target_id: item.targetId, details: item.details, created_at: item.createdAt })) };
}});

export const updateSettings = mutation({ args: { ...tokenArg, input: v.any() }, handler: async (ctx, { token, input }) => {
  const admin = await authUser(ctx, token, 'admin');
  const hasSitePin = input.siteLat != null || input.siteLng != null;
  const lat = Number(input.siteLat), lng = Number(input.siteLng), radius = Number(input.radiusM), accuracy = Number(input.maxAccuracyM);
  const days = input.cutoffDays;
  if (typeof input.siteName !== 'string' || !input.siteName.trim() || input.siteName.length > 120) throw new Error('Site name is required.');
  if (hasSitePin && (input.siteLat == null || input.siteLng == null || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180)) throw new Error('Valid site GPS coordinates are required.');
  if (!Number.isInteger(radius) || radius < 25 || radius > 2000) throw new Error('Site radius must be 25–2000 m.');
  if (!Number.isInteger(accuracy) || accuracy < 10 || accuracy > 500) throw new Error('Maximum accuracy must be 10–500 m.');
  if (!Array.isArray(days) || days.length !== 2 || days.some(n => !Number.isInteger(n) || n < 1 || n > 28) || days[0] === days[1]) throw new Error('Use two different cutoff start days (1–28).');
  const old = await settings(ctx);
  const siteChanged = hasSitePin && (old.siteLat !== lat || old.siteLng !== lng || old.radiusM !== radius || old.maxAccuracyM !== accuracy || old.siteName !== input.siteName.trim());
  const changes = { siteName: input.siteName.trim(), ...(hasSitePin ? { siteLat: lat, siteLng: lng } : {}), radiusM: radius,
    maxAccuracyM: accuracy, cutoffDays: [...days].sort((a,b) => a-b), siteVersion: siteChanged ? old.siteVersion + 1 : old.siteVersion, updatedAt: now() };
  const next = { ...old, ...changes };
  if (old._id) await ctx.db.patch(old._id, changes); else await ctx.db.insert('settings', next);
  await audit(ctx, admin._id, 'settings_update', 'settings', 'main', { before: settingsView(old), after: settingsView(next) });
  return { settings: settingsView(next) };
}});

export const updateHolidays = mutation({ args: { ...tokenArg, holidays: v.array(v.object({ date: v.string(), name: v.string() })) }, handler: async (ctx, { token, holidays }) => {
  const admin = await authUser(ctx, token, 'admin');
  if (holidays.length > 366) throw new Error('A maximum of 366 holiday dates can be saved.');
  const dates = new Set();
  const cleaned = holidays.map(holiday => {
    const name = holiday.name.trim();
    if (!safeDate(holiday.date) || name.length < 2 || name.length > 80 || dates.has(holiday.date))
      throw new Error('Each holiday needs a unique valid date and a name of 2–80 characters.');
    dates.add(holiday.date);
    return { date: holiday.date, name };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const old = await settings(ctx), next = { ...old, holidays: cleaned, updatedAt: now() };
  if (old._id) await ctx.db.patch(old._id, { holidays: cleaned, updatedAt: next.updatedAt });
  else await ctx.db.insert('settings', next);
  await audit(ctx, admin._id, 'holidays_update', 'settings', 'main', { before: old.holidays || [], after: cleaned });
  return { holidays: cleaned };
}});

export const updateBranding = internalMutation({ args: { ...tokenArg, appName: v.string(), logo192Id: v.optional(v.id('_storage')),
  logo512Id: v.optional(v.id('_storage')), removeLogo: v.boolean() }, handler: async (ctx, args) => {
  const admin = await authUser(ctx, args.token, 'admin');
  const appName = args.appName.trim();
  if (appName.length < 2 || appName.length > 60) throw new Error('App name must have 2–60 characters.');
  if (!!args.logo192Id !== !!args.logo512Id) throw new Error('Both logo sizes are required.');
  if (args.removeLogo && args.logo192Id) throw new Error('Choose a new logo or remove the current logo.');
  for (const id of [args.logo192Id, args.logo512Id].filter(Boolean)) {
    const file = await ctx.db.system.get(id);
    if (!file || file.contentType !== 'image/png' || file.size < 100 || file.size > 2_000_000)
      throw new Error('Logo must be a PNG image under 2 MB.');
  }
  const old = await settings(ctx);
  const changes = { appName, updatedAt: now(),
    ...(args.removeLogo || args.logo192Id ? { logo192Id: args.logo192Id, logo512Id: args.logo512Id } : {}) };
  const next = { ...old, ...changes };
  if (old._id) await ctx.db.patch(old._id, changes); else await ctx.db.insert('settings', next);
  await audit(ctx, admin._id, 'branding_update', 'settings', 'main', { beforeName: old.appName || 'Onsite DTR', afterName: appName,
    logoChanged: !!args.logo192Id || args.removeLogo });
  return { oldLogo192Id: old.logo192Id || null, oldLogo512Id: old.logo512Id || null };
}});

export const continueOffsite = mutation({ args: { ...tokenArg, latitude: v.number(), longitude: v.number(), accuracyM: v.number() },
  handler: async (ctx, input) => {
    const user = await authUser(ctx, input.token, 'employee');
    const time = now(), local = localDateTime(time, timezone), workDate = local.date;
    if (local.minutes < 17 * 60 || local.minutes >= 22 * 60)
      throw new Error('Continue overtime is available from 5:00 PM until 10:00 PM.');
    if (holidayFor(workDate, settingsView(await settings(ctx)).holidays))
      throw new Error('This is a no-work holiday. Ask admin to record exceptional work.');
    if (!await punchFor(ctx, user._id, workDate, 'IN') || await punchFor(ctx, user._id, workDate, 'OUT'))
      throw new Error('An open Time In today is required to continue overtime.');
    if (await extensionFor(ctx, user._id, workDate)) throw new Error('Overtime continuation is already recorded.');
    const config = await settings(ctx);
    if (!Number.isFinite(input.latitude) || Math.abs(input.latitude) > 90 ||
      !Number.isFinite(input.longitude) || Math.abs(input.longitude) > 180 ||
      !Number.isFinite(input.accuracyM) || input.accuracyM < 0 || input.accuracyM > config.maxAccuracyM)
      throw new Error(`Current device location with ${config.maxAccuracyM} m accuracy or better is required.`);
    if (config.siteLat !== undefined && config.siteLng !== undefined &&
      distanceMeters(input.latitude, input.longitude, config.siteLat, config.siteLng) <= config.radiusM)
      throw new Error('Offsite overtime is for field work outside the site radius.');
    const id = await ctx.db.insert('extensions', { userId: user._id, workDate, continuedAt: time,
      source: 'OFFSITE', latitude: input.latitude, longitude: input.longitude, accuracyM: input.accuracyM,
      note: 'Employee continued offsite work', adjustmentDecision: 'PENDING', overtimeDecision: 'PENDING', nightDecision: 'PENDING' });
    await ctx.scheduler.runAt(Date.parse(shiftInstant(workDate, '06:00', true)), internal.core.autoTimeOut,
      { userId: user._id, workDate });
    await audit(ctx, user._id, 'overtime_continue', 'extension', id, { location: [input.latitude, input.longitude] });
    return { extension: extensionView(await ctx.db.get(id), user.name) };
  }
});

export const autoTimeOut = internalMutation({ args: { userId: v.id('users'), workDate: v.string() },
  handler: async (ctx, { userId, workDate }) => {
    if (!await extensionFor(ctx, userId, workDate) ||
        !await punchFor(ctx, userId, workDate, 'IN') || await punchFor(ctx, userId, workDate, 'OUT')) return { ok: true };
    const inPunch = await punchFor(ctx, userId, workDate, 'IN');
    const employee = await ctx.db.get(userId);
    const id = await ctx.db.insert('punches', { userId, workDate, slot: 'OUT', method: 'SYSTEM',
      scheduleStart: inPunch?.scheduleStart || employee?.scheduleStart || '08:00',
      scheduleEnd: inPunch?.scheduleEnd || employee?.scheduleEnd || '17:00',
      timeUtc: shiftInstant(workDate, '06:00', true), submittedAt: now(),
      note: 'Automatically closed at 6:00 AM; no exit selfie or GPS', verification: 'APPROVED', active: true });
    await audit(ctx, undefined, 'auto_time_out', 'punch', id, { workDate, cutoff: '06:00' });
    return { ok: true };
  }
});

export const submitPunch = internalMutation({ args: { ...tokenArg, input: v.any(), selfieId: v.id('_storage') }, handler: async (ctx, { token, input, selfieId }) => {
  const user = await authUser(ctx, token, 'employee');
  if (!['IN', 'OUT'].includes(input.slot)) throw new Error('Choose a valid punch.');
  const latitude = Number(input.latitude), longitude = Number(input.longitude), accuracy = Number(input.accuracyM);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0) throw new Error('Current device location is required.');
  const config = await settings(ctx);
  const local = localDateTime(now(), timezone);
  const priorDate = new Date(Date.parse(`${local.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const priorIn = local.minutes < 360 ? await punchFor(ctx, user._id, priorDate, 'IN') : null;
  const priorOpen = priorIn && !await punchFor(ctx, user._id, priorDate, 'OUT');
  if (input.slot === 'IN' && priorOpen)
    throw new Error('Finish the overnight shift before starting a new Time In.');
  const workDate = input.slot === 'OUT' && priorOpen ? priorDate : local.date;
  const holiday = holidayFor(workDate, settingsView(config).holidays);
  if (holiday) throw new Error(`No scheduled work today: ${holiday.name}. Ask admin to record exceptional work.`);
  if (accuracy > config.maxAccuracyM) throw new Error(`Location accuracy must be ${config.maxAccuracyM} m or better. Please retry outdoors.`);
  const distance = config.siteLat === undefined || config.siteLng === undefined
    ? undefined : distanceMeters(latitude, longitude, config.siteLat, config.siteLng);
  const meta = await ctx.db.system.get(selfieId);
  if (!meta || !['image/jpeg', 'image/png', 'image/webp'].includes(meta.contentType) || meta.size < 1000 || meta.size > 750_000)
    throw new Error('A compressed selfie photo of 1 KB–750 KB is required.');
  if (await punchFor(ctx, user._id, workDate, input.slot)) throw new Error('This punch is already recorded.');
  const inPunch = await punchFor(ctx, user._id, workDate, 'IN');
  if (input.slot === 'OUT' && !inPunch) throw new Error('Time In is required before Time Out. Ask admin for a correction.');
  const extension = input.slot === 'OUT' ? await extensionFor(ctx, user._id, workDate) : null;
  const method = distance !== undefined && distance <= config.radiusM ? 'ONSITE' : 'OFFSITE';
  const note = String(input.note || '').trim().slice(0, 300) || (method === 'OFFSITE' ? 'Offsite location automatically detected' : '');
  const time = now();
  if (input.slot === 'OUT' && time <= inPunch.timeUtc) throw new Error('Time Out must be after Time In.');
  const id = await ctx.db.insert('punches', { userId: user._id, workDate, slot: input.slot, method,
    scheduleStart: user.scheduleStart || '08:00', scheduleEnd: user.scheduleEnd || '17:00',
    timeUtc: time, submittedAt: time, latitude, longitude, accuracyM: accuracy,
    ...(distance === undefined ? {} : { distanceM: distance }), selfieId,
    note, verification: 'PENDING',
    siteVersion: config.siteVersion, active: true });
  await audit(ctx, user._id, 'punch', 'punch', id, { slot: input.slot, method, distanceM: distance });
  const completedPunches = input.slot === 'OUT' ? await activeDayPunches(ctx, user._id, workDate) : [];
  const autoBreakdown = input.slot === 'OUT' ? breakdownForDay(workDate, completedPunches, null, user) : null;
  const overtimeAutoApplied = !!(autoBreakdown?.overtimeBeforeAdjustmentMinutes || autoBreakdown?.nightCandidateMinutes);
  if (overtimeAutoApplied && !extension) {
    const extensionId = await ctx.db.insert('extensions', { userId: user._id, workDate,
      continuedAt: shiftInstant(workDate, '17:00'), source: 'AUTO', latitude, longitude,
      accuracyM: accuracy, note: 'Overtime automatically detected from Time Out',
      adjustmentDecision: 'PENDING', overtimeDecision: 'PENDING', nightDecision: 'PENDING' });
    await audit(ctx, user._id, 'overtime_auto_applied', 'extension', extensionId,
      { timeOut: time, method, distanceM: distance });
  }
  return { punch: punchView(await ctx.db.get(id), user.name), overtimeAutoApplied };
}});

export const backfill = mutation({ args: { ...tokenArg, input: v.any() }, handler: async (ctx, { token, input }) => {
  const admin = await authUser(ctx, token, 'admin');
  const targetId = ctx.db.normalizeId('users', String(input.employeeId || ''));
  const target = targetId && await ctx.db.get(targetId);
  if (!target || target.role !== 'employee') throw new Error('Employee not found.');
  if (!safeDate(input.workDate)) throw new Error('Valid work date is required.');
  const reason = String(input.reason || '').trim();
  if (reason.length < 5 || reason.length > 300) throw new Error('Reason must have 5–300 characters.');
  const entries = [];
  if (input.timeIn) entries.push({ slot: 'IN', time: localTimeToUtc(input.workDate, input.timeIn) });
  if (input.timeOut) {
    if (input.timeOutNextDay && input.timeOut > '06:00')
      throw new Error('Next-day Time Out must be no later than 6:00 AM.');
    entries.push({ slot: 'OUT', time: shiftInstant(input.workDate, input.timeOut, !!input.timeOutNextDay) });
  }
  const ot = input.overtimeMinutes === '' || input.overtimeMinutes == null ? null : Number(input.overtimeMinutes);
  if (ot !== null && (!Number.isInteger(ot) || ot < 0 || ot > 1440)) throw new Error('Overtime must be 0–1440 minutes.');
  if (!entries.length && ot === null) throw new Error('Enter a Time In, Time Out, or overtime.');
  const oldIn = await punchFor(ctx, target._id, input.workDate, 'IN');
  const oldOut = await punchFor(ctx, target._id, input.workDate, 'OUT');
  const finalIn = entries.find(e => e.slot === 'IN')?.time || oldIn?.timeUtc;
  const finalOut = entries.find(e => e.slot === 'OUT')?.time || oldOut?.timeUtc;
  if (finalOut && !finalIn) throw new Error('Time In is required before Time Out.');
  if (finalIn && finalOut && finalOut <= finalIn) throw new Error('Time Out must be after Time In.');
  if (finalOut && finalOut > shiftInstant(input.workDate, '06:00', true))
    throw new Error('Time Out cannot exceed the 6:00 AM next-day cutoff.');
  let replaced = 0;
  for (const entry of entries) {
    const old = entry.slot === 'IN' ? oldIn : oldOut;
    if (old && !input.replaceExisting) throw new Error(`${entry.slot === 'IN' ? 'Time In' : 'Time Out'} already exists for this workday. Select overwrite to replace it with an audited correction.`);
    if (old) {
      await ctx.db.patch(old._id, { active: false });
      await audit(ctx, admin._id, 'punch_replaced', 'punch', old._id, { reason, replacementTime: entry.time });
      replaced++;
    }
    const id = await ctx.db.insert('punches', { userId: target._id, workDate: input.workDate, slot: entry.slot,
      scheduleStart: old ? (old.scheduleStart || '08:00') : (target.scheduleStart || '08:00'),
      scheduleEnd: old ? (old.scheduleEnd || '17:00') : (target.scheduleEnd || '17:00'),
      method: 'ADMIN', timeUtc: entry.time, submittedAt: now(), note: reason, verification: 'APPROVED',
      ...(input.offsite === undefined ? {} : { assignmentType: input.offsite ? 'OFFSITE' : 'ONSITE' }),
      createdBy: admin._id, active: true });
    await audit(ctx, admin._id, 'admin_punch_create', 'punch', id, { reason, slot: entry.slot });
  }
  if (ot !== null) {
    const old = await ctx.db.query('overtime').withIndex('by_user_date', q => q.eq('userId', target._id).eq('workDate', input.workDate)).unique();
    const value = { userId: target._id, workDate: input.workDate, minutes: ot, note: reason, setBy: admin._id, updatedAt: now() };
    if (old) await ctx.db.replace(old._id, value); else await ctx.db.insert('overtime', value);
    await audit(ctx, admin._id, 'overtime_set', 'overtime', `${target._id}:${input.workDate}`, { minutes: ot, reason });
  }
  const extension = await extensionFor(ctx, target._id, input.workDate);
  if (finalIn && finalOut && finalOut > shiftInstant(input.workDate, '17:00') && !extension) {
    const id = await ctx.db.insert('extensions', { userId: target._id, workDate: input.workDate,
      continuedAt: shiftInstant(input.workDate, '17:00'), source: 'ADMIN', note: reason,
      adjustmentDecision: 'PENDING', overtimeDecision: 'PENDING', nightDecision: 'PENDING' });
    await audit(ctx, admin._id, 'admin_extension_create', 'extension', id, { reason });
  } else if (extension && entries.length) {
    await ctx.db.patch(extension._id, { adjustmentDecision: 'PENDING', overtimeDecision: 'PENDING', nightDecision: 'PENDING',
      adjustmentReason: undefined, overtimeReason: undefined, nightReason: undefined,
      adjustmentReviewedAt: undefined, adjustmentReviewedBy: undefined, overtimeReviewedAt: undefined,
      nightReviewedAt: undefined, overtimeReviewedBy: undefined, nightReviewedBy: undefined });
    await audit(ctx, admin._id, 'extension_reset_after_correction', 'extension', extension._id, { reason });
  }
  return { ok: true, replaced };
}});

export const saveAdminAttendanceDay = mutation({ args: { ...tokenArg, input: v.any() }, handler: async (ctx, { token, input }) => {
  const admin = await authUser(ctx, token, 'admin');
  const targetId = ctx.db.normalizeId('users', String(input.employeeId || ''));
  const target = targetId && await ctx.db.get(targetId);
  if (!target || target.role !== 'employee') throw new Error('Employee not found.');
  if (!safeDate(input.workDate)) throw new Error('Valid work date is required.');
  const reason = String(input.reason || '').trim();
  if (reason.length < 5 || reason.length > 300) throw new Error('Reason must have 5–300 characters.');
  if (!Array.isArray(input.segments) || !input.segments.length || input.segments.length > 6)
    throw new Error('Enter one to six work intervals.');
  const existing = await activeDayPunches(ctx, target._id, input.workDate);
  const expectedIds = Array.isArray(input.expectedIds) ? input.expectedIds.map(String).sort() : [];
  if (expectedIds.length !== existing.length ||
      expectedIds.some((id, index) => id !== existing.map(row => String(row._id)).sort()[index]))
    throw new Error('Attendance changed after this form opened. Reload this workday before saving.');
  const oldByKey = new Map(existing.map(row => [`${row.segment || 1}|${row.slot}`, row]));
  if (oldByKey.size !== existing.length) throw new Error('Duplicate punches need admin review before editing.');
  const entries = [];
  let previousOut = null;
  for (const [index, segment] of input.segments.entries()) {
    const number = index + 1;
    const timeIn = String(segment.timeIn || '');
    const timeOut = String(segment.timeOut || '');
    if (!timeIn || (number > 1 && !timeOut)) throw new Error(`Interval ${number} needs both Time In and Time Out.`);
    if (timeOut && !timeIn) throw new Error(`Interval ${number} needs Time In before Time Out.`);
    if (number === 1 && segment.timeInNextDay) throw new Error('The first Time In must be on the work date.');
    if (segment.timeInNextDay && timeIn > '06:00') throw new Error('Next-day Time In must be no later than 6:00 AM.');
    if (segment.timeOutNextDay && timeOut > '06:00') throw new Error('Next-day Time Out must be no later than 6:00 AM.');
    const inUtc = shiftInstant(input.workDate, timeIn, !!segment.timeInNextDay);
    const outUtc = timeOut ? shiftInstant(input.workDate, timeOut, !!segment.timeOutNextDay) : null;
    if (outUtc && outUtc <= inUtc) throw new Error(`Interval ${number}: Time Out must be after Time In.`);
    if (previousOut && inUtc <= previousOut) throw new Error(`Interval ${number} must start after the previous Time Out.`);
    if (number > 1 && !previousOut) throw new Error('Finish the previous interval before adding another.');
    if (outUtc && outUtc > shiftInstant(input.workDate, '06:00', true))
      throw new Error('Time Out cannot exceed the 6:00 AM next-day cutoff.');
    const offsite = !!segment.offsite;
    entries.push({ number, slot: 'IN', timeUtc: inUtc, id: segment.inId || null, offsite });
    if (outUtc) entries.push({ number, slot: 'OUT', timeUtc: outUtc, id: segment.outId || null, offsite });
    previousOut = outUtc;
  }
  const submittedOldIds = entries.map(entry => entry.id).filter(Boolean).map(String).sort();
  if (submittedOldIds.length !== existing.length || submittedOldIds.some((id, index) => id !== expectedIds[index]))
    throw new Error('Existing punches cannot be removed here. Reload and edit their times instead.');
  let created = 0, replaced = 0, preserved = 0;
  for (const entry of entries) {
    const old = oldByKey.get(`${entry.number}|${entry.slot}`);
    if ((old ? String(old._id) : null) !== entry.id)
      throw new Error('Attendance changed after this form opened. Reload this workday before saving.');
    const oldLocal = old ? localDateTime(old.timeUtc, timezone) : null;
    const newLocal = localDateTime(entry.timeUtc, timezone);
    if (old && oldLocal.date === newLocal.date && oldLocal.time === newLocal.time) { preserved++; continue; }
    if (old) {
      await ctx.db.patch(old._id, { active: false });
      await audit(ctx, admin._id, 'punch_replaced', 'punch', old._id,
        { reason, segment: entry.number, slot: entry.slot, replacementTime: entry.timeUtc });
      replaced++;
    }
    const id = await ctx.db.insert('punches', { userId: target._id, workDate: input.workDate,
      segment: entry.number, slot: entry.slot, method: 'ADMIN', timeUtc: entry.timeUtc,
      scheduleStart: old ? (old.scheduleStart || '08:00') : (target.scheduleStart || '08:00'),
      scheduleEnd: old ? (old.scheduleEnd || '17:00') : (target.scheduleEnd || '17:00'),
      submittedAt: now(), note: reason, verification: 'APPROVED',
      assignmentType: entry.offsite ? 'OFFSITE' : 'ONSITE', createdBy: admin._id, active: true });
    await audit(ctx, admin._id, 'admin_punch_create', 'punch', id,
      { reason, segment: entry.number, slot: entry.slot, replacedId: old?._id || null });
    created++;
  }
  const active = await activeDayPunches(ctx, target._id, input.workDate);
  const extension = await extensionFor(ctx, target._id, input.workDate);
  const extra = breakdownForDay(input.workDate, active, extension?.continuedAt, target);
  const hasPremium = extra.overtimeBeforeAdjustmentMinutes > 0 || extra.nightCandidateMinutes > 0;
  if (hasPremium && !extension && (created || replaced)) {
    const id = await ctx.db.insert('extensions', { userId: target._id, workDate: input.workDate,
      continuedAt: shiftInstant(input.workDate, '17:00'), source: 'ADMIN', note: reason,
      adjustmentDecision: 'PENDING', overtimeDecision: 'PENDING', nightDecision: 'PENDING' });
    await audit(ctx, admin._id, 'admin_extension_create', 'extension', id, { reason });
  } else if (extension && (created || replaced)) {
    await ctx.db.patch(extension._id, { adjustmentDecision: 'PENDING', overtimeDecision: 'PENDING', nightDecision: 'PENDING',
      adjustmentReason: undefined, overtimeReason: undefined, nightReason: undefined,
      adjustmentReviewedAt: undefined, adjustmentReviewedBy: undefined, overtimeReviewedAt: undefined,
      nightReviewedAt: undefined, overtimeReviewedBy: undefined, nightReviewedBy: undefined });
    await audit(ctx, admin._id, 'extension_reset_after_correction', 'extension', extension._id, { reason });
  }
  return { ok: true, created, replaced, preserved };
}});

export const verify = mutation({ args: { ...tokenArg, id: v.string(), verification: v.string(), reason: v.optional(v.string()) }, handler: async (ctx, args) => {
  const admin = await authUser(ctx, args.token, 'admin');
  if (!['APPROVED', 'REJECTED'].includes(args.verification)) throw new Error('Choose Approve or Reject.');
  const reason = String(args.reason || '').trim();
  if (args.verification === 'REJECTED' && reason.length < 5) throw new Error('A rejection reason is required.');
  const id = ctx.db.normalizeId('punches', args.id);
  const punch = id && await ctx.db.get(id);
  if (!punch?.active) throw new Error('Punch not found.');
  if (!['ONSITE', 'OFFSITE'].includes(punch.method)) throw new Error('Only employee-submitted punches need verification.');
  await ctx.db.patch(id, { verification: args.verification, rejectionReason: args.verification === 'REJECTED' ? reason : undefined,
    reviewedBy: admin._id, reviewedAt: now() });
  if (args.verification === 'REJECTED') {
    const extension = await extensionFor(ctx, punch.userId, punch.workDate);
    if (extension) await ctx.db.patch(extension._id, { adjustmentDecision: 'REJECTED',
      overtimeDecision: 'REJECTED', nightDecision: 'REJECTED',
      adjustmentReason: 'Attendance proof rejected', overtimeReason: 'Attendance proof rejected',
      nightReason: 'Attendance proof rejected', adjustmentReviewedBy: admin._id,
      overtimeReviewedBy: admin._id, nightReviewedBy: admin._id,
      adjustmentReviewedAt: now(), overtimeReviewedAt: now(), nightReviewedAt: now() });
  }
  await audit(ctx, admin._id, 'punch_verify', 'punch', id, { verification: args.verification, reason });
  return { ok: true };
}});

export const approveAttendanceDay = mutation({
  args: { ...tokenArg, userId: v.string(), workDate: v.string() },
  handler: async (ctx, args) => {
    const admin = await authUser(ctx, args.token, 'admin');
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId || !safeDate(args.workDate)) throw new Error('Invalid employee or work date.');
    const employee = await ctx.db.get(userId);
    if (!employee || employee.role !== 'employee') throw new Error('Employee not found.');
    const punches = await activeDayPunches(ctx, userId, args.workDate);
    const segments = groupPunches(punches);
    if (!segments.length || segments.some(segment => !segment.inPunch || !segment.outPunch))
      throw new Error('Both Time In and Time Out are required for every interval before approval.');
    const reviewedAt = now();
    for (const punch of punches) {
      if (['ONSITE', 'OFFSITE'].includes(punch.method)) {
        await ctx.db.patch(punch._id, { verification: 'APPROVED', rejectionReason: undefined,
          reviewedBy: admin._id, reviewedAt });
      }
    }
    const existingExtension = await extensionFor(ctx, userId, args.workDate);
    const breakdown = breakdownForDay(args.workDate, punches, existingExtension?.continuedAt, employee);
    if (breakdown.overtimeCandidateMinutes > 0 && !existingExtension) {
      const source = punches.every(punch => ['ADMIN', 'SYSTEM'].includes(punch.method)) ? 'ADMIN' : 'AUTO';
      const extensionId = await ctx.db.insert('extensions', { userId, workDate: args.workDate,
        continuedAt: shiftInstant(args.workDate, '17:00'), source,
        note: 'Overtime automatically detected from approved attendance',
        adjustmentDecision: 'PENDING', overtimeDecision: 'PENDING', nightDecision: 'PENDING' });
      await audit(ctx, admin._id, 'overtime_auto_applied', 'extension', extensionId,
        { workDate: args.workDate, minutes: breakdown.overtimeCandidateMinutes });
    }
    await audit(ctx, admin._id, 'attendance_day_approve', 'attendance_day', `${userId}|${args.workDate}`,
      { userId, workDate: args.workDate, punchIds: punches.map(punch => punch._id) });
    return { ok: true, workDate: args.workDate };
  }
});

export const reviewExtension = mutation({ args: { ...tokenArg, id: v.string(), stage: v.string(), decision: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await authUser(ctx, args.token, 'admin');
    if (!['ADJUSTMENT', 'OVERTIME', 'NIGHT'].includes(args.stage) || !['APPROVED', 'REJECTED'].includes(args.decision))
      throw new Error('Choose a valid approval decision.');
    const reason = String(args.reason || '').trim();
    if (reason.length > 300) throw new Error('Reason must be at most 300 characters.');
    const id = ctx.db.normalizeId('extensions', args.id), extension = id && await ctx.db.get(id);
    if (!extension) throw new Error('Offsite extension not found.');
    const punches = await activeDayPunches(ctx, extension.userId, extension.workDate);
    const segments = groupPunches(punches);
    if (!segments.length || segments.some(segment => !segment.inPunch || !segment.outPunch))
      throw new Error('Wait for Time Out in every interval before reviewing extra hours.');
    const employee = await ctx.db.get(extension.userId);
    const breakdown = breakdownForDay(extension.workDate, punches, extension.continuedAt, employee);
    if (args.stage === 'ADJUSTMENT' && !breakdown.proposedTransferMinutes)
      throw new Error('No OT-to-regular adjustment is needed.');
    if (args.stage === 'OVERTIME' && !breakdown.remainingOvertimeMinutes)
      throw new Error('No remaining overtime is available after adjustment.');
    if (args.stage === 'NIGHT' && !breakdown.nightCandidateMinutes)
      throw new Error('No Differential hours were recorded.');
    if (args.stage === 'NIGHT' && breakdown.remainingOvertimeMinutes > 0 && extension.overtimeDecision !== 'APPROVED')
      throw new Error('Approve overtime before reviewing Differential.');
    if (args.decision === 'APPROVED' && punches.some(punch => punch.verification !== 'APPROVED'))
      throw new Error('Approve the employee Time In and Time Out proofs first.');
    const changes = args.stage === 'ADJUSTMENT'
      ? { adjustmentDecision: args.decision, adjustmentReason: reason || undefined,
          adjustmentReviewedBy: admin._id, adjustmentReviewedAt: now() }
      : args.stage === 'OVERTIME'
      ? { overtimeDecision: args.decision, overtimeReason: reason || undefined,
          overtimeReviewedBy: admin._id, overtimeReviewedAt: now(),
          ...(args.decision === 'REJECTED' ? { nightDecision: 'REJECTED', nightReason: 'Overtime denied',
            nightReviewedBy: admin._id, nightReviewedAt: now() } : {}) }
      : { nightDecision: args.decision, nightReason: reason || undefined,
          nightReviewedBy: admin._id, nightReviewedAt: now() };
    await ctx.db.patch(id, changes);
    await audit(ctx, admin._id, 'extension_review', 'extension', id,
      { stage: args.stage, decision: args.decision, reason, minutes: args.stage === 'ADJUSTMENT'
        ? breakdown.proposedTransferMinutes : args.stage === 'OVERTIME'
          ? breakdown.remainingOvertimeMinutes : breakdown.nightCandidateMinutes });
    return { ok: true };
  }
});

// Internal functions are callable only by the password and file actions.
export const userForLogin = internalQuery({ args: { identifier: v.string() }, handler: (ctx, { identifier }) =>
  /^\d{11}$/.test(identifier) ? userByMobile(ctx, identifier) : userByEmail(ctx, identifier) });
export const userForToken = internalQuery({ args: { token: v.string(), role: v.optional(v.string()) }, handler: (ctx, { token, role }) => authUser(ctx, token, role) });
export const loginAttempt = internalQuery({ args: { email: v.string() }, handler: (ctx, { email }) => ctx.db.query('loginAttempts').withIndex('by_email', q => q.eq('email', email)).unique() });
export const recordLoginFailure = internalMutation({ args: { email: v.string() }, handler: async (ctx, { email }) => {
  const old = await ctx.db.query('loginAttempts').withIndex('by_email', q => q.eq('email', email)).unique();
  const next = { email, count: old && old.until > Date.now() ? old.count + 1 : 1, until: Date.now() + 15 * 60000 };
  if (old) await ctx.db.replace(old._id, next); else await ctx.db.insert('loginAttempts', next);
}});
export const issueSession = internalMutation({ args: { userId: v.id('users'), tokenHash: v.string(), remember: v.boolean(), email: v.string() }, handler: async (ctx, args) => {
  const user = await ctx.db.get(args.userId);
  const attempt = await ctx.db.query('loginAttempts').withIndex('by_email', q => q.eq('email', args.email)).unique();
  if (!user?.active || attempt && attempt.until > Date.now() && attempt.count >= 5) throw new Error('Too many attempts. Try again later.');
  if (attempt) await ctx.db.delete(attempt._id);
  const expiresAt = Date.now() + (args.remember ? 30 * 86400 : 12 * 3600) * 1000;
  await ctx.db.insert('sessions', { tokenHash: args.tokenHash, userId: user._id, expiresAt, createdAt: now() });
  await audit(ctx, user._id, 'login', 'user', user._id);
  return { user: userView(user), expiresAt };
}});
export const logout = mutation({ args: tokenArg, handler: async (ctx, { token }) => {
  if (!/^[a-f0-9]{64}$/.test(token)) return { ok: true };
  const tokenHash = await digest(token);
  const session = await ctx.db.query('sessions').withIndex('by_hash', q => q.eq('tokenHash', tokenHash)).unique();
  if (session) await ctx.db.delete(session._id);
  return { ok: true };
}});
export const bootstrapAdmin = internalMutation({ args: { email: v.string(), name: v.string(), passwordHash: v.string() }, handler: async (ctx, args) => {
  if (!validEmail(args.email)) throw new Error('Valid admin email is required.');
  // Legacy CLI bootstrap is only for a genuinely unused deployment.
  if (await ctx.db.query('users').first() ||
      await ctx.db.query('settings').withIndex('by_key', q => q.eq('key', 'main')).unique())
    throw new Error('Deployment already initialized. Use first-admin sign-up when there is no admin.');
  if (await userByEmail(ctx, args.email)) throw new Error('Email is already in use.');
  const id = await ctx.db.insert('users', { name: args.name, email: args.email, passwordHash: args.passwordHash,
    role: 'admin', active: true, scheduleStart: '08:30', scheduleEnd: '17:30', workdays: [1,2,3,4,5,6], graceMinutes: 0, createdAt: now() });
  await ctx.db.insert('settings', settingsDefault());
  await audit(ctx, id, 'admin_bootstrap', 'user', id);
  return { email: args.email };
}});

export const registerFirstAdmin = internalMutation({ args: {
  name: v.string(), email: v.string(), passwordHash: v.string(),
  profileImageId: v.optional(v.id('_storage')), tokenHash: v.string(), remember: v.boolean()
}, handler: async (ctx, args) => {
  const name = args.name.trim(), email = args.email.trim().toLowerCase();
  if (name.length < 2 || name.length > 120 || !validEmail(email)) throw new Error('Enter a valid name and email.');
  if (await ctx.db.query('users').withIndex('by_role', q => q.eq('role', 'admin')).first())
    throw new Error('An admin account already exists. Please sign in.');
  if (await userByEmail(ctx, email)) throw new Error('Email is already in use.');
  if (!/^[a-f0-9]{64}$/.test(args.tokenHash)) throw new Error('Invalid session token.');
  const userId = await ctx.db.insert('users', { name, email, passwordHash: args.passwordHash,
    role: 'admin', active: true, scheduleStart: '08:30', scheduleEnd: '17:30',
    workdays: [1,2,3,4,5,6], graceMinutes: 0, createdAt: now(),
    ...(args.profileImageId ? { profileImageId: args.profileImageId } : {}) });
  if (!(await ctx.db.query('settings').withIndex('by_key', q => q.eq('key', 'main')).unique()))
    await ctx.db.insert('settings', settingsDefault());
  await ctx.db.insert('sessions', { tokenHash: args.tokenHash, userId,
    expiresAt: Date.now() + (args.remember ? 30 * 86400 : 12 * 3600) * 1000, createdAt: now() });
  await audit(ctx, userId, 'admin_signup', 'user', userId);
  return { user: userView(await ctx.db.get(userId)) };
}});

export const updateProfileImage = internalMutation({ args: {
  token: v.string(), profileImageId: v.optional(v.id('_storage')), remove: v.boolean()
}, handler: async (ctx, args) => {
  const user = await authUser(ctx, args.token, 'admin');
  if (args.remove && args.profileImageId) throw new Error('Choose a photo or remove the current one.');
  if (!args.remove && !args.profileImageId) throw new Error('Choose a profile photo.');
  if (args.profileImageId) {
    const file = await ctx.db.system.get(args.profileImageId);
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.contentType) || file.size < 1000 || file.size > 750_000)
      throw new Error('Profile photo must be a compressed image under 750 KB.');
  }
  const previousImageId = user.profileImageId;
  await ctx.db.patch(user._id, { profileImageId: args.remove ? undefined : args.profileImageId });
  if (previousImageId) await ctx.storage.delete(previousImageId);
  await audit(ctx, user._id, 'profile_photo_update', 'user', user._id);
  return { ok: true };
}});

export const deleteAdminAccount = internalMutation({ args: { token: v.string(), oldHash: v.string() }, handler: async (ctx, args) => {
  const user = await authUser(ctx, args.token, 'admin');
  if (user.passwordHash !== args.oldHash) throw new Error('Password changed; please try again.');
  const sessions = await ctx.db.query('sessions').withIndex('by_user', q => q.eq('userId', user._id)).collect();
  for (const session of sessions) await ctx.db.delete(session._id);
  const attempt = await ctx.db.query('loginAttempts').withIndex('by_email', q => q.eq('email', user.email)).unique();
  if (attempt) await ctx.db.delete(attempt._id);
  if (user.profileImageId) await ctx.storage.delete(user.profileImageId);
  await ctx.db.delete(user._id);
  await audit(ctx, undefined, 'admin_account_deleted', 'user', user._id);
  return { ok: true };
}});
export const changePassword = internalMutation({ args: { token: v.string(), oldHash: v.string(), newHash: v.string() }, handler: async (ctx, args) => {
  const user = await authUser(ctx, args.token);
  if (user.passwordHash !== args.oldHash) throw new Error('Password changed; please try again.');
  await ctx.db.patch(user._id, { passwordHash: args.newHash });
  await audit(ctx, user._id, 'password_change', 'user', user._id);
  return { ok: true };
}});
export const createEmployee = internalMutation({ args: { token: v.string(), input: v.any() }, handler: async (ctx, { token, input }) => {
  const admin = await authUser(ctx, token, 'admin');
  validateEmployee(input, true);
  const mobile = input.mobile.trim();
  if (await userByMobile(ctx, mobile)) throw new Error('Mobile number is already in use.');
  const id = await ctx.db.insert('users', { name: input.name.trim(), mobile, passwordHash: input.passwordHash,
    role: 'employee', active: true, scheduleStart: input.scheduleStart, scheduleEnd: input.scheduleEnd,
    workdays: input.workdays, graceMinutes: 0, createdAt: now() });
  await audit(ctx, admin._id, 'employee_create', 'user', id, { mobile });
  return { employee: userView(await ctx.db.get(id)) };
}});
export const updateEmployee = internalMutation({ args: { token: v.string(), id: v.string(), input: v.any() }, handler: async (ctx, { token, id, input }) => {
  const admin = await authUser(ctx, token, 'admin');
  const userId = ctx.db.normalizeId('users', id);
  const old = userId && await ctx.db.get(userId);
  if (!old || old.role !== 'employee') throw new Error('Employee not found.');
  validateEmployee(input, false);
  const mobile = input.mobile.trim();
  const other = await userByMobile(ctx, mobile);
  if (other && other._id !== userId) throw new Error('Mobile number is already in use.');
  await ctx.db.patch(userId, { name: input.name.trim(), mobile, email: undefined, scheduleStart: input.scheduleStart,
    scheduleEnd: input.scheduleEnd, workdays: input.workdays, graceMinutes: 0,
    active: !!input.active, isDemo: undefined, ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}) });
  const sessions = await ctx.db.query('sessions').withIndex('by_user', q => q.eq('userId', userId)).collect();
  for (const session of sessions) await ctx.db.delete(session._id);
  const updated = await ctx.db.get(userId);
  await audit(ctx, admin._id, 'employee_update', 'user', userId, { before: userView(old), after: userView(updated) });
  return { employee: userView(updated) };
}});
export const deleteEmployee = mutation({ args: { token: v.string(), id: v.string() }, handler: async (ctx, { token, id }) => {
  const admin = await authUser(ctx, token, 'admin');
  const userId = ctx.db.normalizeId('users', id);
  const employee = userId && await ctx.db.get(userId);
  if (!employee || employee.role !== 'employee') throw new Error('Employee not found.');
  const sessions = await ctx.db.query('sessions').withIndex('by_user', q => q.eq('userId', userId)).collect();
  const punches = await ctx.db.query('punches').withIndex('by_user_date', q => q.eq('userId', userId)).collect();
  const extensions = await ctx.db.query('extensions').withIndex('by_user_date', q => q.eq('userId', userId)).collect();
  const overtime = await ctx.db.query('overtime').withIndex('by_user_date', q => q.eq('userId', userId)).collect();
  for (const session of sessions) await ctx.db.delete(session._id);
  for (const punch of punches) {
    if (punch.selfieId) await ctx.storage.delete(punch.selfieId);
    await ctx.db.delete(punch._id);
  }
  for (const extension of extensions) await ctx.db.delete(extension._id);
  for (const entry of overtime) await ctx.db.delete(entry._id);
  const loginKey = employee.mobile || employee.email;
  const attempts = loginKey ? await ctx.db.query('loginAttempts').withIndex('by_email', q => q.eq('email', loginKey)).collect() : [];
  for (const attempt of attempts) await ctx.db.delete(attempt._id);
  if (employee.profileImageId) await ctx.storage.delete(employee.profileImageId);
  await ctx.db.delete(userId);
  await audit(ctx, admin._id, 'employee_delete', 'user', userId, {
    mobile: employee.mobile, punches: punches.length, extensions: extensions.length, overtime: overtime.length
  });
  return { ok: true };
}});
export const selfieFor = internalQuery({ args: { token: v.string(), id: v.string() }, handler: async (ctx, { token, id }) => {
  const user = await authUser(ctx, token);
  const punchId = ctx.db.normalizeId('punches', id);
  const punch = punchId && await ctx.db.get(punchId);
  if (!punch?.selfieId) throw new Error('Photo not found.');
  if (user.role !== 'admin' && punch.userId !== user._id) throw new Error('Not allowed.');
  return punch.selfieId;
}});
