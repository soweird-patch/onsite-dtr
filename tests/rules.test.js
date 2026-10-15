import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoffFor, distanceMeters, attendanceMinutes, workBreakdown, shiftInstant } from '../rules.js';

test('cutoff crosses month and year boundaries', () => {
  assert.deepEqual(cutoffFor('2026-10-15'), { start: '2026-10-11', end: '2026-10-25' });
  assert.deepEqual(cutoffFor('2026-11-04'), { start: '2026-10-26', end: '2026-11-10' });
  assert.deepEqual(cutoffFor('2027-01-02'), { start: '2026-12-26', end: '2027-01-10' });
});

test('site distance is zero at pin and exceeds radius far away', () => {
  assert.equal(distanceMeters(14.6, 121, 14.6, 121), 0);
  assert.ok(distanceMeters(14.6, 121, 14.61, 121) > 1000);
});

test('late starts immediately after the configured shift start', () => {
  const result = attendanceMinutes('2026-10-15T00:40:00Z', '2026-10-15T09:20:00Z', '08:30', '17:30', 'Asia/Manila');
  assert.deepEqual(result, { late: 10, early: 10 });
});

test('regular window includes break and a 13-minute extension is not overtime', () => {
  const date = '2026-10-15';
  assert.deepEqual(workBreakdown(date, shiftInstant(date, '08:00'), shiftInstant(date, '17:13'), shiftInstant(date, '17:00')),
    { regularMinutes: 540, undertimeMinutes: 0, overtimeCandidateMinutes: 13,
      nightCandidateMinutes: 0, overtimeEligible: false });
});

test('a full hour qualifies, and 10:20 PM splits overtime from night differential', () => {
  const date = '2026-10-15', start = shiftInstant(date, '08:00'), request = shiftInstant(date, '17:00');
  assert.deepEqual(workBreakdown(date, start, shiftInstant(date, '18:00'), request),
    { regularMinutes: 540, undertimeMinutes: 0, overtimeCandidateMinutes: 60,
      nightCandidateMinutes: 0, overtimeEligible: true });
  assert.deepEqual(workBreakdown(date, start, shiftInstant(date, '22:20'), request),
    { regularMinutes: 540, undertimeMinutes: 0, overtimeCandidateMinutes: 300,
      nightCandidateMinutes: 20, overtimeEligible: true });
});

test('night differential stops at 6 AM and early exit is undertime', () => {
  const date = '2026-10-15';
  assert.equal(workBreakdown(date, shiftInstant(date, '08:00'), shiftInstant(date, '15:30')).undertimeMinutes, 90);
  assert.equal(workBreakdown(date, shiftInstant(date, '08:00'), shiftInstant(date, '07:00', true), shiftInstant(date, '17:00')).nightCandidateMinutes, 480);
});
