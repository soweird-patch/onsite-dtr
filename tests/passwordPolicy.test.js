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
  await createEmployee._handler(ctx, { token: 'token', input: { password: '12345678', name: 'Worker', mobile: '09171234567' } });
  assert.match(saved.input.passwordHash, /^scrypt\$/);
  await updateEmployee._handler(ctx, { token: 'token', id: 'employee-id', input: { password: '87654321' } });
  assert.match(saved.input.passwordHash, /^scrypt\$/);
});

test('employee accounts require an exact 11-digit mobile login', () => {
  const input = { name: 'Worker', mobile: '09171234567', passwordHash: 'stored',
    scheduleStart: '08:00', scheduleEnd: '17:00', workdays: [1, 2, 3, 4, 5, 6] };
  assert.doesNotThrow(() => validateEmployee(input, true));
  assert.throws(() => validateEmployee({ ...input, mobile: '0917123456' }, true), /exactly 11 digits/);
  assert.throws(() => validateEmployee({ ...input, mobile: '09171ABC567' }, true), /exactly 11 digits/);
  assert.doesNotThrow(() => validateEmployee({ ...input, scheduleStart: '10:00', scheduleEnd: '16:00' }, true));
  assert.throws(() => validateEmployee({ ...input, scheduleStart: '16:00', scheduleEnd: '10:00' }, true), /after the start/);
});
