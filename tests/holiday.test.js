import test from 'node:test';
import assert from 'node:assert/strict';
import { holidayFor, isScheduledWorkday } from '../rules.js';
import { noWorkHolidays, philippineHolidays } from '../philippineHolidays.js';

test('dated holidays override an employee workday without changing other dates', () => {
  const holidays = [{ date: '2026-12-25', name: 'Christmas Day' }];
  const workdays = [1, 2, 3, 4, 5, 6];
  assert.equal(holidayFor('2026-12-25', holidays)?.name, 'Christmas Day');
  assert.equal(isScheduledWorkday('2026-12-25', workdays, holidays), false);
  assert.equal(isScheduledWorkday('2026-12-24', workdays, holidays), true);
  assert.equal(isScheduledWorkday('2026-12-27', workdays, holidays), false);
});

test('published Philippine dates are ordered and keep special working days on the schedule', () => {
  const holidays = noWorkHolidays();
  assert.equal(holidayFor('2026-11-02', holidays)?.name, "All Souls' Day");
  assert.equal(holidayFor('2027-03-26', holidays)?.type, 'Regular holiday');
  assert.equal(isScheduledWorkday('2027-02-25', [1, 2, 3, 4, 5, 6], holidays), true);
  assert.equal(philippineHolidays.find(h => h.date === '2027-02-25')?.type, 'Special working');
  assert.equal(philippineHolidays.some(h => h.date.startsWith('2027-') && h.name.startsWith("Eid'l")), false);
});

test('company holiday can make a special working day a no-work day', () => {
  const holidays = noWorkHolidays([{ date: '2027-02-25', name: 'Company rest day' }]);
  assert.equal(holidayFor('2027-02-25', holidays)?.type, 'Company holiday');
  assert.equal(isScheduledWorkday('2027-02-25', [1, 2, 3, 4, 5, 6], holidays), false);
});
