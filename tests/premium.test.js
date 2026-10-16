import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { approveAttendanceDay, autoTimeOut, backfill, continueOffsite, reviewExtension,
  saveAdminAttendanceDay, verify } from '../convex/core.js';
import { shiftInstant } from '../rules.js';

function fixture() {
  const tables = Object.fromEntries(['users', 'sessions', 'settings', 'punches', 'extensions', 'overtime', 'audit']
    .map(name => [name, new Map()]));
  let next = 0;
  const db = {
    query(table) {
      const filters = [];
      const query = {
        withIndex(_index, build) {
          const cursor = {
            eq(key, value) { filters.push(row => row[key] === value); return cursor; },
            gte(key, value) { filters.push(row => row[key] >= value); return cursor; },
            lte(key, value) { filters.push(row => row[key] <= value); return cursor; }
          };
          build(cursor); return query;
        },
        async collect() { return [...tables[table].values()].filter(row => filters.every(filter => filter(row))); },
        async unique() { const rows = await query.collect(); assert.ok(rows.length <= 1); return rows[0] || null; }
      };
      return query;
    },
    normalizeId(table, value) { return value?.startsWith(`${table}:`) ? value : null; },
    async insert(table, value) { const id = `${table}:${++next}`; tables[table].set(id, { _id: id, ...value }); return id; },
    async get(id) { return Object.values(tables).map(table => table.get(id)).find(Boolean) || null; },
    async patch(id, changes) { const row = await db.get(id); assert.ok(row); Object.assign(row, changes); },
    async replace(id, value) { const table = id.split(':')[0]; tables[table].set(id, { _id: id, ...value }); }
  };
  const ctx = { db };
  const token = 'a'.repeat(64);
  const addUser = (name, role) => db.insert('users', { name, email: `${name}@example.test`, role, active: true });
  const authorize = async adminId => db.insert('sessions', { userId: adminId,
    tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: Date.now() + 86400000 });
  return { ctx, tables, token, addUser, authorize };
}

test('admin separately grants overtime and night hours, with denial cascading', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  const punch = (slot, time) => f.ctx.db.insert('punches', { userId, workDate: date, slot,
    method: 'OFFSITE', timeUtc: shiftInstant(date, time), verification: 'APPROVED', active: true });
  await punch('IN', '08:00');
  const outId = await punch('OUT', '22:20');
  const extensionId = await f.ctx.db.insert('extensions', { userId, workDate: date,
    continuedAt: shiftInstant(date, '17:00'), source: 'OFFSITE', note: '',
    overtimeDecision: 'PENDING', nightDecision: 'PENDING' });
  const review = (stage, decision, reason) => reviewExtension._handler(f.ctx,
    { token: f.token, id: extensionId, stage, decision, ...(reason ? { reason } : {}) });
  await assert.rejects(review('NIGHT', 'APPROVED'), /Approve overtime before/);
  await review('OVERTIME', 'APPROVED', 'Approved field assignment');
  await review('NIGHT', 'APPROVED');
  assert.equal((await f.ctx.db.get(extensionId)).nightDecision, 'APPROVED');
  await review('OVERTIME', 'REJECTED');
  assert.equal((await f.ctx.db.get(extensionId)).nightDecision, 'REJECTED');
  await review('OVERTIME', 'APPROVED');
  await verify._handler(f.ctx, { token: f.token, id: outId, verification: 'REJECTED', reason: 'No valid proof' });
  assert.equal((await f.ctx.db.get(extensionId)).overtimeDecision, 'REJECTED');
  await assert.rejects(review('OVERTIME', 'APPROVED'), /Approve the employee/);
});

test('admin approves Time In and Time Out together for daily payroll', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  const inId = await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'IN', method: 'ONSITE',
    timeUtc: shiftInstant(date, '08:00'), verification: 'PENDING', active: true });
  const outId = await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'OUT', method: 'ONSITE',
    timeUtc: shiftInstant(date, '17:00'), verification: 'PENDING', active: true });
  await approveAttendanceDay._handler(f.ctx, { token: f.token, userId, workDate: date });
  assert.equal((await f.ctx.db.get(inId)).verification, 'APPROVED');
  assert.equal((await f.ctx.db.get(outId)).verification, 'APPROVED');
  assert.equal((await f.ctx.db.get(inId)).reviewedBy, adminId);
  const nextDate = '2026-10-16';
  await f.ctx.db.insert('punches', { userId, workDate: nextDate, slot: 'IN', method: 'ONSITE',
    timeUtc: shiftInstant(nextDate, '08:00'), verification: 'PENDING', active: true });
  await assert.rejects(approveAttendanceDay._handler(f.ctx,
    { token: f.token, userId, workDate: nextDate }), /Both Time In and Time Out/);
});

