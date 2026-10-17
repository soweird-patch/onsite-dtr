import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoffFor, distanceMeters, attendanceMinutes, isPayrollDayReady, isPayrollReady,
  expectedTimeOut, payrollDayTotals, premiumCalculationKey, workBreakdown, workBreakdownIntervals, workIntervalBreakdowns, shiftInstant } from '../rules.js';

function assertBreakdown(actual, expected) {
  for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, key);
}

test('payroll includes only a complete admin-approved attendance day', () => {
  assert.equal(isPayrollReady({ verification: 'APPROVED' }, { verification: 'APPROVED' }), true);
  assert.equal(isPayrollReady({ verification: 'PENDING' }, { verification: 'APPROVED' }), false);
  assert.equal(isPayrollReady({ verification: 'APPROVED' }, null), false);
});

test('cutoff crosses month and year boundaries', () => {
  assert.deepEqual(cutoffFor('2026-10-15'), { start: '2026-10-11', end: '2026-10-25' });
  assert.deepEqual(cutoffFor('2026-11-04'), { start: '2026-10-26', end: '2026-11-10' });
  assert.deepEqual(cutoffFor('2027-01-02'), { start: '2026-12-26', end: '2027-01-10' });
});

test('site distance is zero at pin and exceeds radius far away', () => {
  assert.equal(distanceMeters(14.6, 121, 14.6, 121), 0);
  assert.ok(distanceMeters(14.6, 121, 14.61, 121) > 1000);
});

test('flexible arrival only creates undertime for an actual shortfall', () => {
  const date = '2026-10-15';
  assert.deepEqual(attendanceMinutes(shiftInstant(date, '09:00'), shiftInstant(date, '17:00'), '08:00', '17:00', 'Asia/Manila'),
    { late: 0, early: 60 });
  assert.deepEqual(attendanceMinutes(shiftInstant(date, '09:00'), shiftInstant(date, '18:00'), '08:00', '17:00', 'Asia/Manila'),
    { late: 0, early: 0 });
});

test('7:40 arrival completes eight paid hours at 16:40 and earns ten minutes pending OT at 16:50', () => {
  const date = '2026-10-15', inUtc = shiftInstant(date, '07:40');
  assert.equal(expectedTimeOut(date, [{ inUtc }]), shiftInstant(date, '16:40'));
  assertBreakdown(workBreakdown(date, inUtc, shiftInstant(date, '16:50')), {
    regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 10, nightCandidateMinutes: 0,
    expectedTimeOutUtc: shiftInstant(date, '16:40')
  });
});

test('7 AM arrival finishes at 4 PM while a 5 PM exit adds one hour requiring OT approval', () => {
  const date = '2026-10-15', start = shiftInstant(date,'07:00');
  assert.equal(expectedTimeOut(date,[{inUtc:start}]),shiftInstant(date,'16:00'));
  for (const [end, overtime] of [['16:00',0],['17:00',60]]) {
    const punches = [
      {slot:'IN',timeUtc:start,scheduleStart:'08:00',scheduleEnd:'17:00',verification:'APPROVED'},
      {slot:'OUT',timeUtc:shiftInstant(date,end),verification:'APPROVED'}
    ];
    assertBreakdown(workBreakdown(date,start,shiftInstant(date,end)),{regularMinutes:480,overtimeCandidateMinutes:overtime,undertimeMinutes:0});
    const review = {calculationKey:premiumCalculationKey(date,punches),overtimeDecision:'PENDING',nightDecision:'PENDING'};
    assert.equal(payrollDayTotals(date,punches,review).overtime,0);
    review.overtimeDecision='APPROVED';
    assert.equal(payrollDayTotals(date,punches,review).overtime,overtime);
  }
});

test('OT stops exactly at 10 PM and night differential keeps its fixed overnight window', () => {
  const date = '2026-10-15', start = shiftInstant(date,'07:00');
  for (const [end,nextDay,ot,night] of [
    ['21:59',false,359,0], ['22:00',false,360,0], ['22:01',false,360,1],
    ['23:00',false,360,60], ['06:00',true,360,480], ['07:00',true,360,480]
  ]) {
    assertBreakdown(workBreakdown(date,start,shiftInstant(date,end,nextDay)), {
      regularMinutes:480,overtimeCandidateMinutes:ot,nightCandidateMinutes:night
    });
  }
  const split = workBreakdownIntervals(date,[
    {inUtc:start,outUtc:shiftInstant(date,'16:00')},
    {inUtc:shiftInstant(date,'21:30'),outUtc:shiftInstant(date,'23:30')}
  ]);
  assertBreakdown(split,{regularMinutes:480,overtimeCandidateMinutes:30,nightCandidateMinutes:90});
});

