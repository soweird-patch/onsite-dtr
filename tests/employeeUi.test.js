import test from 'node:test';
import assert from 'node:assert/strict';
import { appHarness } from './helpers/appHarness.js';

test('employee editor uses username login and retains editable planned working hours', () => {
  const app = appHarness();
  const employee = {id:'worker',name:'Juan Dela Cruz',username:'juan.delacruz',active:true,
    scheduleStart:'07:00',scheduleEnd:'16:00',workdays:[1,2,3,4,5,6]};
  Object.assign(app.state,{selectedEmployee:employee,employees:[employee],session:{today:'2026-10-17'}});
  const html = app.renderEmployees();
  assert.ok(html.includes('name="username"'));
  assert.ok(!html.includes('name="mobile"'));
  assert.ok(html.includes('name="scheduleStart" type="time" value="07:00"'));
  assert.ok(html.includes('name="scheduleEnd" type="time" value="16:00"'));
  assert.ok(html.includes('1 hour of pending OT for admin approval'));
  const pattern = new RegExp(`^(?:${html.match(/name="username"[^>]*pattern="([^"]+)"/)[1]})$`,'v');
  for (const username of ['juan.delacruz','Juan_Dela-Cruz','worker123']) assert.ok(pattern.test(username));
  for (const username of ['09171234567','x','bad user','bad@email.test']) assert.ok(!pattern.test(username));
});
