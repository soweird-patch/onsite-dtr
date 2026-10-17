// Run explicitly against a disposable Convex deployment:
// CONVEX_TEST_URL=... CONVEX_TEST_ADMIN_EMAIL=... CONVEX_TEST_ADMIN_PASSWORD=... node tests/convex.integration.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

const url = process.env.CONVEX_TEST_URL;
const email = process.env.CONVEX_TEST_ADMIN_EMAIL;
const password = process.env.CONVEX_TEST_ADMIN_PASSWORD;
if (!url || !email || !password) throw new Error('Set disposable CONVEX_TEST_URL and admin credentials.');

const client = new ConvexHttpClient(url);
const admin = await client.action(api.authActions.login, { identifier: email, password, remember: false });
assert.equal(admin.user.role, 'admin');
const adminSession = await client.query(api.core.session, { token: admin.token });
assert.equal(adminSession.user.email, email);
await client.mutation(api.core.updateSettings, { token: admin.token, input: {
  siteName: 'QA site', siteLat: 14.6, siteLng: 121, radiusM: 200, maxAccuracyM: 100, cutoffDays: [11, 26]
} });

const suffix = Math.random().toString(36).slice(2);
const workerUsername = `qa.worker.${suffix}`;
const workerPassword = `Worker-QA-${suffix}-password`;
const created = await client.action(api.authActions.createEmployee, { token: admin.token, input: {
  name: 'QA Worker', username: workerUsername, password: workerPassword, scheduleStart: '08:00',
  scheduleEnd: '17:00', workdays: [1, 2, 3, 4, 5, 6], graceMinutes: 0, active: true
} });
assert.equal(created.employee.username, workerUsername);
const worker = await client.action(api.authActions.login, { identifier: workerUsername, password: workerPassword, remember: true });
assert.equal(worker.user.role, 'employee');
await assert.rejects(client.query(api.core.employees, { token: worker.token }), /Not allowed/);

const selfie = `data:image/png;base64,${fs.readFileSync(new URL('../public/icon-192.png', import.meta.url)).toString('base64')}`;
await assert.rejects(client.action(api.storageActions.punch, { token: worker.token, input: {
  slot: 'IN', latitude: 14.6, longitude: 121, accuracyM: 10, note: ''
} }), /selfie/i);
const inResult = await client.action(api.storageActions.punch, { token: worker.token, input: {
  slot: 'IN', latitude: 14.6, longitude: 121, accuracyM: 10, note: '', selfie
} });
assert.equal(inResult.punch.verification, 'PENDING');
assert.equal(inResult.punch.hasSelfie, true);
assert.equal(inResult.punch.method, 'ONSITE');
await assert.rejects(client.action(api.storageActions.punch, { token: worker.token, input: {
  slot: 'IN', latitude: 14.6, longitude: 121, accuracyM: 10, note: '', selfie
} }), /already recorded/);
const outResult = await client.action(api.storageActions.punch, { token: worker.token, input: {
  slot: 'OUT', latitude: 14.7, longitude: 121.1, accuracyM: 10,
  note: 'Client visit', selfie
} });
assert.equal(outResult.punch.verification, 'PENDING');
assert.equal(outResult.punch.method, 'OFFSITE');
const proof = await client.action(api.storageActions.selfie, { token: admin.token, id: outResult.punch.id });
assert.match(proof, /^data:image\/png;base64,/);
await client.mutation(api.core.approveAttendanceDay, {
  token: admin.token, userId: worker.user.id, workDate: inResult.punch.workDate
});
const logs = await client.query(api.core.attendance, { token: worker.token });
assert.equal(logs.punches.length, 2);
assert.equal(logs.punches.find(p => p.slot === 'OUT').verification, 'APPROVED');

const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
await client.mutation(api.core.backfill, { token: admin.token, input: {
  employeeId: worker.user.id, workDate: yesterday, timeIn: '08:30', timeOut: '17:30',
  overtimeMinutes: 30, reason: 'No mobile signal during field assignment', replaceExisting: false
} });
const report = await client.query(api.core.adminAttendance, { token: admin.token, from: yesterday, to: adminSession.today });
assert(report.punches.some(p => p.workDate === yesterday && p.method === 'ADMIN'));
assert(report.overtime.some(o => o.work_date === yesterday && o.minutes === 30));

const holiday = { date: adminSession.today, name: 'QA No Work Day' };
await assert.rejects(client.mutation(api.core.updateHolidays, { token: worker.token, holidays: [holiday] }), /Not allowed/);
await client.mutation(api.core.updateHolidays, { token: admin.token, holidays: [holiday] });
const holidaySettings = (await client.query(api.core.session, { token: worker.token })).settings;
assert.equal(holidaySettings.customHolidays[0].name, holiday.name);
assert.equal(holidaySettings.holidays.find(item => item.date === holiday.date)?.name, holiday.name);
assert.equal(holidaySettings.legalHolidays.find(item => item.date === '2027-02-25')?.type, 'Special working');
await assert.rejects(client.action(api.storageActions.punch, { token: worker.token, input: {
  slot: 'IN', latitude: 14.6, longitude: 121, accuracyM: 10, note: '', selfie
} }), /No scheduled work today/);

const logo192 = `data:image/png;base64,${fs.readFileSync(new URL('../public/icon-192.png', import.meta.url)).toString('base64')}`;
const logo512 = `data:image/png;base64,${fs.readFileSync(new URL('../public/icon-512.png', import.meta.url)).toString('base64')}`;
await client.action(api.storageActions.setBranding, { token: admin.token, appName: 'QA DTR', logo192, logo512, removeLogo: false });
const branding = await client.query(api.core.branding, {});
assert.equal(branding.appName, 'QA DTR');
assert.match(branding.logo192Url, /^https:\/\//);
assert.match(branding.logo512Url, /^https:\/\//);
await client.action(api.storageActions.setBranding, { token: admin.token, appName: 'QA DTR renamed', removeLogo: false });
const renamedBranding = await client.query(api.core.branding, {});
assert.equal(renamedBranding.appName, 'QA DTR renamed');
assert.equal(renamedBranding.logo192Url, branding.logo192Url);
assert.equal(renamedBranding.logo512Url, branding.logo512Url);
await client.mutation(api.core.updateSettings, { token: admin.token, input: {
  siteName: 'QA site after branding', siteLat: 14.6, siteLng: 121, radiusM: 200, maxAccuracyM: 100, cutoffDays: [11, 26]
} });
const preserved = (await client.query(api.core.session, { token: admin.token })).settings;
assert.equal(preserved.customHolidays[0].name, holiday.name);
assert.equal(preserved.appName, 'QA DTR renamed');
await client.action(api.storageActions.setBranding, { token: admin.token, appName: 'Onsite DTR', removeLogo: true });
assert.equal((await client.query(api.core.branding, {})).logo192Url, null);
await client.mutation(api.core.updateHolidays, { token: admin.token, holidays: [] });
await client.mutation(api.core.logout, { token: worker.token });
await assert.rejects(client.query(api.core.session, { token: worker.token }), /Please sign in/);
console.log('Convex integration: attendance, holidays, branding, permissions, and session passed.');
