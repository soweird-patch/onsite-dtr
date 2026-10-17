import test from 'node:test';
import assert from 'node:assert/strict';
import { changePassword, createEmployee, registerFirstAdmin, updateEmployee } from '../convex/authActions.js';
import { validateEmployee } from '../convex/lib.js';
import { validEmail } from '../convex/lib.js';

test('short valid emails and eight-character passwords work across account flows', async () => {
  assert.equal(validEmail('a@b.co'), true);
  let saved;
  const ctx = {
    runQuery: async () => ({ available: true, passwordHash: saved?.passwordHash }),
    runMutation: async (_reference, args) => { saved = args; return { user: { role: 'admin' }, employee: { role: 'employee' } }; }
  };
  await assert.rejects(registerFirstAdmin._handler(ctx, {
    name: 'Admin', email: 'a@b.co', password: '1234567', remember: false
  }), /8–1024/);
  await registerFirstAdmin._handler(ctx, {
    name: 'Admin', email: 'a@b.co', password: '12345678', remember: false
  });
  assert.match(saved.passwordHash, /^scrypt\$/);
  await changePassword._handler(ctx, { token: 'token', currentPassword: '12345678', newPassword: '87654321' });
  assert.match(saved.newHash, /^scrypt\$/);
  await assert.rejects(createEmployee._handler(ctx, { token: 'token', input: { password: '1234567' } }), /8–1024/);
  await createEmployee._handler(ctx, { token: 'token', input: { password: '12345678', name: 'Worker', username: 'worker' } });
  assert.match(saved.input.passwordHash, /^scrypt\$/);
  await updateEmployee._handler(ctx, { token: 'token', id: 'employee-id', input: { password: '87654321' } });
  assert.match(saved.input.passwordHash, /^scrypt\$/);
});

test('employee accounts require a valid username, with standard and custom schedules', () => {
  const input = { name: 'Worker', username: 'worker', passwordHash: 'stored',
    scheduleStart: '08:00', scheduleEnd: '17:00', workdays: [1, 2, 3, 4, 5, 6] };
  assert.doesNotThrow(() => validateEmployee(input, true));
  for (const username of ['ab', '09171234567', 'bad user', 'bad@email.test', 'a'.repeat(33)])
    assert.throws(() => validateEmployee({ ...input, username }, true), /Username must/);
  assert.doesNotThrow(() => validateEmployee({ ...input, username: ' Juan.Dela_Cruz-2 ' }, true));
  assert.throws(() => validateEmployee({ ...input, username: undefined, mobile: '09171234567' }, true), /Username must/);
  assert.doesNotThrow(() => validateEmployee({ ...input, scheduleStart: '10:00', scheduleEnd: '16:00' }, true));
  assert.throws(() => validateEmployee({ ...input, scheduleStart: '16:00', scheduleEnd: '10:00' }, true), /after the start/);
});