test('6 AM arrival earns OT before 5 PM; late arrivals must still complete eight hours', () => {
  const date = '2026-10-15';
  assertBreakdown(workBreakdown(date, shiftInstant(date, '06:00'), shiftInstant(date, '15:30')), {
    regularMinutes: 480, overtimeCandidateMinutes: 30, undertimeMinutes: 0
  });
  assertBreakdown(workBreakdown(date, shiftInstant(date, '10:00'), shiftInstant(date, '18:00')), {
    regularMinutes: 420, overtimeCandidateMinutes: 0, undertimeMinutes: 60
  });
  assertBreakdown(workBreakdown(date, shiftInstant(date, '16:00'), shiftInstant(date, '00:15', true)), {
    regularMinutes: 360, undertimeMinutes: 120, overtimeCandidateMinutes: 0, nightCandidateMinutes: 135,
    expectedTimeOutUtc: null
  });
});

test('night time is recorded exclusively as differential and capped at 6 AM', () => {
  const date = '2026-10-15';
  assertBreakdown(workBreakdown(date, shiftInstant(date, '08:00'), shiftInstant(date, '07:00', true)), {
    regularMinutes: 480, overtimeCandidateMinutes: 300, nightCandidateMinutes: 480
  });
  assertBreakdown(workBreakdown(date, shiftInstant(date, '22:00'), shiftInstant(date, '06:00', true)), {
    regularMinutes: 0, undertimeMinutes: 480, overtimeCandidateMinutes: 0, nightCandidateMinutes: 480,
    expectedTimeOutUtc: null
  });
});

test('split intervals exclude gaps and unpaid lunch only once', () => {
  const date = '2026-10-15';
  const intervals = [
    { inUtc: shiftInstant(date, '07:40'), outUtc: shiftInstant(date, '12:00') },
    { inUtc: shiftInstant(date, '13:00'), outUtc: shiftInstant(date, '16:50') }
  ];
  assertBreakdown(workBreakdownIntervals(date, intervals), {
    regularMinutes: 480, overtimeCandidateMinutes: 10, expectedTimeOutUtc: shiftInstant(date, '16:40')
  });
  assert.equal(expectedTimeOut(date, [intervals[0], { inUtc: shiftInstant(date, '14:00') }]), shiftInstant(date, '17:40'));
  assertBreakdown(workBreakdownIntervals(date, [
    { inUtc: shiftInstant(date, '08:00'), outUtc: shiftInstant(date, '20:00') },
    { inUtc: shiftInstant(date, '21:00'), outUtc: shiftInstant(date, '23:00') }
  ]), { regularMinutes: 480, overtimeCandidateMinutes: 240, nightCandidateMinutes: 60 });
});

test('overlapping intervals cannot double count regular time or night differential', () => {
  const date = '2026-10-15';
  assertBreakdown(workBreakdownIntervals(date, [
    { inUtc: shiftInstant(date, '16:00'), outUtc: shiftInstant(date, '23:00') },
    { inUtc: shiftInstant(date, '22:00'), outUtc: shiftInstant(date, '00:30', true) }
  ]), { regularMinutes: 360, undertimeMinutes: 120, overtimeCandidateMinutes: 0, nightCandidateMinutes: 150 });
});

