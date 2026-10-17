import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';
import { getFunctionName } from 'convex/server';
import { login } from '../convex/authActions.js';
import { approveAttendanceDay, autoTimeOut, backfill, continueOffsite, reviewExtension, syncAutomaticPremiums,
  saveAdminAttendanceDay, submitPunch, updateEmployee, verify, createEmployee, userForLogin,
  migrateEmployeeUsernames, loginAttempt, recordLoginFailure, issueSession } from '../convex/core.js';
import { localDateTime, payrollDayTotals, shiftInstant } from '../rules.js';

function fixture() {
  const tables = Object.fromEntries(['users', 'sessions', 'settings', 'punches', 'extensions', 'overtime', 'audit', 'loginAttempts']
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
    async delete(id) { tables[id.split(':')[0]].delete(id); },
    async replace(id, value) { const table = id.split(':')[0]; tables[table].set(id, { _id: id, ...value }); }
  };
  const ctx = { db };
  const token = 'a'.repeat(64);
  const addUser = (name, role) => db.insert('users', { name, email: `${name.toLowerCase()}@example.test`, role, active: true });
  const authorize = async adminId => db.insert('sessions', { userId: adminId,
    tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: Date.now() + 86400000 });
  return { ctx, tables, token, addUser, authorize };
}

test('employee username login is case-insensitive, rejects phone/email login, and keeps admin email login', async () => {
  const f = fixture(), adminId = await f.addUser('Admin','admin');
  await f.authorize(adminId);
  const salt = 'a'.repeat(32), password = 'password123';
  const passwordHash = `scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}`;
  const profile = { name: 'Juan Dela Cruz', username: ' Juan.Delacruz ', passwordHash,
    scheduleStart: '08:00', scheduleEnd: '17:00', workdays: [1,2,3,4,5,6], active: true };
  const result = await createEmployee._handler(f.ctx,{token:f.token,input:profile});
  assert.equal(result.employee.username,'juan.delacruz');
  const userId = result.employee.id;
  await f.ctx.db.patch(userId,{mobile:'09171234567',email:'worker@example.test'});
  await assert.rejects(createEmployee._handler(f.ctx,{token:f.token,input:profile}),/Username is already in use/);
  assert.equal((await userForLogin._handler(f.ctx,{identifier:' JUAN.DELACRUZ '}))._id,userId);
  assert.equal(await userForLogin._handler(f.ctx,{identifier:'09171234567'}),null);
  assert.equal(await userForLogin._handler(f.ctx,{identifier:'worker@example.test'}),null);
  assert.equal((await userForLogin._handler(f.ctx,{identifier:'admin@example.test'}))._id,adminId);
  const handlers = { userForLogin, loginAttempt, recordLoginFailure, issueSession };
  const dispatch = (reference,args) => handlers[getFunctionName(reference).split(':')[1]]._handler(f.ctx,args);
  const ctx = {runQuery:dispatch,runMutation:dispatch};
  const signedIn = await login._handler(ctx,{identifier:' JUAN.DELACRUZ ',password,remember:false});
  assert.equal(signedIn.user.id,userId);
  assert.equal(signedIn.user.username,'juan.delacruz');
  assert.match(signedIn.token,/^[a-f0-9]{64}$/);
  await assert.rejects(login._handler(ctx,{identifier:'juan.delacruz',password:'incorrect',remember:false}),/Invalid username/);
  await assert.rejects(login._handler(ctx,{identifier:'09171234567',password,remember:false}),/Invalid username/);
  await f.ctx.db.patch(userId,{active:false});
  await assert.rejects(login._handler(ctx,{identifier:'juan.delacruz',password,remember:false}),/Invalid username/);
});