test('admin-created offsite shift generates reviewable extra hours and next-day cutoff', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  await backfill._handler(f.ctx, { token: f.token, input: { employeeId: userId, workDate: date,
    timeIn: '08:00', timeOut: '02:30', timeOutNextDay: true, offsite: true,
    reason: 'No network at field assignment' } });
  const rows = [...f.tables.punches.values()];
  assert.equal(rows.find(row => row.slot === 'OUT').timeUtc, shiftInstant(date, '02:30', true));
  assert.equal(rows.find(row => row.slot === 'OUT').assignmentType, 'OFFSITE');
  const extension = [...f.tables.extensions.values()][0];
  assert.equal(extension.overtimeDecision, 'PENDING');
  await reviewExtension._handler(f.ctx, { token: f.token, id: extension._id, stage: 'OVERTIME', decision: 'APPROVED' });
  await reviewExtension._handler(f.ctx, { token: f.token, id: extension._id, stage: 'NIGHT', decision: 'APPROVED' });
  await assert.rejects(backfill._handler(f.ctx, { token: f.token, input: { employeeId: userId, workDate: '2026-10-16',
    timeIn: '08:00', timeOut: '06:01', timeOutNextDay: true, offsite: true,
    reason: 'Invalid overnight time' } }), /no later than 6:00 AM/);
});

test('replace existing overwrites matching same-day punches and preserves audit history', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  const input = { employeeId: userId, workDate: date, timeIn: '08:00', timeOut: '17:00',
    offsite: false, reason: 'Initial admin attendance' };
  await backfill._handler(f.ctx, { token: f.token, input });
  await assert.rejects(backfill._handler(f.ctx, { token: f.token, input: { ...input, timeIn: '09:00' } }),
    /already exists for this workday/);
  await backfill._handler(f.ctx, { token: f.token, input: { ...input, timeIn: '09:00', timeOut: '18:00',
    replaceExisting: true, reason: 'Corrected signed timesheet' } });
  const punches = [...f.tables.punches.values()];
  assert.equal(punches.filter(row => row.active).length, 2);
  assert.equal(punches.filter(row => !row.active).length, 2);
  assert.equal(punches.find(row => row.active && row.slot === 'IN').timeUtc, shiftInstant(date, '09:00'));
  assert.equal(punches.find(row => row.active && row.slot === 'OUT').timeUtc, shiftInstant(date, '18:00'));
  assert.equal([...f.tables.audit.values()].filter(row => row.action === 'punch_replaced').length, 2);
});

test('admin keeps existing proof, adds a return-to-work pair, and edits one punch', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  await backfill._handler(f.ctx, { token: f.token, input: { employeeId: userId, workDate: date,
    timeIn: '08:00', timeOut: '20:00', offsite: true, reason: 'First field assignment' } });
  const first = [...f.tables.punches.values()].filter(row => row.active);
  const segment = (timeOut = '23:00', outId = null) => ({ timeIn: '21:00', timeOut,
    inId: f.tables.punches.size > 2 ? [...f.tables.punches.values()].find(row => row.segment === 2 && row.slot === 'IN' && row.active)?._id : null,
    outId, offsite: true });
  const primary = { timeIn: '08:00', timeOut: '20:00', inId: first.find(row => row.slot === 'IN')._id,
    outId: first.find(row => row.slot === 'OUT')._id, offsite: true };
  const save = input => saveAdminAttendanceDay._handler(f.ctx, { token: f.token, input });
  const base = { employeeId: userId, workDate: date, reason: 'Urgent return to client site' };
  const added = await save({ ...base, expectedIds: first.map(row => row._id), segments: [primary, segment()] });
  assert.deepEqual({ created: added.created, replaced: added.replaced, preserved: added.preserved },
    { created: 2, replaced: 0, preserved: 2 });
  assert.equal([...f.tables.punches.values()].filter(row => row.active).length, 4);
  const extension = [...f.tables.extensions.values()][0];
  await approveAttendanceDay._handler(f.ctx, { token: f.token, userId, workDate: date });
  await reviewExtension._handler(f.ctx, { token: f.token, id: extension._id, stage: 'OVERTIME', decision: 'APPROVED' });
  await reviewExtension._handler(f.ctx, { token: f.token, id: extension._id, stage: 'NIGHT', decision: 'APPROVED' });
  const active = [...f.tables.punches.values()].filter(row => row.active);
  const secondOut = active.find(row => row.segment === 2 && row.slot === 'OUT');
  const corrected = await save({ ...base, expectedIds: active.map(row => row._id),
    segments: [primary, segment('23:30', secondOut._id)] });
  assert.deepEqual({ created: corrected.created, replaced: corrected.replaced, preserved: corrected.preserved },
    { created: 1, replaced: 1, preserved: 3 });
  assert.equal((await f.ctx.db.get(secondOut._id)).active, false);
  assert.equal(extension.nightDecision, 'PENDING');
  await assert.rejects(save({ ...base, expectedIds: first.map(row => row._id),
    segments: [primary, segment()] }), /Attendance changed/);
  const latest = [...f.tables.punches.values()].filter(row => row.active);
  const invalidSecond = { ...segment('22:00', latest.find(row => row.segment === 2 && row.slot === 'OUT')._id), timeIn: '19:30' };
  await assert.rejects(save({ ...base, expectedIds: latest.map(row => row._id),
    segments: [primary, invalidSecond] }), /start after the previous Time Out/);
});

