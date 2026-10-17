import test from 'node:test';
import assert from 'node:assert/strict';
import { appHarness } from './helpers/appHarness.js';
import { premiumCalculationKey, shiftInstant } from '../rules.js';

test('employee editor uses username login and retains editable planned working hours', () => {
  const app = appHarness();
  const employee = {id:'worker',name:'Juan Dela Cruz',username:'juan.delacruz',active:true,
    scheduleStart:'07:00',scheduleEnd:'16:00',workdays:[1,2,3,4,5,6]};
  Object.assign(app.state,{employees:[employee],session:{today:'2026-10-17'}});
  const list = app.renderEmployees();
  assert.ok(list.includes('Juan Dela Cruz'));
  assert.ok(!list.includes('id="employee-form"'));
  const html = app.renderEmployeeForm(employee);
  assert.ok(html.includes('name="username"'));
  assert.ok(!html.includes('name="mobile"'));
  assert.ok(html.includes('name="scheduleStart" type="time" value="07:00"'));
  assert.ok(html.includes('name="scheduleEnd" type="time" value="16:00"'));
  assert.ok(!app.renderEmployeeForm().includes('The admin sets the planned schedule.'));
  const pattern = new RegExp(`^(?:${html.match(/name="username"[^>]*pattern="([^"]+)"/)[1]})$`,'v');
  for (const username of ['juan.delacruz','Juan_Dela-Cruz','worker123']) assert.ok(pattern.test(username));
  for (const username of ['09171234567','x','bad user','bad@email.test']) assert.ok(!pattern.test(username));
});

test('editor, employee history, and review keep ten minutes undertime while adding ND to OT total', () => {
  const app=appHarness(), date='2026-10-15';
  const segments=[{timeIn:'08:10',timeOut:'15:00'}, {timeIn:'20:00',timeOut:'00:00'}];
  const employee={id:'worker',name:'QA Worker',scheduleStart:'08:00',scheduleEnd:'17:00',workdays:[1,2,3,4,5,6]};
  const punches=segments.flatMap((segment,index)=>['IN','OUT'].map(slot=>({
    id:`${index}-${slot}`,userId:'worker',workDate:date,segment:index+1,slot,method:'ADMIN',
    timeUtc:shiftInstant(date,slot==='IN'?segment.timeIn:segment.timeOut,index===1&&slot==='OUT'),verification:'APPROVED'
  })));
  const extension={id:'review',userId:'worker',employeeName:employee.name,workDate:date,
    calculationKey:premiumCalculationKey(date,punches),overtimeDecision:'PENDING',nightDecision:'PENDING'};
  Object.assign(app.state,{session:{today:date,user:employee,settings:{holidays:[]}},employees:[employee],
    adminData:{punches,extensions:[extension],overtime:[]},employeeData:{punches,extensions:[extension],overtime:[]},
    backfillDraft:{employeeId:'worker',workDate:date,expectedIds:[],punches:[],segments}});
  const editor=app.renderBackfill();
  assert.ok(editor.includes('Remaining OT</span><strong>0h 00m'));
  assert.ok(editor.includes('OT total (remaining OT + ND): <strong>2h 00m'));
  assert.ok(editor.includes('Regular shortage after this interval: 0h 10m'));
  const history=app.employeeAttendanceDayCardSegments(date,punches);
  assert.ok(history.includes('Thu.'));
  assert.ok(history.includes('Undertime</span><strong>0h 10m'));
  assert.ok(history.includes('Overtime</span><strong>2h 00m'));
  assert.ok(!history.includes('(+1 day)'));
  const queue=app.renderPremiumQueue();
  assert.ok(queue.includes('Remaining shortage</span><strong>0h 10m'));
  assert.ok(queue.includes('Overtime</span><strong>2h 00m'));
  assert.ok(queue.includes('Approve Night differential'));
  assert.ok(!queue.includes('Approve remaining OT'));
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
  assert.ok(html.includes('Remaining OT</span><strong>1h 00m'));
  assert.ok(html.includes('Night differential</span><strong>2h 00m'));
  assert.match(html,/data-day-hours[^>]*>[\s\S]*OT total \(remaining OT \+ ND\): <strong>3h 00m/);
  assert.ok(html.includes('Time Out date: 10/16/2026 Fri. Attendance stays on 10/15/2026 Thu.'));
  assert.ok(!html.includes('name="timeOutNextDay"'));
  app.state.backfillDraft.segments.push({timeIn:'00:30',timeOut:'06:00'});
  const overnightHtml=app.renderBackfill();
  assert.ok(overnightHtml.includes('Time In date: 10/16/2026 Fri. · Time Out date: 10/16/2026 Fri.'));
  assert.ok(!overnightHtml.includes('(+1 day)'));
  assert.ok(overnightHtml.includes('Night differential</span><strong>5h 30m'));
  app.state.backfillDraft.workDate='';
  assert.doesNotThrow(()=>app.renderBackfill());
});