test('username migration handles duplicate names and keeps existing credentials and records', async () => {
  const f = fixture();
  const first = await f.addUser('Juan Dela Cruz','employee'), second = await f.addUser('Juan Dela Cruz','employee');
  const third = await f.addUser('José Ñ','employee'), adminId = await f.addUser('Admin','admin');
  await f.ctx.db.patch(first,{mobile:'09171234567',passwordHash:'unchanged-hash'});
  const already = await f.addUser('Other worker','employee');
  await f.ctx.db.patch(already,{username:'juan.dela.cruz'});
  const session = await f.ctx.db.insert('sessions',{userId:first,tokenHash:'unchanged-session'});
  const punch = await f.ctx.db.insert('punches',{userId:first,timeUtc:'original-punch'});
  const result = await migrateEmployeeUsernames._handler(f.ctx,{});
  assert.equal(result.migrated,3);
  assert.equal((await f.ctx.db.get(first)).username,'juan.dela.cruz.2');
  assert.equal((await f.ctx.db.get(second)).username,'juan.dela.cruz.3');
  assert.equal((await f.ctx.db.get(third)).username,'jose.n');
  assert.equal((await f.ctx.db.get(adminId)).username,undefined);
  assert.equal((await f.ctx.db.get(first)).passwordHash,'unchanged-hash');
  assert.equal((await f.ctx.db.get(first)).mobile,'09171234567');
  assert.ok(await f.ctx.db.get(session));
  assert.equal((await f.ctx.db.get(punch)).timeUtc,'original-punch');
  assert.equal((await migrateEmployeeUsernames._handler(f.ctx,{})).migrated,0);
});

test('admin reviews overtime and night hours independently; rejected proof excludes both', async () => {
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
  await review('NIGHT', 'APPROVED');
  await review('OVERTIME', 'APPROVED', 'Approved field assignment');
  await review('NIGHT', 'APPROVED');
  assert.equal((await f.ctx.db.get(extensionId)).nightDecision, 'APPROVED');
  await review('OVERTIME', 'REJECTED');
  assert.equal((await f.ctx.db.get(extensionId)).nightDecision, 'APPROVED');
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

test('approving a completed early day creates pending overtime before 5 PM', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'IN', method: 'ONSITE',
    timeUtc: shiftInstant(date, '07:40'), verification: 'PENDING', active: true });
  await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'OUT', method: 'ONSITE',
    timeUtc: shiftInstant(date, '16:50'), verification: 'PENDING', active: true });
  await approveAttendanceDay._handler(f.ctx, { token: f.token, userId, workDate: date });
  const extension = [...f.tables.extensions.values()][0];
  assert.equal(extension.source, 'AUTO');
  assert.equal(extension.overtimeDecision, 'PENDING');
  assert.equal(payrollDayTotals(date, [...f.tables.punches.values()], extension).overtime, 0);
  await reviewExtension._handler(f.ctx, { token: f.token, id: extension._id, stage: 'OVERTIME', decision: 'APPROVED' });
  assert.equal(payrollDayTotals(date, [...f.tables.punches.values()], extension).overtime, 10);
});

test('admin-entered onsite work after 5 PM also receives an automatic OT review', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  await backfill._handler(f.ctx, { token: f.token, input: { employeeId: userId, workDate: date,
    timeIn: '08:00', timeOut: '17:30', offsite: false, reason: 'Approved onsite extension' } });
  const extension = [...f.tables.extensions.values()][0];
  assert.equal(extension.source, 'ADMIN');
  await reviewExtension._handler(f.ctx, { token: f.token, id: extension._id,
    stage: 'OVERTIME', decision: 'APPROVED' });
  assert.equal(extension.overtimeDecision, 'APPROVED');
});

test('flexible schedules fill regular hours automatically before OT review', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'IN', method: 'ONSITE',
    timeUtc: shiftInstant(date, '09:00'), verification: 'PENDING', active: true });
  await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'OUT', method: 'ONSITE',
    timeUtc: shiftInstant(date, '22:00'), verification: 'PENDING', active: true });
  await approveAttendanceDay._handler(f.ctx, { token: f.token, userId, workDate: date });
  const extension = [...f.tables.extensions.values()][0];
  await assert.rejects(reviewExtension._handler(f.ctx, { token: f.token, id: extension._id,
    stage: 'ADJUSTMENT', decision: 'APPROVED' }), /No OT-to-regular adjustment/);
  await reviewExtension._handler(f.ctx, { token: f.token, id: extension._id,
    stage: 'OVERTIME', decision: 'REJECTED' });
  assert.equal(payrollDayTotals(date, [...f.tables.punches.values()], extension).regular, 480);
  assert.equal(extension.overtimeDecision, 'REJECTED');
});