test('unchanged employee punches keep selfie and GPS when admin adds another interval', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  const inId = await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'IN',
    method: 'OFFSITE', timeUtc: shiftInstant(date, '08:00'), selfieId: 'photo-in',
    latitude: 14.5, longitude: 120.9, verification: 'APPROVED', active: true });
  const outId = await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'OUT',
    method: 'OFFSITE', timeUtc: shiftInstant(date, '20:00'), selfieId: 'photo-out',
    latitude: 14.6, longitude: 121, verification: 'APPROVED', active: true });
  const result = await saveAdminAttendanceDay._handler(f.ctx, { token: f.token, input: {
    employeeId: userId, workDate: date, reason: 'Return to urgent field assignment', expectedIds: [inId, outId],
    segments: [
      { inId, outId, timeIn: '08:00', timeOut: '20:00', offsite: true },
      { timeIn: '21:00', timeOut: '22:30', offsite: true }
    ]
  } });
  assert.equal(result.preserved, 2);
  assert.equal((await f.ctx.db.get(inId)).selfieId, 'photo-in');
  assert.equal((await f.ctx.db.get(outId)).longitude, 121);
  assert.equal((await f.ctx.db.get(outId)).active, true);
  assert.equal([...f.tables.punches.values()].filter(row => row.active).length, 4);
});

test('system auto-closes an open continued shift at 6 AM exactly once', async () => {
  const f = fixture(), date = '2026-10-15', userId = await f.addUser('Worker', 'employee');
  await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'IN', method: 'OFFSITE',
    timeUtc: shiftInstant(date, '08:00'), verification: 'APPROVED', active: true });
  await f.ctx.db.insert('extensions', { userId, workDate: date, continuedAt: shiftInstant(date, '17:00'),
    source: 'OFFSITE', note: '', overtimeDecision: 'PENDING', nightDecision: 'PENDING' });
  await autoTimeOut._handler(f.ctx, { userId, workDate: date });
  await autoTimeOut._handler(f.ctx, { userId, workDate: date });
  const exits = [...f.tables.punches.values()].filter(row => row.slot === 'OUT');
  assert.equal(exits.length, 1);
  assert.equal(exits[0].timeUtc, shiftInstant(date, '06:00', true));
  assert.equal(exits[0].method, 'SYSTEM');
});

test('one offsite continuation tap records GPS and schedules the 6 AM close', async () => {
  const f = fixture(), date = '2026-10-15', userId = await f.addUser('Worker', 'employee');
  await f.authorize(userId);
  await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'IN', method: 'OFFSITE',
    timeUtc: shiftInstant(date, '08:00'), verification: 'APPROVED', active: true });
  let scheduled;
  f.ctx.scheduler = { async runAt(time, _reference, args) { scheduled = { time, args }; } };
  const RealDate = globalThis.Date;
  const instant = RealDate.parse(shiftInstant(date, '17:00'));
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
  try {
    const response = await continueOffsite._handler(f.ctx, { token: f.token,
      latitude: 14.7, longitude: 121.1, accuracyM: 12 });
    assert.equal(response.extension.continuedAt, shiftInstant(date, '17:00'));
    assert.deepEqual(scheduled.args, { userId, workDate: date });
    assert.equal(scheduled.time, RealDate.parse(shiftInstant(date, '06:00', true)));
    await assert.rejects(continueOffsite._handler(f.ctx, { token: f.token,
      latitude: 14.7, longitude: 121.1, accuracyM: 12 }), /already recorded/);
  } finally { globalThis.Date = RealDate; }
});
