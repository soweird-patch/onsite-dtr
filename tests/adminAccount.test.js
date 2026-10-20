import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resetAttendanceDay, autoTimeOut, deleteAdminAccount, deleteEmployee, registerFirstAdmin, signupStatus, updateProfileImage } from '../convex/core.js';
import { deleteAdminAccount as deleteAction, registerFirstAdmin as signupAction } from '../convex/authActions.js';

function fakeContext() {
  const tables = Object.fromEntries(['users', 'sessions', 'settings', 'loginAttempts', 'audit', 'punches', 'extensions', 'overtime'].map(name => [name, new Map()]));
  const deletedFiles = [];
  let nextId = 0;
  const db = {
    query(table) {
      let filters = [];
      const result = {
        withIndex(_name, predicate) {
          const builder = { eq(key, value) { filters.push([key, value]); return builder; } };
          predicate(builder); return result;
        },
        async collect() { return [...tables[table].values()].filter(row => filters.every(([key, value]) => row[key] === value)); },
        async first() { return (await result.collect())[0] || null; },
        async unique() { const rows = await result.collect(); assert(rows.length <= 1); return rows[0] || null; }
      };
      return result;
    },
    async insert(table, value) { const id = `${table}:${++nextId}`; tables[table].set(id, { _id: id, ...value }); return id; },
    async get(id) { return Object.values(tables).map(table => table.get(id)).find(Boolean) || null; },
    async patch(id, updates) { const row = await db.get(id); assert(row); Object.assign(row, updates); },
    async delete(id) { for (const table of Object.values(tables)) if (table.delete(id)) return; },
    normalizeId(table, id) { return typeof id === 'string' && id.startsWith(`${table}:`) ? id : null; },
    system: { async get(id) { return id === 'photo:2' ? { contentType: 'image/png', size: 1623 } : null; } }
  };
  return { ctx: { db, storage: { async delete(id) { deletedFiles.push(id); } } }, tables, deletedFiles };
}

test('first admin can register after deletion without erasing employee or site data', async () => {
  const { ctx, tables, deletedFiles } = fakeContext();
  await ctx.db.insert('users', { name: 'Worker', email: 'worker@example.test', role: 'employee', active: true });
  await ctx.db.insert('settings', { key: 'main', siteName: 'Existing site' });
  assert.equal((await signupStatus._handler(ctx, {})).available, true);

  const token = 'a'.repeat(64), passwordHash = 'stored-password-hash';
  const first = await registerFirstAdmin._handler(ctx, { name: 'First Admin', email: 'admin@example.test',
    passwordHash, profileImageId: 'photo:1', tokenHash: createHash('sha256').update(token).digest('hex'), remember: true });
  assert.equal(first.user.role, 'admin');
  assert.equal((await signupStatus._handler(ctx, {})).available, false);
  await assert.rejects(registerFirstAdmin._handler(ctx, { name: 'Another Admin', email: 'another@example.test',
    passwordHash, tokenHash: createHash('sha256').update('b'.repeat(64)).digest('hex'), remember: false }), /already exists/);
  await assert.rejects(deleteAdminAccount._handler(ctx, { token, oldHash: 'wrong' }), /Password changed/);

  await updateProfileImage._handler(ctx, { token, profileImageId: 'photo:2', remove: false });
  assert.equal((await ctx.db.get(first.user.id)).profileImageId, 'photo:2');

  await deleteAdminAccount._handler(ctx, { token, oldHash: passwordHash });
  assert.equal((await signupStatus._handler(ctx, {})).available, true);
  assert.equal(tables.sessions.size, 0);
  assert.equal(tables.settings.size, 1);
  assert.equal([...tables.users.values()].filter(user => user.role === 'employee').length, 1);
  assert.deepEqual(deletedFiles, ['photo:1', 'photo:2']);
  await assert.rejects(deleteAdminAccount._handler(ctx, { token, oldHash: passwordHash }), /Please sign in/);

  const next = await registerFirstAdmin._handler(ctx, { name: 'New Admin', email: 'new@example.test',
    passwordHash: 'new-hash', tokenHash: createHash('sha256').update('c'.repeat(64)).digest('hex'), remember: false });
  assert.equal(next.user.name, 'New Admin');
  assert.equal(tables.settings.size, 1);
});

test('admin can delete an employee account and all related records', async () => {
  const { ctx, tables, deletedFiles } = fakeContext();
  const token = 'd'.repeat(64);
  const adminId = await ctx.db.insert('users', { name: 'Admin', email: 'admin@example.test', role: 'admin', active: true });
  const employeeId = await ctx.db.insert('users', { name: 'Employee', mobile: '09171234567', role: 'employee', active: true, profileImageId: 'photo:profile' });
  const remainingId = await ctx.db.insert('users', { name: 'Remaining', mobile: '09171234568', role: 'employee', active: true });
  await ctx.db.insert('sessions', { userId: adminId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: Date.now() + 86400000 });
  await ctx.db.insert('sessions', { userId: employeeId, tokenHash: 'employee-token', expiresAt: Date.now() + 86400000 });
  await ctx.db.insert('punches', { userId: employeeId, workDate: '2026-10-15', selfieId: 'photo:proof' });
  await ctx.db.insert('punches', { userId: remainingId, workDate: '2026-10-15' });
  await ctx.db.insert('extensions', { userId: employeeId, workDate: '2026-10-15' });
  await ctx.db.insert('overtime', { userId: employeeId, workDate: '2026-10-15' });
  await ctx.db.insert('loginAttempts', { email: '09171234567', count: 1, until: 0 });
  await deleteEmployee._handler(ctx, { token, id: employeeId });
  assert.equal(await ctx.db.get(employeeId), null);
  assert(await ctx.db.get(remainingId));
  assert.equal(tables.sessions.size, 1);
  assert.equal(tables.punches.size, 1);
  assert.equal(tables.extensions.size, 0);
  assert.equal(tables.overtime.size, 0);
  assert.equal(tables.loginAttempts.size, 0);
  assert.deepEqual(deletedFiles, ['photo:proof', 'photo:profile']);
  assert.equal([...tables.audit.values()].at(-1).action, 'employee_delete');
});