test('admin time-only attendance snapshots the latest schedule without requiring a photo', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.ctx.db.patch(userId, { scheduleStart: '10:00', scheduleEnd: '19:00' });
  await f.authorize(adminId);
  await saveAdminAttendanceDay._handler(f.ctx, { token: f.token, input: {
    employeeId: userId, workDate: date, reason: 'Manual time-only correction', expectedIds: [],
    segments: [{ timeIn: '10:00', timeOut: '19:00', timeInNextDay: false,
      timeOutNextDay: false, inId: null, outId: null, offsite: false }]
  } });
  const punches = [...f.tables.punches.values()];
  assert.equal(punches.length, 2);
  assert.ok(punches.every(punch => punch.scheduleStart === '10:00' && punch.scheduleEnd === '19:00'));
  assert.ok(punches.every(punch => !punch.selfieId));
});

test('existing attendance after 5 PM is synchronized into the OT queue once', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'IN', method: 'ONSITE',
    timeUtc: shiftInstant(date, '08:00'), verification: 'APPROVED', active: true });
  await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'OUT', method: 'ONSITE',
    timeUtc: shiftInstant(date, '18:00'), verification: 'APPROVED', active: true });
  const first = await syncAutomaticPremiums._handler(f.ctx, { token: f.token, from: date, to: date });
  const second = await syncAutomaticPremiums._handler(f.ctx, { token: f.token, from: date, to: date });
  assert.deepEqual({ first: first.created, second: second.created, total: f.tables.extensions.size },
    { first: 1, second: 0, total: 1 });
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

test('schedule edits apply immediately from the chosen date, preserve punches, and reopen premium reviews', async () => {
  const f = fixture(), date = localDateTime(new Date().toISOString()).date;
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  await f.ctx.db.patch(userId, { username: 'worker', scheduleStart: '08:00', scheduleEnd: '17:00', workdays: [1,2,3,4,5,6] });
  const priorDate = new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0,10);
  await backfill._handler(f.ctx, { token: f.token, input: { employeeId: userId, workDate: priorDate,
    timeIn: '08:00', timeOut: '17:00', reason: 'Prior workday entry' } });
  await backfill._handler(f.ctx, { token: f.token, input: { employeeId: userId, workDate: date,
    timeIn: '07:40', timeOut: '23:00', reason: 'Current field assignment' } });
  const todayPunches = [...f.tables.punches.values()].filter(p => p.workDate === date);
  await f.ctx.db.patch(todayPunches[0]._id, { selfieId: 'original-selfie', latitude: 14.5 });
  const originalTimes = todayPunches.map(p => p.timeUtc);
  const extension = [...f.tables.extensions.values()].find(e => e.workDate === date);
  await reviewExtension._handler(f.ctx, { token: f.token, id: extension._id, stage: 'OVERTIME', decision: 'APPROVED' });
  await reviewExtension._handler(f.ctx, { token: f.token, id: extension._id, stage: 'NIGHT', decision: 'APPROVED' });
  const oldKey = extension.calculationKey;
  assert.ok(payrollDayTotals(date, todayPunches, extension).overtime > 0);
  await updateEmployee._handler(f.ctx, { token: f.token, id: userId, input: {
    name: 'Worker', username: 'worker', scheduleStart: '07:00', scheduleEnd: '16:00',
    workdays: [1,2,3,4,5,6], active: true, scheduleEffectiveDate: date
  } });
  assert.ok(todayPunches.every(p => p.scheduleStart === '07:00' && p.scheduleEnd === '16:00'));
  assert.deepEqual(todayPunches.map(p => p.timeUtc), originalTimes);
  assert.equal(todayPunches[0].selfieId, 'original-selfie');
  assert.ok([...f.tables.punches.values()].filter(p => p.workDate === priorDate).every(p => p.scheduleStart === '08:00'));
  assert.equal(extension.overtimeDecision, 'PENDING');
  assert.equal(extension.nightDecision, 'PENDING');
  assert.equal(payrollDayTotals(date, todayPunches, extension).overtime, 0);
  assert.equal(payrollDayTotals(date, todayPunches, extension).night, 0);
  assert.ok([...f.tables.audit.values()].some(a => a.action === 'attendance_schedule_update' && a.details.before.scheduleStart === '08:00'));
  assert.ok([...f.tables.audit.values()].some(a => a.action === 'premium_recalculated' && a.details.before.overtimeDecision === 'APPROVED'));
  await assert.rejects(reviewExtension._handler(f.ctx, { token: f.token, id: extension._id,
    stage: 'OVERTIME', decision: 'APPROVED', calculationKey: oldKey }), /calculations changed/);
  await reviewExtension._handler(f.ctx, { token: f.token, id: extension._id,
    stage: 'OVERTIME', decision: 'APPROVED', calculationKey: extension.calculationKey });
  await syncAutomaticPremiums._handler(f.ctx, { token: f.token, from: date, to: date });
  assert.equal(extension.overtimeDecision, 'APPROVED');
});

