import test from 'node:test';
import assert from 'node:assert/strict';
import { changePassword, createEmployee, registerFirstAdmin, updateEmployee } from '../convex/authActions.js';
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
  await createEmployee._handler(ctx, { token: 'token', input: { password: '12345678', name: 'Worker', email: 'e@b.co' } });
  assert.match(saved.input.passwordHash, /^scrypt\$/);
  await updateEmployee._handler(ctx, { token: 'token', id: 'employee-id', input: { password: '87654321' } });
  assert.match(saved.input.passwordHash, /^scrypt\$/);
});