test('signup action accepts a profile image and deletion requires the password', async () => {
  const photo = `data:image/png;base64,${readFileSync(new URL('../pwa-assets/icon-192.png', import.meta.url)).toString('base64')}`;
  let signupArgs, deleteArgs;
  const ctx = {
    runQuery: async () => ({ available: true }),
    runMutation: async (_reference, args) => {
      if (args.passwordHash) { signupArgs = args; return { user: { role: 'admin' } }; }
      deleteArgs = args; return { ok: true };
    },
    storage: { async store(blob) { assert.equal(blob.type, 'image/png'); return 'photo:1'; }, async delete() {} }
  };
  const signedUp = await signupAction._handler(ctx, { name: 'Admin', email: 'admin@example.test',
    password: 'a-long-unique-password', remember: true, profileImage: photo });
  assert.match(signedUp.token, /^[a-f0-9]{64}$/);
  assert.equal(signupArgs.profileImageId, 'photo:1');
  assert.match(signupArgs.passwordHash, /^scrypt\$/);
  ctx.runQuery = async () => ({ passwordHash: signupArgs.passwordHash });
  await assert.rejects(deleteAction._handler(ctx, { token: signedUp.token, password: 'incorrect-password', confirmation: 'DELETE' }), /incorrect/);
  await assert.rejects(deleteAction._handler(ctx, { token: signedUp.token, password: 'a-long-unique-password', confirmation: 'wrong' }), /Type DELETE/);
  await deleteAction._handler(ctx, { token: signedUp.token, password: 'a-long-unique-password', confirmation: 'DELETE' });
  assert.equal(deleteArgs.token, signedUp.token);
  assert.equal(deleteArgs.oldHash, signupArgs.passwordHash);
});


test('reset selected past attendance clears all intervals and premiums, preserves proof and other days', async () => {
  const { ctx, tables } = fakeContext();
  const token = 'e'.repeat(64);
  const admin = await ctx.db.insert('users', { name: 'Admin', role: 'admin', active: true });
  const employee = await ctx.db.insert('users', { name: 'Worker', role: 'employee', active: true });
  await ctx.db.insert('sessions', { userId: admin, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: Date.now() + 86400000 });
  const workDate = '2026-09-01';
  const ids = [];
  for (const [segment, slot] of [[1, 'IN'], [1, 'OUT'], [2, 'IN']]) {
    ids.push(await ctx.db.insert('punches', { userId: employee, workDate, segment, slot,
      active: true, verification: 'APPROVED', selfieId: 'photo:original', timeUtc: `${workDate}T01:00:00Z` }));
  }
  const otherDay = await ctx.db.insert('punches', { userId: employee, workDate: '2026-09-02', active: true });
  const otherEmployee = await ctx.db.insert('punches', { userId: 'users:other', workDate, active: true });
  await ctx.db.insert('extensions', { userId: employee, workDate, overtimeDecision: 'APPROVED', nightDecision: 'APPROVED' });
  await ctx.db.insert('overtime', { userId: employee, workDate, minutes: 120 });
  const otherPremium = await ctx.db.insert('extensions', { userId: employee, workDate: '2026-09-02' });
  const args = { token, userId: employee, workDate, expectedIds: ids, reason: '' };
  await assert.rejects(resetAttendanceDay._handler(ctx, { ...args, expectedIds: ids.slice(1) }), /Attendance changed/);
  assert(ids.every(id => tables.punches.get(id).active));
  await resetAttendanceDay._handler(ctx, args);
  assert(ids.every(id => !tables.punches.get(id).active && tables.punches.get(id).selfieId === 'photo:original'));
  assert(tables.punches.get(otherDay).active);
  assert(tables.punches.get(otherEmployee).active);
  assert.equal(tables.extensions.size, 1);
  assert(tables.extensions.has(otherPremium));
  assert.equal(tables.overtime.size, 0);
  const audit = [...tables.audit.values()].find(row => row.action === 'attendance_day_reset');
  assert.equal(audit.actorId, admin);
  assert.equal(audit.details.punches.length, 3);
  assert.equal(audit.details.extensions[0].overtimeDecision, 'APPROVED');
  const count = tables.punches.size;
  await autoTimeOut._handler(ctx, { userId: employee, workDate, segment: 2 });
  assert.equal(tables.punches.size, count, 'scheduled close must not recreate a cleared punch');
  await assert.rejects(resetAttendanceDay._handler(ctx, args), /Attendance changed/);
  await ctx.db.patch(admin, { role: 'employee' });
  await assert.rejects(resetAttendanceDay._handler(ctx, args), /Not allowed/);
});