test('schedule edits update an open current-day shift without replacing its Time In or ending its session', async () => {
  const f = fixture(), date = localDateTime(new Date().toISOString()).date;
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  await f.ctx.db.patch(userId, { username: 'worker', scheduleStart: '08:00', scheduleEnd: '17:00' });
  const sessionId = await f.ctx.db.insert('sessions', { userId, tokenHash: 'employee-session', expiresAt: Date.now() + 86400000 });
  const punchId = await f.ctx.db.insert('punches', { userId, workDate: date, slot: 'IN', timeUtc: shiftInstant(date,'07:40'),
    scheduleStart: '08:00', scheduleEnd: '17:00', method: 'ONSITE', selfieId: 'original', verification: 'PENDING', active: true });
  await updateEmployee._handler(f.ctx, { token: f.token, id: userId, input: {
    name: 'Worker', username: 'worker', scheduleStart: '07:00', scheduleEnd: '16:00', workdays: [1,2,3,4,5,6], active: true
  } });
  assert.equal((await f.ctx.db.get(punchId)).scheduleStart, '07:00');
  assert.equal((await f.ctx.db.get(punchId)).timeUtc, shiftInstant(date,'07:40'));
  assert.equal((await f.ctx.db.get(punchId)).selfieId, 'original');
  assert.ok(await f.ctx.db.get(sessionId));
  assert.equal(f.tables.extensions.size, 0);
});

test('each admin interval has independent details; metadata edits preserve proof and approvals', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin', 'admin'), userId = await f.addUser('Worker', 'employee');
  await f.authorize(adminId);
  const segments = [
    { timeIn: '07:40', timeOut: '16:50', reason: 'Morning client inspection', fieldAssignment: 'Client A - Kawit' },
    { timeIn: '21:00', timeOut: '23:00', reason: 'Urgent equipment repair', fieldAssignment: 'Client B - Imus' }
  ];
  await saveAdminAttendanceDay._handler(f.ctx, { token: f.token, input: { employeeId: userId, workDate: date, expectedIds: [], segments } });
  let active = [...f.tables.punches.values()].filter(p => p.active);
  assert.ok(active.filter(p => p.segment === 1).every(p => p.reason === segments[0].reason && p.fieldAssignment === segments[0].fieldAssignment));
  assert.ok(active.filter(p => p.segment === 2).every(p => p.reason === segments[1].reason && p.fieldAssignment === segments[1].fieldAssignment));
  const extension = [...f.tables.extensions.values()][0];
  await reviewExtension._handler(f.ctx, { token: f.token, id: extension._id, stage: 'OVERTIME', decision: 'APPROVED' });
  const firstIn = active.find(p => p.segment === 1 && p.slot === 'IN');
  await f.ctx.db.patch(firstIn._id, { selfieId: 'preserved-selfie', latitude: 14.6 });
  const edited = segments.map((segment,index) => ({ ...segment,
    inId: active.find(p => p.segment === index + 1 && p.slot === 'IN')._id,
    outId: active.find(p => p.segment === index + 1 && p.slot === 'OUT')._id }));
  edited[0].fieldAssignment = 'Client C - Bacoor';
  await saveAdminAttendanceDay._handler(f.ctx, { token: f.token, input: { employeeId: userId, workDate: date,
    expectedIds: active.map(p => p._id), segments: edited } });
  assert.equal(firstIn.fieldAssignment, 'Client C - Bacoor');
  assert.equal(firstIn.selfieId, 'preserved-selfie');
  assert.equal(extension.overtimeDecision, 'APPROVED');
  assert.ok([...f.tables.punches.values()].filter(p => p.segment === 2).every(p => p.fieldAssignment === 'Client B - Imus'));
  assert.ok([...f.tables.audit.values()].some(a => a.action === 'interval_details_update' && a.details.before.fieldAssignment === 'Client A - Kawit'));
});

