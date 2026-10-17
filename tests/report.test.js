import test from 'node:test';
import assert from 'node:assert/strict';
import { appHarness } from './helpers/appHarness.js';
import { attendanceDetails } from '../src/reportDetails.js';
import { premiumCalculationKey, shiftInstant } from '../rules.js';

export function reportFixture(dayCount = 1, intervalCount = 2) {
  const employee = { id: 'worker', name: 'Report Test Employee', active: true,
    scheduleStart: '07:00', scheduleEnd: '16:00', workdays: [0,1,2,3,4,5,6] };
  const rows = [];
  for (let day = 1; day <= dayCount; day++) {
    const date = `2026-10-${String(day).padStart(2,'0')}`, punches = [];
    for (let segment = 1; segment <= intervalCount; segment++) {
      const start = segment === 1 ? '07:40' : segment === 2 ? '18:00' : '22:00';
      const end = segment === 1 ? '16:50' : segment === 2 ? '20:00' : '23:30';
      const reason = `Detail ${day}-${segment}: Inspection and repair after a customer service request. ` +
        'Checked equipment, confirmed site access, and reviewed the completed work with the supervisor. '.repeat(2);
      const fieldAssignment = `Assignment ${day}-${segment}: Client site, Kawit, Cavite. ` +
        'Inspect power equipment in the service building and submit the signed inspection report. '.repeat(2);
      for (const slot of ['IN','OUT']) punches.push({ id: `${day}-${segment}-${slot}`, userId: employee.id,
        workDate: date, slot, segment, timeUtc: shiftInstant(date, slot === 'IN' ? start : end),
        method: 'ADMIN', verification: 'APPROVED', reason, fieldAssignment });
    }
    rows.push({ date, punches, regular: 480, undertime: 0, overtime: 0, night: 0 });
  }
  return { employee, rows, totals: { regular: dayCount * 480, overtime: 0, night: 0, undertime: 0,
    pending: dayCount, noRecord: 0, holidays: 0 } };
}

test('report renders every interval detail, escapes text, and includes open and legacy punches', () => {
  const fixture = reportFixture();
  fixture.rows[0].punches[0].reason = fixture.rows[0].punches[1].reason = '<script>unsafe</script>';
  const details = attendanceDetails(fixture.rows);
  assert.equal(details.length, 2);
  assert.notEqual(details[0].fieldAssignment, details[1].fieldAssignment);
  const app = appHarness();
  const html = app.renderReportEmployee(fixture, { start: '2026-10-01', end: '2026-10-01' }, 'QA', true);
  assert.ok(html.indexOf('Reasons and Field Assignments') > html.indexOf('Night differential</th>'));
  assert.ok(html.includes('<th>Date</th><th>Time In</th><th>Time Out</th><th>Reason</th><th>Field Assignment</th>'));
  assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(!html.includes('<script>unsafe</script>'));
  assert.ok(html.includes('Assignment 1-1:'));
  assert.ok(html.includes('Assignment 1-2:'));
  const legacy = attendanceDetails([{ date: '2026-10-01', punches: [
    { slot: 'IN', timeUtc: shiftInstant('2026-10-01', '07:40'), note: 'Legacy field note' }
  ] }]);
  assert.equal(legacy[0].reason, 'Legacy field note');
  assert.equal(legacy[0].outUtc, undefined);
  const cleared=attendanceDetails([{date:'2026-10-01',punches:[{slot:'IN',reason:'',note:'Previous reason',fieldAssignment:'Client A'}]}]);
  assert.equal(cleared[0].reason,'');
  assert.equal(cleared[0].fieldAssignment,'Client A');
});

