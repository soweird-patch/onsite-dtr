// Nationwide dates in Proclamation Nos. 1006 (2026) and 1427 (2027).
// Movable Eid dates are added only after their separate proclamations.
const sources = {
  2026: 'https://www.officialgazette.gov.ph/downloads/2025/09sep/20250903-PROC-1006-FRM.pdf',
  2027: 'https://pco.gov.ph/news_releases/pbbm-declares-2027-regular-and-special-holidays/'
};

const calendar = {
  2026: [
    ['01-01', "New Year's Day", 'Regular holiday'],
    ['02-17', 'Chinese New Year', 'Special non-working'],
    ['02-25', 'EDSA People Power Revolution Anniversary', 'Special working'],
    ['03-20', "Eid'l Fitr", 'Regular holiday', 'https://pco.gov.ph/news_releases/palace-declares-march-20-regular-holiday-nationwide-for-eidl-fitr/'],
    ['04-02', 'Maundy Thursday', 'Regular holiday'],
    ['04-03', 'Good Friday', 'Regular holiday'],
    ['04-04', 'Black Saturday', 'Special non-working'],
    ['04-09', 'Araw ng Kagitingan', 'Regular holiday'],
    ['05-01', 'Labor Day', 'Regular holiday'],
    ['05-27', "Eid'l Adha", 'Regular holiday', 'https://pco.gov.ph/news_releases/palace-declares-may-27-as-a-regular-holiday-for-eidl-adha-observance/'],
    ['06-12', 'Independence Day', 'Regular holiday'],
    ['08-21', 'Ninoy Aquino Day', 'Special non-working'],
    ['08-31', 'National Heroes Day', 'Regular holiday'],
    ['11-01', "All Saints' Day", 'Special non-working'],
    ['11-02', "All Souls' Day", 'Special non-working'],
    ['11-30', 'Bonifacio Day', 'Regular holiday'],
    ['12-08', 'Feast of the Immaculate Conception of Mary', 'Special non-working'],
    ['12-24', 'Christmas Eve', 'Special non-working'],
    ['12-25', 'Christmas Day', 'Regular holiday'],
    ['12-30', 'Rizal Day', 'Regular holiday'],
    ['12-31', 'Last Day of the Year', 'Special non-working']
  ],
  2027: [
    ['01-01', "New Year's Day", 'Regular holiday'],
    ['02-06', 'Chinese New Year', 'Special non-working'],
    ['02-25', 'EDSA People Power Revolution Anniversary', 'Special working'],
    ['03-25', 'Maundy Thursday', 'Regular holiday'],
    ['03-26', 'Good Friday', 'Regular holiday'],
    ['03-27', 'Black Saturday', 'Special non-working'],
    ['04-09', 'Araw ng Kagitingan', 'Regular holiday'],
    ['05-01', 'Labor Day', 'Regular holiday'],
    ['06-12', 'Independence Day', 'Regular holiday'],
    ['08-21', 'Ninoy Aquino Day', 'Special non-working'],
    ['08-30', 'National Heroes Day', 'Regular holiday'],
    ['11-01', "All Saints' Day", 'Special non-working'],
    ['11-02', "All Souls' Day", 'Special non-working'],
    ['11-30', 'Bonifacio Day', 'Regular holiday'],
    ['12-08', 'Feast of the Immaculate Conception of Mary', 'Special non-working'],
    ['12-24', 'Christmas Eve', 'Special non-working'],
    ['12-25', 'Christmas Day', 'Regular holiday'],
    ['12-30', 'Rizal Day', 'Regular holiday'],
    ['12-31', 'Last Day of the Year', 'Special non-working']
  ]
};

export const philippineHolidays = Object.entries(calendar).flatMap(([year, rows]) =>
  rows.map(([monthDay, name, type, source]) => ({
    date: `${year}-${monthDay}`, name, type,
    nonWorking: type !== 'Special working', source: source || sources[year]
  })));

export function noWorkHolidays(customHolidays = []) {
  const dates = new Map(philippineHolidays.filter(holiday => holiday.nonWorking).map(holiday => [holiday.date, holiday]));
  for (const holiday of customHolidays) if (!dates.has(holiday.date))
    dates.set(holiday.date, { ...holiday, type: 'Company holiday', nonWorking: true });
  return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
}
