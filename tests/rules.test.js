import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoffFor, distanceMeters, attendanceMinutes, isPayrollReady, workBreakdown, shiftInstant } from '../rules.js';

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

test('lunch counts toward eight regular hours and completed hours remove lateness', () => {
  const date = '2026-10-15';
  assert.deepEqual(attendanceMinutes(shiftInstant(date, '09:00'), shiftInstant(date, '17:00'), '08:00', '17:00', 'Asia/Manila'),
    { late: 0, early: 0 });
  assert.deepEqual(attendanceMinutes(shiftInstant(date, '09:00'), shiftInstant(date, '16:00'), '08:00', '17:00', 'Asia/Manila'),
    { late: 60, early: 60 });
  assert.deepEqual(attendanceMinutes(shiftInstant(date, '09:00'), shiftInstant(date, '18:00'), '08:00', '17:00', 'Asia/Manila'),
    { late: 0, early: 0 });
  assert.deepEqual(attendanceMinutes(shiftInstant(date, '08:45'), shiftInstant(date, '16:45'), '08:00', '17:00', 'Asia/Manila'),
    { late: 0, early: 0 });
});

test('regular time caps at eight paid hours and a short extension is not overtime', () => {
  const date = '2026-10-15';
  assert.deepEqual(workBreakdown(date, shiftInstant(date, '08:00'), shiftInstant(date, '17:13'), shiftInstant(date, '17:00')),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 13,
      nightCandidateMinutes: 0, overtimeEligible: false });
});

test('overtime includes night differential while reporting the night portion separately', () => {
  const date = '2026-10-15', start = shiftInstant(date, '08:00'), request = shiftInstant(date, '17:00');
  assert.deepEqual(workBreakdown(date, start, shiftInstant(date, '18:00'), request),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 60,
      nightCandidateMinutes: 0, overtimeEligible: true });
  assert.deepEqual(workBreakdown(date, start, shiftInstant(date, '22:20'), request),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 320,
      nightCandidateMinutes: 20, overtimeEligible: true });
});

test('a late employee completes eight regular hours by 5 PM before overtime starts', () => {
  const date = '2026-10-15', start = shiftInstant(date, '09:00'), request = shiftInstant(date, '17:00');
  assert.deepEqual(workBreakdown(date, start, shiftInstant(date, '17:00'), request),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 0,
      nightCandidateMinutes: 0, overtimeEligible: false });
  assert.deepEqual(workBreakdown(date, start, shiftInstant(date, '18:00'), request),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 60,
      nightCandidateMinutes: 0, overtimeEligible: true });
  assert.deepEqual(workBreakdown(date, start, shiftInstant(date, '19:00'), request),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 120,
      nightCandidateMinutes: 0, overtimeEligible: true });
});

test('regular starts at 8 AM, recovery is regular, and 4 AM to 6 AM is differential', () => {
  const date = '2026-10-15';
  assert.deepEqual(workBreakdown(date, shiftInstant(date, '10:00'), shiftInstant(date, '18:00'), shiftInstant(date, '17:00')),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 0,
      nightCandidateMinutes: 0, overtimeEligible: false });
  assert.deepEqual(workBreakdown(date, shiftInstant(date, '10:00'), shiftInstant(date, '19:00'), shiftInstant(date, '17:00')),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 60,
      nightCandidateMinutes: 0, overtimeEligible: true });
  assert.deepEqual(workBreakdown(date, shiftInstant(date, '04:00'), shiftInstant(date, '17:00')),
    { regularMinutes: 480, undertimeMinutes: 0, overtimeCandidateMinutes: 0,
      nightCandidateMinutes: 120, overtimeEligible: false });
  assert.deepEqual(workBreakdown(date, shiftInstant(date, '04:00'), shiftInstant(date, '06:00')),
    { regularMinutes: 0, undertimeMinutes: 480, overtimeCandidateMinutes: 0,
      nightCandidateMinutes: 120, overtimeEligible: false });
});

test('night differential stops at 6 AM and early exit is undertime', () => {
  const date = '2026-10-15';
  assert.equal(workBreakdown(date, shiftInstant(date, '08:00'), shiftInstant(date, '15:30')).undertimeMinutes, 30);
  const overnight = workBreakdown(date, shiftInstant(date, '08:00'), shiftInstant(date, '07:00', true), shiftInstant(date, '17:00'));
  assert.equal(overnight.overtimeCandidateMinutes, 780);
  assert.equal(overnight.nightCandidateMinutes, 480);
});