test('actual report totals use current approvals and exclude old manual OT grants', () => {
  const app = appHarness(), fixture = reportFixture(1,1), date = '2026-10-01';
  const punches = fixture.rows[0].punches;
  const extension = { userId: 'worker', workDate: date, calculationKey: premiumCalculationKey(date,punches),
    overtimeDecision: 'PENDING', nightDecision: 'PENDING' };
  Object.assign(app.state, { employees: [fixture.employee], reportRange: { start: date, end: date },
    session: { today: date, user: { role: 'admin' }, settings: { holidays: [] } },
    adminData: { punches, extensions: [extension], overtime: [{ user_id: 'worker', work_date: date, minutes: 999 }] } });
  assert.equal(app.reportRows()[0].totals.regular,480);
  assert.equal(app.reportRows()[0].totals.overtime,0);
  extension.overtimeDecision = 'APPROVED';
  assert.equal(app.reportRows()[0].totals.overtime,10);
  punches[0].scheduleStart = '06:00';
  assert.equal(app.reportRows()[0].totals.overtime,0);
  app.state.adminData.extensions = [];
  assert.equal(app.reportRows()[0].totals.overtime,0);
});

test('payroll report totals include regular top-up and approved premiums without crediting night to regular', () => {
  const app=appHarness(), date='2026-10-01', fixture=reportFixture(1,3);
  const punches=fixture.rows[0].punches;
  for(const punch of punches){
    const times={1:['08:00','15:00'],2:['17:00','20:00'],3:['22:00','00:00']}[punch.segment];
    punch.timeUtc=shiftInstant(date,times[punch.slot==='IN'?0:1],punch.segment===3&&punch.slot==='OUT');
  }
  const extension={userId:'worker',workDate:date,calculationKey:premiumCalculationKey(date,punches),overtimeDecision:'APPROVED',nightDecision:'APPROVED'};
  Object.assign(app.state,{employees:[fixture.employee],reportRange:{start:date,end:date},
    session:{today:date,user:{role:'admin'},settings:{holidays:[]}},adminData:{punches,extensions:[extension],overtime:[]}});
  let totals=app.reportRows()[0].totals;
  assert.deepEqual([totals.regular,totals.undertime,totals.overtime,totals.night],[480,0,180,120]);
  app.state.adminData.punches= punches.filter(p=>p.segment!==2);
  extension.calculationKey=premiumCalculationKey(date,app.state.adminData.punches);
  totals=app.reportRows()[0].totals;
  assert.deepEqual([totals.regular,totals.undertime,totals.overtime,totals.night],[360,120,120,120]);
});

test('report shows employee/admin source and pending OT separately from approved payroll hours', () => {
  const app=appHarness(), fixture=reportFixture(1,1),date='2026-10-01',punches=fixture.rows[0].punches;
  punches[0].method='ONSITE'; punches[0].timeUtc=`${date}T00:18:47.994Z`;
  punches[1].method='OFFSITE'; punches[1].timeUtc=`${date}T11:04:00.654Z`;
  const extension={userId:'worker',workDate:date,calculationKey:premiumCalculationKey(date,punches),overtimeDecision:'PENDING',nightDecision:'PENDING'};
  Object.assign(app.state,{employees:[fixture.employee],reportRange:{start:date,end:date},
    session:{today:date,user:{role:'admin'},settings:{holidays:[]}},adminData:{punches,extensions:[extension],overtime:[]}});
  let report=app.reportRows()[0];
  assert.equal(report.totals.regular,480);
  assert.equal(report.totals.overtime,0);
  assert.equal(report.totals.pendingOvertime,105);
  let html=app.renderReportEmployee(report,{start:date,end:date},'QA',true);
  assert.ok(html.includes('Employee · Onsite / Employee · Offsite'));
  assert.ok(html.includes('Pending OT: 1h 45m'));
  extension.overtimeDecision='APPROVED';
  report=app.reportRows()[0];
  assert.equal(report.totals.overtime,105);
  assert.equal(report.totals.pendingOvertime,0);
  punches[1].method='ADMIN'; punches[1].assignmentType='OFFSITE';
  html=app.renderReportEmployee(app.reportRows()[0],{start:date,end:date},'QA',true);
  assert.ok(html.includes('Employee · Onsite / Admin'));
  assert.ok(!html.includes('Admin offsite'));
});

