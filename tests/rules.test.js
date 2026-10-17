import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoffFor, distanceMeters, attendanceMinutes, isPayrollDayReady, isPayrollReady,
  workBreakdown, workBreakdownIntervals, shiftInstant } from '../rules.js';

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

test('regular time uses only 8–12 and 1–5, with lunch excluded', () => {
  const date = '2026-10-15';
  assert.deepEqual(attendanceMinutes(shiftInstant(date, '09:00'), shiftInstant(date, '17:00'), '08:00', '17:00', 'Asia/Manila'),
    { late: 60, early: 60 });
  assert.deepEqual(attendanceMinutes(shiftInstant(date, '09:00'), shiftInstant(date, '16:00'), '08:00', '17:00', 'Asia/Manila'),
    { late: 60, early: 120 });
  assert.deepEqual(attendanceMinutes(shiftInstant(date, '09:00'), shiftInstant(date, '18:00'), '08:00', '17:00', 'Asia/Manila'),
    { late: 60, early: 60 });
  assert.deepEqual(attendanceMinutes(shiftInstant(date, '08:45'), shiftInstant(date, '16:45'), '08:00', '17:00', 'Asia/Manila'),
    { late: 45, early: 60 });
});

test('every worked minute after 5 PM is automatically an overtime candidate', () => {
  const date = '2026-10-15';
  assertBreakdown(workBreakdown(date, shiftInstant(date, '08:00'), shiftInstant(date, '17:13')),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 13,
      nightCandidateMinutes: 0, overtimeEligible: true });
});

test('overtime is automatic and includes the separately reported night portion', () => {
  const date = '2026-10-15', start = shiftInstant(date, '08:00');
  assertBreakdown(workBreakdown(date, start, shiftInstant(date, '18:00')),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 60,
      nightCandidateMinutes: 0, overtimeEligible: true });
  assertBreakdown(workBreakdown(date, start, shiftInstant(date, '22:20')),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 300,
      nightCandidateMinutes: 20, overtimeEligible: true });
});

test('late time remains undertime and is not recovered by work after 5 PM', () => {
  const date = '2026-10-15', start = shiftInstant(date, '09:00');
  assertBreakdown(workBreakdown(date, start, shiftInstant(date, '17:00')),
    { regularMinutes: 420, undertimeMinutes: 60, overtimeCandidateMinutes: 0,
      nightCandidateMinutes: 0, overtimeEligible: false });
  assertBreakdown(workBreakdown(date, start, shiftInstant(date, '18:00')),
    { regularMinutes: 420, undertimeMinutes: 60, overtimeCandidateMinutes: 60,
      nightCandidateMinutes: 0, overtimeEligible: true });
  assertBreakdown(workBreakdown(date, start, shiftInstant(date, '19:00')),
    { regularMinutes: 420, undertimeMinutes: 60, overtimeCandidateMinutes: 120,
      nightCandidateMinutes: 0, overtimeEligible: true });
});

test('regular stays inside the standard shift and 4 AM to 6 AM is differential', () => {
  const date = '2026-10-15';
  assertBreakdown(workBreakdown(date, shiftInstant(date, '10:00'), shiftInstant(date, '18:00'), shiftInstant(date, '17:00')),
    { regularMinutes: 360, undertimeMinutes: 120, overtimeCandidateMinutes: 60,
      nightCandidateMinutes: 0, overtimeEligible: true });
  assertBreakdown(workBreakdown(date, shiftInstant(date, '10:00'), shiftInstant(date, '19:00'), shiftInstant(date, '17:00')),
    { regularMinutes: 360, undertimeMinutes: 120, overtimeCandidateMinutes: 120,
      nightCandidateMinutes: 0, overtimeEligible: true });
  assertBreakdown(workBreakdown(date, shiftInstant(date, '04:00'), shiftInstant(date, '17:00')),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 0,
      nightCandidateMinutes: 120, overtimeEligible: false });
  assertBreakdown(workBreakdown(date, shiftInstant(date, '04:00'), shiftInstant(date, '06:00')),
    { regularMinutes: 0, undertimeMinutes: 480, overtimeCandidateMinutes: 0,
      nightCandidateMinutes: 120, overtimeEligible: false });
});

test('night differential stops at 6 AM and early exit is undertime', () => {
  const date = '2026-10-15';
  assert.equal(workBreakdown(date, shiftInstant(date, '08:00'), shiftInstant(date, '15:30')).undertimeMinutes, 90);
  const overnight = workBreakdown(date, shiftInstant(date, '08:00'), shiftInstant(date, '07:00', true));
  assert.equal(overnight.overtimeCandidateMinutes, 300);
  assert.equal(overnight.nightCandidateMinutes, 480);
});

test('return-to-work interval excludes the gap and appears in overtime and differential', () => {
  const date = '2026-10-15', continued = shiftInstant(date, '17:00');
  const intervals = [
    { inUtc: shiftInstant(date, '08:00'), outUtc: shiftInstant(date, '20:00') },
    { inUtc: shiftInstant(date, '21:00'), outUtc: shiftInstant(date, '23:00') }
  ];
  assertBreakdown(workBreakdownIntervals(date, intervals, continued), {
    regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 240,
    nightCandidateMinutes: 60, overtimeEligible: true
  });
  assert.equal(isPayrollDayReady([
    { segment: 1, slot: 'IN', verification: 'APPROVED' },
    { segment: 1, slot: 'OUT', verification: 'APPROVED' },
    { segment: 2, slot: 'IN', verification: 'PENDING' },
    { segment: 2, slot: 'OUT', verification: 'APPROVED' }
  ]), false);
});

test('shortage reserves only the needed OT and leaves the remaining balance', () => {
  const date = '2026-10-15';
  assertBreakdown(workBreakdown(date, shiftInstant(date, '09:00'), shiftInstant(date, '22:00')), {
    regularMinutes: 420, shortageMinutes: 60, overtimeBeforeAdjustmentMinutes: 300,
    proposedTransferMinutes: 60, resultingRegularMinutes: 480, remainingOvertimeMinutes: 240
  });
});

test('custom schedule overlap is regular-only and never duplicated as OT', () => {
  const date = '2026-10-15';
  assertBreakdown(workBreakdown(date, shiftInstant(date, '09:00'), shiftInstant(date, '22:00'), null, '09:00', '18:00'), {
    regularMinutes: 480, shortageMinutes: 0, overtimeBeforeAdjustmentMinutes: 240,
    proposedTransferMinutes: 0, remainingOvertimeMinutes: 240
  });
});
