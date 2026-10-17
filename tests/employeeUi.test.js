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

test('admin interval editor shows regular top-up, OT, and night-only allocations', () => {
  const app=appHarness();
  app.state.session={today:'2026-10-15'};
  app.state.backfillDraft={employeeId:'worker',workDate:'2026-10-15',expectedIds:[],punches:[],segments:[
    {timeIn:'08:00',timeOut:'15:00',reason:'First assignment'},
    {timeIn:'17:00',timeOut:'20:00',reason:'Second assignment'},
    {timeIn:'22:00',timeOut:'00:00',reason:'Night assignment'}
  ]};
  const html=app.renderBackfill();
  assert.ok(html.includes('Reason (optional)'));
  const reasonFields=html.match(/<textarea name="intervalReason"[^>]*>/g);
  assert.equal(reasonFields.length,3);
  assert.ok(reasonFields.every(field=>!/(required|minlength)/.test(field)));
  assert.equal((html.match(/data-interval-hours=/g)||[]).length,3);
  assert.ok(html.includes('Fills regular shortage</span><strong>2h 00m'));
  assert.ok(html.includes('Pending OT</span><strong>1h 00m'));
  assert.ok(html.includes('Night differential</span><strong>2h 00m'));
  assert.ok(html.includes('Time Out date: 10/16/2026 (+1 day). Attendance stays on 10/15/2026.'));
  assert.ok(!html.includes('name="timeOutNextDay"'));
  app.state.backfillDraft.segments.push({timeIn:'00:30',timeOut:'06:00'});
  const overnightHtml=app.renderBackfill();
  assert.ok(overnightHtml.includes('Time In date: 10/16/2026 · Time Out date: 10/16/2026 (+1 day)'));
  assert.ok(overnightHtml.includes('Night differential</span><strong>5h 30m'));
  app.state.backfillDraft.workDate='';
  assert.doesNotThrow(()=>app.renderBackfill());
});