test('overnight PDF rows and night approval stay on the shift start date across a cutoff', () => {
  const app=appHarness(), fixture=reportFixture(1,1), date='2026-10-25', nextDay='2026-10-26';
  const punches=fixture.rows[0].punches;
  for(const punch of punches){
    punch.workDate=date;
    punch.timeUtc=shiftInstant(date,punch.slot==='IN'?'22:00':'06:00',punch.slot==='OUT');
  }
  const extension={userId:'worker',workDate:date,calculationKey:premiumCalculationKey(date,punches),overtimeDecision:'PENDING',nightDecision:'PENDING'};
  Object.assign(app.state,{employees:[fixture.employee],reportRange:{start:date,end:date},
    session:{today:nextDay,user:{role:'admin'},settings:{holidays:[]}},adminData:{punches,extensions:[extension],overtime:[]}});
  let report=app.reportRows()[0];
  assert.equal(report.rows.length,1);
  assert.equal(report.rows[0].date,date);
  assert.equal(report.totals.pendingNight,480);
  assert.equal(report.totals.night,0);
  extension.nightDecision='APPROVED';
  report=app.reportRows()[0];
  assert.equal(report.totals.night,480);
  assert.equal(report.totals.overtime,480);
  const html=app.renderReportEmployee(report,{start:date,end:date},'QA',true);
  assert.match(html,/6:00\s*AM \(\+1 day\)/);
  assert.equal(attendanceDetails(report.rows)[0].date,date);
  app.state.reportRange={start:nextDay,end:nextDay};
  assert.equal(app.reportRows()[0].rows[0].punches.length,0);
  assert.equal(app.reportRows()[0].totals.night,0);
});

test('PDF OT includes approved ND with ten minutes undertime and excludes pending or rejected ND', () => {
  const app=appHarness(), fixture=reportFixture(1,2), date='2026-10-01';
  const punches=fixture.rows[0].punches;
  for(const punch of punches){
    const time={1:['08:10','15:00'],2:['20:00','00:00']}[punch.segment][punch.slot==='IN'?0:1];
    punch.timeUtc=shiftInstant(date,time,punch.segment===2&&punch.slot==='OUT');
  }
  const extension={userId:'worker',workDate:date,calculationKey:premiumCalculationKey(date,punches),overtimeDecision:'PENDING',nightDecision:'PENDING'};
  Object.assign(app.state,{employees:[fixture.employee],reportRange:{start:date,end:date},
    session:{today:date,user:{role:'admin'},settings:{holidays:[]}},adminData:{punches,extensions:[extension],overtime:[]}});
  let report=app.reportRows()[0];
  assert.deepEqual([report.totals.regular,report.totals.undertime,report.totals.overtime,report.totals.night,report.totals.pendingOvertime,report.totals.pendingNight],
    [470,10,0,0,120,120]);
  extension.nightDecision='APPROVED';
  report=app.reportRows()[0];
  assert.deepEqual([report.totals.regular,report.totals.undertime,report.totals.overtime,report.totals.night,report.totals.pendingOvertime,report.totals.pendingNight],
    [470,10,120,120,0,0]);
  const html=app.renderReportEmployee(report,{start:date,end:date},'QA',true);
  assert.ok(html.includes('Approved Overtime</span><strong>2h 00m'));
  assert.ok(html.includes('Undertime</span><strong>0h 10m'));
  assert.ok(html.includes('The ND column is included in OT total. ND never reduces undertime.'));
  assert.ok(html.includes('<th>Overtime</th>'));
  extension.nightDecision='REJECTED';
  assert.equal(app.reportRows()[0].totals.overtime,0);
  extension.nightDecision='APPROVED';
  punches[0].timeUtc=shiftInstant(date,'08:20');
  assert.equal(app.reportRows()[0].totals.overtime,0);
  assert.equal(app.reportRows()[0].totals.pendingOvertime,120);
});