test('second interval fills the eight-hour shortage before OT; a third night interval earns ND only', () => {
  const date = '2026-10-15';
  const intervals = [
    {inUtc:shiftInstant(date,'08:00'),outUtc:shiftInstant(date,'15:00')},
    {inUtc:shiftInstant(date,'17:00'),outUtc:shiftInstant(date,'20:00')},
    {inUtc:shiftInstant(date,'22:00'),outUtc:shiftInstant(date,'00:00',true)}
  ];
  assertBreakdown(workBreakdownIntervals(date,intervals), {
    regularMinutes:480,shortageMinutes:0,overtimeCandidateMinutes:60,nightCandidateMinutes:120,
    expectedTimeOutUtc:shiftInstant(date,'19:00')
  });
  const parts = workIntervalBreakdowns(date,intervals);
  assert.deepEqual(parts.map(p=>[p.regularMinutes,p.regularTopUpMinutes,p.overtimeCandidateMinutes,p.nightCandidateMinutes,p.shortageAfterMinutes]),[
    [360,0,0,0,120],[120,120,60,0,0],[0,0,0,120,0]
  ]);
  assert.equal(expectedTimeOut(date,[intervals[0],{inUtc:shiftInstant(date,'17:00')}]),shiftInstant(date,'19:00'));
});

test('night-only intervals never fill an unfinished regular day or increase OT', () => {
  const date = '2026-10-15';
  const intervals = [
    {inUtc:shiftInstant(date,'08:00'),outUtc:shiftInstant(date,'15:00')},
    {inUtc:shiftInstant(date,'22:00'),outUtc:shiftInstant(date,'02:00',true)}
  ];
  assertBreakdown(workBreakdownIntervals(date,intervals), {
    regularMinutes:360,shortageMinutes:120,overtimeCandidateMinutes:0,nightCandidateMinutes:240
  });
  assert.deepEqual(workIntervalBreakdowns(date,intervals)[1], {
    number:2,regularMinutes:0,regularTopUpMinutes:0,overtimeCandidateMinutes:0,nightCandidateMinutes:240,shortageAfterMinutes:120
  });
});

test('an interval crossing 10 PM splits into regular top-up, OT, and ND without overlap', () => {
  const date = '2026-10-15';
  const intervals = [
    {inUtc:shiftInstant(date,'08:00'),outUtc:shiftInstant(date,'16:00')},
    {inUtc:shiftInstant(date,'20:00'),outUtc:shiftInstant(date,'01:00',true)}
  ];
  assertBreakdown(workBreakdownIntervals(date,intervals),{
    regularMinutes:480,overtimeCandidateMinutes:60,nightCandidateMinutes:180
  });
  assert.deepEqual(workIntervalBreakdowns(date,intervals)[1],{
    number:2,regularMinutes:60,regularTopUpMinutes:60,overtimeCandidateMinutes:60,nightCandidateMinutes:180,shortageAfterMinutes:0
  });
});

test('schedule metadata cannot truncate actual work or create an OT-to-regular approval', () => {
  const date = '2026-10-15';
  const hours = workBreakdown(date, shiftInstant(date, '09:00'), shiftInstant(date, '22:00'), null, '10:00', '16:00');
  assertBreakdown(hours, { regularMinutes: 480, shortageMinutes: 0, overtimeBeforeAdjustmentMinutes: 240,
    proposedTransferMinutes: 0, remainingOvertimeMinutes: 240 });
});

test('payroll excludes pending and stale premiums and approves night differential independently', () => {
  const date = '2026-10-15';
  const punches = [
    { slot: 'IN', timeUtc: shiftInstant(date, '08:00'), verification: 'APPROVED' },
    { slot: 'OUT', timeUtc: shiftInstant(date, '23:00'), verification: 'APPROVED' }
  ];
  const extension = { calculationKey: premiumCalculationKey(date, punches), overtimeDecision: 'PENDING', nightDecision: 'PENDING' };
  assert.deepEqual(payrollDayTotals(date, punches, extension), { regular: 480, undertime: 0, overtime: 0, night: 0 });
  extension.nightDecision = 'APPROVED';
  assert.deepEqual(payrollDayTotals(date, punches, extension), { regular: 480, undertime: 0, overtime: 0, night: 60 });
  extension.overtimeDecision = 'APPROVED';
  assert.equal(payrollDayTotals(date, punches, extension).overtime, 300);
  punches[1].timeUtc = shiftInstant(date, '02:00', true);
  assert.deepEqual(payrollDayTotals(date, punches, extension), { regular: 480, undertime: 0, overtime: 0, night: 0 });
  punches[0].verification = 'PENDING';
  assert.deepEqual(payrollDayTotals(date, punches, extension), { regular: 0, undertime: 0, overtime: 0, night: 0 });
});