test('admin interval saving and review allocate regular shortfall, remaining OT, and night-only work consistently', async () => {
  const f = fixture(), date = '2026-10-15';
  const adminId = await f.addUser('Admin','admin'), userId = await f.addUser('Worker','employee');
  await f.authorize(adminId);
  const segments = [
    {timeIn:'08:00',timeOut:'15:00',reason:'First daytime assignment'},
    {timeIn:'17:00',timeOut:'20:00',reason:'Returned for equipment repair'},
    {timeIn:'22:00',timeOut:'00:00',timeOutNextDay:true,reason:'Night equipment monitoring'}
  ];
  await saveAdminAttendanceDay._handler(f.ctx,{token:f.token,input:{employeeId:userId,workDate:date,expectedIds:[],segments}});
  const active = [...f.tables.punches.values()].filter(p=>p.active);
  const extension = [...f.tables.extensions.values()][0];
  assert.deepEqual(payrollDayTotals(date,active,extension),{regular:480,undertime:0,overtime:0,night:0});
  for(const stage of ['OVERTIME','NIGHT']) await reviewExtension._handler(f.ctx,{
    token:f.token,id:extension._id,stage,decision:'APPROVED',calculationKey:extension.calculationKey
  });
  assert.deepEqual(payrollDayTotals(date,active,extension),{regular:480,undertime:0,overtime:60,night:120});
  const revised = segments.map((segment,index)=>({...segment,
    inId:active.find(p=>p.segment===index+1&&p.slot==='IN')._id,
    outId:active.find(p=>p.segment===index+1&&p.slot==='OUT')._id
  }));
  revised[0].timeOut='14:00';
  await saveAdminAttendanceDay._handler(f.ctx,{token:f.token,input:{employeeId:userId,workDate:date,
    expectedIds:active.map(p=>p._id),segments:revised}});
  assert.equal(extension.overtimeDecision,'PENDING');
  assert.equal(extension.nightDecision,'PENDING');
  const current = [...f.tables.punches.values()].filter(p=>p.active);
  await assert.rejects(reviewExtension._handler(f.ctx,{token:f.token,id:extension._id,stage:'OVERTIME',decision:'APPROVED'}),/No remaining overtime/);
  await reviewExtension._handler(f.ctx,{token:f.token,id:extension._id,stage:'NIGHT',decision:'APPROVED'});
  assert.deepEqual(payrollDayTotals(date,current,extension),{regular:480,undertime:0,overtime:0,night:120});
});

test('employee clock-in enforces the 6 AM to 4 PM window, including both boundaries', async () => {
  const f = fixture(), date = '2026-10-15', userId = await f.addUser('Worker','employee');
  await f.authorize(userId);
  f.ctx.db.system = { async get() { return { contentType: 'image/jpeg', size: 2000 }; } };
  const RealDate = globalThis.Date;
  try {
    for (const [time, allowed] of [['05:59',false],['06:00',true],['16:00',true],['16:01',false]]) {
      const instant = RealDate.parse(shiftInstant(date, time));
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [instant])); }
        static now() { return instant; }
      };
      const call = () => submitPunch._handler(f.ctx, { token: f.token, selfieId: 'photo',
        input: { slot: 'IN', latitude: 14.5, longitude: 121, accuracyM: 10 } });
      if (allowed) {
        await call();
        f.tables.punches.clear();
      } else await assert.rejects(call(), /between 6:00 AM and 4:00 PM/);
    }
  } finally { globalThis.Date = RealDate; }
});
